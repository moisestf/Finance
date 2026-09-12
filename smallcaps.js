// smallcaps.html-specific rendering. Data here is precomputed server-side
// (quarterly % changes + ranking stats) by scripts/fetch_smallcaps_quarterly.py,
// so this file only needs to sort, filter, and paint the table.

const smallCapsState = { sortMode: "best", filterText: "" };

async function loadSmallCapsData() {
  const res = await fetch("data/small_caps_quarterly.json", { cache: "no-store" });
  return res.json();
}

function getSortedRows(tickersMap) {
  const rows = Object.entries(tickersMap).map(([ticker, info]) => ({ ticker, ...info }));
  const key = smallCapsState.sortMode === "best" ? "best_quarter_pct" : "positive_quarters";
  rows.sort((a, b) => {
    const av = a[key] === null || a[key] === undefined ? -Infinity : a[key];
    const bv = b[key] === null || b[key] === undefined ? -Infinity : b[key];
    return bv - av;
  });
  return rows;
}

function renderSmallCapsTable(data) {
  const tickersMap = data.tickers || {};
  let rows = getSortedRows(tickersMap);

  const filter = smallCapsState.filterText.trim().toUpperCase();
  if (filter) {
    rows = rows.filter((r) => r.ticker.includes(filter) || (r.name || "").toUpperCase().includes(filter));
  }

  // Column headers: reuse the quarter labels from whichever row has the most entries.
  const reference = rows.reduce((best, r) => ((r.quarters || []).length > (best ? best.quarters.length : -1) ? r : best), null);
  const quarterLabels = reference ? reference.quarters.map((q) => q.label) : [];

  const head = document.getElementById("smallcaps-table-head");
  head.innerHTML =
    `<th>#</th><th>Ticker</th><th>Empresa</th><th class="num">Mejor trim.</th><th class="num">Trim. +</th>` +
    quarterLabels.map((l) => `<th class="num">${l}</th>`).join("");

  const bodyHtml = rows
    .map((r, i) => {
      const cells = (r.quarters || [])
        .map((q) => `<td class="heat" style="background:${heatColor(q.pct)}">${fmtPct(q.pct)}</td>`)
        .join("");
      const validCount = r.valid_quarters ?? (r.quarters || []).filter((q) => q.pct !== null).length;
      return `<tr>
        <td>${i + 1}</td>
        <td>${r.ticker}</td>
        <td class="company-name" title="${(r.name || "").replace(/"/g, "&quot;")}">${r.name || ""}</td>
        <td class="num ${changeClass(r.best_quarter_pct)}">${fmtPct(r.best_quarter_pct)}</td>
        <td class="num">${r.positive_quarters ?? "—"}/${validCount}</td>
        ${cells}
      </tr>`;
    })
    .join("");

  document.querySelector("#smallcaps-table tbody").innerHTML = bodyHtml;
  document.getElementById("smallcaps-count").textContent = `${rows.length} tickers`;
}

function wireSmallCapsControls(data) {
  const bestBtn = document.getElementById("sort-best");
  const positiveBtn = document.getElementById("sort-positive");

  bestBtn.addEventListener("click", () => {
    smallCapsState.sortMode = "best";
    bestBtn.classList.add("is-active");
    positiveBtn.classList.remove("is-active");
    renderSmallCapsTable(data);
  });

  positiveBtn.addEventListener("click", () => {
    smallCapsState.sortMode = "positive";
    positiveBtn.classList.add("is-active");
    bestBtn.classList.remove("is-active");
    renderSmallCapsTable(data);
  });

  document.getElementById("ticker-filter").addEventListener("input", (e) => {
    smallCapsState.filterText = e.target.value;
    renderSmallCapsTable(data);
  });
}

async function init() {
  try {
    const data = await loadSmallCapsData();
    const meta = data.meta || {};

    const updatedEl = document.getElementById("updated-at");
    updatedEl.textContent = meta.last_updated_utc
      ? `actualizado: ${new Date(meta.last_updated_utc).toLocaleString("es")} · ${meta.succeeded ?? "?"}/${meta.universe_size ?? "?"} con datos`
      : "aún sin datos — corre el workflow por primera vez";

    renderSmallCapsTable(data);
    wireSmallCapsControls(data);
  } catch (err) {
    console.error(err);
    document.getElementById("updated-at").textContent = "error cargando datos";
  }
}

// init() is called from auth.js once the user is authenticated.
