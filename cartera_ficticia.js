// cartera_ficticia.html-specific logic. Reuses price history already
// fetched for the other pages (data/prices.json + data/watchlist_prices.json)
// plus a small static config of purchase lots (data/portfolio_lots.json).
//
// Model: each position can have one or more lots (date, price_usd, weight_pct).
// weight_pct is treated as a unit count, so a position's total "units" and
// "invested capital" grow at each lot date. This means a position's return
// trajectory before all its lots are bought correctly reflects only the
// capital committed so far — not a return on the final, fully-built position.

const periodState = { mode: "monthly" };

async function loadPortfolioData() {
  const [mainRes, wlRes, lotsRes] = await Promise.all([
    fetch("data/prices.json", { cache: "no-store" }),
    fetch("data/watchlist_prices.json", { cache: "no-store" }),
    fetch("data/portfolio_lots.json", { cache: "no-store" }),
  ]);
  const mainData = await mainRes.json();
  const wlData = await wlRes.json();
  const lotsData = await lotsRes.json();
  const series = { ...(mainData.series || {}), ...(wlData.series || {}) };
  const metas = [mainData.meta, wlData.meta].filter(Boolean);
  return { series, positions: lotsData.positions, metas };
}

function firstPurchaseDate(position) {
  return position.lots.reduce((min, l) => (l.date < min ? l.date : min), position.lots[0].date);
}

function unitsAndInvestedAt(lots, dateISO) {
  let units = 0;
  let invested = 0;
  for (const lot of lots) {
    if (lot.date <= dateISO) {
      units += lot.weight_pct;
      invested += lot.weight_pct * lot.price_usd;
    }
  }
  return { units, invested };
}

// Total return since purchase (weighted-average cost basis across all lots).
// Used only for the headline ticker-strip cards, not the period table.
function totalReturnAt(records, lots, dateISO) {
  const rec = closeOnOrBefore(records, dateISO);
  if (!rec) return null;
  const { units, invested } = unitsAndInvestedAt(lots, dateISO);
  if (units <= 0 || invested <= 0) return null;
  const value = units * rec.close;
  return ((value - invested) / invested) * 100;
}

function extendOnePeriodEarlier(dateObj, mode) {
  const d = new Date(dateObj);
  if (mode === "monthly") {
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth() - 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    return lastDayOfMonth(y, m);
  }
  let y = d.getUTCFullYear();
  let q = quarterOf(d.getUTCMonth()) - 1;
  if (q < 0) {
    q = 3;
    y -= 1;
  }
  return lastDayOfQuarter(y, q);
}

function buildPeriodDates(earliestFirstISO, latestISO, mode) {
  const base = mode === "monthly" ? monthsRange(earliestFirstISO, latestISO) : quartersRange(earliestFirstISO, latestISO);
  const oldest = base[base.length - 1];
  const extraReference = extendOnePeriodEarlier(oldest, mode);
  return [...base, extraReference]; // last entry exists only to give the oldest row a "previous period"
}

function earliestLot(lots) {
  return lots.reduce((a, b) => (a.date < b.date ? a : b));
}

// Return % change vs the previous period — except for a position's first
// active period, where there is no meaningful "previous period" (the user
// didn't own it yet), so that one row is measured from the purchase price
// of the earliest lot instead.
function periodReturnForPosition(records, lots, periodEndDate, previousPeriodEndDate) {
  const periodEndISO = toISO(periodEndDate);
  const firstLotDate = earliestLot(lots).date;
  if (firstLotDate > periodEndISO) return null; // position didn't exist yet by this period's end

  const endRec = closeOnOrBefore(records, periodEndISO);
  if (!endRec) return null;

  const previousISO = previousPeriodEndDate ? toISO(previousPeriodEndDate) : null;
  const existedAtPreviousEnd = previousISO && firstLotDate <= previousISO;

  if (existedAtPreviousEnd) {
    const prevRec = closeOnOrBefore(records, previousISO);
    if (!prevRec) return null;
    return ((endRec.close - prevRec.close) / prevRec.close) * 100;
  }

  const basisPrice = earliestLot(lots).price_usd;
  return ((endRec.close - basisPrice) / basisPrice) * 100;
}

function latestDataDate(series, positions) {
  let latest = null;
  positions.forEach((p) => {
    const records = series[p.ticker] || [];
    const last = records[records.length - 1];
    if (last && (!latest || last.date > latest)) latest = last.date;
  });
  return latest;
}

function monthsRange(firstISO, latestISO) {
  const latest = new Date(latestISO + "T00:00:00Z");
  const first = new Date(firstISO + "T00:00:00Z");
  const out = [];
  let y = latest.getUTCFullYear();
  let m = latest.getUTCMonth();
  const firstY = first.getUTCFullYear();
  const firstM = first.getUTCMonth();
  while (y > firstY || (y === firstY && m >= firstM)) {
    out.push(lastDayOfMonth(y, m));
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return out;
}

function quartersRange(firstISO, latestISO) {
  const latest = new Date(latestISO + "T00:00:00Z");
  const first = new Date(firstISO + "T00:00:00Z");
  const out = [];
  let y = latest.getUTCFullYear();
  let q = quarterOf(latest.getUTCMonth());
  const firstY = first.getUTCFullYear();
  const firstQ = quarterOf(first.getUTCMonth());
  while (y > firstY || (y === firstY && q >= firstQ)) {
    out.push(lastDayOfQuarter(y, q));
    q -= 1;
    if (q < 0) {
      q = 3;
      y -= 1;
    }
  }
  return out;
}

function renderTickerStrip(series, positions, latestISO) {
  const el = document.getElementById("ticker-strip");
  el.innerHTML = "";

  const totals = [];
  positions.forEach((p) => {
    const records = series[p.ticker] || [];
    const pct = totalReturnAt(records, p.lots, latestISO);
    if (pct !== null) totals.push(pct);

    const card = document.createElement("div");
    card.className = "ticker-card";
    card.innerHTML = `
      <span class="symbol">${p.ticker}</span>
      <span class="price">${pct === null ? "—" : fmtPct(pct)}</span>
      <span class="change ${changeClass(pct)}">desde ${firstPurchaseDate(p)}</span>
    `;
    el.appendChild(card);
  });

  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  const avgCard = document.createElement("div");
  avgCard.className = "ticker-card";
  avgCard.innerHTML = `
    <span class="symbol">Cartera (media)</span>
    <span class="price">${avg === null ? "—" : fmtPct(avg)}</span>
    <span class="change ${changeClass(avg)}">misma inversión en las 6</span>
  `;
  el.appendChild(avgCard);
}

function renderPeriodTable(series, positions, latestISO) {
  const earliestFirst = positions.reduce((min, p) => {
    const f = firstPurchaseDate(p);
    return !min || f < min ? f : min;
  }, null);

  const allDates = buildPeriodDates(earliestFirst, latestISO, periodState.mode);
  const displayDates = allDates.slice(0, -1); // last entry is only a reference point for the oldest row
  const labelFn = periodState.mode === "monthly" ? monthLabel : quarterLabel;

  const tickers = positions.map((p) => p.ticker);
  const perTicker = positions.map((p) => {
    const records = series[p.ticker] || [];
    return displayDates.map((d, i) => ({
      date: labelFn(d),
      pct: periodReturnForPosition(records, p.lots, d, allDates[i + 1]),
    }));
  });

  const periodColumnLabel = periodState.mode === "monthly" ? "Mes" : "Trimestre";
  renderHeatTable("period-table-head", "#period-table tbody", periodColumnLabel, tickers, perTicker, displayDates.length);
}

function wireToggle(series, positions, latestISO) {
  const monthlyBtn = document.getElementById("view-monthly");
  const quarterlyBtn = document.getElementById("view-quarterly");

  monthlyBtn.addEventListener("click", () => {
    periodState.mode = "monthly";
    monthlyBtn.classList.add("is-active");
    quarterlyBtn.classList.remove("is-active");
    renderPeriodTable(series, positions, latestISO);
  });

  quarterlyBtn.addEventListener("click", () => {
    periodState.mode = "quarterly";
    quarterlyBtn.classList.add("is-active");
    monthlyBtn.classList.remove("is-active");
    renderPeriodTable(series, positions, latestISO);
  });
}

async function init() {
  try {
    const { series, positions, metas } = await loadPortfolioData();
    const latestISO = latestDataDate(series, positions);

    const updatedEl = document.getElementById("updated-at");
    const mostRecentMeta = metas
      .map((m) => m.last_updated_utc)
      .filter(Boolean)
      .sort()
      .slice(-1)[0];
    updatedEl.textContent = mostRecentMeta ? `precios actualizados: ${new Date(mostRecentMeta).toLocaleString("es")}` : "aún sin datos";

    renderTickerStrip(series, positions, latestISO);
    renderPeriodTable(series, positions, latestISO);
    wireToggle(series, positions, latestISO);
  } catch (err) {
    console.error(err);
    document.getElementById("updated-at").textContent = "error cargando datos";
  }
}

// init() is called from auth.js once the user is authenticated.
