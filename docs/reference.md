# Tag reference

The README shows how to use the tags under [How to use it](../README.md#how-to-use-it). This page
has the exact rules.

Gramophone has two tags:

| Tag | Shows |
| --- | --- |
| `<gramophone>` | a music player. A single track in a table cell plays in a one-line player. |
| `<playbutton>` | a small round play button that sits in a line of text or a table cell |

The tags of Sm2Shim, FlashMP3 and AudioButton work too, see [migrating.md](migrating.md).

## Two ways to write the content

`<gramophone>` takes either a **file list** or a **JSON playlist**. When the content starts with
`{`, it is a JSON playlist. Otherwise it is a file list. `<playbutton>` takes a file list.

### File list

```wikitext
<gramophone>Mukyu Platonic.mp3</gramophone>
<gramophone>File:Div.A3.mp3, Galactic Love.mp3|loop=yes</gramophone>
<gramophone>"Track one, part two.mp3",https://audio.example.org/song.mp3|openplaylist=yes</gramophone>
```

The content is a list of files, then optional `key=value` options, all separated by `|`.

- Files are separated by commas. Put a file name in double quotes when it contains a comma.
  If the double quotes are unbalanced, every comma separates.
- A file is either a wiki file name (with or without the `File:`, `Image:` or `文件:` prefix)
  or a URL. A URL is absolute (`https://example.com/a.mp3`), protocol-relative
  (`//example.com/a.mp3`) or a path on the wiki's own site that points at a file the wiki
  serves (`/images/a/ab/a.mp3`, see [Paths on the wiki's own site](#paths-on-the-wikis-own-site)).
- Options only switch on with the exact value `yes`. Unknown options are ignored.
- Every option can also be a tag attribute, see [Options as attributes](#options-as-attributes).

Options of `<gramophone>`:

| Option | Meaning |
| --- | --- |
| `autostart=yes` | Try to start playing when the page loads. Browsers may block this, and then the player asks the reader to press play. Audio on another site starts only where the wiki allows it, see [Loading before a click](configuration.md#loading-before-a-click). |
| `loop=yes` | Repeat the whole playlist. |
| `openplaylist=yes` | Show the playlist when the page loads. |

Options of `<playbutton>`:

| Option | Meaning |
| --- | --- |
| `title=` | The button's name, see [A readable title](#a-readable-title). |
| `hidemissing=yes` | Hide the button when none of its files exist, see [Hiding buttons whose file is missing](#hiding-buttons-whose-file-is-missing). |

With several files, one button plays them one after another. A file list player ignores `title`
and `hidemissing`, and a button ignores `autostart`, `loop` and `openplaylist`.

The colour options `bg`, `text`, `tracker` and `track` apply only when
`$wgGramophoneLegacyColors` is `true`, see [migrating.md](migrating.md#colours). To colour a
player, use the [`style` attribute](theming.md#one-player) instead.

#### A readable title

`title=` names a button. Without it, the button is named after the file.

```wikitext
<playbutton title="Div.A3 (preview)">Div.A3.mp3</playbutton>
```

- The title is the button's tooltip, its name for screen readers ("Play Div.A3 (preview)"), the
  title in the system media controls (lock screen, media keys) and the text of the plain link
  shown without JavaScript.
- With several files, each one gets the title. The tooltip adds the number of the file being
  played, for example "Intro (Track 2 of 3)".
- A title that contains `|` or `=` must be written as an attribute.
- For track titles in a full player, use a JSON playlist.

#### Hiding buttons whose file is missing

`hidemissing=yes` hides the button when none of its files exist. It suits templates that emit
a button for every possible line, such as voice-line tables where some lines were never
recorded.

```wikitext
<playbutton hidemissing="yes">Line 13.mp3</playbutton>
<playbutton hidemissing="yes">https://audio.example.org/voice/line_13.mp3</playbutton>
```

How each file is checked:

- A wiki file is checked when the page is parsed. A file that does not exist, or an address
  that cannot be used, counts as missing without any request.
- A URL is checked by the script with a HEAD request, but only when it may load before a
  click: a path on the wiki's own site always, a URL on another site only where the wiki allows
  it (see [Loading before a click](configuration.md#loading-before-a-click)). A URL that may not
  is not checked, so its button stays visible. With the default settings this is the case for
  every URL on another site.
- Only a 404 or 410 answer counts as missing. Files on another site can only be checked when
  that site sends CORS headers for the wiki (`Access-Control-Allow-Origin`), also with its 404
  answers. Without them, after a network error or after 5 seconds without an answer, the file
  counts as present.
- The script checks a button once it is displayed and within about two screen heights of the
  part of the page in view. Until then, and until the answers arrive, the button is invisible
  but keeps its space. A button in a closed tab, a folded section or a part of a wide table
  scrolled out of view sideways waits until it is shown, and buttons further down wait until
  the reader scrolls near them.
- At most 6 requests run at a time on the page. Each one gets 5 seconds from when it is sent.
  After a timeout the remaining checks for that site are skipped, and their buttons stay
  visible.
- A button that stays plays only the files that can exist: files that answered 404 or 410
  are skipped.
- The browser console lists each 404 answer as a failed request.
- Without JavaScript the plain link is shown, as for every button. If the script does not run,
  for example while a browser still has the previous version cached after an update, the button
  appears after 10 seconds and is never hidden.
- While the script checks a button, the button has the class `ext-gramophone-checking`. A
  button that stays gets `ext-gramophone-checked`.
- A hidden button gets the `hidden` attribute, so site CSS can hide a label next to it, for
  example `.voice-line:has(> .ext-gramophone-button[hidden]) { display: none; }`.

### JSON playlist

```wikitext
<gramophone>
{
  "isPlaylistOpen": true,
  "playlist": [
    {
      "audioFileUrl": "Bubblin.mp3",
      "title": "Bubblin'",
      "artist": "HIMEHINA",
      "album": "Bubblin",
      "coverImageUrl": "Bubblin cover.jpg",
      "lrcFileUrl": "Bubblin.lrc",
      "lrcFileOffset": -250,
      "navigationUrl": "Bubblin'"
    }
  ]
}
</gramophone>
```

Player fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `playlist` | array | Required. One object per track. |
| `loop` | boolean | Repeat the whole playlist. |
| `autoPlay` | boolean | Try to start playing when the page loads, as `autostart=yes` does. |
| `isPlaylistOpen` | boolean | Show the playlist when the page loads. |
| `backgroundColor`, `foregroundColor`, `trackColor`, `thumbColor` | string | Colours: 3 or 6 hex digits, with an optional `#` or `0x` prefix. Invalid colours are ignored. |
| `schemaVersion` | number | Accepted for compatibility with Sm2Shim. |

Track fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `audioFileUrl` | string | Required. Wiki file name or URL. |
| `title`, `artist`, `album` | string | Shown in the player and in the system media controls. Without a title the file name is used. |
| `isExplicit` | boolean | Shows an explicit content badge. |
| `coverImageUrl` | string | Wiki file name or URL. Wiki images are shown as a 240 px thumbnail. A cover on another site is shown only where the wiki allows it, see [Loading before a click](configuration.md#loading-before-a-click). |
| `lrcFileUrl` | string | Wiki file name or URL of an LRC lyrics file. |
| `lrcFileOffset` | number | Milliseconds added to every lyrics timestamp. |
| `navigationUrl` | string | Page title or URL that the track links to, including any path on the wiki's own site. By default a wiki file links to its file page. |

- URLs take the same three forms as in a file list. Addresses in other schemes (for example
  `javascript:` or `data:`) are never used.
- Fields with the wrong type are ignored.
- Playlist entries are skipped when they are `null`, are not objects, or have no
  `audioFileUrl` that is non-empty text. The tag shows an error message in place of the player
  only when the JSON is invalid or when no playable entry is left.
- Attributes other than `class` and `style` are ignored.

#### Lyrics

Lyrics are LRC files: each line starts with the time it is sung, as `[mm:ss.xx]`. A line may have
several times. A file without any times is shown as plain text that does not scroll along.

To use an LRC file uploaded to the wiki, `lrc` must be an allowed upload extension, see
[Uploading audio and lyrics](configuration.md#uploading-audio-and-lyrics). LRC files in UTF-8
and in the older Chinese encoding GB18030 both work.

**Translations.** When several lines of the LRC file share a time, the first is the lyric and
the others are its translations. They appear under it in smaller, muted text, in file order,
and empty ones are skipped. The lyric and its translations light up and scroll together.

```
[00:12.30]Lanterns drift across the harbour
[00:12.30](the harbour lights float on the water)
```

A lyrics file larger than 1 MiB is refused, and the lyrics panel shows its error message. Of a
long file, at most 5,000 lines and translations together, with at most 1 Mi characters in all,
are kept.

## Options as attributes

Every option of the file list can also be written as a tag attribute. That is the form that
`#tag` in templates and `frame:extensionTag` in Lua modules produce:

```wikitext
<playbutton hidemissing="yes" title="Ripple (preview)">Ripple.mp3</playbutton>
{{#tag:playbutton|Ripple.mp3|hidemissing=yes|title=Ripple (preview)}}
```

```lua
frame:extensionTag{ name = 'playbutton', content = 'Ripple.mp3', args = { hidemissing = 'yes' } }
```

- The values follow the same rules as in the content: options only switch on with the exact
  value `yes`, and spaces around a value are ignored.
- When an option is given both ways, the one in the content wins.
- `<nowiki>` inside a `#tag` argument is read as its text, after the content is split into files
  and options: `{{#tag:playbutton|A.mp3|title=Hello<nowiki>!</nowiki>}}` is titled "Hello!", and
  a `|` or `,` inside `<nowiki>` does not separate, so
  `{{#tag:playbutton|https://example.com/a<nowiki>|</nowiki>b.mp3}}` plays one file. The output of
  other tags, such as `<ref>`, is removed rather than shown as stray marker text. The same holds
  for the values of a JSON playlist given through `#tag`, whose JSON may also be wholly inside
  `<nowiki>` (the `}}` of the JSON would otherwise end the `#tag`).
- `class` and `style` style the player, see [theming.md](theming.md#one-player). `id` and other
  attributes are ignored.

## Paths on the wiki's own site

An audio, cover or lyrics path on the wiki's own site is used only when it points at a file the
wiki serves:

- under `$wgUploadPath`, when that is a path or a URL on the wiki's own host:
  `/images/a/ab/a.mp3`
- under `img_auth.php` in `$wgScriptPath`: `/w/img_auth.php/a/ab/a.mp3`
- Special:FilePath or Special:Redirect/file/, under any of their names, including translated
  ones, in the article path form or the `index.php?title=` form:
  `/wiki/Special:FilePath/A.mp3`, `/w/index.php?title=Special:Redirect/file/A.mp3`. A `curid`
  parameter is not allowed, because it would show another page.

Any other path, such as `/wiki/Main_Page` or `/w/api.php?action=query`, is refused, and so is a
path with a `.` or `..` segment (also percent-encoded, as in `..%2F` or `%2e%2e`), a backslash
(also `%5C`), a control character or a percent sign (`%25`, which some servers decode twice).
A title with an entity such as `&#58;` is read as text, as MediaWiki reads it, and a query with
more parameters than PHP's `max_input_vars` (1,000 by default) is refused. A refused path counts
as a missing file: the track shows as missing and the page joins the missing-file category.

The reason: the reader's browser would request any other path with the reader's cookies.

A full URL to a host that gets the wiki's cookies follows the same rules: the wiki's own host,
such as `https://wiki.example.org/images/a/ab/a.mp3`, on any port, because browsers send the
wiki's cookies to every port of a host, and any host within `$wgCookieDomain`. The host counts
however it is spelled: letter case, percent-encoding (`wik%69.example.org`), fullwidth letters,
soft hyphens and one trailing dot do not matter. An audio, cover or lyrics URL whose host
browsers would refuse, or would read as an IPv4 address written other than as four decimal
numbers (such as `http://2130706433/` or `http://127.1/`), is not usable. `navigationUrl`
accepts any path on the site, because the reader follows it with a click.

## Missing files and links

A wiki file that does not exist is shown as a red link to the upload form, and the page is
added to a tracking category. The same category catches audio, cover and lyrics references
that are neither a valid file name nor a usable URL, URLs on a host that
`$wgGramophoneAllowedHosts` does not allow, paths on the wiki's own site that do not point at a
file it serves, and covers on another site that may not load before a click.

The references are recorded like ordinary links:

- audio, cover and lyrics files count as file usage, so they appear under "File usage" on
  the file page and the page is updated after an upload
- `navigationUrl` page titles count as links to those pages (Special:WhatLinksHere)
- URLs on other sites, absolute or protocol-relative, count as external links, so
  Special:LinkSearch and spam filters such as SpamBlacklist see them. They are output and
  recorded in the form MediaWiki gives external links: escapes that need none are decoded
  (`ex%61mple.org` becomes `example.org`), unsafe characters are encoded and `.` and `..`
  segments are resolved.
- Links to other sites get `rel="nofollow"` wherever a wikitext link to the same URL would,
  following `$wgNoFollowLinks`, `$wgNoFollowNsExceptions` and `$wgNoFollowDomainExceptions`.
  That covers the plain fallback link to audio on another site, and the player's download and
  file page links that lead to another site (`rel="noopener nofollow"`). The player decides per
  track: when either the audio or the `navigationUrl` of a track qualifies, both of its links to
  other sites get it.

## Language variants

On wikis with language variants, such as Chinese, titles, artists and albums are shown in
the reader's variant (for example zh-hans text is shown as zh-tw), like the rest of the page.
Conversion markup such as `-{...}-` works in these fields. The page switch
`__NOCONTENTCONVERT__` does not reach the player, so its text is still converted.

## Track limit

The players on one page can have at most 5,000 tracks together, counted over all the tags,
also when Parsoid renders the page. Playlist entries that are skipped do not count. To keep a
long playlist cheap to read, a JSON playlist with more objects (outside strings) than the tracks
the page has left, plus one, is refused before it is read, even when some of those objects would
be skipped. The tag that would go over the limit shows this error in place of its player and
plays nothing:

> Audio player error: This page has too many audio tracks. The players on one page can have at
> most 5,000 tracks together.

The text comes from the messages `gramophone-error` and `gramophone-too-many-tracks`. The page
joins the category of pages with audio players. Later tags that still fit render as usual.
