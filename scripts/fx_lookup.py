#!/usr/bin/env python3
"""
Look up the historical EURUSD=X closing rate on/before a set of dates.
Used once to convert EUR-denominated purchase prices (e.g. a European
broker quoting Alphabet in euros) into USD, so they're comparable with the
USD price history already tracked for that ticker.

Usage:
    python scripts/fx_lookup.py 2024-07-29 2024-02-01
"""
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
DEBUG_FILE = ROOT / "data" / "fx_debug.json"


def rate_on_or_before(date_str: str):
    target = datetime.strptime(date_str, "%Y-%m-%d")
    start = target - timedelta(days=10)
    end = target + timedelta(days=2)
    hist = yf.Ticker("EURUSD=X").history(start=start.strftime("%Y-%m-%d"), end=end.strftime("%Y-%m-%d"), interval="1d")
    if hist.empty:
        return None
    hist = hist[hist.index.tz_localize(None) <= target] if hist.index.tz is not None else hist[hist.index <= target]
    if hist.empty:
        return None
    last = hist.iloc[-1]
    return {"date_used": str(hist.index[-1].date()), "close": float(last["Close"])}


def main():
    dates = sys.argv[1:]
    results = {}
    for d in dates:
        try:
            results[d] = rate_on_or_before(d)
        except Exception as exc:  # noqa: BLE001
            results[d] = {"error": str(exc)}
    DEBUG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DEBUG_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
