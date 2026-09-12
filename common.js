// Shared between index.html (app.js) and watchlist.html (watchlist.js).
// Formatting helpers, date/period math, and the weekly/monthly/quarterly
// "change vs previous period" calculations used by both pages' heatmap tables.

const PALETTE = ["#6FA8DC", "#B4A7D6", "#45B8AC", "#E1A95F", "#D08DC4", "#8E97FD", "#59C3C3", "#F28B82"];

const colorFor = (index) => PALETTE[index % PALETTE.length];

const fmtMoney = (v) => (v === null || v === undefined ? "—" : `$${v.toFixed(2)}`);

const fmtPct = (v) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
};

const changeClass = (v) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "flat";
  if (v > 0.0001) return "up";
  if (v < -0.0001) return "down";
  return "flat";
};

function allDates(tickers, series) {
  const set = new Set();
  tickers.forEach((t) => (series[t] || []).forEach((r) => set.add(r.date)));
  return Array.from(set).sort();
}

function seriesMap(records) {
  const m = new Map();
  (records || []).forEach((r) => m.set(r.date, r));
  return m;
}

function dayChange(records) {
  if (!records || records.length < 2) return { abs: null, pct: null };
  const last = records[records.length - 1];
  const prev = records[records.length - 2];
  const abs = last.close - prev.close;
  return { abs, pct: (abs / prev.close) * 100 };
}

function sinceStartChange(records) {
  if (!records || records.length < 2) return null;
  const first = records[0];
  const last = records[records.length - 1];
  return ((last.close - first.close) / first.close) * 100;
}

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

// Last record with date <= targetISO. `records` must be sorted ascending by date.
function closeOnOrBefore(records, targetISO) {
  let result = null;
  for (const r of records) {
    if (r.date <= targetISO) result = r;
    else break;
  }
  return result;
}

function heatColor(pct) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "transparent";
  const capped = Math.max(-10, Math.min(10, pct));
  const alpha = 0.12 + (Math.abs(capped) / 10) * 0.55;
  const rgb = capped >= 0 ? "79,174,122" : "214,96,77";
  return `rgba(${rgb}, ${alpha.toFixed(2)})`;
}

// Renders a period-over-period heatmap table into <thead id=headId> / <tbody> matching bodySelector.
// perTickerRows[tickerIndex][row] = { label or date, pct } — same shape produced by
// weeklyChanges / monthlyChanges / quarterlyChanges below.
function renderHeatTable(headId, bodySelector, periodColumnLabel, tickers, perTickerRows, rowCount) {
  const head = document.getElementById(headId);
  head.innerHTML = `<th>${periodColumnLabel}</th>${tickers.map((t) => `<th class="num">${t}</th>`).join("")}`;

  const tbody = document.querySelector(bodySelector);
  tbody.innerHTML = "";
  for (let row = 0; row < rowCount; row++) {
    const tr = document.createElement("tr");
    const first = perTickerRows[0] && perTickerRows[0][row];
    const label = first ? first.date || first.label : "";
    let cells = `<td>${label}</td>`;
    tickers.forEach((t, ti) => {
      const entry = perTickerRows[ti][row];
      const pct = entry ? entry.pct : null;
      cells += `<td class="heat" style="background:${heatColor(pct)}">${fmtPct(pct)}</td>`;
    });
    tr.innerHTML = cells;
    tbody.appendChild(tr);
  }
}

// ---------- Weekly (Friday-over-Friday) ----------

// Most recent Friday on/before `d` (if `d` is itself a Friday, returns `d`).
function mostRecentFriday(d) {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = copy.getUTCDay(); // 0=Sun ... 5=Fri ... 6=Sat
  const diff = (day - 5 + 7) % 7;
  copy.setUTCDate(copy.getUTCDate() - diff);
  return copy;
}

// `count` Friday dates, weekly apart, newest first, ending at (and including) `anchor`.
function fridaysBack(anchor, count) {
  const dates = [];
  const d = new Date(anchor);
  for (let i = 0; i < count; i++) {
    dates.push(new Date(d));
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return dates;
}

/**
 * For a ticker's records, return the last `weeks` week-over-week % changes,
 * one per Friday, newest first: [{ date, pct }, ...]
 * `pct` is null if there isn't enough history to compute that week yet.
 */
function weeklyChanges(records, anchorDate, weeks) {
  if (!records || records.length === 0) return [];
  const fridays = fridaysBack(anchorDate, weeks + 1); // need one extra to diff against
  const closes = fridays.map((f) => closeOnOrBefore(records, toISO(f)));

  const out = [];
  for (let i = 0; i < weeks; i++) {
    const current = closes[i];
    const previous = closes[i + 1];
    let pct = null;
    if (current && previous && previous.close) {
      pct = ((current.close - previous.close) / previous.close) * 100;
    }
    out.push({ date: toISO(fridays[i]), pct });
  }
  return out;
}

// ---------- Monthly (month-over-month) ----------

const MONTH_LABELS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function lastDayOfMonth(year, monthIndex0) {
  // Day 0 of the following month == last day of this month.
  return new Date(Date.UTC(year, monthIndex0 + 1, 0));
}

// Last day of the most recent month that's already fully elapsed as of `latestDate`.
function mostRecentCompletedMonthEnd(latestDate) {
  let y = latestDate.getUTCFullYear();
  let m = latestDate.getUTCMonth();
  let end = lastDayOfMonth(y, m);
  if (end > latestDate) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    end = lastDayOfMonth(y, m);
  }
  return end;
}

// `count` month-end dates, going backward one month at a time, newest first, starting at `anchorEnd`.
function monthEndsBack(anchorEnd, count) {
  const dates = [];
  let y = anchorEnd.getUTCFullYear();
  let m = anchorEnd.getUTCMonth();
  for (let i = 0; i < count; i++) {
    dates.push(lastDayOfMonth(y, m));
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return dates;
}

function monthLabel(d) {
  return `${MONTH_LABELS_ES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * For a ticker's records, return the last `months` month-over-month % changes,
 * one per month (using each month's last trading day), newest first:
 * [{ label, pct }, ...]. `pct` is null if there isn't enough history yet.
 */
function monthlyChanges(records, anchorEnd, months) {
  if (!records || records.length === 0) return [];
  const ends = monthEndsBack(anchorEnd, months + 1); // one extra to diff against
  const closes = ends.map((e) => closeOnOrBefore(records, toISO(e)));

  const out = [];
  for (let i = 0; i < months; i++) {
    const current = closes[i];
    const previous = closes[i + 1];
    let pct = null;
    if (current && previous && previous.close) {
      pct = ((current.close - previous.close) / previous.close) * 100;
    }
    out.push({ label: monthLabel(ends[i]), pct });
  }
  return out;
}

// ---------- Quarterly (quarter-over-quarter) ----------

// Quarter end months (0-indexed): Q1->Mar(2), Q2->Jun(5), Q3->Sep(8), Q4->Dec(11).
function lastDayOfQuarter(year, quarterIndex0to3) {
  const endMonth = quarterIndex0to3 * 3 + 2;
  return lastDayOfMonth(year, endMonth);
}

function quarterOf(monthIndex0) {
  return Math.floor(monthIndex0 / 3);
}

// Last day of the most recent quarter that's already fully elapsed as of `latestDate`.
function mostRecentCompletedQuarterEnd(latestDate) {
  let y = latestDate.getUTCFullYear();
  let q = quarterOf(latestDate.getUTCMonth());
  let end = lastDayOfQuarter(y, q);
  if (end > latestDate) {
    q -= 1;
    if (q < 0) {
      q = 3;
      y -= 1;
    }
    end = lastDayOfQuarter(y, q);
  }
  return end;
}

// `count` quarter-end dates, going backward one quarter at a time, newest first.
function quarterEndsBack(anchorEnd, count) {
  const dates = [];
  let y = anchorEnd.getUTCFullYear();
  let q = quarterOf(anchorEnd.getUTCMonth());
  for (let i = 0; i < count; i++) {
    dates.push(lastDayOfQuarter(y, q));
    q -= 1;
    if (q < 0) {
      q = 3;
      y -= 1;
    }
  }
  return dates;
}

function quarterLabel(d) {
  const q = quarterOf(d.getUTCMonth()) + 1;
  return `T${q} ${d.getUTCFullYear()}`;
}

/**
 * For a ticker's records, return the last `quarters` quarter-over-quarter %
 * changes, one per quarter (using each quarter's last trading day), newest
 * first: [{ label, pct }, ...]. `pct` is null if there isn't enough history yet.
 */
function quarterlyChanges(records, anchorEnd, quarters) {
  if (!records || records.length === 0) return [];
  const ends = quarterEndsBack(anchorEnd, quarters + 1); // one extra to diff against
  const closes = ends.map((e) => closeOnOrBefore(records, toISO(e)));

  const out = [];
  for (let i = 0; i < quarters; i++) {
    const current = closes[i];
    const previous = closes[i + 1];
    let pct = null;
    if (current && previous && previous.close) {
      pct = ((current.close - previous.close) / previous.close) * 100;
    }
    out.push({ label: quarterLabel(ends[i]), pct });
  }
  return out;
}
