// console-capture-main.js — injected with world:"MAIN" into the tab being
// captured, so it sees the page's own console/window, not the isolated
// content-script world. Has no chrome.* API access from here, so it hands
// events off via postMessage to console-capture-relay.js (isolated world),
// which forwards them to the extension over chrome.runtime.sendMessage.
(function () {
  var NS = "__acgConsoleCapture";

  // Always tear down and reinstall fresh, rather than no-op'ing when a
  // hook already exists — keeps this consistent with console-capture-
  // relay.js's same always-reattach approach, and guarantees a Start
  // Capture click can't inherit a stale console.error/console.warn
  // reference from an earlier injection.
  if (window[NS] && window[NS].stop) window[NS].stop();

  var originalError = console.error;
  var originalWarn = console.warn;

  function stringifyArg(arg) {
    if (arg instanceof Error) return arg.stack || (arg.name + ": " + arg.message);
    if (typeof arg === "string") return arg;
    try { return JSON.stringify(arg); } catch (e) { return String(arg); }
  }

  function emit(type, message, stack) {
    try {
      window.postMessage({
        source: "acg-console-capture",
        payload: {
          type: type,
          message: message,
          stack: stack || null,
          url: location.href,
          time: Date.now()
        }
      }, "*");
    } catch (e) { /* page may be mid-teardown */ }
  }

  console.error = function () {
    emit("console.error", Array.prototype.slice.call(arguments).map(stringifyArg).join(" "));
    return originalError.apply(console, arguments);
  };

  console.warn = function () {
    emit("console.warn", Array.prototype.slice.call(arguments).map(stringifyArg).join(" "));
    return originalWarn.apply(console, arguments);
  };

  function errorListener(event) {
    var location_ = event.filename ? " (" + event.filename + ":" + event.lineno + ":" + event.colno + ")" : "";
    emit("uncaught-exception", String(event.message) + location_, event.error && event.error.stack);
  }

  function rejectionListener(event) {
    var reason = event.reason;
    var message = (reason && reason.message) ? reason.message : String(reason);
    emit("unhandled-rejection", message, reason && reason.stack);
  }

  window.addEventListener("error", errorListener);
  window.addEventListener("unhandledrejection", rejectionListener);

  window[NS] = {
    active: true,
    stop: function () {
      console.error = originalError;
      console.warn = originalWarn;
      window.removeEventListener("error", errorListener);
      window.removeEventListener("unhandledrejection", rejectionListener);
      window[NS].active = false;
    }
  };
})();
