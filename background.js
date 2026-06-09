// background.js — shared popup wiring + ACG state cookie fallback watchdog
// v1.86 uses ACG's zip-only flow first. The watchdog waits briefly before
// falling back to direct cookie repair so the official zip lookup can win.

const ACG_STATE_KEEPER_KEY = "acgStateKeeper";
const VALID_STATE = /^[A-Z]{2}$/;
const VALID_ZIP_COOKIE = /^[0-9]{5}\|AAA\|[0-9]+\|(PC|SP|TB)$/;
const WATCHED_NAMES = new Set(["AEM.state", "zipcode", "_lr_geo_location_state", "_lr_geo_location"]);
const ACG_COOKIE_URL = "https://www.acg.aaa.com/";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function clean(value) {
  return String(value ?? "").replace(/[;\r\n]/g, "").trim();
}

function normalizePayload(payload) {
  const stateCode = clean(payload?.stateCode).toUpperCase();
  const zipcodeValue = clean(payload?.zipcodeValue);
  const countryValue = clean(payload?.countryValue || "US").toUpperCase();
  const expiresAt = Number(payload?.expiresAt || 0);
  const deferUntil = Number(payload?.deferUntil || 0);
  const mode = clean(payload?.mode || "zipgate");

  if (!VALID_STATE.test(stateCode)) return null;
  if (!VALID_ZIP_COOKIE.test(zipcodeValue)) return null;
  if (expiresAt && Date.now() > expiresAt) return null;

  return { ...payload, stateCode, zipcodeValue, countryValue, expiresAt, deferUntil, mode };
}

async function getPayload() {
  try {
    const result = await chrome.storage.local.get([ACG_STATE_KEEPER_KEY]);
    return normalizePayload(result?.[ACG_STATE_KEEPER_KEY]);
  } catch {
    return null;
  }
}

function plainDomainCookie(name, value) {
  return {
    url: ACG_COOKIE_URL,
    domain: ".aaa.com",
    name,
    value: clean(value),
    path: "/",
    secure: false,
    expirationDate: Math.floor(Date.now() / 1000) + ONE_YEAR_SECONDS
  };
}

function secureDomainCookie(name, value) {
  return {
    url: ACG_COOKIE_URL,
    domain: ".aaa.com",
    name,
    value: clean(value),
    path: "/",
    secure: true,
    sameSite: "no_restriction",
    expirationDate: Math.floor(Date.now() / 1000) + ONE_YEAR_SECONDS
  };
}

function secureHostCookie(url, name, value) {
  return {
    url,
    name,
    value: clean(value),
    path: "/",
    secure: true,
    sameSite: "no_restriction",
    expirationDate: Math.floor(Date.now() / 1000) + ONE_YEAR_SECONDS
  };
}

let repairInFlight = false;

async function repairStateCookies(reason = "watchdog") {
  const payload = await getPayload();
  if (!payload) return;

  // During the first part of the switch, let ACG's real zip lookup set cookies.
  // After deferUntil, use direct cookies as a safety net.
  if (payload.mode === "zipgate" && Date.now() < Number(payload.deferUntil || 0)) return;

  if (repairInFlight) return;
  repairInFlight = true;

  const writes = [
    plainDomainCookie("AEM.state", payload.stateCode),
    plainDomainCookie("zipcode", payload.zipcodeValue),
    secureDomainCookie("_lr_geo_location_state", payload.stateCode),
    secureDomainCookie("_lr_geo_location", payload.countryValue),
    secureHostCookie("https://www.acg.aaa.com/", "_lr_geo_location_state", payload.stateCode),
    secureHostCookie("https://acg.aaa.com/", "_lr_geo_location_state", payload.stateCode),
    secureHostCookie("https://www.acg.aaa.com/", "_lr_geo_location", payload.countryValue),
    secureHostCookie("https://acg.aaa.com/", "_lr_geo_location", payload.countryValue)
  ];

  try {
    await Promise.allSettled(writes.map(details => chrome.cookies.set(details)));
  } finally {
    repairInFlight = false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "ENSURE_TOP_INJECT") {
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg.type === "ACG_REPAIR_STATE_COOKIES") {
    repairStateCookies("message").then(() => sendResponse?.({ ok: true }));
    return true;
  }
});

function cookieMatchesPayload(cookie, payload) {
  if (!cookie || !payload) return false;
  const value = clean(cookie.value);
  if (cookie.name === "AEM.state") return value.toUpperCase() === payload.stateCode;
  if (cookie.name === "zipcode") return value === payload.zipcodeValue;
  if (cookie.name === "_lr_geo_location_state") return value.toUpperCase() === payload.stateCode;
  if (cookie.name === "_lr_geo_location") return value.toUpperCase() === payload.countryValue;
  return false;
}

chrome.cookies.onChanged.addListener((changeInfo) => {
  const cookie = changeInfo?.cookie;
  if (!cookie || !WATCHED_NAMES.has(cookie.name)) return;

  const domain = String(cookie.domain || "").toLowerCase();
  if (!domain.endsWith("aaa.com")) return;

  setTimeout(async () => {
    const payload = await getPayload();
    if (!payload) return;
    if (!changeInfo.removed && cookieMatchesPayload(cookie, payload)) return;
    await repairStateCookies(`cookie:${cookie.name}`);
  }, 25);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[ACG_STATE_KEEPER_KEY]?.newValue) return;
  setTimeout(() => repairStateCookies("storage"), 25);
});
