# Store listing copy

Draft text for the Chrome Web Store Developer Dashboard and Microsoft Edge
Partner Center listing forms. Not used by the extension itself — just a
copy-paste source for whoever submits it.

## Category

**Developer Tools** (both stores have this category; it's the correct fit).

## Short description / summary field

Same as `manifest.json`'s `description` (118 chars, within Chrome's 132-char limit):

> ACG/Meemic dev tool: ZIP state switch, env links, A/B ideas, AEM badge, Site Scanner (links/SEO/console) for any site.

## Detailed description (listing page body, no strict length limit)

> Internal developer/QA utility for ACG, Meemic, and Meemic Foundation web
> testing, plus a general-purpose site scanner.
>
> **State switching** — Launches ACG's official ZIP-based regional state
> lookup flow so testers can switch which state's content/behavior is active,
> without manually hunting for a ZIP code in each state.
>
> **Environment quick links** — One-click links to ACG, Meemic, Meemic
> Foundation, and AEM Author environments across Prod/Stage/QA/Dev.
>
> **A/B test idea generator** — Detects the page type of the active tab and
> generates template-based Adobe Target test ideas locally, with priority
> ranking. No data leaves the browser.
>
> **AEM Author environment badge** — Shows a small badge on AEM Authoring
> pages so it's obvious at a glance which author environment a tab is on.
> Defaults to a free-drag position that auto-saves per URL.
>
> **Site Scanner** — Point it at any http(s) site to run:
> - Lower-environment link leak detection
> - Broken link checking
> - Missing image detection
> - Mixed content (http on https) detection
> - Spelling/typo checking
> - Basic SEO/accessibility page audit
> - Free-text word/phrase search
> - Live Console Error Capture — drives a tab you choose through the site,
>   watching for JavaScript errors, warnings, and unhandled promise
>   rejections, with plain-English explanations and fix suggestions for
>   common patterns (load-order issues, CORS, CSP, vendor tag failures, and
>   more).
>
> All scanning runs locally in the browser. Nothing is collected, sold, or
> transmitted to any external server — see the privacy policy for details.
>
> This is an internal tool for ACG/AAA/Meemic developer and QA workflows,
> distributed privately. Not affiliated with AAA or its subsidiaries unless
> distributed by an authorized publisher.

## Privacy policy URL

https://jackdnichols.github.io/ACG-State-Switcher/privacy.html

## Support / contact

Fill in with whatever contact the store requires (developer email or an
internal support channel) — not something to invent on your behalf.

## Screenshots checklist

See the four suggested shots in the prior message (popup ACG State tab,
popup Env Badge tab, a Site Scanner crawl-scanner with results, Console
Errors with captured events). 1280x800 or 640x400, PNG/JPEG, no alpha
channel.

## Notes for testers (reviewer-only field — customers never see this)

Chrome Web Store's "Provide any info that testers need to understand and
use this extension" field, and Edge's equivalent. Written for a reviewer
with no AAA network/account access — steers them toward what they can
actually verify (Site Scanner, fully public-testable) versus what they
can't (the ACG/Meemic/AEM-Author-scoped features, which need internal
access and will just look inactive on any other site — expected, not a
bug).

> This is an internal developer/QA tool for AAA/ACG, Meemic, and Meemic
> Foundation web teams. No login, account, or purchase flow anywhere in
> the extension — nothing to sign into or pay for.
>
> Two feature groups, with very different testability for a reviewer
> without internal AAA network/account access:
>
> 1. ACG-SCOPED FEATURES (State switching, Env Links, AEM Author badge)
>    only do anything on acg.aaa.com / meemic.com / meemicfoundation.org
>    and a fixed list of internal AEM Author hostnames. These are
>    internal, authenticated properties a reviewer likely cannot reach.
>    On any other site, these tabs will simply show a disabled/inactive
>    state — that is expected, not a bug. The "A/B Testing" popup tab is
>    the exception: it reads the active tab's URL/title locally to
>    generate template test ideas and works on any page, no login needed.
>
> 2. SITE SCANNER is fully testable on any public site with no special
>    access, and is the best way to verify the extension's actual
>    behavior:
>    - Click the toolbar icon -> "Open Site Scanner" (or click the icon
>      directly while on any http(s) page).
>    - Enter any public URL (e.g. https://example.com) as the Start URL
>      on any of the seven scan tabs (Lower Env Links, Broken Links,
>      Missing Images, Mixed Content, Spell Check, Page Audit, Word
>      Search) and click that tab's "Start" button, or click "Run all"
>      at the top to run all seven at once. Results populate live in
>      that tab.
>    - Console Errors tab: pick any of your own open tabs from the
>      "Target tab" dropdown, click "Start console scan". It will reload
>      that tab and drive it through a few same-origin pages, watching
>      for JavaScript console errors/warnings and reporting them with
>      plain-English fix suggestions. To force a visible result quickly:
>      open DevTools on the target tab's Console and type
>      console.error("test") after starting the scan.
>    - All scan results stay in the browser tab; "Download CSV" /
>      "Download all results (JSON)" buttons save a file locally on
>      click. Nothing is sent to any external server at any point (see
>      the privacy policy).
>
> The extension requests all-sites host access solely so Site Scanner can
> be pointed at any site, not just ACG/Meemic properties — every other
> feature stays hard-scoped to its own fixed host list regardless of that
> broader grant.
