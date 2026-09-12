#!/usr/bin/env python3
"""
Build data/small_caps_universe.json: the top N holdings (by market value,
i.e. approximate market cap) of the iShares Russell 2000 ETF (IWM).

Why IWM holdings instead of an official Russell 2000 constituent list:
FTSE Russell's official membership list isn't freely available via API.
IWM tracks the Russell 2000 and iShares publishes its full holdings as a
public CSV — this is the standard free, practical proxy for "Russell 2000
components ranked by market cap" and is what this script uses.

Usage:
    python scripts/fetch_russell2000_universe.py [--top 500]
"""
import argparse
import csv
import io
import re
import sys
from pathlib import Path

import json
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "data" / "small_caps_universe.json"

PRODUCT_PAGE = "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf"
# Known-good direct CSV export link for IWM holdings. iShares occasionally
# changes the numeric path segment; if this stops working the script falls
# back to scraping the current link off the product page below.
KNOWN_CSV_URL = (
    "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/"
    "1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund"
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

CSV_HEADERS = {
    **HEADERS,
    "Accept": "text/csv,application/csv,text/plain,*/*;q=0.8",
    "Referer": PRODUCT_PAGE,
}


def discover_csv_url(diagnostics: list, session: requests.Session):
    try:
        resp = session.get(PRODUCT_PAGE, headers=HEADERS, timeout=30)
        diagnostics.append({"attempt": "product page fetch", "url": PRODUCT_PAGE, "status_code": resp.status_code, "body_len": len(resp.content), "cookies_set": list(session.cookies.get_dict().keys())})
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        print(f"Could not load product page to discover CSV link: {exc}")
        diagnostics.append({"attempt": "product page fetch", "url": PRODUCT_PAGE, "error": str(exc)})
        return None

    text = resp.text

    broad_matches = re.findall(r'href="([^"]*?fileType=csv[^"]*)"', text)
    diagnostics.append({"attempt": "broad csv href scan", "matches_found": len(broad_matches), "sample": broad_matches[:5]})
    diagnostics.append(
        {
            "attempt": "substring presence",
            "has_IWM_holdings": "IWM_holdings" in text,
            "has_fileType_csv": "fileType=csv" in text,
        }
    )

    if broad_matches:
        href = broad_matches[0]
        return href if href.startswith("http") else "https://www.ishares.com" + href
    return None


def download_csv_text(diagnostics: list):
    session = requests.Session()
    discovered = discover_csv_url(diagnostics, session)

    attempts = [("known URL", KNOWN_CSV_URL)]
    if discovered:
        attempts.insert(0, ("discovered URL", discovered))

    for label, url in attempts:
        try:
            print(f"Trying {label}: {url}")
            resp = session.get(url, headers=CSV_HEADERS, timeout=60)
            snippet = resp.content[:300].decode("utf-8", errors="replace")
            diagnostics.append(
                {"attempt": label, "url": url, "status_code": resp.status_code, "content_type": resp.headers.get("Content-Type"), "body_snippet": snippet}
            )
            resp.raise_for_status()
            text = resp.content.decode("utf-8-sig", errors="replace")
            if "Ticker" in text and "Weight" in text:
                print(f"  -> got a plausible CSV via {label} ({len(text)} bytes)")
                return text
            print(f"  -> response didn't look like the holdings CSV (no 'Ticker'/'Weight' columns found)")
        except Exception as exc:  # noqa: BLE001
            print(f"  -> failed via {label}: {exc}")
            diagnostics.append({"attempt": label, "url": url, "error": str(exc)})
    return None


def find_header_row(lines):
    for i, line in enumerate(lines):
        cells = [c.strip().strip('"') for c in line.split(",")]
        if "Ticker" in cells and any("Weight" in c for c in cells):
            return i
    raise RuntimeError("Could not locate the holdings table header row in the CSV.")


def parse_holdings(csv_text: str):
    lines = csv_text.splitlines()
    header_idx = find_header_row(lines)
    reader = csv.DictReader(io.StringIO("\n".join(lines[header_idx:])))

    weight_col = next((c for c in reader.fieldnames if "Weight" in c), None)
    mv_col = next((c for c in reader.fieldnames if c.strip() == "Market Value"), None)
    name_col = next((c for c in reader.fieldnames if c.strip() == "Name"), None)
    sector_col = next((c for c in reader.fieldnames if c.strip() == "Sector"), None)
    asset_class_col = next((c for c in reader.fieldnames if "Asset Class" in c), None)

    holdings = []
    for row in reader:
        ticker = (row.get("Ticker") or "").strip()
        if not ticker:
            continue
        if asset_class_col and row.get(asset_class_col, "").strip().lower() not in ("equity", ""):
            continue
        if sector_col and "cash" in row.get(sector_col, "").strip().lower():
            continue

        def to_float(raw):
            if not raw:
                return None
            cleaned = raw.replace(",", "").replace("%", "").strip()
            try:
                return float(cleaned)
            except ValueError:
                return None

        market_value = to_float(row.get(mv_col)) if mv_col else None
        weight = to_float(row.get(weight_col)) if weight_col else None
        if market_value is None and weight is None:
            continue

        holdings.append(
            {
                "ticker": ticker.replace(".", "-").upper(),
                "name": (row.get(name_col) or "").strip() if name_col else "",
                "market_value": market_value,
                "weight_pct": weight,
            }
        )
    return holdings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--top", type=int, default=500)
    args = parser.parse_args()

    diagnostics: list = []
    debug_file = ROOT / "data" / "small_caps_debug.json"

    def write_debug(status: str, extra: dict | None = None):
        payload = {"status": status, "attempts": diagnostics}
        if extra:
            payload.update(extra)
        debug_file.parent.mkdir(parents=True, exist_ok=True)
        with open(debug_file, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    csv_text = download_csv_text(diagnostics)
    if not csv_text:
        print("Could not download IWM holdings CSV via any known method.")
        write_debug("download_failed")
        sys.exit(0)  # don't crash the job — leave the debug file for inspection

    try:
        holdings = parse_holdings(csv_text)
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to parse holdings CSV: {exc}")
        write_debug("parse_failed", {"error": str(exc), "csv_head": csv_text[:1000]})
        sys.exit(0)

    if not holdings:
        print("Parsed zero holdings — aborting without overwriting the existing universe file.")
        write_debug("zero_holdings_parsed", {"csv_head": csv_text[:1000]})
        sys.exit(0)

    # Rank by market value if available, else fall back to weight (both are
    # proxies for market cap within a single market-cap-weighted fund).
    holdings.sort(key=lambda h: (h["market_value"] if h["market_value"] is not None else h["weight_pct"] or 0), reverse=True)

    # De-duplicate tickers just in case (share classes etc. can repeat post-sanitization).
    seen = set()
    top = []
    for h in holdings:
        if h["ticker"] in seen:
            continue
        seen.add(h["ticker"])
        top.append(h)
        if len(top) >= args.top:
            break

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(
            {
                "source": "iShares IWM (Russell 2000 ETF) holdings, used as a free proxy for Russell 2000 membership/market cap ranking",
                "requested_top": args.top,
                "count": len(top),
                "holdings": top,
            },
            f,
            indent=2,
        )

    write_debug("ok", {"holdings_parsed": len(holdings), "top_written": len(top)})

    print(f"Wrote {len(top)} holdings to {OUT_FILE}")
    print("Top 10 by market value/weight:")
    for h in top[:10]:
        print(f"  {h['ticker']:8s} {h['name'][:40]:40s} mv={h['market_value']} weight={h['weight_pct']}")


if __name__ == "__main__":
    main()
