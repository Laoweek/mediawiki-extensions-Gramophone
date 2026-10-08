// Generates demo/index.html and demo/autoplay.html: a page that mimics a
// MediaWiki article in legacy Vector, with the exact host markup the PHP side
// emits (see docs/contract.md). Run: node demo/make-demo.mjs
//
// The article is about the album "Galaxy Triangle" by La prière, with "Bubblin'" by HIMEHINA
// and "Mukyu Platonic" by VALIS. Their 30-second previews and covers are not committed:
// `pnpm media` downloads them into demo/media/ (see scripts/demo-media.mjs at the repository
// root). Writing the pages needs neither the files nor the network. The lyrics in demo/lyrics/
// are original text: the Bubblin' lines explain the lyrics panel, and the test files are test data.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ALBUM, CREDITS, LYRICS_SONG, SINGLE } from '../../scripts/demo-media.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = '/client/demo/media/';
const LYRICS = '/client/demo/lyrics/';
// Wiki links (file pages, upload form) point at a reserved example domain.
const WIKI = 'https://wiki.example.org/wiki/';

// Bidi controls and zero-width characters (the long title test case) become character references, which
// give the same text: the generated file then shows no invisible characters in an editor or a diff.
const esc = (s) =>
	String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, (c) => `&#x${c.charCodeAt(0).toString(16)};`);

// The data-mw-gramophone JSON as the PHP side writes it (contract version 2): keys at their default are left out.
function track(t, o) {
	const base = t.src ? decodeURIComponent(t.src.split('/').pop()) : t.name || '';
	const out = { src: t.missing ? '' : t.src, title: t.title || base };
	if (t.artist) out.artist = t.artist;
	if (t.album) out.album = t.album;
	if (t.explicit) out.explicit = true;
	if (t.cover) out.cover = t.cover;
	if (t.lyrics) out.lyrics = t.lyrics;
	if (t.lyricsOffset) out.lyricsOffset = t.lyricsOffset;
	out.link = t.link ?? (t.missing ? `${WIKI}Special:Upload?wpDestFile=${encodeURIComponent(base)}` : `${WIKI}File:${encodeURIComponent(base)}`);
	if (t.missing) out.missing = true;
	// hidemissing: the server asks for a HEAD check of URLs the wiki may load.
	if (o.hideMissing && !t.missing) out.verify = true;
	if (t.nofollow) out.nofollow = true;
	return out;
}

function data(mode, tracks, o = {}) {
	const d = { v: 2, mode };
	for (const k of ['autoPlay', 'loop', 'playlistOpen', 'hideMissing']) if (o[k]) d[k] = true;
	const colors = Object.fromEntries(Object.entries(o.colors || {}).filter(([, v]) => v));
	if (Object.keys(colors).length) d.colors = colors;
	d.tracks = tracks.map((t) => track(t, o));
	return d;
}

function fallbackLink(t) {
	const cls = t.missing ? 'new ext-gramophone-fallback-link' : 'ext-gramophone-fallback-link';
	const href = t.missing ? t.link : t.src;
	return `<a class="${cls}" href="${esc(href)}" title="${esc(t.title)}">${esc(t.title)}</a>`;
}

// o.class and o.style are the tag's class and style attributes, which the PHP side passes on.
function hostAttributes(cls, o) {
	return `class="${cls}${o.class ? ' ' + esc(o.class) : ''}"${o.style ? ` style="${esc(o.style)}"` : ''}`;
}

function player(tracks, o = {}) {
	const d = data('player', tracks, o);
	const items = d.tracks.map((t) => `<li>${fallbackLink(t)}</li>`).join('');
	return `<div ${hostAttributes('ext-gramophone ext-gramophone-player', o)} data-mw-gramophone="${esc(JSON.stringify(d))}"><ol class="ext-gramophone-fallback">${items}</ol></div>`;
}

function button(tracks, o = {}) {
	const d = data('button', tracks, o);
	return `<span ${hostAttributes('ext-gramophone ext-gramophone-button', o)} data-mw-gramophone="${esc(JSON.stringify(d))}">${d.tracks.map(fallbackLink).join('')}</span>`;
}

// The real songs, as a JSON playlist would give them: the audio is a wiki file, the link its
// Apple Music page (navigationUrl). An external navigationUrl gets nofollow, as core gives
// external links by default ($wgNoFollowLinks), so the file page button carries rel="nofollow".
const song = (s) => ({ src: `${MEDIA}${s.slug}.m4a`, title: s.title, artist: s.artist, album: s.album, cover: `${MEDIA}${s.cover}.jpg`, link: s.url, nofollow: true });
const album = ALBUM.tracks.map(song);
const [divA3, diva, testament, ripple, driven, galactic, eDiv] = album;
const bubblin = song(LYRICS_SONG);
const mukyu = song(SINGLE);
const external = (href, text) => `<a class="external" rel="nofollow" href="${esc(href)}">${esc(text)}</a>`;

// Test tracks play the album previews under a test name. The album field says whose audio it is.
const test = (s, title, extra = {}) => ({ src: s.src, title, artist: 'Test case', album: `Audio: "${s.title}" by ${s.artist}`, ...extra });

const trackListing = `<table class="wikitable" id="demo-tracklist">
<tr><th>No.</th><th>Title</th><th>Preview</th><th>Listen</th></tr>
${ALBUM.tracks.map((s, i) => `<tr><td>${s.number}</td><td>"${esc(s.title)}"</td><td class="preview">${button([album[i]])}</td><td>${external(s.url, 'Apple Music')}</td></tr>`).join('\n')}
</table>`;

// One-line players: a single track in a table cell, sorted by title as a wiki list of songs would be.
const SONGS = [...album, bubblin, mukyu].sort((a, b) => a.title.localeCompare(b.title, 'en'));
function songTable(o = {}) {
	const rows = SONGS.map((s) => `<tr><td>"${esc(s.title)}"</td><td>${esc(s.artist)}</td><td>${player([s], o)}</td></tr>`);
	return `<table class="wikitable songs"><tr><th>Song</th><th>Artist</th><th>Preview</th></tr>${rows.join('')}</table>`;
}

function stressTable(n) {
	let cells = '';
	for (let i = 0; i < n; i++) {
		// The number alone keeps eight cells within a 375px screen.
		cells += `<td>${i + 1} ${button([album[i % album.length]])}</td>`;
		if (i % 8 === 7) cells += '</tr><tr>';
	}
	return `<table class="wikitable stress"><tr>${cells}</tr></table>`;
}

const buttonCases = `<table class="wikitable">
<tr><th>Case</th><th>Button</th><th>What it shows</th></tr>
<tr id="case-one"><td>One file</td><td>${button([galactic])}</td><td>A button for one song</td></tr>
<tr id="case-another"><td>Another file</td><td>${button([eDiv])}</td><td>A second button for one song</td></tr>
<tr id="case-sequence"><td>Three files</td><td>${button([divA3, diva, testament])}</td><td>One button plays three files in turn</td></tr>
<tr id="case-missing"><td>Missing file</td><td>${button([{ name: 'Missing-song.m4a', missing: true }])}</td><td>Shows a notice when the file does not exist</td></tr>
<tr id="case-colors"><td>Custom colours</td><td>${button([ripple], { colors: { background: '#fde68a', foreground: '#92400e', track: '#d97706' } })}</td><td>bg / text / tracker</td></tr>
<tr id="case-row"><td>Player in a table</td><td colspan="2">${player([driven])}</td></tr>
</table>`;

// Markup in text fields must stay text. The server already escapes it and drops javascript:
// URLs, so this case checks the client on its own (defence in depth).
const HOSTILE = { title: `</div><script>alert('xss-title')</script>`, artist: `<img src=x onerror=alert('xss-artist')>`, album: `"'><svg onload=alert('xss-album')>` };
const hostile = { src: eDiv.src, ...HOSTILE, link: `javascript:alert('xss-link')`, cover: `javascript:alert('xss-cover')` };
// 3000 characters with an unterminated right-to-left override and zero-width spaces.
const LONG_TITLE = ('\u202e' + 'Very long title with bidi controls.\u200b '.repeat(90)).slice(0, 2999) + '.';
const long = test(ripple, LONG_TITLE, { artist: '\u202eevil RTL override\u202c zero\u200bwidth \u{1f3b5}' });

const players = {
	narrow: player(album),
	album: player(album, { playlistOpen: true }),
	lyrics: player([{ ...bubblin, lyrics: LYRICS + 'bubblin.lrc' }]),
	single: player([mukyu]),
	// Lyrics edge cases and the playlist checks of scripts/visual-check.mjs.
	playlist: player(
		[
			test(divA3, 'Lyrics test: two timestamps per line', { lyrics: LYRICS + 'test-two-stamps.lrc' }),
			// The file is GB18030, as older Chinese LRC files are.
			test(diva, 'Lyrics test: GB18030 file, 500 ms offset', { lyrics: LYRICS + 'test-gb18030.lrc', lyricsOffset: 500 }),
			test(testament, 'Lyrics test: file not found', { lyrics: LYRICS + 'does-not-exist.lrc' }),
			{ name: 'Missing-song.m4a', missing: true },
			test(ripple, 'Test track 5'),
			test(driven, 'Test track 6'),
			test(galactic, 'Test track 7'),
		],
		{ playlistOpen: true, loop: true },
	),
	colors: player([galactic, driven], {
		colors: { background: '#1e293b', foreground: '#f8fafc', track: '#f59e0b', thumb: '#fef3c7' },
	}),
	missing: player([{ name: 'Missing-song.m4a', missing: true }]),
	// The badge is test data: the album field says so instead of naming the audio.
	explicit: player([test(eDiv, 'Explicit badge test', { explicit: true, album: 'The badge is test data' })]),
	broken: player([{ src: MEDIA + 'gramophone-does-not-exist.m4a', title: 'Broken-link.m4a' }]),
	autoplay: player([mukyu], { autoPlay: true }),
	themed: player([ripple, driven], { playlistOpen: true, class: 'gramophone-theme-demo', style: '--gramophone-primary:#3a7194' }),
	// The styling showcase: one song in five looks, as README.md shows them.
	styles: [
		['Default', player([ripple])],
		['Accent colour', player([ripple], { style: '--gramophone-primary: #1f7a8c' })],
		['Square corners and a serif font', player([ripple], { class: 'square' })],
		['Compact, without the cover', player([ripple], { class: 'compact' })],
		['Colours in the playlist', player([ripple], { colors: { background: '#1b1f3b', foreground: '#f2e9e4' } })],
	],
	hostile: player([hostile]),
	long: player([long, galactic], { playlistOpen: true }),
};

// The English text of the keys that the ext.gramophone and ext.gramophone.player modules list, as ResourceLoader delivers it.
const repo = path.resolve(here, '../..');
const modules = JSON.parse(await readFile(path.join(repo, 'extension.json'), 'utf8')).ResourceModules;
const english = JSON.parse(await readFile(path.join(repo, 'i18n/en.json'), 'utf8'));
const MESSAGES = Object.fromEntries([...modules['ext.gramophone'].messages, ...modules['ext.gramophone.player'].messages].map((k) => [k, english[k]]));

// Minimal window.mw stub: message(), hook() with memory, loader.using() and log.error().
const MW_STUB = `
window.mw = (function () {
	var messages = ${JSON.stringify(MESSAGES)};
	var hooks = {};
	return {
		messages: messages,
		message: function (key) {
			var params = Array.prototype.slice.call(arguments, 1);
			return {
				exists: function () { return Object.prototype.hasOwnProperty.call(messages, key); },
				text: function () { return String(messages[key]).replace(/\\$(\\d)/g, function (m, n) { return params[n - 1] !== undefined ? params[n - 1] : m; }); }
			};
		},
		hook: function (name) {
			var h = hooks[name] || (hooks[name] = { fns: [], memory: null });
			return {
				add: function (fn) { h.fns.push(fn); if (h.memory) fn.apply(null, h.memory); return this; },
				fire: function () { h.memory = arguments; for (var i = 0; i < h.fns.length; i++) h.fns[i].apply(null, arguments); return this; }
			};
		},
		// ResourceLoader stand-in: runs a module's file as function (require, module, exports)
		// after its dependencies, and resolves using() with require, as mw.loader does.
		loader: (function () {
			var rl = new URLSearchParams(location.search).get('bundle') === 'rl';
			var files = {
				'ext.gramophone': rl ? '/client/demo/build/gramophone.rl.js' : '/resources/dist/gramophone.js',
				'ext.gramophone.player': rl ? '/client/demo/build/gramophone.player.rl.js' : '/resources/dist/gramophone.player.js'
			};
			var deps = { 'ext.gramophone.player': ['ext.gramophone'] };
			var modules = {};
			function require(name) {
				var m = modules[name];
				if (!m || !m.ready) throw new Error('Module "' + name + '" is not loaded');
				return m.module.exports;
			}
			function implement(name, code) {
				var m = modules[name] || (modules[name] = {});
				m.module = { exports: {} };
				new Function('require', 'module', 'exports', code + '\\n//# sourceURL=' + files[name])(require, m.module, m.module.exports);
				m.ready = true;
			}
			function load(name) {
				var m = modules[name] || (modules[name] = {});
				if (!m.promise) {
					m.promise = Promise.all((deps[name] || []).map(load)).then(function () {
						if (m.ready) return;
						return fetch(files[name]).then(function (r) { return r.text(); }).then(function (code) {
							if (!m.ready) implement(name, code);
						});
					});
				}
				return m.promise;
			}
			return {
				using: function (names) {
					return Promise.all([].concat(names).map(load)).then(function () { return require; });
				},
				require: require,
				implement: implement
			};
		}()),
		log: { error: function () { console.error.apply(console, arguments); } }
	};
}());`;

// Demo switches: ?theme=night|os, ?nojs, ?delay=ms (late script, shows the
// placeholder), ?bundle=rl (ResourceLoader-minified modules from scripts/rl-minify.sh).
const LOADER = `
(function () {
	var q = new URLSearchParams(location.search);
	var html = document.documentElement;
	var theme = q.get('theme');
	if (theme) html.classList.add('skin-theme-clientpref-' + theme);
	if (q.has('nojs')) { html.className = html.className.replace('client-js', 'client-nojs'); return; }
	if (q.get('bundle') === 'rl') document.querySelector('link[href$="ext.gramophone.styles.css"]').href = '/client/demo/build/ext.gramophone.styles.rl.css';
	// Like a page whose HTML asks for ext.gramophone only: ext.gramophone loads ext.gramophone.player for the players.
	function load() {
		mw.loader.using('ext.gramophone').then(function () {
			var content = document.getElementById('mw-content-text');
			mw.hook('wikipage.content').fire({ get: function () { return [content]; } });
			window.gramophoneLoaded = true;
		});
	}
	var delay = Number(q.get('delay') || 0);
	if (q.has('hold')) window.gramophoneLoad = load;
	else if (delay) setTimeout(load, delay);
	else document.addEventListener('DOMContentLoaded', load);
}());`;

const CSS = `
html { background: #f6f6f6; }
body { margin: 0; font-family: sans-serif; color: #202122; background: #f6f6f6; }
#mw-page-base { height: 5em; background: linear-gradient(#fff 50%, #f6f6f6 100%); }
#mw-head { position: absolute; top: 0; right: 0; left: 11em; height: 2.5em; margin-top: 2.5em; display: flex; justify-content: space-between; font-size: 0.8125em; }
#mw-head .tabs { display: flex; gap: 0; }
#mw-head .tabs a { display: block; padding: 0.6em 0.8em; color: #0645ad; text-decoration: none; background: linear-gradient(to top, #77c1f6 0, #e8f2f8 1px, #fff 100%); border-left: 1px solid #a7d7f9; }
#mw-head .tabs a.selected { background: #fff; color: #202122; }
#mw-panel { position: absolute; top: 0; left: 0; width: 10em; padding: 1em 0.5em; font-size: 0.75em; }
#p-logo { width: 9em; height: 9em; margin-bottom: 1em; border-radius: 8px; background: linear-gradient(135deg, #3a7194, #98c5e9); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 1.2em; }
#mw-panel a { display: block; padding: 0.25em 0; color: #0645ad; text-decoration: none; }
.mw-body { margin-left: 11em; margin-top: -1px; padding: 1.25em 1.5em 1.5em; background: #fff; border: 1px solid #a7d7f9; border-right: 0; color: #202122; }
h1.firstHeading { margin: 0 0 0.25em; font-family: 'Linux Libertine', Georgia, Times, serif; font-weight: normal; font-size: 1.8em; border-bottom: 1px solid #a2a9b1; line-height: 1.3; }
.mw-body-content { font-size: 0.875em; line-height: 1.6; }
.mw-body-content h2 { font-family: 'Linux Libertine', Georgia, Times, serif; font-weight: normal; font-size: 1.5em; border-bottom: 1px solid #a2a9b1; margin: 1em 0 0.25em; }
.mw-body-content h3 { font-size: 1.2em; margin: 0.3em 0 0; }
a { color: #0645ad; } a.new { color: #ba0000; }
table.wikitable { background: #f8f9fa; color: #202122; margin: 1em 0; border: 1px solid #a2a9b1; border-collapse: collapse; }
table.wikitable > tr > th, table.wikitable > * > tr > th, table.wikitable > * > tr > td { border: 1px solid #a2a9b1; padding: 0.2em 0.4em; }
table.wikitable th { background: #eaecf0; text-align: center; }
table.wikitable td.preview { text-align: center; }
table.songs { width: 100%; max-width: 640px; }
.infobox { float: right; clear: right; width: 300px; margin: 0 0 1em 1em; padding: 0.5em; border: 1px solid #a2a9b1; background: #f8f9fa; font-size: 0.9em; }
.infobox .cap { font-weight: bold; font-size: 1.15em; text-align: center; margin-bottom: 0.4em; }
.infobox-data { width: 100%; margin-top: 0.5em; border-collapse: collapse; }
.infobox-data th { width: 6em; padding: 0.1em 0.5em 0.1em 0; text-align: left; vertical-align: top; }
#footer { margin-left: 11em; padding: 0.75em 1.5em; color: #54595d; font-size: 0.75em; }
.demo-note { color: #54595d; font-size: 0.9em; }
/* Site styles for the showcase (#demo-styles), as README.md shows them for MediaWiki:Common.css. */
#demo-styles { max-width: 40rem; }
#demo-styles .style-caption { margin: 1em 0 0.4em; font-weight: bold; }
.ext-gramophone.square {
	--gramophone-radius: 0px;
	--gramophone-shadow: none;
	--gramophone-font-family: Georgia, serif;
}
.ext-gramophone.square::part(play-button) {
	border-radius: 0;
}
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
/* Site theme for #demo-themed, as a wiki would write it in MediaWiki:Common.css (README, Theming). */
.gramophone-theme-demo { --gramophone-radius: 0px; --gramophone-shadow: none; --gramophone-font-family: Georgia, serif; --gramophone-cover-size: 7.5rem; --gramophone-row-height: 3rem; }
.gramophone-theme-demo[data-gramophone-layout="card"]::part(play-button), .gramophone-theme-demo::part(seek-thumb) { border-radius: 0; }
.gramophone-theme-demo::part(download-button) { display: none; }
.gramophone-theme-demo::part(playlist-item current) { box-shadow: inset 3px 0 var(--gramophone-primary); }
.gramophone-theme-demo[data-gramophone-state="playing"]::part(card) { border-color: var(--gramophone-primary); }
.gramophone-theme-demo::part(disc) { background: var(--gramophone-primary); }
.gramophone-theme-demo[data-gramophone-layout="button"]::part(button) { color: #fff; }
/* Night theme stand-in (legacy Vector has none; Vector 2022 / Minerva do). */
html.skin-theme-clientpref-night, html.skin-theme-clientpref-night body { background: #101418; }
html.skin-theme-clientpref-night .mw-body { background: #101418; color: #eaecf0; border-color: #3a3f47; }
html.skin-theme-clientpref-night #mw-page-base { background: #101418; }
html.skin-theme-clientpref-night h1.firstHeading, html.skin-theme-clientpref-night .mw-body-content h2 { border-color: #54595d; color: #eaecf0; }
html.skin-theme-clientpref-night a { color: #88a3e8; }
html.skin-theme-clientpref-night table.wikitable { background: #202122; color: #eaecf0; border-color: #54595d; }
html.skin-theme-clientpref-night table.wikitable th { background: #27292d; }
html.skin-theme-clientpref-night table.wikitable td, html.skin-theme-clientpref-night table.wikitable th { border-color: #54595d; }
html.skin-theme-clientpref-night .infobox { background: #202122; border-color: #54595d; }
html.skin-theme-clientpref-night #footer, html.skin-theme-clientpref-night .demo-note { color: #a2a9b1; }
@media (max-width: 720px) {
	#mw-panel, #mw-head { display: none; }
	.mw-body { margin-left: 0; border-left: 0; padding: 1em; }
	#footer { margin-left: 0; padding: 0.75em 1em; }
	.infobox { float: none; width: auto; margin: 1em 0; }
}
`;

function page(title, body) {
	return `<!doctype html>
<html class="client-js" lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - Gramophone demo</title>
<link rel="stylesheet" href="/resources/ext.gramophone.styles.css">
<style>${CSS}</style>
<script>${MW_STUB}</script>
<script>${LOADER}</script>
</head>
<body>
<div id="mw-page-base"></div>
<div id="mw-panel"><div id="p-logo">Gramophone demo</div><a href="#">Main page</a><a href="#">Recent changes</a><a href="#">Random page</a><a href="#">Help</a></div>
<div id="mw-head"><div class="tabs"><a class="selected" href="#">Page</a><a href="#">Discussion</a></div><div class="tabs"><a class="selected" href="#">Read</a><a href="#">Edit</a><a href="#">View history</a></div></div>
<div class="mw-body" id="content">
<h1 class="firstHeading">${title}</h1>
<div id="bodyContent" class="mw-body-content"><div id="mw-content-text"><div class="mw-parser-output">
${body}
</div></div></div>
</div>
<div id="footer"><p id="demo-credits">${esc(CREDITS)}</p></div>
</body>
</html>
`;
}

const indexBody = `
<p class="demo-note">This is the Gramophone client demo: an article in the legacy Vector skin. Its players use the markup that the PHP side writes, and the ext.gramophone module mounts them. The <a href="#test-cases">test cases</a> at the end are for the visual check.</p>
<div class="infobox" id="demo-narrow"><div class="cap">Galaxy Triangle</div>${players.narrow}<table class="infobox-data">
<tr><th>Artist</th><td>${esc(ALBUM.artist)}</td></tr><tr><th>Released</th><td>${ALBUM.year}</td></tr><tr><th>Tracks</th><td>${album.length}</td></tr><tr><th>Listen</th><td>${external(ALBUM.url, 'Apple Music')}</td></tr>
</table></div>
<div id="demo-buttons">
<p id="demo-inline"><b>Galaxy Triangle</b> is a ${ALBUM.year} album by La prière. Its seven tracks open with "Div.A3" ${button([divA3])} and close with "E Div." ${button([eDiv])}. "Galactic Love" ${button([galactic])} is the sixth track.</p>
<h2>Track listing</h2>
${trackListing}
</div>
<h2>Listen</h2>
<p>The whole album in one player:</p>
<div id="demo-album">${players.album}</div>
<h2>See also</h2>
<h3>Bubblin'</h3>
<p>"Bubblin'" is a song by HIMEHINA (${external(LYRICS_SONG.url, 'Apple Music')}). The lines in its lyrics panel here explain how the panel works, with a Japanese translation under each line. They are not the song's lyrics.</p>
<div id="demo-lyrics">${players.lyrics}</div>
<h3>Mukyu Platonic</h3>
<p>"Mukyu Platonic" is a single by VALIS (${external(SINGLE.url, 'Apple Music')}).</p>
<div id="demo-single">${players.single}</div>
<h2>Songs on this page</h2>
<div id="demo-tracks">${songTable()}</div>
<h2>Styles</h2>
<p>A wiki can restyle the players with its own CSS. The same song in five looks:</p>
<div id="demo-styles">${players.styles.map(([caption, html]) => `<p class="style-caption">${caption}</p>${html}`).join('')}</div>
<h2 id="test-cases">Test cases</h2>
<p class="demo-note">Not part of the article: cases for scripts/visual-check.mjs. The test tracks play the previews of Galaxy Triangle under test names, and their lyrics files are test text, not the lyrics of any song.</p>
<h3>Lyrics and playlist</h3><div id="demo-playlist">${players.playlist}</div>
<h3>Custom colours</h3><div id="demo-colors">${players.colors}</div>
<h3>Explicit track</h3><div id="demo-explicit">${players.explicit}</div>
<h3>Missing file</h3><div id="demo-missing">${players.missing}</div>
<h3>Broken link</h3><div id="demo-broken">${players.broken}</div>
<h3>Buttons</h3><div id="demo-button-cases">${buttonCases}</div>
<h3>Site styles</h3><div id="demo-themed">${players.themed}<p>A button ${button([galactic], { class: 'gramophone-theme-demo' })} and a table row:</p><table class="wikitable"><tr><td>"E Div."</td><td>${player([eDiv], { class: 'gramophone-theme-demo' })}</td></tr></table></div>
<h3>Legacy colours</h3>
<p class="demo-note">The song table again, with the legacy colour options bg=C4C4C4 track=0xFFFFFF ($wgGramophoneLegacyColors on) and repeat on.</p>
<div id="demo-tracks-legacy">${songTable({ loop: true, colors: { background: '#c4c4c4', thumb: '#ffffff' } })}</div>
<h3>Hostile text</h3>
<p class="demo-note">Markup as title, artist and album, javascript: URLs as link and cover. Nothing may run, and the text shows as written.</p>
<div id="demo-hostile">${players.hostile}<p>A button: ${button([hostile])}</p></div>
<h3>Long title</h3>
<p class="demo-note">A 3000-character title with bidi controls must not widen the page.</p>
<div id="demo-long">${players.long}</div>
<h3>Stress test</h3>
<p class="demo-note">160 buttons that mount lazily.</p>
<div id="demo-stress">${stressTable(160)}</div>
<h3>Hide missing files</h3>
<p id="demo-hidemissing">hidemissing=yes: a file that exists ${button([ripple], { hideMissing: true })}, a file missing on the server${button([{ src: MEDIA + 'gramophone-does-not-exist.m4a', title: 'gramophone-does-not-exist.m4a' }], { hideMissing: true })}, a file missing on the wiki${button([{ name: 'Missing-song.m4a', missing: true }], { hideMissing: true })}. Only the first button shows.</p>
`;

const autoplayBody = `
<p class="demo-note">Test page for autoplay: when the browser blocks it, the player asks for a press on play.</p>
<div id="demo-autoplay">${players.autoplay}</div>
<p>${button([galactic])} Another button on the page.</p>
`;

await writeFile(path.join(here, 'index.html'), page('Galaxy Triangle', indexBody));
await writeFile(path.join(here, 'autoplay.html'), page('Autoplay', autoplayBody));
console.log('wrote demo/index.html and demo/autoplay.html');
