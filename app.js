const PALETTE = ["#6FA8DC", "#B4A7D6", "#45B8AC", "#E1A95F", "#D08DC4", "#8E97FD", "#59C3C3", "#F28B82"];

const state = {
  mode: "absolute", // "absolute" | "normalized"
  mainChart: null,
  returnChart: null,
};

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

async function loadData() {
  const [tickersRes, pricesRes] = await Promise.all([
    fetch("data/tickers.json", { cache: "no-store" }),
    fetch("data/prices.json", { cache: "no-store" }),
  ]);
  const tickers = await tickersRes.json();
  const prices = await pricesRes.json();
  return { tickers, series: prices.series || {}, meta: prices.meta || {} };
}

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

function renderTickerStrip(tickers, series) {
  const el = document.getElementById("ticker-strip");
  el.innerHTML = "";
  tickers.forEach((t) => {
    const records = series[t] || [];
    const last = records[records.length - 1];
    const { pct } = dayChange(records);
    const card = document.createElement("div");
    card.className = "ticker-card";
    card.innerHTML = `
      <span class="symbol">${t}</span>
      <span class="price">${last ? fmtMoney(last.close) : "—"}</span>
      <span class="change ${changeClass(pct)}">${fmtPct(pct)}</span>
    `;
    el.appendChild(card);
  });
}

function renderTable(tickers, series) {
  const tbody = document.querySelector("#detail-table tbody");
  tbody.innerHTML = "";
  tickers.forEach((t) => {
    const records = series[t] || [];
    const last = records[records.length - 1];
    const { pct } = dayChange(records);
    const since = sinceStartChange(records);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t}</td>
      <td class="num">${last ? fmtMoney(last.close) : "—"}</td>
      <td class="num ${changeClass(pct)}">${fmtPct(pct)}</td>
      <td class="num ${changeClass(since)}">${fmtPct(since)}</td>
      <td>${last ? last.date : "—"}</td>
    `;
    tbody.appendChild(tr);
  });
}

function buildMainDatasets(tickers, series, dates, mode) {
  return tickers.map((t, i) => {
    const map = seriesMap(series[t]);
    let base = null;
    const data = dates.map((d) => {
      const rec = map.get(d);
      if (!rec) return null;
      if (mode === "absolute") return rec.close;
      if (base === null) base = rec.close;
      return ((rec.close - base) / base) * 100;
    });
    return {
      label: t,
      data,
      borderColor: colorFor(i),
      backgroundColor: colorFor(i),
      spanGaps: true,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.15,
    };
  });
}

function renderMainChart(tickers, series, mode) {
  const dates = allDates(tickers, series);
  const datasets = buildMainDatasets(tickers, series, dates, mode);
  const ctx = document.getElementById("main-chart");

  if (state.mainChart) state.mainChart.destroy();

  state.mainChart = new Chart(ctx, {
    type: "line",
    data: { labels: dates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#8b93a3", boxWidth: 12, font: { family: "IBM Plex Mono", size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: (item) => {
              const v = item.raw;
              if (v === null || v === undefined) return `${item.dataset.label}: —`;
              return mode === "absolute" ? `${item.dataset.label}: $${v.toFixed(2)}` : `${item.dataset.label}: ${v.toFixed(2)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#8b93a3", maxTicksLimit: 10, font: { family: "IBM Plex Mono", size: 10 } },
          grid: { color: "#262c39" },
        },
        y: {
          ticks: {
            color: "#8b93a3",
            font: { family: "IBM Plex Mono", size: 10 },
            callback: (v) => (mode === "absolute" ? `$${v}` : `${v}%`),
          },
          grid: { color: "#262c39" },
        },
      },
    },
  });
}

function renderReturnChart(tickers, series) {
  const rows = tickers
    .map((t, i) => ({ t, i, since: sinceStartChange(series[t]) }))
    .filter((r) => r.since !== null)
    .sort((a, b) => b.since - a.since);

  const ctx = document.getElementById("return-chart");
  if (state.returnChart) state.returnChart.destroy();

  state.returnChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rows.map((r) => r.t),
      datasets: [
        {
          label: "Retorno desde inicio de seguimiento",
          data: rows.map((r) => r.since),
          backgroundColor: rows.map((r) => (r.since >= 0 ? "#4fae7c" : "#d6604d")),
          borderRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => `${item.raw.toFixed(2)}%` } },
      },
      scales: {
        x: {
          ticks: { color: "#8b93a3", font: { family: "IBM Plex Mono", size: 10 }, callback: (v) => `${v}%` },
          grid: { color: "#262c39" },
        },
        y: {
          ticks: { color: "#e7e9ee", font: { family: "IBM Plex Mono", size: 12 } },
          grid: { display: false },
        },
      },
    },
  });
}

// ---------- Weekly (Friday-over-Friday) comparison ----------

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

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

// Last record with date <= targetISO. `records` must be sorted ascending by date.
function closeOnOrBefore(records, targetISO) {
  let result = null;
  for (const r of records) {
    if (r.date <= targetISO) result = r;
    else break;
  }
  return result;
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

function heatColor(pct) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "transparent";
  const capped = Math.max(-10, Math.min(10, pct));
  const alpha = 0.12 + (Math.abs(capped) / 10) * 0.55;
  const rgb = capped >= 0 ? "79,174,122" : "214,96,77";
  return `rgba(${rgb}, ${alpha.toFixed(2)})`;
}

function renderWeeklyTable(tickers, series) {
  const WEEKS = 40;

  // Anchor on the most recent date we actually have data for (not "today"),
  // so the table stays meaningful even if the site is opened on a weekend
  // or before the day's fetch has run.
  const latest = allDates(tickers, series).slice(-1)[0];
  const anchor = mostRecentFriday(latest ? new Date(latest + "T00:00:00Z") : new Date());

  const perTicker = tickers.map((t) => weeklyChanges(series[t], anchor, WEEKS));

  const head = document.getElementById("weekly-table-head");
  head.innerHTML = `<th>Viernes</th>${tickers.map((t) => `<th class="num">${t}</th>`).join("")}`;

  const tbody = document.querySelector("#weekly-table tbody");
  tbody.innerHTML = "";
  for (let row = 0; row < WEEKS; row++) {
    const tr = document.createElement("tr");
    const dateLabel = perTicker[0] && perTicker[0][row] ? perTicker[0][row].date : "";
    let cells = `<td>${dateLabel}</td>`;
    tickers.forEach((t, ti) => {
      const entry = perTicker[ti][row];
      const pct = entry ? entry.pct : null;
      cells += `<td class="heat" style="background:${heatColor(pct)}">${fmtPct(pct)}</td>`;
    });
    tr.innerHTML = cells;
    tbody.appendChild(tr);
  }
}

function wireToggle(tickers, series) {
  const absBtn = document.getElementById("view-absolute");
  const normBtn = document.getElementById("view-normalized");
  absBtn.addEventListener("click", () => {
    state.mode = "absolute";
    absBtn.classList.add("is-active");
    normBtn.classList.remove("is-active");
    renderMainChart(tickers, series, state.mode);
  });
  normBtn.addEventListener("click", () => {
    state.mode = "normalized";
    normBtn.classList.add("is-active");
    absBtn.classList.remove("is-active");
    renderMainChart(tickers, series, state.mode);
  });
}

async function init() {
  try {
    const { tickers, series, meta } = await loadData();

    const updatedEl = document.getElementById("updated-at");
    updatedEl.textContent = meta.last_updated_utc
      ? `actualizado: ${new Date(meta.last_updated_utc).toLocaleString("es")}`
      : "aún sin datos — corre el workflow por primera vez";

    renderTickerStrip(tickers, series);
    renderTable(tickers, series);
    renderMainChart(tickers, series, state.mode);
    renderReturnChart(tickers, series);
    renderWeeklyTable(tickers, series);
    wireToggle(tickers, series);
  } catch (err) {
    console.error(err);
    document.getElementById("updated-at").textContent = "error cargando datos";
  }
}

// init() is now called from auth.js once the user is authenticated,
// not automatically here.
