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

  if (username !== auth.username) return false;

  const outputBytes = auth.hash.length / 2;
  const computed = await pbkdf2Hex(password, auth.salt, auth.iterations, outputBytes);

  // Comparación en tiempo constante para no filtrar información por timing.
  if (computed.length !== auth.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ auth.hash.charCodeAt(i);
  }
  return diff === 0;
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
