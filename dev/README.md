# Gramophone dev wiki

A small MediaWiki 1.43 wiki on your computer for trying out the extension and for checking it
in a real wiki with a real browser. It is set up like a typical Chinese fan wiki: the interface
is in Chinese (zh-cn), uploads come from a second address with CORS, computers get legacy
Vector and phones get Citizen. The page text is in English.

The repository root is mounted into the wiki as `extensions/Gramophone`, read-only. Changes to
the extension show up on the next page view, without a restart.

## Start

You need Docker (Docker Desktop, or Colima with `colima start`), Node 22 or newer with pnpm,
Google Chrome, and an internet connection for the first run.

```sh
cd dev
pnpm install          # once, for the browser check
./setup.sh            # the first run takes a few minutes
node check.mjs        # about a minute
```

Then open <http://localhost:8143/wiki/Main_Page>.

You can run `./setup.sh` again at any time. It only does what is missing: it starts the
containers, downloads the songs it does not have yet, imports files that are new or changed,
and saves the pages again. `./setup.sh --reset` deletes the wiki's database and uploads first
and builds everything from scratch.

## Checkouts from before the rename

The project used to be called PiranSymphonyOrchestra. If you set up the dev wiki before the
rename:

1. Stop the old wiki: `docker compose -p pso-dev down`. Add `--volumes` to delete its data as
   well.
2. In `dev/.env.local`, rename the keys `PSO_DEV_ADMIN_USER` and `PSO_DEV_ADMIN_PASSWORD` to
   `GRAMOPHONE_DEV_ADMIN_USER` and `GRAMOPHONE_DEV_ADMIN_PASSWORD`. Or delete the file, and
   `setup.sh` makes a new password.
3. Delete `dev/fixtures/` if it is still there, then run `./setup.sh --reset` once. This
   removes the old test pages and test tones from the wiki.

## Addresses

| Port | What |
|---|---|
| 8143 | the wiki |
| 8144 | the uploads address. `/images/` is the wiki's upload folder (`$wgUploadPath` is `http://localhost:8144/images`). `/media/` serves the same songs, covers and lyrics as a mirror on another site. Both send CORS headers for the wiki. |
| 8145 | a "third-party" site that serves the same files under `/media/`, without CORS headers |

All ports listen on 127.0.0.1 only. The pages reach the mirror as `http://127.0.0.1:8144/media/`
and the third-party site as `http://127.0.0.1:8145/media/`. They use 127.0.0.1 because the
extension treats `localhost` on any port as the wiki's own site. The wiki trusts the mirror
(`$wgAllowExternalImagesFrom` in `config/LocalSettings.dev.php`), so it may check files there
before a click. Nothing from the third-party site loads before a click.

## Account

`setup.sh` creates an admin account and writes a random password to `dev/.env.local`. That file
is not committed and only you can read it. Log in at Special:UserLogin with
`GRAMOPHONE_DEV_ADMIN_USER` and `GRAMOPHONE_DEV_ADMIN_PASSWORD` from the file. To get a new
password, delete the file and run `./setup.sh`.

## Pages

The pages are plain wikitext in `pages/`, and `pages/pages.tsv` lists the title of each file.
Edit a file and run `./setup.sh` to save it again.

| Page | What it shows |
|---|---|
| Main Page | what the wiki is, links to the other pages, the music credits, and a "song of the week" player from Template:Song |
| Galaxy Triangle | an album page: an infobox with the cover, the whole album as a `<gramophone>` JSON playlist, a track list with a `<playbutton>` in each row (Template:Track), and a folded table with a one-line player per song |
| Bubblin' | a song page: a player with the lyrics panel, its LRC file on the wiki. A second player (Template:Song) reads the same LRC from the mirror. A play button sits in a footnote. |
| VALIS | an artist page: a one-line player in a narrow infobox (file list syntax), a play button in a sentence, and a player with a cover (JSON) |
| Previews | play buttons only, so `ext.gramophone.player` must not load. Buttons with `hidemissing="yes"` on the mirror: one file exists, one does not, one sits in a closed tab. Also a button for the third-party site and one for a Special:FilePath address. |
| Sm2Shim compatibility | the old tags `<flashmp3>`, `<sm2>`, `<modernsoundmanager>` and `<ab>`, each next to its wikitext, and `{{#tag:...}}` |
| Template:Song, Template:Track | a player built from parameters, and a track list row with a play button |
| MediaWiki:Common.css | the infobox style: at the right of the text on computers, above it on phones |

## Songs, covers and lyrics

The music is "Galaxy Triangle" by La prière, "Bubblin'" by HIMEHINA and "Mukyu Platonic" by
VALIS. The songs are the 30-second previews from Apple Music and the covers are their cover art.
They belong to the artists and their labels, so they are never committed. Every song links to
its Apple Music page.

`setup.sh` runs `media.mjs`, which:

1. downloads the previews and covers with `scripts/demo-media.mjs` into `media/download/`
2. converts the previews to MP3 in the `ffmpeg` container and puts them, with the covers, into
   `media/wiki/` under the names the pages use: `Div.A3.mp3`, `Diva of the Battlefield.mp3`,
   `Testament of the Twin Stars.mp3`, `Ripple.mp3`, `Driven Star With You.mp3`,
   `Galactic Love.mp3`, `E Div.mp3`, `Bubblin.mp3`, `Mukyu Platonic.mp3`,
   `Galaxy Triangle cover.jpg`, `Bubblin cover.jpg` and `Mukyu Platonic cover.jpg`
3. copies `client/demo/lyrics/bubblin.lrc` to `media/wiki/Bubblin.lrc`. Its lines explain the
   lyrics panel, with a Japanese translation under each line. They are not the song's lyrics.

Both folders are in `.gitignore`. `setup.sh` imports `media/wiki/` into the wiki, and ports 8144
and 8145 serve the same folder under `/media/`. Files that are already there are kept, and when
all of them are there, `setup.sh` does not go online. To download again, run
`rm -rf media/download media/wiki`, then `./setup.sh`.

## What check.mjs checks

```sh
node check.mjs [--pages=Bubblin,Previews] [--scenarios=vector,minerva-mobile] [--no-interact] [--no-shots] [--headed]
```

It checks what only a running wiki and a browser can show. The parser tests
(`tests/parser/`) already pin the HTML and the `data-mw-gramophone` data, and the client checks
(`client/`) pin the player itself.

The wiki:

- the extension is loaded (API siteinfo), and Special:Version in Chinese shows the name
  "Gramophone" untranslated
- no new lines in the PHP logs during the run

Every page, in two scenarios: `vector` (legacy Vector, 1280 px wide) and `citizen-mobile-night`
(a phone with MobileFrontend and Citizen at night). A third scenario, `minerva-mobile`, is
Minerva on a phone: `--scenarios=vector,citizen-mobile-night,minerva-mobile` runs all three.

- the page answers HTTP 200
- `ext.gramophone` is ready, `ext.gramophone.player` is ready on pages with players and not
  loaded on Previews
- every player and button gets its shadow root (closed ones too)
- no host changes size when it hydrates. Hosts that are hidden at that moment, for example in a
  folded phone section, have no size to compare, so the check says how many it measured.
- every control has a label, and the play buttons say "播放", which proves that ResourceLoader
  delivered the Chinese messages
- after opening the phone sections, the folded tables and every tab: the page does not scroll
  sideways, no host is wider than its container, and every host shows with a size
- no empty paragraph right before or after a player
- nothing loads before a click: no audio, no lyrics, and HEAD requests only for the
  `hidemissing` files the wiki may check, each one once
- no console errors, failed requests or dialogs. The 404 answer for the missing mirror file is
  expected.
- a full-page screenshot in `screenshots/<page>-<scenario>.png`

Interactions, in legacy Vector:

- Galaxy Triangle: the album player plays a wiki file and its time moves on, and a track list
  button plays
- Bubblin': for the LRC on the wiki and the LRC on the mirror, the lyrics load and the
  highlighted line moves on as the song plays
- Previews: with `hidemissing`, the file on the mirror keeps its button, the missing one hides,
  each address gets one HEAD request, and the button in the closed tab waits until the tab
  opens. The button for the third-party site (no CORS) plays, and so does the Special:FilePath
  address.
- on each of these pages, no media element has `crossOrigin` set, and there are no console
  errors

It prints one line per check and ends with `all checks passed`, or with the number that failed.
`screenshots/summary.json` holds the same results. Open the screenshots of what you changed and
look at them as a reader would.

`--pages` takes parts of page titles, `--no-interact` skips the interactions, `--no-shots` the
screenshots, and `--headed` shows the browser. To use a browser other than Google Chrome, set
`GRAMOPHONE_BROWSER_CHANNEL` (for example `chromium` or `msedge`).

## Everyday commands

Run these in `dev/`.

| Task | Command |
|---|---|
| Stop, start again | `docker compose stop`, then `./setup.sh` |
| Start over with an empty wiki | `./setup.sh --reset` |
| Remove the containers and their data | `docker compose down --volumes` |
| Apache log | `docker compose logs -f mediawiki` |
| PHP warnings and errors | `docker compose exec mediawiki sh -c 'tail -f /var/www/data/logs/*.log'` |
| Run a maintenance script | `docker compose exec -u www-data mediawiki php maintenance/run.php <script>` |
| ResourceLoader debug mode on, off | `touch config/rl-debug.on`, `rm config/rl-debug.on` (or `?debug=1` for one page) |
| Save the pages again after editing `pages/` | `./setup.sh` |

The extension needs no restart after a change. PHP files are read again on every request, the
parser cache is dropped whenever a PHP or JSON file of the extension changes (`$wgCacheEpoch` in
`config/LocalSettings.dev.php`), and ResourceLoader notices a new client bundle by its content.
A normal reload is enough.

Skins: add `?useskin=vector-2022`, `timeless`, `monobook`, `citizen` or `minerva` to a page
address. Legacy Vector is the default on computers. For the phone view, open the page with a
phone user agent or add `?useformat=mobile`. Phones get Citizen, or Minerva with
`?useformat=mobile&useskin=minerva`.

## Troubleshooting

- "Docker is not running": start Docker, for example with `colima start`.
- "Node is missing": install Node 22 or newer.
- The download of the songs fails: check your internet connection and run `./setup.sh` again.
  Files that arrived are kept.
- A port is taken: stop whatever uses it, or set `GRAMOPHONE_DEV_WIKI_PORT`,
  `GRAMOPHONE_DEV_UPLOADS_PORT` and `GRAMOPHONE_DEV_NOCORS_PORT` before `./setup.sh`. Then also
  change 8144 and 8145 in `pages/`, `check.mjs` and `$wgAllowExternalImagesFrom` in
  `config/LocalSettings.dev.php`, and set `GRAMOPHONE_DEV_SERVER` for `check.mjs`.
- "The dev wiki is not installed yet": run `./setup.sh`.
- The tags show as plain text: the wiki runs without the extension when `extension.json` is
  missing or does not parse. Read the PHP logs.
- A play check fails once while the computer is busy: run that page again, for example
  `node check.mjs --pages=Bubblin`, before you treat it as a bug.
- Old pages such as Sm2Shim/Layout are still there: run `./setup.sh --reset`.

## What the dev wiki leaves out

Scribunto, Widgets, Cargo, PageForms, site JavaScript, gadgets, a caching proxy and HTTPS. The
wiki accepts `.lrc` uploads with the MIME type check turned off, which a production wiki may not
want.

## Files

| Path | What |
|---|---|
| `compose.yaml` | the services `mediawiki`, `uploads` (nginx) and the `ffmpeg` tool |
| `Dockerfile` | MediaWiki 1.43 on PHP 8.4 |
| `Dockerfile.ffmpeg` | Alpine with ffmpeg, for `media.mjs` |
| `config/LocalSettings.php`, `config/LocalSettings.dev.php` | the settings: the installer's output, then the dev wiki's own |
| `nginx/templates/default.conf.template` | ports 8144 and 8145 |
| `setup.sh` | sets everything up |
| `fetch.sh` | downloads MobileFrontend, TabberNeue and Citizen (not committed) |
| `media.mjs` | gets the songs, covers and lyrics into `media/` (not committed) |
| `pages/` | the wiki pages |
| `check.mjs` | the browser check |
