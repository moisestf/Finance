// watchlist.html-specific rendering. Uses the same shared helpers as
// app.js (see common.js) but loads its own, independent ticker list and
// price history.

async function loadWatchlistData() {
  const [tickersRes, pricesRes] = await Promise.all([
    fetch("data/watchlist_tickers.json", { cache: "no-store" }),
    fetch("data/watchlist_prices.json", { cache: "no-store" }),
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

function renderQuarterlyTable(tickers, series) {
  const QUARTERS = 12;
  const latest = allDates(tickers, series).slice(-1)[0];
  const anchor = mostRecentCompletedQuarterEnd(latest ? new Date(latest + "T00:00:00Z") : new Date());
  const perTicker = tickers.map((t) => quarterlyChanges(series[t], anchor, QUARTERS));
  renderHeatTable("quarterly-table-head", "#quarterly-table tbody", "Trimestre", tickers, perTicker, QUARTERS);
}

function wireComparisonToggle() {
  const buttons = {
    monthly: document.getElementById("comparison-monthly"),
    weekly: document.getElementById("comparison-weekly"),
    quarterly: document.getElementById("comparison-quarterly"),
  };
  const panels = {
    monthly: document.getElementById("comparison-monthly-panel"),
    weekly: document.getElementById("comparison-weekly-panel"),
    quarterly: document.getElementById("comparison-quarterly-panel"),
  };

  Object.keys(buttons).forEach((key) => {
    buttons[key].addEventListener("click", () => {
      Object.keys(buttons).forEach((k) => {
        buttons[k].classList.toggle("is-active", k === key);
        panels[k].classList.toggle("is-hidden", k !== key);
      });
    });
  });
}

async function init() {
  try {
    const { tickers, series, meta } = await loadWatchlistData();

    const updatedEl = document.getElementById("updated-at");
    updatedEl.textContent = meta.last_updated_utc
      ? `actualizado: ${new Date(meta.last_updated_utc).toLocaleString("es")}`
      : "aún sin datos — corre el workflow por primera vez";

    renderTickerStrip(tickers, series);
    renderWeeklyTable(tickers, series);
    renderMonthlyTable(tickers, series);
    renderQuarterlyTable(tickers, series);
    wireComparisonToggle();
  } catch (err) {
    console.error(err);
    document.getElementById("updated-at").textContent = "error cargando datos";
  }
}

// init() is called from auth.js once the user is authenticated.
