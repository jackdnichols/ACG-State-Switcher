# ACG Utilities State Switcher v1.98

Developer utility for ACG/AAA web testing.

## What it does

- Switches ACG regional state behavior by launching ACG's current zip-only lookup flow.
- Opens quick links for ACG, Meemic, Meemic Foundation, and AEM Author environments.
- Generates local, template-based Adobe Target/A/B test ideas from the active tab, with auto-detected page type and priority ranking.
- Shows an optional AEM Author environment badge.
- Site Inspector: four scanners ported from the Tealium Site QA Scanner utility (lower-environment link leaks, missing images, spelling/typos, and free-text word search). Hard-scoped in code to acg.aaa.com, meemic.com, and meemicfoundation.org (and their subdomains) — no setting can make it fetch or send credentials to any other domain. Opens as its own tab so long scans survive the popup closing. Because it runs as an extension page rather than injected into the target site, it does not carry the target site's SameSite=Lax/Strict session cookies (a browser-level restriction, not a setting) — scans see what a logged-out visitor sees.

## Privacy

The extension runs locally in the browser. It does not send browsing data, cookies, page content, custom ideas, or selected states to any external server. It stores only local preferences such as selected tab, theme, badge settings, custom A/B ideas, and the temporary selected ACG state/ZIP override used during switching.

## Store review notes

- Manifest V3.
- No remotely hosted code.
- No eval/new Function.
- No captured cookie bundles are packaged.
- Host access is limited to AAA/ACG/Meemic/Meemic Foundation pages needed for the state switcher and Site Inspector, and the specific AEM Author hosts needed for the author badge.
- Site Inspector's domain allowlist (acg.aaa.com, meemic.com, meemicfoundation.org) is enforced in site-inspector.js itself, not just the UI, so it cannot fetch or send credentials to any other domain regardless of user settings.

Not affiliated with AAA or its subsidiaries unless submitted by an authorized publisher.


## v1.98
- Rewrote Site Inspector's scanning logic as a direct port of the proven Tealium Site QA Scanner (`ACG/Tealium/Site Scanner.js`) instead of the ad hoc scanner it shipped with in v1.95/v1.96: real lower-environment pattern matching, image candidate collection (including srcset/lazy attrs/meta/CSS backgrounds), the real spell dictionary and misspelling list, and a new Word Search tool. The Tealium script's own ACG state/region cookie switcher was intentionally left out — it would duplicate and conflict with this extension's own state-keeper.js/state-cookie-guard.js mechanism, which is more robust (drives the real zip-lookup flow instead of just writing cookies).

## v1.96
- Popup header now shows the running extension version (read from the manifest), so it can't drift out of sync with the packaged version again.

## v1.95
- Added Site Inspector: a broken-link/broken-image/env-leak scanner scoped to acg.aaa.com, meemic.com, and meemicfoundation.org, opened from the popup's Links tab as its own extension tab.

## v1.94
- Reduced Chrome flashing by no longer clearing AEM.state/zipcode from the content script on every ACG page load. The popup still clears stale cookies once before starting the official ZIP flow.
