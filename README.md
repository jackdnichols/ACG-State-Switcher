# ACG Utilities State Switcher v1.100

Developer utility for ACG/AAA web testing.

## What it does

- Switches ACG regional state behavior by launching ACG's current zip-only lookup flow.
- Opens quick links for ACG, Meemic, Meemic Foundation, and AEM Author environments.
- Generates local, template-based Adobe Target/A/B test ideas from the active tab, with auto-detected page type and priority ranking.
- Shows an optional environment badge on AEM Authoring pages (the AEM Author hosts listed under Store review notes below) so it's obvious at a glance which author environment a tab is on.
- Site Scanner: point it at any http(s) site (not just ACG/Meemic) to run lower-environment link leak, broken link, missing image, mixed content, spelling/typo, basic SEO/accessibility page audit, and free-text word search scans, plus live Console Error Capture — attach to an open tab and get pattern-matched fix recommendations for uncaught exceptions, unhandled promise rejections, and console.error/console.warn calls as they happen. Opens as its own tab so long scans survive the popup closing. Crawl-based scans run as an extension page rather than injected into the target site, so they don't carry the target site's SameSite=Lax/Strict session cookies (a browser-level restriction, not a setting) — those scans see what a logged-out visitor sees. Console Error Capture is different: it injects directly into the tab you point it at, so it sees that tab's real console output.

## Privacy

The extension runs locally in the browser. It does not send browsing data, cookies, page content, custom ideas, or selected states to any external server. It stores only local preferences such as selected tab, theme, badge settings, custom A/B ideas, and the temporary selected ACG state/ZIP override used during switching.

## Store review notes

- Manifest V3.
- No remotely hosted code — everything ships in the submitted package.
- No `eval`/`new Function` anywhere in the codebase (verified 2026-08-14 against all shipped `.js` files).
- Every `innerHTML` write in the codebase uses a static/hardcoded string (empty-state placeholders, clearing content); any data captured from a page (console messages, page titles, scan findings) is inserted via `textContent`, never `innerHTML` (verified 2026-08-14) — no injection risk from scanned/captured content.
- No captured cookie bundles are packaged.
- Host access: AAA/ACG/Meemic/Meemic Foundation pages for the state switcher, the specific AEM Author hosts for the author badge, and all http(s) origins (`http://*/*`, `https://*/*`) for Site Scanner, which is intentionally not scoped to any allowlist so it can be pointed at any site. The state switcher and author badge only ever act on their own scoped hosts regardless of this broader grant; Site Scanner is the only feature that uses it.
- Console Error Capture only attaches to a tab the user explicitly picks and only while a scan is actively running; it does not run automatically on every page. See `privacy.html` for the full breakdown of what it reads and when.
- `privacy.html` is kept current with what the extension actually does — last synced with the codebase 2026-08-14 (covers Site Scanner's any-site scope and Console Error Capture in full, not just the original ACG-scoped Site Inspector).

### Permission justifications (for the store dashboard's Privacy Practices / permissions-justification fields)

- `storage` — local preferences, scan presets/history, badge settings. Never transmitted.
- `scripting` — inject the state-switcher's page helpers on AEM Author/ACG pages, and Site Scanner's crawl/console-capture logic on pages the user explicitly scans.
- `activeTab` — read the active tab's URL to prefill Site Scanner's Start URL and the A/B idea generator's page-type detection.
- `cookies` — read/write only the specific ACG state/ZIP cookies needed for the state-switching feature.
- `host_permissions` (all http/https) — required for Site Scanner and Console Error Capture to work on any site the user points them at, not just ACG/Meemic. Every other feature stays scoped to its own fixed host list regardless of this grant.

### Publishing (not code — needs a developer account and dashboard access)

This extension is intended for **private/unlisted distribution to this org only**, not a public store listing. The following steps happen in the Chrome Web Store Developer Dashboard and Microsoft Edge Partner Center, not in this repo, and need whoever holds those developer accounts:

1. Zip the extension folder (excluding `.git`, `.claude`, and this README) and upload it as a new item in each dashboard.
2. Set visibility to **Private** (Chrome: restricted to specific Google accounts or a Google Workspace domain; Edge: restricted within your Partner Center tenant) — not Public.
3. Privacy policy URL (paste this into each dashboard's privacy policy field): **https://jackdnichols.github.io/ACG-State-Switcher/privacy.html** — hosted via GitHub Pages from `docs/privacy.html` on this repo's `main` branch. Note: this repo was made **public** to enable GitHub Pages (Pages isn't available on private repos without a GitHub Enterprise plan) — `docs/privacy.html` is the only thing published by Pages, but the repo's full source (including internal AAA/ACG/Meemic host references) is now visible to anyone on github.com. Keep `docs/privacy.html` in sync with `privacy.html` at the repo root if either changes.
4. Fill in the store listing fields: category, short/long description (the manifest `description` above is already trimmed to Chrome's 132-character limit), and screenshots/promotional images (1280x800 or 640x400 for Chrome; similar for Edge) — these need to be captured from the running extension, which needs a real browser session.
5. Submit for review under the account's developer registration (Chrome has a one-time $5 registration fee per developer account if not already registered).

Not affiliated with AAA or its subsidiaries unless submitted by an authorized publisher.


## v1.100
- Fixed Word Search / Spell Check silently missing text inside `<form>` elements (e.g. a reCAPTCHA's "Enter Security Code" legend) — `removeSpellNoise()` was dropping the entire form instead of just its interactive controls. Forms are now scanned like any other content; `input`/`button`/`select`/`option`/`textarea` are still excluded so control values/placeholders don't leak into results.
- Added an opt-in "Include button label text" checkbox to both Word Search and Spell Check (off by default, to avoid noisy "Submit"/"Search"-style matches) for the cases where button copy itself needs to be scanned.

## v1.99
- Merged in the standalone Site-Scanner project's scanning engine, replacing the old domain-scoped Site Inspector: same lower-env/image/spell/word scanners as before, plus Broken Links, Mixed Content, and Page Audit, scan history, sitemap seeding, and presets — and no longer limited to acg.aaa.com/meemic.com/meemicfoundation.org.
- Fixed a dedup bug carried over from Site-Scanner: query-param variants of the same page (tracking params like `utm_source`, `gclid`, etc.) were being crawled and reported as separate pages in 5 of the 7 scanners. All 7 now canonicalize page identity the same way (already proven in the Spell Check/Word Search scanners) before keying crawl dedup and findings.
- Added Console Error Capture: live JS error/warning capture on a tab of your choosing, with pattern-matched fix recommendations (load-order issues, null/undefined access, CORS, CSP, unhandled rejections, Tealium/jQuery-specific hints, and more).
- During testing on a live acg.aaa.com tab, fixed Console Error Capture going silent after an extension reload (stale listener bound to an invalidated context), fixed unbounded flooding from a repeating console message, and armed capture to reattach automatically at page-load time on reload so page-init/tag-manager errors (confirmed with a real Invoca tag warning) get caught, not just ones that happen after you've already attached.
- Also confirmed against acg.aaa.com: all 7 crawl-based scanners (Lower Env Links, Broken Links, Missing Images, Mixed Content, Spell Check, Page Audit, Word Search) run via "Run all" and complete as expected. Console Error Capture is live from Start Capture onward (no reload needed to catch new errors as they happen) — reload is only needed to additionally catch page-init-time errors that already fired before capture attached.
- Prepped for private store submission (Chrome Web Store / Edge Add-ons): fixed `manifest.json`'s `description` regressing past the 132-character limit during the Site Scanner merge, rewrote `privacy.html` (was still describing the old ACG-only-scoped Site Inspector, didn't mention Console Error Capture at all), and expanded the Store review notes below into a permission-justification writeup and a publishing checklist for whoever holds the developer accounts.
- Made this repo public and enabled GitHub Pages (serving only `docs/privacy.html`, not the repo root) to get a real hosted URL for the privacy policy field in the store dashboards, since GitHub Pages isn't available on private repos without a paid plan: https://jackdnichols.github.io/ACG-State-Switcher/privacy.html

## v1.98
- Rewrote Site Inspector's scanning logic as a direct port of the proven Tealium Site QA Scanner (`ACG/Tealium/Site Scanner.js`) instead of the ad hoc scanner it shipped with in v1.95/v1.96: real lower-environment pattern matching, image candidate collection (including srcset/lazy attrs/meta/CSS backgrounds), the real spell dictionary and misspelling list, and a new Word Search tool. The Tealium script's own ACG state/region cookie switcher was intentionally left out — it would duplicate and conflict with this extension's own state-keeper.js/state-cookie-guard.js mechanism, which is more robust (drives the real zip-lookup flow instead of just writing cookies).

## v1.96
- Popup header now shows the running extension version (read from the manifest), so it can't drift out of sync with the packaged version again.

## v1.95
- Added Site Inspector: a broken-link/broken-image/env-leak scanner scoped to acg.aaa.com, meemic.com, and meemicfoundation.org, opened from the popup's Links tab as its own extension tab.

## v1.94
- Reduced Chrome flashing by no longer clearing AEM.state/zipcode from the content script on every ACG page load. The popup still clears stale cookies once before starting the official ZIP flow.
