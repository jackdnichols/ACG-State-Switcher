// console-capture-relay.js — injected in the default isolated world (which
// has chrome.* API access, unlike console-capture-main.js's MAIN world).
// Just relays postMessage events from console-capture-main.js to the
// extension. chrome.runtime.onMessage on the receiving end automatically
// gets sender.tab.id, so no tab id needs to be included here.
//
// Always tears down and reattaches its listener on every injection rather
// than no-op'ing if one already exists. A tab left open across an
// extension reload/update keeps its old listener around, but that old
// listener's chrome.runtime is invalidated by the reload — sendMessage
// throws, gets silently swallowed by the catch below, and no events ever
// reach the extension again even though injection "succeeds" and the page
// is still emitting console output. Reinstalling fresh on every Start
// Capture click guarantees the listener is bound to a live context.
(function () {
  var NS = "__acgConsoleCaptureRelay";

  if (window[NS] && window[NS].listener) {
    window.removeEventListener("message", window[NS].listener);
  }

  function listener(event) {
    if (event.source !== window) return;

    var data = event.data;
    if (!data || data.source !== "acg-console-capture" || !data.payload) return;

    try {
      chrome.runtime.sendMessage({ type: "ACG_CONSOLE_CAPTURE_EVENT", payload: data.payload });
    } catch (e) { /* extension context invalidated (e.g. reloaded) — Start Capture again to reattach */ }
  }

  window.addEventListener("message", listener);
  window[NS] = { listener: listener };
})();
