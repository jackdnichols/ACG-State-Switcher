// site-inspector.js — ported from the Tealium "Site QA Scanner" utility at
// ProjectsGit/ACG/Tealium/Site Scanner.js, which runs in production injected
// directly into the page. This file keeps the same matching/detection logic
// (lower-env link patterns, image candidate collection, spell dictionary,
// word search) but adapts the runtime for a standalone extension tab instead
// of a same-origin iframe injected by Tealium:
//   - Runs as its own top-level chrome-extension:// page, not an iframe.
//   - Every scanned URL is validated against a hard-coded host allowlist at
//     the single fetchHtmlPage() choke point, so no combination of settings
//     can make this fetch (or send credentials to) any other domain. The
//     original script has no such gate because Tealium's own publishing
//     targets controlled where it could load.
//   - fetchHtmlPage() uses credentials:"include" instead of "same-origin",
//     because a request from a chrome-extension:// page to these sites is
//     cross-site. Cookies marked SameSite=Lax/Strict on the target (the
//     default for most session cookies) still will not be attached — that's
//     a browser-level limit, not something this scanner can work around.
//   - The Tealium script's own ACG State/Region cookie switcher and
//     all-states walkthrough are intentionally NOT ported: this extension
//     already drives ACG state switching through state-keeper.js and
//     state-cookie-guard.js, which is a more robust mechanism (it drives the
//     real zip-lookup flow instead of just writing cookies).
(function () {
  "use strict";

  /* =========================
     Hard-coded scan allowlist
     ========================= */

  var ALLOWED_HOST_SUFFIXES = ["acg.aaa.com", "meemic.com", "meemicfoundation.org"];

  function isAllowedHost(hostname) {
    var h = String(hostname || "").toLowerCase();

    return ALLOWED_HOST_SUFFIXES.some(function (suffix) {
      return h === suffix || h.slice(-(suffix.length + 1)) === "." + suffix;
    });
  }

  function isAllowedUrl(url) {
    try {
      var u = new URL(url);
      return u.protocol === "https:" && isAllowedHost(u.hostname);
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
  var SPELL_TRACKING_PARAMS = {
    cid: true, cmpid: true, gclid: true, fbclid: true, msclkid: true,
    campaign: true, source: true, medium: true, term: true, content: true
  };

  var htmlPageCache = {};
  var htmlPageCacheCount = 0;

  var lowerState = createScanState("lower");
  var imageState = createScanState("image");
  var spellState = createScanState("spell");
  var wordState = createScanState("word");

  var lowerFindings = [];
  var lowerFindingKeys = {};

  var imageFindings = [];
  var imageFindingKeys = {};
  var checkedImageCache = {};

  var spellFindings = [];
  var spellFindingKeys = {};

  var wordFindings = [];
  var wordFindingKeys = {};

  var defaultLowerPatterns = [
    "://qa", "://uat", "://dev", "://test", "://stage", "://staging", "://preview",
    ".qa.", ".qa1.", ".qa2.", ".uat.", ".uat1.", ".uat2.", ".dev.", ".dev1.", ".dev2.",
    ".test.", ".stage.", ".staging.", ".preview.",
    "-qa", "-uat", "-dev", "-test", "-stage", "-staging", "-preview",
    "/qa/", "/qa1/", "/qa2/", "/uat/", "/uat1/", "/uat2/",
    "/dev/", "/dev1/", "/dev2/", "/test/", "/test1/", "/test2/",
    "/stage/", "/stage1/", "/stage2/", "/staging/", "/preview/",
    "dev.acg.aaa.com", "dev1.acg.aaa.com", "dev2.acg.aaa.com",
    "qa.acg.aaa.com", "qa1.acg.aaa.com", "qa2.acg.aaa.com",
    "uat.acg.aaa.com", "uat1.acg.aaa.com", "uat2.acg.aaa.com",
    "stage.acg.aaa.com", "stage1.acg.aaa.com", "stage2.acg.aaa.com",
    "staging.acg.aaa.com", "staging1.acg.aaa.com", "staging2.acg.aaa.com"
  ];

  var defaultImageIgnorePatterns = ["data:image/", "blob:", "about:blank"];

  var defaultSpellIgnoreWords = [
    "AAA", "ACG", "AEM", "Doc360", "Document360", "Tealium", "Roadside", "roadside",
    "AutoPay", "Auto Club", "Carfax", "CarPlay", "DriveScore", "Experian", "FICO",
    "TripTik", "AAA Travel", "AAA Drive", "AAA Dollars"
  ];

  var defaultSpellDictionaryText = "a aaa able about above accept accepted access accident account acg across act action active add\nadditional address adjust advantage advice aem after again against age agency agent ago agree ahead\naid air all allow almost along already also alternate always am amazing america american among\namount an and animal annual another answer any anyone anything app appear application apply\nappointment approved are area around arrive article as ask asked assist assistance associated at\nauto automotive autopay autosave available avoid award away baby back backdated bad bag balance\nbanking base based basic be beach because become been before begin beginning behind being believe\nbenefit benefits best better between big bike bill billing bit blog blogpost blogposts body book\nboth box brand breadcrumb breadcrumbs break bring browser build business but button buy by call\ncalled campaign can cancel car card care career carfax carry case cash cause center certain change\nchat chatbot check checked checker checkup child children choose city claim class clean clear click\nclickable close club code color come common company complete condition config connect contact\ncontent continue control copy cost could country course cover coverage crawl crawled create credit\ncrew css csv current customer customers damage dashboard data dataset datasets date day days deal\ndefault delivery description detail did different discount discounts do doc doc360 docs document\ndoes dog done door down download drive driver driving dropdown during each early easy edit education\neffect efficient effort either email emergency employee employer end engine enjoy enough enroll\nenrollment enter entire env environment error even event every everything example excellent except\nexchange expect experience expert explain export extra eye family faq faqs far fast favorite feature\nfee few field file filename filenames final find fintech first fix flag flow focus follow following\nfooter for form found free from front full future garage gas general get gift give go good great\ngroup guid guide had half hand handle happen hard has have he head health help helpful here high\nhome homepage host hotel hour hours how however href html icon idea if iframe image images img\nimportant improve in include included including income increase index information insurance insure\ninterest into issue it item its javascript job jpeg jpg json just keep key kind know knowledgecenter\nknown label language large last late later law learn least leave left less let level license life\nlight like limit line link links list live load local localhost location log login logout long look\nlower made mail make manage many map market may maybe me mean medical membership menu message meta\nmetadata microcopy middleware mile miles missing mobile money month monthly more most move much must\nmy name nav navbar near need needs never new next no none not note now number offer office often og\non once online only open option order other our out over own page pages paid panel park part parts\npass pattern payment pdf people perfect personal phone plan please plus png point policy popup\npossible post power prefer preflight prepaid preview price primary problem process prod product\nproduction products program project protect provide public qa quality query question quick quote\nrate razor ready real reason recaptcha receive record redirect reference refund regex regexp\nregister related renewal repair report request require required resize resource responsive result\nreturn right road roadside role route row run runtime safe safety same save scan scanned scanner\nschool search second section see select selected seo service services set several share should show\nsignup simple since site sitemap small snow so some someone source special speed spell spelling src\nsrcset staging start starter state stay still stop store street strong submenu submit success\nsupport sure svg system tab table take tax tealium team test text textarea than that the their them\nthen there these they thing things think this through ticket time title to today tool tools tooltip\ntop total tour tow towing travel trip truck true try turn type unable under update url urls use used\nuser username using value vehicle vehicles view visit want warranty was way we web webinar webp\nwebsite week well were what when where whether which while who why will with within without word\nwords work working works would year years yes you your zero zip zipcode zone";

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
      pagesScanned: 0, queued: 0, checked: 0, findings: 0,
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
    setText("wordSumSkipped", wordState.skipped);
    setText("wordSumErrors", wordState.errors);
    updateGlobalSummary();
  }

  function tickSummaries() {
    if (lowerState.running) updateLowerSummary();
    if (imageState.running) updateImageSummary();
    if (spellState.running) updateSpellSummary();
    if (wordState.running) updateWordSummary();
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

  function setActiveTab(tabName) {
    ["lower", "images", "spell", "word"].forEach(function (name) {
      var btnId = "tab" + name.charAt(0).toUpperCase() + name.slice(1) + "Btn";
      var panelId = (name === "images" ? "images" : name) + "Panel";
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

  function setAllStartUrls(url) {
    byId("lowerStart").value = url;
    byId("imageStart").value = url;
    byId("spellStart").value = url;
    byId("wordStart").value = url;
  }

  function getInitialStartUrl() {
    try {
      var requested = new URLSearchParams(window.location.search).get("start");
      if (requested && isAllowedUrl(requested)) return requested;
    } catch (e) { /* fall through to default */ }

    return "https://www.acg.aaa.com/";
  }

  /*
    fetchHtmlPage
    -------------
    The single choke point every scanner routes through. Every URL is checked
    against the hard-coded allowlist here, in addition to whatever filtering
    happens upstream (start URL validation, same-origin crawl filters) — so a
    bug in any one scanner's filtering can't turn into an off-allowlist fetch.
    credentials:"include" is used instead of "same-origin" because this page
    is chrome-extension://..., so any request to these sites is cross-site;
    SameSite=Lax/Strict cookies on the target still won't be attached, which
    is a browser policy this scanner cannot and should not try to bypass.
  */
  function fetchHtmlPage(url) {
    if (htmlPageCache[url]) return htmlPageCache[url];

    if (!isAllowedUrl(url)) {
      htmlPageCache[url] = Promise.resolve({
        ok: false, status: 0, contentType: "", text: "",
        reason: "Blocked: host is not on the scan allowlist",
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

      if (finalUrl !== url && !isAllowedUrl(finalUrl)) {
        return {
          ok: false, status: res.status, contentType: contentType, text: "",
          reason: "Blocked: redirected off the scan allowlist",
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
    var key = link + "|" + page + "|" + pattern;
    if (lowerFindingKeys[key]) return;
    lowerFindingKeys[key] = true;

    lowerFindings.push({ link: link, page: page, pattern: pattern });
    lowerState.findings = lowerFindings.length;
    updateLowerSummary();

    var resultsEl = byId("lowerResults");
    if (resultsEl.querySelector(".empty")) resultsEl.innerHTML = "";

    var row = document.createElement("div");
    row.className = "result";

    var linkEl = document.createElement("div");
    linkEl.className = "bad";
    linkEl.textContent = link;

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

    if (!isAllowedUrl(startUrl.href)) {
      alert("Start URL must be on acg.aaa.com, meemic.com, or meemicfoundation.org.");
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
      var firstUrl = normalize(startUrl.href, startUrl.href);
      var queue = [firstUrl];
      var visited = {};
      var queued = {};
      queued[firstUrl] = true;

      logTo(logEl, "Starting lower environment link scan...");
      logTo(logEl, "Crawling origin only: " + origin);
      logTo(logEl, "Max pages: " + maxPages);

      while (queue.length && !lowerState.stop) {
        var url = queue.shift();
        if (!url || visited[url]) continue;

        visited[url] = true;
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
            if (isSameOrigin(link, origin) && isAllowedUrl(link) && isLikelyHtmlPage(link) && !visited[link] && !queued[link]) {
              queue.push(link);
              queued[link] = true;
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
      logTo(logEl, "Done. Matches: " + lowerFindings.length);
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
    var key = imageUrl + "|" + pageUrl + "|" + source + "|" + reason;
    if (imageFindingKeys[key]) return;
    imageFindingKeys[key] = true;

    imageFindings.push({ imageUrl: imageUrl, pageUrl: pageUrl, source: source, reason: reason });
    imageState.findings = imageFindings.length;
    updateImageSummary();

    var resultsEl = byId("imageResults");
    if (resultsEl.querySelector(".empty")) resultsEl.innerHTML = "";

    var row = document.createElement("div");
    row.className = "result";

    var imageEl = document.createElement("div");
    imageEl.className = "bad";
    imageEl.textContent = imageUrl || "(empty image URL)";

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

    if (!isAllowedUrl(startUrl.href)) {
      alert("Start URL must be on acg.aaa.com, meemic.com, or meemicfoundation.org.");
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
      var firstUrl = normalize(startUrl.href, startUrl.href);
      var queue = [firstUrl];
      var visited = {};
      var queued = {};
      queued[firstUrl] = true;

      logTo(logEl, "Starting missing image scan...");
      logTo(logEl, "Crawling origin only: " + origin);
      logTo(logEl, "Max pages: " + maxPages);

      while (queue.length && !imageState.stop) {
        var url = queue.shift();
        if (!url || visited[url]) continue;

        visited[url] = true;
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

            if (isSameOrigin(effectivePageUrl, origin) && isAllowedUrl(effectivePageUrl) && isLikelyHtmlPage(effectivePageUrl) && !visited[effectivePageUrl] && !queued[effectivePageUrl]) {
              queue.push(effectivePageUrl);
              queued[effectivePageUrl] = true;
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
              if (isSameOrigin(link, origin) && isAllowedUrl(link) && isLikelyHtmlPage(link) && !visited[link] && !queued[link]) {
                queue.push(link);
                queued[link] = true;
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
      logTo(logEl, "Done. Missing images: " + imageFindings.length);
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

  function canonicalizeSpellPageUrl(pageUrl) {
    try {
      var url = new URL(pageUrl);
      url.hash = "";

      Array.prototype.slice.call(url.searchParams.keys()).forEach(function (key) {
        var lowerKey = key.toLowerCase();
        if (lowerKey.indexOf("utm_") === 0 || SPELL_TRACKING_PARAMS[lowerKey]) {
          url.searchParams.delete(key);
        }
      });

      return url.href;
    } catch (e) {
      return pageUrl;
    }
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
    var canonicalPageUrl = canonicalizeSpellPageUrl(pageUrl);
    var confidence = reason === "Known typo" ? "High" : "Review";
    var key = word.toLowerCase() + "|" + canonicalPageUrl + "|" + source + "|" + reason;

    if (spellFindingKeys[key]) return;
    spellFindingKeys[key] = true;

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

    if (!isAllowedUrl(startUrl.href)) {
      alert("Start URL must be on acg.aaa.com, meemic.com, or meemicfoundation.org.");
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
      var firstUrl = normalize(startUrl.href, startUrl.href);
      var queue = [firstUrl];
      var visited = {};
      var queued = {};
      queued[canonicalizeSpellPageUrl(firstUrl)] = true;

      logTo(logEl, "Starting spell check scan...");
      logTo(logEl, "Crawling origin only: " + origin);
      logTo(logEl, "Max pages: " + maxPages);
      logTo(logEl, "Mode: " + (options.flagUnknown ? "known typos + unknown-word review" : "known typos only"));
      logTo(logEl, "Data/blob filter: " + (options.skipDataText ? "on" : "off"));
      logTo(logEl, "Max spell findings: " + options.maxFindings);

      while (queue.length && !spellState.stop) {
        var url = queue.shift();
        var spellUrlKey = canonicalizeSpellPageUrl(url);
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
            var linkKey = canonicalizeSpellPageUrl(link);
            if (isSameOrigin(link, origin) && isAllowedUrl(link) && isLikelyHtmlPage(link) && !visited[linkKey] && !queued[linkKey]) {
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

      logTo(logEl, "Done. Spell findings: " + spellFindings.length);
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
    var canonicalPageUrl = canonicalizeSpellPageUrl(pageUrl);
    var key = term.toLowerCase() + "|" + matchText.toLowerCase() + "|" + canonicalPageUrl + "|" + source + "|" + context;

    if (wordFindingKeys[key]) return;
    wordFindingKeys[key] = true;

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

    if (!isAllowedUrl(startUrl.href)) {
      alert("Start URL must be on acg.aaa.com, meemic.com, or meemicfoundation.org.");
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
      var firstUrl = normalize(startUrl.href, startUrl.href);
      var queue = [firstUrl];
      var visited = {};
      var queued = {};
      queued[canonicalizeSpellPageUrl(firstUrl)] = true;

      logTo(byId("wordLog"), "Starting word search scan...");
      logTo(byId("wordLog"), "Crawling origin only: " + origin);
      logTo(byId("wordLog"), "Max pages: " + maxPages);
      logTo(byId("wordLog"), "Terms: " + terms.join(", "));

      while (queue.length && !wordState.stop) {
        var url = queue.shift();
        var urlKey = canonicalizeSpellPageUrl(url);
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
            var linkKey = canonicalizeSpellPageUrl(link);
            if (isSameOrigin(link, origin) && isAllowedUrl(link) && isLikelyHtmlPage(link) && !visited[linkKey] && !queued[linkKey]) {
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
      logTo(byId("wordLog"), "Done. Word search matches: " + wordFindings.length);
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
     Button Wiring
     ========================= */

  byId("tabLowerBtn").onclick = function () { setActiveTab("lower"); };
  byId("tabImagesBtn").onclick = function () { setActiveTab("images"); };
  byId("tabSpellBtn").onclick = function () { setActiveTab("spell"); };
  byId("tabWordBtn").onclick = function () { setActiveTab("word"); };

  byId("domainAcgBtn").onclick = function () { setAllStartUrls("https://www.acg.aaa.com/"); };
  byId("domainMeemicBtn").onclick = function () { setAllStartUrls("https://www.meemic.com/"); };
  byId("domainFoundationBtn").onclick = function () { setAllStartUrls("https://www.meemicfoundation.org/"); };

  byId("lowerScanBtn").onclick = function () { runLowerEnvironmentScan(); };
  byId("imageScanBtn").onclick = function () { runMissingImageScan(); };
  byId("spellScanBtn").onclick = function () { runSpellCheckScan(); };
  byId("wordScanBtn").onclick = function () { runWordSearchScan(); };

  byId("runBothBtn").onclick = function () {
    var started = [];
    var nothingElseToStart = lowerState.running && imageState.running && spellState.running;

    if (!lowerState.running) { runLowerEnvironmentScan(); started.push("links"); }
    if (!imageState.running) { runMissingImageScan(); started.push("images"); }
    if (!spellState.running) { runSpellCheckScan(); started.push("spell check"); }

    // Word Search has no default term list (unlike the other three, which ship
    // with default patterns/dictionaries), so "Run all" only starts it when the
    // tester has actually entered terms. Calling it unconditionally would hit
    // its "enter at least one term" alert(), which blocks the JS event loop and
    // stalls the scans just started above until the dialog is dismissed.
    if (!wordState.running && getWordTerms().length) {
      runWordSearchScan();
      started.push("word search");
    } else if (!wordState.running) {
      byId("wordStatus").textContent = "Skipped by Run All: no search terms entered.";
      nothingElseToStart = false;
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

    if (!stoppedAny) alert("No scans are currently running.");

    updateLowerSummary();
    updateImageSummary();
    updateSpellSummary();
    updateWordSummary();
    updateGlobalSummary();
  };

  byId("lowerExportBtn").onclick = function () {
    if (!lowerFindings.length) { alert("No lower environment link results to export."); return; }

    downloadCsv(
      "lower-environment-link-scan.csv",
      ["Lower Environment Link", "Found On Page", "Matched Pattern"],
      lowerFindings.map(function (f) { return [f.link, f.page, f.pattern]; })
    );
  };

  byId("imageExportBtn").onclick = function () {
    if (!imageFindings.length) { alert("No missing image results to export."); return; }

    downloadCsv(
      "missing-image-scan.csv",
      ["Missing Image URL", "Found On Page", "Source", "Reason"],
      imageFindings.map(function (f) { return [f.imageUrl, f.pageUrl, f.source, f.reason]; })
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

  /* =========================
     Initial Values
     ========================= */

  byId("maxPages").value = String(DEFAULT_MAX_PAGES);
  byId("spellMaxFindings").value = String(SPELL_DEFAULT_MAX_FINDINGS);
  byId("wordMaxFindings").value = String(WORD_DEFAULT_MAX_FINDINGS);

  // popup.js passes ?start=<origin> when this tab was opened from an allowed
  // page, so the scanner defaults to that domain instead of always
  // acg.aaa.com. Still re-validated here (not just trusted from the caller)
  // since this is the same allowlist choke point fetchHtmlPage() uses.
  setAllStartUrls(getInitialStartUrl());

  byId("lowerPatterns").value = defaultLowerPatterns.join("\n");
  byId("imageIgnorePatterns").value = defaultImageIgnorePatterns.join("\n");
  byId("spellIgnoreWords").value = defaultSpellIgnoreWords.join("\n");

  byId("lowerStatus").textContent = "Ready";
  byId("imageStatus").textContent = "Ready";
  byId("spellStatus").textContent = "Ready";
  byId("wordStatus").textContent = "Ready";

  logTo(byId("lowerLog"), "Lower environment link scanner ready.");
  logTo(byId("imageLog"), "Missing image scanner ready. Redirected page URLs are skipped by default.");
  logTo(byId("spellLog"), "Spell checker ready.");
  logTo(byId("wordLog"), "Word search ready. Add one word or phrase per line.");

  updateLowerSummary();
  updateImageSummary();
  updateSpellSummary();
  updateWordSummary();
  updateGlobalSummary();
})();
