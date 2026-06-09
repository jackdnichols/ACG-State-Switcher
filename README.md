# ACG Utilities State Switcher v1.94

Developer utility for ACG/AAA web testing.

## What it does

- Switches ACG regional state behavior by launching ACG's current zip-only lookup flow.
- Opens quick links for ACG, Meemic, Meemic Foundation, and AEM Author environments.
- Generates local, template-based Adobe Target/A/B test ideas from the active tab, with auto-detected page type and priority ranking.
- Shows an optional AEM Author environment badge.

## Privacy

The extension runs locally in the browser. It does not send browsing data, cookies, page content, custom ideas, or selected states to any external server. It stores only local preferences such as selected tab, theme, badge settings, custom A/B ideas, and the temporary selected ACG state/ZIP override used during switching.

## Store review notes

- Manifest V3.
- No remotely hosted code.
- No eval/new Function.
- No captured cookie bundles are packaged.
- Host access is limited to AAA/ACG pages needed for the state switcher and the specific AEM Author hosts needed for the author badge.

Not affiliated with AAA or its subsidiaries unless submitted by an authorized publisher.


## v1.94
- Reduced Chrome flashing by no longer clearing AEM.state/zipcode from the content script on every ACG page load. The popup still clears stale cookies once before starting the official ZIP flow.
