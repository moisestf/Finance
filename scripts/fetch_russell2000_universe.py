#!/usr/bin/env python3
"""
Build data/small_caps_universe.json: an approximation of "the largest ~500
Russell 2000 components by market cap" using Yahoo Finance's public screener
(via yfinance's yf.screen()) instead of scraping an official index provider.

Why not scrape the official Russell 2000 constituent list or an ETF's
holdings page directly: FTSE Russell's membership data isn't freely
available via API, and ETF-provider sites (e.g. iShares) are behind
enterprise bot-protection (Akamai) that blocks plain HTTP clients — there's
no lightweight, free way around that. Yahoo's screener endpoint is the same
infrastructure this project already relies on for daily prices, so this
reuses a data source we know works.

Approximation used: US-listed equities (NASDAQ/NYSE) with a market cap
between MIN_MARKET_CAP and MAX_MARKET_CAP (a band chosen to bracket the
Russell 2000's typical range), sorted by market cap descending, top N kept.
This will not be byte-identical to official Russell 2000 membership, but is
a reasonable, transparent, freely-obtainable stand-in for "largest small/
mid-cap components."

Usage:
    python scripts/fetch_russell2000_universe.py [--top 500]
"""
import argparse
import json
import sys
from pathlib import Path

import yfinance as yf
from yfinance import EquityQuery

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "data" / "small_caps_universe.json"
DEBUG_FILE = ROOT / "data" / "small_caps_debug.json"

MIN_MARKET_CAP = 300_000_000
MAX_MARKET_CAP = 20_000_000_000
PAGE_SIZE = 250  # Yahoo's hard max per request


def build_query() -> EquityQuery:
    return EquityQuery(
        "and",
        [
            EquityQuery("is-in", ["exchange", "NMS", "NYQ"]),
            EquityQuery("btwn", ["intradaymarketcap", MIN_MARKET_CAP, MAX_MARKET_CAP]),
            EquityQuery("eq", ["region", "us"]),
        ],
    )


def extract_quote_fields(q: dict):
    symbol = q.get("symbol")
    name = q.get("longName") or q.get("shortName") or q.get("displayName") or ""
    market_cap = q.get("marketCap")
    if market_cap is None:
        market_cap = q.get("intradayMarketCap") or q.get("regularMarketCap")
    if isinstance(market_cap, dict):
        market_cap = market_cap.get("raw")
    return symbol, name, market_cap


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--top", type=int, default=500)
    args = parser.parse_args()

    diagnostics = []
    all_quotes = []
    offset = 0
    total = None
    query = build_query()

    while len(all_quotes) < args.top:
        size = min(PAGE_SIZE, args.top - len(all_quotes))
        try:
            result = yf.screen(query, offset=offset, size=size, sortField="intradaymarketcap", sortAsc=False)
        except Exception as exc:  # noqa: BLE001
            print(f"screen() failed at offset={offset}: {exc}")
            diagnostics.append({"attempt": f"screen offset={offset} size={size}", "error": str(exc)})
            break

        quotes = result.get("quotes", [])
        total = result.get("total", total)
        diagnostics.append(
            {
                "attempt": f"screen offset={offset} size={size}",
                "returned": len(quotes),
                "total_reported": total,
                "sample_keys": sorted(quotes[0].keys()) if quotes else [],
            }
        )
        print(f"offset={offset} size={size} -> {len(quotes)} quotes (total reported: {total})")

        if not quotes:
            break
        all_quotes.extend(quotes)
        offset += len(quotes)
        if total is not None and offset >= total:
            break

    holdings = []
    missing_cap = 0
    for q in all_quotes:
        symbol, name, market_cap = extract_quote_fields(q)
        if not symbol:
            continue
        if market_cap is None:
            missing_cap += 1
        holdings.append(
            {
                "ticker": symbol.replace(".", "-").upper(),
                "name": name,
                "market_value": market_cap,
                "weight_pct": None,
            }
        )
    diagnostics.append({"attempt": "field extraction", "quotes_seen": len(all_quotes), "holdings_built": len(holdings), "missing_market_cap": missing_cap})

    # Yahoo already returns results sorted by market cap desc; de-dupe defensively.
    seen = set()
    top_list = []
    for h in holdings:
        if h["ticker"] in seen:
            continue
        seen.add(h["ticker"])
        top_list.append(h)
        if len(top_list) >= args.top:
            break

    DEBUG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DEBUG_FILE, "w", encoding="utf-8") as f:
        json.dump({"status": "ok" if top_list else "empty", "attempts": diagnostics}, f, indent=2, default=str)

    if not top_list:
        print("No holdings collected from yf.screen — see data/small_caps_debug.json.")
        sys.exit(0)  # fail soft, keep any previously-good universe file in place

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(
            {
                "source": (
                    f"Yahoo Finance screener (yfinance yf.screen): US equities on NASDAQ/NYSE "
                    f"with market cap between ${MIN_MARKET_CAP:,} and ${MAX_MARKET_CAP:,}, sorted "
                    f"descending — a free proxy for 'largest Russell 2000 components', not official "
                    f"FTSE Russell membership data."
                ),
                "requested_top": args.top,
                "count": len(top_list),
                "holdings": top_list,
            },
            f,
            indent=2,
        )

    print(f"Wrote {len(top_list)} holdings to {OUT_FILE}")
    print("Top 10 by market cap:")
    for h in top_list[:10]:
        print(f"  {h['ticker']:8s} {h['name'][:40]:40s} mv={h['market_value']}")


if __name__ == "__main__":
    main()
