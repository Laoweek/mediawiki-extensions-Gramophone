# Gramophone

A MediaWiki 1.43+ extension that plays music on wiki pages. `<gramophone>` renders a player
(a file list or a JSON playlist) and `<playbutton>` an inline button. It also renders the tags of
Sm2Shim and FlashMP3 (`<flashmp3>`, `<sm2>`, `<modernsoundmanager>`) and AudioButton (`<ab>`), as
a drop-in replacement.

- The repository root is the extension. `resources/dist/gramophone.js` (module `ext.gramophone`) and
  `resources/dist/gramophone.player.js` (module `ext.gramophone.player`) are built from `client/` and
  committed.
- `README.md` is the overview for wiki admins and editors. `docs/reference.md` (tags),
  `docs/configuration.md` (settings, privacy), `docs/theming.md` (styling API) and
  `docs/migrating.md` (old tags) hold the details.
- `client/` is the player UI (TypeScript, Shadow DOM, ES2017 output).
- `dev/` is a local MediaWiki 1.43 test wiki at http://localhost:8143 (`dev/README.md`).
- `scripts/php-test.sh` runs the PHP checks in a throwaway container.
- `docs/contract.md` describes how the PHP side and the player talk.
- `CONTRIBUTING.md` is the human version of this file.

## Rules

- **Drop-in.** Wikitext written for Sm2Shim keeps working. `tests/parser/gramophoneParserTests.txt` is
  the contract: a behaviour change lands together with the parser test that shows it and the
  README or `docs/` section that tells editors.
- **Plain audio.** Playback goes through an `<audio>` element without `crossOrigin` and without
  Web Audio, because third-party audio hosts send no CORS headers.
- **Stable styling API.** `--gramophone-*` custom properties, `::part()` names, the host classes and the
  host state attribute are public API that wikis style against. Renaming or removing one is a
  breaking change: say so in the commit message. There are no versions: wikis run the
  latest `main`.
- **Third-party media stays out of git.** The demo and the dev wiki play Apple Music previews and
  covers that `scripts/demo-media.mjs` downloads into gitignored folders. The README screenshots
  show the covers inside the player. Lyric files are original text that explains the player,
  never a song's real lyrics.

## Done means green

Needs Docker, `pnpm install` in `client/` and `dev/`, Google Chrome, and network access (the PHP
check downloads Composer packages, the browser checks download the demo songs on first run).

| You changed | Run | Pass |
| --- | --- | --- |
| PHP, `extension.json`, `i18n/` | `scripts/php-test.sh` | ends `all PHP checks passed` |
| `client/` or `resources/` | `cd client && pnpm check && pnpm demo && pnpm visual` | exits 0 and ends `N/N checks passed` with both numbers equal |
| anything at all | `cd dev && ./setup.sh && node check.mjs` | ends `all checks passed` |

`./setup.sh` is idempotent: it starts the wiki and re-saves the pages in `dev/pages/`, so run it
after changing one. Then open the screenshots of what changed (`dev/screenshots/`,
`client/demo/screenshots/`) with the Read tool and judge them as a reader would. `node check.mjs`
occasionally misses a play event when the machine is busy: rerun that page, for example
`--pages=Bubblin`, before treating it as a bug.

## Read before you

change the `data-mw-gramophone` JSON, the host markup, message keys, the layout rules, the styling API or tag
behaviour: `docs/contract.md`.
