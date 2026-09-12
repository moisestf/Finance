#!/usr/bin/env python3
"""
Fetch daily closing prices for the tickers listed in a tickers file and
merge them into the corresponding prices file.

Designed to run inside GitHub Actions (which has normal internet access),
but also works locally: `pip install -r requirements.txt && python scripts/fetch_prices.py`

By default this updates the main dashboard's data (data/tickers.json ->
data/prices.json). Pass --tickers-file/--prices-file to update a different
pair, e.g. the independent watchlist page:

    python scripts/fetch_prices.py \\
        --tickers-file data/watchlist_tickers.json \\
        --prices-file data/watchlist_prices.json

Behaviour:
- For a ticker that already has history stored, only pulls the last 7 days
  (cheap, catches up on anything missed).
- For a brand-new ticker (just added to the tickers file), pulls 2 years of
  history so charts aren't empty on day one.
- Merges by date (existing days are overwritten with fresher data, nothing
  is ever duplicated), then writes the file back out, sorted by date.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent

BACKFILL_PERIOD = "2y"
REFRESH_PERIOD = "7d"


def load_json(path: Path, default):
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, sort_keys=True)


def fetch_history(ticker: str, period: str):
    hist = yf.Ticker(ticker).history(period=period, interval="1d", auto_adjust=False)
    records = []
    for idx, row in hist.iterrows():
        close = row.get("Close")
        if close is None or close != close:  # NaN check
            continue
        volume = row.get("Volume")
        records.append(
            {
                "date": idx.strftime("%Y-%m-%d"),
                "close": round(float(close), 4),
                "volume": int(volume) if volume == volume else None,
            }
        )
    return records


def merge_history(existing, new_records):
    by_date = {r["date"]: r for r in existing}
    for r in new_records:
        by_date[r["date"]] = r
    return sorted(by_date.values(), key=lambda r: r["date"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tickers-file", default=str(ROOT / "data" / "tickers.json"))
    parser.add_argument("--prices-file", default=str(ROOT / "data" / "prices.json"))
    args = parser.parse_args()

    tickers_file = Path(args.tickers_file)
    prices_file = Path(args.prices_file)

    tickers = load_json(tickers_file, [])
    if not tickers:
        print(f"{tickers_file} is empty — nothing to fetch.")
        sys.exit(0)

    store = load_json(prices_file, {"meta": {}, "series": {}})
    series = store.setdefault("series", {})

    any_success = False
    for ticker in tickers:
        is_new = not series.get(ticker)
        period = BACKFILL_PERIOD if is_new else REFRESH_PERIOD
        print(f"[{ticker}] fetching period={period} (new ticker: {is_new})")
        try:
            records = fetch_history(ticker, period)
        except Exception as exc:  # noqa: BLE001 - keep the job going for other tickers
            print(f"[{ticker}] ERROR: {exc}")
            continue

        if not records:
            print(f"[{ticker}] no data returned")
            continue

        series[ticker] = merge_history(series.get(ticker, []), records)
        any_success = True
        print(f"[{ticker}] stored {len(series[ticker])} trading days")

    store["meta"] = {
        "last_updated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tickers": tickers,
    }
    save_json(prices_file, store)

    if not any_success:
        print("No ticker was successfully updated this run.")
        sys.exit(1)

    print("Done.")


if __name__ == "__main__":
    main()
