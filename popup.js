document.getElementById('applyBtn').addEventListener('click', async () => {
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

  const message = document.createElement('div');
  message.textContent = `Changing State to ${state}...`;
  message.className = 'success-message';

  const existing = document.querySelector('.success-message');
  if (existing) existing.remove();

  document.body.appendChild(message);

  setTimeout(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.reload(tabs[0].id);
      }
    });
    window.close();
  }, 2000);
});

// Link navigation logic
document.getElementById('productionLink').addEventListener('click', () => {
  chrome.tabs.create({ url: "https://www.acg.aaa.com" });
});

document.getElementById('stage1Link').addEventListener('click', () => {
  chrome.tabs.create({ url: "https://www.stage1.acg.aaa.com" });
});

document.getElementById('qa1Link').addEventListener('click', () => {
  chrome.tabs.create({ url: "https://www.qa1.acg.aaa.com" });
});

document.getElementById('devLink').addEventListener('click', () => {
  chrome.tabs.create({ url: "https://www.dev.acg.aaa.com" });
});

// Author Link navigation logic
document.getElementById('productionAuthorLink').addEventListener('click', () => {
  chrome.tabs.create({ url: "https://author-p149839-e1583596.adobeaemcloud.com" });
});

document.getElementById('stage1AuthorLink').addEventListener('click', () => {
  chrome.tabs.create({ url: "https://author-p149839-e1583546.adobeaemcloud.com" });
});

document.getElementById('qa1AuthorLink').addEventListener('click', () => {
  chrome.tabs.create({ url: "https://author-p149839-e1583595.adobeaemcloud.com" });
});

document.getElementById('devAuthorLink').addEventListener('click', () => {
  chrome.tabs.create({ url: "https://author-p149839-e1544194.adobeaemcloud.com" });
});
