// ===============================
// ACG State Switcher — popup.js
// ===============================

// Popup UI storage keys
const POPUP_TAB_KEY = "popupActiveTab";
const STRATEGIST_CUSTOM_KEY = "strategistCustomIdeas";

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

/* ---------- Apply Cookies ---------- */
const DOMAIN_ALLOWLIST = ["aaa.com", "acg.aaa.com", "meemic.com", "meemicfoundation.org"];
function targetUrlForCookie(c){const p=(c.path&&String(c.path))||"/";if(c.hostOnly&&c.domain){const h=String(c.domain).replace(/^\./,"");return `https://${h}${p.startsWith("/")?p:`/${p}`}`;}return `https://www.acg.aaa.com${p.startsWith("/")?p:`/${p}`}`;}
function normalizeSameSite(v){if(v==null)return;const s=String(v).toLowerCase();if(s==="none"||s==="no_restriction")return"no_restriction";if(s==="lax")return"lax";if(s==="strict")return"strict";}
function isAllowedHost(url){try{const u=new URL(url);const h=u.hostname.toLowerCase();return DOMAIN_ALLOWLIST.some(d=>{d=d.toLowerCase().replace(/^\./,"");return h===d||h.endsWith("."+d);});}catch{return false;}}
function buildCompatDetails(c){const d={url:targetUrlForCookie(c),name:c.name,value:String(c.value??""),path:(c.path&&String(c.path))||"/",secure:!!c.secure,httpOnly:!!c.httpOnly};if(!c.hostOnly&&c.domain)d.domain=c.domain;const ss=normalizeSameSite(c.sameSite);if(ss)d.sameSite=ss;if(d.sameSite==="no_restriction"){d.secure=true;try{const u=new URL(d.url);u.protocol="https:";d.url=u.toString();}catch{}}if(Number.isFinite(+c.expirationDate))d.expirationDate=Math.floor(+c.expirationDate);return d;}
function candidateCookiePaths(n){const raw=(n||"").trim();const ns=raw.replace(/\s+/g,"");const low=raw.toLowerCase();const lns=low.replace(/\s+/g,"");return[`cookies/${raw}.json`,`cookies/${ns}.json`,`cookies/${low}.json`,`cookies/${lns}.json`];}
async function fetchFirstCookieFile(n){const tried=[];for(const p of candidateCookiePaths(n)){const url=chrome.runtime.getURL(p);tried.push(url);try{const r=await fetch(url);if(r.ok)return{json:await r.json(),path:p};}catch{}}const e=new Error(`No cookie file found for "${n}".`);e.tried=tried;throw e;}
async function applyCookies(cookies){let ok=0,fail=0;const errors=[];for(const c of cookies){const name=c?.name||"(unnamed)";try{if(!c?.name)throw new Error("Missing name");const val=String(c.value??"");if(val.length>4096)throw new Error("Value exceeds 4096 bytes");let det=buildCompatDetails(c);if(!isAllowedHost(det.url)){const exact=(c.hostOnly&&c.domain)?String(c.domain).replace(/^\./,""):(c.domain?String(c.domain).replace(/^\./,""):"www.acg.aaa.com");det={url:`https://${exact}/`,name:c.name,value:String(c.value??""),path:"/",secure:true,httpOnly:!!c.httpOnly};if(!isAllowedHost(det.url))throw new Error(`not in allowlist (${det.url})`);}await chrome.cookies.set(det);ok++;}catch(e){fail++;errors.push(`${name}: ${e?.message||e}`);}}return{ok,fail,errors};}
function toast(el,msg,ok=true){if(!el)return;el.className=`msg ${ok?"ok":"err"}`;el.textContent=msg;}

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
  const cls = state === "ok" ? "pill-ok" : state === "warn" ? "pill-warn" : state === "info" ? "pill-info" : "pill-neutral";
  el.classList.add(cls);
  el.textContent = text || "";
  if (tooltip != null) el.setAttribute("data-tooltip", tooltip);
}

function updateStrategistStatusPills(s) {
  const $domain = document.getElementById("pillDomain");
  const $dd = document.getElementById("pillDD");
  const $s = document.getElementById("pillS");
  const $web = document.getElementById("pillWebSDK");
  const $tgt = document.getElementById("pillTarget");
  const $sel = document.getElementById("pillSelectors");

  if (!s) {
    setPill($domain, "neutral", "Domain", "");
    setPill($dd, "neutral", "digitalData", "");
    setPill($s, "neutral", "s.pageName", "");
    setPill($web, "neutral", "Web SDK", "");
    setPill($tgt, "neutral", "Target", "");
    setPill($sel, "neutral", "Selectors", "");
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
    const tags = [i.activityType, i.audience].filter(Boolean);
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
    const a = i.a || i.variantA;
    const b = i.b || i.variantB;
    const why = i.why || i.hypothesis;
    const measure = i.kpi || i.measure;
    const guard = i.guardrails || i.guardrail;

    addKV("Placement", i.placement);
    addKV("Test", test);
    if (why && String(why).length <= 140) addKV("Why", why);
    addKV("A", a);
    addKV("B", b);
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
  const a = i?.a || i?.variantA || "";
  const b = i?.b || i?.variantB || "";
  const measure = i?.kpi || i?.measure || "";
  const guard = i?.guardrails || i?.guardrail || "";

  return [
    `Target Idea #${idx}: ${title}`,
    `Activity: ${activityType}`,
    `Audience: ${audience}`,
    placement ? `Placement: ${placement}` : "",
    test ? `Test: ${test}` : "",
    (why && String(why).length <= 200) ? `Why: ${why}` : "",
    a ? `A: ${a}` : "",
    b ? `B: ${b}` : "",
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
    if (tooltip != null) $pill.setAttribute("data-tooltip", tooltip);
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

            out.push({ score, text, href, tag: el.tagName, selector: uniqueSelector(el) });
          }

          out.sort((a, b) => b.score - a.score);
          return out[0] || { score: 0, text: '', href: '', tag: '', selector: '' };
        }

        const cta = bestCta();
        const formCount = document.querySelectorAll('form').length;
        const firstForm = document.querySelector('form');
        const formSelector = firstForm ? uniqueSelector(firstForm) : '';

        return {
          pageName,
          pathname,
          h1,
          h1Selector,
          ctaText: cta.text,
          ctaHref: cta.href,
          ctaSelector: cta.selector,
          formCount,
          formSelector,
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
      ctaText: (data.ctaText || ""),
      ctaHref: (data.ctaHref || ""),
      ctaSelector: (data.ctaSelector || ""),
      formCount: Number.isFinite(+data.formCount) ? +data.formCount : 0,
      formSelector: (data.formSelector || ""),
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
  const formCount = Number.isFinite(+s.formCount) ? +s.formCount : null;
  const formSelector = (s.formSelector || "").trim();

  const signals = [
    `digitalData: ${s.hasDD ? "✓" : "✗"}`,
    `s.pageName: ${s.hasS ? "✓" : "✗"}`,
    `Web SDK: ${s.hasAlloy ? "✓" : "✗"}`,
    `Target: ${s.hasAt ? "✓" : "?"}`
  ].join(" | ");

  const hay = `${page} ${pathname} ${h1} ${ctaText}`.toLowerCase();
  const inferredQuote = /quote|get\s*a\s*quote|start\s*quote|auto\s*quote|home\s*quote|bundle|insurance/.test(hay);
  const isBilling = /pay|billing|payment|autopay|paperless|invoice/.test(hay);
  const isDonate = /donate|donation|give|foundation|grant/.test(hay);
  const isLogin = /login|log\s*in|sign\s*in|account/.test(hay);
  const isSearchOrNav = /search|find|locations|agents|contact/.test(hay);

  const pageType = String(opts.pageType || '').toLowerCase() ||
    (inferredQuote ? 'quote' : (isBilling ? 'billing' : (isDonate ? 'donate' : (isLogin ? 'login' : (isSearchOrNav ? 'nav' : 'generic')))));

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
    const a = i.a || i.variantA || 'Current experience.';
    const b = i.b || i.variantB || 'Proposed experience.';
    const measure = i.kpi || i.measure || 'Primary action rate';
    const guard = i.guardrails || i.guardrail || '';

    return [
      `• ${title}`,
      `  Activity: ${activityType} | Audience: ${audience}`,
      placement ? `  Placement: ${placement}` : '',
      `  Test: ${test}`,
      (why && String(why).length <= 140) ? `  Why: ${why}` : '',
      `  A: ${a}`,
      `  B: ${b}`,
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
      variantB: "Use a high-contrast accent color (keep text white).",
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
      title: "CTA button color (high contrast)",
      activityType: "A/B",
      audience: "All visitors",
      placement: ctaSelector ? `CTA button (${ctaSelector})` : "Primary CTA button",
      change: "Change the primary CTA button color to a higher-contrast accent",
      variantA: "Keep current CTA button color",
      variantB: "Use AAA blue (or a warm accent) with white text; increase contrast and keep the rest unchanged",
      kpi: "CTA clicks → quote starts",
      guardrails: "Bounce, misclicks",
      tags: ["quote","cta","color"]
    },
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
      variantB: "Try: 'See my price' / 'Start my quote' / 'Get my estimate'",
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
    }
  ];

  let pool = [...universalIdeas];
  if (pageType === 'quote') pool = pool.concat(quoteIdeas);
  else if (pageType === 'billing') pool = pool.concat(billingIdeas);
  else if (pageType === 'donate') pool = pool.concat(donateIdeas);
  else if (pageType === 'login') pool = pool.concat(loginIdeas);
  else if (pageType === 'nav') pool = pool.concat(navIdeas);

  if (includeCustom && customIdeas.length) pool = pool.concat(customIdeas);

  // Shuffle, then take the requested count.
  const shuffled = shuffleDeterministic(pool, `${url}|${page}|${pageType}`);
  const chosen = shuffled.slice(0, Math.min(ideaCount, shuffled.length));

  // --- Instrumentation warning ---
  const missingNote = (!s.hasDD && !s.hasS && !s.hasAlloy)
    ? "NOTE: No Adobe signals were detected. Before trusting results, confirm analytics instrumentation (digitalData / s-object / Web SDK) is firing on this page."
    : "";

  const header = [
    `Target Strategist Ideas (${chosen.length})`,
    `Brand: ${brand} | Env: ${env}`,
    `URL: ${url}`,
    `Page: ${page || "(unknown)"}`,
    `Page type: ${pageType}`,
    `Signals: ${signals}`,
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
    meta: { brand, env, url, page, pageType, signals }
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

document.getElementById('applyBtn')?.addEventListener('click', async () => {
  const msgEl=document.getElementById('stateMsg');
  
  // Hard guard: do nothing if disabled
  if (document.getElementById('applyBtn').disabled) return;

  try{
    const sel=document.getElementById('stateSelect');const state=sel?.value?.trim();
    if(!state){toast(msgEl,"Pick a state first.",false);return;}
    const {json:cookies,path}=await fetchFirstCookieFile(state);
    const {ok,fail,errors}=await applyCookies(cookies);
    if(fail===0)toast(msgEl,`Applied ${ok} cookies ✔ (${path})`,true);
    else{const summary=errors.slice(0,6).join(" • ");toast(msgEl,`Applied ${ok}; ${fail} failed. ${summary}${errors.length>6?" • …":""}`,false);}
    setTimeout(()=>{chrome.tabs.query({active:true,currentWindow:true},(tabs)=>{const id=tabs?.[0]?.id;if(id)chrome.tabs.reload(id,{bypassCache:true});});window.close();},1000);
  }catch(err){console.error('State apply error:',err);toast(msgEl,err?.message||"Error applying state cookies",false);}
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
  const pageType = document.getElementById('strategistPageType')?.value || 'quote';
  const ideaCount = document.getElementById('strategistIdeaCount')?.value || 18;
  const includeCustom = !!document.getElementById('strategistIncludeCustom')?.checked;
  const customText = includeCustom ? await loadCustomIdeaText() : '';
  const customIdeas = includeCustom ? parseCustomIdeas(customText) : [];
  const result = buildSuggestionsFromScan(strategistLast, { pageType, ideaCount, includeCustom, customIdeas });
  setStrategistUi({ suggestion: result?.text || "", ideas: result?.ideas || [], note: "Ideas generated." });
});

document.getElementById('strategistCopy')?.addEventListener('click', async () => {
  await copyStrategistSuggestion();
});

/* ---------- Init ---------- */
(async function init(){
  await initTabs();

  // Gate the State UI based on active tab domain
  const tab = await getActiveTab();
  const allowed = !!tab?.url && isAcgAaaHost(tab.url);
  setStateControlsEnabled(allowed);

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
