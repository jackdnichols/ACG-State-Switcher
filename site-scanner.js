// site-scanner.js — a general-purpose port of the Site Inspector scanner
// originally built into the ACG-State-Switcher extension (itself ported from
// the Tealium "Site QA Scanner" utility). Same scanning/detection logic
// (lower-env link patterns, image candidate collection, spell dictionary,
// word search), but with the hard-coded acg.aaa.com/meemic.com/
// meemicfoundation.org allowlist removed: this version scans whatever
// http(s) Start URL you give it.
//   - Runs as its own top-level chrome-extension:// page, not an iframe.
//   - fetchHtmlPage() uses credentials:"include" instead of "same-origin",
//     because a request from a chrome-extension:// page to another site is
//     cross-site. Cookies marked SameSite=Lax/Strict on the target (the
//     default for most session cookies) still will not be attached — that's
//     a browser-level limit, not something this scanner can work around.
(function () {
  "use strict";

  /* =========================
     Theme (mirrors popup.js's Light/Dark/System switch)
     ========================= */

  function applyThemeMode(mode) {
    document.documentElement.setAttribute("data-theme", mode === "light" || mode === "dark" ? mode : "system");
  }

  try {
    chrome.storage.sync.get(["themeMode"], function (result) {
      applyThemeMode(result && result.themeMode);
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "sync" && changes.themeMode) applyThemeMode(changes.themeMode.newValue);
    });
  } catch (e) { /* storage unavailable — falls back to prefers-color-scheme */ }

  /* =========================
     Scan URL validation
     ========================= */

  function isScannableUrl(url) {
    try {
      var u = new URL(url);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch (e) {
      return false;
    }
  }

  /* =========================
     Configuration
     ========================= */

  var DEFAULT_MAX_PAGES = 500;
  var HARD_MAX_PAGES = 5000;
  var CRAWL_DELAY_MS = 120;
  var IMAGE_TIMEOUT_MS = 12000;
  var SPELL_CONTEXT_CHARS = 48;
  var SPELL_DATA_CONTEXT_CHARS = 120;
  var SPELL_YIELD_EVERY_WORDS = 200;
  var SPELL_DEFAULT_MAX_FINDINGS = 300;
  var WORD_DEFAULT_MAX_FINDINGS = 500;
  var CONSOLE_DEFAULT_MAX_FINDINGS = 300;
  var CONSOLE_SCAN_DEFAULT_MAX_PAGES = 20;
  var CONSOLE_SCAN_HARD_MAX_PAGES = 300;
  var CONSOLE_SCAN_DEFAULT_SECONDS_PER_PAGE = 10;
  var CONSOLE_SCAN_NAV_TIMEOUT_MS = 20000;
  var TRACKING_PARAMS = {
    cid: true, cmpid: true, gclid: true, fbclid: true, msclkid: true,
    campaign: true, source: true, medium: true, term: true, content: true
  };

  var LINK_CHECK_TIMEOUT_MS = 12000;
  var SITEMAP_MAX_SITEMAPS = 20;
  var SITEMAP_MAX_URLS = HARD_MAX_PAGES;
  var HISTORY_STORAGE_PREFIX = "siteScannerHistory:";

  var htmlPageCache = {};
  var htmlPageCacheCount = 0;

  var lowerState = createScanState("lower");
  var imageState = createScanState("image");
  var spellState = createScanState("spell");
  var wordState = createScanState("word");
  var linkState = createScanState("link");
  var mixedState = createScanState("mixed");
  var auditState = createScanState("audit");

  var lowerFindings = [];
  var lowerFindingKeys = {};
  var lowerHistorySet = {};

  var imageFindings = [];
  var imageFindingKeys = {};
  var imageHistorySet = {};
  var checkedImageCache = {};

  var spellFindings = [];
  var spellFindingKeys = {};
  var spellHistorySet = {};

  var wordFindings = [];
  var wordFindingKeys = {};
  var wordHistorySet = {};

  var linkFindings = [];
  var linkFindingKeys = {};
  var linkHistorySet = {};
  var linkStatusCache = {};
  var linkCheckedOnceCache = {};

  var mixedFindings = [];
  var mixedFindingKeys = {};
  var mixedHistorySet = {};

  var auditFindings = [];
  var auditFindingKeys = {};
  var auditHistorySet = {};

  var defaultLowerPatterns = [
    "://qa", "://uat", "://dev", "://test", "://stage", "://staging", "://preview",
    ".qa.", ".qa1.", ".qa2.", ".uat.", ".uat1.", ".uat2.", ".dev.", ".dev1.", ".dev2.",
    ".test.", ".stage.", ".staging.", ".preview.",
    "-qa", "-uat", "-dev", "-test", "-stage", "-staging", "-preview",
    "/qa/", "/qa1/", "/qa2/", "/uat/", "/uat1/", "/uat2/",
    "/dev/", "/dev1/", "/dev2/", "/test/", "/test1/", "/test2/",
    "/stage/", "/stage1/", "/stage2/", "/staging/", "/preview/"
  ];

  var defaultImageIgnorePatterns = ["data:image/", "blob:", "about:blank"];

  var defaultSpellIgnoreWords = [];

  var defaultSpellDictionaryText = "a able about above accept accepted access accident account across act action active add\nadditional address adjust advantage advice after again against age agency agent ago agree ahead\naid air all allow almost along already also alternate always am amazing among\namount an and animal annual another answer any anyone anything app appear application apply\nappointment approved are area around arrive article as ask asked assist assistance associated at\nauto automotive autosave available avoid award away baby back backdated bad bag balance\nbanking base based basic be beach because become been before begin beginning behind being believe\nbenefit benefits best better between big bike bill billing bit blog blogpost blogposts body book\nboth box brand breadcrumb breadcrumbs break bring browser build business but button buy by call\ncalled campaign can cancel car card care career carry case cash cause center certain change\nchat chatbot check checked checker checkup child children choose city claim class clean clear click\nclickable close club code color come common company complete condition config connect contact\ncontent continue control copy cost could country course cover coverage crawl crawled create credit\ncrew css csv current customer customers damage dashboard data dataset datasets date day days deal\ndefault delivery description detail did different discount discounts do doc docs document\ndoes dog done door down download drive driver driving dropdown during each early easy edit education\neffect efficient effort either email emergency employee employer end engine enjoy enough enroll\nenrollment enter entire env environment error even event every everything example excellent except\nexchange expect experience expert explain export extra eye family faq faqs far fast favorite feature\nfee few field file filename filenames final find fintech first fix flag flow focus follow following\nfooter for form found free from front full future garage gas general get gift give go good great\ngroup guid guide had half hand handle happen hard has have he head health help helpful here high\nhome homepage host hotel hour hours how however href html icon idea if iframe image images img\nimportant improve in include included including income increase index information insurance insure\ninterest into issue it item its javascript job jpeg jpg json just keep key kind know knowledgecenter\nknown label language large last late later law learn least leave left less let level license life\nlight like limit line link links list live load local localhost location log login logout long look\nlower made mail make manage many map market may maybe me mean medical membership menu message meta\nmetadata microcopy middleware mile miles missing mobile money month monthly more most move much must\nmy name nav navbar near need needs never new next no none not note now number offer office often og\non once online only open option order other our out over own page pages paid panel park part parts\npass pattern payment pdf people perfect personal phone plan please plus png point policy popup\npossible post power prefer preflight prepaid preview price primary problem process prod product\nproduction products program project protect provide public qa quality query question quick quote\nrate razor ready real reason recaptcha receive record redirect reference refund regex regexp\nregister related renewal repair report request require required resize resource responsive result\nreturn right road role route row run runtime safe safety same save scan scanned scanner\nschool search second section see select selected seo service services set several share should show\nsignup simple since site sitemap small snow so some someone source special speed spell spelling src\nsrcset staging start starter state stay still stop store street strong submenu submit success\nsupport sure svg system tab table take tax team test text textarea than that the their them\nthen there these they thing things think this through ticket time title to today tool tools tooltip\ntop total tour tow towing travel trip truck true try turn type unable under update url urls use used\nuser username using value vehicle vehicles view visit want warranty was way we web webinar webp\nwebsite week well were what when where whether which while who why will with within without word\nwords work working works would year years yes you your zero zip zipcode zone";

  var commonMisspellings = {
    "accomodate": "accommodate", "accomodation": "accommodation", "acheive": "achieve",
    "acutally": "actually", "adress": "address", "agressive": "aggressive", "alot": "a lot",
    "aparent": "apparent", "apparant": "apparent", "arguement": "argument", "assitance": "assistance",
    "assitant": "assistant", "automibile": "automobile", "availible": "available", "bankng": "banking",
    "becuase": "because", "begining": "beginning", "beleive": "believe", "benifit": "benefit",
    "benifits": "benefits", "buisness": "business", "calender": "calendar", "cancelation": "cancellation",
    "cemetary": "cemetery", "changable": "changeable", "cheif": "chief", "comittee": "committee",
    "comming": "coming", "commited": "committed", "comparision": "comparison", "concious": "conscious",
    "connecton": "connection", "contians": "contains", "creat": "create", "definate": "definite",
    "definately": "definitely", "dependant": "dependent", "descripton": "description",
    "developement": "development", "diffrent": "different", "disapoint": "disappoint",
    "discountes": "discounts", "documenation": "documentation", "documentaion": "documentation",
    "eligable": "eligible", "embarass": "embarrass", "enviornment": "environment",
    "enviroment": "environment", "enviromental": "environmental", "existance": "existence",
    "experiance": "experience", "familar": "familiar", "finaly": "finally", "foriegn": "foreign",
    "fourty": "forty", "freind": "friend", "freindly": "friendly", "goverment": "government",
    "guage": "gauge", "happend": "happened", "harrass": "harass", "heigth": "height",
    "helpfull": "helpful", "immediatly": "immediately", "independant": "independent",
    "infomation": "information", "insurace": "insurance", "insurence": "insurance",
    "intrest": "interest", "knowlege": "knowledge", "lenght": "length", "liason": "liaison",
    "libary": "library", "maintainance": "maintenance", "managment": "management",
    "memeber": "member", "memeberhsip": "membership", "memebership": "membership",
    "memebrship": "membership", "memership": "membership", "mispell": "misspell",
    "mispelled": "misspelled", "mispelling": "misspelling", "neccessary": "necessary",
    "necesary": "necessary", "occured": "occurred", "occurence": "occurrence",
    "occurrance": "occurrence", "oppertunity": "opportunity", "optomize": "optimize",
    "paymet": "payment", "peice": "piece", "persue": "pursue", "priviledge": "privilege",
    "proccess": "process", "promlem": "problem", "publically": "publicly",
    "reccommended": "recommended", "recieve": "receive", "recieved": "received",
    "recieving": "receiving", "recomend": "recommend", "recomendation": "recommendation",
    "recommeded": "recommended", "refered": "referred", "refering": "referring",
    "remeber": "remember", "resouce": "resource", "responsibile": "responsible",
    "seperate": "separate", "succesful": "successful", "sucess": "success", "sucessful": "successful",
    "teh": "the", "templete": "template", "thier": "their", "tommorow": "tomorrow",
    "transfered": "transferred", "travell": "travel", "travle": "travel", "truely": "truly",
    "untill": "until", "useage": "usage", "vehical": "vehicle", "vehicals": "vehicles",
    "wierd": "weird", "withold": "withhold", "writting": "writing", "youre": "you are"
  };

  /* =========================
     Shared helpers
     ========================= */

  function byId(id) {
    return document.getElementById(id);
  }

  function createScanState(name) {
    return {
      name: name, running: false, stop: false, status: "Ready",
      startedAt: null, endedAt: null, maxPages: DEFAULT_MAX_PAGES,
      pagesScanned: 0, queued: 0, checked: 0, findings: 0, newCount: 0,
      skipped: 0, redirected: 0, errors: 0, findingLimitHit: false
    };
  }

  function resetScanState(state, maxPages) {
    state.running = true;
    state.stop = false;
    state.status = "Running";
    state.startedAt = new Date();
    state.endedAt = null;
    state.maxPages = maxPages;
    state.pagesScanned = 0;
    state.queued = 0;
    state.checked = 0;
    state.findings = 0;
    state.newCount = 0;
    state.skipped = 0;
    state.redirected = 0;
    state.errors = 0;
    state.findingLimitHit = false;
  }

  function finishScanState(state, status) {
    state.running = false;
    state.stop = false;
    state.status = status;
    state.endedAt = new Date();
  }

  function getDurationText(state) {
    if (!state.startedAt) return "0s";

    var end = state.endedAt || new Date();
    var ms = Math.max(0, end.getTime() - state.startedAt.getTime());
    var seconds = Math.floor(ms / 1000);
    var minutes = Math.floor(seconds / 60);
    var remainingSeconds = seconds % 60;

    if (minutes > 0) return minutes + "m " + remainingSeconds + "s";
    return seconds + "s";
  }

  function setText(id, value) {
    var el = byId(id);
    if (el) el.textContent = String(value);
  }

  function updateGlobalSummary() {
    var runningCount = 0;
    if (lowerState.running) runningCount++;
    if (imageState.running) runningCount++;
    if (spellState.running) runningCount++;
    if (wordState.running) runningCount++;
    if (linkState.running) runningCount++;
    if (mixedState.running) runningCount++;
    if (auditState.running) runningCount++;
    if (consoleState.running) runningCount++;

    setText("globalStatus", runningCount ? runningCount + " scan(s) running" : "Ready");
    setText("globalCacheCount", htmlPageCacheCount);
  }

  function updateLowerSummary() {
    setText("lowerSumStatus", lowerState.status);
    setText("lowerSumDuration", getDurationText(lowerState));
    setText("lowerSumPages", lowerState.pagesScanned + " / " + lowerState.maxPages);
    setText("lowerSumQueued", lowerState.queued);
    setText("lowerSumChecked", lowerState.checked);
    setText("lowerSumFindings", lowerState.findings);
    setText("lowerSumNew", lowerState.newCount);
    setText("lowerSumSkipped", lowerState.skipped);
    setText("lowerSumErrors", lowerState.errors);
    updateGlobalSummary();
  }

  function updateImageSummary() {
    setText("imageSumStatus", imageState.status);
    setText("imageSumDuration", getDurationText(imageState));
    setText("imageSumPages", imageState.pagesScanned + " / " + imageState.maxPages);
    setText("imageSumQueued", imageState.queued);
    setText("imageSumChecked", imageState.checked);
    setText("imageSumFindings", imageState.findings);
    setText("imageSumRedirected", imageState.redirected || 0);
    setText("imageSumNew", imageState.newCount);
    setText("imageSumSkipped", imageState.skipped);
    setText("imageSumErrors", imageState.errors);
    updateGlobalSummary();
  }

  function updateSpellSummary() {
    setText("spellSumStatus", spellState.status);
    setText("spellSumDuration", getDurationText(spellState));
    setText("spellSumPages", spellState.pagesScanned + " / " + spellState.maxPages);
    setText("spellSumQueued", spellState.queued);
    setText("spellSumChecked", spellState.checked);
    setText("spellSumFindings", spellState.findings);
    setText("spellSumNew", spellState.newCount);
    setText("spellSumSkipped", spellState.skipped);
    setText("spellSumErrors", spellState.errors);
    updateGlobalSummary();
  }

  function updateWordSummary() {
    setText("wordSumStatus", wordState.status);
    setText("wordSumDuration", getDurationText(wordState));
    setText("wordSumPages", wordState.pagesScanned + " / " + wordState.maxPages);
    setText("wordSumQueued", wordState.queued);
    setText("wordSumChecked", wordState.checked);
    setText("wordSumFindings", wordState.findings);
    setText("wordSumNew", wordState.newCount);
    setText("wordSumSkipped", wordState.skipped);
    setText("wordSumErrors", wordState.errors);
    updateGlobalSummary();
  }

  function updateLinkSummary() {
    setText("linkSumStatus", linkState.status);
    setText("linkSumDuration", getDurationText(linkState));
    setText("linkSumPages", linkState.pagesScanned + " / " + linkState.maxPages);
    setText("linkSumQueued", linkState.queued);
    setText("linkSumChecked", linkState.checked);
    setText("linkSumFindings", linkState.findings);
    setText("linkSumNew", linkState.newCount);
    setText("linkSumSkipped", linkState.skipped);
    setText("linkSumErrors", linkState.errors);
    updateGlobalSummary();
  }

  function updateMixedSummary() {
    setText("mixedSumStatus", mixedState.status);
    setText("mixedSumDuration", getDurationText(mixedState));
    setText("mixedSumPages", mixedState.pagesScanned + " / " + mixedState.maxPages);
    setText("mixedSumQueued", mixedState.queued);
    setText("mixedSumChecked", mixedState.checked);
    setText("mixedSumFindings", mixedState.findings);
    setText("mixedSumNew", mixedState.newCount);
    setText("mixedSumSkipped", mixedState.skipped);
    setText("mixedSumErrors", mixedState.errors);
    updateGlobalSummary();
  }

  function updateAuditSummary() {
    setText("auditSumStatus", auditState.status);
    setText("auditSumDuration", getDurationText(auditState));
    setText("auditSumPages", auditState.pagesScanned + " / " + auditState.maxPages);
    setText("auditSumQueued", auditState.queued);
    setText("auditSumChecked", auditState.checked);
    setText("auditSumFindings", auditState.findings);
    setText("auditSumNew", auditState.newCount);
    setText("auditSumSkipped", auditState.skipped);
    setText("auditSumErrors", auditState.errors);
    updateGlobalSummary();
  }

  function tickSummaries() {
    if (lowerState.running) updateLowerSummary();
    if (imageState.running) updateImageSummary();
    if (spellState.running) updateSpellSummary();
    if (wordState.running) updateWordSummary();
    if (linkState.running) updateLinkSummary();
    if (mixedState.running) updateMixedSummary();
    if (auditState.running) updateAuditSummary();
  }

  setInterval(tickSummaries, 1000);

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function getMaxPages() {
    var input = byId("maxPages");
    var value = parseInt(input.value, 10);

    if (isNaN(value) || value < 1) value = DEFAULT_MAX_PAGES;
    if (value > HARD_MAX_PAGES) value = HARD_MAX_PAGES;

    input.value = String(value);
    return value;
  }

  function normalize(url, base) {
    try {
      if (!url) return null;

      var raw = String(url).trim();
      if (!raw) return null;

      var normalized = new URL(raw, base);

      if (
        normalized.protocol === "mailto:" ||
        normalized.protocol === "tel:" ||
        normalized.protocol === "javascript:"
      ) {
        return null;
      }

      normalized.hash = "";
      return normalized.href;
    } catch (e) {
      return null;
    }
  }

  // Canonical page identity used to key crawl visited/queued sets and finding
  // dedup across every scanner: strips the hash and known tracking params
  // (utm_* plus TRACKING_PARAMS) so query-param variants of the same page
  // (e.g. ?utm_source=...) collapse into one page instead of being re-crawled
  // and reported as separate findings. Params that aren't known tracking
  // noise (e.g. ?id=123) are left alone, since they can point at genuinely
  // different content.
  function canonicalizePageUrl(pageUrl) {
    try {
      var url = new URL(pageUrl);
      url.hash = "";

      Array.prototype.slice.call(url.searchParams.keys()).forEach(function (key) {
        var lowerKey = key.toLowerCase();
        if (lowerKey.indexOf("utm_") === 0 || TRACKING_PARAMS[lowerKey]) {
          url.searchParams.delete(key);
        }
      });

      return url.href;
    } catch (e) {
      return pageUrl;
    }
  }

  function isSameOrigin(url, origin) {
    try {
      return new URL(url).origin === origin;
    } catch (e) {
      return false;
    }
  }

  function isLikelyHtmlPage(url) {
    var lower = url.toLowerCase();

    return !(
      lower.indexOf(".pdf") > -1 || lower.indexOf(".jpg") > -1 || lower.indexOf(".jpeg") > -1 ||
      lower.indexOf(".png") > -1 || lower.indexOf(".gif") > -1 || lower.indexOf(".webp") > -1 ||
      lower.indexOf(".svg") > -1 || lower.indexOf(".zip") > -1 || lower.indexOf(".doc") > -1 ||
      lower.indexOf(".docx") > -1 || lower.indexOf(".xls") > -1 || lower.indexOf(".xlsx") > -1 ||
      lower.indexOf(".mp4") > -1 || lower.indexOf(".mp3") > -1
    );
  }

  function csvEscape(value) {
    return '"' + String(value || "").replace(/"/g, '""') + '"';
  }

  function downloadCsv(filename, header, rows) {
    var csv = header.join(",") + "\n";

    rows.forEach(function (row) {
      csv += row.map(csvEscape).join(",") + "\n";
    });

    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);

    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  var TAB_PANEL_ID_OVERRIDES = { links: "link" };

  function setActiveTab(tabName) {
    ["lower", "links", "images", "mixed", "spell", "audit", "word", "console"].forEach(function (name) {
      var btnId = "tab" + name.charAt(0).toUpperCase() + name.slice(1) + "Btn";
      var panelId = (TAB_PANEL_ID_OVERRIDES[name] || name) + "Panel";
      var active = name === tabName;

      var btn = byId(btnId);
      if (btn) btn.className = active ? "tab-btn active" : "tab-btn";

      var panel = byId(panelId);
      if (panel) panel.className = active ? "tab-panel active" : "tab-panel";
    });
  }

  function logTo(el, msg) {
    el.textContent += msg + "\n";
    el.scrollTop = el.scrollHeight;
  }

  function makeNewBadge() {
    var badge = document.createElement("span");
    badge.className = "new-badge";
    badge.textContent = "NEW";
    return badge;
  }

  function setAllStartUrls(url) {
    byId("lowerStart").value = url;
    byId("imageStart").value = url;
    byId("spellStart").value = url;
    byId("wordStart").value = url;
    byId("linkStart").value = url;
    byId("mixedStart").value = url;
    byId("auditStart").value = url;
  }

  function getInitialStartUrl() {
    try {
      var requested = new URLSearchParams(window.location.search).get("start");
      if (requested && isScannableUrl(requested)) return requested;
    } catch (e) { /* fall through to blank default */ }

    return "";
  }

  function getInitialTabId() {
    try {
      var requested = new URLSearchParams(window.location.search).get("tabId");
      if (requested && /^\d+$/.test(requested)) return Number(requested);
    } catch (e) { /* fall through to no default */ }

    return null;
  }

  /* =========================
     Scan history (per origin, per scan type)
     ========================= */

  function historyStorageKey(scanType, origin) {
    return HISTORY_STORAGE_PREFIX + scanType + ":" + origin;
  }

  function loadHistoryKeys(scanType, origin) {
    return new Promise(function (resolve) {
      try {
        var storageKey = historyStorageKey(scanType, origin);
        chrome.storage.local.get([storageKey], function (result) {
          var raw = result && result[storageKey];
          resolve(raw && raw.keys ? raw.keys : []);
        });
      } catch (e) {
        resolve([]);
      }
    });
  }

  function saveHistoryKeys(scanType, origin, keys) {
    try {
      var payload = {};
      payload[historyStorageKey(scanType, origin)] = { keys: keys, savedAt: new Date().toISOString() };
      chrome.storage.local.set(payload);
    } catch (e) { /* ignore storage errors */ }
  }

  function arrayToKeySet(arr) {
    var set = {};
    (arr || []).forEach(function (k) { set[k] = true; });
    return set;
  }

  function isFinalScanStatus(status) {
    return status === "Complete" || status === "Finding limit hit";
  }

  function getOriginFromStartField(fieldId) {
    try {
      var value = byId(fieldId).value.trim();
      if (!value) return null;
      var url = new URL(value);
      return isScannableUrl(url.href) ? url.origin : null;
    } catch (e) {
      return null;
    }
  }

  /* =========================
     Sitemap.xml seeding
     ========================= */

  function fetchXmlDocument(url) {
    if (!isScannableUrl(url)) return Promise.resolve(null);

    return fetch(url, { credentials: "include" }).then(function (res) {
      if (!res.ok) return null;
      return res.text().then(function (text) {
        try {
          var doc = new DOMParser().parseFromString(text, "application/xml");
          if (doc.querySelector("parsererror")) return null;
          return doc;
        } catch (e) {
          return null;
        }
      });
    }).catch(function () {
      return null;
    });
  }

  async function fetchSitemapSameOriginUrls(origin) {
    var found = {};
    var sitemapsToVisit = [origin.replace(/\/$/, "") + "/sitemap.xml"];
    var visitedSitemaps = {};
    var pageUrls = [];

    while (sitemapsToVisit.length && Object.keys(visitedSitemaps).length < SITEMAP_MAX_SITEMAPS) {
      var sitemapUrl = sitemapsToVisit.shift();
      if (!sitemapUrl || visitedSitemaps[sitemapUrl]) continue;
      visitedSitemaps[sitemapUrl] = true;

      var doc = await fetchXmlDocument(sitemapUrl);
      if (!doc) continue;

      var isIndex = !!doc.querySelector("sitemapindex");
      var locs = Array.prototype.slice.call(doc.querySelectorAll("loc")).map(function (el) {
        return normalize(el.textContent, sitemapUrl);
      }).filter(Boolean);

      if (isIndex) {
        locs.forEach(function (loc) {
          if (isSameOrigin(loc, origin) && !visitedSitemaps[loc]) sitemapsToVisit.push(loc);
        });
      } else {
        locs.forEach(function (loc) {
          if (isSameOrigin(loc, origin) && isLikelyHtmlPage(loc) && !found[loc]) {
            found[loc] = true;
            pageUrls.push(loc);
          }
        });
      }

      if (pageUrls.length >= SITEMAP_MAX_URLS) break;
    }

    return pageUrls.slice(0, SITEMAP_MAX_URLS);
  }

  /*
    fetchHtmlPage
    -------------
    The single choke point every scanner routes through. Every URL is
    checked for an http(s) protocol here, in addition to whatever filtering
    happens upstream (start URL validation, same-origin crawl filters).
    credentials:"include" is used instead of "same-origin" because this page
    is chrome-extension://..., so any request to another site is cross-site;
    SameSite=Lax/Strict cookies on the target still won't be attached, which
    is a browser policy this scanner cannot and should not try to bypass.
  */
  function fetchHtmlPage(url) {
    if (htmlPageCache[url]) return htmlPageCache[url];

    if (!isScannableUrl(url)) {
      htmlPageCache[url] = Promise.resolve({
        ok: false, status: 0, contentType: "", text: "",
        reason: "Blocked: only http/https URLs can be scanned",
        requestedUrl: url, finalUrl: url, redirected: false
      });
      return htmlPageCache[url];
    }

    htmlPageCacheCount++;
    updateGlobalSummary();

    htmlPageCache[url] = fetch(url, { credentials: "include" }).then(function (res) {
      var contentType = res.headers.get("content-type") || "";
      var finalUrl = normalize(res.url || url, url) || url;
      var redirected = !!(res.redirected || finalUrl !== url);

      if (finalUrl !== url && !isScannableUrl(finalUrl)) {
        return {
          ok: false, status: res.status, contentType: contentType, text: "",
          reason: "Blocked: redirected to a non-http(s) URL",
          requestedUrl: url, finalUrl: finalUrl, redirected: true
        };
      }

      if (!res.ok) {
        return {
          ok: false, status: res.status, contentType: contentType, text: "",
          reason: "HTTP " + res.status, requestedUrl: url, finalUrl: finalUrl, redirected: redirected
        };
      }

      if (contentType.indexOf("text/html") === -1) {
        return {
          ok: false, status: res.status, contentType: contentType, text: "",
          reason: "Non-html content", requestedUrl: url, finalUrl: finalUrl, redirected: redirected
        };
      }

      return res.text().then(function (text) {
        return {
          ok: true, status: res.status, contentType: contentType, text: text,
          reason: redirected ? "Redirected" : "OK",
          requestedUrl: url, finalUrl: finalUrl, redirected: redirected
        };
      });
    }).catch(function (e) {
      return {
        ok: false, status: 0, contentType: "", text: "",
        reason: e && e.message ? e.message : "Fetch error",
        requestedUrl: url, finalUrl: url, redirected: false
      };
    });

    return htmlPageCache[url];
  }

  function extractPageLinks(doc, pageUrl) {
    return Array.prototype.slice.call(doc.querySelectorAll("a[href]"))
      .map(function (a) { return normalize(a.getAttribute("href"), pageUrl); })
      .filter(Boolean);
  }

  /* =========================
     Lower Environment Link Scan
     ========================= */

  function getUrlPartsForLowerEnvMatch(link) {
    try {
      var parsed = new URL(link);
      return {
        href: parsed.href.toLowerCase(),
        hostname: parsed.hostname.toLowerCase(),
        pathname: parsed.pathname.toLowerCase(),
        origin: parsed.origin.toLowerCase()
      };
    } catch (e) {
      return { href: String(link || "").toLowerCase(), hostname: "", pathname: "", origin: "" };
    }
  }

  function isHostOnlyLowerEnvPattern(pattern) {
    var value = String(pattern || "").toLowerCase();
    return (
      /^:\/\/(qa|uat|dev|test|stage|staging|preview)\d*$/.test(value) ||
      /^\.(qa|uat|dev|test|stage|staging|preview)\d*\.$/.test(value) ||
      /^-(qa|uat|dev|test|stage|staging|preview)\d*$/.test(value)
    );
  }

  function lowerEnvPatternMatches(link, pattern) {
    var parts = getUrlPartsForLowerEnvMatch(link);
    var p = String(pattern || "").trim().toLowerCase();

    if (!p) return false;

    if (isHostOnlyLowerEnvPattern(p)) {
      if (p.indexOf("://") === 0) {
        return parts.hostname.indexOf(p.replace("://", "")) === 0;
      }
      return parts.hostname.indexOf(p) > -1;
    }

    if (p.charAt(0) === "/" && p.charAt(p.length - 1) === "/") {
      return parts.pathname.indexOf(p) > -1;
    }

    return parts.href.indexOf(p) > -1;
  }

  function findMatchingPattern(link, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var pattern = String(patterns[i] || "").trim();
      if (!pattern) continue;
      if (lowerEnvPatternMatches(link, pattern)) return pattern;
    }
    return null;
  }

  function addLowerResult(link, page, pattern) {
    var canonicalPage = canonicalizePageUrl(page);
    var key = link + "|" + canonicalPage + "|" + pattern;
    if (lowerFindingKeys[key]) return;
    lowerFindingKeys[key] = true;

    var isNew = !lowerHistorySet[key];
    if (isNew) lowerState.newCount++;

    lowerFindings.push({ link: link, page: page, canonicalPage: canonicalPage, pattern: pattern });
    lowerState.findings = lowerFindings.length;
    updateLowerSummary();

    var resultsEl = byId("lowerResults");
    if (resultsEl.querySelector(".empty")) resultsEl.innerHTML = "";

    var row = document.createElement("div");
    row.className = "result";

    var linkEl = document.createElement("div");
    linkEl.className = "bad";
    linkEl.textContent = link;
    if (isNew) linkEl.appendChild(makeNewBadge());

    var matchEl = document.createElement("div");
    matchEl.className = "meta";
    matchEl.textContent = "matched: " + pattern;

    var pageEl = document.createElement("div");
    pageEl.className = "page";
    pageEl.textContent = "on: " + page;

    row.appendChild(linkEl);
    row.appendChild(matchEl);
    row.appendChild(pageEl);
    resultsEl.appendChild(row);
  }

  async function runLowerEnvironmentScan() {
    if (lowerState.running) { alert("The lower environment link scan is already running."); return; }

    var startEl = byId("lowerStart");
    var patternsEl = byId("lowerPatterns");
    var statusEl = byId("lowerStatus");
    var resultsEl = byId("lowerResults");
    var logEl = byId("lowerLog");

    var start = startEl.value.trim();
    var patterns = patternsEl.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);

    if (!start || !patterns.length) { alert("Enter a start URL and at least one lower environment pattern."); return; }

    var startUrl;
    try { startUrl = new URL(start); } catch (e) { alert("Invalid start URL."); return; }

    if (!isScannableUrl(startUrl.href)) {
      alert("Start URL must start with http:// or https://.");
      return;
    }

    lowerFindings = [];
    lowerFindingKeys = {};
    logEl.textContent = "";
    resultsEl.innerHTML = "<div class='empty'>No results yet.</div>";

    var maxPages = getMaxPages();
    resetScanState(lowerState, maxPages);
    updateLowerSummary();

    try {
      var origin = startUrl.origin;
      lowerHistorySet = arrayToKeySet(await loadHistoryKeys("lower", origin));

      var firstUrl = normalize(startUrl.href, startUrl.href);
      var queue = [firstUrl];
      var visited = {};
      var queued = {};
      queued[canonicalizePageUrl(firstUrl)] = true;

      logTo(logEl, "Starting lower environment link scan...");
      logTo(logEl, "Crawling origin only: " + origin);
      logTo(logEl, "Max pages: " + maxPages);

      if (byId("seedFromSitemap").checked) {
        logTo(logEl, "Fetching sitemap.xml for " + origin + "...");
        var lowerSitemapUrls = await fetchSitemapSameOriginUrls(origin);
        var lowerSitemapAdded = 0;
        lowerSitemapUrls.forEach(function (u) {
          var uKey = canonicalizePageUrl(u);
          if (!queued[uKey] && !visited[uKey]) { queue.push(u); queued[uKey] = true; lowerSitemapAdded++; }
        });
        logTo(logEl, "Sitemap seeded " + lowerSitemapAdded + " URL(s) into the queue.");
      }

      while (queue.length && !lowerState.stop) {
        var url = queue.shift();
        var lowerUrlKey = canonicalizePageUrl(url);
        if (!url || visited[lowerUrlKey]) continue;

        visited[lowerUrlKey] = true;
        lowerState.pagesScanned = Object.keys(visited).length;
        lowerState.queued = queue.length;

        statusEl.textContent = "Scanning " + lowerState.pagesScanned + " of max " + maxPages +
          " | queued " + queue.length + " | matches " + lowerFindings.length;
        updateLowerSummary();
        logTo(logEl, "Scanning: " + url);

        var page = await fetchHtmlPage(url);

        if (!page.ok) {
          lowerState.skipped++;
          if (page.status === 0 || page.reason.indexOf("HTTP") === 0) lowerState.errors++;
          logTo(logEl, "SKIP " + page.reason + ": " + url);
          updateLowerSummary();
        } else {
          var doc = new DOMParser().parseFromString(page.text, "text/html");
          var links = extractPageLinks(doc, url);
          lowerState.checked += links.length;

          links.forEach(function (link) {
            var matchedPattern = findMatchingPattern(link, patterns);
            if (matchedPattern) {
              logTo(logEl, "FOUND: " + link);
              addLowerResult(link, url, matchedPattern);
            }
          });

          links.forEach(function (link) {
            var lowerLinkKey = canonicalizePageUrl(link);
            if (isSameOrigin(link, origin) && isScannableUrl(link) && isLikelyHtmlPage(link) && !visited[lowerLinkKey] && !queued[lowerLinkKey]) {
              queue.push(link);
              queued[lowerLinkKey] = true;
            }
          });

          lowerState.queued = queue.length;
          updateLowerSummary();
        }

        if (Object.keys(visited).length >= maxPages) {
          logTo(logEl, "Stopped at max page limit: " + maxPages);
          break;
        }

        await sleep(CRAWL_DELAY_MS);
      }

      finishScanState(lowerState, lowerState.stop ? "Stopped" : "Complete");
      statusEl.textContent = lowerState.status === "Stopped" ? "Stopped" : "Scan complete";
      logTo(logEl, "Done. Matches: " + lowerFindings.length + " (" + lowerState.newCount + " new since last run)");
      if (isFinalScanStatus(lowerState.status)) saveHistoryKeys("lower", origin, Object.keys(lowerFindingKeys));
      updateLowerSummary();
    } catch (e) {
      lowerState.errors++;
      finishScanState(lowerState, "Error");
      statusEl.textContent = "Error";
      logTo(logEl, "FATAL ERROR: " + (e && e.message ? e.message : e));
      updateLowerSummary();
    }
  }

  /* =========================
     Missing Image Scan
     ========================= */

  function shouldIgnoreImage(url, ignorePatterns) {
    var lowerUrl = String(url || "").toLowerCase();

    for (var i = 0; i < ignorePatterns.length; i++) {
      var pattern = String(ignorePatterns[i] || "").trim().toLowerCase();
      if (!pattern) continue;
      if (lowerUrl.indexOf(pattern) > -1) return true;
    }
    return false;
  }

  function parseSrcset(srcset, base) {
    var urls = [];
    if (!srcset) return urls;

    srcset.split(",").forEach(function (part) {
      var trimmed = part.trim();
      if (!trimmed) return;

      var urlPart = trimmed.split(/\s+/)[0];
      var normalized = normalize(urlPart, base);
      if (normalized) urls.push(normalized);
    });

    return urls;
  }

  function extractCssUrls(styleValue, base) {
    var urls = [];
    var re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
    var match;

    while ((match = re.exec(styleValue || "")) !== null) {
      var normalized = normalize(match[2], base);
      if (normalized) urls.push(normalized);
    }

    return urls;
  }

  function addImageCandidateFromRaw(candidates, rawValue, pageUrl, source) {
    if (rawValue === null || typeof rawValue === "undefined") return;

    var raw = String(rawValue).trim();

    if (!raw) {
      candidates.push({ imageUrl: "", pageUrl: pageUrl, source: source, immediateProblem: "Empty image URL" });
      return;
    }

    var normalized = normalize(raw, pageUrl);

    if (!normalized) {
      candidates.push({ imageUrl: raw, pageUrl: pageUrl, source: source, immediateProblem: "Invalid image URL" });
      return;
    }

    candidates.push({ imageUrl: normalized, pageUrl: pageUrl, source: source, immediateProblem: null });
  }

  function addImageCandidate(candidates, imageUrl, pageUrl, source) {
    if (!imageUrl) {
      candidates.push({ imageUrl: "", pageUrl: pageUrl, source: source, immediateProblem: "Empty image URL" });
      return;
    }
    candidates.push({ imageUrl: imageUrl, pageUrl: pageUrl, source: source, immediateProblem: null });
  }

  function collectImageCandidates(doc, pageUrl, options) {
    var candidates = [];

    Array.prototype.slice.call(doc.querySelectorAll("img")).forEach(function (img) {
      addImageCandidateFromRaw(candidates, img.getAttribute("src"), pageUrl, "img[src]");

      ["data-src", "data-lazy-src", "data-original", "data-img-src", "data-src-small", "data-src-medium", "data-src-large"].forEach(function (attr) {
        if (img.hasAttribute(attr)) {
          addImageCandidateFromRaw(candidates, img.getAttribute(attr), pageUrl, "img[" + attr + "]");
        }
      });

      var srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset");
      parseSrcset(srcset, pageUrl).forEach(function (srcsetUrl) {
        addImageCandidate(candidates, srcsetUrl, pageUrl, "img[srcset]");
      });
    });

    Array.prototype.slice.call(doc.querySelectorAll("source[srcset]")).forEach(function (source) {
      parseSrcset(source.getAttribute("srcset"), pageUrl).forEach(function (srcsetUrl) {
        addImageCandidate(candidates, srcsetUrl, pageUrl, "source[srcset]");
      });
    });

    if (options.includeMetaImages) {
      Array.prototype.slice.call(doc.querySelectorAll(
        "meta[property='og:image'],meta[name='twitter:image'],meta[name='twitter:image:src']"
      )).forEach(function (meta) {
        addImageCandidateFromRaw(candidates, meta.getAttribute("content"), pageUrl, "meta image");
      });

      Array.prototype.slice.call(doc.querySelectorAll(
        "link[rel~='icon'],link[rel='shortcut icon'],link[rel='apple-touch-icon'],link[rel='preload'][as='image']"
      )).forEach(function (link) {
        addImageCandidateFromRaw(candidates, link.getAttribute("href"), pageUrl, "link image");
      });
    }

    if (options.includeCssImages) {
      Array.prototype.slice.call(doc.querySelectorAll("[style]")).forEach(function (el) {
        extractCssUrls(el.getAttribute("style"), pageUrl).forEach(function (cssUrl) {
          addImageCandidate(candidates, cssUrl, pageUrl, "inline style background image");
        });
      });
    }

    return candidates;
  }

  function checkImageLoad(imageUrl) {
    if (checkedImageCache[imageUrl]) return checkedImageCache[imageUrl];

    checkedImageCache[imageUrl] = new Promise(function (resolve) {
      if (!imageUrl) { resolve({ ok: false, reason: "Empty image URL" }); return; }

      var lower = imageUrl.toLowerCase();
      if (lower.indexOf("data:image/") === 0 || lower.indexOf("blob:") === 0) {
        resolve({ ok: true, reason: "Skipped embedded image" });
        return;
      }

      var done = false;
      var img = new Image();

      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        img.onload = null;
        img.onerror = null;
        resolve({ ok: false, reason: "Timed out after " + IMAGE_TIMEOUT_MS + "ms" });
      }, IMAGE_TIMEOUT_MS);

      img.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);

        if (img.naturalWidth === 0 && img.naturalHeight === 0) {
          resolve({ ok: false, reason: "Loaded but reported zero size" });
          return;
        }
        resolve({ ok: true, reason: "Loaded" });
      };

      img.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: "Image failed to load" });
      };

      img.src = imageUrl;
    });

    return checkedImageCache[imageUrl];
  }

  function addImageResult(imageUrl, pageUrl, source, reason) {
    var canonicalPageUrl = canonicalizePageUrl(pageUrl);
    var key = imageUrl + "|" + canonicalPageUrl + "|" + source + "|" + reason;
    if (imageFindingKeys[key]) return;
    imageFindingKeys[key] = true;

    var isNew = !imageHistorySet[key];
    if (isNew) imageState.newCount++;

    imageFindings.push({ imageUrl: imageUrl, pageUrl: pageUrl, canonicalPageUrl: canonicalPageUrl, source: source, reason: reason });
    imageState.findings = imageFindings.length;
    updateImageSummary();

    var resultsEl = byId("imageResults");
    if (resultsEl.querySelector(".empty")) resultsEl.innerHTML = "";

    var row = document.createElement("div");
    row.className = "result";

    var imageEl = document.createElement("div");
    imageEl.className = "bad";
    imageEl.textContent = imageUrl || "(empty image URL)";
    if (isNew) imageEl.appendChild(makeNewBadge());

    var reasonEl = document.createElement("div");
    reasonEl.className = "meta";
    reasonEl.textContent = "reason: " + reason;

    var sourceEl = document.createElement("div");
    sourceEl.className = "source";
    sourceEl.textContent = "source: " + source;

    var pageEl = document.createElement("div");
    pageEl.className = "page";
    pageEl.textContent = "on: " + pageUrl;

    row.appendChild(imageEl);
    row.appendChild(reasonEl);
    row.appendChild(sourceEl);
    row.appendChild(pageEl);
    resultsEl.appendChild(row);
  }

  async function runMissingImageScan() {
    if (imageState.running) { alert("The missing image scan is already running."); return; }

    var startEl = byId("imageStart");
    var ignorePatternsEl = byId("imageIgnorePatterns");
    var statusEl = byId("imageStatus");
    var resultsEl = byId("imageResults");
    var logEl = byId("imageLog");

    var start = startEl.value.trim();
    if (!start) { alert("Enter a start URL."); return; }

    var startUrl;
    try { startUrl = new URL(start); } catch (e) { alert("Invalid start URL."); return; }

    if (!isScannableUrl(startUrl.href)) {
      alert("Start URL must start with http:// or https://.");
      return;
    }

    imageFindings = [];
    imageFindingKeys = {};
    checkedImageCache = {};
    logEl.textContent = "";
    resultsEl.innerHTML = "<div class='empty'>No results yet.</div>";

    var maxPages = getMaxPages();
    resetScanState(imageState, maxPages);
    updateImageSummary();

    try {
      var ignorePatterns = ignorePatternsEl.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);

      var options = {
        includeCssImages: byId("includeCssImages").checked,
        includeMetaImages: byId("includeMetaImages").checked,
        skipRedirectedPages: byId("imageSkipRedirectedPages").checked
      };

      var origin = startUrl.origin;
      imageHistorySet = arrayToKeySet(await loadHistoryKeys("image", origin));

      var firstUrl = normalize(startUrl.href, startUrl.href);
      var queue = [firstUrl];
      var visited = {};
      var queued = {};
      queued[canonicalizePageUrl(firstUrl)] = true;

      logTo(logEl, "Starting missing image scan...");
      logTo(logEl, "Crawling origin only: " + origin);
      logTo(logEl, "Max pages: " + maxPages);

      if (byId("seedFromSitemap").checked) {
        logTo(logEl, "Fetching sitemap.xml for " + origin + "...");
        var imageSitemapUrls = await fetchSitemapSameOriginUrls(origin);
        var imageSitemapAdded = 0;
        imageSitemapUrls.forEach(function (u) {
          var uKey = canonicalizePageUrl(u);
          if (!queued[uKey] && !visited[uKey]) { queue.push(u); queued[uKey] = true; imageSitemapAdded++; }
        });
        logTo(logEl, "Sitemap seeded " + imageSitemapAdded + " URL(s) into the queue.");
      }

      while (queue.length && !imageState.stop) {
        var url = queue.shift();
        var imageUrlKey = canonicalizePageUrl(url);
        if (!url || visited[imageUrlKey]) continue;

        visited[imageUrlKey] = true;
        imageState.pagesScanned = Object.keys(visited).length;
        imageState.queued = queue.length;

        statusEl.textContent = "Scanning page " + imageState.pagesScanned + " of max " + maxPages +
          " | queued " + queue.length + " | checked images " + imageState.checked +
          " | missing " + imageFindings.length;
        updateImageSummary();
        logTo(logEl, "Scanning page: " + url);

        var page = await fetchHtmlPage(url);

        if (!page.ok) {
          imageState.skipped++;
          if (page.status === 0 || page.reason.indexOf("HTTP") === 0) imageState.errors++;
          logTo(logEl, "SKIP " + page.reason + ": " + url);
          updateImageSummary();
        } else {
          var effectivePageUrl = page.finalUrl || url;
          var shouldCheckImagesOnThisPage = true;

          if (page.redirected) {
            imageState.redirected++;
            logTo(logEl, "REDIRECT: " + url + " -> " + effectivePageUrl);

            var effectivePageUrlKey = canonicalizePageUrl(effectivePageUrl);
            if (isSameOrigin(effectivePageUrl, origin) && isScannableUrl(effectivePageUrl) && isLikelyHtmlPage(effectivePageUrl) && !visited[effectivePageUrlKey] && !queued[effectivePageUrlKey]) {
              queue.push(effectivePageUrl);
              queued[effectivePageUrlKey] = true;
              logTo(logEl, "Queued final redirected URL: " + effectivePageUrl);
            }

            if (options.skipRedirectedPages) {
              imageState.skipped++;
              shouldCheckImagesOnThisPage = false;
              logTo(logEl, "SKIP redirected source URL for image checks: " + url);
            }
          }

          if (shouldCheckImagesOnThisPage) {
            var doc = new DOMParser().parseFromString(page.text, "text/html");
            var imageCandidates = collectImageCandidates(doc, effectivePageUrl, options);
            logTo(logEl, "Images found on page: " + imageCandidates.length);

            for (var i = 0; i < imageCandidates.length; i++) {
              if (imageState.stop) break;

              var candidate = imageCandidates[i];

              if (candidate.immediateProblem) {
                addImageResult(candidate.imageUrl, candidate.pageUrl, candidate.source, candidate.immediateProblem);
                continue;
              }

              if (shouldIgnoreImage(candidate.imageUrl, ignorePatterns)) {
                imageState.skipped++;
                updateImageSummary();
                continue;
              }

              imageState.checked++;
              var imageResult = await checkImageLoad(candidate.imageUrl);

              if (!imageResult.ok) {
                logTo(logEl, "MISSING IMAGE: " + candidate.imageUrl + " | " + imageResult.reason);
                addImageResult(candidate.imageUrl, candidate.pageUrl, candidate.source, imageResult.reason);
              }

              statusEl.textContent = "Scanning page " + imageState.pagesScanned + " of max " + maxPages +
                " | queued " + queue.length + " | checked images " + imageState.checked +
                " | missing " + imageFindings.length;
              updateImageSummary();
            }

            var links = extractPageLinks(doc, effectivePageUrl);
            links.forEach(function (link) {
              var imageLinkKey = canonicalizePageUrl(link);
              if (isSameOrigin(link, origin) && isScannableUrl(link) && isLikelyHtmlPage(link) && !visited[imageLinkKey] && !queued[imageLinkKey]) {
                queue.push(link);
                queued[imageLinkKey] = true;
              }
            });
          }

          imageState.queued = queue.length;
          updateImageSummary();
        }

        if (Object.keys(visited).length >= maxPages) {
          logTo(logEl, "Stopped at max page limit: " + maxPages);
          break;
        }

        await sleep(CRAWL_DELAY_MS);
      }

      finishScanState(imageState, imageState.stop ? "Stopped" : "Complete");
      statusEl.textContent = imageState.status === "Stopped" ? "Stopped" : "Scan complete";
      logTo(logEl, "Done. Missing images: " + imageFindings.length + " (" + imageState.newCount + " new since last run)");
      if (isFinalScanStatus(imageState.status)) saveHistoryKeys("image", origin, Object.keys(imageFindingKeys));
      updateImageSummary();
    } catch (e) {
      imageState.errors++;
      finishScanState(imageState, "Error");
      statusEl.textContent = "Error";
      logTo(logEl, "FATAL ERROR: " + (e && e.message ? e.message : e));
      updateImageSummary();
    }
  }

  /* =========================
     Spell Check Scan
     ========================= */

  function splitWordsFromTextarea(text) {
    var words = {};

    String(text || "").split(/\s+/).map(function (x) { return normalizeSpellWord(x); }).filter(Boolean).forEach(function (word) {
      words[word] = true;
    });

    return words;
  }

  function buildSpellDictionary() {
    var words = splitWordsFromTextarea(defaultSpellDictionaryText);
    Object.keys(commonMisspellings).forEach(function (badWord) { delete words[badWord]; });
    return words;
  }

  var spellDictionary = buildSpellDictionary();

  function getSpellMinLength() {
    var input = byId("spellMinLength");
    var value = parseInt(input.value, 10);

    if (isNaN(value) || value < 2) value = 4;
    if (value > 20) value = 20;

    input.value = String(value);
    return value;
  }

  function getSpellMaxFindings() {
    var input = byId("spellMaxFindings");
    var value = parseInt(input.value, 10);

    if (isNaN(value) || value < 25) value = SPELL_DEFAULT_MAX_FINDINGS;
    if (value > 5000) value = 5000;

    input.value = String(value);
    return value;
  }

  function normalizeSpellWord(word) {
    var value = String(word || "")
      .replace(/[’]/g, "'")
      .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")
      .toLowerCase();

    if (!value) return "";

    value = value.replace(/'s$/i, "").replace(/'/g, "");
    return value;
  }

  function isProbablyNotHumanWord(rawWord, normalizedWord) {
    if (!rawWord || !normalizedWord) return true;
    if (/\d/.test(rawWord)) return true;
    if (rawWord.indexOf("_") > -1) return true;
    if (rawWord.indexOf("/") > -1 || rawWord.indexOf("\\") > -1) return true;
    if (/^[A-Z]{2,}$/.test(rawWord.replace(/[^A-Za-z]/g, ""))) return true;
    if (/^[a-z]+[A-Z][A-Za-z]*$/.test(rawWord)) return true;
    if (/^[A-Za-z]+[0-9A-Za-z]*$/.test(rawWord) && /[0-9]/.test(rawWord)) return true;
    if (normalizedWord.length > 28) return true;
    return false;
  }

  var acceptedContractions = {
    "arent": true, "cant": true, "couldnt": true, "didnt": true, "doesnt": true, "dont": true,
    "hadnt": true, "hasnt": true, "havent": true, "hed": true, "hell": true, "hes": true,
    "heres": true, "howd": true, "howll": true, "hows": true, "id": true, "ill": true, "im": true,
    "ive": true, "isnt": true, "itd": true, "itll": true, "its": true, "lets": true,
    "shouldnt": true, "thats": true, "theyd": true, "theyll": true, "theyre": true, "theyve": true,
    "wasnt": true, "wed": true, "well": true, "were": true, "weve": true, "werent": true,
    "whatll": true, "whats": true, "wheres": true, "whos": true, "wont": true, "wouldnt": true,
    "youd": true, "youll": true, "youre": true, "youve": true
  };

  function isAcceptedContraction(rawWord, normalizedWord) {
    if (rawWord.indexOf("'") === -1 && rawWord.indexOf("’") === -1) return false;
    return !!acceptedContractions[normalizedWord];
  }

  function getSpellVariants(word) {
    var variants = [word];

    if (word.length > 4 && /ies$/.test(word)) variants.push(word.slice(0, -3) + "y");
    if (word.length > 4 && /es$/.test(word)) variants.push(word.slice(0, -2));
    if (word.length > 3 && /s$/.test(word)) variants.push(word.slice(0, -1));
    if (word.length > 5 && /ing$/.test(word)) {
      variants.push(word.slice(0, -3));
      variants.push(word.slice(0, -3).replace(/(.)\1$/, "$1"));
      variants.push(word.slice(0, -3) + "e");
    }
    if (word.length > 4 && /ed$/.test(word)) {
      variants.push(word.slice(0, -2));
      variants.push(word.slice(0, -2).replace(/(.)\1$/, "$1"));
      variants.push(word.slice(0, -1));
    }
    if (word.length > 4 && /er$/.test(word)) variants.push(word.slice(0, -2));
    if (word.length > 5 && /est$/.test(word)) variants.push(word.slice(0, -3));
    if (word.length > 5 && /ly$/.test(word)) variants.push(word.slice(0, -2));

    return variants;
  }

  function isKnownSpellWord(word, approvedWords) {
    if (word.indexOf("-") > -1) {
      var parts = word.split("-").filter(Boolean);

      if (parts.length > 1) {
        var allPartsKnown = parts.every(function (part) { return isKnownSpellWord(part, approvedWords); });
        if (allPartsKnown) return true;
      }
    }

    var variants = getSpellVariants(word);

    for (var i = 0; i < variants.length; i++) {
      if (approvedWords[variants[i]] || spellDictionary[variants[i]]) return true;
    }

    return false;
  }

  function cleanSpellTextForScanning(text) {
    return String(text || "")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/www\.\S+/gi, " ")
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, " ")
      .replace(/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/g, " ")
      .replace(/&[a-z]+;/gi, " ");
  }

  function getSpellContextWindow(text, index, length) {
    var start = Math.max(0, index - SPELL_DATA_CONTEXT_CHARS);
    var end = Math.min(text.length, index + length + SPELL_DATA_CONTEXT_CHARS);
    return text.slice(start, end);
  }

  function looksLikeMachineDataContext(context) {
    var value = String(context || "");
    var compact = value.replace(/\s+/g, "");

    if (!value) return false;

    if (compact.indexOf('","') > -1 || compact.indexOf("','") > -1) return true;
    if (/["'][^"']{1,80}["']\s*,\s*["'][^"']{1,80}["']/.test(value)) return true;
    if (/[\{\[]\s*["'][A-Za-z0-9_-]+["']\s*:/.test(value)) return true;
    if (/["'][A-Za-z0-9_-]+["']\s*:/.test(value) && /[,{}\[\]]/.test(value)) return true;

    var quotedTokens = value.match(/["'][A-Za-z][A-Za-z0-9 &/+-]{1,60}["']/g) || [];
    var commaCount = (value.match(/,/g) || []).length;
    var dataPunctuation = (value.match(/[",:{}\[\]]/g) || []).length;
    var letters = (value.match(/[A-Za-z]/g) || []).length;

    if (quotedTokens.length >= 3 && commaCount >= 2) return true;
    if (letters > 20 && dataPunctuation >= 10 && dataPunctuation / letters > 0.12) return true;

    return false;
  }

  function shouldSkipSpellCandidateContext(text, index, length, options) {
    if (!options.skipDataText) return false;
    return looksLikeMachineDataContext(getSpellContextWindow(text, index, length));
  }

  function findSpellContentRoot(doc) {
    return doc.querySelector(
      "main,article,[role='main'],.article-body,.article-content,.docs-article,.doc-content,.documentation-content,.document360-article-content,#article,#content"
    ) || doc.body;
  }

  function removeSpellNoise(root) {
    Array.prototype.slice.call(root.querySelectorAll(
      "script,style,noscript,template,svg,canvas,iframe,code,pre,nav,footer,header,form,button,select,option,input,textarea,[hidden],[aria-hidden='true']"
    )).forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function collectSpellTextChunks(doc, pageUrl, options) {
    var chunks = [];
    var rootSource = options.mainContentOnly ? findSpellContentRoot(doc) : doc.body;
    var clone = rootSource ? rootSource.cloneNode(true) : doc.cloneNode(true);

    removeSpellNoise(clone);

    if (clone && clone.textContent) {
      chunks.push({
        text: cleanSpellTextForScanning(clone.textContent),
        source: options.mainContentOnly ? "main content text" : "page body text"
      });
    }

    if (options.includeMetaText) {
      if (doc.title) chunks.push({ text: cleanSpellTextForScanning(doc.title), source: "page title" });

      Array.prototype.slice.call(doc.querySelectorAll(
        "meta[name='description'],meta[property='og:title'],meta[property='og:description'],meta[name='twitter:title'],meta[name='twitter:description']"
      )).forEach(function (meta) {
        var content = meta.getAttribute("content");
        if (content) chunks.push({ text: cleanSpellTextForScanning(content), source: "meta text" });
      });

      Array.prototype.slice.call(doc.querySelectorAll("img[alt],img[title],[aria-label],[title]")).forEach(function (el) {
        ["alt", "title", "aria-label"].forEach(function (attr) {
          if (el.hasAttribute(attr)) {
            var value = el.getAttribute(attr);
            if (value) chunks.push({ text: cleanSpellTextForScanning(value), source: attr + " text" });
          }
        });
      });
    }

    return chunks;
  }

  function makeSpellContext(text, index, length) {
    var start = Math.max(0, index - SPELL_CONTEXT_CHARS);
    var end = Math.min(text.length, index + length + SPELL_CONTEXT_CHARS);
    return text.slice(start, end).replace(/\s+/g, " ").trim();
  }

  function addSpellResult(word, pageUrl, source, reason, suggestion, context) {
    var canonicalPageUrl = canonicalizePageUrl(pageUrl);
    var confidence = reason === "Known typo" ? "High" : "Review";
    var key = word.toLowerCase() + "|" + canonicalPageUrl + "|" + source + "|" + reason;

    if (spellFindingKeys[key]) return;
    spellFindingKeys[key] = true;

    var isNew = !spellHistorySet[key];
    if (isNew) spellState.newCount++;

    spellFindings.push({
      word: word, pageUrl: pageUrl, canonicalPageUrl: canonicalPageUrl, source: source,
      reason: reason, confidence: confidence, suggestion: suggestion || "", context: context || ""
    });

    spellState.findings = spellFindings.length;
    updateSpellSummary();

    var resultsEl = byId("spellResults");
    if (resultsEl.querySelector(".empty")) resultsEl.innerHTML = "";

    var row = document.createElement("div");
    row.className = "result";

    var wordEl = document.createElement("div");
    wordEl.className = "bad";
    wordEl.textContent = word;
    if (isNew) wordEl.appendChild(makeNewBadge());

    var reasonEl = document.createElement("div");
    reasonEl.className = "meta";
    reasonEl.textContent = suggestion
      ? reason + " | confidence: " + confidence + " | suggestion: " + suggestion
      : reason + " | confidence: " + confidence;

    var sourceEl = document.createElement("div");
    sourceEl.className = "source";
    sourceEl.textContent = "source: " + source;

    var contextEl = document.createElement("div");
    contextEl.className = "source";
    contextEl.textContent = "context: " + context;

    var pageEl = document.createElement("div");
    pageEl.className = "page";
    pageEl.textContent = "on: " + pageUrl;

    row.appendChild(wordEl);
    row.appendChild(reasonEl);
    row.appendChild(sourceEl);
    row.appendChild(contextEl);
    row.appendChild(pageEl);
    resultsEl.appendChild(row);
  }

  async function checkSpellChunk(chunk, pageUrl, approvedWords, options) {
    var text = chunk.text || "";
    var re = /[A-Za-z][A-Za-z’'\-]*[A-Za-z]|[A-Za-z]/g;
    var match;
    var wordsSinceYield = 0;

    while ((match = re.exec(text)) !== null) {
      if (spellState.stop) return;

      if (options.maxFindings > 0 && spellFindings.length >= options.maxFindings) {
        spellState.findingLimitHit = true;
        spellState.stop = true;
        return;
      }

      var rawWord = match[0];
      var normalizedWord = normalizeSpellWord(rawWord);

      if (!normalizedWord || normalizedWord.length < options.minLength) { spellState.skipped++; continue; }
      if (isProbablyNotHumanWord(rawWord, normalizedWord)) { spellState.skipped++; continue; }
      if (isAcceptedContraction(rawWord, normalizedWord)) { spellState.skipped++; continue; }

      var context = makeSpellContext(text, match.index, rawWord.length);

      if (shouldSkipSpellCandidateContext(text, match.index, rawWord.length, options)) { spellState.skipped++; continue; }

      spellState.checked++;
      wordsSinceYield++;

      var typoSuggestion = commonMisspellings[normalizedWord];

      if (typoSuggestion) {
        addSpellResult(rawWord, pageUrl, chunk.source, "Known typo", typoSuggestion, context);
      } else if (!isKnownSpellWord(normalizedWord, approvedWords)) {
        if (options.flagUnknown) {
          addSpellResult(rawWord, pageUrl, chunk.source, "Unknown word", "", context);
        } else {
          spellState.skipped++;
        }
      }

      if (wordsSinceYield >= SPELL_YIELD_EVERY_WORDS) {
        wordsSinceYield = 0;
        updateSpellSummary();
        await sleep(0);
      }
    }
  }

  async function runSpellCheckScan() {
    if (spellState.running) { alert("The spell check scan is already running."); return; }

    var startEl = byId("spellStart");
    var ignoreWordsEl = byId("spellIgnoreWords");
    var statusEl = byId("spellStatus");
    var resultsEl = byId("spellResults");
    var logEl = byId("spellLog");

    var start = startEl.value.trim();
    if (!start) { alert("Enter a start URL."); return; }

    var startUrl;
    try { startUrl = new URL(start); } catch (e) { alert("Invalid start URL."); return; }

    if (!isScannableUrl(startUrl.href)) {
      alert("Start URL must start with http:// or https://.");
      return;
    }

    spellFindings = [];
    spellFindingKeys = {};
    logEl.textContent = "";
    resultsEl.innerHTML = "<div class='empty'>No results yet.</div>";

    var maxPages = getMaxPages();
    resetScanState(spellState, maxPages);
    updateSpellSummary();

    try {
      var approvedWords = splitWordsFromTextarea(defaultSpellIgnoreWords.join("\n") + "\n" + ignoreWordsEl.value);
      var options = {
        flagUnknown: byId("spellFlagUnknown").checked,
        includeMetaText: byId("spellIncludeMetaText").checked,
        mainContentOnly: byId("spellMainContentOnly").checked,
        skipDataText: byId("spellSkipDataText").checked,
        minLength: getSpellMinLength(),
        maxFindings: getSpellMaxFindings()
      };

      var origin = startUrl.origin;
      spellHistorySet = arrayToKeySet(await loadHistoryKeys("spell", origin));

      var firstUrl = normalize(startUrl.href, startUrl.href);
      var queue = [firstUrl];
      var visited = {};
      var queued = {};
      queued[canonicalizePageUrl(firstUrl)] = true;

      logTo(logEl, "Starting spell check scan...");
      logTo(logEl, "Crawling origin only: " + origin);
      logTo(logEl, "Max pages: " + maxPages);
      logTo(logEl, "Mode: " + (options.flagUnknown ? "known typos + unknown-word review" : "known typos only"));
      logTo(logEl, "Data/blob filter: " + (options.skipDataText ? "on" : "off"));
      logTo(logEl, "Max spell findings: " + options.maxFindings);

      if (byId("seedFromSitemap").checked) {
        logTo(logEl, "Fetching sitemap.xml for " + origin + "...");
        var spellSitemapUrls = await fetchSitemapSameOriginUrls(origin);
        var spellSitemapAdded = 0;
        spellSitemapUrls.forEach(function (u) {
          var uKey = canonicalizePageUrl(u);
          if (!queued[uKey] && !visited[uKey]) { queue.push(u); queued[uKey] = true; spellSitemapAdded++; }
        });
        logTo(logEl, "Sitemap seeded " + spellSitemapAdded + " URL(s) into the queue.");
      }

      while (queue.length && !spellState.stop) {
        var url = queue.shift();
        var spellUrlKey = canonicalizePageUrl(url);
        if (!url || visited[spellUrlKey]) continue;

        visited[spellUrlKey] = true;
        spellState.pagesScanned = Object.keys(visited).length;
        spellState.queued = queue.length;

        statusEl.textContent = "Scanning page " + spellState.pagesScanned + " of max " + maxPages +
          " | queued " + queue.length + " | words checked " + spellState.checked +
          " | findings " + spellFindings.length;
        updateSpellSummary();
        logTo(logEl, "Scanning page: " + url);

        var page = await fetchHtmlPage(url);

        if (!page.ok) {
          spellState.skipped++;
          if (page.status === 0 || page.reason.indexOf("HTTP") === 0) spellState.errors++;
          logTo(logEl, "SKIP " + page.reason + ": " + url);
          updateSpellSummary();
        } else {
          var doc = new DOMParser().parseFromString(page.text, "text/html");
          var chunks = collectSpellTextChunks(doc, url, options);
          logTo(logEl, "Text chunks found on page: " + chunks.length);

          for (var i = 0; i < chunks.length; i++) {
            if (spellState.stop) break;
            await checkSpellChunk(chunks[i], url, approvedWords, options);
            updateSpellSummary();
          }

          var links = extractPageLinks(doc, url);
          links.forEach(function (link) {
            var linkKey = canonicalizePageUrl(link);
            if (isSameOrigin(link, origin) && isScannableUrl(link) && isLikelyHtmlPage(link) && !visited[linkKey] && !queued[linkKey]) {
              queue.push(link);
              queued[linkKey] = true;
            }
          });

          spellState.queued = queue.length;
          updateSpellSummary();
        }

        if (Object.keys(visited).length >= maxPages) {
          logTo(logEl, "Stopped at max page limit: " + maxPages);
          break;
        }

        await sleep(CRAWL_DELAY_MS);
      }

      var finalSpellStatus = spellState.findingLimitHit ? "Finding limit hit" : (spellState.stop ? "Stopped" : "Complete");
      finishScanState(spellState, finalSpellStatus);
      statusEl.textContent = finalSpellStatus === "Complete" ? "Scan complete" : finalSpellStatus;

      if (spellState.findingLimitHit) logTo(logEl, "Stopped at max spell findings: " + options.maxFindings);

      logTo(logEl, "Done. Spell findings: " + spellFindings.length + " (" + spellState.newCount + " new since last run)");
      if (isFinalScanStatus(finalSpellStatus)) saveHistoryKeys("spell", origin, Object.keys(spellFindingKeys));
      updateSpellSummary();
    } catch (e) {
      spellState.errors++;
      finishScanState(spellState, "Error");
      statusEl.textContent = "Error";
      logTo(logEl, "FATAL ERROR: " + (e && e.message ? e.message : e));
      updateSpellSummary();
    }
  }

  /* =========================
     Word Search
     ========================= */

  function getWordTerms() {
    var seen = {};
    var terms = [];

    String(byId("wordTerms").value || "").split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (term) {
      var key = term.toLowerCase();
      if (!seen[key]) { seen[key] = true; terms.push(term); }
    });

    return terms;
  }

  function getWordMaxFindings() {
    var input = byId("wordMaxFindings");
    var value = parseInt(input.value, 10);

    if (isNaN(value) || value < 25) value = WORD_DEFAULT_MAX_FINDINGS;
    if (value > 5000) value = 5000;

    input.value = String(value);
    return value;
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildWordRegex(term, options) {
    var pattern = escapeRegExp(term);
    if (options.wholeWord && /^[A-Za-z0-9]+$/.test(term)) pattern = "\\b" + pattern + "\\b";
    return new RegExp(pattern, options.caseSensitive ? "g" : "gi");
  }

  function makeWordContext(text, index, length) {
    var start = Math.max(0, index - SPELL_CONTEXT_CHARS);
    var end = Math.min(text.length, index + length + SPELL_CONTEXT_CHARS);
    return String(text || "").slice(start, end).replace(/\s+/g, " ").trim();
  }

  function addWordResult(term, matchText, pageUrl, source, context) {
    var canonicalPageUrl = canonicalizePageUrl(pageUrl);
    var key = term.toLowerCase() + "|" + matchText.toLowerCase() + "|" + canonicalPageUrl + "|" + source + "|" + context;

    if (wordFindingKeys[key]) return;
    wordFindingKeys[key] = true;

    var isNew = !wordHistorySet[key];
    if (isNew) wordState.newCount++;

    wordFindings.push({ term: term, matchText: matchText, pageUrl: pageUrl, canonicalPageUrl: canonicalPageUrl, source: source, context: context || "" });
    wordState.findings = wordFindings.length;
    updateWordSummary();

    var resultsEl = byId("wordResults");
    if (resultsEl.querySelector(".empty")) resultsEl.innerHTML = "";

    var row = document.createElement("div");
    row.className = "result";

    var termEl = document.createElement("div");
    termEl.className = "bad";
    termEl.textContent = term;
    if (isNew) termEl.appendChild(makeNewBadge());

    var matchEl = document.createElement("div");
    matchEl.className = "meta";
    matchEl.textContent = "matched text: " + matchText;

    var sourceEl = document.createElement("div");
    sourceEl.className = "source";
    sourceEl.textContent = "source: " + source;

    var contextEl = document.createElement("div");
    contextEl.className = "source";
    contextEl.textContent = "context: " + context;

    var pageEl = document.createElement("div");
    pageEl.className = "page";
    pageEl.textContent = "on: " + pageUrl;

    row.appendChild(termEl);
    row.appendChild(matchEl);
    row.appendChild(sourceEl);
    row.appendChild(contextEl);
    row.appendChild(pageEl);
    resultsEl.appendChild(row);
  }

  async function checkWordChunk(chunk, pageUrl, terms, options) {
    var text = chunk.text || "";

    for (var t = 0; t < terms.length; t++) {
      if (wordState.stop) return;

      var term = terms[t];
      var re = buildWordRegex(term, options);
      var match;
      wordState.checked++;

      while ((match = re.exec(text)) !== null) {
        if (wordState.stop) return;

        if (options.maxFindings > 0 && wordFindings.length >= options.maxFindings) {
          wordState.findingLimitHit = true;
          wordState.stop = true;
          return;
        }

        addWordResult(term, match[0], pageUrl, chunk.source, makeWordContext(text, match.index, match[0].length));
        if (match[0].length === 0) re.lastIndex++;
      }

      if (t > 0 && t % 20 === 0) {
        updateWordSummary();
        await sleep(0);
      }
    }
  }

  async function runWordSearchScan() {
    if (wordState.running) { alert("The word search scan is already running."); return; }

    var start = byId("wordStart").value.trim();
    var terms = getWordTerms();

    if (!start) { alert("Enter a start URL."); return; }
    if (!terms.length) { alert("Enter at least one word or phrase to search for."); return; }

    var startUrl;
    try { startUrl = new URL(start); } catch (e) { alert("Invalid start URL."); return; }

    if (!isScannableUrl(startUrl.href)) {
      alert("Start URL must start with http:// or https://.");
      return;
    }

    wordFindings = [];
    wordFindingKeys = {};
    byId("wordLog").textContent = "";
    byId("wordResults").innerHTML = "<div class='empty'>No results yet.</div>";

    var maxPages = getMaxPages();
    resetScanState(wordState, maxPages);
    updateWordSummary();

    try {
      var options = {
        caseSensitive: byId("wordCaseSensitive").checked,
        wholeWord: byId("wordWholeWord").checked,
        includeMetaText: byId("wordIncludeMetaText").checked,
        mainContentOnly: byId("wordMainContentOnly").checked,
        maxFindings: getWordMaxFindings()
      };

      var origin = startUrl.origin;
      wordHistorySet = arrayToKeySet(await loadHistoryKeys("word", origin));

      var firstUrl = normalize(startUrl.href, startUrl.href);
      var queue = [firstUrl];
      var visited = {};
      var queued = {};
      queued[canonicalizePageUrl(firstUrl)] = true;

      logTo(byId("wordLog"), "Starting word search scan...");
      logTo(byId("wordLog"), "Crawling origin only: " + origin);
      logTo(byId("wordLog"), "Max pages: " + maxPages);
      logTo(byId("wordLog"), "Terms: " + terms.join(", "));

      if (byId("seedFromSitemap").checked) {
        logTo(byId("wordLog"), "Fetching sitemap.xml for " + origin + "...");
        var wordSitemapUrls = await fetchSitemapSameOriginUrls(origin);
        var wordSitemapAdded = 0;
        wordSitemapUrls.forEach(function (u) {
          var uKey = canonicalizePageUrl(u);
          if (!queued[uKey] && !visited[uKey]) { queue.push(u); queued[uKey] = true; wordSitemapAdded++; }
        });
        logTo(byId("wordLog"), "Sitemap seeded " + wordSitemapAdded + " URL(s) into the queue.");
      }

      while (queue.length && !wordState.stop) {
        var url = queue.shift();
        var urlKey = canonicalizePageUrl(url);
        if (!url || visited[urlKey]) continue;

        visited[urlKey] = true;
        wordState.pagesScanned = Object.keys(visited).length;
        wordState.queued = queue.length;
        byId("wordStatus").textContent = "Scanning page " + wordState.pagesScanned + " of max " + maxPages +
          " | queued " + queue.length + " | matches " + wordFindings.length;
        updateWordSummary();
        logTo(byId("wordLog"), "Scanning page: " + url);

        var page = await fetchHtmlPage(url);

        if (!page.ok) {
          wordState.skipped++;
          if (page.status === 0 || page.reason.indexOf("HTTP") === 0) wordState.errors++;
          logTo(byId("wordLog"), "SKIP " + page.reason + ": " + url);
          updateWordSummary();
        } else {
          var doc = new DOMParser().parseFromString(page.text, "text/html");
          var chunks = collectSpellTextChunks(doc, url, {
            mainContentOnly: options.mainContentOnly,
            includeMetaText: options.includeMetaText
          });
          logTo(byId("wordLog"), "Text chunks found on page: " + chunks.length);

          for (var i = 0; i < chunks.length; i++) {
            if (wordState.stop) break;
            await checkWordChunk(chunks[i], url, terms, options);
            updateWordSummary();
          }

          extractPageLinks(doc, url).forEach(function (link) {
            var linkKey = canonicalizePageUrl(link);
            if (isSameOrigin(link, origin) && isScannableUrl(link) && isLikelyHtmlPage(link) && !visited[linkKey] && !queued[linkKey]) {
              queue.push(link);
              queued[linkKey] = true;
            }
          });

          wordState.queued = queue.length;
          updateWordSummary();
        }

        if (Object.keys(visited).length >= maxPages) {
          logTo(byId("wordLog"), "Stopped at max page limit: " + maxPages);
          break;
        }

        await sleep(CRAWL_DELAY_MS);
      }

      var finalStatus = wordState.findingLimitHit ? "Finding limit hit" : (wordState.stop ? "Stopped" : "Complete");
      finishScanState(wordState, finalStatus);
      byId("wordStatus").textContent = finalStatus === "Complete" ? "Scan complete" : finalStatus;
      logTo(byId("wordLog"), "Done. Word search matches: " + wordFindings.length + " (" + wordState.newCount + " new since last run)");
      if (isFinalScanStatus(finalStatus)) saveHistoryKeys("word", origin, Object.keys(wordFindingKeys));
      updateWordSummary();
    } catch (e) {
      wordState.errors++;
      finishScanState(wordState, "Error");
      byId("wordStatus").textContent = "Error";
      logTo(byId("wordLog"), "FATAL ERROR: " + (e && e.message ? e.message : e));
      updateWordSummary();
    }
  }

  /* =========================
     Broken Link Scan
     ========================= */

  function extractPageLinksWithFragments(doc, pageUrl) {
    var out = [];

    Array.prototype.slice.call(doc.querySelectorAll("a[href]")).forEach(function (a) {
      var raw = a.getAttribute("href");
      if (!raw) return;

      var trimmed = String(raw).trim();
      if (!trimmed) return;

      var parsed;
      try { parsed = new URL(trimmed, pageUrl); } catch (e) { return; }

      if (parsed.protocol === "mailto:" || parsed.protocol === "tel:" || parsed.protocol === "javascript:") return;

      var fragment = parsed.hash ? parsed.hash.slice(1) : "";
      var noHash = new URL(parsed.href);
      noHash.hash = "";

      out.push({ full: parsed.href, noHash: noHash.href, fragment: fragment });
    });

    return out;
  }

  function fragmentExistsInDoc(doc, fragment) {
    if (!fragment) return true;

    try {
      if (doc.getElementById(fragment)) return true;
    } catch (e) { /* ignore */ }

    try {
      var esc = (window.CSS && CSS.escape) ? CSS.escape(fragment) : fragment.replace(/(["\\])/g, "\\$1");
      if (doc.querySelector("a[name=\"" + esc + "\"]")) return true;
    } catch (e) { /* ignore */ }

    return false;
  }

  function checkLinkStatus(url) {
    if (linkStatusCache[url]) return linkStatusCache[url];

    if (!isScannableUrl(url)) {
      linkStatusCache[url] = Promise.resolve({ ok: false, status: 0, reason: "Blocked: only http/https URLs can be checked" });
      return linkStatusCache[url];
    }

    linkStatusCache[url] = (async function () {
      try {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, LINK_CHECK_TIMEOUT_MS);
        var res;

        try {
          res = await fetch(url, { method: "HEAD", credentials: "include", redirect: "follow", signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }

        if (res.status === 405 || res.status === 501) {
          var controller2 = new AbortController();
          var timer2 = setTimeout(function () { controller2.abort(); }, LINK_CHECK_TIMEOUT_MS);

          try {
            var res2 = await fetch(url, { method: "GET", credentials: "include", redirect: "follow", signal: controller2.signal });
            if (res2.body && res2.body.cancel) { try { res2.body.cancel(); } catch (e) { /* ignore */ } }
            return { ok: res2.ok, status: res2.status, reason: res2.ok ? "OK" : ("HTTP " + res2.status) };
          } finally {
            clearTimeout(timer2);
          }
        }

        return { ok: res.ok, status: res.status, reason: res.ok ? "OK" : ("HTTP " + res.status) };
      } catch (e) {
        var timedOut = e && e.name === "AbortError";
        return { ok: false, status: 0, reason: timedOut ? "Timed out after " + LINK_CHECK_TIMEOUT_MS + "ms" : (e && e.message ? e.message : "Fetch error") };
      }
    })();

    return linkStatusCache[url];
  }

  function addLinkResult(link, page, reason) {
    var canonicalPage = canonicalizePageUrl(page);
    var key = link + "|" + canonicalPage + "|" + reason;
    if (linkFindingKeys[key]) return;
    linkFindingKeys[key] = true;

    var isNew = !linkHistorySet[key];
    if (isNew) linkState.newCount++;

    linkFindings.push({ link: link, page: page, canonicalPage: canonicalPage, reason: reason });
    linkState.findings = linkFindings.length;
    updateLinkSummary();

    var resultsEl = byId("linkResults");
    if (resultsEl.querySelector(".empty")) resultsEl.innerHTML = "";

    var row = document.createElement("div");
    row.className = "result";

    var linkEl = document.createElement("div");
    linkEl.className = "bad";
    linkEl.textContent = link;
    if (isNew) linkEl.appendChild(makeNewBadge());

    var reasonEl = document.createElement("div");
    reasonEl.className = "meta";
    reasonEl.textContent = "reason: " + reason;

    var pageEl = document.createElement("div");
    pageEl.className = "page";
    pageEl.textContent = "on: " + page;

    row.appendChild(linkEl);
    row.appendChild(reasonEl);
    row.appendChild(pageEl);
    resultsEl.appendChild(row);
  }

  async function checkAndReportLink(record, pageUrl, origin, checkAnchors, sameOriginDoc) {
    linkState.checked++;

    var isSameOriginHtml = isSameOrigin(record.noHash, origin) && isLikelyHtmlPage(record.noHash);

    if (isSameOriginHtml) {
      var page = await fetchHtmlPage(record.noHash);

      if (!page.ok) {
        if (page.status === 0 || page.reason.indexOf("HTTP") === 0) linkState.errors++;
        addLinkResult(record.noHash, pageUrl, page.reason);
        return { ok: false, doc: null };
      }

      if (checkAnchors && record.fragment) {
        var targetDoc = record.noHash === pageUrl && sameOriginDoc
          ? sameOriginDoc
          : new DOMParser().parseFromString(page.text, "text/html");

        if (!fragmentExistsInDoc(targetDoc, record.fragment)) {
          addLinkResult(record.full, pageUrl, "Broken anchor: #" + record.fragment + " not found on target page");
        }
      }

      return { ok: true, doc: null };
    }

    var result = await checkLinkStatus(record.noHash);
    if (!result.ok) {
      if (result.status === 0) linkState.errors++;
      addLinkResult(record.noHash, pageUrl, result.reason);
    }

    return { ok: result.ok, doc: null };
  }

  async function runBrokenLinksScan() {
    if (linkState.running) { alert("The broken link scan is already running."); return; }

    var startEl = byId("linkStart");
    var statusEl = byId("linkStatus");
    var resultsEl = byId("linkResults");
    var logEl = byId("linkLog");

    var start = startEl.value.trim();
    if (!start) { alert("Enter a start URL."); return; }

    var startUrl;
    try { startUrl = new URL(start); } catch (e) { alert("Invalid start URL."); return; }

    if (!isScannableUrl(startUrl.href)) {
      alert("Start URL must start with http:// or https://.");
      return;
    }

    linkFindings = [];
    linkFindingKeys = {};
    linkStatusCache = {};
    linkCheckedOnceCache = {};
    logEl.textContent = "";
    resultsEl.innerHTML = "<div class='empty'>No results yet.</div>";

    var maxPages = getMaxPages();
    resetScanState(linkState, maxPages);
    updateLinkSummary();

    var checkAnchors = byId("linkCheckAnchors").checked;

    try {
      var origin = startUrl.origin;
      linkHistorySet = arrayToKeySet(await loadHistoryKeys("link", origin));

      var firstUrl = normalize(startUrl.href, startUrl.href);
      var queue = [firstUrl];
      var visited = {};
      var queued = {};
      queued[canonicalizePageUrl(firstUrl)] = true;

      logTo(logEl, "Starting broken link scan...");
      logTo(logEl, "Crawling origin only: " + origin);
      logTo(logEl, "Max pages: " + maxPages);
      logTo(logEl, "Anchor check: " + (checkAnchors ? "on" : "off"));

      if (byId("seedFromSitemap").checked) {
        logTo(logEl, "Fetching sitemap.xml for " + origin + "...");
        var linkSitemapUrls = await fetchSitemapSameOriginUrls(origin);
        var linkSitemapAdded = 0;
        linkSitemapUrls.forEach(function (u) {
          var uKey = canonicalizePageUrl(u);
          if (!queued[uKey] && !visited[uKey]) { queue.push(u); queued[uKey] = true; linkSitemapAdded++; }
        });
        logTo(logEl, "Sitemap seeded " + linkSitemapAdded + " URL(s) into the queue.");
      }

      while (queue.length && !linkState.stop) {
        var url = queue.shift();
        var linkUrlKey = canonicalizePageUrl(url);
        if (!url || visited[linkUrlKey]) continue;

        visited[linkUrlKey] = true;
        linkState.pagesScanned = Object.keys(visited).length;
        linkState.queued = queue.length;

        statusEl.textContent = "Scanning " + linkState.pagesScanned + " of max " + maxPages +
          " | queued " + queue.length + " | broken " + linkFindings.length;
        updateLinkSummary();
        logTo(logEl, "Scanning: " + url);

        var page = await fetchHtmlPage(url);

        if (!page.ok) {
          linkState.skipped++;
          if (page.status === 0 || page.reason.indexOf("HTTP") === 0) linkState.errors++;
          logTo(logEl, "SKIP " + page.reason + ": " + url);
          updateLinkSummary();
        } else {
          var doc = new DOMParser().parseFromString(page.text, "text/html");
          var records = extractPageLinksWithFragments(doc, url);

          for (var i = 0; i < records.length; i++) {
            if (linkState.stop) break;

            var record = records[i];
            var onceKey = record.noHash + (record.fragment ? "#" + record.fragment : "");
            if (linkCheckedOnceCache[onceKey]) continue;
            linkCheckedOnceCache[onceKey] = true;

            await checkAndReportLink(record, url, origin, checkAnchors, doc);
            updateLinkSummary();
          }

          var crawlLinks = extractPageLinks(doc, url);
          crawlLinks.forEach(function (link) {
            var crawlLinkKey = canonicalizePageUrl(link);
            if (isSameOrigin(link, origin) && isScannableUrl(link) && isLikelyHtmlPage(link) && !visited[crawlLinkKey] && !queued[crawlLinkKey]) {
              queue.push(link);
              queued[crawlLinkKey] = true;
            }
          });

          linkState.queued = queue.length;
          updateLinkSummary();
        }

        if (Object.keys(visited).length >= maxPages) {
          logTo(logEl, "Stopped at max page limit: " + maxPages);
          break;
        }

        await sleep(CRAWL_DELAY_MS);
      }

      finishScanState(linkState, linkState.stop ? "Stopped" : "Complete");
      statusEl.textContent = linkState.status === "Stopped" ? "Stopped" : "Scan complete";
      logTo(logEl, "Done. Broken links: " + linkFindings.length + " (" + linkState.newCount + " new since last run)");
      if (isFinalScanStatus(linkState.status)) saveHistoryKeys("link", origin, Object.keys(linkFindingKeys));
      updateLinkSummary();
    } catch (e) {
      linkState.errors++;
      finishScanState(linkState, "Error");
      statusEl.textContent = "Error";
      logTo(logEl, "FATAL ERROR: " + (e && e.message ? e.message : e));
      updateLinkSummary();
    }
  }

  /* =========================
     Mixed Content Scan
     ========================= */

  function collectMixedContentCandidates(doc, pageUrl) {
    var candidates = [];

    function add(rawValue, source) {
      if (!rawValue) return;
      var normalized = normalize(String(rawValue).trim(), pageUrl);
      if (normalized) candidates.push({ url: normalized, source: source });
    }

    Array.prototype.slice.call(doc.querySelectorAll("img[src]")).forEach(function (el) { add(el.getAttribute("src"), "img[src]"); });
    Array.prototype.slice.call(doc.querySelectorAll("script[src]")).forEach(function (el) { add(el.getAttribute("src"), "script[src]"); });
    Array.prototype.slice.call(doc.querySelectorAll("link[href]")).forEach(function (el) {
      var rel = (el.getAttribute("rel") || "").toLowerCase();
      if (rel.indexOf("stylesheet") > -1 || rel.indexOf("icon") > -1 || rel === "preload") add(el.getAttribute("href"), "link[" + rel + "]");
    });
    Array.prototype.slice.call(doc.querySelectorAll("iframe[src]")).forEach(function (el) { add(el.getAttribute("src"), "iframe[src]"); });
    Array.prototype.slice.call(doc.querySelectorAll("source[src]")).forEach(function (el) { add(el.getAttribute("src"), "source[src]"); });
    Array.prototype.slice.call(doc.querySelectorAll("audio[src],video[src]")).forEach(function (el) {
      add(el.getAttribute("src"), el.tagName.toLowerCase() + "[src]");
    });

    Array.prototype.slice.call(doc.querySelectorAll("[style]")).forEach(function (el) {
      extractCssUrls(el.getAttribute("style"), pageUrl).forEach(function (cssUrl) {
        candidates.push({ url: cssUrl, source: "inline style url()" });
      });
    });

    Array.prototype.slice.call(doc.querySelectorAll("style")).forEach(function (el) {
      extractCssUrls(el.textContent, pageUrl).forEach(function (cssUrl) {
        candidates.push({ url: cssUrl, source: "<style> url()" });
      });
    });

    return candidates;
  }

  function addMixedResult(resourceUrl, pageUrl, source) {
    var canonicalPageUrl = canonicalizePageUrl(pageUrl);
    var key = resourceUrl + "|" + canonicalPageUrl + "|" + source;
    if (mixedFindingKeys[key]) return;
    mixedFindingKeys[key] = true;

    var isNew = !mixedHistorySet[key];
    if (isNew) mixedState.newCount++;

    mixedFindings.push({ resourceUrl: resourceUrl, pageUrl: pageUrl, canonicalPageUrl: canonicalPageUrl, source: source });
    mixedState.findings = mixedFindings.length;
    updateMixedSummary();

    var resultsEl = byId("mixedResults");
    if (resultsEl.querySelector(".empty")) resultsEl.innerHTML = "";

    var row = document.createElement("div");
    row.className = "result";

    var urlEl = document.createElement("div");
    urlEl.className = "bad";
    urlEl.textContent = resourceUrl;
    if (isNew) urlEl.appendChild(makeNewBadge());

    var sourceEl = document.createElement("div");
    sourceEl.className = "source";
    sourceEl.textContent = "source: " + source;

    var pageEl = document.createElement("div");
    pageEl.className = "page";
    pageEl.textContent = "on: " + pageUrl;

    row.appendChild(urlEl);
    row.appendChild(sourceEl);
    row.appendChild(pageEl);
    resultsEl.appendChild(row);
  }

  async function runMixedContentScan() {
    if (mixedState.running) { alert("The mixed content scan is already running."); return; }

    var startEl = byId("mixedStart");
    var statusEl = byId("mixedStatus");
    var resultsEl = byId("mixedResults");
    var logEl = byId("mixedLog");

    var start = startEl.value.trim();
    if (!start) { alert("Enter a start URL."); return; }

    var startUrl;
    try { startUrl = new URL(start); } catch (e) { alert("Invalid start URL."); return; }

    if (startUrl.protocol !== "https:") {
      alert("Start URL must be https:// (mixed content only applies to secure pages).");
      return;
    }

    mixedFindings = [];
    mixedFindingKeys = {};
    logEl.textContent = "";
    resultsEl.innerHTML = "<div class='empty'>No results yet.</div>";

    var maxPages = getMaxPages();
    resetScanState(mixedState, maxPages);
    updateMixedSummary();

    try {
      var origin = startUrl.origin;
      mixedHistorySet = arrayToKeySet(await loadHistoryKeys("mixed", origin));

      var firstUrl = normalize(startUrl.href, startUrl.href);
      var queue = [firstUrl];
      var visited = {};
      var queued = {};
      queued[canonicalizePageUrl(firstUrl)] = true;

      logTo(logEl, "Starting mixed content scan...");
      logTo(logEl, "Crawling origin only: " + origin);
      logTo(logEl, "Max pages: " + maxPages);

      if (byId("seedFromSitemap").checked) {
        logTo(logEl, "Fetching sitemap.xml for " + origin + "...");
        var mixedSitemapUrls = await fetchSitemapSameOriginUrls(origin);
        var mixedSitemapAdded = 0;
        mixedSitemapUrls.forEach(function (u) {
          var uKey = canonicalizePageUrl(u);
          if (!queued[uKey] && !visited[uKey]) { queue.push(u); queued[uKey] = true; mixedSitemapAdded++; }
        });
        logTo(logEl, "Sitemap seeded " + mixedSitemapAdded + " URL(s) into the queue.");
      }

      while (queue.length && !mixedState.stop) {
        var url = queue.shift();
        var mixedUrlKey = canonicalizePageUrl(url);
        if (!url || visited[mixedUrlKey]) continue;

        visited[mixedUrlKey] = true;
        mixedState.pagesScanned = Object.keys(visited).length;
        mixedState.queued = queue.length;

        statusEl.textContent = "Scanning " + mixedState.pagesScanned + " of max " + maxPages +
          " | queued " + queue.length + " | findings " + mixedFindings.length;
        updateMixedSummary();
        logTo(logEl, "Scanning: " + url);

        var page = await fetchHtmlPage(url);

        if (!page.ok) {
          mixedState.skipped++;
          if (page.status === 0 || page.reason.indexOf("HTTP") === 0) mixedState.errors++;
          logTo(logEl, "SKIP " + page.reason + ": " + url);
          updateMixedSummary();
        } else {
          var doc = new DOMParser().parseFromString(page.text, "text/html");
          var candidates = collectMixedContentCandidates(doc, url);
          mixedState.checked += candidates.length;

          candidates.forEach(function (candidate) {
            if (candidate.url.toLowerCase().indexOf("http://") === 0) {
              logTo(logEl, "MIXED CONTENT: " + candidate.url);
              addMixedResult(candidate.url, url, candidate.source);
            }
          });

          var links = extractPageLinks(doc, url);
          links.forEach(function (link) {
            var mixedLinkKey = canonicalizePageUrl(link);
            if (isSameOrigin(link, origin) && isScannableUrl(link) && isLikelyHtmlPage(link) && !visited[mixedLinkKey] && !queued[mixedLinkKey]) {
              queue.push(link);
              queued[mixedLinkKey] = true;
            }
          });

          mixedState.queued = queue.length;
          updateMixedSummary();
        }

        if (Object.keys(visited).length >= maxPages) {
          logTo(logEl, "Stopped at max page limit: " + maxPages);
          break;
        }

        await sleep(CRAWL_DELAY_MS);
      }

      finishScanState(mixedState, mixedState.stop ? "Stopped" : "Complete");
      statusEl.textContent = mixedState.status === "Stopped" ? "Stopped" : "Scan complete";
      logTo(logEl, "Done. Mixed content findings: " + mixedFindings.length + " (" + mixedState.newCount + " new since last run)");
      if (isFinalScanStatus(mixedState.status)) saveHistoryKeys("mixed", origin, Object.keys(mixedFindingKeys));
      updateMixedSummary();
    } catch (e) {
      mixedState.errors++;
      finishScanState(mixedState, "Error");
      statusEl.textContent = "Error";
      logTo(logEl, "FATAL ERROR: " + (e && e.message ? e.message : e));
      updateMixedSummary();
    }
  }

  /* =========================
     Page Audit Scan
     ========================= */

  function auditCheckTitleAndDescription(doc, pageUrl, titleGroups, descGroups, addFinding) {
    var title = (doc.title || "").trim();

    if (!title) {
      addFinding(pageUrl, "Missing <title>", "", "title");
    } else {
      var titleKey = title.toLowerCase();
      if (!titleGroups[titleKey]) titleGroups[titleKey] = [];
      titleGroups[titleKey].push(canonicalizePageUrl(pageUrl));
    }

    var metaDesc = doc.querySelector("meta[name='description']");
    var descValue = metaDesc ? (metaDesc.getAttribute("content") || "").trim() : "";

    if (!metaDesc || !descValue) {
      addFinding(pageUrl, "Missing meta description", "", "meta description");
    } else {
      var descKey = descValue.toLowerCase();
      if (!descGroups[descKey]) descGroups[descKey] = [];
      descGroups[descKey].push(canonicalizePageUrl(pageUrl));
    }
  }

  function auditCheckHeadings(doc, pageUrl, addFinding) {
    var h1s = doc.querySelectorAll("h1");
    if (h1s.length === 0) addFinding(pageUrl, "Missing <h1>", "", "heading structure");
    else if (h1s.length > 1) addFinding(pageUrl, "Multiple <h1> elements (" + h1s.length + ")", "", "heading structure");
  }

  function auditCheckAltText(doc, pageUrl, addFinding) {
    Array.prototype.slice.call(doc.querySelectorAll("img")).forEach(function (img) {
      if (!img.hasAttribute("alt")) {
        addFinding(pageUrl, "Image missing alt attribute", img.getAttribute("src") || "(no src)", "img");
      }
    });
  }

  function elementHasAccessibleLabel(doc, el) {
    if (el.hasAttribute("aria-label") && el.getAttribute("aria-label").trim()) return true;

    var labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      var ids = labelledBy.split(/\s+/).filter(Boolean);
      if (ids.length && ids.every(function (id) { return !!doc.getElementById(id); })) return true;
    }

    if (el.id) {
      try {
        var esc = (window.CSS && CSS.escape) ? CSS.escape(el.id) : el.id;
        if (doc.querySelector("label[for=\"" + esc + "\"]")) return true;
      } catch (e) { /* ignore */ }
    }

    if (el.closest && el.closest("label")) return true;

    return false;
  }

  function auditCheckFormLabels(doc, pageUrl, addFinding) {
    var selector = "input[type='text'],input[type='email'],input[type='password'],input[type='search']," +
      "input[type='tel'],input[type='url'],input[type='number'],input:not([type]),textarea,select";

    Array.prototype.slice.call(doc.querySelectorAll(selector)).forEach(function (el) {
      if (el.type === "hidden" || el.disabled) return;

      if (!elementHasAccessibleLabel(doc, el)) {
        var identifier = el.name ? "name=\"" + el.name + "\"" : (el.id ? "id=\"" + el.id + "\"" : el.tagName.toLowerCase());
        addFinding(pageUrl, "Form field missing label", identifier, el.tagName.toLowerCase());
      }
    });
  }

  function addAuditResult(pageUrl, issue, detail, source) {
    var canonicalPageUrl = canonicalizePageUrl(pageUrl);
    var key = canonicalPageUrl + "|" + issue + "|" + detail + "|" + source;
    if (auditFindingKeys[key]) return;
    auditFindingKeys[key] = true;

    var isNew = !auditHistorySet[key];
    if (isNew) auditState.newCount++;

    auditFindings.push({ pageUrl: pageUrl, canonicalPageUrl: canonicalPageUrl, issue: issue, detail: detail, source: source });
    auditState.findings = auditFindings.length;
    updateAuditSummary();

    var resultsEl = byId("auditResults");
    if (resultsEl.querySelector(".empty")) resultsEl.innerHTML = "";

    var row = document.createElement("div");
    row.className = "result";

    var issueEl = document.createElement("div");
    issueEl.className = "bad";
    issueEl.textContent = issue;
    if (isNew) issueEl.appendChild(makeNewBadge());

    var detailEl = document.createElement("div");
    detailEl.className = "meta";
    detailEl.textContent = detail ? "detail: " + detail : "source: " + source;

    var pageEl = document.createElement("div");
    pageEl.className = "page";
    pageEl.textContent = "on: " + pageUrl;

    row.appendChild(issueEl);
    row.appendChild(detailEl);
    row.appendChild(pageEl);
    resultsEl.appendChild(row);
  }

  async function runPageAuditScan() {
    if (auditState.running) { alert("The page audit is already running."); return; }

    var startEl = byId("auditStart");
    var statusEl = byId("auditStatus");
    var resultsEl = byId("auditResults");
    var logEl = byId("auditLog");

    var start = startEl.value.trim();
    if (!start) { alert("Enter a start URL."); return; }

    var startUrl;
    try { startUrl = new URL(start); } catch (e) { alert("Invalid start URL."); return; }

    if (!isScannableUrl(startUrl.href)) {
      alert("Start URL must start with http:// or https://.");
      return;
    }

    auditFindings = [];
    auditFindingKeys = {};
    logEl.textContent = "";
    resultsEl.innerHTML = "<div class='empty'>No results yet.</div>";

    var maxPages = getMaxPages();
    resetScanState(auditState, maxPages);
    updateAuditSummary();

    var options = {
      checkTitle: byId("auditCheckTitle").checked,
      checkHeadings: byId("auditCheckHeadings").checked,
      checkAlt: byId("auditCheckAlt").checked,
      checkLabels: byId("auditCheckLabels").checked
    };

    var titleGroups = {};
    var descGroups = {};

    function addFinding(pageUrl, issue, detail, source) {
      addAuditResult(pageUrl, issue, detail, source);
    }

    try {
      var origin = startUrl.origin;
      auditHistorySet = arrayToKeySet(await loadHistoryKeys("audit", origin));

      var firstUrl = normalize(startUrl.href, startUrl.href);
      var queue = [firstUrl];
      var visited = {};
      var queued = {};
      queued[canonicalizePageUrl(firstUrl)] = true;

      logTo(logEl, "Starting page audit...");
      logTo(logEl, "Crawling origin only: " + origin);
      logTo(logEl, "Max pages: " + maxPages);

      if (byId("seedFromSitemap").checked) {
        logTo(logEl, "Fetching sitemap.xml for " + origin + "...");
        var auditSitemapUrls = await fetchSitemapSameOriginUrls(origin);
        var auditSitemapAdded = 0;
        auditSitemapUrls.forEach(function (u) {
          var uKey = canonicalizePageUrl(u);
          if (!queued[uKey] && !visited[uKey]) { queue.push(u); queued[uKey] = true; auditSitemapAdded++; }
        });
        logTo(logEl, "Sitemap seeded " + auditSitemapAdded + " URL(s) into the queue.");
      }

      while (queue.length && !auditState.stop) {
        var url = queue.shift();
        var auditUrlKey = canonicalizePageUrl(url);
        if (!url || visited[auditUrlKey]) continue;

        visited[auditUrlKey] = true;
        auditState.pagesScanned = Object.keys(visited).length;
        auditState.queued = queue.length;

        statusEl.textContent = "Scanning " + auditState.pagesScanned + " of max " + maxPages +
          " | queued " + queue.length + " | findings " + auditFindings.length;
        updateAuditSummary();
        logTo(logEl, "Scanning: " + url);

        var page = await fetchHtmlPage(url);

        if (!page.ok) {
          auditState.skipped++;
          if (page.status === 0 || page.reason.indexOf("HTTP") === 0) auditState.errors++;
          logTo(logEl, "SKIP " + page.reason + ": " + url);
          updateAuditSummary();
        } else {
          var doc = new DOMParser().parseFromString(page.text, "text/html");

          if (options.checkTitle) { auditCheckTitleAndDescription(doc, url, titleGroups, descGroups, addFinding); auditState.checked++; }
          if (options.checkHeadings) { auditCheckHeadings(doc, url, addFinding); auditState.checked++; }
          if (options.checkAlt) { auditCheckAltText(doc, url, addFinding); auditState.checked++; }
          if (options.checkLabels) { auditCheckFormLabels(doc, url, addFinding); auditState.checked++; }

          var links = extractPageLinks(doc, url);
          links.forEach(function (link) {
            var auditLinkKey = canonicalizePageUrl(link);
            if (isSameOrigin(link, origin) && isScannableUrl(link) && isLikelyHtmlPage(link) && !visited[auditLinkKey] && !queued[auditLinkKey]) {
              queue.push(link);
              queued[auditLinkKey] = true;
            }
          });

          auditState.queued = queue.length;
          updateAuditSummary();
        }

        if (Object.keys(visited).length >= maxPages) {
          logTo(logEl, "Stopped at max page limit: " + maxPages);
          break;
        }

        await sleep(CRAWL_DELAY_MS);
      }

      if (options.checkTitle && !auditState.stop) {
        Object.keys(titleGroups).forEach(function (key) {
          var pages = titleGroups[key];
          if (pages.length > 1) {
            pages.forEach(function (pageUrl) {
              addAuditResult(pageUrl, "Duplicate <title> (shared with " + (pages.length - 1) + " other page(s))", "", "title");
            });
          }
        });

        Object.keys(descGroups).forEach(function (key) {
          var pages = descGroups[key];
          if (pages.length > 1) {
            pages.forEach(function (pageUrl) {
              addAuditResult(pageUrl, "Duplicate meta description (shared with " + (pages.length - 1) + " other page(s))", "", "meta description");
            });
          }
        });
      }

      finishScanState(auditState, auditState.stop ? "Stopped" : "Complete");
      statusEl.textContent = auditState.status === "Stopped" ? "Stopped" : "Scan complete";
      logTo(logEl, "Done. Audit findings: " + auditFindings.length + " (" + auditState.newCount + " new since last run)");
      if (isFinalScanStatus(auditState.status)) saveHistoryKeys("audit", origin, Object.keys(auditFindingKeys));
      updateAuditSummary();
    } catch (e) {
      auditState.errors++;
      finishScanState(auditState, "Error");
      statusEl.textContent = "Error";
      logTo(logEl, "FATAL ERROR: " + (e && e.message ? e.message : e));
      updateAuditSummary();
    }
  }

  /* =========================
     Scan Presets (per origin)
     ========================= */

  function collectPresetConfig() {
    return {
      maxPages: byId("maxPages").value,
      seedFromSitemap: byId("seedFromSitemap").checked,
      lowerPatterns: byId("lowerPatterns").value,
      imageIgnorePatterns: byId("imageIgnorePatterns").value,
      includeCssImages: byId("includeCssImages").checked,
      includeMetaImages: byId("includeMetaImages").checked,
      imageSkipRedirectedPages: byId("imageSkipRedirectedPages").checked,
      linkCheckAnchors: byId("linkCheckAnchors").checked,
      spellIgnoreWords: byId("spellIgnoreWords").value,
      spellMinLength: byId("spellMinLength").value,
      spellMaxFindings: byId("spellMaxFindings").value,
      spellFlagUnknown: byId("spellFlagUnknown").checked,
      spellMainContentOnly: byId("spellMainContentOnly").checked,
      spellSkipDataText: byId("spellSkipDataText").checked,
      spellIncludeMetaText: byId("spellIncludeMetaText").checked,
      auditCheckTitle: byId("auditCheckTitle").checked,
      auditCheckHeadings: byId("auditCheckHeadings").checked,
      auditCheckAlt: byId("auditCheckAlt").checked,
      auditCheckLabels: byId("auditCheckLabels").checked,
      wordTerms: byId("wordTerms").value,
      wordMaxFindings: byId("wordMaxFindings").value,
      wordCaseSensitive: byId("wordCaseSensitive").checked,
      wordWholeWord: byId("wordWholeWord").checked,
      wordMainContentOnly: byId("wordMainContentOnly").checked,
      wordIncludeMetaText: byId("wordIncludeMetaText").checked
    };
  }

  function applyPresetConfig(config) {
    if (!config) return;

    function setVal(id, value) { if (value !== undefined && byId(id)) byId(id).value = value; }
    function setChk(id, value) { if (value !== undefined && byId(id)) byId(id).checked = !!value; }

    setVal("maxPages", config.maxPages);
    setChk("seedFromSitemap", config.seedFromSitemap);
    setVal("lowerPatterns", config.lowerPatterns);
    setVal("imageIgnorePatterns", config.imageIgnorePatterns);
    setChk("includeCssImages", config.includeCssImages);
    setChk("includeMetaImages", config.includeMetaImages);
    setChk("imageSkipRedirectedPages", config.imageSkipRedirectedPages);
    setChk("linkCheckAnchors", config.linkCheckAnchors);
    setVal("spellIgnoreWords", config.spellIgnoreWords);
    setVal("spellMinLength", config.spellMinLength);
    setVal("spellMaxFindings", config.spellMaxFindings);
    setChk("spellFlagUnknown", config.spellFlagUnknown);
    setChk("spellMainContentOnly", config.spellMainContentOnly);
    setChk("spellSkipDataText", config.spellSkipDataText);
    setChk("spellIncludeMetaText", config.spellIncludeMetaText);
    setChk("auditCheckTitle", config.auditCheckTitle);
    setChk("auditCheckHeadings", config.auditCheckHeadings);
    setChk("auditCheckAlt", config.auditCheckAlt);
    setChk("auditCheckLabels", config.auditCheckLabels);
    setVal("wordTerms", config.wordTerms);
    setVal("wordMaxFindings", config.wordMaxFindings);
    setChk("wordCaseSensitive", config.wordCaseSensitive);
    setChk("wordWholeWord", config.wordWholeWord);
    setChk("wordMainContentOnly", config.wordMainContentOnly);
    setChk("wordIncludeMetaText", config.wordIncludeMetaText);
  }

  function presetsStorageKey(origin) {
    return "siteScannerPresets:" + origin;
  }

  function loadPresetsForOrigin(origin) {
    return new Promise(function (resolve) {
      if (!origin) { resolve({}); return; }
      try {
        var storageKey = presetsStorageKey(origin);
        chrome.storage.local.get([storageKey], function (result) {
          resolve((result && result[storageKey]) || {});
        });
      } catch (e) {
        resolve({});
      }
    });
  }

  function savePresetsForOrigin(origin, presets) {
    try {
      var payload = {};
      payload[presetsStorageKey(origin)] = presets;
      chrome.storage.local.set(payload);
    } catch (e) { /* ignore storage errors */ }
  }

  async function refreshPresetOptions() {
    var select = byId("presetSelect");
    var origin = getOriginFromStartField("lowerStart");

    if (!origin) {
      select.innerHTML = "<option value=''>Enter a Start URL first</option>";
      return;
    }

    var presets = await loadPresetsForOrigin(origin);
    var names = Object.keys(presets);

    select.innerHTML = "";

    if (!names.length) {
      select.appendChild(new Option("No saved presets for " + origin, ""));
      return;
    }

    names.sort().forEach(function (name) {
      select.appendChild(new Option(name, name));
    });
  }

  /* =========================
     Console Error Capture
     ========================= */

  var CONSOLE_ERROR_RULES = [
    {
      test: function (msg) { return /is not defined/i.test(msg); },
      title: "Reference to an undefined variable/function",
      recommendation: "A script referenced a global before it existed. Check script load order — if this is a well-known global like $/jQuery, utag/_satellite (Tealium), or dataLayer, confirm that library's <script> tag runs (and finishes loading) before this one, and that nothing is blocking it (ad blocker, CSP, 404)."
    },
    {
      test: function (msg) { return /cannot read propert(y|ies) of (null|undefined)/i.test(msg); },
      title: "Reading a property of null/undefined",
      recommendation: "Something expected to already exist wasn't there yet — often a DOM element queried before it's rendered, or an API/analytics response with an unexpected shape. Add a null-check, or move the code to run after DOMContentLoaded / after the data actually resolves."
    },
    {
      test: function (msg) { return /(cors|cross-origin request blocked|failed to fetch|networkerror)/i.test(msg); },
      title: "CORS or network failure",
      recommendation: "The request was blocked cross-origin or failed at the network layer. The target server needs an Access-Control-Allow-Origin header for this origin, or the request needs to go through a same-origin proxy. If this isn't CORS-specific, check for a plain connectivity/DNS/timeout issue."
    },
    {
      test: function (msg) { return /content security policy|refused to (load|execute|connect|frame)/i.test(msg); },
      title: "Blocked by Content Security Policy",
      recommendation: "The page's CSP header is blocking this script/resource/connection. Add the resource's origin to the relevant CSP directive (script-src, connect-src, frame-src, etc.), or serve the script with the page's nonce/hash if one is in use."
    },
    {
      test: function (msg) { return /unhandled promise rejection|uncaught \(in promise\)/i.test(msg); },
      title: "Unhandled promise rejection",
      recommendation: "A promise rejected with nothing to catch it. Add a .catch() (or wrap the awaiting code in try/catch) so the failure is handled instead of surfacing as a console error."
    },
    {
      test: function (msg) { return /syntaxerror/i.test(msg); },
      title: "Syntax error in a loaded script",
      recommendation: "A script failed to parse — often a minification/build issue, a stray character, or a script served as the wrong content-type (e.g. an HTML error page returned where JS was expected). Check the network response for the offending script."
    },
    {
      test: function (msg) { return /mixed content/i.test(msg); },
      title: "Mixed content (http:// on an https:// page)",
      recommendation: "An https page is loading a resource over plain http://, which browsers block or warn on. Update the resource URL to https://, or use a protocol-relative/relative URL. The Mixed Content scanner tab can find these site-wide."
    },
    {
      test: function (msg) { return /utag|tealium/i.test(msg); },
      title: "Tealium tag manager issue",
      recommendation: "This looks Tealium-related. Confirm utag.js loaded successfully (check the network tab for utag.js and utag_data), that this code runs after the Tealium sync/async load completes, and that no ad blocker or CSP rule is blocking the Tealium domain."
    },
    {
      test: function (msg) { return /\bjquery\b|\$ is not defined/i.test(msg); },
      title: "jQuery load-order issue",
      recommendation: "Code depending on $/jQuery ran before jQuery loaded, or jQuery failed to load at all. Confirm the jQuery <script> tag is present, loads successfully, and completes before this code runs."
    },
    {
      test: function (msg) { return /404|failed to load resource/i.test(msg); },
      title: "Resource failed to load",
      recommendation: "A referenced script/stylesheet/image returned an error status. Verify the URL is correct and the resource actually exists at that path — the Broken Links / Missing Images scanner tabs in this tool can confirm this across the whole site."
    },
    {
      test: function (msg) { return /invoca/i.test(msg); },
      title: "Invoca call-tracking tag missing a required parameter",
      recommendation: "Invoca (dynamic number insertion / call tracking) tried to run but a required parameter wasn't populated — e.g. \"no PPCPN\" means it didn't have a pre-populated caller phone number to work with. Check the Invoca tag's setup in Tealium iQ: confirm whatever data layer variable, URL param, or cookie it expects for that parameter is actually being set on this page before the tag fires. Until it is, calls from this page load aren't being tracked/attributed by Invoca — the rest of the page is unaffected."
    },
    {
      test: function (msg) { return /pinterest/i.test(msg); },
      title: "Pinterest tag fired more than once",
      recommendation: "The Pinterest conversion tag's load command ran twice with different tag IDs. Usually means the Pinterest snippet is being injected from more than one place (a hardcoded snippet plus a Tealium/GTM tag, or a client-side route change re-firing it without checking if it's already loaded). Check for duplicate Pinterest tag placements in Tealium iQ or the page template and dedupe them."
    },
    {
      test: function (msg) { return /^script error\.?$/i.test(msg.trim()); },
      title: "Cross-origin script threw with details hidden (\"Script error.\")",
      recommendation: "Browsers replace the real message/stack with the generic \"Script error.\" when an uncaught exception comes from a script loaded from a different origin without CORS enabled for it (no Access-Control-Allow-Origin header, or the <script> tag is missing a matching crossorigin attribute) — this is deliberate, so cross-origin scripts can't leak details to the page. To see the real error: if you control the script, add crossorigin=\"anonymous\" to its <script> tag and make sure the server sends Access-Control-Allow-Origin for it. If it's a third-party/vendor tag you don't control, check the Network tab for scripts loaded around the same timestamp to identify which one it is — the console alone won't say more without CORS fixed on their end."
    },
    {
      test: function (msg) { return /^at:\s*metric element not found/i.test(msg.trim()); },
      title: "Adobe Target metric selector not found on this page",
      recommendation: function (msg) {
        var selectorMatch = msg.match(/"selector"\s*:\s*"([^"]+)"/);
        var typeMatch = msg.match(/"type"\s*:\s*"([^"]+)"/);
        var selector = selectorMatch ? selectorMatch[1] : "the configured selector";
        var eventType = typeMatch ? typeMatch[1] : "an";
        return "An Adobe Target activity has a " + eventType + " metric configured to track " + selector +
          ", but that element doesn't exist on this page. Usually means the activity's page/audience targeting is broader than the pages that actually have that element (e.g. a metric meant for a different page or flow is still being evaluated here). Check that activity's metric configuration in Adobe Target (or the Tealium extension driving it) and either scope it to the right pages or fix the selector.";
      }
    },
    {
      test: function (msg) { return /failed actions/i.test(msg) && /trackclick/i.test(msg); },
      title: "Adobe Target click-tracking actions failed to bind",
      recommendation: "One or more click-tracking (trackClick) actions failed to attach — same root cause as the \"metric element not found\" warnings: the selector(s) referenced in this message's JSON don't exist on this page. Check each selector against the page and either fix that activity's page targeting in Adobe Target or fix the selector."
    },
    {
      test: function (msg) { return /embeddedservice(bootstrap|messaging)/i.test(msg); },
      title: "Salesforce Embedded Service (chat widget) — native function overridden",
      recommendation: "The Salesforce Embedded Service (chat/messaging widget) is warning that a native browser function it depends on (e.g. window.clearTimeout) has been reassigned/monkey-patched by something else on the page, which can break its internal timers. Find what else on the page is overriding that native function — check other vendor tags/scripts, especially ones loading before the Embedded Service snippet — and make sure it either restores the original afterward or doesn't touch it at all."
    }
  ];

  var CONSOLE_FALLBACK_RULE = {
    title: "No specific pattern matched",
    recommendation: "This message didn't match any of the known patterns above. Read the text and stack trace for the originating script/line — note whether it names a specific vendor tag, library, or your own code, since that points at where to start. If you see the same message recur across scans, it's worth adding a dedicated rule for it."
  };

  function matchConsoleRules(message) {
    var matched = CONSOLE_ERROR_RULES.filter(function (rule) { return rule.test(message); });

    var resolved = matched.map(function (rule) {
      return {
        title: rule.title,
        recommendation: typeof rule.recommendation === "function" ? rule.recommendation(message) : rule.recommendation
      };
    });

    return resolved.length ? resolved : [CONSOLE_FALLBACK_RULE];
  }

  var consoleState = createScanState("console");
  consoleState.tabId = null;
  consoleState.tabLabel = "";
  consoleState.originPattern = null;
  consoleState.errorCount = 0;
  consoleState.warningCount = 0;
  consoleState.rejectionCount = 0;

  var consoleFindings = [];
  var lastConsoleFindingKey = null;
  var lastConsoleRowEl = null;

  function getConsoleMaxFindings() {
    var input = byId("consoleMaxFindings");
    var value = parseInt(input.value, 10);

    if (isNaN(value) || value < 25) value = CONSOLE_DEFAULT_MAX_FINDINGS;
    if (value > 5000) value = 5000;

    input.value = String(value);
    return value;
  }

  function updateConsoleSummary() {
    setText("consoleSumStatus", consoleState.status);
    setText("consoleSumDuration", getDurationText(consoleState));
    setText("consoleSumPages", consoleState.pagesScanned + " / " + consoleState.maxPages);
    setText("consoleSumQueued", consoleState.queued);
    setText("consoleSumEvents", consoleFindings.length);
    setText("consoleSumErrors", consoleState.errorCount);
    setText("consoleSumWarnings", consoleState.warningCount);
    setText("consoleSumRejections", consoleState.rejectionCount);
  }

  async function refreshConsoleTabList(preferredTabId) {
    var select = byId("consoleTabSelect");
    var currentValue = select.value;
    var tabs = await chrome.tabs.query({});
    var httpTabs = tabs.filter(function (t) { return /^https?:\/\//i.test(t.url || ""); });

    select.innerHTML = "";
    if (!httpTabs.length) {
      select.appendChild(new Option("No http(s) tabs open", ""));
      return;
    }

    httpTabs.forEach(function (t) {
      var label = (t.title ? t.title + " — " : "") + t.url;
      select.appendChild(new Option(label, String(t.id)));
    });

    var target = preferredTabId != null ? String(preferredTabId) : currentValue;
    if (target && httpTabs.some(function (t) { return String(t.id) === target; })) {
      select.value = target;
    }
  }

  function consoleEventTypeLabel(type) {
    switch (type) {
      case "uncaught-exception": return "Uncaught exception";
      case "unhandled-rejection": return "Unhandled promise rejection";
      case "console.error": return "console.error";
      case "console.warn": return "console.warn";
      default: return type;
    }
  }

  function bumpConsoleTypeCounter(type) {
    if (type === "uncaught-exception") consoleState.errorCount++;
    else if (type === "unhandled-rejection") consoleState.rejectionCount++;
    else if (type === "console.warn") consoleState.warningCount++;
    else consoleState.errorCount++;
  }

  function addConsoleFinding(payload) {
    if (consoleState.findingLimitHit) return;

    var type = payload.type;
    var message = payload.message || "";
    var time = payload.time || Date.now();
    var key = type + "|" + message;

    // Collapse an event that's identical (same type+message) to the one
    // immediately before it into a repeat count instead of adding a new
    // row each time — a single noisy/looping error on the page otherwise
    // floods the results list and can make the tab unresponsive.
    if (key === lastConsoleFindingKey && consoleFindings.length) {
      var last = consoleFindings[consoleFindings.length - 1];
      last.count = (last.count || 1) + 1;
      last.time = time;

      bumpConsoleTypeCounter(type);
      updateConsoleSummary();

      if (lastConsoleRowEl) {
        var metaEl = lastConsoleRowEl.querySelector(".meta");
        if (metaEl) {
          metaEl.textContent = consoleEventTypeLabel(type) + " — " + new Date(time).toLocaleTimeString() +
            " (x" + last.count + ")";
        }
      }

      return;
    }

    var matches = matchConsoleRules(message);

    var finding = {
      time: time,
      type: type,
      message: message,
      stack: payload.stack || "",
      pageUrl: payload.url || "",
      count: 1,
      recommendations: matches
    };
    consoleFindings.push(finding);
    lastConsoleFindingKey = key;

    bumpConsoleTypeCounter(type);

    var maxFindings = getConsoleMaxFindings();
    if (maxFindings > 0 && consoleFindings.length >= maxFindings) {
      consoleState.findingLimitHit = true;
      consoleState.stop = true;
    }

    updateConsoleSummary();

    var resultsEl = byId("consoleResults");
    if (resultsEl.querySelector(".empty")) resultsEl.innerHTML = "";

    var row = document.createElement("div");
    row.className = "result";

    var msgEl = document.createElement("div");
    msgEl.className = "bad";
    msgEl.textContent = message || "(empty message)";

    var metaEl = document.createElement("div");
    metaEl.className = "meta";
    metaEl.textContent = consoleEventTypeLabel(type) + " — " + new Date(time).toLocaleTimeString();

    var pageEl = document.createElement("div");
    pageEl.className = "page";
    pageEl.textContent = "on: " + (payload.url || "(unknown)");

    row.appendChild(msgEl);
    row.appendChild(metaEl);
    row.appendChild(pageEl);

    matches.forEach(function (rule) {
      var recEl = document.createElement("div");
      recEl.className = "rec";
      var titleEl = document.createElement("strong");
      titleEl.textContent = rule.title;
      recEl.appendChild(titleEl);
      recEl.appendChild(document.createTextNode(rule.recommendation));
      row.appendChild(recEl);
    });

    resultsEl.insertBefore(row, resultsEl.firstChild);
    lastConsoleRowEl = row;

    var logEl = byId("consoleLog");
    logTo(logEl, "[" + consoleEventTypeLabel(type) + "] " + message);

    if (consoleState.findingLimitHit) {
      logTo(logEl, "Stopping at max captured events: " + maxFindings + ". Increase the limit, or Clear results and start again if you need more.");
    }
  }

  function handleConsoleCaptureMessage(message, sender) {
    if (!message || message.type !== "ACG_CONSOLE_CAPTURE_EVENT") return;
    if (!consoleState.running) return;
    if (!sender || !sender.tab || sender.tab.id !== consoleState.tabId) return;

    addConsoleFinding(message.payload || {});
  }

  chrome.runtime.onMessage.addListener(function (message, sender) {
    handleConsoleCaptureMessage(message, sender);
  });

  var CONSOLE_CAPTURE_MAIN_SCRIPT_ID = "acg-console-capture-main";
  var CONSOLE_CAPTURE_RELAY_SCRIPT_ID = "acg-console-capture-relay";

  // Beyond hooking the tab's current (already-loaded) page, arm a dynamic
  // content script scoped to that tab's origin so the hook reinstalls
  // itself automatically at document_start on the next load/reload —
  // otherwise errors that only fire once during page/tag-manager init
  // (the common case for Tealium/vendor tag failures) happen before a
  // one-time injection into an already-loaded tab could ever see them.
  // Origin-scoped, not tab-scoped (chrome.scripting has no such concept),
  // so other tabs already on the same origin would also get hooked on
  // their next load — harmless, since events are still filtered down to
  // the selected tab's id before being recorded.
  async function registerPersistentConsoleCapture(originPattern) {
    try {
      await chrome.scripting.unregisterContentScripts({
        ids: [CONSOLE_CAPTURE_MAIN_SCRIPT_ID, CONSOLE_CAPTURE_RELAY_SCRIPT_ID]
      });
    } catch (e) { /* nothing registered yet — fine */ }

    await chrome.scripting.registerContentScripts([
      {
        id: CONSOLE_CAPTURE_MAIN_SCRIPT_ID,
        matches: [originPattern],
        js: ["console-capture-main.js"],
        runAt: "document_start",
        world: "MAIN",
        persistAcrossSessions: false
      },
      {
        id: CONSOLE_CAPTURE_RELAY_SCRIPT_ID,
        matches: [originPattern],
        js: ["console-capture-relay.js"],
        runAt: "document_start",
        persistAcrossSessions: false
      }
    ]);
  }

  async function unregisterPersistentConsoleCapture() {
    try {
      await chrome.scripting.unregisterContentScripts({
        ids: [CONSOLE_CAPTURE_MAIN_SCRIPT_ID, CONSOLE_CAPTURE_RELAY_SCRIPT_ID]
      });
    } catch (e) { /* already gone — fine */ }
  }

  function getConsoleMaxPages() {
    var input = byId("consoleMaxPages");
    var value = parseInt(input.value, 10);

    if (isNaN(value) || value < 1) value = CONSOLE_SCAN_DEFAULT_MAX_PAGES;
    if (value > CONSOLE_SCAN_HARD_MAX_PAGES) value = CONSOLE_SCAN_HARD_MAX_PAGES;

    input.value = String(value);
    return value;
  }

  function getConsoleSecondsPerPage() {
    var input = byId("consoleSecondsPerPage");
    var value = parseInt(input.value, 10);

    if (isNaN(value) || value < 3) value = CONSOLE_SCAN_DEFAULT_SECONDS_PER_PAGE;
    if (value > 60) value = 60;

    input.value = String(value);
    return value;
  }

  function waitForTabLoad(tabId, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;

      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(false);
      }, timeoutMs);

      function listener(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async function navigateConsoleScanTab(tabId, url) {
    var tab = await chrome.tabs.get(tabId);
    if (tab.url === url) {
      await chrome.tabs.reload(tabId);
    } else {
      await chrome.tabs.update(tabId, { url: url });
    }
    await waitForTabLoad(tabId, CONSOLE_SCAN_NAV_TIMEOUT_MS);
  }

  async function extractLinksFromLiveTab(tabId, pageUrl) {
    try {
      var results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function () {
          return Array.prototype.slice.call(document.querySelectorAll("a[href]")).map(function (a) { return a.href; });
        }
      });
      var raw = (results && results[0] && results[0].result) || [];
      return raw.map(function (href) { return normalize(href, pageUrl); }).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  async function detachConsoleScan(tabId) {
    try { await unregisterPersistentConsoleCapture(); } catch (e) { /* ignore */ }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: "MAIN",
        func: function () {
          if (window.__acgConsoleCapture && window.__acgConsoleCapture.stop) {
            window.__acgConsoleCapture.stop();
          }
        }
      });
    } catch (e) { /* tab may have navigated to another origin or closed */ }
  }

  async function runConsoleScan() {
    if (consoleState.running) { alert("A console scan is already running."); return; }

    var select = byId("consoleTabSelect");
    var tabId = Number(select.value);
    if (!tabId) { alert("Pick a target tab first."); return; }

    var statusEl = byId("consoleStatus");
    var logEl = byId("consoleLog");
    var resultsEl = byId("consoleResults");

    var startTab;
    try {
      startTab = await chrome.tabs.get(tabId);
    } catch (e) {
      alert("Could not read that tab: " + (e && e.message ? e.message : e));
      return;
    }

    var startUrl;
    try {
      startUrl = new URL(startTab.url);
      if (!isScannableUrl(startUrl.href)) throw new Error("not http(s)");
    } catch (e) {
      alert("Target tab must be an http(s) page.");
      return;
    }

    consoleFindings = [];
    lastConsoleFindingKey = null;
    lastConsoleRowEl = null;
    logEl.textContent = "";
    resultsEl.innerHTML = "<div class='empty'>No events captured yet.</div>";

    var maxPages = getConsoleMaxPages();
    var secondsPerPage = getConsoleSecondsPerPage();
    resetScanState(consoleState, maxPages);
    consoleState.tabId = tabId;
    consoleState.tabLabel = (startTab.title ? startTab.title + " — " : "") + startTab.url;
    consoleState.errorCount = 0;
    consoleState.warningCount = 0;
    consoleState.rejectionCount = 0;
    updateConsoleSummary();

    var origin = startUrl.origin;
    var originPattern = origin + "/*";
    consoleState.originPattern = originPattern;

    try {
      await registerPersistentConsoleCapture(originPattern);
    } catch (e) {
      consoleState.errors++;
      finishScanState(consoleState, "Error");
      statusEl.textContent = "Could not arm console capture: " + (e && e.message ? e.message : e);
      updateConsoleSummary();
      return;
    }

    logTo(logEl, "Starting console scan...");
    logTo(logEl, "Driving tab " + tabId + ", origin: " + origin);
    logTo(logEl, "Max pages: " + maxPages + " | Seconds per page: " + secondsPerPage);

    var firstUrl = normalize(startUrl.href, startUrl.href);
    var queue = [firstUrl];
    var visited = {};
    var queued = {};
    queued[canonicalizePageUrl(firstUrl)] = true;

    while (queue.length && !consoleState.stop) {
      var url = queue.shift();
      var urlKey = canonicalizePageUrl(url);
      if (!url || visited[urlKey]) continue;

      visited[urlKey] = true;
      consoleState.pagesScanned = Object.keys(visited).length;
      consoleState.queued = queue.length;

      statusEl.textContent = "Scanning " + consoleState.pagesScanned + " of max " + maxPages +
        " | queued " + queue.length + " | events " + consoleFindings.length;
      updateConsoleSummary();
      logTo(logEl, "Navigating to: " + url);

      try {
        await navigateConsoleScanTab(tabId, url);
      } catch (e) {
        consoleState.skipped++;
        consoleState.errors++;
        logTo(logEl, "SKIP (navigation failed): " + url + " — " + (e && e.message ? e.message : e));
        updateConsoleSummary();
        if (consoleState.stop) break;
        continue;
      }

      logTo(logEl, "Loaded. Watching for " + secondsPerPage + "s...");
      await sleep(secondsPerPage * 1000);

      if (consoleState.stop) break;

      var links = await extractLinksFromLiveTab(tabId, url);
      links.forEach(function (link) {
        var linkKey = canonicalizePageUrl(link);
        if (isSameOrigin(link, origin) && isScannableUrl(link) && isLikelyHtmlPage(link) && !visited[linkKey] && !queued[linkKey]) {
          queue.push(link);
          queued[linkKey] = true;
        }
      });

      consoleState.queued = queue.length;
      updateConsoleSummary();

      if (Object.keys(visited).length >= maxPages) {
        logTo(logEl, "Stopped at max page limit: " + maxPages);
        break;
      }
    }

    await detachConsoleScan(tabId);

    var finalStatus = consoleState.findingLimitHit ? "Finding limit hit" : (consoleState.stop ? "Stopped" : "Complete");
    finishScanState(consoleState, finalStatus);
    statusEl.textContent = finalStatus === "Complete" ? "Scan complete" : finalStatus;
    logTo(logEl, "Done. Pages scanned: " + consoleState.pagesScanned + " | Events: " + consoleFindings.length);
    updateConsoleSummary();
  }

  function stopConsoleScan() {
    if (!consoleState.running) { alert("No console scan is running."); return; }
    consoleState.stop = true;
    consoleState.status = "Stopping";
    byId("consoleStatus").textContent = "Stopping...";
  }

  /* =========================
     Combined export
     ========================= */

  function downloadJson(filename, data) {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);

    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  /* =========================
     Button Wiring
     ========================= */

  byId("tabLowerBtn").onclick = function () { setActiveTab("lower"); };
  byId("tabLinksBtn").onclick = function () { setActiveTab("links"); };
  byId("tabImagesBtn").onclick = function () { setActiveTab("images"); };
  byId("tabMixedBtn").onclick = function () { setActiveTab("mixed"); };
  byId("tabSpellBtn").onclick = function () { setActiveTab("spell"); };
  byId("tabAuditBtn").onclick = function () { setActiveTab("audit"); };
  byId("tabWordBtn").onclick = function () { setActiveTab("word"); };
  byId("tabConsoleBtn").onclick = function () { setActiveTab("console"); refreshConsoleTabList(); };

  byId("lowerScanBtn").onclick = function () { runLowerEnvironmentScan(); };
  byId("imageScanBtn").onclick = function () { runMissingImageScan(); };
  byId("spellScanBtn").onclick = function () { runSpellCheckScan(); };
  byId("wordScanBtn").onclick = function () { runWordSearchScan(); };
  byId("linkScanBtn").onclick = function () { runBrokenLinksScan(); };
  byId("mixedScanBtn").onclick = function () { runMixedContentScan(); };
  byId("auditScanBtn").onclick = function () { runPageAuditScan(); };

  byId("runBothBtn").onclick = async function () {
    var started = [];
    var alreadyRunning = lowerState.running && imageState.running && spellState.running &&
      linkState.running && mixedState.running && auditState.running && consoleState.running;
    var nothingElseToStart = alreadyRunning;

    if (!lowerState.running) { runLowerEnvironmentScan(); started.push("lower env links"); }
    if (!imageState.running) { runMissingImageScan(); started.push("images"); }
    if (!spellState.running) { runSpellCheckScan(); started.push("spell check"); }
    if (!linkState.running) { runBrokenLinksScan(); started.push("broken links"); }
    if (!mixedState.running) { runMixedContentScan(); started.push("mixed content"); }
    if (!auditState.running) { runPageAuditScan(); started.push("page audit"); }

    // Word Search has no default term list (unlike the others, which ship
    // with default patterns/dictionaries/checks), so "Run all" only starts it
    // when the tester has actually entered terms. Calling it unconditionally
    // would hit its "enter at least one term" alert(), which blocks the JS
    // event loop and stalls the scans just started above until dismissed.
    if (!wordState.running && getWordTerms().length) {
      runWordSearchScan();
      started.push("word search");
    } else if (!wordState.running) {
      byId("wordStatus").textContent = "Skipped by Run All: no search terms entered.";
      nothingElseToStart = false;
    }

    // Console Scan needs an actual target tab picked (unlike the fetch-based
    // scanners above), and calling it with none selected would hit its own
    // blocking alert() the same way Word Search's does. Refresh the tab list
    // first so this reflects whatever tabs are actually open right now.
    if (!consoleState.running) {
      await refreshConsoleTabList();
      if (byId("consoleTabSelect").value) {
        runConsoleScan();
        started.push("console errors");
      } else {
        byId("consoleStatus").textContent = "Skipped by Run All: no target tab available to drive.";
        nothingElseToStart = false;
      }
    }

    if (!started.length && nothingElseToStart) alert("All scans are already running.");
  };

  byId("lowerStopBtn").onclick = function () {
    if (!lowerState.running) { byId("lowerStatus").textContent = "No active link scan."; return; }
    lowerState.stop = true;
    lowerState.status = "Stopping";
    byId("lowerStatus").textContent = "Stopping link scan...";
    updateLowerSummary();
  };

  byId("imageStopBtn").onclick = function () {
    if (!imageState.running) { byId("imageStatus").textContent = "No active image scan."; return; }
    imageState.stop = true;
    imageState.status = "Stopping";
    byId("imageStatus").textContent = "Stopping image scan...";
    updateImageSummary();
  };

  byId("spellStopBtn").onclick = function () {
    if (!spellState.running) { byId("spellStatus").textContent = "No active spell check scan."; return; }
    spellState.stop = true;
    spellState.status = "Stopping";
    byId("spellStatus").textContent = "Stopping spell check scan...";
    updateSpellSummary();
  };

  byId("wordStopBtn").onclick = function () {
    if (!wordState.running) { byId("wordStatus").textContent = "No active word search scan."; return; }
    wordState.stop = true;
    wordState.status = "Stopping";
    byId("wordStatus").textContent = "Stopping word search scan...";
    updateWordSummary();
  };

  byId("linkStopBtn").onclick = function () {
    if (!linkState.running) { byId("linkStatus").textContent = "No active link scan."; return; }
    linkState.stop = true;
    linkState.status = "Stopping";
    byId("linkStatus").textContent = "Stopping link scan...";
    updateLinkSummary();
  };

  byId("mixedStopBtn").onclick = function () {
    if (!mixedState.running) { byId("mixedStatus").textContent = "No active mixed content scan."; return; }
    mixedState.stop = true;
    mixedState.status = "Stopping";
    byId("mixedStatus").textContent = "Stopping mixed content scan...";
    updateMixedSummary();
  };

  byId("auditStopBtn").onclick = function () {
    if (!auditState.running) { byId("auditStatus").textContent = "No active page audit."; return; }
    auditState.stop = true;
    auditState.status = "Stopping";
    byId("auditStatus").textContent = "Stopping page audit...";
    updateAuditSummary();
  };

  byId("stopBothBtn").onclick = function () {
    var stoppedAny = false;

    if (lowerState.running) {
      lowerState.stop = true; lowerState.status = "Stopping";
      byId("lowerStatus").textContent = "Stopping link scan...";
      stoppedAny = true;
    }
    if (imageState.running) {
      imageState.stop = true; imageState.status = "Stopping";
      byId("imageStatus").textContent = "Stopping image scan...";
      stoppedAny = true;
    }
    if (spellState.running) {
      spellState.stop = true; spellState.status = "Stopping";
      byId("spellStatus").textContent = "Stopping spell check scan...";
      stoppedAny = true;
    }
    if (wordState.running) {
      wordState.stop = true; wordState.status = "Stopping";
      byId("wordStatus").textContent = "Stopping word search scan...";
      stoppedAny = true;
    }
    if (linkState.running) {
      linkState.stop = true; linkState.status = "Stopping";
      byId("linkStatus").textContent = "Stopping link scan...";
      stoppedAny = true;
    }
    if (mixedState.running) {
      mixedState.stop = true; mixedState.status = "Stopping";
      byId("mixedStatus").textContent = "Stopping mixed content scan...";
      stoppedAny = true;
    }
    if (auditState.running) {
      auditState.stop = true; auditState.status = "Stopping";
      byId("auditStatus").textContent = "Stopping page audit...";
      stoppedAny = true;
    }
    if (consoleState.running) {
      consoleState.stop = true; consoleState.status = "Stopping";
      byId("consoleStatus").textContent = "Stopping...";
      stoppedAny = true;
    }

    if (!stoppedAny) alert("No scans are currently running.");

    updateLowerSummary();
    updateImageSummary();
    updateSpellSummary();
    updateWordSummary();
    updateLinkSummary();
    updateMixedSummary();
    updateAuditSummary();
    updateConsoleSummary();
    updateGlobalSummary();
  };

  byId("lowerExportBtn").onclick = function () {
    if (!lowerFindings.length) { alert("No lower environment link results to export."); return; }

    downloadCsv(
      "lower-environment-link-scan.csv",
      ["Lower Environment Link", "Found On Page", "Canonical Page", "Matched Pattern"],
      lowerFindings.map(function (f) { return [f.link, f.page, f.canonicalPage || f.page, f.pattern]; })
    );
  };

  byId("imageExportBtn").onclick = function () {
    if (!imageFindings.length) { alert("No missing image results to export."); return; }

    downloadCsv(
      "missing-image-scan.csv",
      ["Missing Image URL", "Found On Page", "Canonical Page", "Source", "Reason"],
      imageFindings.map(function (f) { return [f.imageUrl, f.pageUrl, f.canonicalPageUrl || f.pageUrl, f.source, f.reason]; })
    );
  };

  byId("spellExportBtn").onclick = function () {
    if (!spellFindings.length) { alert("No spell check results to export."); return; }

    downloadCsv(
      "spell-check-scan.csv",
      ["Word", "Found On Page", "Canonical Page", "Source", "Reason", "Confidence", "Suggestion", "Context"],
      spellFindings.map(function (f) {
        return [f.word, f.pageUrl, f.canonicalPageUrl || f.pageUrl, f.source, f.reason, f.confidence || "", f.suggestion, f.context];
      })
    );
  };

  byId("wordExportBtn").onclick = function () {
    if (!wordFindings.length) { alert("No word search results to export."); return; }

    downloadCsv(
      "word-search-scan.csv",
      ["Search Term", "Matched Text", "Found On Page", "Canonical Page", "Source", "Context"],
      wordFindings.map(function (f) {
        return [f.term, f.matchText, f.pageUrl, f.canonicalPageUrl || f.pageUrl, f.source, f.context];
      })
    );
  };

  byId("linkExportBtn").onclick = function () {
    if (!linkFindings.length) { alert("No broken link results to export."); return; }

    downloadCsv(
      "broken-link-scan.csv",
      ["Link", "Found On Page", "Canonical Page", "Reason"],
      linkFindings.map(function (f) { return [f.link, f.page, f.canonicalPage || f.page, f.reason]; })
    );
  };

  byId("mixedExportBtn").onclick = function () {
    if (!mixedFindings.length) { alert("No mixed content results to export."); return; }

    downloadCsv(
      "mixed-content-scan.csv",
      ["Insecure Resource URL", "Found On Page", "Canonical Page", "Source"],
      mixedFindings.map(function (f) { return [f.resourceUrl, f.pageUrl, f.canonicalPageUrl || f.pageUrl, f.source]; })
    );
  };

  byId("auditExportBtn").onclick = function () {
    if (!auditFindings.length) { alert("No page audit results to export."); return; }

    downloadCsv(
      "page-audit-scan.csv",
      ["Page", "Canonical Page", "Issue", "Detail", "Source"],
      auditFindings.map(function (f) { return [f.pageUrl, f.canonicalPageUrl || f.pageUrl, f.issue, f.detail, f.source]; })
    );
  };

  byId("exportAllBtn").onclick = function () {
    var totalFindings = lowerFindings.length + imageFindings.length + spellFindings.length +
      wordFindings.length + linkFindings.length + mixedFindings.length + auditFindings.length +
      consoleFindings.length;

    if (!totalFindings) { alert("No results to export yet from any scan."); return; }

    downloadJson("site-scanner-all-results.json", {
      generatedAt: new Date().toISOString(),
      scans: {
        lowerEnvironmentLinks: { startUrl: byId("lowerStart").value, findings: lowerFindings },
        missingImages: { startUrl: byId("imageStart").value, findings: imageFindings },
        spellCheck: { startUrl: byId("spellStart").value, findings: spellFindings },
        wordSearch: { startUrl: byId("wordStart").value, terms: getWordTerms(), findings: wordFindings },
        brokenLinks: { startUrl: byId("linkStart").value, findings: linkFindings },
        mixedContent: { startUrl: byId("mixedStart").value, findings: mixedFindings },
        pageAudit: { startUrl: byId("auditStart").value, findings: auditFindings },
        consoleErrorCapture: { targetTab: consoleState.tabLabel, findings: consoleFindings }
      }
    });
  };

  byId("clearHistoryBtn").onclick = function () {
    var origin = getOriginFromStartField("lowerStart");
    if (!origin) { alert("Enter a valid Start URL on the Lower Env Links tab first."); return; }

    var scanTypes = ["lower", "image", "spell", "word", "link", "mixed", "audit"];
    var keysToRemove = scanTypes.map(function (type) { return historyStorageKey(type, origin); });

    try {
      chrome.storage.local.remove(keysToRemove, function () {
        alert("Cleared saved scan history for " + origin + ". The next run of each scan will treat all its findings as new.");
      });
    } catch (e) {
      alert("Could not clear history: " + (e && e.message ? e.message : e));
    }
  };

  byId("consoleRefreshTabsBtn").onclick = function () { refreshConsoleTabList(); };
  byId("consoleStartBtn").onclick = function () { runConsoleScan(); };
  byId("consoleStopBtn").onclick = function () { stopConsoleScan(); };

  byId("consoleClearBtn").onclick = function () {
    consoleFindings = [];
    consoleState.errorCount = 0;
    consoleState.warningCount = 0;
    consoleState.rejectionCount = 0;
    consoleState.findingLimitHit = false;
    lastConsoleFindingKey = null;
    lastConsoleRowEl = null;
    byId("consoleResults").innerHTML = "<div class='empty'>No events captured yet.</div>";
    byId("consoleLog").textContent = "";
    updateConsoleSummary();
  };

  byId("consoleExportBtn").onclick = function () {
    if (!consoleFindings.length) { alert("No captured console events to export."); return; }

    downloadCsv(
      "console-error-capture.csv",
      ["Time", "Type", "Message", "Repeat Count", "Page", "Recommendations", "Stack"],
      consoleFindings.map(function (f) {
        return [
          new Date(f.time).toISOString(),
          consoleEventTypeLabel(f.type),
          f.message,
          f.count || 1,
          f.pageUrl,
          f.recommendations.map(function (r) { return r.title; }).join("; "),
          f.stack
        ];
      })
    );
  };

  byId("presetSaveBtn").onclick = async function () {
    var origin = getOriginFromStartField("lowerStart");
    if (!origin) { alert("Enter a valid Start URL on the Lower Env Links tab first, so the preset can be scoped to an origin."); return; }

    var name = byId("presetName").value.trim();
    if (!name) { alert("Enter a name for this preset."); return; }

    var presets = await loadPresetsForOrigin(origin);
    presets[name] = collectPresetConfig();
    savePresetsForOrigin(origin, presets);
    await refreshPresetOptions();
    byId("presetSelect").value = name;
    alert("Saved preset \"" + name + "\" for " + origin + ".");
  };

  byId("presetLoadBtn").onclick = async function () {
    var origin = getOriginFromStartField("lowerStart");
    if (!origin) { alert("Enter a valid Start URL on the Lower Env Links tab first."); return; }

    var name = byId("presetSelect").value;
    if (!name) { alert("Select a saved preset to load."); return; }

    var presets = await loadPresetsForOrigin(origin);
    if (!presets[name]) { alert("That preset no longer exists."); return; }

    applyPresetConfig(presets[name]);
    alert("Loaded preset \"" + name + "\".");
  };

  byId("presetDeleteBtn").onclick = async function () {
    var origin = getOriginFromStartField("lowerStart");
    if (!origin) { alert("Enter a valid Start URL on the Lower Env Links tab first."); return; }

    var name = byId("presetSelect").value;
    if (!name) { alert("Select a saved preset to delete."); return; }

    var presets = await loadPresetsForOrigin(origin);
    delete presets[name];
    savePresetsForOrigin(origin, presets);
    await refreshPresetOptions();
  };

  byId("lowerStart").addEventListener("blur", function () { refreshPresetOptions(); });

  /* =========================
     Initial Values
     ========================= */

  byId("maxPages").value = String(DEFAULT_MAX_PAGES);
  byId("spellMaxFindings").value = String(SPELL_DEFAULT_MAX_FINDINGS);
  byId("wordMaxFindings").value = String(WORD_DEFAULT_MAX_FINDINGS);
  byId("consoleMaxFindings").value = String(CONSOLE_DEFAULT_MAX_FINDINGS);
  byId("consoleMaxPages").value = String(CONSOLE_SCAN_DEFAULT_MAX_PAGES);
  byId("consoleSecondsPerPage").value = String(CONSOLE_SCAN_DEFAULT_SECONDS_PER_PAGE);

  // background.js passes ?start=<origin> when this tab was opened from the
  // toolbar icon on an http(s) page, so the scanner defaults to that domain.
  // Still re-validated here (not just trusted from the caller) since this is
  // the same protocol check fetchHtmlPage() uses.
  setAllStartUrls(getInitialStartUrl());

  byId("lowerPatterns").value = defaultLowerPatterns.join("\n");
  byId("imageIgnorePatterns").value = defaultImageIgnorePatterns.join("\n");
  byId("spellIgnoreWords").value = defaultSpellIgnoreWords.join("\n");

  byId("lowerStatus").textContent = "Ready";
  byId("imageStatus").textContent = "Ready";
  byId("spellStatus").textContent = "Ready";
  byId("wordStatus").textContent = "Ready";
  byId("linkStatus").textContent = "Ready";
  byId("mixedStatus").textContent = "Ready";
  byId("auditStatus").textContent = "Ready";

  logTo(byId("lowerLog"), "Lower environment link scanner ready.");
  logTo(byId("imageLog"), "Missing image scanner ready. Redirected page URLs are skipped by default.");
  logTo(byId("spellLog"), "Spell checker ready.");
  logTo(byId("wordLog"), "Word search ready. Add one word or phrase per line.");
  logTo(byId("linkLog"), "Broken link scanner ready.");
  logTo(byId("mixedLog"), "Mixed content scanner ready.");
  logTo(byId("auditLog"), "Page audit ready.");

  byId("consoleStatus").textContent = "Ready";
  logTo(byId("consoleLog"), "Console scan ready. Pick a target tab and click Start console scan.");

  updateLowerSummary();
  updateImageSummary();
  updateSpellSummary();
  updateWordSummary();
  updateLinkSummary();
  updateMixedSummary();
  updateAuditSummary();
  updateConsoleSummary();
  updateGlobalSummary();

  refreshPresetOptions();
  refreshConsoleTabList(getInitialTabId());
})();
