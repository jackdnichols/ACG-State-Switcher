// ===============================
// ACG Utilities State Switcher — popup.js
// ===============================

const extVersionEl = document.getElementById('extVersion');
if (extVersionEl) extVersionEl.textContent = `v${chrome.runtime.getManifest().version}`;

// Fire-and-forget cache warm-up: chrome.cookies.* calls hit an on-disk cookie
// store, and the first access after the extension loads (or after it's been
// idle) can be noticeably slower than later ones — this is what made the
// first "Switch State" click of a session slow even after the cookie-removal
// calls were parallelized. Touch the store as soon as the popup opens, while
// the user is still picking a state, so that one-time cost lands here
// instead of after they click.
try { chrome.cookies.getAll({ domain: "aaa.com" }).catch(() => {}); } catch {}

// Popup UI storage keys
const POPUP_TAB_KEY = "popupActiveTab";
const STRATEGIST_CUSTOM_KEY = "strategistCustomIdeas";
const ACG_STATE_KEEPER_KEY = "acgStateKeeper";

function isAcgAaaHost(urlString) {
	try {
		const { hostname } = new URL(urlString);
		const host = hostname.toLowerCase();
		return host === "acg.aaa.com" || host.endsWith(".acg.aaa.com");
	} catch {
		return false;
	}
}

async function getActiveTab() {
	  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	  return tabs?.[0] || null;
}

function setStateControlsEnabled(enabled) {
	const sel = document.getElementById('stateSelect');
	const btn = document.getElementById('applyBtn');
	const note = document.getElementById('stateLockNote');
	if (sel) sel.disabled = !enabled;
	if (btn) btn.disabled = !enabled;
	if (note) note.style.display = enabled ? 'none' : 'block';
}

// --- Current State indicator (reads AEM.state cookie) ---
const STATE_CODE_TO_NAME = {
  CO: "Colorado",
  FL: "Florida",
  GA: "Georgia",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  MI: "Michigan",
  MN: "Minnesota",
  NE: "Nebraska",
  NC: "North Carolina",
  ND: "North Dakota",
  PR: "Puerto Rico",
  SC: "South Carolina",
  TN: "Tennessee",
  WI: "Wisconsin"
};

// ACG no longer exposes the old state dropdown. The current OneACG page source
// reads state behavior from AEM.state and the pipe-delimited zipcode cookie:
//   zipcode = clubZip|association|clubCode|device
// Keep this small and intentional instead of replaying large captured cookie jars.
const STATE_PROFILES = {
  "Colorado":       { code: "CO", zip: "80012", clubCode: "6" },
  "Florida":        { code: "FL", zip: "33601", clubCode: "14" },
  "Georgia":        { code: "GA", zip: "30303", clubCode: "14" },
  "Illinois":       { code: "IL", zip: "61525", clubCode: "20" },
  "Indiana":        { code: "IN", zip: "46204", clubCode: "20" },
  "Iowa":           { code: "IA", zip: "50309", clubCode: "49" },
  "Michigan":       { code: "MI", zip: "48237", clubCode: "47" },
  "Minnesota":      { code: "MN", zip: "55101", clubCode: "49" },
  "Nebraska":       { code: "NE", zip: "68102", clubCode: "69" },
  "North Carolina": { code: "NC", zip: "28105", clubCode: "111" },
  "North Dakota":   { code: "ND", zip: "58102", clubCode: "113" },
  "Puerto Rico":    { code: "PR", zip: "00901", clubCode: "714" },
  "South Carolina": { code: "SC", zip: "29401", clubCode: "111" },
  "Tennessee":      { code: "TN", zip: "37203", clubCode: "14" },
  "Wisconsin":      { code: "WI", zip: "53703", clubCode: "270" }
};

const STATE_CODE_TO_PROFILE = Object.fromEntries(
  Object.entries(STATE_PROFILES).map(([name, profile]) => [profile.code, { ...profile, name }])
);
const STATE_ZIP_TO_CODE = Object.fromEntries(
  Object.values(STATE_PROFILES).map(profile => [profile.zip, profile.code])
);
const UNIQUE_CLUB_CODE_TO_STATE = {
  "6": "CO",
  "47": "MI",
  "69": "NE",
  "113": "ND",
  "270": "WI",
  "714": "PR"
};
const CORE_STATE_COOKIE_NAMES = ["AEM.state", "zipcode", "_lr_geo_location_state", "_lr_geo_location", "zipgate-deeplink-data", "currenturl", "tempProxyUI"];
const PAGE_STATE_OVERRIDE_KEY = "__acgStateSwitcherOverride";
const ACG_COOKIE_URL = "https://www.acg.aaa.com/";

function setCurrentStatePill(code) {
  const el = document.getElementById('currentStatePill');
  if (!el) return;

  const c = (code || '').toString().trim().toUpperCase();
  const name = STATE_CODE_TO_NAME[c] || "";

  el.classList.remove('pill-ok', 'pill-warn', 'pill-info', 'pill-neutral');
  el.classList.add(c ? 'pill-info' : 'pill-neutral');

  // Match popup wording: "Current State: XX"
  el.textContent = c ? `Current State: ${c}` : 'Current State: —';
  const tip = c ? `AEM.state = ${c}${name ? ` (${name})` : ''}` : 'No AEM.state cookie found on the active tab.';
  el.setAttribute('title', tip);
  el.setAttribute('aria-label', tip);

  // Helpful: pre-select the dropdown to match the current cookie (does not apply anything).
  if (c && name) {
    const sel = document.getElementById('stateSelect');
    if (sel && Array.from(sel.options).some(o => o.value === name)) {
      sel.value = name;
    }
  }
}

async function readCookieValueFromAnyAllowedUrl(tabUrl, name) {
  // Most reliable: ask for the cookie using the active tab URL. Domain matching is handled by Chrome.
  // Fallback to a stable ACG URL because the state cookies are written for .aaa.com.
  const urlsToTry = [];
  if (tabUrl) urlsToTry.push(tabUrl);
  urlsToTry.push(ACG_COOKIE_URL);

  for (const u of urlsToTry) {
    try {
      const c = await chrome.cookies.get({ url: u, name });
      const val = (c && c.value) ? String(c.value).trim() : '';
      if (val) return val;
    } catch { /* ignore */ }
  }
  return '';
}

function normalizeStateCode(code) {
  const c = (code || '').toString().trim().toUpperCase();
  return STATE_CODE_TO_NAME[c] ? c : '';
}

function deriveStateCodeFromZipcodeCookie(zipCookieValue) {
  const parts = (zipCookieValue || '').toString().split('|');
  const zip = (parts[0] || '').trim();
  const clubCode = (parts[2] || '').replace(/^0+/, '') || (parts[2] || '').trim();

  // Prefer exact test ZIPs because some ACG club codes serve multiple states.
  if (STATE_ZIP_TO_CODE[zip]) return STATE_ZIP_TO_CODE[zip];

  // Only derive from club code when the mapping is unique.
  if (UNIQUE_CLUB_CODE_TO_STATE[clubCode]) return UNIQUE_CLUB_CODE_TO_STATE[clubCode];
  return '';
}

async function readCurrentStateFromCookies(tabUrl) {
  // If the user just switched state, prefer the active extension override for
  // the popup pill. The page cookies may briefly show both old and new values
  // while ACG's zip lookup and our cleanup finish.
  try {
    const result = await chrome.storage.local.get([ACG_STATE_KEEPER_KEY]);
    const payload = result?.[ACG_STATE_KEEPER_KEY];
    const overrideCode = normalizeStateCode(payload?.stateCode);
    const expiresAt = Number(payload?.expiresAt || 0);
    if (overrideCode && (!expiresAt || Date.now() <= expiresAt)) return overrideCode;
  } catch { /* cookie fallback below */ }

  const aemState = normalizeStateCode(await readCookieValueFromAnyAllowedUrl(tabUrl, 'AEM.state'));
  if (aemState) return aemState;

  const zipCookie = await readCookieValueFromAnyAllowedUrl(tabUrl, 'zipcode');
  const zipState = deriveStateCodeFromZipcodeCookie(zipCookie);
  if (zipState) return zipState;

  return normalizeStateCode(await readCookieValueFromAnyAllowedUrl(tabUrl, '_lr_geo_location_state'));
}

function profileForStateName(name) {
  const raw = (name || '').toString().trim();
  if (STATE_PROFILES[raw]) return { ...STATE_PROFILES[raw], name: raw };

  const code = normalizeStateCode(raw);
  if (code && STATE_CODE_TO_PROFILE[code]) return STATE_CODE_TO_PROFILE[code];

  const lower = raw.toLowerCase();
  const match = Object.keys(STATE_PROFILES).find(n => n.toLowerCase() === lower);
  return match ? { ...STATE_PROFILES[match], name: match } : null;
}

function normalizeAemStateCookieValue(value) {
  const raw = (value || '').toString().trim();
  const profile = profileForStateName(raw);
  if (profile?.code) return profile.code.toString().trim().toUpperCase();
  return raw.toUpperCase();
}

function profileStateCode(profile) {
  const code = normalizeAemStateCookieValue(profile?.code || profile?.name);
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new Error(`Invalid AEM.state value: ${code || '(blank)'}`);
  }
  return code;
}

function normalizeDeviceCode(device) {
  const d = (device || '').toString().trim().toUpperCase();
  return ["PC", "SP", "TB"].includes(d) ? d : "PC";
}

async function readCurrentDeviceCode(tabUrl) {
  const zipCookie = await readCookieValueFromAnyAllowedUrl(tabUrl, 'zipcode');
  const device = (zipCookie || '').split('|')[3];
  return normalizeDeviceCode(device);
}

function expirationDaysFromNow(days) {
  return Math.floor(Date.now() / 1000) + Math.floor(days * 24 * 60 * 60);
}

function plainAcgDomainCookieDetails(name, value, expirationDate) {
  // Match the way ACG writes its own .aaa.com cookies. DevTools showed ACG
  // repainting AEM.state as a plain cookie, so avoid Secure/SameSite differences
  // that can make our write lose the final cookie tug-of-war.
  const cookieValue = name === "AEM.state"
    ? normalizeAemStateCookieValue(value)
    : String(value ?? "");

  return {
    url: ACG_COOKIE_URL,
    domain: ".aaa.com",
    name,
    value: cookieValue,
    path: "/",
    secure: false,
    expirationDate
  };
}

function secureAcgHostCookieDetails(url, name, value, expirationDate) {
  return {
    url,
    name,
    value: String(value ?? ""),
    path: "/",
    secure: true,
    sameSite: "no_restriction",
    expirationDate
  };
}

function secureAcgDomainCookieDetails(name, value, expirationDate) {
  return {
    url: ACG_COOKIE_URL,
    domain: ".aaa.com",
    name,
    value: String(value ?? ""),
    path: "/",
    secure: true,
    sameSite: "no_restriction",
    expirationDate
  };
}

async function saveStateKeeperOverride(stateCode, zipcodeValue, zip, stateName) {
  const now = Date.now();
  const payload = {
    mode: "zipgate",
    stateCode,
    stateName: String(stateName || ""),
    zipcodeValue,
    zip: String(zip || (zipcodeValue || "").split("|")[0] || ""),
    countryValue: "US",
    nonce: `${stateCode}-${Date.now()}`,
    updatedAt: now,
    // Let the ACG zip lookup run first, but do not make the user wait.
    // Older builds waited ~20 seconds here, which made Chrome feel stalled.
    deferUntil: now + 4000,
    expiresAt: now + (60 * 60 * 1000)
  };
  try {
    await chrome.storage.local.set({ [ACG_STATE_KEEPER_KEY]: payload });
  } catch { /* storage is best-effort only */ }
  return payload;
}

async function installPageStateOverride(tabId, payload) {
  if (!tabId || !payload) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [PAGE_STATE_OVERRIDE_KEY, payload],
      func: (key, value) => {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
        try { window.sessionStorage.removeItem(`__acgStateSwitcherZipSubmitted:${value.nonce}`); } catch {}
      }
    });
  } catch {
    // Page localStorage is an optimization. Static content scripts will still read chrome.storage.
  }
}

function urlWithZipGateParams(urlString, zip, stateCode) {
  try {
    const u = new URL(urlString || ACG_COOKIE_URL);
    u.searchParams.set("zip", String(zip || ""));
    u.searchParams.set("stateprov", String(stateCode || "").toUpperCase());
    return u.toString();
  } catch {
    const u = new URL(ACG_COOKIE_URL);
    u.searchParams.set("zip", String(zip || ""));
    u.searchParams.set("stateprov", String(stateCode || "").toUpperCase());
    return u.toString();
  }
}

// cookieRemovalUrl() lives in cookie-utils.js, loaded via a <script> tag in
// popup.html before this file, so it's shared with background.js instead of
// kept in sync by hand.

async function removeCookieAtCandidateUrls(name) {
  const urls = [ACG_COOKIE_URL, "https://acg.aaa.com/", "https://www.acg.aaa.com/"];

  // Repeated passes handle cases where both host-only and .aaa.com cookies share a name.
  // The 9 attempts (3 passes x 3 urls) are independent of each other and order
  // doesn't matter, so run them concurrently instead of one at a time — on a
  // machine where each chrome.cookies.remove() round-trip costs real time,
  // doing this sequentially turned a ~9x cost multiplier into an 8-17 second
  // stall before the switch even started.
  const attempts = [];
  for (let pass = 0; pass < 3; pass++) {
    for (const url of urls) {
      attempts.push(chrome.cookies.remove({ url, name }).catch(() => null));
    }
  }

  const results = await Promise.all(attempts);
  return results.filter(Boolean).length;
}

async function removeCookiesByNameFast(names) {
  // Fast path for the button click. The slower broad duplicate cleanup now runs
  // in the background/state keeper after navigation, so Chrome does not sit
  // on the popup for 10+ seconds before the page starts changing.
  const results = await Promise.allSettled(names.map(name => removeCookieAtCandidateUrls(name)));
  return {
    removed: results.reduce((sum, r) => sum + (r.status === "fulfilled" ? Number(r.value || 0) : 0), 0),
    errors: results
      .filter(r => r.status === "rejected")
      .map(r => String(r.reason?.message || r.reason || "cookie removal failed"))
  };
}

async function removeCookiesByName(names) {
  let removed = 0;
  const errors = [];

  for (const name of names) {
    let matches = [];
    try {
      matches = await chrome.cookies.getAll({ name });
    } catch (e) {
      // Fallback keeps the switcher usable even if broad getAll is blocked by host permissions.
      removed += await removeCookieAtCandidateUrls(name);
      continue;
    }

    for (const cookie of matches) {
      try {
        const url = cookieRemovalUrl(cookie);
        if (!isAllowedHost(url)) continue;
        await chrome.cookies.remove({ url, name, storeId: cookie.storeId });
        removed++;
      } catch (e) {
        errors.push(`${name}: remove failed (${e?.message || e})`);
      }
    }

    removed += await removeCookieAtCandidateUrls(name);
  }

  return { removed, errors };
}

async function applyCoreStateCookies(profile, tabUrl, tabId) {
  const stateCode = profileStateCode(profile);
  const deviceCode = await readCurrentDeviceCode(tabUrl);
  const expirationDate = expirationDaysFromNow(365);
  const zipcodeValue = `${profile.zip}|AAA|${profile.clubCode}|${deviceCode}`;

  // Fast cleanup only. Broad duplicate cleanup continues in the background
  // after navigation so the first click feels immediate in Chrome.
  const cleanup = await removeCookiesByNameFast(CORE_STATE_COOKIE_NAMES);

  const payload = await saveStateKeeperOverride(stateCode, zipcodeValue, profile.zip, profile.name);
  await installPageStateOverride(tabId, payload);

  const details = [
    // Seed the selected state immediately so the first reload starts in the
    // right place instead of waiting for the fallback repair window. The URL
    // still carries zip/stateprov so ACG's official zip flow can confirm it.
    plainAcgDomainCookieDetails("AEM.state", stateCode, expirationDate),
    plainAcgDomainCookieDetails("zipcode", zipcodeValue, expirationDate),
    secureAcgHostCookieDetails("https://www.acg.aaa.com/", "AEM.state", stateCode, expirationDate),
    secureAcgHostCookieDetails("https://acg.aaa.com/", "AEM.state", stateCode, expirationDate),
    secureAcgHostCookieDetails("https://www.acg.aaa.com/", "zipcode", zipcodeValue, expirationDate),
    secureAcgHostCookieDetails("https://acg.aaa.com/", "zipcode", zipcodeValue, expirationDate),
    secureAcgHostCookieDetails("https://www.acg.aaa.com/", "_lr_geo_location_state", stateCode, expirationDate),
    secureAcgHostCookieDetails("https://acg.aaa.com/", "_lr_geo_location_state", stateCode, expirationDate),
    secureAcgHostCookieDetails("https://www.acg.aaa.com/", "_lr_geo_location", "US", expirationDate),
    secureAcgHostCookieDetails("https://acg.aaa.com/", "_lr_geo_location", "US", expirationDate),
    secureAcgDomainCookieDetails("_lr_geo_location_state", stateCode, expirationDate),
    secureAcgDomainCookieDetails("_lr_geo_location", "US", expirationDate)
  ];

  let ok = 0;
  let fail = 0;
  const errors = [...cleanup.errors];

  for (const det of details) {
    try {
      await chrome.cookies.set(det);
      ok++;
    } catch (e) {
      fail++;
      errors.push(`${det.name}: set failed (${e?.message || e})`);
    }
  }

  const nextUrl = urlWithZipGateParams(tabUrl, profile.zip, stateCode);
  return { ok, fail, errors, removed: cleanup.removed, zipcodeValue, stateCode, zip: profile.zip, nextUrl, payload };
}

/* ---------- Helpers kept after removing legacy captured-cookie bundle support. ---------- */
const DOMAIN_ALLOWLIST = ["aaa.com", "acg.aaa.com", "meemic.com", "meemicfoundation.org"];
function isAllowedHost(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return DOMAIN_ALLOWLIST.some(d => {
      d = d.toLowerCase().replace(/^\./, "");
      return h === d || h.endsWith("." + d);
    });
  } catch {
    return false;
  }
}
function toast(el, msg, ok = true) {
  if (!el) return;
  el.className = `msg ${ok ? "ok" : "err"}`;
  el.textContent = msg;
}

/* ---------- Legacy captured-cookie bundle support removed in v1.86. ---------- */
/* ---------- Tabs (cleaner popup UI) ---------- */
function setActiveTab(tabName) {
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const views = Array.from(document.querySelectorAll('.view'));

  tabs.forEach(t => {
    const on = t.getAttribute('data-tab') === tabName;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  views.forEach(v => {
    const on = v.getAttribute('data-view') === tabName;
    v.classList.toggle('active', on);
  });

  try { chrome.storage.sync.set({ [POPUP_TAB_KEY]: tabName }); } catch {}
}

async function initTabs() {
  const saved = (await chrome.storage.sync.get([POPUP_TAB_KEY]))?.[POPUP_TAB_KEY] || 'state';
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.getAttribute('data-tab')));
  });
  setActiveTab(saved);
}

/* ---------- Target Strategist (Adobe AB helper) ---------- */
const STRATEGIST_ALLOWED_DOMAINS = [
  "aaa.com",
  "acg.aaa.com",
  "meemic.com",
  "meemicfoundation.org",
  "adobeaemcloud.com"
];

let strategistLast = null; // { url, hostname, env, brand, pageName, pathname, h1, ctaText, ctaHref, formCount, hasDD, hasS, hasAlloy, hasAt }

function hostnameFromUrl(urlString) {
  try { return new URL(urlString).hostname.toLowerCase(); } catch { return ""; }
}

function isAllowedStrategistUrl(urlString) {
  const h = hostnameFromUrl(urlString);
  if (!h) return false;
  return STRATEGIST_ALLOWED_DOMAINS.some(d => h === d || h.endsWith("." + d));
}

function detectBrand(hostname) {
  const h = (hostname || "").toLowerCase();
  if (h.includes("meemicfoundation")) return "Meemic Foundation";
  if (h.includes("meemic")) return "Meemic";
  return "ACG/AAA";
}

function detectEnv(hostname) {
  const h = (hostname || "").toLowerCase();

  // Site envs
  if (h.includes("dev1")) return "Dev1";
  if (h.includes("qa1")) return "QA1";
  if (h.includes("stage1")) return "Stage1";

  // AEM author envs (based on your manifest mappings)
  if (h.includes("author-p149839-e1544194")) return "Dev1 (Author)";
  if (h.includes("author-p149839-e1583595")) return "QA1 (Author)";
  if (h.includes("author-p149839-e1583546")) return "Stage1 (Author)";
  if (h.includes("author-p149839-e1583596")) return "Prod (Author)";

  return "Production";
}

function setPill(el, state, text, tooltip) {
  if (!el) return;

  el.classList.remove("pill-ok", "pill-warn", "pill-info", "pill-neutral", "hidden");

  const cls =
    state === "ok" ? "pill-ok" :
    state === "warn" ? "pill-warn" :
    state === "info" ? "pill-info" :
    "pill-neutral";

  el.classList.add(cls);
  el.textContent = text || "";

  // Keep data-tooltip as the single source of truth (also used for native hover tooltips)
  const tip = (tooltip == null) ? "" : String(tooltip);

  el.setAttribute("data-tooltip", tip);

  // Native tooltip is not clipped by the extension popup window (unlike CSS ::after tooltips)
  if (tip.trim()) {
    el.setAttribute("title", tip);
    el.setAttribute("aria-label", `${(text || "").trim()} — ${tip}`.trim());
  } else {
    el.removeAttribute("title");
    el.setAttribute("aria-label", (text || "").trim());
  }
}

function updateStrategistStatusPills(s) {
  const $domain = document.getElementById("pillDomain");
  const $dd = document.getElementById("pillDD");
  const $s = document.getElementById("pillS");
  const $web = document.getElementById("pillWebSDK");
  const $tgt = document.getElementById("pillTarget");
  const $sel = document.getElementById("pillSelectors");
  const $health = document.getElementById("pillHealth");

  if (!s) {
    setPill($domain, "neutral", "Domain", "");
    setPill($dd, "neutral", "digitalData", "");
    setPill($s, "neutral", "s.pageName", "");
    setPill($web, "neutral", "Web SDK", "");
    setPill($tgt, "neutral", "Target", "");
    setPill($sel, "neutral", "Selectors", "");
    setPill($health, "neutral", "Health", "");
    return;
  }

  const host = (s.hostname || "").toLowerCase();
  setPill($domain, "info", `${s.brand || "Site"} • ${s.env || "Env"}`, host);

  setPill($dd, s.hasDD ? "ok" : "warn", `digitalData ${s.hasDD ? "✓" : "✗"}`, "digitalData presence (window.digitalData)");
  setPill($s, s.hasS ? "ok" : "warn", `s.pageName ${s.hasS ? "✓" : "✗"}`, "Adobe Analytics s-object presence (window.s.pageName)");
  setPill($web, s.hasAlloy ? "ok" : "warn", `Web SDK ${s.hasAlloy ? "✓" : "✗"}`, "Adobe Web SDK / data layer presence (window.alloy / adobeDataLayer)");

  // Target can be delivered by at.js OR via Web SDK, so treat missing at.js as "info" if Web SDK exists.
  const tgtState = s.hasAt ? "ok" : (s.hasAlloy ? "info" : "warn");
  const tgtText = s.hasAt ? "Target ✓" : (s.hasAlloy ? "Target ?" : "Target ✗");
  const tgtTip = s.hasAt
    ? "window.adobe.target detected (at.js style)."
    : (s.hasAlloy ? "Target might be delivered via Web SDK (no at.js object detected)." : "No Target signal detected.");
  setPill($tgt, tgtState, tgtText, tgtTip);

  const hasSelectors = !!(s.h1Selector || s.ctaSelector || s.formSelector);
  const selTip = [
    s.h1Selector ? `H1: ${s.h1Selector}` : "H1: (none)",
    s.ctaSelector ? `CTA: ${s.ctaSelector}` : "CTA: (none)",
    s.formSelector ? `Form: ${s.formSelector}` : "Form: (none)"
  ].join("\n");
  setPill($sel, hasSelectors ? "ok" : "warn", hasSelectors ? "Selectors ✓" : "Selectors ✗", selTip);

  const h = s.health || {};
  
    const brokenImages = Number.isFinite(+h.brokenImages) ? +h.brokenImages : 0;
    const totalImages = Number.isFinite(+h.imagesTotal) ? +h.imagesTotal : 0;
  
    const placeholderLinks = Number.isFinite(+h.placeholderLinks) ? +h.placeholderLinks : 0;
    const javascriptLinks = Number.isFinite(+h.javascriptLinks) ? +h.javascriptLinks : 0;
    const missingAnchorLinks = Number.isFinite(+h.missingAnchorLinks) ? +h.missingAnchorLinks : 0;
    const totalLinks = Number.isFinite(+h.linksTotal) ? +h.linksTotal : 0;
  
    const linkIssues = placeholderLinks + javascriptLinks + missingAnchorLinks;
    const healthOk = brokenImages === 0 && linkIssues === 0;
  
    // Compact pill label
    const healthText = healthOk
      ? "Health ✓"
      : `Health ⚠ ${brokenImages}img/${linkIssues}lnk`;
  
    const tipLines = [
      `Images: ${brokenImages} broken of ${totalImages}`,
      `Links: ${missingAnchorLinks} broken anchor(s), ${placeholderLinks} placeholder (#/empty), ${javascriptLinks} javascript: of ${totalLinks}`,
    ];
  
    // Broken image details (so you can actually find the thing)
    if (Array.isArray(h.brokenImageSamples) && h.brokenImageSamples.length) {
      tipLines.push("Broken image samples (up to 5):");
      for (const x of h.brokenImageSamples.slice(0, 5)) {
        const src = x?.src || '(no src)';
        const sel = x?.selector ? ` | ${x.selector}` : '';
        const alt = x?.alt ? ` | alt="${x.alt}"` : '';
        const why = x?.reason ? `[${x.reason}] ` : '';
        tipLines.push(`- ${why}${src}${alt}${sel}`);
      }
    }
  
    // Broken in-page anchors
    if (Array.isArray(h.missingAnchorSamples) && h.missingAnchorSamples.length) {
      tipLines.push("Broken in-page anchor samples:");
      for (const x of h.missingAnchorSamples.slice(0, 5)) {
        const label = x?.text ? ` "${x.text}"` : '';
        const sel = x?.selector ? ` | ${x.selector}` : '';
        tipLines.push(`- ${x?.href || ''}${label}${sel}`);
      }
    }
  
    // Placeholder links (filtered to avoid common UI toggles)
    if (Array.isArray(h.placeholderLinkSamples) && h.placeholderLinkSamples.length) {
      tipLines.push("Placeholder link samples (#/empty):");
      for (const x of h.placeholderLinkSamples.slice(0, 5)) {
        const label = x?.text ? ` "${x.text}"` : '';
        const sel = x?.selector ? ` | ${x.selector}` : '';
        tipLines.push(`- ${x?.href || ''}${label}${sel}`);
      }
    }
  
    if (Array.isArray(h.javascriptLinkSamples) && h.javascriptLinkSamples.length) {
      tipLines.push("javascript: link samples:");
      for (const x of h.javascriptLinkSamples.slice(0, 5)) {
        const label = x?.text ? ` "${x.text}"` : '';
        const sel = x?.selector ? ` | ${x.selector}` : '';
        tipLines.push(`- ${x?.href || ''}${label}${sel}`);
      }
    }
  
    setPill($health, healthOk ? "ok" : "warn", healthText, tipLines.join("\n"));
}

// Allow clicking a status pill to copy its details to clipboard.
// This is useful because pill tooltips can be long (selectors, health samples, etc.).
function wireStrategistPillCopy() {
  const row = document.getElementById('strategistStatusRow');
  if (!row) return;

  const pills = Array.from(row.querySelectorAll('.pill'));
  for (const pill of pills) {
    // Make it keyboard accessible.
    pill.setAttribute('role', 'button');
    pill.setAttribute('tabindex', '0');

    const doCopy = async () => {
      const label = (pill.textContent || '').trim();
      const tip = (pill.getAttribute('data-tooltip') || pill.getAttribute('title') || '').trim();
      const text = tip ? `${label}\n${tip}` : label;
      if (!text.trim()) return;

      const note = document.getElementById('strategistNote');
      try {
        await navigator.clipboard.writeText(text);

        // Visual ping
        pill.classList.add('pill-copied');
        setTimeout(() => pill.classList.remove('pill-copied'), 650);

        if (note) note.textContent = `Copied pill: ${label || 'Status'}`;
      } catch (e) {
        console.error('Pill copy failed:', e);
        if (note) note.textContent = 'Copy failed. Your browser may be blocking clipboard access in popups.';
      }
    };

    pill.addEventListener('click', (e) => {
      e.preventDefault();
      doCopy();
    });

    pill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        doCopy();
      }
    });
  }
}






function oneChangeText(raw) {
  const t0 = String(raw || '').trim();
  if (!t0) return '';
  let t = t0;
  // Prefer a single clear change: keep first clause/sentence if it looks like multiple changes.
  if (t.includes(';')) t = t.split(';')[0].trim();
  if (t.includes(' + ')) t = t.split(' + ')[0].trim();
  if (t.length > 120 && /\s+and\s+/i.test(t)) t = t.split(/\s+and\s+/i)[0].trim();
  if (t.length > 180) {
    const first = t.split(/(?<=[.!?])\s+/)[0].trim();
    if (first.length >= 24) t = first;
  }
  return t;
}

// Infer product line from URL/pageName/H1 so copy suggestions feel relevant.
function inferLineOfBusiness(scan) {
  const hay = `${scan?.url || ''} ${scan?.pageName || ''} ${scan?.h1 || ''} ${scan?.pathname || ''}`.toLowerCase();
  if (/(auto|vehicle|car)/.test(hay)) return { key: 'auto', label: 'auto' };
  if (/(homeowners|home\b|property)/.test(hay)) return { key: 'home', label: 'home' };
  if (/(renters|renter)/.test(hay)) return { key: 'renters', label: 'renters' };
  if (/(life\s*insurance|\blife\b)/.test(hay)) return { key: 'life', label: 'life' };
  if (/(umbrella)/.test(hay)) return { key: 'umbrella', label: 'umbrella' };
  if (/(motorcycle|bike)/.test(hay)) return { key: 'motorcycle', label: 'motorcycle' };
  return { key: 'insurance', label: 'insurance' };
}

// Generate a short, paste-ready paragraph for a quote funnel.
// No AI: just a small set of proven, plain-language options.
function suggestShortParagraph(scan, lob) {
  const label = (lob?.label || 'insurance');
  const fast = (scan?.formCount >= 1) ? 'Answer a few quick questions' : 'Click the button to start';

  // Primary: benefit + speed + low pressure.
  const primary = label === 'insurance'
    ? `Get a quote in minutes. ${fast} and see your price right away.`
    : `Get your ${label} quote in minutes. ${fast} and see your price right away.`;

  // Alt: reassurance about spam / obligation.
  const alt1 = label === 'insurance'
    ? `It’s quick and there’s no obligation. Start your quote now and you can review your price before you commit to anything.`
    : `It’s quick and there’s no obligation. Start your ${label} quote now and review your price before you commit to anything.`;

  // Alt: “no phone call” style (common friction reducer). Use only if we don't detect phone-required vibes.
  const alt2 = `No spam. No pressure. Just a fast ${label === 'insurance' ? 'quote' : `${label} quote`} you can review in a few minutes.`;

  return { primary, alt1, alt2 };
}


function noobVariantText(i) {
  const scan = (typeof strategistLast === "object" && strategistLast) ? strategistLast : {};
  const title = (i?.title || "").toLowerCase();
  const rawB = i?.b || i?.variantB || i?.change || "";
  const b = oneChangeText(rawB);

  if (!b) return "";

  // Make a couple of common tests extra concrete using what we detected on the page.
  const ctaText = (scan.ctaText || "").trim();
  const ctaBg = (scan.ctaStyle && scan.ctaStyle.background) ? String(scan.ctaStyle.background).trim() : "";
  const ctaFg = (scan.ctaStyle && scan.ctaStyle.color) ? String(scan.ctaStyle.color).trim() : "";

  if (title.includes("cta button color") || /button color|high contrast/.test(title + " " + b.toLowerCase())) {
    const from = ctaBg ? `Current button background is ${ctaBg}. ` : "";
    const to = "Set it to a noticeably different accent color (example: #FF7A00) and keep the text color white.";
    return `Change the primary CTA button background color. ${from}${to} Nothing else changes.`;
  }

  if (title.includes("cta label") || /cta label|button text|label/.test(title + " " + b.toLowerCase())) {
    const from = ctaText ? `Current button text is "${ctaText}". ` : "";
    const to = 'Change it to ONE of these (pick one): "See my price" or "Start my quote".';
    return `Update the primary CTA button text. ${from}${to} Leave the button style and page layout exactly the same.`;
  }

  if (/headline|h1/.test(title + " " + b.toLowerCase())) {
    const cur = (scan.h1 || '').trim();
    const curSnippet = cur ? cur.replace(/\s+/g, ' ').slice(0, 90) : '';
    const lob = inferLineOfBusiness(scan);
    const label = lob?.label || 'insurance';
    const s1 = label === 'insurance' ? 'Get a quote in minutes.' : `Get your ${label} quote in minutes.`;
    const s2 = label === 'insurance' ? 'See your price fast.' : `See your ${label} price fast.`;
    const s3 = label === 'insurance' ? 'Start your quote now.' : `Start your ${label} quote now.`;

    const parts = [];
    if (curSnippet) parts.push(`Replace the H1 that says: "${curSnippet}${curSnippet.length >= 90 ? '…' : ''}"`);
    parts.push(`Suggested headline: "${s1}"`);
    parts.push(`Alt headline (optional): "${s2}"`);
    parts.push(`Alt headline (optional): "${s3}"`);
    parts.push("Do not change any other text, layout, or images.");
    return parts.join(' ');
  }

  if (/paragraph|copy|text/.test(title + " " + b.toLowerCase())) {
    // We want to hand the user an actual sentence/paragraph they can paste into Target.
    // Pull a reference paragraph if we found one near the CTA/H1.
    const ref = (scan.ctaParaText || scan.heroParaText || "").trim();
    const refSnippet = ref ? ref.replace(/\s+/g, ' ').slice(0, 120) : "";

    const lob = inferLineOfBusiness(scan);
    const suggested = suggestShortParagraph(scan, lob);

    const parts = [];
    if (refSnippet) parts.push(`Replace the paragraph that starts with: "${refSnippet}${refSnippet.length >= 120 ? '…' : ''}"`);
    parts.push(`Suggested replacement copy: "${suggested.primary}"`);
    if (suggested.alt1) parts.push(`Alt copy (optional): "${suggested.alt1}"`);
    if (suggested.alt2) parts.push(`Alt copy (optional): "${suggested.alt2}"`);
    parts.push("Do not change any other paragraphs, layout, or images.");
    return parts.join(" ");
  }

  // Default: keep it simple
  return `${b} (Everything else stays the same.)`;
}

function targetHowTo(i) {
  const placement = (i?.placement || "").trim();
  const hint = placement ? ` (look for: ${placement})` : "";
  const title = (i?.title || "").toLowerCase();
  const rawB = (i?.b || i?.variantB || i?.change || "").toLowerCase();

  // Basic guidance for a noob using Target VEC
  if (/color|style|background|border|contrast/.test(title + " " + rawB)) {
    return `In Adobe Target VEC: click the element${hint}, choose Edit > Style (or CSS), change ONLY the background/text color, then save.`;
  }
  if (/text|copy|headline|label|cta/.test(title + " " + rawB)) {
    return `In Adobe Target VEC: click the text${hint}, choose Edit > Text, replace it, then save. (Only change that one thing.)`;
  }
  if (/image|hero|photo/.test(title + " " + rawB)) {
    return `In Adobe Target VEC: click the image${hint}, choose Replace Image, paste the new URL, then save.`;
  }
  if (/form|field|zip|email|phone/.test(title + " " + rawB)) {
    return `In Adobe Target VEC: click the form element${hint} and change ONE label/placeholder. If it’s a JS-rendered form (SPA), use custom code or Form-Based Composer.`;
  }
  return `In Adobe Target VEC: find the element${hint} and make the single change described in Variant (B).`;
}

function clampScore(n, min = 1, max = 5) {
  const x = Number.isFinite(+n) ? +n : min;
  return Math.max(min, Math.min(max, Math.round(x)));
}

function goalLabel(goal) {
  const labels = {
    conversion: "Increase conversion",
    form: "Improve form completion",
    engagement: "Improve engagement",
    revenue: "Increase revenue/value",
    support: "Reduce support/friction"
  };
  return labels[String(goal || "conversion").toLowerCase()] || labels.conversion;
}

function classifyIdeaPriority(i, context = {}) {
  const hay = [
    i?.title, i?.change, i?.test, i?.hypothesis, i?.variantA, i?.variantB,
    ...(Array.isArray(i?.tags) ? i.tags : [])
  ].filter(Boolean).join(" ").toLowerCase();
  const goal = String(context.goal || "conversion").toLowerCase();
  const pageType = String(context.pageType || "generic").toLowerCase();

  let impact = 3;
  let confidence = 3;
  let effort = 2;

  if (/cta|headline|h1|subhead|copy|label|button/.test(hay)) {
    impact += 1;
    confidence += 1;
    effort -= 1;
  }
  if (/form|field|step|submit|progress|flow|quote/.test(hay)) {
    impact += 1;
    effort += 1;
  }
  if (/sticky|exit|modal|rescue|layout|single-column|module|faq|image|photo/.test(hay)) {
    effort += 1;
  }
  if (/trust|reassurance|privacy|no obligation|what happens next|agent|help/.test(hay)) {
    confidence += 1;
  }
  if (/color|contrast|style/.test(hay)) {
    confidence -= 1;
  }

  if (goal === "form" && /form|field|step|submit|progress|flow/.test(hay)) impact += 1;
  if (goal === "engagement" && /content|article|faq|module|guide|nav|findability|top tasks/.test(hay)) impact += 1;
  if (goal === "revenue" && /quote|bundle|upgrade|join|membership|discount|travel|donat|payment|autopay/.test(hay)) impact += 1;
  if (goal === "support" && /help|faq|agent|login|billing|what happens next|privacy|error|assist/.test(hay)) impact += 1;

  if (pageType && pageType !== "generic" && hay.includes(pageType)) confidence += 1;

  impact = clampScore(impact);
  confidence = clampScore(confidence);
  effort = clampScore(effort);
  const score = (impact * 2) + confidence - effort;
  const label = score >= 10 ? "High" : (score >= 8 ? "Medium" : "Low");

  return { impact, confidence, effort, score, label };
}

function priorityText(i) {
  const p = i?.__priority || classifyIdeaPriority(i);
  return `${p.label} priority (Impact ${p.impact}/5, Confidence ${p.confidence}/5, Effort ${p.effort}/5)`;
}


function renderStrategistIdeas(ideas) {
  const list = document.getElementById("strategistIdeaList");
  if (!list) return;
  list.innerHTML = "";

  if (!Array.isArray(ideas) || ideas.length === 0) return;

  ideas.forEach((i, idx) => {
    const card = document.createElement("div");
    card.className = "idea-card";

    const head = document.createElement("div");
    head.className = "idea-head";

    const title = document.createElement("div");
    title.className = "idea-title";
    title.textContent = i.title || `Idea ${idx + 1}`;

    const num = document.createElement("div");
    num.className = "idea-num";
    num.textContent = `#${idx + 1}`;

    const actions = document.createElement("div");
    actions.className = "idea-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "idea-copy btn-ghost";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyStrategistIdea(i, idx + 1, copyBtn);
    });

    actions.appendChild(copyBtn);
    actions.appendChild(num);

    head.appendChild(title);
    head.appendChild(actions);
    card.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "idea-meta";
    const pr = i.__priority || classifyIdeaPriority(i);
    const tags = [i.activityType, pr ? `${pr.label} priority` : "", i.audience].filter(Boolean);
    (i.tags || []).forEach(t => tags.push(String(t)));
    tags.slice(0, 6).forEach(t => {
      const tag = document.createElement("span");
      tag.className = "idea-tag";
      tag.textContent = t;
      meta.appendChild(tag);
    });
    if (meta.childNodes.length) card.appendChild(meta);

    const grid = document.createElement("div");
    grid.className = "idea-grid";

    function addKV(k, v) {
      if (!v) return;
      const row = document.createElement("div");
      row.className = "idea-kv";
      const kk = document.createElement("span");
      kk.className = "k";
      kk.textContent = k + ": ";
      const vv = document.createElement("span");
      vv.textContent = v;
      row.appendChild(kk);
      row.appendChild(vv);
      grid.appendChild(row);
    }

    const test = i.change || i.test || i.title;
    const a = i.a || i.variantA || "As-is (current experience).";
    const b = i.b || i.variantB || i.change || "";
    const why = i.why || i.hypothesis;
    const measure = i.kpi || i.measure;
    const guard = i.guardrails || i.guardrail;

    addKV("Priority", priorityText(i));
    addKV("Placement", i.placement);
    addKV("Test", test);
    if (why && String(why).length <= 140) addKV("Why", why);
    addKV("Control (A)", "No change. This is the current page (Control).");
    addKV("What exists today", a);
    addKV("Variant (B)", noobVariantText(i));
    addKV("How to do it (Target)", targetHowTo(i));
    addKV("Measure", measure);
    if (guard) addKV("Guardrail", guard);

    if (grid.childNodes.length) card.appendChild(grid);

    list.appendChild(card);
  });
}

function formatIdeaForClipboard(i, idx) {
  const title = i?.title || `Idea ${idx}`;
  const activityType = i?.activityType || "A/B";
  const audience = i?.audience || "All visitors";
  const placement = i?.placement || "";

  const test = i?.change || i?.test || title;
  const why = i?.why || i?.hypothesis || "";
  const a = i?.a || i?.variantA || "As-is (current experience).";
  const b = i?.b || i?.variantB || i?.change || "";
  const measure = i?.kpi || i?.measure || "";
  const guard = i?.guardrails || i?.guardrail || "";

  return [
    `Target Idea #${idx}: ${title}`,
    `Activity: ${activityType}`,
    `Priority: ${priorityText(i)}`,
    `Audience: ${audience}`,
    placement ? `Placement: ${placement}` : "",
    test ? `Test: ${test}` : "",
    (why && String(why).length <= 200) ? `Why: ${why}` : "",
    `Control (A): No change (current page).`,
    a ? `Current (reference): ${a}` : "",
    b ? `Variant (B): ${noobVariantText(i)}` : "",
    `How in Target: ${targetHowTo(i)}`,
    measure ? `Measure: ${measure}` : "",
    guard ? `Guardrail: ${guard}` : ""
  ].filter(Boolean).join("\n");
}


async function copyStrategistIdea(i, idx, btn) {
  const note = document.getElementById("strategistNote");
  try {
    await navigator.clipboard.writeText(formatIdeaForClipboard(i, idx));
    if (note) note.textContent = `Copied idea #${idx}.`;
    if (btn) {
      btn.classList.add("copied");
      const old = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => {
        btn.classList.remove("copied");
        btn.textContent = old;
      }, 900);
    }
  } catch (e) {
    console.error("Idea copy failed:", e);
    if (note) note.textContent = "Copy failed. Your browser may be blocking clipboard access in popups.";
  }
}

function setStrategistUi({ pageName, tooltip, showPill, note, suggestion, ideas } = {}) {
  const $name = document.getElementById("strategistPageName");
  const $pill = document.getElementById("strategistErrorPill");
  const $note = document.getElementById("strategistNote");
  const $sWrap = document.getElementById("strategistSuggestion");
  const $sText = document.getElementById("strategistSuggestionText");

  if ($name && pageName != null) $name.textContent = pageName;

  if ($pill) {
    $pill.classList.toggle("hidden", !showPill);
    if (tooltip != null) {
      $pill.setAttribute("data-tooltip", tooltip);
      const tip = String(tooltip || "");
      if (tip.trim()) $pill.setAttribute("title", tip);
      else $pill.removeAttribute("title");
    }
  }

  if ($note && note != null) $note.textContent = note;

  // Render cards (borders) + keep the raw text for Copy
  if (Array.isArray(ideas)) renderStrategistIdeas(ideas);

  if ($sText) {
    $sText.textContent = suggestion || "";
  }

  if ($sWrap) {
    const hasCards = Array.isArray(ideas) && ideas.length > 0;
    const hasText = !!(suggestion && suggestion.trim());
    $sWrap.style.display = (hasCards || hasText) ? "block" : "none";
  }
}


async function scanStrategist() {
  const tab = await getActiveTab();
  const $gen = document.getElementById("strategistGenerate");
  const $copy = document.getElementById("strategistCopy");

  // Default: disable until we know it's in-scope
  if ($gen) $gen.disabled = true;
  if ($copy) $copy.disabled = true;

  if (!tab?.id || !tab?.url) {
    strategistLast = null;
    updateStrategistStatusPills(null);
    setStrategistUi({
      pageName: "No active tab",
      showPill: false,
      note: "",
      suggestion: "",
      ideas: []
    });
    return null;
  }

  if (!isAllowedStrategistUrl(tab.url)) {
    strategistLast = null;
    updateStrategistStatusPills(null);
    setStrategistUi({
      pageName: "Out of scope (domain restricted)",
      showPill: false,
      note: "This tool only runs on AAA/ACG + Meemic domains (and Author).",
      suggestion: "",
      ideas: []
    });
    return null;
  }

  const hostname = hostnameFromUrl(tab.url);
  const env = detectEnv(hostname);
  const brand = detectBrand(hostname);

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => {
        // Build a short, fairly stable selector for VEC placement hints.
        function uniqueSelector(el) {
          if (!el || el.nodeType !== 1) return "";
          if (el.id) return `#${CSS.escape(el.id)}`;

          // Prefer data-testid style anchors if present
          const dataId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa');
          if (dataId) return `[data-testid="${CSS.escape(dataId)}"], [data-test="${CSS.escape(dataId)}"], [data-qa="${CSS.escape(dataId)}"]`;

          const parts = [];
          let cur = el;
          let depth = 0;
          while (cur && cur.nodeType === 1 && cur !== document.body && depth < 4) {
            let part = cur.tagName.toLowerCase();

            // class hint (single class only, avoid giant class soups)
            const cls = (cur.className || "").toString().trim().split(/\s+/).filter(Boolean);
            if (cls.length) {
              const keep = cls.find(c => /(^btn|cta|primary|hero|form|quote|start|submit)/i.test(c));
              if (keep) part += `.${CSS.escape(keep)}`;
            }

            // nth-of-type within parent to disambiguate
            const parent = cur.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(x => x.tagName === cur.tagName);
              if (siblings.length > 1) {
                const idx = siblings.indexOf(cur) + 1;
                part += `:nth-of-type(${idx})`;
              }
            }

            parts.unshift(part);
            cur = cur.parentElement;
            depth++;
          }
          return parts.join(' > ');
        }

        const dd = !!window.digitalData;
        const sObj = !!window.s;
        const alloy = !!(window.alloy || window.adobeDataLayer);
        const hasAt = !!(window.adobe && window.adobe.target);

        const pageName =
          window.digitalData?.page?.pageInfo?.pageName ||
          window.s?.pageName ||
          window.adobeDataLayer?.getState?.()?.page?.title ||
          document.title ||
          "";

        const pathname = window.location?.pathname || "";
        const h1El = document.querySelector('h1');
        const h1 = (h1El?.innerText || '').trim();
        const h1Selector = h1El ? uniqueSelector(h1El) : '';

        function bestCta() {
          const els = Array.from(document.querySelectorAll('a,button,input[type=submit],input[type=button]'));
          const out = [];
          for (const el of els) {
            let text = '';
            if (el.tagName === 'INPUT') text = (el.value || '').trim();
            else text = ((el.innerText || el.textContent || '') + '').trim();
            if (!text) continue;

            const cls = ((el.className || '') + '').toLowerCase();
            const t = text.toLowerCase();
            let score = 0;

            // Visible-ish? (offsetParent null often means display:none)
            if (el.offsetParent !== null) score += 2;

            // Favor common primary-CTA markers
            if (/(btn-primary|primary|cta|main|submit|continue)/.test(cls)) score += 4;
            if (/(get\s*a\s*quote|quote|pay|donate|start|next|continue|sign\s*in|log\s*in|enroll)/.test(t)) score += 4;

            // Prefer shorter actionable labels
            if (text.length > 0 && text.length <= 40) score += 2;

            // Slight preference for links with href
            let href = '';
            if (el.tagName === 'A') {
              href = el.href || '';
              if (href) score += 1;
            }

            const cs = window.getComputedStyle(el);
            out.push({
              score,
              text,
              href,
              tag: el.tagName,
              selector: uniqueSelector(el),
              style: {
                background: cs.backgroundColor || '',
                color: cs.color || '',
                border: cs.borderTopWidth ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : (cs.border || ''),
                fontSize: cs.fontSize || '',
                fontWeight: cs.fontWeight || '',
                padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
                borderRadius: cs.borderRadius || ''
              }
            });
          }

          out.sort((a, b) => b.score - a.score);
          return out[0] || { score: 0, text: '', href: '', tag: '', selector: '', style: { background:'', color:'', border:'', fontSize:'', fontWeight:'', padding:'', borderRadius:'' } };
        }

        const cta = bestCta();

        // Try to find a paragraph near the CTA (helpful for copy-replacement tests).
        function isVisible(el) {
          if (!el) return false;
          // offsetParent is null for display:none, but can be null for fixed positioned elements; also check rect.
          const r = el.getBoundingClientRect?.();
          return (el.offsetParent !== null) || (r && (r.width > 0 || r.height > 0));
        }

        function normText(t) {
          return String(t || '').replace(/\s+/g, ' ').trim();
        }

        function findParagraphNearSelector(sel) {
          try {
            if (!sel) return null;
            const el = document.querySelector(sel);
            if (!el) return null;

            // Walk up a few levels and look for a reasonably long <p>
            let cur = el;
            for (let d = 0; d < 5 && cur; d++) {
              const container = cur.closest('section,article,main,div,form') || cur.parentElement;
              if (container) {
                const ps = Array.from(container.querySelectorAll('p'))
                  .map(p => ({ p, text: normText(p.innerText || p.textContent || '') }))
                  .filter(x => x.text.length >= 40 && x.text.length <= 280 && isVisible(x.p));
                if (ps.length) {
                  const hit = ps[0].p;
                  return { text: normText(hit.innerText || hit.textContent || ''), selector: uniqueSelector(hit) };
                }
              }
              cur = cur.parentElement;
            }

            // Last resort: any paragraph on page (first non-empty)
            const any = Array.from(document.querySelectorAll('p'))
              .map(p => ({ p, text: normText(p.innerText || p.textContent || '') }))
              .find(x => x.text.length >= 40 && x.text.length <= 280 && isVisible(x.p));
            if (any) return { text: any.text, selector: uniqueSelector(any.p) };
          } catch (_) {}
          return null;
        }

        const ctaPara = findParagraphNearSelector(cta.selector);

        // Hero paragraph: a paragraph near the first H1 (common for quote landing pages)
        let heroPara = null;
        if (h1El) {
          const heroContainer = h1El.closest('section,article,main,div') || h1El.parentElement;
          if (heroContainer) {
            const ps = Array.from(heroContainer.querySelectorAll('p'))
              .map(p => ({ p, text: normText(p.innerText || p.textContent || '') }))
              .filter(x => x.text.length >= 40 && x.text.length <= 280 && isVisible(x.p));
            if (ps.length) {
              heroPara = { text: ps[0].text, selector: uniqueSelector(ps[0].p) };
            }
          }
        }
        const formCount = document.querySelectorAll('form').length;
        const firstForm = document.querySelector('form');
        const formSelector = firstForm ? uniqueSelector(firstForm) : '';

        // Page health: broken images + link quality (lightweight; no network crawling)
        function labelFor(el) {
          if (!el) return '';
          const t = ((el.innerText || el.textContent || '') + '').trim();
          if (t) return t.replace(/\s+/g, ' ').slice(0, 80);
          const aria = (el.getAttribute('aria-label') || '').trim();
          if (aria) return aria.replace(/\s+/g, ' ').slice(0, 80);
          const title = (el.getAttribute('title') || '').trim();
          if (title) return title.replace(/\s+/g, ' ').slice(0, 80);
          return '';
        }

        function safeUrl(u) {
          try {
            if (!u) return '';
            // URL constructor will resolve relative URLs against the document URL
            return new URL(u, document.baseURI).href;
          } catch (_) { return (u || '').trim(); }
        }

        const imgs = Array.from(document.images || []);
        let brokenImages = 0;
        const brokenImageSamples = [];
        for (const img of imgs) {
          const raw = (img.getAttribute('src') || '').trim();
          const src = (img.currentSrc || img.src || raw || '').trim();
          const resolved = safeUrl(src);
          const complete = !!img.complete;
          const nw = (img.naturalWidth || 0);

          // Common lazy-load attributes that can help identify the real intended src.
          const dataSrc = (img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || '').trim();
          const dataSrcset = (img.getAttribute('data-srcset') || '').trim();

          let reason = '';
          if (!src && !raw) {
            reason = dataSrc ? 'missing src (has data-src)' : 'missing src attribute';
          }
          else if (!complete) reason = 'still loading (or blocked)';
          else if (nw === 0) reason = 'failed to load (naturalWidth=0)';

          if (reason) {
            brokenImages++;
            if (brokenImageSamples.length < 5) {
              brokenImageSamples.push({
                reason,
                src: resolved || (dataSrc ? safeUrl(dataSrc) : '(no src)'),
                dataSrc: dataSrc ? safeUrl(dataSrc) : '',
                dataSrcset: dataSrcset ? dataSrcset.slice(0, 120) : '',
                alt: (img.getAttribute('alt') || '').trim().slice(0, 80),
                selector: uniqueSelector(img)
              });
            }
          }
        }

        const links = Array.from(document.querySelectorAll('a'));
        let placeholderLinks = 0;     // href="" or href="#"
        let javascriptLinks = 0;      // javascript:
        let missingAnchorLinks = 0;   // href="#something" but target doesn't exist
        const placeholderLinkSamples = [];
        const javascriptLinkSamples = [];
        const missingAnchorSamples = [];

        function isUiToggle(a) {
          if (!a) return false;
          // If it's in nav/header and is a placeholder, it's almost always a UI toggle.
          if (a.closest('nav,header') && ((a.getAttribute('href') || '').trim() === '#')) return true;
          const role = (a.getAttribute('role') || '').toLowerCase();
          if (role === 'button') return true;
          if (a.hasAttribute('onclick')) return true;
          if (a.hasAttribute('data-bs-toggle') || a.hasAttribute('data-toggle')) return true;
          if (a.hasAttribute('aria-controls') || a.hasAttribute('aria-expanded')) return true;

          // Any data-* attribute is a strong UI-toggle signal.
          try {
            const names = a.getAttributeNames ? a.getAttributeNames() : [];
            if (names.some(n => n.toLowerCase().startsWith('data-'))) return true;
          } catch (_) {}

          const cls = ((a.className || '') + '').toLowerCase();
          if (/(dropdown-toggle|accordion|collapse|tab|tabs|modal|offcanvas|menu|nav|hamburger|toggle|drawer|expand|chevron)/.test(cls)) return true;

          // Icon-only placeholders are usually toggles.
          const label = labelFor(a);
          if (!label && (a.querySelector('svg, img, i'))) return true;

          return false;
        }

        for (const a of links) {
          const hrefAttr = (a.getAttribute('href') || '').trim();
          const low = hrefAttr.toLowerCase();

          // javascript: links (generally not desirable for SEO/accessibility)
          if (low.startsWith('javascript:')) {
            javascriptLinks++;
            if (javascriptLinkSamples.length < 5) {
              javascriptLinkSamples.push({
                href: hrefAttr,
                text: labelFor(a),
                selector: uniqueSelector(a)
              });
            }
            continue;
          }

          // Empty or # placeholder links: ignore "UI toggles" so nav menus don't scream every page
          if (!hrefAttr || hrefAttr === '#') {
            if (!isUiToggle(a)) {
              placeholderLinks++;
              if (placeholderLinkSamples.length < 5) {
                placeholderLinkSamples.push({
                  href: hrefAttr || '(empty)',
                  text: labelFor(a),
                  selector: uniqueSelector(a)
                });
              }
            }
            continue;
          }

          // In-page anchors: check whether target exists
          if (hrefAttr.startsWith('#') && hrefAttr.length > 1) {
            const id = hrefAttr.slice(1);
            const hit = document.getElementById(id) || document.querySelector(`[name="${CSS.escape(id)}"]`);
            if (!hit) {
              missingAnchorLinks++;
              if (missingAnchorSamples.length < 5) {
                missingAnchorSamples.push({
                  href: hrefAttr,
                  text: labelFor(a),
                  selector: uniqueSelector(a)
                });
              }
            }
          }
        }

        const health = {
          imagesTotal: imgs.length,
          brokenImages,
          brokenImageSamples,
          linksTotal: links.length,
          placeholderLinks,
          javascriptLinks,
          missingAnchorLinks,
          placeholderLinkSamples,
          javascriptLinkSamples,
          missingAnchorSamples
        };

        return {
          pageName,
          pathname,
          h1,
          h1Selector,
          heroParaText: heroPara ? heroPara.text : '',
          heroParaSelector: heroPara ? heroPara.selector : '',
          ctaParaText: ctaPara ? ctaPara.text : '',
          ctaParaSelector: ctaPara ? ctaPara.selector : '',
          ctaText: cta.text,
          ctaHref: cta.href,
          ctaSelector: cta.selector,
          ctaStyle: cta.style || {},
          formCount,
          formSelector,
          health,
          dd,
          sObj,
          alloy,
          hasAt
        };
      }
    });

    const data = results?.[0]?.result || { pageName: "", dd: false, sObj: false, alloy: false, hasAt: false };
    const showPill = !data.dd && !data.sObj && !data.alloy;
    const tooltip = `digitalData: ${data.dd ? "✓" : "✗"}\ns-object: ${data.sObj ? "✓" : "✗"}\nWeb SDK: ${data.alloy ? "✓" : "✗"}\nTarget: ${data.hasAt ? "✓" : "?"}`;

    strategistLast = {
      url: tab.url,
      hostname,
      env,
      brand,
      pageName: (data.pageName || "No Page Name Found"),
      pathname: (data.pathname || ""),
      h1: (data.h1 || ""),
      h1Selector: (data.h1Selector || ""),
      heroParaText: (data.heroParaText || ""),
      heroParaSelector: (data.heroParaSelector || ""),
      ctaParaText: (data.ctaParaText || ""),
      ctaParaSelector: (data.ctaParaSelector || ""),
      ctaText: (data.ctaText || ""),
      ctaHref: (data.ctaHref || ""),
      ctaSelector: (data.ctaSelector || ""),
      ctaStyle: (data.ctaStyle || {}),
      formCount: Number.isFinite(+data.formCount) ? +data.formCount : 0,
      formSelector: (data.formSelector || ""),
      health: (data.health || {}),
      hasDD: data.dd,
      hasS: data.sObj,
      hasAlloy: data.alloy,
      hasAt: data.hasAt
    };

    updateStrategistStatusPills(strategistLast);
    setStrategistUi({
      pageName: strategistLast.pageName,
      tooltip,
      showPill,
      note: showPill ? "No Adobe signals were detected. This usually means instrumentation is missing or blocked." : "Signals look present.",
      suggestion: "",
      ideas: []
    });

    if ($gen) $gen.disabled = false;
    if ($copy) $copy.disabled = false;
    return strategistLast;
  } catch (e) {
    console.error("Strategist scan failed:", e);
    strategistLast = null;
    updateStrategistStatusPills(null);
    setStrategistUi({
      pageName: "Scan failed",
      showPill: false,
      note: (e?.message || String(e)),
      suggestion: "",
      ideas: []
    });
    return null;
  }
}

/* ---------- Target Strategist: custom idea storage ---------- */
async function loadCustomIdeaText() {
  try {
    const v = (await chrome.storage.sync.get([STRATEGIST_CUSTOM_KEY]))?.[STRATEGIST_CUSTOM_KEY];
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

async function saveCustomIdeaText(text) {
  try {
    await chrome.storage.sync.set({ [STRATEGIST_CUSTOM_KEY]: String(text || '') });
    return true;
  } catch {
    return false;
  }
}

function parseCustomIdeas(text) {
  const raw = (text || '').trim();
  if (!raw) return [];

  // JSON array of objects support
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(x => x && typeof x === 'object')
        .map(x => ({
          title: String(x.title || x.name || '').trim(),
          activityType: String(x.activityType || x.type || 'A/B').trim(),
          audience: String(x.audience || 'All visitors').trim(),
          placement: String(x.placement || '').trim(),
          hypothesis: String(x.hypothesis || '').trim(),
          variantA: String(x.variantA || x.a || '').trim(),
          variantB: String(x.variantB || x.b || '').trim(),
          kpi: String(x.kpi || x.primaryKpi || '').trim(),
          guardrails: String(x.guardrails || '').trim(),
          tags: Array.isArray(x.tags) ? x.tags.map(String) : []
        }))
        .filter(x => x.title);
    }
  } catch {
    // fall through to plain-text parsing
  }

  // Plain text: one idea per line
  return raw
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(line => ({
      title: line,
      activityType: 'A/B',
      audience: 'All visitors',
      placement: '',
      hypothesis: '',
      variantA: '',
      variantB: '',
      kpi: 'Quote start (or primary action)',
      guardrails: 'Bounce, errors, LCP/CLS',
      tags: ['custom']
    }));
}

function buildSuggestionsFromScan(s, opts = {}) {
  if (!s) return "";

  const url = s.url || "";
  const page = (s.pageName || "").trim();
  const brand = s.brand || "ACG/AAA";
  const env = s.env || "Production";
  const pathname = (s.pathname || "").trim();
  const h1 = (s.h1 || "").trim();
  const h1Selector = (s.h1Selector || "").trim();
  const ctaText = (s.ctaText || "").trim();
  const ctaHref = (s.ctaHref || "").trim();
  const ctaSelector = (s.ctaSelector || "").trim();
  const ctaStyle = (s.ctaStyle || {});
  const ctaBg = (ctaStyle.background || "").trim();
  const ctaFg = (ctaStyle.color || "").trim();

  const formCount = Number.isFinite(+s.formCount) ? +s.formCount : null;
  const formSelector = (s.formSelector || "").trim();

  const signals = [
    `digitalData: ${s.hasDD ? "✓" : "✗"}`,
    `s.pageName: ${s.hasS ? "✓" : "✗"}`,
    `Web SDK: ${s.hasAlloy ? "✓" : "✗"}`,
    `Target: ${s.hasAt ? "✓" : "?"}`
  ].join(" | ");

  const h = s.health || {};
  const brokenImages = Number.isFinite(+h.brokenImages) ? +h.brokenImages : 0;

  const placeholderLinks = Number.isFinite(+h.placeholderLinks) ? +h.placeholderLinks : 0;
  const javascriptLinks = Number.isFinite(+h.javascriptLinks) ? +h.javascriptLinks : 0;
  const missingAnchorLinks = Number.isFinite(+h.missingAnchorLinks) ? +h.missingAnchorLinks : 0;
  const linkIssues = placeholderLinks + javascriptLinks + missingAnchorLinks;

  const healthLine = (brokenImages === 0 && linkIssues === 0)
    ? 'Health: OK (no broken images or link issues detected)'
    : `Health: ⚠ ${brokenImages} broken image(s), ${missingAnchorLinks} broken anchor(s), ${placeholderLinks} placeholder link(s), ${javascriptLinks} javascript: link(s)`;

  const hay = `${page} ${pathname} ${h1} ${ctaText}`.toLowerCase();
  const inferredQuote = /quote|get\s*a\s*quote|start\s*quote|auto\s*quote|home\s*quote|bundle|insurance/.test(hay);
  const isMembership = /membership|join|renew|roadside|tow|member/.test(hay);
  const isBilling = /pay|billing|payment|autopay|paperless|invoice/.test(hay);
  const isDonate = /donate|donation|give|foundation|grant/.test(hay);
  const isLogin = /login|log\s*in|sign\s*in|account/.test(hay);
  const isTravel = /travel|hotel|cruise|vacation|trip|rental\s*car|tour/.test(hay);
  const isDiscounts = /discount|deal|savings|ticket|restaurant|entertainment/.test(hay);
  const isContent = /blog|article|guide|connect|story|publication|webcast|podcast/.test(hay);
  const isSearchOrNav = /search|find|locations|agents|contact/.test(hay);

  const inferredPageType = inferredQuote ? 'quote'
    : (isMembership ? 'membership'
    : (isBilling ? 'billing'
    : (isDonate ? 'donate'
    : (isLogin ? 'login'
    : (isTravel ? 'travel'
    : (isDiscounts ? 'discounts'
    : (isContent ? 'content'
    : (isSearchOrNav ? 'nav' : 'generic'))))))));

  const requestedPageType = String(opts.pageType || 'auto').toLowerCase();
  const pageType = (!requestedPageType || requestedPageType === 'auto') ? inferredPageType : requestedPageType;
  const goal = String(opts.goal || 'conversion').toLowerCase();

  const ideaCount = Math.max(3, Math.min(50, parseInt(opts.ideaCount ?? 18, 10) || 18));
  const includeCustom = !!opts.includeCustom;
  const customIdeas = Array.isArray(opts.customIdeas) ? opts.customIdeas : [];

  const activityNotes = [
    "Implementation: Prefer VEC for simple HTML/text swaps; use Form-based for complex logic or SPA where selectors churn.",
    "QA: Use Target QA mode and validate analytics events fire for each experience.",
    "Guardrail: Watch performance (CLS/LCP) and error rate. Experiments that slow pages quietly poison results."
  ].join(" ");

  const checklist = [
    "Tracking checklist (quick):",
    "- Confirm Target is delivering (QA mode / response tokens)",
    "- Confirm analytics hit(s) fire for impressions + primary action",
    "- Define success metric in Target and align with Adobe Analytics/Launch if needed",
    "- Set guardrails (bounce, errors, latency, form abandon)"
  ].join("\n");

  function ideaLine(i) {
    const title = i.title || 'Idea';
    const activityType = i.activityType || 'A/B';
    const audience = i.audience || 'All visitors';
    const placement = i.placement || '';

    const test = i.change || i.test || title;
    const why = i.why || i.hypothesis || '';
    const a = i.a || i.variantA || 'As-is (Control).';
    const b = i.b || i.variantB || i.change || 'Proposed (Variant).';
    const measure = i.kpi || i.measure || 'Primary action rate';
    const guard = i.guardrails || i.guardrail || '';

    return [
      `• ${title}`,
      `  Activity: ${activityType} | Priority: ${priorityText(i)} | Audience: ${audience}`,
      placement ? `  Placement: ${placement}` : '',
      `  Test: ${test}`,
      (why && String(why).length <= 140) ? `  Why: ${why}` : '',
      `  Control (A): No change (current page).`,
      a ? `  Current (reference): ${a}` : '' ,
      `  Variant (B): ${noobVariantText(i)}`,
      `  How (Target): ${targetHowTo(i)}`,
      `  Measure: ${measure}`,
      guard ? `  Guardrail: ${guard}` : ''
    ].filter(Boolean).join("\n");
  }

  const placementHint = (() => {
    const bits = [];
    if (h1) bits.push(`H1: "${h1}"`);
    if (ctaText) bits.push(`Primary CTA: "${ctaText}"`);
    if (ctaHref) bits.push(`CTA href: ${ctaHref}`);
    if (formCount != null) bits.push(`Forms detected: ${formCount}`);
    return bits.length ? bits.join(" | ") : "(No obvious CTA/H1 detected)";
  })();

  // Deterministic shuffle so it doesn't feel random-chaotic from click to click.
  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function() {
      let t = (a += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffleDeterministic(arr, seedStr) {
    const out = arr.slice();
    const rnd = mulberry32(hashString(seedStr));
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // --- Idea pools (Target-ready) ---
  const universalIdeas = [
    {
      title: "Hero value prop + CTA clarity",
      activityType: "A/B (or Auto-Allocate)",
      audience: "All visitors",
      placement: placementHint,
      hypothesis: "Clearer benefits and a single primary action will increase engagement and downstream conversions.",
      variantA: "Current hero headline/subhead/CTA.",
      variantB: "Benefit-led headline + 1 proof point + simplified CTA label (action verb).",
      kpi: "CTA click-through",
      guardrails: "Bounce, scroll depth, LCP/CLS",
      tags: ["universal"]
    },
    {
      title: "Trust cue injection (proof right before action)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Near primary CTA / form start",
      hypothesis: "Adding reassurance near the decision point reduces hesitation and increases starts/completions.",
      variantA: "Current page without extra proof.",
      variantB: "Add 1 trust module: rating, member count, coverage note, privacy reassurance.",
      kpi: "Primary action starts",
      guardrails: "Support clicks, errors",
      tags: ["universal"]
    },
    {
      title: "Mobile sticky CTA (reduce hunting)",
      activityType: "A/B",
      audience: "Mobile visitors",
      placement: "Mobile viewport only",
      hypothesis: "Keeping the main action available on mobile increases action rate without extra scrolling.",
      variantA: "No sticky CTA.",
      variantB: "Sticky bottom bar with the primary CTA (optional secondary: phone/help).",
      kpi: "Mobile CTA click-through",
      guardrails: "Accidental clicks, bounce",
      tags: ["universal","mobile"]
    },
    {
      title: "New vs returning messaging",
      activityType: "Experience Targeting (XT)",
      audience: "New vs returning",
      placement: "Hero module",
      hypothesis: "Tailoring messaging to user context will increase conversion.",
      variantA: "One message for everyone.",
      variantB: "New: trust + value. Returning: speed + resume/continue.",
      kpi: "Primary action starts",
      guardrails: "Bounce, time on page",
      tags: ["universal"]
    },
    {
      title: "Auto-Target: optimize headline/CTA mix",
      activityType: "Auto-Target",
      audience: "All visitors",
      placement: "Hero module",
      hypothesis: "Letting Auto-Target learn the best message improves conversion without manual winner picking.",
      variantA: "Current hero copy.",
      variantB: "3-5 headline/CTA combos (benefit-led) in Auto-Target.",
      kpi: "Primary action starts",
      guardrails: "Bounce, performance metrics",
      tags: ["universal"]
    }
  ];

  const quoteIdeas = [
    {
      title: "CTA button color (high contrast)",
      activityType: "A/B",
      audience: "All visitors",
      placement: ctaSelector ? `Primary CTA button (${ctaSelector})` : (ctaText ? `Primary CTA (${ctaText})` : "Primary CTA button"),
      change: "Change primary CTA button color",
      variantA: "Current button color/style.",
      variantB: ctaBg ? `Change the CTA button background from ${ctaBg} to a noticeably different accent color (example: #FF7A00). Keep the text color white.` : "Change the CTA button background to a noticeably different accent color (example: #FF7A00). Keep the text color white.",
      kpi: "CTA clicks → quote starts",
      guardrails: "Bounce, misclicks",
      tags: ["quote","cta","color"]
    },
    {
      title: "CTA button size + weight",
      activityType: "A/B",
      audience: "All visitors",
      placement: ctaSelector ? `Primary CTA button (${ctaSelector})` : "Primary CTA button",
      change: "Make primary CTA more prominent",
      variantA: "Current button size.",
      variantB: "Increase padding/font-weight; add subtle icon (arrow) if on-brand.",
      kpi: "CTA clicks",
      guardrails: "Misclicks, bounce",
      tags: ["quote","cta","ux"]
    },
    {
      title: "Primary CTA copy (price language)",
      activityType: "A/B",
      audience: "All visitors",
      placement: ctaText ? `CTA label (currently: "${ctaText}")` : "Primary CTA label",
      change: "Swap CTA wording to price/benefit intent",
      variantA: ctaText ? `"${ctaText}"` : "Current label",
      variantB: "Try: 'See my price' or 'Start my quote'.",
      kpi: "CTA clicks → quote starts",
      guardrails: "Bounce",
      tags: ["quote","cta","copy"]
    },
    {
      title: "Secondary CTA style (agent/call)",
      activityType: "A/B",
      audience: "Mobile visitors",
      placement: "Near primary CTA",
      change: "Add a secondary help path without stealing focus",
      variantA: "Single primary CTA.",
      variantB: "Add secondary outline link: 'Talk to an agent' (click-to-call).",
      kpi: "Quote starts + calls",
      guardrails: "Cannibalization of online starts",
      tags: ["quote","mobile","assist"]
    },
    {
      title: "Microcopy under CTA (2 bullets)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Under the primary CTA",
      change: "Add reassurance microcopy",
      variantA: "No reassurance text.",
      variantB: "Add: 'No obligation' + 'We respect your privacy'.",
      kpi: "Quote starts",
      guardrails: "Downstream completion",
      tags: ["quote","trust","copy"]
    },
    {
      title: "ZIP-first start (single input)",
      activityType: "A/B",
      audience: "All visitors",
      placement: formSelector ? `Quote start form (${formSelector})` : "Quote start module",
      change: "Ask for ZIP first, then expand",
      variantA: "Full form on step 1.",
      variantB: "Step 1 asks ZIP (optional: state) then expands to the full form.",
      kpi: "Step-1 completion",
      guardrails: "Total completion rate",
      tags: ["quote","form"]
    },
    {
      title: "Remove phone/email from step 1",
      activityType: "A/B",
      audience: "All visitors",
      placement: formSelector ? `Quote form fields (${formSelector})` : "Quote form",
      change: "Move contact fields later",
      variantA: "Phone/email required early.",
      variantB: "Collect phone/email after price/coverage preview (or later step).",
      kpi: "Quote starts → completion",
      guardrails: "Lead quality (if tracked)",
      tags: ["quote","form","friction"]
    },
    {
      title: "Progress bar: Step 1 of 3",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Quote flow header",
      change: "Show progress + time expectation",
      variantA: "No progress/time hint.",
      variantB: "Add: 'Step 1 of 3' + '~2 minutes'.",
      kpi: "Completion rate",
      guardrails: "Time to complete",
      tags: ["quote","flow"]
    },
    {
      title: "Inline error copy (examples)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Quote form validation",
      change: "Make validation messages actionable",
      variantA: "Generic error text.",
      variantB: "Add examples (ZIP format, date format) and friendly tone.",
      kpi: "Form submit success",
      guardrails: "Error rate",
      tags: ["quote","form","validation"]
    },
    {
      title: "Repeat CTA mid-page",
      activityType: "A/B",
      audience: "All visitors",
      placement: "After first info block",
      change: "Add a second CTA after benefits",
      variantA: "Single CTA above fold.",
      variantB: "Add another 'Start quote' button mid-page.",
      kpi: "Quote starts",
      guardrails: "Misclicks",
      tags: ["quote","cta"]
    },
    // More "to the point" quote tests (Target VEC-friendly)
    {
      title: "CTA button style (filled vs outline)",
      activityType: "A/B",
      audience: "All visitors",
      placement: ctaSelector ? `CTA button (${ctaSelector})` : "Primary CTA button",
      change: "Test filled primary button vs outline style",
      variantA: "Current button style",
      variantB: "Filled high-contrast button + slightly larger padding + stronger hover state",
      kpi: "CTA clicks",
      guardrails: "Accidental clicks, CLS",
      tags: ["quote","cta","ui"]
    },
    {
      title: "CTA copy: price language",
      activityType: "A/B",
      audience: "All visitors",
      placement: ctaText ? `Primary CTA (currently: "${ctaText}")` : "Primary CTA",
      change: "Use price/estimate language instead of generic quote language",
      variantA: ctaText ? `CTA: "${ctaText}"` : "Current CTA label",
      variantB: "CTA: 'See my price' (or 'Get my estimate')",
      kpi: "CTA clicks → quote starts",
      guardrails: "Bounce",
      tags: ["quote","cta","copy"]
    },
    {
      title: "Form friction: move phone/email later",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Quote flow step 1",
      change: "Remove phone/email from step 1 and collect later",
      variantA: "Step 1 asks for contact info",
      variantB: "Step 1 collects only ZIP + basic vehicle/home info; ask contact later",
      kpi: "Step 1 completion",
      guardrails: "Total completion rate",
      tags: ["quote","form","friction"]
    },
    {
      title: "Trust microcopy under CTA",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Under primary CTA",
      change: "Add 1 short reassurance line under the CTA",
      variantA: "No reassurance under CTA",
      variantB: "Add: 'No spam. No obligation.' (or 'Takes ~2 minutes')",
      kpi: "Quote starts",
      guardrails: "Completion rate",
      tags: ["quote","trust","copy"]
    },
    {
      title: "Sticky CTA on quote pages",
      activityType: "A/B",
      audience: "Mobile visitors",
      placement: "Mobile only",
      change: "Add sticky bottom CTA",
      variantA: "No sticky CTA",
      variantB: "Sticky bottom bar with 'Start my quote' (and optional 'Call an agent')",
      kpi: "Mobile quote starts",
      guardrails: "Accidental taps, bounce",
      tags: ["quote","mobile","cta"]
    },
    {
      title: "Step header: expectations",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Quote flow header",
      change: "Add a short expectation line and step count",
      variantA: "No step expectations",
      variantB: "Show 'Step 1 of 3' + 'Have your vehicle info handy'",
      kpi: "Quote completion",
      guardrails: "Time to complete",
      tags: ["quote","flow"]
    },
    {
      title: "Hero swap: image vs icon",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Hero module",
      change: "Swap hero visual to reduce distraction and increase CTA focus",
      variantA: "Current hero image",
      variantB: "Simpler visual (icon/illustration) + tighter copy + CTA prominence",
      kpi: "CTA clicks",
      guardrails: "Engagement drop",
      tags: ["quote","hero","design"]
    },

    {
      title: "Quote-start friction reducer (time + privacy)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Above the fold",
      hypothesis: "Lower perceived effort and privacy concerns increases quote starts.",
      variantA: "Current quote start messaging.",
      variantB: "Add: 'Takes ~2 minutes' + privacy reassurance + one primary CTA.",
      kpi: "Quote starts",
      guardrails: "Quote completion, errors",
      tags: ["quote"]
    },
    {
      title: "CTA label test (intent language)",
      activityType: "A/B",
      audience: "All visitors",
      placement: ctaText ? `Primary CTA (currently: "${ctaText}")` : "Primary CTA",
      hypothesis: "More specific action language increases clicks.",
      variantA: ctaText ? `CTA label: "${ctaText}"` : "Current CTA label",
      variantB: ctaText ? `Change the CTA button text from "${ctaText}" to ONE of these (pick one): "See my price" or "Start my quote".` : "Change the CTA button text to ONE of these (pick one): \"See my price\" or \"Start my quote\".",
      kpi: "CTA click-through",
      guardrails: "Bounce, misclicks",
      tags: ["quote"]
    },
    {
      title: "ZIP-first start (progressive disclosure)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Quote start module",
      hypothesis: "Asking for a low-effort input first increases flow starts.",
      variantA: "Full first step form.",
      variantB: "Step 1 only asks ZIP (and maybe state), then expands.",
      kpi: "Step 1 completion",
      guardrails: "Total completion rate, errors",
      tags: ["quote","form"]
    },
    {
      title: "Progress indicator + expectations",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Quote flow header",
      hypothesis: "Setting expectations reduces abandonment.",
      variantA: "No progress indicator.",
      variantB: "Add 'Step 1 of 3' + short explanation of what's needed.",
      kpi: "Quote completion",
      guardrails: "Time to complete, errors",
      tags: ["quote","flow"]
    },
    {
      title: "Inline validation / error copy",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Quote form fields",
      hypothesis: "Clearer errors reduce retries and drop-offs.",
      variantA: "Current validation messaging.",
      variantB: "Add examples (e.g., ZIP format) and friendly error text.",
      kpi: "Form submit success",
      guardrails: "Error rate, support clicks",
      tags: ["quote","form"]
    },
    {
      title: "Bundle framing (anchoring)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Hero/offer module",
      hypothesis: "Showing bundle value earlier increases quote intent.",
      variantA: "Generic quote CTA.",
      variantB: "Add bundle callout + benefit bullets (no unapproved pricing promises).",
      kpi: "Quote starts",
      guardrails: "Compliance review, bounce",
      tags: ["quote"]
    },
    {
      title: "Trust badge: 'No spam' + 'No obligation'",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Near quote start button",
      hypothesis: "Reducing perceived risk increases starts.",
      variantA: "No reassurance.",
      variantB: "Add two microcopy lines: 'No obligation' + 'We respect your inbox'.",
      kpi: "Quote starts",
      guardrails: "Downstream completion",
      tags: ["quote"]
    },
    {
      title: "Phone assist vs online (segmented)",
      activityType: "Experience Targeting (XT)",
      audience: "Mobile visitors OR high-intent returners",
      placement: "Primary CTA area",
      hypothesis: "Offering the right help path increases overall conversion.",
      variantA: "Single online CTA.",
      variantB: "Add secondary: 'Talk to an agent' (click-to-call) with subtle styling.",
      kpi: "Quote starts + calls",
      guardrails: "Cannibalization of online completions",
      tags: ["quote","mobile"]
    },
    {
      title: "Social proof (localized)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Above fold or near form",
      hypothesis: "Relevant proof increases confidence.",
      variantA: "No proof.",
      variantB: "Add: rating snippet / member count / 'Serving \"your state\"' line.",
      kpi: "Quote starts",
      guardrails: "Scroll depth, bounce",
      tags: ["quote"]
    },
    {
      title: "Auto-Allocate: optimize CTA placement",
      activityType: "Auto-Allocate",
      audience: "All visitors",
      placement: "Hero / navigation",
      hypothesis: "One placement will outperform others on starts.",
      variantA: "CTA in current location.",
      variantB: "Test CTA placement: hero vs sticky vs mid-page repeat.",
      kpi: "Quote starts",
      guardrails: "Bounce, accidental clicks",
      tags: ["quote"]
    },
    {
      title: "Reduce distractions (nav density)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Top nav / header",
      hypothesis: "Fewer competing actions increases the primary action rate.",
      variantA: "Full nav.",
      variantB: "Simplified header (keep essentials) during quote start page.",
      kpi: "Quote starts",
      guardrails: "Return to nav tasks, bounce",
      tags: ["quote"]
    },
    {
      title: "Speed perception: 'Save and finish later'",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Quote flow header",
      hypothesis: "Reducing anxiety about completion increases starts.",
      variantA: "No mention of saving.",
      variantB: "Add microcopy: 'You can save and finish later'.",
      kpi: "Quote starts",
      guardrails: "Completion rate",
      tags: ["quote","flow"]
    },
    {
      title: "Help tooltips (why we ask)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Form fields",
      hypothesis: "Explaining 'why' reduces drop-off at sensitive fields.",
      variantA: "Standard labels.",
      variantB: "Add short 'why we ask' helper for 1-2 high-friction fields.",
      kpi: "Field completion / step completion",
      guardrails: "Time to complete",
      tags: ["quote","form"]
    },
    {
      title: "Offer framing: membership benefits",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Hero subhead",
      hypothesis: "Benefit framing increases intent to start.",
      variantA: "Generic value prop.",
      variantB: "Add 2-3 benefit bullets (coverage, service, savings).",
      kpi: "Quote starts",
      guardrails: "Bounce",
      tags: ["quote"]
    },
    {
      title: "Auto-Target: choose the best objection killer",
      activityType: "Auto-Target",
      audience: "All visitors",
      placement: "Near quote start",
      hypothesis: "Different visitors respond to different reassurance.",
      variantA: "Current messaging.",
      variantB: "3-5 reassurance variants: price, privacy, speed, agent help.",
      kpi: "Quote starts",
      guardrails: "Completion rate",
      tags: ["quote"]
    },
    {
      title: "Add secondary CTA to continue saved quote (returners)",
      activityType: "XT",
      audience: "Returning visitors",
      placement: "Hero / CTA area",
      hypothesis: "Helping returners resume increases completion.",
      variantA: "Only start CTA.",
      variantB: "Add 'Continue my quote' secondary action for returners.",
      kpi: "Quote completion",
      guardrails: "New visitor starts",
      tags: ["quote","flow"]
    },
    {
      title: "Above-fold CTA duplication (for long heroes)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Hero area",
      hypothesis: "Repeating the CTA after key info increases starts on long hero layouts.",
      variantA: "Single CTA location.",
      variantB: "Duplicate CTA after benefits block (same destination).",
      kpi: "Quote starts",
      guardrails: "Accidental clicks, bounce",
      tags: ["quote"]
    },
    {
      title: "Benefit bullet order test (price vs service vs trust)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Hero bullets",
      hypothesis: "Leading with the best matching benefit increases intent.",
      variantA: "Current bullet order.",
      variantB: "Reorder bullets to lead with 1) savings, 2) coverage confidence, 3) local help.",
      kpi: "Quote starts",
      guardrails: "Bounce",
      tags: ["quote"]
    },
    {
      title: "Trust stack near CTA (security + privacy + legitimacy)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Near CTA",
      hypothesis: "A compact trust stack reduces fear and boosts starts.",
      variantA: "No trust stack.",
      variantB: "Add 2-3 small trust cues (Secure, Privacy, Trusted/Member-owned style messaging as approved).",
      kpi: "Quote starts",
      guardrails: "Scroll depth",
      tags: ["quote"]
    },
    {
      title: "Micro-commitment copy: 'Check my rate' vs 'Get a quote'",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Primary CTA",
      hypothesis: "Lower-commitment wording increases clicks.",
      variantA: ctaText ? `Current CTA: \"${ctaText}\"` : "Current CTA label",
      variantB: "Test softer phrasing: 'Check my rate' / 'See my options'",
      kpi: "CTA click-through",
      guardrails: "Quote completion",
      tags: ["quote"]
    },
    {
      title: "Remove competing CTAs (one job, one button)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Above the fold",
      hypothesis: "Reducing competing actions increases primary starts.",
      variantA: "Multiple CTAs (call/chat/learn more) competing.",
      variantB: "Single primary CTA + subtle help link (secondary).",
      kpi: "Quote starts",
      guardrails: "Support contacts",
      tags: ["quote"]
    },
    {
      title: "Agent help as an objection-killer (not a detour)",
      activityType: "A/B",
      audience: "Mobile or high-friction visitors",
      placement: "Near CTA",
      hypothesis: "Offering help as reassurance increases starts without diverting intent.",
      variantA: "No help mention.",
      variantB: "Add a small line: 'Need help? Talk to an agent' (kept secondary).",
      kpi: "Quote starts",
      guardrails: "Call click-through vs online completion",
      tags: ["quote","mobile"]
    },
    {
      title: "Inline 'why we ask' on 1 sensitive field",
      activityType: "A/B",
      audience: "All visitors",
      placement: "First sensitive field",
      hypothesis: "One short explanation reduces abandonment at the friction point.",
      variantA: "No explanation.",
      variantB: "Add a one-liner tooltip: 'We use this to match the right discounts' (as approved).",
      kpi: "Step completion",
      guardrails: "Time-to-complete",
      tags: ["quote","form"]
    },
    {
      title: "Field density test (2-column vs single column)",
      activityType: "A/B",
      audience: "Desktop visitors",
      placement: "Quote step 1",
      hypothesis: "A simpler layout reduces cognitive load and increases completion.",
      variantA: "Two-column (dense) layout.",
      variantB: "Single-column with clear grouping and spacing.",
      kpi: "Step completion",
      guardrails: "Time-to-complete",
      tags: ["quote","form"]
    },
    {
      title: "Pre-submit reassurance (what happens next)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Just above submit",
      hypothesis: "Clarifying the next step reduces hesitation at submit.",
      variantA: "No 'next step' cue.",
      variantB: "Add: 'Next: we’ll show options' / 'Next: choose coverage' (no promises beyond reality).",
      kpi: "Form submit",
      guardrails: "Drop-off later in flow",
      tags: ["quote","flow"]
    },
    {
      title: "Contrast test on CTA button styling",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Primary CTA",
      hypothesis: "Higher visual salience increases clicks.",
      variantA: "Current button style.",
      variantB: "Increase contrast (color/size) and add icon (optional) while meeting brand guidelines.",
      kpi: "CTA click-through",
      guardrails: "Accessibility (contrast), bounce",
      tags: ["quote"]
    },
    {
      title: "Urgency without pressure (seasonal hook)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Hero subhead",
      hypothesis: "A gentle seasonal hook can increase intent.",
      variantA: "No seasonal messaging.",
      variantB: "Add a light hook (e.g., 'New year, new savings') if approved.",
      kpi: "Quote starts",
      guardrails: "Brand/compliance review",
      tags: ["quote"]
    },
    {
      title: "Exit-intent rescue (desktop) or back-button intercept (mobile)",
      activityType: "A/B",
      audience: "High intent abandoners",
      placement: "On exit/back",
      hypothesis: "Offering a save/assist path recovers abandoners.",
      variantA: "No rescue.",
      variantB: "Offer: save progress, call agent, or quick FAQ.",
      kpi: "Recovered starts / resumes",
      guardrails: "Annoyance signals (bounce, complaints)",
      tags: ["quote","flow"]
    },
    {
      title: "FAQ micro-module: answer 2 common objections",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Under CTA",
      hypothesis: "Answering objections reduces hesitation.",
      variantA: "No FAQ.",
      variantB: "Add 2 expandable FAQs (privacy, time, what you’ll need).",
      kpi: "Quote starts",
      guardrails: "Page length, performance",
      tags: ["quote"]
    },
    {
      title: "Image vs no-image (focus test)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Hero",
      hypothesis: "Reducing visual noise can improve clarity and clicks.",
      variantA: "Current hero image.",
      variantB: "Simplify or remove hero image; emphasize headline + CTA.",
      kpi: "CTA click-through",
      guardrails: "Brand sentiment, bounce",
      tags: ["quote"]
    },
    {
      title: "Sticky progress (flow pages)",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Flow header",
      hypothesis: "Always-visible progress reduces abandonment.",
      variantA: "Static progress indicator.",
      variantB: "Sticky progress bar on scroll (mobile + desktop).",
      kpi: "Flow completion",
      guardrails: "CLS, performance",
      tags: ["quote","flow","mobile"]
    },
    {
      title: "Save vs submit wording at key step",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Flow CTA",
      hypothesis: "Clearer button labels reduce hesitation.",
      variantA: "Generic 'Continue'.",
      variantB: "More specific: 'Continue to coverage' / 'Continue to details'.",
      kpi: "Step completion",
      guardrails: "Confusion signals (back clicks)",
      tags: ["quote","flow"]
    }
  ];

  const billingIdeas = [
    {
      title: "Autopay benefit nudges",
      activityType: "A/B",
      audience: "Eligible users",
      placement: "Payment summary area",
      hypothesis: "Clear benefits and reduced distractions increase autopay enrollment and successful payments.",
      variantA: "Current payment page.",
      variantB: "Add short benefit bullets + emphasize primary action + demote secondary links.",
      kpi: "Successful payments / autopay enroll",
      guardrails: "Support clicks, errors",
      tags: ["billing"]
    },
    {
      title: "Due date + amount banner up top",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Top of billing page",
      hypothesis: "Surfacing the due date and amount immediately reduces scanning and late payments.",
      variantA: "Due date/amount only inside the account summary.",
      variantB: "Add a banner at the top of the page with due date, amount, and a direct Pay Now link.",
      kpi: "On-time payments",
      guardrails: "Support clicks",
      tags: ["billing"]
    },
    {
      title: "One-click 'Pay in full' shortcut",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Payment options",
      hypothesis: "A single-click full-payment path reduces drop-off versus the multi-step flow.",
      variantA: "Standard multi-step payment flow for every payment type.",
      variantB: "Add a 'Pay in full now' shortcut button above the standard flow for eligible balances.",
      kpi: "Payment completion rate",
      guardrails: "Partial-payment usage, errors",
      tags: ["billing", "flow"]
    },
    {
      title: "Simplify payment method selector",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Payment method step",
      hypothesis: "Fewer visible choices at once reduces hesitation on the payment method step.",
      variantA: "All payment methods shown expanded at once.",
      variantB: "Show the last-used method first; collapse other methods under 'Use a different method'.",
      kpi: "Step completion",
      guardrails: "Method-switch rate, errors",
      tags: ["billing", "form"]
    },
    {
      title: "Progress indicator on multi-step payment",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Payment flow header",
      hypothesis: "Showing how many steps remain reduces mid-flow abandonment.",
      variantA: "No step indicator.",
      variantB: "Add a simple 'Step 2 of 3' progress indicator to the payment flow.",
      kpi: "Flow completion rate",
      guardrails: "Back-button usage",
      tags: ["billing", "flow", "form"]
    },
    {
      title: "Security trust badge near card entry",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Near card number field",
      hypothesis: "Visible security reassurance right at the sensitive field reduces hesitation to submit.",
      variantA: "Card entry with no nearby reassurance.",
      variantB: "Add a small 'Secure payment' badge/lock icon directly above the card field.",
      kpi: "Payment starts / completion",
      guardrails: "Support clicks",
      tags: ["billing", "trust"]
    },
    {
      title: "Itemized amount breakdown",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Payment summary",
      hypothesis: "A clear breakdown of what's owed and why reduces confusion-driven support calls.",
      variantA: "Single total amount shown.",
      variantB: "Add a short itemized breakdown (premium, fees, prior balance) above the total.",
      kpi: "Support contact rate, payment completion",
      guardrails: "Time on page",
      tags: ["billing", "copy"]
    },
    {
      title: "Clearer error messaging on failed payments",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Payment error state",
      hypothesis: "Specific, actionable error copy reduces repeat failed attempts and abandonment.",
      variantA: "Generic 'Payment failed, try again' message.",
      variantB: "Specific message per failure type (declined, expired card, invalid CVV) with a clear next step.",
      kpi: "Retry success rate",
      guardrails: "Support clicks",
      tags: ["billing", "copy"]
    },
    {
      title: "Mobile sticky 'Pay Now' bar",
      activityType: "A/B",
      audience: "Mobile visitors",
      placement: "Mobile viewport only",
      hypothesis: "Keeping payment action available on mobile reduces hunting and abandonment.",
      variantA: "No sticky action on mobile.",
      variantB: "Sticky bottom bar with amount due and a Pay Now button.",
      kpi: "Mobile payment completion",
      guardrails: "Accidental taps",
      tags: ["billing", "mobile"]
    },
    {
      title: "High-contrast primary payment button",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Payment summary CTA",
      hypothesis: "A higher-contrast primary button draws the eye to the intended action first.",
      variantA: "Current button color/contrast.",
      variantB: "Higher-contrast button color for the primary payment action only.",
      kpi: "Primary action click-through",
      guardrails: "None expected; visual-only change",
      tags: ["billing", "color"]
    }
  ];

  const donateIdeas = [
    {
      title: "Impact ladder + suggested amounts",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Donation module",
      hypothesis: "Concrete impact framing increases donation starts and average gift.",
      variantA: "Generic ask.",
      variantB: "Preset amounts with impact descriptions + default suggested amount.",
      kpi: "Donation starts / completed donations",
      guardrails: "Completion rate",
      tags: ["donate"]
    },
    {
      title: "Monthly giving as the default toggle",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Donation module",
      hypothesis: "Defaulting to monthly (with an easy one-time switch) increases recurring donor sign-ups.",
      variantA: "One-time donation selected by default.",
      variantB: "Monthly selected by default, with a clear 'switch to one-time' option.",
      kpi: "Recurring donation starts",
      guardrails: "Total donation starts, opt-out rate",
      tags: ["donate"]
    },
    {
      title: "Where your donation goes module",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Near donation form",
      hypothesis: "Transparency about fund use increases trust and completed donations.",
      variantA: "No breakdown of fund use near the ask.",
      variantB: "Add a short module: 'X% goes directly to Y' with 2-3 concrete impact bullets.",
      kpi: "Donation completion rate",
      guardrails: "Time on page",
      tags: ["donate", "trust"]
    },
    {
      title: "Simplify donation form to fewer fields",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Donation form",
      hypothesis: "Fewer required fields up front reduces abandonment on the donation form.",
      variantA: "Full billing/contact form shown at once.",
      variantB: "Amount + payment first; defer optional fields (employer match, dedication) to a second step.",
      kpi: "Form completion rate",
      guardrails: "Data completeness for optional fields",
      tags: ["donate", "form"]
    },
    {
      title: "Employer match reminder",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Donation form / confirmation",
      hypothesis: "Reminding donors their gift may be matched increases perceived impact and repeat giving.",
      variantA: "No mention of employer matching.",
      variantB: "Add a short note: 'Your gift may be matched by your employer' with a lookup link.",
      kpi: "Match lookup clicks",
      guardrails: "None expected",
      tags: ["donate", "content"]
    },
    {
      title: "In honor / in memory option surfaced",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Donation form",
      hypothesis: "Surfacing tribute giving as a visible option (not buried) increases relevant donation starts.",
      variantA: "Tribute giving option hidden under 'More options'.",
      variantB: "Show a small 'Donate in honor or memory of someone' toggle directly on the main form.",
      kpi: "Tribute donation starts",
      guardrails: "Form completion time",
      tags: ["donate", "personalization"]
    },
    {
      title: "Campaign goal progress bar",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Above donation form",
      hypothesis: "Visible progress toward a goal creates urgency and social proof.",
      variantA: "No progress indicator.",
      variantB: "Add a simple progress bar: 'X% of our goal reached' near the ask.",
      kpi: "Donation starts",
      guardrails: "Bounce",
      tags: ["donate", "engagement"]
    },
    {
      title: "ZIP-based local impact framing",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Donation module",
      hypothesis: "Framing impact in terms of the visitor's own area increases relevance and giving.",
      variantA: "Generic national impact framing.",
      variantB: "Use ZIP/state context to show a local impact stat where available.",
      kpi: "Donation starts",
      guardrails: "None expected",
      tags: ["donate", "personalization"]
    },
    {
      title: "Mobile one-tap preset amounts",
      activityType: "A/B",
      audience: "Mobile visitors",
      placement: "Mobile donation module",
      hypothesis: "Larger, one-tap preset amount buttons reduce friction on small screens.",
      variantA: "Standard amount input field on mobile.",
      variantB: "Large tappable preset amount buttons with a 'custom amount' fallback.",
      kpi: "Mobile donation completion",
      guardrails: "Average gift size",
      tags: ["donate", "mobile"]
    },
    {
      title: "High-contrast Donate button",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Donation module CTA",
      hypothesis: "A higher-contrast Donate button improves visibility against surrounding content.",
      variantA: "Current button color/contrast.",
      variantB: "Higher-contrast button color for the Donate CTA only.",
      kpi: "Donate button click-through",
      guardrails: "None expected; visual-only change",
      tags: ["donate", "color"]
    }
  ];

  const loginIdeas = [
    {
      title: "Sign-in success assist",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Login form",
      hypothesis: "Clear help options reduce login failures and abandonment.",
      variantA: "Current sign-in.",
      variantB: "Add inline help links (forgot password/username) + reduce competing CTAs.",
      kpi: "Successful logins",
      guardrails: "Password reset starts, errors",
      tags: ["login"]
    },
    {
      title: "Clarify username vs member ID prompt",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Login form field label",
      hypothesis: "Ambiguity between email/username/member ID causes failed first attempts.",
      variantA: "Generic 'Username' label.",
      variantB: "Label clarifies accepted formats, such as 'Email or Member ID'.",
      kpi: "First-attempt login success",
      guardrails: "Support clicks",
      tags: ["login", "copy"]
    },
    {
      title: "Inline field validation before submit",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Login form fields",
      hypothesis: "Catching obvious errors (empty field, bad format) before submit reduces failed attempts.",
      variantA: "Validation only shown after submit.",
      variantB: "Inline validation as the visitor leaves each field.",
      kpi: "Successful logins",
      guardrails: "Time to complete form",
      tags: ["login", "form"]
    },
    {
      title: "Account benefits reminder near login",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Beside or above login form",
      hypothesis: "Reminding visitors what they get by logging in reduces abandonment before they start.",
      variantA: "Login form with no context.",
      variantB: "Add 2-3 short bullets on what's available after login (billing, roadside, documents).",
      kpi: "Login starts",
      guardrails: "None expected",
      tags: ["login", "trust"]
    },
    {
      title: "Specific error messaging on failed login",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Login error state",
      hypothesis: "Distinguishing 'wrong password' from 'no account found' reduces confusion and repeat failed attempts.",
      variantA: "Generic 'Invalid login' message for all failure types.",
      variantB: "Specific message per failure type, each with a clear next step.",
      kpi: "Retry success rate, support contacts",
      guardrails: "Account-enumeration risk — keep messaging general enough to avoid confirming which field was wrong",
      tags: ["login", "copy"]
    },
    {
      title: "Forgot password inline expand",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Below password field",
      hypothesis: "Handling password recovery inline (instead of a full page navigation) keeps visitors in flow.",
      variantA: "'Forgot password' links to a separate page.",
      variantB: "'Forgot password' expands an inline reset-request field on the same page.",
      kpi: "Password reset completion",
      guardrails: "Reset request errors",
      tags: ["login", "flow"]
    },
    {
      title: "Remember me visibility",
      activityType: "A/B",
      audience: "Returning visitors",
      placement: "Login form",
      hypothesis: "A clearer 'Remember me' option reduces repeat-login friction for returning visitors.",
      variantA: "Small, easy-to-miss 'Remember me' checkbox.",
      variantB: "Slightly larger checkbox with a one-line benefit note ('Skip login next time on this device').",
      kpi: "Remember-me opt-in rate",
      guardrails: "Shared-device risk — keep copy neutral, do not encourage use on public devices",
      tags: ["login", "copy"]
    },
    {
      title: "Mobile single-column login layout",
      activityType: "A/B",
      audience: "Mobile visitors",
      placement: "Mobile login form",
      hypothesis: "A simplified single-column layout reduces mis-taps and speeds up mobile login.",
      variantA: "Current mobile layout.",
      variantB: "Single-column form with larger tap targets and autofocus on the first field.",
      kpi: "Mobile login success rate",
      guardrails: "None expected",
      tags: ["login", "mobile"]
    },
    {
      title: "New vs returning visitor login framing",
      activityType: "Experience Targeting (XT)",
      audience: "New vs returning",
      placement: "Login page hero",
      hypothesis: "First-time visitors need registration framing; returning visitors just need a fast path in.",
      variantA: "Same login page for everyone.",
      variantB: "New: emphasize 'Create an account'. Returning: emphasize the login form, minimal distractions.",
      kpi: "Login/registration completion",
      guardrails: "Bounce",
      tags: ["login"]
    },
    {
      title: "High-contrast Sign In button",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Login form CTA",
      hypothesis: "A higher-contrast Sign In button improves visibility of the primary action.",
      variantA: "Current button color/contrast.",
      variantB: "Higher-contrast button color for the Sign In CTA only.",
      kpi: "Sign In click-through",
      guardrails: "None expected; visual-only change",
      tags: ["login", "color"]
    }
  ];

  const membershipIdeas = [
    {
      title: "Membership level comparison simplifier",
      activityType: "A/B",
      audience: "Prospective members",
      placement: "Membership comparison area",
      hypothesis: "A simpler 'best for' framing helps visitors choose a plan faster.",
      variantA: "Current membership comparison.",
      variantB: "Add a short 'Best for...' line to each membership tier and emphasize the recommended option.",
      kpi: "Join starts / completed joins",
      guardrails: "Plan mix, support clicks",
      tags: ["membership", "join"]
    },
    {
      title: "Roadside value proof near Join CTA",
      activityType: "A/B",
      audience: "Prospective members",
      placement: "Near primary Join CTA",
      hypothesis: "Concrete roadside benefits reduce hesitation and increase joins.",
      variantA: "Join CTA without nearby benefit proof.",
      variantB: "Add 2 concise benefit bullets near the Join CTA, such as towing help and battery service.",
      kpi: "Join CTA click-through",
      guardrails: "Bounce, plan comparison clicks",
      tags: ["membership", "cta"]
    },
    {
      title: "Highlight the most-popular tier",
      activityType: "A/B",
      audience: "Prospective members",
      placement: "Membership comparison table",
      hypothesis: "Flagging a 'Most Popular' tier reduces choice paralysis and speeds up the decision.",
      variantA: "All tiers presented with equal visual weight.",
      variantB: "Add a 'Most Popular' badge and slight visual emphasis on the recommended tier.",
      kpi: "Join starts on the highlighted tier",
      guardrails: "Overall join rate, plan mix",
      tags: ["membership"]
    },
    {
      title: "Response-time proof stat near roadside benefit",
      activityType: "A/B",
      audience: "Prospective members",
      placement: "Roadside benefit section",
      hypothesis: "A concrete stat (e.g. average response time) makes the roadside benefit feel more real and valuable.",
      variantA: "Roadside benefit described qualitatively only.",
      variantB: "Add a concrete stat or proof point next to the roadside benefit description.",
      kpi: "Join starts",
      guardrails: "None expected",
      tags: ["membership", "trust"]
    },
    {
      title: "Bundle savings estimate near Join CTA",
      activityType: "A/B",
      audience: "Prospective members",
      placement: "Near primary Join CTA",
      hypothesis: "Showing an estimated bundle savings (membership + insurance) increases perceived value at the decision point.",
      variantA: "Join CTA with no savings context.",
      variantB: "Add a short 'Members who bundle save an average of $X' note near the CTA.",
      kpi: "Join CTA click-through",
      guardrails: "Claim accuracy — confirm the figure with the business owner before shipping",
      tags: ["membership", "cta"]
    },
    {
      title: "Fewer required fields on the join form",
      activityType: "A/B",
      audience: "Prospective members",
      placement: "Join form",
      hypothesis: "Deferring optional fields to a later step reduces abandonment on the initial join form.",
      variantA: "Full form (contact, payment, add-ons) shown at once.",
      variantB: "Core fields first; add-ons and optional info deferred to a second step.",
      kpi: "Join form completion rate",
      guardrails: "Add-on attach rate",
      tags: ["membership", "form"]
    },
    {
      title: "Member count / tenure trust badge",
      activityType: "A/B",
      audience: "Prospective members",
      placement: "Above the fold",
      hypothesis: "Social proof (member count, years serving) increases trust before the visitor reaches pricing.",
      variantA: "No social proof above the fold.",
      variantB: "Add a short trust line, such as member count or years serving the region.",
      kpi: "Scroll-to-pricing rate, join starts",
      guardrails: "None expected",
      tags: ["membership", "trust"]
    },
    {
      title: "Mobile sticky Join CTA",
      activityType: "A/B",
      audience: "Mobile visitors",
      placement: "Mobile viewport only",
      hypothesis: "Keeping the Join action available while scrolling reduces mobile abandonment.",
      variantA: "No sticky CTA on mobile.",
      variantB: "Sticky bottom bar with the Join CTA.",
      kpi: "Mobile join starts",
      guardrails: "Accidental taps",
      tags: ["membership", "mobile"]
    },
    {
      title: "Auto-Target: tier recommendation by quiz answers",
      activityType: "Auto-Target",
      audience: "Prospective members",
      placement: "Membership quiz/selector module",
      hypothesis: "A short quiz that recommends a tier reduces comparison fatigue and increases confident joins.",
      variantA: "Static comparison table only.",
      variantB: "Optional 2-3 question quiz that recommends a starting tier, tested via Auto-Target.",
      kpi: "Join starts, plan mix",
      guardrails: "Quiz completion rate",
      tags: ["membership"]
    },
    {
      title: "FAQ accordion near pricing",
      activityType: "A/B",
      audience: "Prospective members",
      placement: "Below pricing table",
      hypothesis: "Answering common objections right where hesitation happens reduces drop-off before the Join click.",
      variantA: "FAQ located on a separate help page.",
      variantB: "Add a short FAQ accordion (3-4 questions) directly below the pricing table.",
      kpi: "Join starts",
      guardrails: "Time on page",
      tags: ["membership", "content"]
    },
    {
      title: "High-contrast Join button",
      activityType: "A/B",
      audience: "Prospective members",
      placement: "Primary Join CTA",
      hypothesis: "A higher-contrast Join button improves visibility against surrounding pricing content.",
      variantA: "Current button color/contrast.",
      variantB: "Higher-contrast button color for the Join CTA only.",
      kpi: "Join CTA click-through",
      guardrails: "None expected; visual-only change",
      tags: ["membership", "color"]
    }
  ];

  const travelIdeas = [
    {
      title: "Trip intent chooser",
      activityType: "A/B",
      audience: "Travel visitors",
      placement: "Above the fold",
      hypothesis: "Letting users self-select their trip goal reduces browsing friction.",
      variantA: "Standard travel landing content.",
      variantB: "Add quick chips: Hotels, Cruises, Tours, Rental Cars, Travel Insurance.",
      kpi: "Travel product click-through",
      guardrails: "Scroll depth, bounce",
      tags: ["travel", "nav"]
    },
    {
      title: "Advisor help as secondary CTA",
      activityType: "A/B",
      audience: "Travel visitors",
      placement: "Near booking CTA",
      hypothesis: "A clear advisor/help path increases action for visitors not ready to self-book.",
      variantA: "Booking CTA only.",
      variantB: "Keep the booking CTA primary and add a subtle 'Talk to a travel advisor' link.",
      kpi: "Booking starts + advisor leads",
      guardrails: "Primary booking CTA clicks",
      tags: ["travel", "support"]
    },
    {
      title: "Member discount badge on offers",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Travel offer cards",
      hypothesis: "Making member savings visible on the card (not just at checkout) increases click-through.",
      variantA: "Discount only visible after clicking into an offer.",
      variantB: "Add a 'Member savings' badge directly on the offer card.",
      kpi: "Offer click-through",
      guardrails: "Claim accuracy per offer",
      tags: ["travel"]
    },
    {
      title: "Limited-time framing on featured trips",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Featured trips module",
      hypothesis: "Genuine urgency framing (real dates only) increases engagement with featured offers.",
      variantA: "Featured trips shown with no timing context.",
      variantB: "Add real booking-window dates where applicable, e.g. 'Book by [date]'.",
      kpi: "Featured trip click-through",
      guardrails: "Must use accurate dates only — no manufactured urgency",
      tags: ["travel"]
    },
    {
      title: "Simplify default search filters",
      activityType: "A/B",
      audience: "Travel visitors",
      placement: "Trip search module",
      hypothesis: "Fewer default-visible filters reduces upfront decision load without removing capability.",
      variantA: "All filters expanded by default.",
      variantB: "Only destination/dates shown by default; other filters collapsed under 'More filters'.",
      kpi: "Search completion rate",
      guardrails: "Filter usage rate",
      tags: ["travel", "form"]
    },
    {
      title: "'Backed by AAA' reassurance near booking",
      activityType: "A/B",
      audience: "Travel visitors",
      placement: "Near booking CTA",
      hypothesis: "Reinforcing the AAA relationship right before booking reduces last-step hesitation.",
      variantA: "Booking CTA with no trust reinforcement.",
      variantB: "Add a small 'Backed by AAA' or member-support note near the CTA.",
      kpi: "Booking starts",
      guardrails: "None expected",
      tags: ["travel", "trust"]
    },
    {
      title: "Mobile sticky 'Find a trip' CTA",
      activityType: "A/B",
      audience: "Mobile visitors",
      placement: "Mobile viewport only",
      hypothesis: "Keeping the primary search/booking action available reduces mobile scroll fatigue.",
      variantA: "No sticky CTA on mobile.",
      variantB: "Sticky bottom bar with a 'Find a trip' or 'Book now' button.",
      kpi: "Mobile booking starts",
      guardrails: "Accidental taps",
      tags: ["travel", "mobile"]
    },
    {
      title: "Recently viewed destinations module",
      activityType: "A/B",
      audience: "Returning visitors",
      placement: "Below hero",
      hypothesis: "Resurfacing recently viewed destinations reduces re-search effort for visitors comparing options.",
      variantA: "No recently viewed module.",
      variantB: "Add a small 'Continue where you left off' module for the last 2-3 viewed destinations.",
      kpi: "Return-visit booking rate",
      guardrails: "None expected; requires session/local data only",
      tags: ["travel", "personalization"]
    },
    {
      title: "Travel insurance framing at booking step",
      activityType: "A/B",
      audience: "Travel visitors",
      placement: "Checkout / booking step",
      hypothesis: "Framing travel insurance around specific protections (not just 'add insurance?') increases attach rate.",
      variantA: "Generic 'Add travel insurance?' checkbox.",
      variantB: "Checkbox with 2-3 concrete protections listed (trip cancellation, medical, baggage).",
      kpi: "Insurance attach rate",
      guardrails: "Total booking completion rate",
      tags: ["travel", "copy"]
    },
    {
      title: "Auto-Target: seasonal hero imagery",
      activityType: "Auto-Target",
      audience: "All visitors",
      placement: "Hero module",
      hypothesis: "Letting Auto-Target pick the best-performing seasonal/destination imagery improves engagement over a single static hero.",
      variantA: "Single static hero image.",
      variantB: "3-4 seasonal/destination hero images tested via Auto-Target.",
      kpi: "Hero click-through",
      guardrails: "LCP/CLS from image swaps",
      tags: ["travel"]
    },
    {
      title: "High-contrast 'Book Now' button",
      activityType: "A/B",
      audience: "Travel visitors",
      placement: "Booking CTA",
      hypothesis: "A higher-contrast Book Now button improves visibility against trip imagery.",
      variantA: "Current button color/contrast.",
      variantB: "Higher-contrast button color for the Book Now CTA only.",
      kpi: "Book Now click-through",
      guardrails: "None expected; visual-only change",
      tags: ["travel", "color"]
    }
  ];

  const discountIdeas = [
    {
      title: "Local deals first",
      activityType: "A/B",
      audience: "Discounts visitors",
      placement: "Top of discounts page",
      hypothesis: "Showing nearby deals first increases engagement and perceived value.",
      variantA: "Generic discounts layout.",
      variantB: "Add a top module for 'Deals near you' using the visitor's selected ZIP/state context.",
      kpi: "Deal clicks / offer opens",
      guardrails: "Search refinements, zero-result rate",
      tags: ["discounts", "engagement"]
    },
    {
      title: "Savings category chips",
      activityType: "A/B",
      audience: "Discounts visitors",
      placement: "Above discount listings",
      hypothesis: "Category shortcuts help visitors reach relevant offers faster.",
      variantA: "Standard filters only.",
      variantB: "Add quick chips for Restaurants, Travel, Entertainment, Automotive, Shopping.",
      kpi: "Category clicks / offer opens",
      guardrails: "Filter usage, bounce",
      tags: ["discounts", "nav"]
    },
    {
      title: "Category icon grid instead of text list",
      activityType: "A/B",
      audience: "Discounts visitors",
      placement: "Category navigation",
      hypothesis: "A visual icon grid is scanned faster than a plain text list of categories.",
      variantA: "Plain text list of categories.",
      variantB: "Icon + label grid for the same categories.",
      kpi: "Category click-through",
      guardrails: "Mobile layout complexity",
      tags: ["discounts"]
    },
    {
      title: "Surface most-redeemed deals",
      activityType: "A/B",
      audience: "Discounts visitors",
      placement: "Top of discounts listing",
      hypothesis: "Leading with popular, proven deals increases trust and click-through versus a purely chronological list.",
      variantA: "Deals listed chronologically/alphabetically only.",
      variantB: "Add a 'Popular with members' row at the top using redemption data.",
      kpi: "Deal clicks",
      guardrails: "Long-tail deal visibility",
      tags: ["discounts"]
    },
    {
      title: "In-page search for discounts",
      activityType: "A/B",
      audience: "Discounts visitors",
      placement: "Top of discounts page",
      hypothesis: "A search box lets visitors with a specific merchant in mind skip browsing entirely.",
      variantA: "No search, browse/filter only.",
      variantB: "Add a search box searching offer/merchant names.",
      kpi: "Search usage, offer opens",
      guardrails: "Zero-result rate",
      tags: ["discounts", "nav"]
    },
    {
      title: "Mobile single-column deal cards",
      activityType: "A/B",
      audience: "Mobile visitors",
      placement: "Mobile discounts listing",
      hypothesis: "Larger single-column cards are easier to scan and tap accurately on mobile.",
      variantA: "Dense multi-column grid on mobile.",
      variantB: "Single-column cards with larger tap targets.",
      kpi: "Mobile offer opens",
      guardrails: "Scroll depth needed to see all deals",
      tags: ["discounts", "mobile"]
    },
    {
      title: "New / ending soon badges",
      activityType: "A/B",
      audience: "Discounts visitors",
      placement: "Deal cards",
      hypothesis: "Freshness signals give visitors a reason to check back and act sooner on time-limited deals.",
      variantA: "No freshness indicator on cards.",
      variantB: "Add 'New' or 'Ending soon' badges where the underlying data supports it.",
      kpi: "Deal clicks",
      guardrails: "Badge accuracy — only show when backed by real dates",
      tags: ["discounts"]
    },
    {
      title: "Auto-Target: personalize category order",
      activityType: "Auto-Target",
      audience: "Returning visitors",
      placement: "Category navigation",
      hypothesis: "Ordering categories by a visitor's past engagement increases relevant clicks over a fixed order.",
      variantA: "Fixed category order for everyone.",
      variantB: "Category order personalized by past click behavior, tested via Auto-Target.",
      kpi: "Category click-through",
      guardrails: "Findability of untried categories",
      tags: ["discounts", "personalization"]
    },
    {
      title: "Verified partner badge on offers",
      activityType: "A/B",
      audience: "Discounts visitors",
      placement: "Offer detail",
      hypothesis: "A verification cue reduces hesitation to click through to an external merchant.",
      variantA: "No partner verification cue.",
      variantB: "Add a small 'Verified AAA partner' badge on offer cards.",
      kpi: "Offer click-through",
      guardrails: "None expected",
      tags: ["discounts", "trust"]
    },
    {
      title: "Simplify redemption instructions",
      activityType: "A/B",
      audience: "Discounts visitors",
      placement: "Offer detail / redemption step",
      hypothesis: "Shorter, clearer redemption steps reduce support questions and abandoned redemptions.",
      variantA: "Long paragraph-style redemption instructions.",
      variantB: "Numbered 3-step redemption instructions.",
      kpi: "Redemption completion, support contacts",
      guardrails: "None expected",
      tags: ["discounts", "copy"]
    },
    {
      title: "High-contrast 'View Deal' button",
      activityType: "A/B",
      audience: "Discounts visitors",
      placement: "Deal cards",
      hypothesis: "A higher-contrast action button improves visibility against varied merchant imagery.",
      variantA: "Current button color/contrast.",
      variantB: "Higher-contrast button color for the View Deal action only.",
      kpi: "Deal clicks",
      guardrails: "None expected; visual-only change",
      tags: ["discounts", "color"]
    }
  ];

  const contentIdeas = [
    {
      title: "Related next step module",
      activityType: "A/B",
      audience: "Content readers",
      placement: "End of article or right rail",
      hypothesis: "A relevant next step turns passive readers into task completers.",
      variantA: "Article ends without a strong next step.",
      variantB: "Add a small related-action card connected to the article topic.",
      kpi: "Related CTA click-through",
      guardrails: "Article completion/scroll depth",
      tags: ["content", "engagement"]
    },
    {
      title: "Article summary box",
      activityType: "A/B",
      audience: "Content readers",
      placement: "Below H1 / intro",
      hypothesis: "A concise summary helps visitors confirm relevance and continue reading.",
      variantA: "Standard article intro.",
      variantB: "Add a 3-bullet 'In this article' summary box.",
      kpi: "Scroll depth / time on page",
      guardrails: "CTA clicks, bounce",
      tags: ["content", "copy"]
    },
    {
      title: "Table of contents for long articles",
      activityType: "A/B",
      audience: "Content readers",
      placement: "Below intro, long-form articles",
      hypothesis: "A jump-to table of contents helps readers find the relevant section faster and reduces early exits.",
      variantA: "No table of contents.",
      variantB: "Add a short jump-to table of contents for articles over ~800 words.",
      kpi: "Scroll depth, time on page",
      guardrails: "None expected",
      tags: ["content", "nav"]
    },
    {
      title: "Author/credibility byline module",
      activityType: "A/B",
      audience: "Content readers",
      placement: "Below H1",
      hypothesis: "A credible byline (author/reviewer, date) increases trust in the content's accuracy.",
      variantA: "No byline or credibility signal.",
      variantB: "Add a short byline with author/reviewer and last-updated date.",
      kpi: "Scroll depth, related CTA click-through",
      guardrails: "None expected",
      tags: ["content", "trust"]
    },
    {
      title: "Auto-Target: personalized related articles",
      activityType: "Auto-Target",
      audience: "All visitors",
      placement: "End of article",
      hypothesis: "Related articles chosen by topic/behavior affinity outperform a fixed 'related' list.",
      variantA: "Fixed related-articles list (same category only).",
      variantB: "Personalized related-articles selection tested via Auto-Target.",
      kpi: "Related article click-through",
      guardrails: "None expected",
      tags: ["content", "personalization"]
    },
    {
      title: "Mid-article newsletter signup nudge",
      activityType: "A/B",
      audience: "Content readers",
      placement: "Mid-article, after 2-3 paragraphs",
      hypothesis: "A lightweight nudge mid-article reaches engaged readers before they finish and leave.",
      variantA: "Newsletter signup only in the footer.",
      variantB: "Add a small inline nudge partway through the article.",
      kpi: "Newsletter signups",
      guardrails: "Reading flow disruption, bounce",
      tags: ["content", "engagement"]
    },
    {
      title: "Estimated read time near title",
      activityType: "A/B",
      audience: "Content readers",
      placement: "Below H1",
      hypothesis: "Setting a time expectation up front increases completion for readers who commit.",
      variantA: "No read-time indicator.",
      variantB: "Add a short '~4 min read' label near the title.",
      kpi: "Scroll depth, completion rate",
      guardrails: "None expected",
      tags: ["content", "copy"]
    },
    {
      title: "Increase social share visibility",
      activityType: "A/B",
      audience: "Content readers",
      placement: "Article top or sticky side rail",
      hypothesis: "More visible share actions increase organic reach from engaged readers.",
      variantA: "Share icons only at the bottom of the article.",
      variantB: "Add a sticky share rail visible while reading.",
      kpi: "Share clicks",
      guardrails: "Layout crowding on mobile",
      tags: ["content", "engagement"]
    },
    {
      title: "Shorten the opening paragraph",
      activityType: "A/B",
      audience: "Content readers",
      placement: "Article intro",
      hypothesis: "A tighter, more direct opening reduces early bounce before readers reach the value of the article.",
      variantA: "Current multi-sentence intro paragraph.",
      variantB: "Shorter, more direct opening (1-2 sentences) stating what the reader will get.",
      kpi: "Scroll-past-intro rate",
      guardrails: "None expected",
      tags: ["content", "copy"]
    },
    {
      title: "Sticky 'back to top' on long articles",
      activityType: "A/B",
      audience: "Content readers",
      placement: "Bottom-right, long-form articles",
      hypothesis: "Making it easy to return to the top (e.g. to the related-action module) reduces friction after finishing.",
      variantA: "No back-to-top affordance.",
      variantB: "Small sticky back-to-top button appears after sufficient scroll.",
      kpi: "Post-article engagement",
      guardrails: "None expected",
      tags: ["content"]
    },
    {
      title: "High-contrast in-article CTA",
      activityType: "A/B",
      audience: "Content readers",
      placement: "Mid or end of article",
      hypothesis: "A higher-contrast in-article action stands out against body copy better than a plain text link.",
      variantA: "Plain text link as the in-article call to action.",
      variantB: "Higher-contrast button styling for the same call to action.",
      kpi: "In-article CTA click-through",
      guardrails: "None expected; visual-only change",
      tags: ["content", "color"]
    }
  ];

  const navIdeas = [
    {
      title: "Findability: top tasks module",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Top of page",
      hypothesis: "Highlighting common tasks reduces pogo-sticking and increases completion.",
      variantA: "Standard navigation.",
      variantB: "Add top tasks cards (Locations, Roadside, Quote, Pay) above fold.",
      kpi: "Task click-through",
      guardrails: "Bounce",
      tags: ["nav"]
    },
    {
      title: "Increase search bar prominence",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Header",
      hypothesis: "A more visible search bar reduces reliance on menu navigation for findability.",
      variantA: "Small search icon that expands on click.",
      variantB: "Always-visible search input in the header.",
      kpi: "Search usage, zero-result rate",
      guardrails: "Header layout complaints, mobile space",
      tags: ["nav"]
    },
    {
      title: "Sticky quick-links bar",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Below main header, sticky on scroll",
      hypothesis: "Keeping common destinations (Quote, Pay, Roadside) available while scrolling reduces back-to-top trips.",
      variantA: "Quick links only in the main nav.",
      variantB: "Sticky secondary bar with Quote/Pay/Roadside links visible while scrolling.",
      kpi: "Quick-link click-through",
      guardrails: "Content overlap on small screens",
      tags: ["nav", "sticky"]
    },
    {
      title: "ZIP-first locator entry point",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Locations / agent finder module",
      hypothesis: "Leading with a ZIP input instead of a map reduces steps to find a nearby office or agent.",
      variantA: "Map-first locator.",
      variantB: "ZIP input first, with the map appearing after results.",
      kpi: "Locator completion rate",
      guardrails: "Map usage rate",
      tags: ["nav"]
    },
    {
      title: "Simplify mega menu columns",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Main navigation menu",
      hypothesis: "Fewer, better-labeled columns reduce hesitation when scanning the mega menu.",
      variantA: "Current mega menu with many columns/links.",
      variantB: "Consolidated menu with fewer, task-oriented columns (Get a Quote, Manage Policy, Get Help).",
      kpi: "Menu click-through, exit rate",
      guardrails: "Findability of less-common links",
      tags: ["nav"]
    },
    {
      title: "Consolidated contact options module",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Header or footer",
      hypothesis: "Grouping phone/chat/locations in one place reduces the hunt for a way to reach a human.",
      variantA: "Contact options scattered across pages.",
      variantB: "Single 'Contact us' module listing phone, chat, and locations together.",
      kpi: "Contact module click-through",
      guardrails: "Support volume by channel",
      tags: ["nav", "support"]
    },
    {
      title: "New vs returning visitor nav emphasis",
      activityType: "Experience Targeting (XT)",
      audience: "New vs returning",
      placement: "Main navigation",
      hypothesis: "New visitors need orientation; returning visitors want fast access to account/service tasks.",
      variantA: "Identical nav for everyone.",
      variantB: "New: emphasize 'Get a Quote' and 'About'. Returning: emphasize 'Sign In' and 'Manage Policy'.",
      kpi: "Task completion by segment",
      guardrails: "Bounce",
      tags: ["nav"]
    },
    {
      title: "Clarify mobile menu label",
      activityType: "A/B",
      audience: "Mobile visitors",
      placement: "Mobile header",
      hypothesis: "An icon-plus-label menu trigger is found faster than an icon alone.",
      variantA: "Hamburger icon only.",
      variantB: "Hamburger icon with a 'Menu' label next to it.",
      kpi: "Menu open rate",
      guardrails: "Header space on small screens",
      tags: ["nav", "mobile"]
    },
    {
      title: "Auto-Target: reorder tasks by usage",
      activityType: "Auto-Target",
      audience: "All visitors",
      placement: "Top tasks module",
      hypothesis: "Letting Auto-Target learn the best task order improves click-through over a fixed order.",
      variantA: "Fixed task order (Quote, Pay, Roadside, Locations).",
      variantB: "3-4 task-order variants tested via Auto-Target.",
      kpi: "Task click-through",
      guardrails: "Findability of lower-traffic tasks",
      tags: ["nav"]
    },
    {
      title: "Search zero-result recovery suggestions",
      activityType: "A/B",
      audience: "All visitors",
      placement: "Search results page",
      hypothesis: "Suggesting alternatives on a zero-result search keeps visitors from dead-ending and leaving.",
      variantA: "Plain 'No results found' message.",
      variantB: "'No results found' plus 2-3 suggested common searches/links.",
      kpi: "Post-zero-result engagement",
      guardrails: "None expected",
      tags: ["nav", "copy"]
    }
  ];

  let pool = [...universalIdeas];
  if (pageType === 'quote') pool = pool.concat(quoteIdeas);
  else if (pageType === 'membership') pool = pool.concat(membershipIdeas);
  else if (pageType === 'billing') pool = pool.concat(billingIdeas);
  else if (pageType === 'donate') pool = pool.concat(donateIdeas);
  else if (pageType === 'login') pool = pool.concat(loginIdeas);
  else if (pageType === 'travel') pool = pool.concat(travelIdeas);
  else if (pageType === 'discounts') pool = pool.concat(discountIdeas);
  else if (pageType === 'content') pool = pool.concat(contentIdeas);
  else if (pageType === 'nav') pool = pool.concat(navIdeas);

  if (includeCustom && customIdeas.length) pool = pool.concat(customIdeas);

  // Shuffle first for variety, then rank so the best bets rise to the top.
  const ranked = shuffleDeterministic(pool, `${url}|${page}|${pageType}|${goal}`)
    .map((idea, idx) => ({
      ...idea,
      __shuffleIndex: idx,
      __priority: classifyIdeaPriority(idea, { pageType, goal })
    }))
    .sort((a, b) => {
      const scoreDiff = (b.__priority?.score || 0) - (a.__priority?.score || 0);
      return scoreDiff || ((a.__shuffleIndex || 0) - (b.__shuffleIndex || 0));
    });
  const chosen = ranked.slice(0, Math.min(ideaCount, ranked.length));

  // --- Instrumentation warning ---
  const missingNote = (!s.hasDD && !s.hasS && !s.hasAlloy)
    ? "NOTE: No Adobe signals were detected. Before trusting results, confirm analytics instrumentation (digitalData / s-object / Web SDK) is firing on this page."
    : "";

  const header = [
    `Target Strategist Ideas (${chosen.length})`,
    `Brand: ${brand} | Env: ${env}`,
    `URL: ${url}`,
    `Page: ${page || "(unknown)"}`,
    `Page type: ${pageType}${requestedPageType === 'auto' ? ` (auto-detected from ${inferredPageType})` : ''}`,
    `Primary goal: ${goalLabel(goal)}`,
    `Signals: ${signals}`,
    healthLine,
    (pathname ? `Path: ${pathname}` : ""),
    (h1 ? `H1: ${h1}` : ""),
    (ctaText ? `Primary CTA: ${ctaText}` : ""),
    (h1Selector ? `H1 selector: ${h1Selector}` : ""),
    (ctaSelector ? `CTA selector: ${ctaSelector}` : ""),
    (formSelector ? `Form selector: ${formSelector}` : ""),
    ""
  ].filter(Boolean).join("\n");

  const body = chosen.map((x, i) => `${i + 1}) ${ideaLine(x)}`).join("\n");

  const text = [
    header,
    body,
    "",
    activityNotes,
    "",
    checklist,
    (missingNote ? "\n" + missingNote : "")
  ].join("\n");

  return {
    text,
    ideas: chosen,
    meta: { brand, env, url, page, pageType, goal, signals }
  };
}


async function copyStrategistSuggestion() {
  const text = document.getElementById("strategistSuggestionText")?.textContent || "";
  const note = document.getElementById("strategistNote");
  if (!text.trim()) {
    if (note) note.textContent = "Nothing to copy yet. Generate a suggestion first.";
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    if (note) note.textContent = "Copied to clipboard.";
  } catch (e) {
    console.error("Copy failed:", e);
    if (note) note.textContent = "Copy failed. Your browser may be blocking clipboard access in popups.";
  }
}

async function clearStateOverride(tabId) {
  try { await chrome.storage.local.remove(ACG_STATE_KEEPER_KEY); } catch {}

  if (tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [PAGE_STATE_OVERRIDE_KEY],
        func: (key) => {
          try { window.localStorage.removeItem(key); } catch {}
          try {
            Object.keys(window.sessionStorage || {})
              .filter(k => k.startsWith("__acgStateSwitcherZipSubmitted:"))
              .forEach(k => window.sessionStorage.removeItem(k));
          } catch {}
        }
      });
    } catch { /* page injection is best-effort */ }

    try {
      await chrome.tabs.sendMessage(tabId, { type: "ACG_CLEAR_STATE_KEEPER" });
    } catch { /* content script may not be present on non-ACG tabs */ }
  }

  try { await chrome.runtime.sendMessage({ type: "ACG_CLEAR_STATE_KEEPER" }); } catch {}
}

let stateSwitchInFlight = false;

document.getElementById('applyBtn')?.addEventListener('click', async () => {
  const msgEl = document.getElementById('stateMsg');
  const btn = document.getElementById('applyBtn');

  // Make the click idempotent. Older builds left the button active for a
  // second before reloading, which made it feel like a double-click was needed.
  if (stateSwitchInFlight || btn?.disabled) return;

  const originalText = btn?.textContent || 'Switch State';
  try {
    stateSwitchInFlight = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Switching…';
    }

    const sel = document.getElementById('stateSelect');
    const state = sel?.value?.trim();
    const profile = profileForStateName(state);
    if (!profile) {
      toast(msgEl, "Pick a state first.", false);
      return;
    }

    const tab = await getActiveTab();
    if (!tab?.id) throw new Error('No active tab found. Open an ACG page and try again.');

    const result = await applyCoreStateCookies(profile, tab.url, tab.id);

    if (result.fail === 0) {
      toast(msgEl, `Switching to ${result.stateCode} using ZIP ${result.zip} ✔`, true);
      setCurrentStatePill(result.stateCode);

      // Navigate the same active tab immediately after the cookie/storage work
      // finishes. Do not wait on a visible countdown; that pause invited double-clicks.
      await chrome.tabs.update(tab.id, { url: result.nextUrl });
      window.close();
    } else {
      // Some cookie writes failed. Leaving the popup open (instead of navigating
      // and closing like the success path) is the whole point here — closing
      // immediately hid this error entirely; the tester just saw the page
      // reload and assumed the switch worked.
      const summary = result.errors.slice(0, 6).join(" • ");
      toast(msgEl, `State switch partly applied. Set ${result.ok}; ${result.fail} failed. ${summary}${result.errors.length > 6 ? " • …" : ""}`, false);
      stateSwitchInFlight = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
  } catch (err) {
    console.error('State apply error:', err);
    toast(msgEl, err?.message || "Error applying state cookies", false);
    stateSwitchInFlight = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
});

/* ---------- Env Websites + Author (unchanged from your last working) ---------- */
const ENV_KEY='selectedEnv';let currentEnv=null;
const urls={acg:{production:"https://www.acg.aaa.com",stage1:"https://www.stage1.acg.aaa.com",qa1:"https://www.qa1.acg.aaa.com",dev1:"https://www.dev1.acg.aaa.com"},meemic:{production:"https://www.meemic.com",stage1:"https://stage1.meemic.com",qa1:"https://qa1.meemic.com",dev1:"https://dev1.meemic.com"},meemicfoundation:{production:"https://www.meemicfoundation.org",stage1:"https://stage1.meemicfoundation.org",qa1:"https://qa1.meemicfoundation.org",dev1:"https://dev1.meemicfoundation.org"}};
const authorUrls={production:"https://author-p149839-e1583596.adobeaemcloud.com",stage1:"https://author-p149839-e1583546.adobeaemcloud.com",qa1:"https://author-p149839-e1583595.adobeaemcloud.com",dev1:"https://author-p149839-e1544194.adobeaemcloud.com"};
function setDisabled(a,d){a.classList.toggle('disabled',d);if(d){a.setAttribute('aria-disabled','true');a.setAttribute('tabindex','-1');}else{a.removeAttribute('aria-disabled');a.removeAttribute('tabindex');}}
function enableWebsitesAndAemLinks(){const en=!!currentEnv;document.querySelectorAll('[data-company]').forEach(a=>setDisabled(a,!en));const author=document.getElementById('authorLink');if(author)setDisabled(author,!en);}
function setActiveEnvLink(env){document.querySelectorAll('#envRow a[data-env]').forEach(a=>{const on=a.getAttribute('data-env')===env;a.classList.toggle('active',on);a.setAttribute('aria-selected',on?'true':'false');if(on)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current');});}
document.getElementById('envRow')?.addEventListener('click',(e)=>{const a=e.target.closest('a[data-env]');if(!a)return;e.preventDefault();currentEnv=a.getAttribute('data-env');setActiveEnvLink(currentEnv);enableWebsitesAndAemLinks();try{chrome.storage.sync.set({[ENV_KEY]:currentEnv});}catch{}},true);
document.querySelectorAll('[data-company]').forEach(link=>{link.addEventListener('click',(e)=>{e.preventDefault();if(!currentEnv||link.classList.contains('disabled'))return;const company=link.getAttribute('data-company');const target=urls?.[company]?.[currentEnv];if(target)chrome.tabs.create({url:target});});});
document.getElementById('authorLink')?.addEventListener('click',(e)=>{e.preventDefault();if(!currentEnv||e.currentTarget.classList.contains('disabled'))return;const target=authorUrls[currentEnv];if(target)chrome.tabs.create({url:target});});
document.getElementById('openSiteInspector')?.addEventListener('click', async () => {
  // Prefill Site Inspector's Start URL with the domain of the tab it was
  // opened from, so a tester on meemic.com doesn't land on a scanner still
  // pointed at acg.aaa.com by default.
  let startUrl = "";
  try {
    const tab = await getActiveTab();
    if (tab?.url && isAllowedHost(tab.url)) {
      startUrl = new URL(tab.url).origin + "/";
    }
  } catch { /* fall back to Site Inspector's own default */ }

  const target = startUrl
    ? `${chrome.runtime.getURL('site-inspector.html')}?start=${encodeURIComponent(startUrl)}`
    : chrome.runtime.getURL('site-inspector.html');
  chrome.tabs.create({ url: target });
});

/* ---------- Theme ---------- */
function applyTheme(mode){document.documentElement.setAttribute("data-theme",mode);document.getElementById('themeLight')?.setAttribute('aria-pressed',String(mode==='light'));document.getElementById('themeDark')?.setAttribute('aria-pressed',String(mode==='dark'));document.getElementById('themeSystem')?.setAttribute('aria-pressed',String(mode==='system'));}
(async function initTheme(){const saved=(await chrome.storage.sync.get(['themeMode']))?.themeMode??'system';applyTheme(saved);document.getElementById('themeLight')?.addEventListener('click',async()=>{applyTheme('light');await chrome.storage.sync.set({themeMode:'light'});});document.getElementById('themeDark')?.addEventListener('click',async()=>{applyTheme('dark');await chrome.storage.sync.set({themeMode:'dark'});});document.getElementById('themeSystem')?.addEventListener('click',async()=>{applyTheme('system');await chrome.storage.sync.set({themeMode:'system'});});})();

/* ---------- Badge Options (unchanged from last working) ---------- */

// Badge storage keys (must match content-script.js)
const BADGE_URL_POSITIONS_KEY = "badgePositionsByUrl";
const BADGE_URL_MODE_KEY      = "badgeModeByUrl";
const BADGE_HOST_MODE_KEY     = "badgeModePerHost";
const BADGE_CORNER_KEY        = "badgeCornerPerHost";
const BADGE_ANCHOR_KEY        = "badgeAnchorPerHost";
const BADGE_OFFSET_KEY        = "badgeOffsetPerHost";

function badgeUrlKeyNormalized(urlString) {
  try {
    const u = new URL(urlString);
    const host = u.hostname.toLowerCase();
    const path = u.pathname || "/";
    const hashFull = u.hash || "";
    const hashNoQuery = hashFull.split("?")[0];
    return `${host}|${path}|${hashNoQuery}`;
  } catch {
    return "";
  }
}

async function initBadgeUiFromStorage(activeTab) {
  try {
    const tab = activeTab || await getActiveTab();
    if (!tab?.url) return;

    const u = new URL(tab.url);
    const host = u.hostname.toLowerCase();
    const urlKey = badgeUrlKeyNormalized(tab.url);

    const all = await chrome.storage.sync.get([
      BADGE_URL_MODE_KEY,
      BADGE_HOST_MODE_KEY,
      BADGE_CORNER_KEY,
      BADGE_ANCHOR_KEY,
      BADGE_OFFSET_KEY
    ]);

    const modeByUrl = all[BADGE_URL_MODE_KEY] || {};
    const hostMode  = all[BADGE_HOST_MODE_KEY] || {};
    const corners   = all[BADGE_CORNER_KEY] || {};
    const anchors   = all[BADGE_ANCHOR_KEY] || {};
    const offsets   = all[BADGE_OFFSET_KEY] || {};

    const modeHere = (modeByUrl?.[host] || {})?.[urlKey];
    const mode = (modeHere === "free" || modeHere === "selector" || modeHere === "corner")
      ? modeHere
      : (hostMode?.[host] || "selector");

    // Set radio
    document.querySelectorAll('input[name="badgeMode"]').forEach(r => {
      r.checked = (r.value === mode);
    });

    // Corner / anchor / offsets (presets)
    const corner = corners?.[host] || "top-left";
    const anchor = anchors?.[host] || "#env-labels";
    const off = offsets?.[host] || {};
    const offX = Number.isFinite(off.offX) ? off.offX : 10;
    const offY = Number.isFinite(off.offY) ? off.offY : 32;

    const cornerSel = document.getElementById("badgeCorner");
    if (cornerSel) cornerSel.value = corner;

    const anchorInput = document.getElementById("badgeAnchor");
    if (anchorInput) anchorInput.value = anchor;

    const xInput = document.getElementById("badgeOffsetX");
    const yInput = document.getElementById("badgeOffsetY");
    if (xInput) xInput.value = String(offX);
    if (yInput) yInput.value = String(offY);

    // Friendly note
    const note = document.getElementById('stateMsg2');
    if (note) {
      note.textContent = "Tip: You can drag the badge on the page to save. In Corner/Anchor modes, dragging adjusts offsets; in Free mode, it saves per URL.";
    }
  } catch (e) {
    console.warn('initBadgeUiFromStorage failed', e);
  }
}

async function withActiveTab(fn){const tabs=await chrome.tabs.query({active:true,currentWindow:true});const tab=tabs?.[0];if(!tab?.id)return;return fn(tab.id);}
document.querySelectorAll('input[name="badgeMode"]').forEach(r=>{
  r.addEventListener('change',async()=>{
    if(!r.checked) return;
    const mode=r.value; // selector | corner | free
    await withActiveTab(async (id)=>{try{await chrome.tabs.sendMessage(id,{type:"SET_BADGE_MODE",mode});}catch{}});
    const note=document.getElementById('stateMsg2');
    if(note) note.textContent = mode==="free" ? "Drag anywhere on the page. Position auto-saves per URL." : "Mode updated.";
  });
});
document.getElementById('badgeCorner')?.addEventListener('change',async(e)=>{
  const corner=e.target.value;
  await withActiveTab(async(id)=>{try{await chrome.tabs.sendMessage(id,{type:"SET_BADGE_CORNER",corner});}catch{}});
  const note=document.getElementById('stateMsg2'); if(note) note.textContent="Corner saved.";
});
document.getElementById('badgeAnchor')?.addEventListener('change',async(e)=>{
  const anchor=e.target.value.trim();
  await withActiveTab(async(id)=>{try{await chrome.tabs.sendMessage(id,{type:"SET_BADGE_ANCHOR",anchor});}catch{}});
  const note=document.getElementById('stateMsg2'); if(note) note.textContent="Anchor selector saved.";
});
const sendOffsets=async()=>{
  const offX=Number(document.getElementById('badgeOffsetX')?.value||0);
  const offY=Number(document.getElementById('badgeOffsetY')?.value||0);
  await withActiveTab(async(id)=>{try{await chrome.tabs.sendMessage(id,{type:"SET_BADGE_OFFSETS",offX,offY});}catch{}});
  const note=document.getElementById('stateMsg2'); if(note) note.textContent="Offsets saved.";
};
document.getElementById('badgeOffsetX')?.addEventListener('change',sendOffsets);
document.getElementById('badgeOffsetY')?.addEventListener('change',sendOffsets);
document.getElementById('badgeReset')?.addEventListener('click',async()=>{
  await withActiveTab(async(id)=>{try{await chrome.tabs.sendMessage(id,{type:"BADGE_RESET_POSITION"});}catch{}});
  const note=document.getElementById('stateMsg2'); if(note) note.textContent="Position cleared for this URL (snapped to anchor).";
});

/* ---------- Target Strategist UI bindings ---------- */
document.getElementById('strategistRefresh')?.addEventListener('click', async () => {
  await scanStrategist();
});

document.getElementById('strategistGenerate')?.addEventListener('click', async () => {
  const note = document.getElementById('strategistNote');
  if (!strategistLast) await scanStrategist();
  if (!strategistLast) {
    if (note) note.textContent = "Nothing to generate. Open a supported page and rescan.";
    return;
  }
  const pageType = document.getElementById('strategistPageType')?.value || 'auto';
  const goal = document.getElementById('strategistGoal')?.value || 'conversion';
  const ideaCount = document.getElementById('strategistIdeaCount')?.value || 18;
  const includeCustom = !!document.getElementById('strategistIncludeCustom')?.checked;
  const customText = includeCustom ? await loadCustomIdeaText() : '';
  const customIdeas = includeCustom ? parseCustomIdeas(customText) : [];
  const result = buildSuggestionsFromScan(strategistLast, { pageType, goal, ideaCount, includeCustom, customIdeas });
  setStrategistUi({ suggestion: result?.text || "", ideas: result?.ideas || [], note: "Ideas generated." });
});

document.getElementById('strategistCopy')?.addEventListener('click', async () => {
  await copyStrategistSuggestion();
});

/* ---------- Init ---------- */
(async function init(){
  await initTabs();

  // Enable copy-to-clipboard on strategist status pills.
  wireStrategistPillCopy();

  // Gate the State UI based on active tab domain
  const tab = await getActiveTab();
  const allowed = !!tab?.url && isAcgAaaHost(tab.url);
  setStateControlsEnabled(allowed);

  // Show the currently active state (if we have one) from the AEM.state cookie.
  // This is helpful when you open the popup and want to confirm what state you're already in.
  try {
    const code = await readCurrentStateFromCookies(tab?.url);
    setCurrentStatePill(code);
  } catch {
    setCurrentStatePill('');
  }

  try{const stored=await chrome.storage.sync.get('selectedEnv');currentEnv=stored?.['selectedEnv']||'qa1';}
  catch{currentEnv='qa1';}
  setActiveEnvLink(currentEnv); 
  enableWebsitesAndAemLinks();

  // Prime the strategist section
  await scanStrategist();

  // Load custom idea text into the textarea
  const customText = await loadCustomIdeaText();
  const ta = document.getElementById('strategistCustomInput');
  if (ta) ta.value = customText;

  // Keep badge presets in sync with saved values
  await initBadgeUiFromStorage(tab);
})();

/* ---------- Target Strategist: Custom ideas UI bindings ---------- */
document.getElementById('strategistCustomSave')?.addEventListener('click', async () => {
  const ta = document.getElementById('strategistCustomInput');
  const status = document.getElementById('strategistCustomStatus');
  const text = ta?.value || '';

  // Validate parseability (but still save raw text so user can fix it)
  const ideas = parseCustomIdeas(text);
  const ok = await saveCustomIdeaText(text);
  if (status) {
    status.textContent = ok
      ? `Saved. Parsed ${ideas.length} idea(s).`
      : `Save failed. Storage may be blocked.`;
  }
});

document.getElementById('strategistCustomClear')?.addEventListener('click', async () => {
  const ta = document.getElementById('strategistCustomInput');
  const status = document.getElementById('strategistCustomStatus');
  if (ta) ta.value = '';
  const ok = await saveCustomIdeaText('');
  if (status) status.textContent = ok ? 'Cleared.' : 'Clear failed.';
});
