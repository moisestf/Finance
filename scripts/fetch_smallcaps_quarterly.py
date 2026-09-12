#!/usr/bin/env python3
"""
Fetch ~2 years of daily prices for every ticker in data/small_caps_universe.json,
collapse them into calendar-quarter closes, and compute quarter-over-quarter
% changes plus a couple of ranking stats. Writes data/small_caps_quarterly.json.

Uses yfinance's batched `download()` (threaded) instead of one Ticker() call
per symbol — with ~500 tickers this is dramatically faster and puts a lot
less load on Yahoo's endpoints than looping one-by-one.

Usage:
    python scripts/fetch_smallcaps_quarterly.py
"""
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
UNIVERSE_FILE = ROOT / "data" / "small_caps_universe.json"
OUT_FILE = ROOT / "data" / "small_caps_quarterly.json"

QUARTERS = 8
BATCH_SIZE = 60  # tickers per yf.download() call — keeps each request reasonably sized


def quarter_end(year: int, quarter_index0: int) -> date:
    """Last calendar day of the given quarter (0=Q1 ... 3=Q4)."""
    end_month = quarter_index0 * 3 + 3  # 3, 6, 9, 12
    if end_month == 12:
        return date(year, 12, 31)
    next_month_first = date(year, end_month + 1, 1)
    return next_month_first - timedelta(days=1)


def quarter_index(month: int) -> int:
    return (month - 1) // 3


def most_recent_completed_quarter_end(latest: date) -> date:
    q = quarter_index(latest.month)
    end = quarter_end(latest.year, q)
    if end > latest:
        q -= 1
        year = latest.year
        if q < 0:
            q = 3
            year -= 1
        end = quarter_end(year, q)
    return end


def quarter_ends_back(anchor: date, count: int):
    out = []
    y, q = anchor.year, quarter_index(anchor.month)
    for _ in range(count):
        out.append(quarter_end(y, q))
        q -= 1
        if q < 0:
            q = 3
            y -= 1
    return out


def quarter_label(d: date) -> str:
    return f"T{quarter_index(d.month) + 1} {d.year}"


def close_on_or_before(sorted_dates, close_by_date, target: date):
    # sorted_dates: ascending list of date objects with data
    result = None
    for d in sorted_dates:
        if d <= target:
            result = d
        else:
            break
    return close_by_date.get(result) if result is not None else None


def compute_quarterly_changes(dated_closes: dict) -> list:
    """dated_closes: {date: close}. Returns list of {label, pct}, newest first."""
    if not dated_closes:
        return []
    sorted_dates = sorted(dated_closes.keys())
    latest = sorted_dates[-1]
    anchor = most_recent_completed_quarter_end(latest)
    ends = quarter_ends_back(anchor, QUARTERS + 1)
    closes = [close_on_or_before(sorted_dates, dated_closes, e) for e in ends]

    out = []
    for i in range(QUARTERS):
        cur, prev = closes[i], closes[i + 1]
        pct = None
        if cur is not None and prev:
            pct = ((cur - prev) / prev) * 100
        out.append({"label": quarter_label(ends[i]), "pct": pct})
    return out


def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def main() -> None:
    if not UNIVERSE_FILE.exists():
        print(f"{UNIVERSE_FILE} not found — run fetch_russell2000_universe.py first.")
        sys.exit(1)

    with open(UNIVERSE_FILE, "r", encoding="utf-8") as f:
        universe = json.load(f)
    holdings = universe.get("holdings", [])
    tickers = [h["ticker"] for h in holdings]
    names = {h["ticker"]: h.get("name", "") for h in holdings}
    print(f"Universe: {len(tickers)} tickers")

    results = {}
    failed = []

    for batch_num, batch in enumerate(chunked(tickers, BATCH_SIZE), start=1):
        print(f"Batch {batch_num}: {len(batch)} tickers ({batch[0]}..{batch[-1]})")
        try:
            data = yf.download(
                tickers=batch,
                period="2y",
                interval="1d",
                group_by="ticker",
                auto_adjust=False,
                threads=True,
                progress=False,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  batch download failed entirely: {exc}")
            failed.extend(batch)
            continue

        for ticker in batch:
            try:
                if len(batch) == 1:
                    sub = data
                else:
                    if ticker not in data.columns.get_level_values(0):
                        failed.append(ticker)
                        continue
                    sub = data[ticker]

                closes = sub["Close"].dropna()
                if closes.empty:
                    failed.append(ticker)
                    continue

                dated_closes = {idx.date(): float(val) for idx, val in closes.items()}
                changes = compute_quarterly_changes(dated_closes)
                valid = [c["pct"] for c in changes if c["pct"] is not None]

                results[ticker] = {
                    "name": names.get(ticker, ""),
                    "quarters": changes,
                    "best_quarter_pct": max(valid) if valid else None,
                    "latest_quarter_pct": changes[0]["pct"] if changes else None,
                    "positive_quarters": sum(1 for v in valid if v > 0),
                    "valid_quarters": len(valid),
                }
            except Exception as exc:  # noqa: BLE001
                print(f"  [{ticker}] processing error: {exc}")
                failed.append(ticker)

        time.sleep(1)  # be gentle between batches

    print(f"Succeeded: {len(results)} / {len(tickers)}  (failed: {len(failed)})")
    if failed:
        print("Failed tickers:", ", ".join(failed[:50]), "..." if len(failed) > 50 else "")

    out = {
        "meta": {
            "last_updated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "universe_size": len(tickers),
            "succeeded": len(results),
            "failed": len(failed),
        },
        "tickers": results,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)

    print(f"Wrote {OUT_FILE}")


if __name__ == "__main__":
    main()
