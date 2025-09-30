chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "ENSURE_TOP_INJECT") {
    sendResponse?.({ ok: true });
    return true;
  }
});
