# Contributing

Thanks for helping. Bug reports with a small piece of wikitext are the most useful thing you can
send. For code changes, this page explains the layout and the checks.

## Layout

| Path | What |
| --- | --- |
| `extension.json`, `includes/`, `i18n/`, `resources/` | the extension as a wiki loads it |
| `resources/dist/gramophone.js`, `resources/dist/gramophone.player.js` | the player code, built from `client/` and committed so wikis need no build step: `gramophone.js` is the module `ext.gramophone` (every tag), `gramophone.player.js` the module `ext.gramophone.player` (full and one-line players) |
| `tests/` | parser tests (`tests/parser/gramophoneParserTests.txt`) and PHPUnit tests |
| `client/` | the player UI in TypeScript, drawn in Shadow DOM, compiled to ES2017 |
| `dev/` | a local MediaWiki 1.43 wiki with demo pages and a browser check |
| `scripts/php-test.sh` | the PHP checks in a throwaway MediaWiki container |
| `docs/contract.md` | how the PHP side and the player talk, and what must change together |

## Ground rules

- **Old wikitext keeps working.** Pages written for Sm2Shim or FlashMP3 must render the same.
  The parser tests are the contract: a behaviour change comes with the parser test that shows it
  and the README or `docs/` section that tells editors.
- **Plain `<audio>`.** No `crossOrigin` and no Web Audio, because many audio hosts send no CORS
  headers.
- **The styling API is public.** `--gramophone-*` properties, `::part()` names, host classes and the host
  state attribute are what wikis style against. Renaming or removing one is a breaking change.
- **Third-party media stays out of git.** The demo page and the dev wiki play the 30-second
  Apple Music previews and covers of three releases. `scripts/demo-media.mjs` lists them and
  downloads them into gitignored folders the first time a check needs them. Lyric files are your
  own text, never a song's real lyrics.

## Setup

You need Docker, Node 22 or later with pnpm, Google Chrome, and network access to download the
demo songs. `GRAMOPHONE_BROWSER_CHANNEL` picks another Playwright channel, such as `msedge`.
Playwright's own `chromium` cannot play the AAC previews.

```sh
cd client && pnpm install && cd ..
cd dev && pnpm install && ./setup.sh && cd ..
```

The dev wiki runs at <http://localhost:8143/wiki/Main_Page> and mounts this repository live.
`dev/README.md` has the details.

## Checks

Run what matches your change. Each must pass before a pull request is merged.

| You changed | Run | Pass |
| --- | --- | --- |
| PHP, `extension.json`, `i18n/` | `scripts/php-test.sh` | ends `all PHP checks passed` |
| `client/` or `resources/` | `cd client && pnpm check && pnpm demo && pnpm visual` | ends `N/N checks passed` with both numbers equal |
| anything | `cd dev && ./setup.sh && node check.mjs` | ends `all checks passed` |

`scripts/php-test.sh` takes the MediaWiki image from `GRAMOPHONE_PHP_IMAGE`, for example
`GRAMOPHONE_PHP_IMAGE=mediawiki:1.45 scripts/php-test.sh`. CI runs it for every supported release and also
checks that building the bundle and the demo pages leaves the checkout unchanged.

The Security workflow runs on every pull request, on `main` and weekly. It fails on any known
vulnerability in `client/pnpm-lock.yaml` or `dev/pnpm-lock.yaml` (OSV-Scanner), and on findings
of zizmor or actionlint in `.github/`. To accept a vulnerability, list it in an `osv-scanner.toml`
next to the lockfile, with a `reason` and an `ignoreUntil` date.

After a client change, commit the rebuilt `resources/dist/gramophone.js`, `resources/dist/gramophone.player.js`
and demo pages together with the source.
Look at the screenshots the checks write (`client/demo/screenshots/`, `dev/screenshots/`) as a
reader would.
When a change alters how the players look, run `cd client && pnpm build && pnpm demo && pnpm readme-shots`
and commit the new pictures in `docs/screenshots/`, which README.md shows.

## Messages

Interface text lives in `i18n/`. English (`en.json`) is the source, `qqq.json` documents each
key for translators. Client keys must also be listed under `messages` of the module whose code
uses them, `ext.gramophone` or `ext.gramophone.player`, in `extension.json`. Keys that only PHP uses, such as
`gramophone-too-many-tracks`, are not listed there. `pnpm check` in `client/` checks the client keys
(`client/scripts/check-messages.mjs`). `docs/contract.md` lists every place a key appears.

## Versions

There are no version numbers, tags or releases. Wikis run the latest `main`, so every commit on
it must pass the checks. A change that renames or removes part of the styling API, or changes
what existing wikitext renders, says so in its commit message. Archives contain only the
extension and its documentation, because `.gitattributes` leaves out the development folders.
