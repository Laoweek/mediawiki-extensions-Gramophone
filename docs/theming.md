# Theming

The players look finished without any configuration. The README shows five looks with their CSS
under [Change the look](../README.md#change-the-look):

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/styles-dark.png">
  <img alt="The same song in five player styles: the default look, a teal accent colour, square corners with a serif font, a compact player without the cover, and dark colours set in the playlist" src="screenshots/styles-light.png" width="664">
</picture>

To change their look there are three levels:

1. **Site-wide**, in MediaWiki:Common.css or a skin stylesheet: custom properties
   (`--gramophone-*`) for colours, sizes and the font, and `::part()` rules for single elements.
2. **One player**, with the tag's `class` and `style` attributes.
3. **TemplateStyles**, for the players of one template: custom properties, and the box around
   a player.

The players draw themselves inside a shadow root, so wiki CSS cannot reach their insides by
accident. Custom properties inherit into it, and `::part()` reaches the elements listed under
[Parts](#parts). The part names, their state names and the [host attributes](#host-attributes)
are a public API that keeps its meaning from commit to commit. The class names inside the
shadow root are not, and may change at any time.

## Custom properties

Set the properties on `.ext-gramophone` to restyle every player on the wiki. The simplest change is
the accent colour. Its hover, tint and highlight shades follow it automatically in light and
dark mode (in browsers with `color-mix()`, older ones keep shades of the default accent):

```css
.ext-gramophone {
	--gramophone-primary: #3a7194;
}
```

The play button draws a white icon on the accent colour, and accent-coloured text uses
`--gramophone-highlight`. If you pick a light accent, also set `--gramophone-primary-foreground` to a dark
colour and `--gramophone-highlight` to a darker shade of the accent so both stay readable.

| Property | Purpose |
| --- | --- |
| `--gramophone-background`, `--gramophone-foreground` | card background and text |
| `--gramophone-muted`, `--gramophone-muted-foreground` | badge fill and secondary text |
| `--gramophone-border` | card border and separators |
| `--gramophone-accent`, `--gramophone-accent-foreground` | neutral hover surface and its text |
| `--gramophone-primary` | accent colour, default `#d86575` |
| `--gramophone-primary-foreground` | icon colour on the accent fill (icons only, not text) |
| `--gramophone-primary-hover` | hover and pressed shade of the accent |
| `--gramophone-primary-soft` | tint for the current track, pressed toggles and the button disc |
| `--gramophone-highlight` | text drawn in the accent colour |
| `--gramophone-ring` | focus ring |
| `--gramophone-track`, `--gramophone-range`, `--gramophone-buffered`, `--gramophone-thumb` | slider track, progress fill, buffered range and thumb |
| `--gramophone-destructive` | error text and icons |
| `--gramophone-cover-from`, `--gramophone-cover-to`, `--gramophone-cover-foreground` | placeholder cover gradient and its icon |
| `--gramophone-radius`, `--gramophone-shadow` | corner radius and card shadow |
| `--gramophone-font-family` | font of the players and their tooltips, by default the page font |
| `--gramophone-cover-size` | cover size in the wide card, default `6rem`. A larger cover makes the card taller. The narrow card keeps its `3.5rem` cover. |
| `--gramophone-row-height` | height of the one-line player in table cells, default `2.5rem` |
| `--gramophone-button-size` | size of the `<playbutton>` button |
| `--gramophone-max-width` | maximum width of the full player |

The defaults live in `resources/ext.gramophone.styles.css`. The dark theme sets its own
background, text and surface colours with selectors such as
`html.skin-theme-clientpref-night .ext-gramophone`, which win over a plain `.ext-gramophone` rule. To
change those colours in dark mode too, repeat them under the same selectors.
`--gramophone-primary` needs no repeat because the dark theme derives its shades from it.

Tooltips are drawn in one separate element at the end of the page, `.ext-gramophone-tooltip`. It
reads the same properties, so list it next to `.ext-gramophone` to theme the tooltips too, as the
[examples](#examples) do.

Colours given in the tag (the JSON playlist colours, and `bg` and the like
when `$wgGramophoneLegacyColors` is on) override the site defaults for that one player, in light
and dark mode. The player checks their contrast and adjusts the
derived shades so text stays readable.

Until its script runs, each player shows a placeholder of the same size, so the page does not
move when the player appears. The placeholder follows the custom properties, including the
sizes. It does not follow `::part()` rules, so a part rule that changes a size (padding,
height, a hidden row) can move the page a little at that moment.

## Parts

Elements inside a player have part names, which site CSS selects with `::part()`:

```css
.ext-gramophone::part(play-button) {
	border-radius: 0.5rem;
}
```

- A `::part()` rule wins over the player's own style for that element in every state. A rule
  that changes the play button's background also replaces its hover colour, so set
  `::part(play-button):hover` as well.
- `::part()` can be followed by pseudo-classes such as `:hover` and `:focus-visible` and by
  pseudo-elements such as `::before`, but not by descendant or attribute selectors. That is
  why states are extra part names: `::part(playlist-item current)` selects only the current
  track. The [state names](#state-names) are listed below.
- The player's state and layout are attributes of the host element, so they combine with
  parts: `.ext-gramophone[data-gramophone-state="playing"]::part(card)`. See
  [Host attributes](#host-attributes).
- An element can have several part names. `::part(button)` selects every icon button of a
  player, `::part(play-button)` only the play button. Playlist items and speed options have
  their own parts.

Full player (`<gramophone>`):

| Part | Element |
| --- | --- |
| `card` | the whole card, with its border, background and shadow |
| `bar` | the top section, a grid of the areas `cover`, `meta` (title, subtitle and actions) and `ctrl` (the controls) |
| `cover` | the cover box, a gradient while there is no picture |
| `cover-image` | the cover picture |
| `cover-icon` | the music note on the gradient |
| `title` | the track title |
| `badge` | the E badge of an explicit track, next to the title and in the playlist |
| `subtitle` | the line under the title: artist and album, or a message (missing file, load error, autoplay blocked) |
| `artist`, `album` | the artist and the album in the subtitle |
| `actions` | the group of the four buttons below |
| `download-button`, `file-page-button`, `lyrics-button`, `playlist-button` | download, open the file page, show the lyrics, show the playlist |
| `controls` | the row with the transport, seek bar, repeat, speed and volume |
| `transport` | previous, play and next |
| `previous-button`, `play-button`, `next-button` | those buttons |
| `time` | both time labels. `current-time` and `duration` select one of them. |
| `seek-slider` | the seek bar, see the sliders below |
| `repeat-button`, `speed-button`, `volume-button` | those buttons |
| `popover` | the speed menu and the volume panel. `speed-popover` and `volume-popover` select one of them. |
| `speed-option` | an entry of the speed menu |
| `mute-button`, `volume-slider`, `volume-percent` | the contents of the volume panel |
| `playlist` | the playlist |
| `playlist-item` | one track in the playlist |
| `playlist-number` | its number |
| `playlist-equalizer` | the bars that replace the number of the current track |
| `playlist-title`, `playlist-artist` | its title and artist |
| `playlist-warning` | the icon of a track whose file is missing |
| `lyrics-panel` | the lyrics panel, with its separator line |
| `lyrics` | the scrolling lyrics inside it |
| `lyrics-line` | one line of the lyrics |
| `lyrics-translation` | a translation under a lyrics line |
| `lyrics-status` | the loading or error message in the lyrics panel |

The sliders are `seek-slider` and `volume-slider`. Each contains a track (`seek-track`,
`volume-track`), the filled range (`seek-range`, `volume-range`) and the thumb
(`seek-thumb`, `volume-thumb`). The seek bar also has `seek-buffer` (the downloaded range),
`seek-hover` (the shade up to the pointer) and `seek-tooltip` (the time under the pointer).
`volume-buffer` and `volume-hover` exist for symmetry but stay empty.

One-line player (a single track in a table cell):

| Part | Element |
| --- | --- |
| `row` | the pill |
| `play-button` | the play button |
| `ring`, `ring-track`, `ring-range` | the progress ring around the play button in very narrow cells, its groove and its filled part |
| `time`, `current-time`, `duration` | the time labels, as in the card |
| `seek-slider` and its parts | the seek bar, as in the card |
| `message` | the error message that replaces the seek bar |

Play button (`<playbutton>`):

| Part | Element |
| --- | --- |
| `button` | the button |
| `disc` | the round fill inside the progress ring |
| `icon` | the play, pause or error glyph |
| `ring`, `ring-track`, `ring-range` | the progress ring, its groove and its filled part |
| `count` | the number badge of a button with several files |

In every layout:

| Part | Element |
| --- | --- |
| `button` | every icon button, and the download and file page links |
| `icon` | every icon |
| `tooltip` | the tooltip bubble. It lives in its own element at the end of the page, so select it with `.ext-gramophone-tooltip::part(tooltip)`. |

### State names

| State | Added to | When |
| --- | --- | --- |
| `current` | `playlist-item` | the track is the selected one |
| `missing` | `playlist-item` | the track's file is missing |
| `active` | `lyrics-line` | the line belongs to the playback position |
| `pressed` | `repeat-button`, `lyrics-button`, `playlist-button`, `mute-button`, and `volume-button` where it only mutes (iOS) | the toggle is on |
| `expanded` | `speed-button`, `volume-button` | its popover is open |
| `checked` | `speed-option` | it is the current speed |
| `error` | `lyrics-status` | the lyrics could not be loaded |

## Host attributes

Each player is a `div.ext-gramophone.ext-gramophone-player`, each button a `span.ext-gramophone.ext-gramophone-button`.
Use these classes to adjust the outer layout, such as margins or width. When the script sets
a player up, which happens as the player nears the screen, it adds two attributes:

| Attribute | Values |
| --- | --- |
| `data-gramophone-state` | `idle` (not started, or back at the start), `loading` (waiting for audio after play was pressed), `playing`, `paused`, `blocked` (the browser refused to autoplay), `error` (missing file or load error) |
| `data-gramophone-layout` | `card`, `row` (a single track in a table cell) or `button` (`<playbutton>`) |

A button with `hidemissing=yes` also gets the classes and the `hidden` attribute described
under [Hiding buttons whose file is missing](reference.md#hiding-buttons-whose-file-is-missing).

## One player

```wikitext
<gramophone class="compact" style="--gramophone-primary: #3a7194">Mukyu Platonic.mp3</gramophone>
{{#tag:playbutton|Ripple.mp3|class=track-button}}
```

- MediaWiki checks both attributes as it does for a `div` in wikitext. A `style` with unsafe
  CSS, such as `url()`, is dropped as a whole.
- The classes follow the player's own (`ext-gramophone ext-gramophone-player compact`), so site CSS can
  select `.ext-gramophone.compact`.
- `style` suits custom properties best: `style="--gramophone-primary: #3a7194"` themes one player on
  any wiki, without site CSS.
- The colour options (`bg` and the like, and the JSON colours) set custom properties on the
  same element. For the properties they set, they win over `style`.
- Other attributes are read as options ([Options as attributes](reference.md#options-as-attributes))
  or ignored.

## TemplateStyles

With the TemplateStyles extension, a template's stylesheet can set the
[custom properties](#custom-properties) on `.ext-gramophone`. Like every TemplateStyles rule, it only
reaches the page content. Scope it with a wrapper class or a class given with the tag's `class`
attribute:

```css
.voice-lines .ext-gramophone {
	--gramophone-primary: #3a7194;
	--gramophone-button-size: 1.5rem;
}
```

- The values are checked when the stylesheet is saved. Colours take a colour value, and a bare
  `var()` is refused. Sizes take a length, and `--gramophone-radius` and `--gramophone-max-width` also a
  percentage. `--gramophone-font-family` takes what `font-family` takes and
  `--gramophone-shadow` what `box-shadow` takes, unless the wiki disallows those two properties in
  TemplateStyles. Other custom properties are refused. As everywhere in TemplateStyles,
  `var()` may still appear inside a colour function, `calc()` or a shadow.
- `::part()` rules work only in site CSS, such as MediaWiki:Common.css. TemplateStyles refuses
  them.
- The tooltips sit outside the page content, so TemplateStyles cannot theme them.
- The same stylesheet can style the box around a player through a class, for example its
  margin, width or float.
- The TemplateStylesExtender extension replaces these checks with its own. On wikis that use
  it, the `--gramophone-*` properties work when its `$wgTemplateStylesExtenderCustomPropertiesDeclaration`
  setting is on, and then take any value it allows for custom properties.

## Examples

Square corners and no shadow. The `data-gramophone-layout` attribute keeps the play button of the
one-line player round, inside its round pill:

```css
.ext-gramophone,
.ext-gramophone-tooltip {
	--gramophone-radius: 0px;
	--gramophone-shadow: none;
}

.ext-gramophone[data-gramophone-layout="card"]::part(play-button) {
	border-radius: 0;
}
```

A different font:

```css
.ext-gramophone,
.ext-gramophone-tooltip {
	--gramophone-font-family: Georgia, "Noto Serif SC", serif;
}
```

No download button:

```css
.ext-gramophone::part(download-button) {
	display: none;
}
```

A compact card without the cover and with fewer buttons, for players written as
`<gramophone class="compact">`:

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
