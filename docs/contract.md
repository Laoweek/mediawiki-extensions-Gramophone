# Server to client contract

How the PHP side and the player talk, and what else must move when one side changes.

## Data flow

1. `Hooks` registers `<gramophone>` and `<playbutton>`. It registers the Sm2Shim and FlashMP3 tags
   `<flashmp3>`, `<sm2>` and `<modernsoundmanager>` when `$wgGramophoneSm2ShimTags` is true (the
   default), and `<ab>` when `$wgGramophoneAudioButtonTag` is true. It reads `<nowiki>` in the
   content and the attribute values as text, removes other strip markers and keeps the page
   within its track budget (see Tag behaviour). `InputParser` (pure PHP) reads the file list
   syntax `FILES|key=value` with the options given as tag attributes, the `<ab>` content and the
   JSON playlist of `<gramophone>` and `<modernsoundmanager>`. `TrackResolver` turns file names
   and titles into URLs, checks paths on the wiki's own site, applies `$wgGramophoneAllowedHosts`,
   decides what may load before a click and what gets `nofollow`, and records file usage.
   `PlayerRenderer` writes the host element.
2. `Hooks` adds the ResourceLoader modules to the page: `ext.gramophone.styles` and
   `ext.gramophone` for every tag, and `ext.gramophone.player` as well for the player tags
   (`<gramophone>`, `<flashmp3>` and `<modernsoundmanager>`, `mode: "player"`).
3. The client (`client/src/index.ts`) mounts every host on `mw.hook('wikipage.content')`, lazily as
   hosts near the viewport, attaches a shadow root and builds the UI. `client/src/config.ts` reads
   the JSON.

The client ships as two ResourceLoader modules, built by `client/build.mjs`:

| Module | File | Holds |
| --- | --- | --- |
| `ext.gramophone` | `resources/dist/gramophone.js` | entry, config, button, engine, `exists`, tooltip, i18n, util |
| `ext.gramophone.player` | `resources/dist/gramophone.player.js` | card player, row, slider, popover, volume, lyrics |

`ext.gramophone.player` depends on `ext.gramophone` and reuses its code through `require('ext.gramophone')`, so that
code ships once. `ext.gramophone` mounts player and row hosts through
`mw.loader.using('ext.gramophone.player')`, so a page whose HTML asked only for `ext.gramophone` still works.
Pages with only buttons never load `ext.gramophone.player`. `build.mjs` empties `resources/dist/` first
and fails when a source file would ship in both modules.

- Autoplay players start once `ext.gramophone.player` has loaded. The parser adds it to pages with
  player tags, so it arrives in the same request as `ext.gramophone`.
- When `ext.gramophone.player` cannot load (an error response, or a browser with an old cached startup
  module), every player and row host shows its fallback list in its shadow root as a plain
  numbered list of links. The error is reported once (`mw.log.error`), and a later
  `wikipage.content` fires a new attempt.

## Host markup

```html
<div class="ext-gramophone ext-gramophone-player TAG-CLASSES" style="TAG-STYLE" data-mw-gramophone="{JSON}">
  <ol class="ext-gramophone-fallback"><li><a class="ext-gramophone-fallback-link" href="SRC">TITLE</a></li></ol>
</div>
<span class="ext-gramophone ext-gramophone-button TAG-CLASSES" style="TAG-STYLE" data-mw-gramophone="{JSON}"><a class="ext-gramophone-fallback-link" href="SRC" title="TITLE">TITLE</a></span>
```

Parsoid writes `data-mw-gramophone` in single quotes. The value is the same. The fallback link of a track
whose audio is an editor-written URL gets `rel="nofollow"` under the same rule as the `nofollow`
field below.

The player tags (`<gramophone>`, `<flashmp3>`, `<modernsoundmanager>`) write the `div`, the
button tags (`<playbutton>`, `<sm2>`, `<ab>`) the `span`.

`TAG-CLASSES` and `TAG-STYLE` are the tag's own `class` and `style` attributes, checked by
`Sanitizer::validateTagAttributes()` as for a `div` (`Hooks::HOST_ATTRIBUTES`). Without them
there is no extra class and no `style` attribute. `type="lastfm"` turns `<flashmp3>` off, but not
`<gramophone>`. The other attributes of a file list (`<gramophone>`, `<playbutton>`, `<flashmp3>`,
`<sm2>`) and of `<ab>` are read as options (see Tag behaviour), and a JSON playlist
(`<gramophone>`, `<modernsoundmanager>`) ignores them. None of them reach the markup.

The fallback links stay in the light DOM for readers without JavaScript and for crawlers. A missing
file gets `<a class="new ...">` pointing at the upload page, a rejected entry with no target gets
`<span class="new ...">`. Output stays on one line and is returned as a plain string (a general
strip marker): MediaWiki restores those before the paragraph pass, while `markerType => 'nowiki'`
leaves stray `<p class="mw-empty-elt">`.

## The `data-mw-gramophone` JSON

Version 2. `TrackResolver::resolve()` and `PlayerRenderer::clientData()` define it. A key at its
default is left out, because the bytes add up on pages with hundreds of buttons:

```
{ "v": 2, "mode": "player" | "button",
  "autoPlay": true, "loop": true, "playlistOpen": true, "hideMissing": true,  // only when true
  "colors": { "background", "foreground", "track", "thumb": "#rrggbb" },     // only the colours set
  "tracks": [ { "src", "title",                                // always
                "artist", "album", "cover", "lyrics", "link",  // only when not empty
                "explicit", "missing", "verify", "nofollow",   // only when true
                "lyricsOffset" } ] }                           // ms, only when not 0
```

- `src` is the audio URL, empty for a missing track. `link` is the file page, the upload page of
  a missing file, or the track's `navigationUrl`. `cover` is a URL, a 240 px thumbnail for a wiki
  image.
- Editor-written URLs (audio, cover, lyrics, `navigationUrl`) are output and registered in the
  form core gives external links (`TrackResolver::editorUrl()`, through
  `Parser::normalizeLinkUrl()`): escapes that need none are decoded (`ex%61mple.org` becomes
  `example.org`), unsafe characters are encoded and `.` and `..` segments are resolved. Every
  check runs on that form, so the checks, the output and the registered external link agree.
- `verify`: the client checks this track with a HEAD request. Set only when the player has
  `hideMissing`, the track is not `missing`, its audio is an editor-written URL, and that URL may
  load before a click (`TrackResolver::mayLoadAutomatically()`). The client sends no other check
  requests.
- `nofollow`: the client gives the track's links `rel="nofollow"`. Set when the audio URL, or a
  `link` that came from a `navigationUrl` URL, is an editor-written URL that core would give
  `rel="nofollow"` (`$wgNoFollowLinks`, `$wgNoFollowNsExceptions`,
  `$wgNoFollowDomainExceptions`, see `TrackResolver::isNoFollow()`).

What may load before a click (`TrackResolver::mayLoadAutomatically()`): wiki files and accepted
paths on the wiki's own site always, a URL on another site only when `$wgGramophoneAllowedHosts` is a
list (it then passed the list) or core's external image settings allow it
(`$wgAllowExternalImages`, `$wgAllowExternalImagesFrom`, MediaWiki:External image whitelist with
`$wgEnableImageWhitelist`, without core's file extension check). A protocol-relative URL matches
in either protocol. An empty `$wgAllowExternalImagesFrom` prefix allows nothing (core reads it as
allowing every site), and a whitelist line that is not a valid expression is ignored without a
warning. A full URL to the wiki's own host counts as another site. The server applies
this rule itself, so the client never needs it:

- a cover that may not load is dropped, and the page joins the missing-file category
- `autoPlay` is left out when the audio of a track that can play may not load
- `verify` is set only for audio that may load

The JSON is compact, without spaces, and HTML-safe (`JSON_HEX_TAG`, `JSON_HEX_AMP`). The
stylesheet relies on the compact form, see Layout choice.

To add or change a field, update together:

- the PHP emitter and `client/src/config.ts`
- `client/demo/make-demo.mjs`, which writes the same markup, then `pnpm demo`
- expectations in `gramophoneParserTests.txt` and the PHPUnit tests
- the dev wiki pages in `dev/pages/` that use the field, then `cd dev && ./setup.sh` to re-save them

## Layout choice (client)

| Host | Layout | Code | Module |
| --- | --- | --- | --- |
| `mode: "button"` (`<playbutton>`, `<sm2>`, `<ab>`) | inline round button with a progress ring | `button.ts` | `ext.gramophone` |
| `mode: "player"`, one track, inside `td` or `th` | 40px row: play, slider, time | `row.ts` | `ext.gramophone.player` |
| any other player | card with cover, playlist, lyrics | `player.ts` | `ext.gramophone.player` |

`client/src/index.ts` picks the layout in `ext.gramophone`, before `ext.gramophone.player` has loaded.

`resources/ext.gramophone.styles.css` sizes each host before the script runs, with
selectors that mirror this table. Keep the two in step, or the page shifts when players mount
(`check.mjs` measures it).

A button with `hideMissing` (`<playbutton>…|hidemissing=yes`) is invisible but keeps its box until
`client/src/exists.ts` has checked its files. The client marks it `ext-gramophone-checking` when it takes
it over, then adds `ext-gramophone-checked`, or sets the `hidden` attribute when none of its files can
exist: each track is `missing` (a missing wiki file or a rejected URL), or has `verify` and
answered 404 or 410 to a HEAD request. A track with neither counts as present, so its button
stays. A host the client never takes over, because it failed or an older cached copy runs,
appears after 10 s through a CSS animation. The stylesheet selects these hosts with
`[data-mw-gramophone*='"hideMissing":true']`, so the JSON must stay without spaces. Parsoid's single
quotes around the attribute do not matter to the selector.

`exists.ts` checks a button once it is displayed and within about two screen heights of the
viewport. At most 6 requests run at a time page-wide, each with 5 s counted from when it is
sent. Only 404 and 410 count as missing. A network error, a host without CORS headers or a
timeout counts as present, and a timeout also skips the checks still queued for that host.

## Messages

Search the repository for the key (`rg 'gramophone-…'`, skipping `dist/` and the generated demo pages)
and move every hit together. The places are:

- the four i18n files (`en`, `zh-hans`, `zh-hant`, `qqq`)
- `ResourceModules > ext.gramophone > messages` or `ResourceModules > ext.gramophone.player > messages` in
  `extension.json` (client keys, in the module whose code uses them)
- `FALLBACK` in `client/src/i18n.ts` and the calls in `client/src/*.ts` (client keys)
- `pnpm demo`, which rebuilds the demo pages' message stub from both module lists and
  `i18n/en.json`

`pnpm check` in `client/` runs `client/scripts/check-messages.mjs`, which fails when a client key
is missing from one of these places or listed in the wrong module, or when an `en.json` key has no
`qqq.json` entry.

Server keys are used only by PHP and are not in `extension.json`: `gramophone-desc`,
`gramophone-error`, `gramophone-unknown`, `gramophone-invalidJson`, `gramophone-playlistRequired`,
`gramophone-too-many-tracks` (`$1` is the formatted limit, with `PLURAL`), and the two tracking
categories with their `-desc` keys. The extension name is not a message: Special:Version shows
`Gramophone` in every language.

Renaming or removing a key also orphans any on-wiki override (`MediaWiki:Gramophone-…`). Check for one
with `api.php?action=query&meta=allmessages&amcustomised=modified&amprefix=gramophone` and tell the user.

## Tag behaviour

`<gramophone>` is a full player. When its content, read as the reader sees it (`Hooks::unstrip()`,
below), starts with `{` after leading whitespace, it is a JSON playlist and takes the
`<modernsoundmanager>` path, also the second reading for a playlist wholly inside `<nowiki>`.
Other content is a file list read as in `<flashmp3>`. MediaWiki titles cannot contain `{`, so no
file list starts with one. `<playbutton>` is read as `<sm2>`. With `$wgGramophoneSm2ShimTags`
false, `<flashmp3>`, `<sm2>` and `<modernsoundmanager>` are not registered and stay text on the
page. `<ab>` needs `$wgGramophoneAudioButtonTag`.

The file list rules (`FILES|key=value`, one `=` per option, unknown keys ignored, flags only on
`yes`) live in `InputParser::parseLegacy`. Every option can also be a tag attribute, which is what
`{{#tag:playbutton|…|name=value}}` and Lua's `frame:extensionTag` produce. The content option wins
over the attribute of the same name. `title` (button tags only) becomes the `title` of every track
of the button, so it needs no field of its own. `<ab>` content is one file name, taken whole after
template expansion, as AudioButton read it. Editors read `README.md` (How to use it) and
`docs/reference.md`, so a behaviour change updates them too.

Strip markers stay in the content until `InputParser` has split it, so a `|` or `,` inside
`<nowiki>` in a `{{#tag:...}}` argument does not separate. Each value is then read by
`Hooks::unstrip()`: `<nowiki>` becomes its literal text with entities decoded
(`StripState::replaceNoWikis()`), and other markers are removed (`Parser::killMarkers()`).
Attribute values are read the same way. `{{#tag:sm2|A.mp3|title=Hello<nowiki>!</nowiki>}}` is
titled `Hello!`. In a JSON playlist, the `"` of each marker is escaped so that a marker stays
inside its string value. When that JSON does not parse and the content held markers, as
when the whole playlist is inside `<nowiki>`, it is read again with every marker replaced.

Track budget: the tags of one page have at most `Hooks::MAX_TRACKS_PER_PAGE` (5,000) tracks
together, over all tags. The count is kept per parser strip state, so it also holds when
Parsoid renders one tag at a time. Skipped playlist entries do not count. Before
`json_decode()`, a playlist with more `{` outside strings than the remaining budget plus one is
refused (`InputParser::countObjects()`), which keeps a 2 MB playlist at about 2 MB of memory
instead of 50 MB. Entries that hold objects of their own, or objects without audio, count there
too. The tag that would go over shows `gramophone-error` with `gramophone-too-many-tracks`, adds
`gramophone-tracking-category` and resolves nothing (no file lookups, no links). Later tags that
fit still render.

## Compatibility decisions

Each one keeps old pages rendering, or says why it does not. The parser tests pin them.

- Playlist entries that are `null`, not objects, or lack a non-blank `audioFileUrl` are skipped, as
  Sm2Shim's loose `== null` check did. The error appears only when no playable entry is left.
- `//host/path` audio plays like an external URL. Neither it nor `/path` is looked up as a wiki
  file.
- A `/path` for audio, a cover or lyrics is used only when it points at a file the wiki serves
  (`TrackResolver::isServedFile()`): under `$wgUploadPath` when that is a path or a URL on the
  wiki's host, under `$wgScriptPath/img_auth.php/`, or Special:FilePath or
  Special:Redirect/file/ under any alias, in the article path or `$wgScript?title=` form, without
  `curid`, and with the title read by `Title::newFromURL()` as core reads request titles. Dot
  segments (also percent-encoded, such as `..%2F`), `%5C`, `%25`, control characters and more
  query parameters than `max_input_vars` are refused. A full URL to a host that gets the wiki's
  cookies follows the same rules: the wiki's own host on any port, because browsers send the
  wiki's cookies to every port of a host, and hosts within `$wgCookieDomain`
  (`TrackResolver::isWikiHost()`). A refused path counts as a missing file. This departs from
  Sm2Shim, which played any path: the reader's browser would request it with the reader's
  cookies. `navigationUrl` still accepts any path, because only a click follows it.
- Every host comparison, including `$wgGramophoneAllowedHosts`, uses `EditorUrl::canonicalHost()`:
  percent-decoded, UTS #46 mapped to ASCII, lower case, without one trailing dot, IPv6 in short
  form. A host that does not map, or that browsers would read as an IPv4 address written other
  than as four decimal numbers, makes the URL unusable. The URL is kept as written in the
  output.
- Covers, `hidemissing` checks and autoplay load files from other sites only where
  `$wgGramophoneAllowedHosts` or core's external image settings allow it (see the JSON section). By
  default, old pages lose external covers and autoplay of external audio, and `hidemissing`
  buttons with external audio stay visible: no third-party host learns of a reader before they
  press play, the rule core applies to external images.
- File lists with unbalanced double quotes split on every comma.
- Sm2Shim ignored tag attributes. Only attributes named like a legacy option are read, and the
  content option wins, so a page changes only where it already had such an attribute.
- File lists (`<gramophone>`, `<playbutton>`, `<flashmp3>`, `<sm2>`) ignore `bg`, `text`, `tracker`
  and `track` unless `$wgGramophoneLegacyColors` is true: Flash-era colour values hid the site
  accent on real pages. JSON colours always apply.
- Titles, artists and albums in the JSON are converted to the reader's Chinese variant at parse
  time, matching the fallback text.

## Theming (public API)

Site CSS styles the players through three things, all listed in `docs/theming.md`. Renaming or
removing one breaks wiki stylesheets, so treat them like message keys: add freely, change only
with a note to the user and `docs/theming.md` updated in the same change.

- `--gramophone-*` custom properties. `resources/ext.gramophone.styles.css` defines the defaults and the
  dark tokens. A size property (`--gramophone-cover-size`, `--gramophone-row-height`, `--gramophone-button-size`)
  is used by both the shadow CSS and the placeholder, so the two stay the same size. A public
  property is also listed in `includes/TemplateStylesHooks.php` with a matcher for its values,
  so TemplateStyles sheets can set it.
  `--gramophone-bar` (placeholder geometry) and `--gramophone-button-background`/`--gramophone-button-foreground`
  (set by `button.ts` from tag colours) are internal and stay out of `docs/theming.md` and the hook.
- Part names (`part="..."` in `client/src/*.ts`) and the state names toggled with
  `partState()` and `setPressed()` in `client/src/util.ts`. A new element that site CSS may
  want to style gets a part name, and its row in the tables of `docs/theming.md`.
- The host attributes the client sets: `data-gramophone-state` (`playState()` in
  `client/src/engine.ts`, set by `mountButton()` before a button's first press) and
  `data-gramophone-layout` (`client/src/index.ts`).
