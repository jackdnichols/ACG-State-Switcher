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
