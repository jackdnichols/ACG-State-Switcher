// content-top-badge.js — tiny top-layer badge in TOP WINDOW only

(() => {
  if (window.top !== window) return;         // top frame only
  if (window.__envTopBadge) return;          // prevent double init
  window.__envTopBadge = true;

  const HOST_ID = "__env_badge_dialog";
  let currentEnv = null;
  let currentTheme = "system";
  let lastUrl = location.href;

  console.log("[EnvHelper] TOP badge script loaded:", location.href);

  function ensureBody(fn) {
    if (document.body) { fn(); return; }
    const obs = new MutationObserver(() => {
      if (document.body) { obs.disconnect(); fn(); }
    });
    obs.observe(document.documentElement || document, { childList: true, subtree: true });
  }

  function isLight(theme) {
    return theme === "light" || (theme === "system" && matchMedia("(prefers-color-scheme: light)").matches);
  }

  function getOrCreateDialog() {
    let dlg = document.getElementById(HOST_ID);
    if (dlg) return dlg;

    dlg = document.createElement("dialog");
    dlg.id = HOST_ID;
    Object.assign(dlg.style, {
      padding: "0",
      border: "none",
      background: "transparent",
      position: "fixed",
      inset: "auto 10px 10px auto",
      margin: "0",
      pointerEvents: "none",
      zIndex: "2147483647"
    });

    const shadow = dlg.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .badge {
        all: initial;
        display: inline-block;
        padding: 6px 12px;
        border-radius: 10px;
        font: 700 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
        letter-spacing: .3px;
        box-shadow: 0 2px 6px rgba(0,0,0,.25);
        border: 1px solid rgba(0,0,0,.25);
        white-space: nowrap;
        user-select: none;
        pointer-events: none;
      }
      .light {
        background: #e0f7e9;
        color: #064420;
        text-shadow: 0 1px 0 rgba(255,255,255,.4);
        border-color: rgba(6,68,32,.4);
      }
      .dark {
        background: #064420;
        color: #e0f7e9;
        text-shadow: 0 1px 0 rgba(0,0,0,.5);
        border-color: rgba(224,247,233,.35);
      }
    `;
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = "";

    shadow.appendChild(style);
    shadow.appendChild(badge);

    document.body.appendChild(dlg);
    try { dlg.show(); } catch {}
    console.log("[EnvHelper] TOP badge dialog created");
    return dlg;
  }

  function updateBadge(env, theme) {
    currentEnv = env ?? currentEnv;
    currentTheme = theme ?? currentTheme;
    if (!currentEnv) return;

    ensureBody(() => {
      const dlg = getOrCreateDialog();
      const badge = dlg.shadowRoot?.querySelector(".badge");
      if (!badge) return;

      badge.classList.remove("light", "dark");
      badge.classList.add(isLight(currentTheme) ? "light" : "dark");
      badge.textContent = String(currentEnv).toUpperCase();

      try { dlg.open || dlg.show(); } catch {}
      console.log("[EnvHelper] TOP badge updated:", { env: currentEnv, theme: currentTheme });
    });
  }

  // SPA route changes
  const orig = history.pushState;
  history.pushState = function (...args) {
    const r = orig.apply(this, args);
    queueMicrotask(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (currentEnv) updateBadge(currentEnv, currentTheme);
      }
    });
    return r;
  };
  window.addEventListener("popstate", () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (currentEnv) updateBadge(currentEnv, currentTheme);
    }
  });

  // Theme changes
  const darkMql = window.matchMedia("(prefers-color-scheme: dark)");
  darkMql.addEventListener?.("change", () => {
    if (currentTheme === "system" && currentEnv) updateBadge(currentEnv, "system");
  });

  // Messaging
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "SET_BADGE") {
      updateBadge(msg.env, msg.theme);
    } else if (msg.type === "PING_TOP") {
      sendResponse({ pong: true, env: currentEnv, theme: currentTheme });
    }
  });

  // Alt+B toggle (debug)
  window.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "b" || e.key === "B")) {
      const dlg = document.getElementById(HOST_ID) || getOrCreateDialog();
      if (!dlg) return;
      if (dlg.open) dlg.close(); else { try { dlg.show(); } catch {} }
    }
  });
})();
