# Gramophone

Gramophone is a MediaWiki extension that plays music on wiki pages. It can put a whole album
in one player, with cover art and a track list. It can show lyrics that light up as the song
plays. And it can add small play buttons to sentences and tables.

Coming from Sm2Shim, FlashMP3 or AudioButton? Gramophone understands their tags too, so your
pages keep working without edits. See [Moving from Sm2Shim, FlashMP3 or AudioButton](#moving-from-sm2shim-flashmp3-or-audiobutton).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/album-dark.png">
  <img alt="A music player showing the album Galaxy Triangle by La prière, with its cover, playback controls and the track list open. Galactic Love is playing." src="docs/screenshots/album-light.png" width="664">
</picture>

## Features

- Playlists with cover art, titles, artists and albums, and controls for repeat, speed and
  volume.
- Synced lyrics from LRC files, with optional translation lines. Clicking a line seeks to it.
- Inline play buttons for text and table cells, with a progress ring. One button can play
  several files in turn.
- A one-line player for a single track in a table cell, and a narrow layout for phones and
  infoboxes.
- Audio from wiki uploads, also from a shared repository such as Commons, or from other sites,
  with an optional list of allowed sites.
- Audio loads only when the reader presses play. Players are set up as they scroll into view.
- Keyboard and screen reader support, dark mode, and the system media controls (lock screen,
  media keys). Without JavaScript, pages show plain links to the audio.
- Styling with CSS custom properties and `::part()` rules, for the whole wiki or one player. See
  [Change the look](#change-the-look).
- No Composer, database tables, ffmpeg or job queue needed.
- Compatible with the tags of Sm2Shim, FlashMP3 and AudioButton.

## See it

Synced lyrics with a translation under each line:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/lyrics-dark.png">
  <img alt="The player showing Bubblin' by HIMEHINA with its lyrics panel open. The current line and its Japanese translation are highlighted." src="docs/screenshots/lyrics-light.png" width="664">
</picture>

One song:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/single-dark.png">
  <img alt="The player showing Mukyu Platonic by VALIS with its cover, during playback" src="docs/screenshots/single-light.png" width="664">
</picture>

Play buttons in a sentence and in a track list. The ring shows how far the song has played:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/buttons-dark.png">
  <img alt="A wiki article about Galaxy Triangle with round play buttons after song names in the text and in each row of a track list. One button shows a pause icon inside a progress ring." src="docs/screenshots/buttons-light.png" width="799">
</picture>

A single song in a table cell plays in a one-line player:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/track-list-dark.png">
  <img alt="A wiki table of songs with a one-line player in each row: a play button, the time and a seek bar" src="docs/screenshots/track-list-light.png" width="664">
</picture>

On a phone, or in a narrow box such as an infobox, the player gets narrower:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/phone-dark.png">
  <img alt="A wiki article on a phone screen, with the player in its narrow layout inside an infobox and a play button in a paragraph" src="docs/screenshots/phone-light.png" width="375">
</picture>

The pictures come from the demo page in `client/demo/`. Music: "Galaxy Triangle" by La prière,
"Bubblin'" by HIMEHINA and "Mukyu Platonic" by VALIS. The demo plays their 30-second previews
from Apple Music and shows their cover art, which belong to the artists and their labels. The
audio and cover files are downloaded when the demo runs, and are not part of this repository. The
lyric lines in the demo explain the player. They are not the song's lyrics.

## Gramophone or TimedMediaHandler?

[TimedMediaHandler](https://www.mediawiki.org/wiki/Extension:TimedMediaHandler) is the media
extension that Wikipedia and Wikimedia Commons use. It plays uploaded audio and video files that
a page embeds like an image, as in `[[File:Song.ogg]]`. It is the better choice for video, and
for wikis that need every file converted into formats that all browsers play.

Gramophone is built for pages about music and sound: album and song articles, game soundtracks
and voice lines, language pages with pronunciations.

| | Gramophone | TimedMediaHandler |
| --- | --- | --- |
| How you add audio | `<gramophone>` and `<playbutton>` tags | `[[File:Song.ogg]]`, like an image |
| Albums and playlists | one player with a track list and cover art | one player per file |
| Lyrics | synced lyrics (LRC files) that scroll in the player, with translations | subtitles (WebVTT or SRT) on TimedText pages. Audio with subtitles opens in a pop-up player. |
| Play buttons in text and tables | small round buttons with a progress ring, several files per button | a small file player (`[[File:A.ogg\|40px]]`) |
| Audio on other sites | yes, with an optional list of allowed sites | no, only wiki files, also from a shared repository such as Commons |
| Video | no | yes |
| Formats that a browser cannot play, such as MIDI | the file is played as uploaded, so upload an MP3 of such audio | converted by ffmpeg, MIDI rendered to audio |
| Editing | the tags are edited as text | inserted with VisualEditor's media dialog, like images |
| Server setup | `wfLoadExtension` only | Composer, `update.php`, and ffmpeg with a job runner |
| MediaWiki versions | one version for 1.43 and later | a branch for each MediaWiki release |

**You can run both.** They do not get in each other's way: `[[File:Song.mp3]]` shows
TimedMediaHandler's player, and `<gramophone>Song.mp3</gramophone>` shows Gramophone's player
for the same file. Gramophone always plays the uploaded file, never TimedMediaHandler's
converted copies.

## Install

You need MediaWiki 1.43 or later (tested on 1.43, 1.45 and 1.46) and PHP 8.1 or later.

1. Clone the extension into `extensions/Gramophone`:

   ```sh
   git clone https://github.com/Laoweek/mediawiki-extensions-Gramophone.git extensions/Gramophone
   ```

2. Add this line to `LocalSettings.php`:

   ```php
   wfLoadExtension( 'Gramophone' );
   ```

3. To upload audio and lyrics, allow their file types. MediaWiki allows only images by default:

   ```php
   $wgFileExtensions[] = 'mp3';
   $wgFileExtensions[] = 'lrc';
   ```

4. Open Special:Version and check that Gramophone is listed.

The clone also contains `client/`, `dev/` and `.git/`, with demo pages, scripts and the settings
of a test wiki. No reader needs them, so block web access to them.

<details>
<summary>Server rules that block the development folders</summary>

Apache, in the server configuration (or in `.htaccess`, if `AllowOverride` includes `FileInfo`):

```apache
RedirectMatch 404 /extensions/Gramophone/(\.git|client|dev)(/|$)
```

nginx, in the `server` block, above the other `location ~` blocks. If a `location ^~` block
covers the `extensions/` folder, put the rule inside that block instead:

```nginx
location ~ /extensions/Gramophone/(\.git|client|dev)(/|$) {
    deny all;
}
```

</details>

<details>
<summary>Installing without git</summary>

Download the latest `main` and unpack it as `extensions/Gramophone`. This download leaves out
the development folders:

```sh
mkdir extensions/Gramophone
curl -fsSL https://github.com/Laoweek/mediawiki-extensions-Gramophone/archive/refs/heads/main.tar.gz \
    | tar -xz --strip-components=1 -C extensions/Gramophone
```

</details>

## How to use it

Gramophone gives you two tags:

- `<gramophone>` puts a music player on the page.
- `<playbutton>` puts a small play button in a sentence or a table cell.

Both take a wiki file name (with or without `File:`) or the web address of an audio file.

The old tags `<flashmp3>`, `<sm2>` and `<modernsoundmanager>` (Sm2Shim and FlashMP3) still work
and show the same players, and so does `<ab>` (AudioButton) after one setting. New pages can use
the two tags above.

### One song

```wikitext
<gramophone>Mukyu Platonic.mp3</gramophone>
```

The player shows the file name as the title. To show the real title, the artist and a cover,
write the song as a small playlist in JSON:

```wikitext
<gramophone>
{
  "playlist": [
    {
      "audioFileUrl": "Mukyu Platonic.mp3",
      "title": "Mukyu Platonic",
      "artist": "VALIS",
      "coverImageUrl": "Mukyu Platonic cover.jpg"
    }
  ]
}
</gramophone>
```

### A whole album

Add one entry per song. `"isPlaylistOpen": true` shows the track list when the page opens:

```wikitext
<gramophone>
{
  "isPlaylistOpen": true,
  "playlist": [
    { "audioFileUrl": "Div.A3.mp3", "title": "Div.A3", "artist": "La prière", "album": "Galaxy Triangle", "coverImageUrl": "Galaxy Triangle cover.jpg" },
    { "audioFileUrl": "Diva of the Battlefield.mp3", "title": "Diva of the Battlefield", "artist": "La prière", "album": "Galaxy Triangle", "coverImageUrl": "Galaxy Triangle cover.jpg" },
    { "audioFileUrl": "Galactic Love.mp3", "title": "Galactic Love", "artist": "La prière", "album": "Galaxy Triangle", "coverImageUrl": "Galaxy Triangle cover.jpg" }
  ]
}
</gramophone>
```

For a quick list without details, separate the files with commas:

```wikitext
<gramophone>Div.A3.mp3, Diva of the Battlefield.mp3, Galactic Love.mp3</gramophone>
```

### Lyrics

Upload the lyrics as an [LRC file](https://en.wikipedia.org/wiki/LRC_(file_format)), a text
file where each line starts with the time it is sung. Then point the song at it:

```wikitext
<gramophone>
{
  "playlist": [
    {
      "audioFileUrl": "Bubblin.mp3",
      "title": "Bubblin'",
      "artist": "HIMEHINA",
      "coverImageUrl": "Bubblin cover.jpg",
      "lrcFileUrl": "Bubblin.lrc"
    }
  ]
}
</gramophone>
```

A translation goes on the next line, with the same time:

```
[00:11.00]Click a line to jump to that moment
[00:11.00]行をクリックすると、その瞬間へ移動します
```

The lyrics button appears in the player. If the lyrics run early or late, add
`"lrcFileOffset": 500` (milliseconds) to the song.

### Play buttons

```wikitext
The album opens with Div.A3 <playbutton>Div.A3.mp3</playbutton> and ends with E Div. <playbutton>E Div.mp3</playbutton>

{| class="wikitable"
! # !! Song !! Preview
|-
| 1 || Div.A3 || <playbutton title="Div.A3">Div.A3.mp3</playbutton>
|-
| 2 || Diva of the Battlefield || <playbutton title="Diva of the Battlefield">Diva of the Battlefield.mp3</playbutton>
|}
```

- `title` names the button for its tooltip, for screen readers and for the lock screen.
- With several files, separated by commas, one button plays them one after another.
- `hidemissing="yes"` hides the button when its file does not exist. This suits templates that
  add a button for every line, where some recordings are missing.

### In templates

Write options as attributes, or use `#tag` with template parameters:

```wikitext
<playbutton title="Greeting" hidemissing="yes">Greeting.mp3</playbutton>
{{#tag:playbutton|{{{file}}}|title={{{name}}}|hidemissing=yes}}
```

Wrap a JSON playlist inside `#tag` in `<nowiki>`, so that a `}}` in the JSON does not end the
`#tag`.

### Audio on other sites

A web address works in place of a file name:

```wikitext
<gramophone>https://audio.example.org/songs/mukyu-platonic.mp3</gramophone>
```

The reader's browser contacts that site only when the reader presses play, unless your settings
allow more. To allow only some sites, see [Settings](#settings).

### Options

| Where | Option | What it does |
| --- | --- | --- |
| `<gramophone>` | `loop=yes`, or `"loop": true` in JSON | repeat the playlist |
| `<gramophone>` | `openplaylist=yes`, or `"isPlaylistOpen": true` | show the track list when the page opens |
| `<gramophone>` | `autostart=yes`, or `"autoPlay": true` | try to start playing at once. Browsers often block this, and then the player waits for play. |
| `<playbutton>` | `title=` | the button's name |
| `<playbutton>` | `hidemissing=yes` | hide the button when its file is missing |
| both | `class` and `style` attributes | style this one player, see [Change the look](#change-the-look) |

In a file list, options follow the files after `|`, as in `<gramophone>Ripple.mp3|loop=yes</gramophone>`,
or they are attributes, as in `<gramophone loop="yes">Ripple.mp3</gramophone>`. With a JSON
playlist, put the options in the JSON: attributes other than `class` and `style` are ignored.

Song fields in a JSON playlist:

| Field | What it is |
| --- | --- |
| `audioFileUrl` | Required. The wiki file name or web address of the audio. |
| `title`, `artist`, `album` | Shown in the player and on the lock screen. Without a title, the file name is shown. |
| `coverImageUrl` | The cover picture: a wiki file name or web address. |
| `lrcFileUrl` | The lyrics: a wiki file name or web address of an LRC file. |
| `lrcFileOffset` | Milliseconds added to every lyrics time. |
| `navigationUrl` | The page or web address the song links to. By default a wiki file links to its file page. |
| `isExplicit` | `true` shows an explicit content badge. |

[docs/reference.md](docs/reference.md) has the exact rules for every tag, option and field.

## Settings

All settings are optional. Put them in `LocalSettings.php` after `wfLoadExtension( 'Gramophone' );`.

| Setting | Default | What it does |
| --- | --- | --- |
| `$wgGramophoneAllowedHosts` | `null` | The other sites that audio, covers and lyrics may come from, such as `[ 'audio.example.org' ]`. `null` allows every site. |
| `$wgGramophoneSm2ShimTags` | `true` | Also register the `<flashmp3>`, `<sm2>` and `<modernsoundmanager>` tags of Sm2Shim and FlashMP3. |
| `$wgGramophoneAudioButtonTag` | `false` | Also register the `<ab>` tag of AudioButton. |
| `$wgGramophoneLegacyColors` | `false` | Apply the Flash-era colour options (`bg=` and the like) of old pages. |

**Privacy.** A site that hosts audio sees the reader's IP address when the reader presses play.
By default, nothing from another site loads before that click: a cover on another site is left
out, and autoplay waits. [docs/configuration.md](docs/configuration.md) explains how to allow
more, and covers uploads and Content Security Policy.

## Moving from Sm2Shim, FlashMP3 or AudioButton

Replace the old `wfLoadExtension` line with `wfLoadExtension( 'Gramophone' );`. Pages written
for the old tags keep working without edits:

| Old tag | Works like |
| --- | --- |
| `<flashmp3>` | `<gramophone>` with a file list |
| `<sm2>` | `<playbutton>` |
| `<modernsoundmanager>` | `<gramophone>` with a JSON playlist |
| `<ab>` | `<playbutton>`, after you set `$wgGramophoneAudioButtonTag = true;` |

[docs/migrating.md](docs/migrating.md) lists the steps and the small differences, for example
that old Flash-era colours are ignored unless you turn them back on.

## Change the look

The players follow the wiki's theme, including dark mode, and need no setup. To give them your
own look, use CSS:

- **Custom properties** such as `--gramophone-primary` (the accent colour), `--gramophone-radius`
  and `--gramophone-font-family`. Set them in MediaWiki:Common.css for every player, or in a
  tag's `style` attribute for one player.
- **`::part()` rules** in MediaWiki:Common.css restyle or hide one piece of the player, such as
  the cover or the download button.
- **Colours in a JSON playlist** colour one player.

The same song in five looks:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/styles-dark.png">
  <img alt="The same song in five player styles: the default look, a teal accent colour, square corners with a serif font, a compact player without the cover, and dark colours set in the playlist" src="docs/screenshots/styles-light.png" width="664">
</picture>

**Accent colour.** For one player, use the `style` attribute:

```wikitext
<gramophone style="--gramophone-primary: #1f7a8c">Ripple.mp3</gramophone>
```

For every player on the wiki, add this to MediaWiki:Common.css:

```css
.ext-gramophone {
	--gramophone-primary: #1f7a8c;
}
```

**Square corners and a serif font.** Give the tag a class, as in
`<gramophone class="square">Ripple.mp3</gramophone>`, and style that class in
MediaWiki:Common.css:

```css
.ext-gramophone.square {
	--gramophone-radius: 0px;
	--gramophone-shadow: none;
	--gramophone-font-family: Georgia, serif;
}
.ext-gramophone.square::part(play-button) {
	border-radius: 0;
}
```

**Compact, without the cover.** For `<gramophone class="compact">`:

```css
.ext-gramophone.compact::part(cover),
.ext-gramophone.compact::part(download-button),
.ext-gramophone.compact::part(file-page-button),
.ext-gramophone.compact::part(speed-button) {
	display: none;
}
.ext-gramophone.compact::part(bar) {
	grid-template-columns: minmax(0, 1fr);
	grid-template-areas: "meta" "ctrl";
}
```

**Colours in the playlist.** They apply in light and dark mode, and the player adjusts its other
shades so the text stays readable:

```wikitext
<gramophone>
{
  "backgroundColor": "#1b1f3b",
  "foregroundColor": "#f2e9e4",
  "playlist": [
    { "audioFileUrl": "Ripple.mp3", "title": "Ripple", "artist": "La prière" }
  ]
}
</gramophone>
```

[docs/theming.md](docs/theming.md) lists every property and part, and explains TemplateStyles
support.

## Updating

Pull the latest `main`:

```sh
git -C extensions/Gramophone pull
```

Without git, delete `extensions/Gramophone` and download `main` again as under [Install](#install).

Every change is tested before it goes into `main`. Gramophone has no database tables, so
`update.php` is not needed. A change that alters what existing wikitext shows, or renames part of
the styling, says so in its commit message. Pages show such a change once they are parsed again:
purge them, or set `$wgCacheEpoch` to refresh every page.

Security fixes are announced as
[GitHub security advisories](https://github.com/Laoweek/mediawiki-extensions-Gramophone/security/advisories).
To get notified, choose **Watch**, then **Custom**, and tick **Security alerts** on the
repository page.

## Browser support

Gramophone is built for current Chrome, Edge, Firefox and Safari, on computers and phones. It is
tested in Google Chrome with the skins Vector, Citizen and Minerva. An earlier version was also
tested in WebKit, the engine of Safari. Firefox has not been tested yet. Reports are welcome.

Without JavaScript, or in a browser that cannot run the player, the page shows plain links to
the audio files.

## Documentation

- [docs/reference.md](docs/reference.md): every tag, option and field in detail
- [docs/configuration.md](docs/configuration.md): settings, audio from other sites, uploads,
  Content Security Policy, tracking categories
- [docs/theming.md](docs/theming.md): colours, sizes, parts and TemplateStyles
- [docs/migrating.md](docs/migrating.md): moving from Sm2Shim, FlashMP3, AudioButton or Piran
  Symphony Orchestra
- [CONTRIBUTING.md](CONTRIBUTING.md): how the code is laid out, and how to run the checks and the
  local test wiki

## License

MIT. See [LICENSE](LICENSE).

The player's icons come from [Lucide](https://lucide.dev) (ISC licence, parts derived from
Feather under the MIT licence). The full notices are at the top of `resources/dist/gramophone.js`
and `resources/dist/gramophone.player.js`.
