(() => {
  if (window.top !== window.self) return;
  if (window.__ENV_BADGE_BOOTED) return;
  window.__ENV_BADGE_BOOTED = true;

  const AUTHOR_HOST_TO_ENV = {
    "author-p149839-e1583596.adobeaemcloud.com": "production",
    "author-p149839-e1583546.adobeaemcloud.com": "stage1",
    "author-p149839-e1583595.adobeaemcloud.com": "qa1",
    "author-p149839-e1544194.adobeaemcloud.com": "dev1"
  };
  const AUTHOR_HOSTS = new Set(Object.keys(AUTHOR_HOST_TO_ENV));

  const ENV_BADGE_COLORS = {
    dev1: "#4caf50",
    qa1: "#2563eb",
    stage1: "#692bd8",
    production: "#e03131"
  };

  const host = location.hostname.toLowerCase();
  if (!AUTHOR_HOSTS.has(host)) return;

  // --- Key helpers (now with variants) ---
  function buildUrlParts() {
    const path = location.pathname || "/";
    const hashFull = location.hash || "";                 
    const hashNoQuery = hashFull.split("?")[0];    
    return { path, hashFull, hashNoQuery };
  }
  function urlKeyNormalized() {
    const { path, hashNoQuery } = buildUrlParts();
    return `${host}|${path}|${hashNoQuery}`;
  }
  function urlKeyVariants() {
    const { path, hashFull, hashNoQuery } = buildUrlParts();    
    return [
      `${host}|${path}|${hashNoQuery}`,
      `${host}|${path}|${hashFull}`,
      `${host}|${path}|`
    ];
  }

  function labelFor(env) {
    const t = env.toLowerCase();
    if (t === "dev1") return "DEV 1";
    if (t === "qa1") return "QA 1";
    if (t === "stage1") return "Stage 1";
    return "Prod";
  }

  // ---- State ----
  const STATE = {
    env: AUTHOR_HOST_TO_ENV[host] || "production",
    mode: "selector",     
    anchor: "#env-labels",
    corner: "top-left",
    offX: 0,
    offY: 0,
    color: ENV_BADGE_COLORS[AUTHOR_HOST_TO_ENV[host] || "production"],
    ready: false,

    freeX: 10,
    freeY: 10,
    dragging: false
  };

  // storage keys
  const URL_POSITIONS_KEY = "badgePositionsByUrl"; 
  const URL_MODE_KEY      = "badgeModeByUrl";    
  const HOST_MODE_KEY     = "badgeModePerHost";  
  const CORNER_KEY        = "badgeCornerPerHost"; 
  const ANCHOR_KEY        = "badgeAnchorPerHost"; 
  const OFFSET_KEY        = "badgeOffsetPerHost";  

  let badgeEl = null, anchorObserver = null, rafId = null;

  function ensureBadge() {
    if (badgeEl && badgeEl.isConnected) return badgeEl;
    const dupe = document.querySelectorAll("#__env_badge");
    for (let i = 1; i < dupe.length; i++) dupe[i].remove();
    badgeEl = dupe[0] || document.createElement("div");
    badgeEl.id = "__env_badge";
    badgeEl.setAttribute("aria-live", "polite");
    Object.assign(badgeEl.style, {
      position: "fixed",
      zIndex: "2147483647",
      fontFamily: "Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      fontWeight: "600",
      fontSize: "12px",
      letterSpacing: "0.2px",
      lineHeight: "1.35",
      padding: "6px 10px",
      // borderRadius: "999px", // It looks better square 
      background: STATE.color,
      color: "#fff",
      boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
      userSelect: "none",
      pointerEvents: "auto",
      whiteSpace: "nowrap",
      transform: "translateZ(0)",
      display: "none",
      cursor: "grab"
    });
    if (!dupe[0]) document.documentElement.appendChild(badgeEl);
    return badgeEl;
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const safeNum = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n) : d);

  function applyPosition() {
    const el = ensureBadge();
    el.style.display = STATE.ready ? "inline-block" : "none";
    if (el.style.display === "none") return;

    el.style.top = el.style.right = el.style.bottom = el.style.left = "auto";

    if (STATE.mode === "free") {
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = el.offsetWidth || 120, h = el.offsetHeight || 24;
      const x = clamp(STATE.freeX, 0, Math.max(0, vw - w));
      const y = clamp(STATE.freeY, 0, Math.max(0, vh - h));
      el.style.left = `${Math.round(x)}px`;
      el.style.top  = `${Math.round(y)}px`;
      el.style.cursor = STATE.dragging ? "grabbing" : "grab";
      return;
    }

    if (STATE.mode === "selector") {
      const anchorEl = document.querySelector(STATE.anchor);
      if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        el.style.left = `${Math.round(rect.left + safeNum(STATE.offX))}px`;
        el.style.top  = `${Math.round(rect.top  + safeNum(STATE.offY))}px`;
      } else {
        el.style.left = `${safeNum(STATE.offX, 10)}px`;
        el.style.top  = `${safeNum(STATE.offY, 10)}px`;
      }
      el.style.cursor = STATE.dragging ? "grabbing" : "grab";
      return;
    }

    // corner
    const offX = safeNum(STATE.offX, 10), offY = safeNum(STATE.offY, 10);
    const c = STATE.corner || "top-left";
    if (c === "top-left")        { el.style.left  = `${offX}px`; el.style.top    = `${offY}px`; }
    else if (c === "top-right")  { el.style.right = `${offX}px`; el.style.top    = `${offY}px`; }
    else if (c === "bottom-left"){ el.style.left  = `${offX}px`; el.style.bottom = `${offY}px`; }
    else if (c === "bottom-right"){el.style.right = `${offX}px`; el.style.bottom = `${offY}px`; }
    el.style.cursor = STATE.dragging ? "grabbing" : "grab";
  }

  function scheduleApply() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(applyPosition); }

  
  async function loadPersistedForUrl() {
    try {
      const all = await chrome.storage.sync.get([URL_POSITIONS_KEY, URL_MODE_KEY, HOST_MODE_KEY, CORNER_KEY, ANCHOR_KEY, OFFSET_KEY]);
      const posByUrl  = all[URL_POSITIONS_KEY] || {};
      const modeByUrl = all[URL_MODE_KEY] || {};
      const hostMode  = all[HOST_MODE_KEY] || {};
      const corners   = all[CORNER_KEY] || {};
      const anchors   = all[ANCHOR_KEY] || {};
      const offsets   = all[OFFSET_KEY] || {};

      const perHostModes = modeByUrl[host] || {};
      const modeHere = perHostModes[urlKeyNormalized()];
      if (modeHere === "free" || modeHere === "selector" || modeHere === "corner") {
        STATE.mode = modeHere;
      } else {        
        const hostM = hostMode[host];
        if (hostM === "free") {
          const perHostPos = (posByUrl[host] || {});
          const hasAny = urlKeyVariants().some(k => !!perHostPos[k]);
          STATE.mode = hasAny ? "free" : "selector";
        } else if (hostM === "selector" || hostM === "corner") {
          STATE.mode = hostM;
        } else {
          STATE.mode = "selector";
        }
      }

      // Load per-URL free position using any variant
      const perHostPos = posByUrl[host] || {};
      const gotKey = urlKeyVariants().find(k => perHostPos[k]);
      if (gotKey) {
        const p = perHostPos[gotKey];
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
          STATE.freeX = p.x; STATE.freeY = p.y;
        }
      }

      // Per-host corner/anchor/offsets
      if (corners[host]) STATE.corner = corners[host];
      if (anchors[host]) STATE.anchor = anchors[host];
      if (offsets[host]) {
        if (Number.isFinite(offsets[host].offX)) STATE.offX = offsets[host].offX;
        if (Number.isFinite(offsets[host].offY)) STATE.offY = offsets[host].offY;
      }
    } catch {}
  }

  async function saveUrlMode(mode) {
    try {
      const all = await chrome.storage.sync.get([URL_MODE_KEY]);
      const modeByUrl = all[URL_MODE_KEY] || {};
      modeByUrl[host] = modeByUrl[host] || {};
      modeByUrl[host][urlKeyNormalized()] = mode;
      await chrome.storage.sync.set({ [URL_MODE_KEY]: modeByUrl });
    } catch {}
  }

  async function autoSavePositionForUrl() {
    try {
      const all = await chrome.storage.sync.get([URL_POSITIONS_KEY, URL_MODE_KEY]);
      const posByUrl = all[URL_POSITIONS_KEY] || {};
      const modeByUrl = all[URL_MODE_KEY] || {};
      posByUrl[host] = posByUrl[host] || {};
      posByUrl[host][urlKeyNormalized()] = { x: Math.round(STATE.freeX), y: Math.round(STATE.freeY) };
      modeByUrl[host] = modeByUrl[host] || {};
      modeByUrl[host][urlKeyNormalized()] = "free";
      await chrome.storage.sync.set({ [URL_POSITIONS_KEY]: posByUrl, [URL_MODE_KEY]: modeByUrl });
      return true;
    } catch { return false; }
  }

  async function clearPositionAndModeForUrl() {
    try {
      const all = await chrome.storage.sync.get([URL_POSITIONS_KEY, URL_MODE_KEY]);
      const posByUrl = all[URL_POSITIONS_KEY] || {};
      const modeByUrl = all[URL_MODE_KEY] || {};

      // Clear every variant so legacy keys don't linger
      const variants = urlKeyVariants();
      if (posByUrl[host]) variants.forEach(k => delete posByUrl[host][k]);
      if (modeByUrl[host]) variants.forEach(k => delete modeByUrl[host][k]);

      await chrome.storage.sync.set({ [URL_POSITIONS_KEY]: posByUrl, [URL_MODE_KEY]: modeByUrl });
      return true;
    } catch { return false; }
  }

  async function persistHostCornerAnchorOffsets() {
    try {
      const all = await chrome.storage.sync.get([CORNER_KEY, ANCHOR_KEY, OFFSET_KEY]);
      const corners = all[CORNER_KEY] || {};
      const anchors = all[ANCHOR_KEY] || {};
      const offsets = all[OFFSET_KEY] || {};
      corners[host] = STATE.corner;
      anchors[host] = STATE.anchor;
      offsets[host] = { offX: STATE.offX, offY: STATE.offY };
      await chrome.storage.sync.set({ [CORNER_KEY]: corners, [ANCHOR_KEY]: anchors, [OFFSET_KEY]: offsets });
    } catch {}
  }

  // ---- Drag (all modes) ----
// Dragging behavior:
// - free: saves absolute x/y per URL
// - selector: drag adjusts offsets relative to the anchor selector (keeps anchor)
// - corner: drag adjusts offsets relative to chosen corner (keeps corner)

let dragStart = null;

function onPointerDown(e) {
  // Only primary button / primary pointer
  if (e.button != null && e.button !== 0) return;
  if (e.isPrimary === false) return;

  e.preventDefault();
  const el = ensureBadge();
  STATE.dragging = true;
  el.setPointerCapture?.(e.pointerId);

  dragStart = {
    startX: e.clientX,
    startY: e.clientY,
    mode: STATE.mode,
    corner: STATE.corner,
    origOffX: safeNum(STATE.offX, 0),
    origOffY: safeNum(STATE.offY, 0),
    origFreeX: safeNum(STATE.freeX, 10),
    origFreeY: safeNum(STATE.freeY, 10)
  };

  el.style.cursor = "grabbing";
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp, { passive: false });
}

function onPointerMove(e) {
  if (!STATE.dragging || !dragStart) return;
  e.preventDefault();

  const dx = e.clientX - dragStart.startX;
  const dy = e.clientY - dragStart.startY;

  if (dragStart.mode === "free") {
    STATE.freeX = dragStart.origFreeX + dx;
    STATE.freeY = dragStart.origFreeY + dy;
  } else if (dragStart.mode === "selector") {
    STATE.offX = clamp(dragStart.origOffX + dx, 0, 9999);
    STATE.offY = clamp(dragStart.origOffY + dy, 0, 9999);
  } else {
    // corner
    const c = (dragStart.corner || STATE.corner || "top-left");
    const ox = dragStart.origOffX;
    const oy = dragStart.origOffY;

    const nextX = c.includes("right") ? (ox - dx) : (ox + dx);
    const nextY = c.includes("bottom") ? (oy - dy) : (oy + dy);

    STATE.offX = clamp(nextX, 0, 9999);
    STATE.offY = clamp(nextY, 0, 9999);
  }

  scheduleApply();
}

async function onPointerUp(e) {
  if (!STATE.dragging) return;
  e.preventDefault();

  const el = ensureBadge();
  STATE.dragging = false;
  el.releasePointerCapture?.(e.pointerId);

  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);

  // Persist
  try {
    if (dragStart?.mode === "free") {
      await autoSavePositionForUrl();
    } else {
      // Keep the preset mode, just store the new offsets.
      await persistHostCornerAnchorOffsets();
      await saveUrlMode(dragStart?.mode || STATE.mode);
    }
  } catch {}

  dragStart = null;
  el.style.cursor = "grab";
  scheduleApply();
}

function wireDrag() {
  const el = ensureBadge();
  el.removeEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointerdown", onPointerDown, { passive: false });
  el.style.cursor = STATE.dragging ? "grabbing" : "grab";
}

// ---- Boot ----
  (async () => {
    await loadPersistedForUrl();

    ensureBadge();
    badgeEl.textContent = labelFor(STATE.env);
    badgeEl.style.background = STATE.color;
    STATE.ready = true;

    wireDrag();
    scheduleApply();

    // Watch for anchor (selector mode)
    const mo = new MutationObserver(() => {
      if (STATE.mode === "selector" && document.querySelector(STATE.anchor)) {
        startAnchorObserver();
        scheduleApply();
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // SPA/route changes → reload per-URL mode/pos and apply
    const reapplyForNewUrl = async () => {
      await loadPersistedForUrl();
      wireDrag();
      scheduleApply();
    };
    const _push = history.pushState, _replace = history.replaceState;
    history.pushState = function () { const r = _push.apply(this, arguments); reapplyForNewUrl(); return r; };
    history.replaceState = function () { const r = _replace.apply(this, arguments); reapplyForNewUrl(); return r; };
    window.addEventListener("hashchange", reapplyForNewUrl);
    window.addEventListener("resize", scheduleApply);
    window.addEventListener("scroll", scheduleApply, { passive: true });
  })();

  function startAnchorObserver() {
    const anchorEl = document.querySelector(STATE.anchor);
    if (!anchorEl) return;
    anchorObserver?.disconnect?.();
    anchorObserver = new ResizeObserver(scheduleApply);
    anchorObserver.observe(anchorEl);
  }

  // ---- Messages from popup ----
  chrome.runtime?.onMessage?.addListener?.((msg, _s, sendResponse) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "SET_BADGE_MODE") {
      const m = msg.mode;
      if (m === "selector" || m === "corner" || m === "free") {
        STATE.mode = m;        
        saveUrlMode(m);
        wireDrag();
        scheduleApply();
      }
      return;
    }

    if (msg.type === "SET_BADGE_CORNER") {
      if (typeof msg.corner === "string") STATE.corner = msg.corner;
      persistHostCornerAnchorOffsets();
      scheduleApply();
      return;
    }

    if (msg.type === "SET_BADGE_ANCHOR") {
      if (typeof msg.anchor === "string") STATE.anchor = msg.anchor;
      persistHostCornerAnchorOffsets();
      scheduleApply();
      return;
    }

    if (msg.type === "SET_BADGE_OFFSETS") {
      if (Number.isFinite(msg.offX)) STATE.offX = Number(msg.offX);
      if (Number.isFinite(msg.offY)) STATE.offY = Number(msg.offY);
      persistHostCornerAnchorOffsets();
      scheduleApply();
      return;
    }

    if (msg.type === "BADGE_RESET_POSITION") {      
      clearPositionAndModeForUrl().then(async () => {
        STATE.mode = "selector";
        await saveUrlMode("selector"); 
        wireDrag();
        scheduleApply();
        sendResponse?.({ ok: true });
      });
      return true;
    }
  });
})();
