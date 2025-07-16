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
  message.textContent = `Cookies for ${state} applied! Reloading the page...`;
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
  }, 1000);
});
