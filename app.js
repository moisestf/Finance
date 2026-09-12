// index.html-specific rendering: ticker strip, main chart, return chart,
// detail table, and the weekly/monthly comparison panel.
// Shared date-math and formatting helpers live in common.js.

const state = {
  mode: "absolute", // "absolute" | "normalized"
  mainChart: null,
  returnChart: null,
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

function renderWeeklyTable(tickers, series) {
  const WEEKS = 40;
  const latest = allDates(tickers, series).slice(-1)[0];
  const anchor = mostRecentFriday(latest ? new Date(latest + "T00:00:00Z") : new Date());
  const perTicker = tickers.map((t) => weeklyChanges(series[t], anchor, WEEKS));
  renderHeatTable("weekly-table-head", "#weekly-table tbody", "Viernes", tickers, perTicker, WEEKS);
}

function renderMonthlyTable(tickers, series) {
  const MONTHS = 24;
  const latest = allDates(tickers, series).slice(-1)[0];
  const anchor = mostRecentCompletedMonthEnd(latest ? new Date(latest + "T00:00:00Z") : new Date());
  const perTicker = tickers.map((t) => monthlyChanges(series[t], anchor, MONTHS));
  renderHeatTable("monthly-table-head", "#monthly-table tbody", "Mes", tickers, perTicker, MONTHS);
}

function wireComparisonToggle() {
  const monthlyBtn = document.getElementById("comparison-monthly");
  const weeklyBtn = document.getElementById("comparison-weekly");
  const monthlyPanel = document.getElementById("comparison-monthly-panel");
  const weeklyPanel = document.getElementById("comparison-weekly-panel");

  monthlyBtn.addEventListener("click", () => {
    monthlyBtn.classList.add("is-active");
    weeklyBtn.classList.remove("is-active");
    monthlyPanel.classList.remove("is-hidden");
    weeklyPanel.classList.add("is-hidden");
  });

  weeklyBtn.addEventListener("click", () => {
    weeklyBtn.classList.add("is-active");
    monthlyBtn.classList.remove("is-active");
    weeklyPanel.classList.remove("is-hidden");
    monthlyPanel.classList.add("is-hidden");
  });
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
    renderMonthlyTable(tickers, series);
    wireToggle(tickers, series);
    wireComparisonToggle();
  } catch (err) {
    console.error(err);
    document.getElementById("updated-at").textContent = "error cargando datos";
  }
}

// init() is now called from auth.js once the user is authenticated,
// not automatically here.
