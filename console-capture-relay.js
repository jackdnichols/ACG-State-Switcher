// console-capture-relay.js — injected in the default isolated world (which
// has chrome.* API access, unlike console-capture-main.js's MAIN world).
// Just relays postMessage events from console-capture-main.js to the
// extension. chrome.runtime.onMessage on the receiving end automatically
// gets sender.tab.id, so no tab id needs to be included here.
(function () {
  var NS = "__acgConsoleCaptureRelay";
  if (window[NS]) return;
  window[NS] = true;

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;

    var data = event.data;
    if (!data || data.source !== "acg-console-capture" || !data.payload) return;

    try {
      chrome.runtime.sendMessage({ type: "ACG_CONSOLE_CAPTURE_EVENT", payload: data.payload });
    } catch (e) { /* extension context invalidated (e.g. reloaded) */ }
  });
})();
