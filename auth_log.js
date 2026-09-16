// auth_log.html-specific rendering. Reads the login-attempt log that
// auth.js writes to localStorage (see recordAuthEvent / AUTH_LOG_KEY there).
// Purely local to this browser — see the warning panel on the page itself.

function renderAuthLog() {
  const entries = readAuthLog().slice().reverse(); // newest first
  const tbody = document.querySelector("#log-table tbody");
  tbody.innerHTML = entries
    .map((e) => {
      const when = new Date(e.timestamp).toLocaleString("es");
      const resultClass = e.success ? "up" : "down";
      const resultText = e.success ? "éxito" : "fallo";
      return `<tr>
        <td>${when}</td>
        <td>${e.username}</td>
        <td class="change ${resultClass}">${resultText}</td>
        <td>${e.ip}</td>
        <td>${e.timezone}</td>
        <td>${e.language}</td>
        <td>${e.screen}</td>
        <td class="company-name" title="${(e.userAgent || "").replace(/"/g, "&quot;")}">${e.userAgent}</td>
        <td>${e.page}</td>
      </tr>`;
    })
    .join("");

  document.getElementById("log-count").textContent = `${entries.length} intento(s) registrados en este navegador`;
  document.getElementById("updated-at").textContent = entries.length ? `último: ${new Date(entries[0].timestamp).toLocaleString("es")}` : "";
}

function wireClearButton() {
  document.getElementById("clear-log-btn").addEventListener("click", () => {
    if (confirm("¿Vaciar el registro de accesos de este navegador? No se puede deshacer.")) {
      clearAuthLog();
      renderAuthLog();
    }
  });
}

function init() {
  renderAuthLog();
  wireClearButton();
}

// init() is called from auth.js once the user is authenticated.
