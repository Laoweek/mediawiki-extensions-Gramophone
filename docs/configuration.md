# Settings, privacy and security

This page is for wiki administrators. The short version is in the README under
[Settings](../README.md#settings).

## Settings

Put these in `LocalSettings.php`, after `wfLoadExtension( 'Gramophone' );`.

| Setting | Default | What it does |
| --- | --- | --- |
| `$wgGramophoneAllowedHosts` | `null` | The other sites that audio, cover and lyrics URLs may point to. Files on these sites may also load before a reader clicks (covers, `hidemissing` checks, autoplay). `null` allows every site, and MediaWiki's settings for external images decide what loads before a click. See [Audio from other sites](#audio-from-other-sites). |
| `$wgGramophoneSm2ShimTags` | `true` | Whether to register the `<flashmp3>`, `<sm2>` and `<modernsoundmanager>` tags of Sm2Shim and FlashMP3. Turn it off on a wiki that never used them, or that loads another extension with these tags. See [Moving from Sm2Shim, FlashMP3 or AudioButton](migrating.md). |
| `$wgGramophoneAudioButtonTag` | `false` | Whether to register the `<ab>` tag of the AudioButton extension. Do not load AudioButton at the same time. |
| `$wgGramophoneLegacyColors` | `false` | Whether the colour options `bg`, `text`, `tracker` and `track` of the file list syntax apply. When `false` they are ignored and the players use the site theme. Colours in a JSON playlist always apply. |

## Audio from other sites

Audio, covers and lyrics can come from other sites. Such a site sees the reader's IP address and
the referrer the browser sends (see `$wgReferrerPolicy`). The reader's browser contacts it:

- for audio, when the reader presses play
- for lyrics, when the reader opens the lyrics panel
- before any click only where the wiki allows it, see the next section: for a cover when the
  player is displayed, for the check of a `hidemissing=yes` button when the button is displayed,
  and for audio when the editor turned on autoplay

### Loading before a click

Wiki files, also from a shared repository such as Wikimedia Commons, and paths on the wiki's
own site that point at a file it serves always load before a click. A URL on another site does so
only when one of these settings allows it:

- `$wgGramophoneAllowedHosts` lists its host, see [Allowing only some sites](#allowing-only-some-sites)
- `$wgAllowExternalImages` is `true`
- it starts with a prefix listed in `$wgAllowExternalImagesFrom`
- `$wgEnableImageWhitelist` is `true` and a line of MediaWiki:External image whitelist matches it

The last three are MediaWiki's settings for images from other sites. Gramophone reads them as
MediaWiki does, except that the file extension does not matter. They also let editors show
images from those sites in wikitext. A protocol-relative URL (`//audio.example.org/a.mp3`) is
allowed when its `http:` or its `https:` form is. A full URL to the wiki's own host counts as
another site here. An empty prefix in `$wgAllowExternalImagesFrom` allows nothing here, while
MediaWiki reads it as allowing every site.

With the default settings (`$wgGramophoneAllowedHosts` is `null`, `$wgAllowExternalImages` is
`false`) no other site loads before a click:

- a cover on another site is left out, and the page joins the missing-file category
- a `hidemissing=yes` button does not check audio on another site, and stays visible
- a player with audio on another site does not start on its own, but waits for play

To let an audio host load before a click, add one of these to `LocalSettings.php`:

```php
// A URL prefix
$wgAllowExternalImagesFrom = [ 'https://audio.example.org/' ];

// Every site
$wgAllowExternalImages = true;

// Regular expressions on the page MediaWiki:External image whitelist, one per line,
// such as ^https://audio\.example\.org/
$wgEnableImageWhitelist = true;

// Only the listed hosts, see the next section
$wgGramophoneAllowedHosts = [ 'audio.example.org' ];
```

Pages keep the result of their last parse. After changing one of these settings, purge the pages
or set `$wgCacheEpoch`.

### Allowing only some sites

To allow only some sites, list them in `LocalSettings.php`:

```php
$wgGramophoneAllowedHosts = [ 'example.com', 'audio.example.org' ];
```

- An entry allows that host and its subdomains: `example.com` allows `example.com` and
  `cdn.example.com`, but not `badexample.com`. Hosts are compared as the browser contacts
  them: letter case, percent-encoding, fullwidth letters and one trailing dot do not matter,
  and a Unicode name matches its `xn--` form.
- Files on a listed host also load before a click.
- An audio, cover or lyrics URL on any other host is treated like an unusable address: it is not
  played or shown, and the page joins the missing-file category (see
  [Missing files and links](reference.md#missing-files-and-links)).
- Wiki files are always allowed, also when they come from a shared repository such as Wikimedia
  Commons, and so are paths on the wiki's own site that point at a file it serves
  (`/images/a/ab/a.mp3`). A full URL counts as another site even when it points at the wiki, so
  list the wiki's own host if pages use one.
- `navigationUrl` links are not affected, because the browser only follows them when the reader
  clicks.

## Uploading audio and lyrics

MediaWiki allows only image uploads by default. Add the types you upload:

```php
$wgFileExtensions[] = 'mp3';
$wgFileExtensions[] = 'lrc';
```

TimedMediaHandler adds its audio types (among them `mp3`, `ogg`, `opus`, `flac`, `wav` and
`mid`) by itself. `lrc` is always yours to add. If the uploads are served from another domain,
that domain must allow the wiki through CORS (`Access-Control-Allow-Origin`), because the player
downloads lyrics with a script.

Gramophone plays the uploaded file as it is. Ogg files (`.ogg`, `.oga`, `.opus`) play in Safari
only from macOS 15.4 and iOS 18.4, and browsers do not play MIDI. For such audio, upload an MP3 as
well and use that file in the tags.

## Content Security Policy

A wiki that sends a Content Security Policy must allow the following. The hosts include the
upload host when uploads are served from another domain.

| Directive | Needed for |
| --- | --- |
| `media-src` | audio |
| `img-src` | covers, and `data:` for the play icon of the placeholder shown before the script runs |
| `connect-src` | lyrics and the `hidemissing` checks, which the script downloads itself |
| `style-src` | `'unsafe-inline'` or a nonce, only for the tags' `style` attribute (as for any inline style in MediaWiki) and for browsers without constructable stylesheets |

The players style their shadow roots with constructable stylesheets and set colours through
the CSS object model, which a policy without `'unsafe-inline'` allows. A browser without
constructable stylesheets falls back to a `<style>` element, which needs `'unsafe-inline'` or a
nonce. Without `data:` in `img-src`, the placeholder has no play icon until the player appears.

## Tracking categories

Special:TrackingCategories lists both categories. Their names come from these messages and
can be changed on the wiki:

| Message | Default name | Pages |
| --- | --- | --- |
| `gramophone-tracking-category` | Pages with audio players | every page with one of the tags, including tags with an error |
| `gramophone-missing-file-category` | Pages with missing audio player files | pages that refer to a wiki file that does not exist, or to an unusable address, see [Missing files and links](reference.md#missing-files-and-links) |
