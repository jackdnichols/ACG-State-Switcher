// state-cookie-guard.js — main-world guard for ACG's new zip-only state flow.
// Runs at document_start in the page's JavaScript world, so it can intercept
// page scripts that try to repaint AEM.state/zipcode from a stale source.
(() => {
  "use strict";

  const STORAGE_KEY = "__acgStateSwitcherOverride";
  const VALID_STATE = /^[A-Z]{2}$/;
  const VALID_ZIP_COOKIE = /^[0-9]{5}\|AAA\|[0-9]+\|(PC|SP|TB)$/;

  function clean(value) {
    return String(value ?? "").replace(/[;\r\n]/g, "").trim();
  }

  function readPayload() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      const stateCode = clean(p.stateCode).toUpperCase();
      const zipcodeValue = clean(p.zipcodeValue);
      const zip = clean(p.zip || (zipcodeValue.split("|")[0] || ""));
      const countryValue = clean(p.countryValue || "US").toUpperCase();
      const expiresAt = Number(p.expiresAt || 0);
      if (!VALID_STATE.test(stateCode)) return null;
      if (!VALID_ZIP_COOKIE.test(zipcodeValue)) return null;
      if (!/^\d{5}$/.test(zip)) return null;
      if (expiresAt && Date.now() > expiresAt) {
        try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
        return null;
      }
      return { ...p, stateCode, zipcodeValue, zip, countryValue };
    } catch {
      return null;
    }
  }

  function cookieName(cookieString) {
    return clean(cookieString).split("=", 1)[0];
  }

  function cookieValue(cookieString) {
    const s = String(cookieString ?? "");
    const first = s.split(";", 1)[0];
    const idx = first.indexOf("=");
    return idx >= 0 ? first.slice(idx + 1) : "";
  }

  function replaceFirstPair(cookieString, value) {
    const s = String(cookieString ?? "");
    const semi = s.indexOf(";");
    const first = semi >= 0 ? s.slice(0, semi) : s;
    const rest = semi >= 0 ? s.slice(semi) : "";
    const eq = first.indexOf("=");
    if (eq < 0) return s;
    return first.slice(0, eq + 1) + value + rest;
  }

  function guardedCookieValue(raw) {
    const payload = readPayload();
    if (!payload) return raw;
    const name = cookieName(raw);
    if (!name) return raw;

    if (name === "AEM.state") {
      const incoming = clean(cookieValue(raw)).toUpperCase();
      if (incoming && incoming !== payload.stateCode) {
        return replaceFirstPair(raw, payload.stateCode);
      }
    }

    if (name === "zipcode") {
      const incoming = clean(cookieValue(raw));
      if (incoming && incoming !== payload.zipcodeValue) {
        return replaceFirstPair(raw, payload.zipcodeValue);
      }
    }

    if (name === "_lr_geo_location_state") {
      const incoming = clean(cookieValue(raw)).toUpperCase();
      if (incoming && incoming !== payload.stateCode) {
        return replaceFirstPair(raw, payload.stateCode);
      }
    }

    return raw;
  }

  function installCookieSetterGuard() {
    const candidates = [Document.prototype, HTMLDocument && HTMLDocument.prototype].filter(Boolean);
    let descriptorOwner = null;
    let descriptor = null;

    for (const candidate of candidates) {
      descriptor = Object.getOwnPropertyDescriptor(candidate, "cookie");
      if (descriptor && typeof descriptor.get === "function" && typeof descriptor.set === "function") {
        descriptorOwner = candidate;
        break;
      }
    }
    if (!descriptorOwner || !descriptor) return;
    if (descriptorOwner.__acgStateSwitcherCookieGuard) return;

    Object.defineProperty(descriptorOwner, "__acgStateSwitcherCookieGuard", {
      value: true,
      configurable: false
    });

    Object.defineProperty(descriptorOwner, "cookie", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: function () {
        return descriptor.get.call(this);
      },
      set: function (value) {
        return descriptor.set.call(this, guardedCookieValue(value));
      }
    });
  }

  function patchOneAcgUtil() {
    const payload = readPayload();
    if (!payload) return;
    const util = window.oneacgUtil;
    if (!util || util.__acgStateSwitcherPatched) return;

    try {
      const originalGetState = typeof util.getState === "function" ? util.getState.bind(util) : null;
      const originalGetZipCode = typeof util.getZipCode === "function" ? util.getZipCode.bind(util) : null;
      const originalGetClubCode = typeof util.getClubCode === "function" ? util.getClubCode.bind(util) : null;
      const originalGetZipcodeCookie = typeof util.getZipcodeCookie === "function" ? util.getZipcodeCookie.bind(util) : null;

      util.getState = function () { return readPayload()?.stateCode || originalGetState?.() || ""; };
      util.getZipCode = function () { return readPayload()?.zip || originalGetZipCode?.() || ""; };
      util.getClubCode = function () {
        const p = readPayload();
        return p?.zipcodeValue?.split("|")[2] || originalGetClubCode?.() || "";
      };
      util.getZipcodeCookie = function () { return readPayload()?.zipcodeValue || originalGetZipcodeCookie?.() || ""; };
      Object.defineProperty(util, "__acgStateSwitcherPatched", { value: true });
    } catch {}
  }

  installCookieSetterGuard();

  // oneacgUtil is defined after this content script on many pages. Patch it as
  // soon as it appears so analytics/nav reads the selected zip/state too.
  const patchTimer = setInterval(() => {
    patchOneAcgUtil();
    if (window.oneacgUtil && window.oneacgUtil.__acgStateSwitcherPatched) {
      clearInterval(patchTimer);
    }
  }, 20);
  setTimeout(() => clearInterval(patchTimer), 10000);
})();
