// top-badge.js — single-instance badge (TOP FRAME ONLY), supports corner/anchor + offsets

(() => {
  if (window.top !== window) return;
  if (window.__ENV_BADGE_MOUNTED) return;
  window.__ENV_BADGE_MOUNTED = true;

  const ID = "__env_badge";
  const state = {
    text: "ENV?",
    mode: "corner",                 // "corner" | "anchor"
    corner: "bottom-right",         // top-left | top-right | bottom-left | bottom-right
    anchor: "#env-labels",          // CSS selector
    offX: 10,
    offY: 32,
    theme: "system"                 // system | light | dark
  };

  let badgeEl = null;
  let repositionRAF = 0;
  let anchorObserver = null;

  function isLightTheme() {
    if (state.theme === "light") return true;
    if (state.theme === "dark") return false;
    return matchMedia("(prefers-color-scheme: light)").matches;
  }

  function makeBadge() {
    if (document.getElementById(ID)) return document.getElementById(ID);

    const el = document.createElement("div");
    el.id = ID;
    el.style.position = "fixed";
    el.style.zIndex = "2147483647";
    el.style.pointerEvents = "none";
    el.style.padding = "8px 12px";
    el.style.font = "700 12px/1 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
    el.style.borderRadius = "10px";
    el.style.boxShadow = "0 4px 12px rgba(0,0,0,.35)";
    el.style.textTransform = "uppercase";
    el.style.letterSpacing = ".3px";

    document.documentElement.appendChild(el);
    return el;
  }

  function applyTheme() {
    if (!badgeEl) return;
    const light = isLightTheme();
    badgeEl.style.background = light ? "#e0f7e9" : "#064420";
    badgeEl.style.color = light ? "#064420" : "#e0f7e9";
    badgeEl.style.border = light ? "1px solid rgba(6,68,32,.35)" : "1px solid rgba(224,247,233,.35)";
  }

  function applyText() {
    if (!badgeEl) return;
    badgeEl.textContent = String(state.text || "ENV?").toUpperCase();
  }

  function placeCorner() {
    // reset all positional edges
    badgeEl.style.top = badgeEl.style.right = badgeEl.style.bottom = badgeEl.style.left = "auto";

    const c = state.corner;
    if (c.includes("top"))    badgeEl.style.top = `${state.offY}px`;
    if (c.includes("bottom")) badgeEl.style.bottom = `${state.offY}px`;
    if (c.includes("left"))   badgeEl.style.left = `${state.offX}px`;
    if (c.includes("right"))  badgeEl.style.right = `${state.offX}px`;
  }

  function placeAnchor() {
    // position relative to anchor rect (viewport coords)
    const target = document.querySelector(state.anchor);
    if (!target) {
      // fallback to bottom-right so it never disappears
      placeCorner();
      return;
    }
    const r = target.getBoundingClientRect();
    badgeEl.style.top = `${Math.max(0, r.top + state.offY)}px`;
    badgeEl.style.left = `${Math.max(0, r.left + state.offX)}px`;
    badgeEl.style.right = "auto";
    badgeEl.style.bottom = "auto";
  }

  function reposition() {
    if (!badgeEl) return;
    cancelAnimationFrame(repositionRAF);
    repositionRAF = requestAnimationFrame(() => {
      if (state.mode === "anchor") placeAnchor();
      else placeCorner();
    });
  }

  function observeAnchor() {
    if (anchorObserver) { anchorObserver.disconnect(); anchorObserver = null; }
    if (state.mode !== "anchor") return;
    const t = document.querySelector(state.anchor);
    if (!t) return;
    anchorObserver = new ResizeObserver(reposition);
    anchorObserver.observe(document.documentElement);
    anchorObserver.observe(t);
  }

  function mount() {
    badgeEl = makeBadge();
    applyTheme();
    applyText();
    reposition();
    observeAnchor();
  }

  function updateBadge(partial = {}) {
    Object.assign(state, partial);
    if (!badgeEl) mount();
    applyTheme();
    applyText();
    reposition();
  }

  // Respond to popup/background
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "PING_MIN_BADGE") {
      sendResponse?.({ ok: true, mounted: !!document.getElementById(ID) });
    }
    if (msg.type === "SET_ENV_TEXT") {
      updateBadge({ text: msg.text });
    }
    if (msg.type === "SET_BADGE_OPTS") {
      updateBadge({
        mode: msg.mode,
        corner: msg.corner,
        anchor: msg.anchor,
        offX: Number(msg.offX) || 0,
        offY: Number(msg.offY) || 0,
        theme: msg.theme || state.theme
      });
    }
  });

  // Initial mount when ready
  if (document.readyState === "complete" || document.readyState === "interactive") mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });

  // Keep position correct on viewport changes
  window.addEventListener("scroll", reposition, { passive: true });
  window.addEventListener("resize", reposition, { passive: true });

  // If system theme changes and we're in "system", refresh colors
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (state.theme === "system") applyTheme();
  });
})();
