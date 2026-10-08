# Moving from Sm2Shim, FlashMP3 or AudioButton

Gramophone understands the tags of these older extensions, so pages written for them keep
working without edits. Each old tag is another name for a Gramophone tag:

| Old tag | Works like | Notes |
| --- | --- | --- |
| `<flashmp3>` (FlashMP3, Sm2Shim) | `<gramophone>` with a file list | `<flashmp3 type="lastfm">` renders nothing, as before |
| `<sm2>` (Sm2Shim) | `<playbutton>` | |
| `<modernsoundmanager>` (Sm2Shim) | `<gramophone>` with a JSON playlist | |
| `<ab>` (AudioButton) | `<playbutton>` with one file | only with `$wgGramophoneAudioButtonTag = true` |

The first three are registered while `$wgGramophoneSm2ShimTags` is `true`, which is the
default. New pages can use `<gramophone>` and `<playbutton>`, and both styles can sit on the same
page. [reference.md](reference.md) has the syntax, which is the same for the old names.

## From Sm2Shim or FlashMP3

1. Install Gramophone as described in the [README](../README.md#install).
2. In `LocalSettings.php`, replace `wfLoadExtension( 'Sm2Shim' );` (or the old
   `require_once` line for `Sm2Shim.php`) with `wfLoadExtension( 'Gramophone' );`.
   Do not load both, because both register the same tags. The old `extensions/Sm2Shim`
   folder can stay on disk unloaded, or be deleted.
3. Remove old settings such as `$wgSm2Shim_UseResourceManager`. They are ignored.

Pages that were rendered by the old extension stay in the parser cache until they are
parsed again. To refresh all of them at once, set `$wgCacheEpoch` to the time of the
upgrade, or purge the pages that use the tags. A CDN in front of the wiki keeps its copies
until `$wgCdnMaxAge` runs out or the pages are purged. After the first parse every such page
is listed in the tracking category "Pages with audio players".

The interface messages now start with `gramophone-` instead of `sm2shim-`. Copy any message
that was customised on the wiki (for example MediaWiki:Sm2shim-error) to its new name
(MediaWiki:Gramophone-error).

### Differences from Sm2Shim

- The colour options are ignored by default, see [Colours](#colours).
- Options with spaces around them (`| loop = yes`) now work.
- `autostart=yes` and `"autoPlay": true` still depend on the browser. When it blocks
  autoplay, the player asks the reader to press play.
- A wiki file that does not exist is shown as a red link to the upload form. Sm2Shim passed
  the bare name to the player as an address, which could not play.
- Addresses in other schemes, such as `ftp:`, `mailto:`, `javascript:` or `data:`, are not
  played or linked.
- Files on other sites load before a click only where the wiki allows it, see
  [Audio from other sites](configuration.md#audio-from-other-sites). With the default settings a
  cover on another site is left out, `hidemissing=yes` does not check audio on another site (the
  button stays visible), and a player with audio on another site does not start on its own.
  Audio on other sites still plays when the reader presses play.
- A path on the wiki's own site plays only when it points at a file the wiki serves, such as
  `/images/a/ab/a.mp3`. Other paths show as a missing file, see
  [Paths on the wiki's own site](reference.md#paths-on-the-wikis-own-site).
- The players on one page can have at most 5,000 tracks together, see
  [Track limit](reference.md#track-limit).

### Colours

Flash-era pages often carry colours, such as `<flashmp3>Song.mp3|bg=98c5e9|text=000</flashmp3>`.
They would hide the site theme, so Gramophone ignores the colour options of the file list
(`bg`, `text`, `tracker` and `track`) unless this is in `LocalSettings.php`:

```php
$wgGramophoneLegacyColors = true;
```

With the setting on, colours take 3 or 6 hex digits, with an optional `#` or `0x` prefix, for
example `98c5e9`, `#FFF` or `0x3A7194`. Invalid colours are ignored. Colours in a JSON playlist
always apply, whatever this setting says.

| Option | Colour of |
| --- | --- |
| `bg=` | the background |
| `text=` | the text and icons |
| `tracker=` | the progress track |
| `track=` | the progress thumb |

## From AudioButton

Pages written for the `<ab>` tag of the [AudioButton](https://github.com/NilsEnevoldsen/AudioButton)
extension, which Fandom and wiki.gg provide, keep working:

1. In `LocalSettings.php`, replace `wfLoadExtension( 'AudioButton' );` with
   `wfLoadExtension( 'Gramophone' );`. Do not load both: some AudioButton versions register
   `<sm2>` as well, and when two extensions register the same tag, only one of them renders it.
2. Add `$wgGramophoneAudioButtonTag = true;`.

```wikitext
<ab>Greeting.mp3</ab>
<ab title="Greeting" hidemissing="yes">Greeting.mp3</ab>
```

- As in AudioButton, the content is one file name, or here also a URL. Commas, quotes and `|`
  are part of the name, so `<ab>` plays one file.
- Templates and template parameters in the content are expanded, as in AudioButton, so a
  template can contain `<ab>{{{1}}}</ab>`.
- The options of `<playbutton>`, such as `title` and `hidemissing`, are written as attributes,
  and so are `class` and `style`.
- AudioButton's `preload` attribute is ignored, because no audio is downloaded before the reader
  presses play. Its `vol` attribute is ignored too: all players on a page share one volume,
  which the reader sets and the browser remembers.
- A missing file shows a red link and adds the page to the missing-file category.

## From Piran Symphony Orchestra

Gramophone was called Piran Symphony Orchestra before, and lived in another repository.

1. Install Gramophone as described in the [README](../README.md#install), as
   `extensions/Gramophone`.
2. In `LocalSettings.php`, replace `wfLoadExtension( 'PiranSymphonyOrchestra' );` with
   `wfLoadExtension( 'Gramophone' );`. Do not load both, because both register the same tags.
   The old `extensions/PiranSymphonyOrchestra` folder can stay on disk unloaded, or be deleted.
3. Rename the settings, site CSS, TemplateStyles sheets, site scripts and customised messages
   that use the old names, as in the table below.
4. Set `$wgCacheEpoch` so every page is parsed again: the old markup does not load the new
   player.

Every public name changed:

| Before | Now |
| --- | --- |
| `$wgPSOAllowedHosts`, `$wgPSOLegacyColors`, `$wgPSOAudioButtonTag` | `$wgGramophoneAllowedHosts`, `$wgGramophoneLegacyColors`, `$wgGramophoneAudioButtonTag` |
| custom properties `--pso-…` | `--gramophone-…` |
| classes `.ext-pso`, `.ext-pso-player`, `.ext-pso-button`, `.ext-pso-tooltip`, `.ext-pso-checking`, `.ext-pso-checked`, `.ext-pso-fallback`, `.ext-pso-fallback-link`, `.ext-pso-error` | the same with `ext-gramophone` in place of `ext-pso` |
| attributes `data-pso-state`, `data-pso-layout` | `data-gramophone-state`, `data-gramophone-layout` |
| ResourceLoader modules `ext.pso`, `ext.pso.player`, `ext.pso.styles` | `ext.gramophone`, `ext.gramophone.player`, `ext.gramophone.styles` |
| messages `pso-…` (MediaWiki:Pso-…) | `gramophone-…` (MediaWiki:Gramophone-…). `pso-extensionname` is gone: the name Gramophone is not translated. |

The part names for `::part()` did not change. Readers' volume setting is stored under a new
name, so each reader's volume starts at the default once.
