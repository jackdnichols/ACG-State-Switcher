// ===============================
// State Cookie Logic (unchanged)
// ===============================
document.getElementById('applyBtn')?.addEventListener('click', async () => {
  const state = document.getElementById('stateSelect').value;
  const url = chrome.runtime.getURL(`cookies/${state}.json`);
  const response = await fetch(url);
  const cookies = await response.json();

  for (const cookie of cookies) {
    chrome.cookies.set({
      url: "https://acg.aaa.com",
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: cookie.expirationDate
    });
  }

  const existing = document.querySelector('.success-message');
  if (existing) existing.remove();

  const message = document.createElement('div');
  message.textContent = `Changing State to ${state}...`;
  message.className = 'success-message';
  document.body.appendChild(message);

  setTimeout(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.reload(tabs[0].id);
    });
    window.close();
  }, 2000);
});


// =======================================
// Environment + Websites + Author (AEM)
// =======================================
const ENV_KEY = 'selectedEnv';
let currentEnv = null; // Must be explicitly selected or restored

// Pretty labels for headings
function prettyEnvLabel(envKey) {
  switch ((envKey || '').toLowerCase()) {
    case 'production': return 'Production';
    case 'stage1':     return 'Stage 1';
    case 'qa1':        return 'QA 1';
    case 'dev1':       return 'Dev 1';
    default:           return '';
  }
}

// Websites URL map (by company -> env)
const urls = {
  acg: {
    production: "https://www.acg.aaa.com",
    stage1:     "https://www.stage1.acg.aaa.com",
    qa1:        "https://www.qa1.acg.aaa.com",
    dev1:       "https://www.dev1.acg.aaa.com"
  },
  meemic: {
    production: "https://www.meemic.com",
    stage1:     "https://stage1.meemic.com",
    qa1:        "https://qa1.meemic.com",
    dev1:       "https://dev.meemic.com" // dev (not dev1)
  },
  meemicfoundation: {
    production: "https://www.meemicfoundation.org",
    stage1:     "https://stage1.meemicfoundation.org",
    qa1:        "https://qa1.meemicfoundation.org",
    dev1:       "https://dev1.meemicfoundation.org"
  }
};

// Author (AEM) follows selected env
const authorUrls = {
  production: "https://author-p149839-e1583596.adobeaemcloud.com",
  stage1:     "https://author-p149839-e1583546.adobeaemcloud.com",
  qa1:        "https://author-p149839-e1583595.adobeaemcloud.com",
  dev1:       "https://author-p149839-e1544194.adobeaemcloud.com"
};

// ---------- helpers ----------
function setDisabled(a, disabled) {
  a.classList.toggle('disabled', disabled);
  if (disabled) {
    a.setAttribute('aria-disabled', 'true');
    a.setAttribute('tabindex', '-1');
  } else {
    a.removeAttribute('aria-disabled');
    a.removeAttribute('tabindex');
  }
}

function enableWebsitesAndAemLinks() {
  const enabled = !!currentEnv;
  document.querySelectorAll('[data-company]').forEach(a => setDisabled(a, !enabled));
  const authorLink = document.getElementById('authorLink');
  if (authorLink) setDisabled(authorLink, !enabled);

  const hint = document.getElementById('envHint');
  if (hint) hint.style.display = enabled ? 'none' : 'block';
}

function setActiveEnvLink(env) {
  document.querySelectorAll('[data-env]').forEach(a => {
    const isActive = a.getAttribute('data-env') === env;
    a.classList.toggle('active', isActive);
    if (isActive) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
}

function updateHeadings() {
  const websitesHeading = document.getElementById('websitesHeading');
  const authorHeading   = document.getElementById('authorHeading');
  const label = prettyEnvLabel(currentEnv);

  if (!websitesHeading || !authorHeading) {
    console.warn('Heading elements not found. Ensure IDs: websitesHeading, authorHeading exist in popup.html');
    return;
  }

  websitesHeading.textContent = currentEnv ? `Websites (${label})` : 'Websites';
  authorHeading.textContent   = currentEnv ? `Author (AEM) (${label})` : 'Author (AEM)';

  // Debug
  // console.log('updateHeadings -> currentEnv:', currentEnv, 'label:', label);
}

// ---------- wireups ----------
function wireEnvironmentLinks() {
  document.querySelectorAll('[data-env]').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      currentEnv = link.getAttribute('data-env');
      // Debug
      // console.log('Env selected:', currentEnv);

      setActiveEnvLink(currentEnv);
      enableWebsitesAndAemLinks();
      updateHeadings();
      try { await chrome.storage.sync.set({ [ENV_KEY]: currentEnv }); } catch {}
    });
  });
}

function wireWebsiteLinks() {
  document.querySelectorAll('[data-company]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (!currentEnv) return; // guard until env picked
      const company = link.getAttribute('data-company');
      const targetUrl = urls?.[company]?.[currentEnv];
      if (targetUrl) chrome.tabs.create({ url: targetUrl });
    });
  });
}

function wireAuthorLink() {
  const link = document.getElementById('authorLink');
  if (!link) return;
  link.addEventListener('click', (e) => {
    e.preventDefault();
    if (!currentEnv) return; // guard until env picked
    const targetUrl = authorUrls[currentEnv];
    if (targetUrl) chrome.tabs.create({ url: targetUrl });
  });
}

// ---------- init ----------
(async function init() {
  // Try to restore last env; otherwise keep links disabled
  try {
    const stored = await chrome.storage.sync.get(ENV_KEY);
    currentEnv = stored?.[ENV_KEY] || null;
  } catch {
    currentEnv = null;
  }

  if (currentEnv) setActiveEnvLink(currentEnv);
  enableWebsitesAndAemLinks();
  updateHeadings();

  wireEnvironmentLinks();
  wireWebsiteLinks();
  wireAuthorLink();
})();
