const AUTH_SESSION_KEY = "stock_ledger_auth_ok";

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2Hex(password, saltHex, iterations, outputBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = hexToBytes(saltHex);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    outputBytes * 8
  );
  return bytesToHex(new Uint8Array(bits));
}

async function checkCredentials(username, password) {
  const res = await fetch("data/auth.json", { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo leer data/auth.json");
  const auth = await res.json();

  const user = (auth.users || []).find((u) => u.username === username);
  if (!user) return false;

  const outputBytes = user.hash.length / 2;
  const computed = await pbkdf2Hex(password, user.salt, auth.iterations, outputBytes);

  // Comparación en tiempo constante para no filtrar información por timing.
  if (computed.length !== user.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ user.hash.charCodeAt(i);
  }
  return diff === 0;
}

const AUTH_LOG_KEY = "stock_ledger_auth_log_v1";
const AUTH_LOG_MAX_ENTRIES = 300;

async function fetchPublicIp() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://api.ipify.org?format=json", { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return data.ip || null;
  } catch (err) {
    return null; // network blocked, offline, or the IP service is unreachable — fail silently
  }
}

function readAuthLog() {
  try {
    const raw = localStorage.getItem(AUTH_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

function writeAuthLog(entries) {
  try {
    localStorage.setItem(AUTH_LOG_KEY, JSON.stringify(entries.slice(-AUTH_LOG_MAX_ENTRIES)));
  } catch (err) {
    console.error("No se pudo guardar el registro de accesos:", err);
  }
}

function recordAuthEvent(username, success) {
  const entry = {
    timestamp: new Date().toISOString(),
    username: username || "(vacío)",
    success,
    ip: "cargando…",
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${screen.width}x${screen.height}`,
    page: location.pathname.split("/").pop() || "index.html",
  };

  const entries = readAuthLog();
  entries.push(entry);
  writeAuthLog(entries);

  // Patch in the public IP once it resolves, without delaying login/render.
  fetchPublicIp().then((ip) => {
    const current = readAuthLog();
    const match = current.find((e) => e.timestamp === entry.timestamp && e.username === entry.username);
    if (match) {
      match.ip = ip || "no disponible";
      writeAuthLog(current);
    }
  });
}

function clearAuthLog() {
  localStorage.removeItem(AUTH_LOG_KEY);
}

function isAuthenticated() {
  return sessionStorage.getItem(AUTH_SESSION_KEY) === "1";
}

function setAuthenticated() {
  sessionStorage.setItem(AUTH_SESSION_KEY, "1");
}

function clearAuthenticated() {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
}

function showDashboard() {
  document.getElementById("login-screen").classList.add("is-hidden");
  document.getElementById("app-main").classList.remove("is-hidden");
  document.getElementById("logout-btn").classList.remove("is-hidden");
  if (typeof init === "function") init();
}

function showLogin(message) {
  document.getElementById("login-screen").classList.remove("is-hidden");
  document.getElementById("app-main").classList.add("is-hidden");
  document.getElementById("logout-btn").classList.add("is-hidden");
  const errEl = document.getElementById("login-error");
  errEl.textContent = message || "";
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  const btn = document.getElementById("login-submit");

  errEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Verificando…";

  try {
    const ok = await checkCredentials(username, password);
    recordAuthEvent(username, ok); // fire-and-forget; never logs the password itself
    if (ok) {
      setAuthenticated();
      showDashboard();
    } else {
      errEl.textContent = "Usuario o contraseña incorrectos.";
    }
  } catch (err) {
    console.error(err);
    errEl.textContent = "Error verificando credenciales.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
}

function handleLogout() {
  clearAuthenticated();
  showLogin();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("login-form").addEventListener("submit", handleLoginSubmit);
  document.getElementById("logout-btn").addEventListener("click", handleLogout);

  if (isAuthenticated()) {
    showDashboard();
  } else {
    showLogin();
  }
});
