// cookie-utils.js — small helpers shared between background.js (service worker,
// loaded via importScripts) and popup.js (loaded via a <script> tag in
// popup.html). Keeping this in one file means a future domain change only
// needs to happen once instead of being kept in sync by hand across both.

// For .aaa.com cookies, use an ACG subdomain we have host permission for.
// Chrome only needs the URL to domain-match the cookie being removed.
function cookieRemovalUrl(cookie) {
  const cookieDomain = String(cookie?.domain || "www.acg.aaa.com").replace(/^\./, "").toLowerCase();
  const path = (cookie?.path && String(cookie.path)) || "/";
  const host = (cookieDomain === "aaa.com" || cookieDomain === "acg.aaa.com")
    ? "www.acg.aaa.com"
    : cookieDomain;

  return `https://${host}${path.startsWith("/") ? path : `/${path}`}`;
}
