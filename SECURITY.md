# Security policy

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button on the
Security tab of this repository, not in a public issue. Include the wikitext or URL that triggers
the problem and the MediaWiki version.

The extension turns editor-supplied wikitext into HTML and plays editor-supplied URLs, so these
are in scope:

- markup or script injection through tag content, attributes or a JSON playlist
- URLs in other schemes (`javascript:`, `data:` and the like) becoming playable or clickable
- CSS injection through colour options or the `style` attribute
- anything that lets one page's player affect another page or another user

Fixes land on the `main` branch. You can expect a first answer within a week.

Each security fix is announced as a GitHub Security Advisory on this repository. Wikis get the
fix by pulling the latest `main`. README.md, under Updating, explains how to be notified.
