// state-keeper.js — drives ACG's new zip-only state flow.
// Instead of only forcing AEM.state, it fills the official zip prompt when it
// appears and lets ACG's own zip lookup service generate the state cookies.
(() => {
  "use strict";

  const KEY = "acgStateKeeper";
  const PAGE_STORAGE_KEY = "__acgStateSwitcherOverride";
  const VALID_STATE = /^[A-Z]{2}$/;
  const VALID_ZIP_COOKIE = /^[0-9]{5}\|AAA\|[0-9]+\|(PC|SP|TB)$/;
  const FAST_INTERVAL_MS = 500;
  const FAST_WINDOW_MS = 120000;
  const SLOW_INTERVAL_MS = 3000;
  const SLOW_WINDOW_MS = 60 * 60 * 1000;

  let activePayload = null;
  let fastTimer = null;
  let slowTimer = null;

  function safeValue(value) {
    return String(value ?? "").replace(/[;\r\n]/g, "").trim();
  }

  function normalizedPayload(payload) {
    const stateCode = safeValue(payload?.stateCode).toUpperCase();
    const zipcodeValue = safeValue(payload?.zipcodeValue);
    const zip = safeValue(payload?.zip || (zipcodeValue.split("|")[0] || ""));
    const countryValue = safeValue(payload?.countryValue || "US").toUpperCase();
    const nonce = safeValue(payload?.nonce || "default");
    const expiresAt = Number(payload?.expiresAt || 0);
    const deferUntil = Number(payload?.deferUntil || 0);

    if (!VALID_STATE.test(stateCode)) return null;
    if (!VALID_ZIP_COOKIE.test(zipcodeValue)) return null;
    if (!/^\d{5}$/.test(zip)) return null;
    if (expiresAt && Date.now() > expiresAt) return null;
    return { ...payload, stateCode, zipcodeValue, zip, countryValue, nonce, expiresAt, deferUntil };
  }

  function writeCookie(name, value, options = {}) {
    const cleanName = safeValue(name);
    const cleanValue = safeValue(value);
    if (!cleanName) return;

    let cookie = `${cleanName}=${cleanValue}; path=/`;
    if (options.maxAge !== undefined) cookie += `; max-age=${options.maxAge}`;
    else cookie += "; max-age=31536000";
    if (options.domain) cookie += `; domain=${options.domain}`;
    if (options.sameSiteNone) cookie += "; SameSite=None; Secure";
    document.cookie = cookie;
  }

  function removeCookie(name) {
    [undefined, ".aaa.com", location.hostname].forEach(domain => {
      try { writeCookie(name, "", { domain, maxAge: 0 }); } catch {}
    });
  }

  function readCookie(name) {
    const prefix = `${name}=`;
    return document.cookie
      .split(";")
      .map(part => part.trim())
      .find(part => part.startsWith(prefix))
      ?.slice(prefix.length) || "";
  }

  function askBackgroundToRepair() {
    try { chrome.runtime.sendMessage({ type: "ACG_REPAIR_STATE_COOKIES" }); } catch {}
  }

  function syncPageLocalStorage(payload) {
    const p = normalizedPayload(payload);
    if (!p) return;
    try {
      window.localStorage.setItem(PAGE_STORAGE_KEY, JSON.stringify(p));
    } catch {}
  }

  function setInputValue(input, value) {
    try {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
    } catch {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "0" }));
  }

  function visibleEnough(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect?.();
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && (!rect || (rect.width >= 0 && rect.height >= 0));
  }

  function trySubmitZip(payload) {
    const p = normalizedPayload(payload);
    if (!p) return false;

    syncPageLocalStorage(p);

    const submittedKey = `__acgStateSwitcherZipSubmitted:${p.nonce}`;
    if (sessionStorage.getItem(submittedKey)) return false;

    const input = document.querySelector("#zipCode, input[name='zipCode'], input[placeholder*='Zip']");
    const button = document.querySelector("#go, input#go, button#go, input[value='Continue'], button[type='submit']");
    if (!input || !button) return false;

    setInputValue(input, p.zip);
    sessionStorage.setItem(submittedKey, String(Date.now()));

    // Let ACG's own listener receive the input/change events before click.
    setTimeout(() => {
      try {
        button.click();
      } catch {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      }
    }, 100);

    return true;
  }

  function writeFallbackCookies(payload) {
    const p = normalizedPayload(payload);
    if (!p) return false;

    writeCookie("AEM.state", p.stateCode, { domain: ".aaa.com" });
    writeCookie("zipcode", p.zipcodeValue, { domain: ".aaa.com" });
    writeCookie("_lr_geo_location_state", p.stateCode, { sameSiteNone: true });
    writeCookie("_lr_geo_location", p.countryValue, { sameSiteNone: true });
    writeCookie("_lr_geo_location_state", p.stateCode, { domain: ".aaa.com", sameSiteNone: true });
    writeCookie("_lr_geo_location", p.countryValue, { domain: ".aaa.com", sameSiteNone: true });
    askBackgroundToRepair();
    return true;
  }

  function needsFallbackRepair(payload) {
    const p = normalizedPayload(payload);
    if (!p) return false;
    return readCookie("AEM.state").toUpperCase() !== p.stateCode ||
      readCookie("zipcode") !== p.zipcodeValue ||
      readCookie("_lr_geo_location_state").toUpperCase() !== p.stateCode;
  }

  function reassert(payload) {
    const p = normalizedPayload(payload);
    if (!p) return;
    syncPageLocalStorage(p);
    trySubmitZip(p);

    // Give the official zip lookup time to run first. After that, fall back to
    // direct cookies so the extension still works if the prompt is suppressed.
    if (Date.now() >= Number(p.deferUntil || 0) && needsFallbackRepair(p)) {
      writeFallbackCookies(p);
    }
  }

  function stopTimers() {
    if (fastTimer) clearInterval(fastTimer);
    if (slowTimer) clearInterval(slowTimer);
    fastTimer = null;
    slowTimer = null;
  }

  function scheduleWrites(payload) {
    const p = normalizedPayload(payload);
    if (!p) return;

    activePayload = p;
    syncPageLocalStorage(p);
    stopTimers();

    // Make sure stale source cookies do not prevent the zip modal path.
    removeCookie("AEM.state");
    removeCookie("zipcode");
    removeCookie("currenturl");
    removeCookie("zipgate-deeplink-data");

    [0, 50, 250, 750, 1500, 3000, 6000, 10000, 15000, 22000, 30000].forEach(delay => {
      setTimeout(() => reassert(activePayload), delay);
    });

    const startedAt = Date.now();
    fastTimer = setInterval(() => {
      if (!activePayload || Date.now() - startedAt > FAST_WINDOW_MS) {
        clearInterval(fastTimer);
        fastTimer = null;
        return;
      }
      reassert(activePayload);
    }, FAST_INTERVAL_MS);

    slowTimer = setInterval(() => {
      if (!activePayload || Date.now() - startedAt > SLOW_WINDOW_MS) {
        clearInterval(slowTimer);
        slowTimer = null;
        return;
      }
      reassert(activePayload);
    }, SLOW_INTERVAL_MS);
  }

  function loadStoredPayload() {
    try {
      chrome.storage.local.get([KEY], result => {
        const payload = normalizedPayload(result?.[KEY]);
        if (!payload) {
          try { chrome.storage.local.remove(KEY); } catch {}
          return;
        }
        scheduleWrites(payload);
      });
    } catch { /* no-op */ }
  }

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[KEY]?.newValue) return;
    const payload = normalizedPayload(changes[KEY].newValue);
    if (payload) scheduleWrites(payload);
  });

  loadStoredPayload();
})();
