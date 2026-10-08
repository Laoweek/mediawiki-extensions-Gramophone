// Unit tests for the pure modules (LRC parsing, config normalisation).
// Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

async function load(entry) {
	const r = await esbuild.build({
		entryPoints: [path.join(here, '../src', entry)],
		bundle: true,
		format: 'esm',
		platform: 'neutral',
		write: false,
		loader: { '.css': 'text' },
	});
	return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}

globalThis.window = globalThis.window || {};
globalThis.location = { href: 'https://www.example.com/wiki/Page' };

const { parseLrc, activeLine, readCapped, MAX_BYTES, MAX_ENTRIES, MAX_CHARS } = await load('lyrics.ts');
const { parseConfig } = await load('config.ts');
const { exists, hideIfMissing, onMissing } = await load('exists.ts');
const { isDark, palette, contrast } = await load('colors.ts');
globalThis.window.setTimeout = setTimeout;
const { onVolume, setVolume } = await load('volume.ts');
const { playState } = await load('engine.ts');

test('LRC: multiple timestamps per line, fractions, sorting', () => {
	const { lines, synced } = parseLrc('[ti:x]\n[00:05.5][01:00.25]a\n[00:01]b\n[00:02:500]c\n[00:03.123]d');
	assert.equal(synced, true);
	assert.deepEqual(
		lines.map((l) => [l.time, l.text]),
		[[1, 'b'], [2.5, 'c'], [3.123, 'd'], [5.5, 'a'], [60.25, 'a']],
	);
});

test('LRC: [offset] tag, word timings and empty lines', () => {
	const { lines } = parseLrc('[offset:+500]\r\n[00:10.00]<00:10.00>hel<00:10.50>lo\r\n[00:12.00]\r\n');
	assert.deepEqual(lines, [
		{ time: 9.5, text: 'hello' },
		{ time: 11.5, text: '' },
	]);
});

test('LRC: later lines with the same timestamp are translations', () => {
	const { lines } = parseLrc('[offset:+500]\n[00:01.00][00:20.00]a\n[00:12.30]Stars shine in the night sky\n[00:12.3]Stars light up the night\n[00:12.30]\n[00:12:30]stars\n[00:20.00]A');
	assert.deepEqual(lines, [
		{ time: 0.5, text: 'a' },
		{ time: 11.8, text: 'Stars shine in the night sky', translations: ['Stars light up the night', 'stars'] },
		{ time: 19.5, text: 'a', translations: ['A'] },
	]);
	assert.deepEqual(parseLrc('[00:10.00]\n[00:10.00]Line B\n[00:10.00]B').lines, [{ time: 10, text: 'Line B', translations: ['B'] }], 'an empty line does not hide the lyric at its time');
});

test('LRC: plain text without timestamps is unsynced', () => {
	const { lines, synced } = parseLrc('line one\n\nline two\n[ar:someone]');
	assert.equal(synced, false);
	assert.deepEqual(lines.map((l) => l.text), ['line one', 'line two']);
});

test('LRC: at most 5000 lines and translations are kept', () => {
	assert.equal(MAX_ENTRIES, 5000);
	const stamp = (i) => `[${String(Math.floor(i / 6000)).padStart(2, '0')}:${String(Math.floor(i / 100) % 60).padStart(2, '0')}.${String(i % 100).padStart(2, '0')}]`;
	const timed = Array.from({ length: 6000 }, (_, i) => `${stamp(i)}line ${i}`).join('\n');
	assert.equal(parseLrc(timed).lines.length, 5000);
	const translated = Array.from({ length: 3000 }, (_, i) => `${stamp(i)}line ${i}\n${stamp(i)}gloss ${i}`).join('\n');
	const { lines } = parseLrc(translated);
	assert.equal(lines.length + lines.reduce((n, l) => n + (l.translations ? l.translations.length : 0), 0), 5000);
	assert.equal(parseLrc('[00:01.00]' + '[00:02.00]'.repeat(9000) + 'x').lines.length, 2, 'repeated timestamps of one line count once');
	assert.equal(parseLrc(Array.from({ length: 6000 }, (_, i) => 'plain ' + i).join('\n')).lines.length, 5000);
});

test('LRC: at most 1 Mi characters are kept in all, however many timestamps share a line', () => {
	assert.equal(MAX_CHARS, 1024 * 1024);
	const kept = ({ lines }) => lines.reduce((n, l) => n + l.text.length + (l.translations || []).reduce((m, t) => m + t.length, 0), 0);
	// One line of 5000 timestamps and about 950 KB of words: within the size cap, 4.75 billion characters uncapped.
	const words = 'word '.repeat(190000).trim();
	const stamps = Array.from({ length: 5000 }, (_, i) => `[${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.00]`).join('');
	const bomb = parseLrc(stamps + words);
	assert.ok(kept(bomb) <= MAX_CHARS, `${kept(bomb)} characters kept`);
	assert.equal(bomb.lines.length, 1, 'only the first timestamp fits');
	// The same text as translations of one timestamp.
	const repeated = parseLrc(Array.from({ length: 30 }, () => '[00:01.00]' + 'x'.repeat(50000)).join('\n'));
	assert.ok(kept(repeated) <= MAX_CHARS);
	assert.equal(repeated.lines[0].translations.length, 19, '20 lines of 50,000 characters fit');
	// Plain text and gap lines count too.
	assert.ok(kept(parseLrc(Array.from({ length: 30 }, () => 'y'.repeat(50000)).join('\n'))) <= MAX_CHARS);
	assert.ok(kept(parseLrc('[00:01.00]\n' + Array.from({ length: 30 }, () => '[00:01.00]' + 'z'.repeat(50000)).join('\n'))) <= MAX_CHARS);
});

// A response whose body arrives in 64 KiB chunks, counting what was read.
function chunked(total, headers = {}) {
	const stats = { pulled: 0, cancelled: false };
	let sent = 0;
	const body = new ReadableStream({
		pull(ctrl) {
			if (sent >= total) return ctrl.close();
			const n = Math.min(65536, total - sent);
			sent += n;
			stats.pulled += n;
			ctrl.enqueue(new Uint8Array(n).fill(65));
		},
		cancel() {
			stats.cancelled = true;
		},
	});
	return { res: new Response(body, { headers }), stats };
}

test('lyrics: a body over 1 MiB is refused, by its Content-Length or while reading', async () => {
	assert.equal(MAX_BYTES, 1024 * 1024);
	const small = chunked(200000);
	assert.equal((await readCapped(small.res, MAX_BYTES)).byteLength, 200000);
	const exact = chunked(MAX_BYTES);
	assert.equal((await readCapped(exact.res, MAX_BYTES)).byteLength, MAX_BYTES);

	const declared = chunked(100 * MAX_BYTES, { 'Content-Length': String(100 * MAX_BYTES) });
	await assert.rejects(readCapped(declared.res, MAX_BYTES), /larger than/);
	assert.equal(declared.stats.pulled <= 65536, true, 'refused before reading the body');

	const undeclared = chunked(100 * MAX_BYTES);
	await assert.rejects(readCapped(undeclared.res, MAX_BYTES), /larger than/);
	assert.ok(undeclared.stats.pulled < 2 * MAX_BYTES, `stopped reading after ${undeclared.stats.pulled} bytes`);
	assert.equal(undeclared.stats.cancelled, true, 'the download is cancelled');

	// Without streams: the whole body, then the size check.
	const plain = (n) => ({ headers: new Headers(), body: null, arrayBuffer: async () => new ArrayBuffer(n) });
	assert.equal((await readCapped(plain(10), MAX_BYTES)).byteLength, 10);
	await assert.rejects(readCapped(plain(MAX_BYTES + 1), MAX_BYTES), /larger than/);
});

test('activeLine binary search', () => {
	const lines = [{ time: 1 }, { time: 2 }, { time: 4 }];
	assert.equal(activeLine(lines, 0.5), -1);
	assert.equal(activeLine(lines, 1), 0);
	assert.equal(activeLine(lines, 3.9), 1);
	assert.equal(activeLine(lines, 99), 2);
});

const host = (data, cls = 'ext-gramophone-player') => ({
	getAttribute: () => (typeof data === 'string' ? data : JSON.stringify(data)),
	classList: { contains: (c) => c === cls },
});

test('config: tolerates junk and wrong types', () => {
	assert.equal(parseConfig(host('{not json')), null);
	assert.equal(parseConfig(host('[]')), null);
	const cfg = parseConfig(host({ mode: 'player', autoPlay: 'yes', colors: { background: 'red', foreground: '#FFFFFF' }, tracks: [null, 5, { src: 'javascript:alert(1)', title: 7 }, { src: '//cdn.example.com/images/a/a5/Voice_greeting.mp3', lyricsOffset: '5' }] }));
	assert.equal(cfg.autoPlay, false);
	assert.deepEqual(cfg.colors, { background: null, foreground: '#ffffff', track: null, thumb: null });
	assert.equal(cfg.tracks.length, 2);
	assert.equal(cfg.tracks[0].missing, true, 'javascript: URL is rejected');
	assert.equal(cfg.tracks[0].title, 'Untitled', 'a missing track without a title is not named after the page URL');
	assert.equal(cfg.tracks[1].src, 'https://cdn.example.com/images/a/a5/Voice_greeting.mp3');
	assert.equal(cfg.tracks[1].title, 'Voice_greeting.mp3', 'title falls back to the decoded file name');
	assert.equal(cfg.tracks[1].lyricsOffset, 0);
});

test('config: button mode from the host class forces player options off', () => {
	const cfg = parseConfig(host({ autoPlay: true, loop: true, playlistOpen: true, tracks: [{ src: '/a.mp3' }] }, 'ext-gramophone-button'));
	assert.equal(cfg.mode, 'button');
	assert.equal(cfg.autoPlay || cfg.loop || cfg.playlistOpen, false);
	assert.equal(cfg.tracks[0].src, 'https://www.example.com/a.mp3');
});

test('config: version 2 leaves out defaults', () => {
	const v2 = parseConfig(host({ v: 2, mode: 'button', hideMissing: true, tracks: [{ src: '/a.mp3', title: 'A', verify: true, nofollow: true }, { src: '/b.mp3', title: 'B' }] }, 'ext-gramophone-button'));
	assert.deepEqual(v2.colors, { background: null, foreground: null, track: null, thumb: null });
	assert.equal(v2.hideMissing, true);
	assert.deepEqual(v2.tracks[0], {
		src: 'https://www.example.com/a.mp3', title: 'A', artist: '', album: '', explicit: false, cover: '', lyrics: '', lyricsOffset: 0, link: '', missing: false, verify: true, nofollow: true,
	});
	assert.equal(v2.tracks[1].verify || v2.tracks[1].nofollow, false);
	const player = parseConfig(host({ v: 2, mode: 'player', loop: true, tracks: [{ src: '/a.mp3', lyricsOffset: 250 }] }));
	assert.equal(player.loop, true);
	assert.equal(player.tracks[0].lyricsOffset, 250);
});

test('config: hideMissing only for buttons and only when true', () => {
	const tracks = [{ src: '/a.mp3' }];
	assert.equal(parseConfig(host({ mode: 'button', hideMissing: true, tracks }, 'ext-gramophone-button')).hideMissing, true);
	assert.equal(parseConfig(host({ mode: 'button', hideMissing: 'yes', tracks }, 'ext-gramophone-button')).hideMissing, false);
	assert.equal(parseConfig(host({ mode: 'player', hideMissing: true, tracks })).hideMissing, false);
});

test('exists: only 404 and 410 count as missing, one HEAD request per URL', async () => {
	const calls = [];
	const real = globalThis.fetch;
	globalThis.fetch = (url, init) => {
		calls.push([url, init.method]);
		const status = Number(url.split('/').pop());
		return Number.isNaN(status) ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ status });
	};
	try {
		assert.equal(await exists('https://a.example/404'), false);
		assert.equal(await exists('https://a.example/410'), false);
		for (const s of ['200', '206', '403', '405', '500']) assert.equal(await exists('https://a.example/' + s), true, s);
		assert.equal(await exists('https://a.example/cors-error'), true, 'a network or CORS error keeps the button');
		assert.equal(await exists('https://a.example/404'), false);
		assert.equal(calls.filter(([u]) => u === 'https://a.example/404').length, 1, 'answers are reused');
		assert.ok(calls.every(([, m]) => m === 'HEAD'));
	} finally {
		globalThis.fetch = real;
	}
});

test('exists: no answer within 5 s keeps the button', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const real = globalThis.fetch;
	globalThis.fetch = () => new Promise(() => {});
	try {
		const answer = exists('https://a.example/slow');
		t.mock.timers.tick(5000);
		assert.equal(await answer, true);
	} finally {
		globalThis.fetch = real;
	}
});

// A fetch whose answers the test hands out, one HEAD request at a time.
function manualFetch() {
	const calls = [];
	const fetch = (url, init) =>
		new Promise((resolve, reject) => {
			calls.push({ url, init, answer: (status) => resolve({ status }), fail: () => reject(new TypeError('Failed to fetch')) });
		});
	return { calls, fetch };
}
const ticks = () => new Promise((r) => setImmediate(r));

test('exists: at most 6 HEAD requests at once page-wide', async () => {
	const real = globalThis.fetch;
	const m = manualFetch();
	globalThis.fetch = m.fetch;
	try {
		const answers = Array.from({ length: 9 }, (_, i) => exists('https://limit.example/' + i));
		assert.equal(m.calls.length, 6, 'the others wait for a slot');
		assert.equal(exists('https://limit.example/7'), answers[7], 'a waiting URL is not asked twice');
		m.calls[0].answer(404);
		await ticks();
		assert.equal(m.calls.length, 7, 'an answer frees a slot');
		m.calls[1].fail();
		await ticks();
		assert.equal(m.calls.length, 8, 'a network error frees a slot');
		for (const c of m.calls.slice(2)) c.answer(200);
		await ticks();
		m.calls[8].answer(410);
		assert.deepEqual(await Promise.all(answers), [false, true, true, true, true, true, true, true, false]);
	} finally {
		globalThis.fetch = real;
	}
});

test('exists: the 5 s timeout starts when the request is sent', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const real = globalThis.fetch;
	const m = manualFetch();
	globalThis.fetch = m.fetch;
	try {
		// Six sites that never answer, then one more request.
		const answers = Array.from({ length: 7 }, (_, i) => exists(`https://slow${i}.example/a.mp3`));
		const settled = new Set();
		answers.forEach((a, i) => a.then(() => settled.add(i)));
		assert.equal(m.calls.length, 6);
		t.mock.timers.tick(5000);
		await ticks();
		assert.equal(settled.size, 6, 'the first six time out and count as existing');
		assert.equal(m.calls.length, 7, 'the seventh is sent only now');
		assert.ok(m.calls.slice(0, 6).every((c) => c.init.signal.aborted), 'timed out requests are aborted');
		t.mock.timers.tick(4999);
		await ticks();
		assert.equal(settled.has(6), false, 'its own 5 s are not over');
		t.mock.timers.tick(1);
		assert.equal(await answers[6], true);
	} finally {
		globalThis.fetch = real;
	}
});

test('exists: after a timeout, the waiting checks for that site are skipped', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const real = globalThis.fetch;
	const m = manualFetch();
	globalThis.fetch = m.fetch;
	try {
		const dead = Array.from({ length: 9 }, (_, i) => exists('https://dead.example/' + i));
		const other = exists('https://alive.example/x.mp3');
		assert.equal(m.calls.length, 6);
		t.mock.timers.tick(5000);
		assert.deepEqual(await Promise.all(dead), Array(9).fill(true), 'all shown after 5 s');
		assert.deepEqual(m.calls.slice(6).map((c) => c.url), ['https://alive.example/x.mp3'], 'only the other site is still asked');
		m.calls[6].answer(404);
		assert.equal(await other, false);
	} finally {
		globalThis.fetch = real;
	}
});

test('hideIfMissing: checks only verify tracks, once the host is near the viewport', async () => {
	const observers = [];
	globalThis.IntersectionObserver = class {
		constructor(cb, opts) {
			this.cb = cb;
			this.opts = opts;
			this.targets = new Set();
			observers.push(this);
		}
		observe(el) {
			this.targets.add(el);
		}
		unobserve(el) {
			this.targets.delete(el);
		}
	};
	const real = globalThis.fetch;
	const m = manualFetch();
	globalThis.fetch = m.fetch;
	const fakeHost = () => {
		const cls = new Set();
		return { hidden: false, cls, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } };
	};
	const near = (el) => observers[0].cb([{ target: el, isIntersecting: true }]);
	try {
		// No verify flags: shown at once, nothing fetched.
		const unchecked = fakeHost();
		let nearNow = 0;
		hideIfMissing(unchecked, [{ src: 'https://v.example/a.mp3', missing: false, verify: false }], () => nearNow++);
		assert.deepEqual([...unchecked.cls], ['ext-gramophone-checked']);
		assert.equal(nearNow, 1, 'nothing to check: near() runs at once');
		const gone = fakeHost();
		hideIfMissing(gone, [{ src: '', missing: true, verify: false }]);
		assert.equal(gone.hidden, true);
		assert.equal(observers.length, 0, 'no observer without a check to make');

		const tracks = [
			{ src: 'https://v.example/missing.mp3', missing: false, verify: true },
			{ src: 'https://v.example/found.mp3', missing: false, verify: true },
		];
		const host = fakeHost();
		let nearLater = 0;
		let redrawn = 0;
		hideIfMissing(host, tracks, () => nearLater++);
		// The button was built before the check answered.
		onMissing(host, () => redrawn++);
		assert.deepEqual([...host.cls], ['ext-gramophone-checking']);
		assert.equal(observers[0].opts.rootMargin, '200% 0px');
		assert.equal(m.calls.length, 0, 'nothing is fetched while the host is far away');
		assert.equal(nearLater, 0);
		near(host);
		assert.equal(nearLater, 1, 'near() runs when the host comes near');
		assert.equal(observers[0].targets.has(host), false, 'the host is no longer observed');
		assert.deepEqual(m.calls.map((c) => c.url), tracks.map((tr) => tr.src));
		m.calls[0].answer(404);
		m.calls[1].answer(200);
		await ticks();
		assert.deepEqual([...host.cls], ['ext-gramophone-checked']);
		assert.deepEqual(tracks.map((tr) => tr.missing), [true, false], 'the button plays only the file that exists');
		assert.equal(redrawn, 1, 'a built button redraws its label and track list');

		const none = fakeHost();
		hideIfMissing(none, [{ src: 'https://v.example/missing.mp3', missing: false, verify: true }]);
		near(none);
		await ticks();
		assert.equal(none.hidden, true, 'the answer is reused: no file exists');
		assert.equal(m.calls.length, 2);

		// A file without verify counts as found: the button shows, the checked file can still drop out.
		const mixed = fakeHost();
		const mixedTracks = [{ src: 'https://v.example/missing.mp3', missing: false, verify: true }, { src: 'https://other.example/b.mp3', missing: false, verify: false }];
		hideIfMissing(mixed, mixedTracks);
		assert.deepEqual([...mixed.cls], ['ext-gramophone-checked']);
		near(mixed);
		await ticks();
		assert.equal(mixedTracks[0].missing, true);
		assert.deepEqual([...mixed.cls], ['ext-gramophone-checked']);
	} finally {
		globalThis.fetch = real;
		delete globalThis.IntersectionObserver;
	}
});

test('isDark picks readable text colours', () => {
	assert.equal(isDark('#1e293b'), true);
	assert.equal(isDark('#ffffff'), false);
	assert.equal(isDark('#3a7194'), true);
	assert.equal(isDark('#98c5e9'), false);
});

test('custom background gets a full, readable palette', () => {
	// The coordinator's case: background equals the site primary.
	const p = palette({ background: '#3a7194', foreground: '#ffffff', track: '#98c5e9', thumb: '#ffcc00' });
	assert.notEqual(p['--gramophone-primary'], '#3a7194');
	assert.ok(contrast(p['--gramophone-primary'], '#3a7194') >= 3, 'accent stands out from the background');
	assert.ok(contrast(p['--gramophone-primary-foreground'], p['--gramophone-primary']) >= 4.5, 'play icon readable');
	assert.ok(contrast(p['--gramophone-track'], '#3a7194') > 1.3, 'slider track visible');
	assert.equal(p['--gramophone-range'], '#98c5e9');
	assert.equal(p['--gramophone-thumb'], '#ffcc00');
	// Only a background: text colour is picked automatically.
	assert.equal(palette({ background: '#1e293b', foreground: null, track: null, thumb: null })['--gramophone-foreground'], '#fafafa');
	// No background: theme tokens stay in charge.
	assert.deepEqual(palette({ background: null, foreground: null, track: '#ff0000', thumb: null }), { '--gramophone-range': '#ff0000' });
});

test('custom palettes keep text readable', () => {
	const cases = [
		{ background: '#3a7194', foreground: '#ffffff', track: '#98c5e9', thumb: '#ffcc00' },
		{ background: '#222222', foreground: '#eeeeee', track: '#00ff00', thumb: '#0000ff' },
		{ background: '#abcdef', foreground: '#112233', track: null, thumb: null },
		{ background: '#00ff00', foreground: '#aabbcc', track: null, thumb: null },
		{ background: '#ffffff', foreground: null, track: '#ffff00', thumb: null },
	];
	cases.push(
		{ background: '#2e7d32', foreground: '#ffffff', track: null, thumb: null },
		{ background: '#1565c0', foreground: '#ffffff', track: null, thumb: null },
		{ background: '#c0392b', foreground: '#ffffff', track: null, thumb: null },
		{ background: '#d86575', foreground: null, track: null, thumb: null },
	);
	for (const c of cases) {
		const p = palette(c);
		const bg = p['--gramophone-background'];
		const fg = p['--gramophone-foreground'];
		const soft = p['--gramophone-primary-soft'];
		const name = JSON.stringify(c);
		if (contrast(fg, bg) < 4.5) continue;
		for (const surface of [bg, soft, p['--gramophone-accent']]) {
			assert.ok(contrast(p['--gramophone-muted-foreground'], surface) >= 4.5, 'secondary text ' + name);
		}
		assert.ok(contrast(p['--gramophone-highlight'], soft) >= 4.5, 'current row title ' + name);
		assert.ok(contrast(p['--gramophone-primary'], soft) >= 3, 'pressed toggle icon ' + name);
		assert.ok(contrast(p['--gramophone-primary-foreground'], p['--gramophone-primary']) >= 3, 'play icon ' + name);
		assert.ok(contrast(p['--gramophone-track'], bg) >= 1.5, 'slider track ' + name);
	}
	// Only a text colour: a background it reads on, the theme accent stays.
	const light = palette({ background: null, foreground: '#ffffff', track: null, thumb: null });
	assert.equal(light['--gramophone-background'], '#1c1c1f');
	assert.equal(light['--gramophone-highlight'], '#ffffff');
	assert.equal(light['--gramophone-primary'], undefined);
	assert.ok(light['--gramophone-primary-soft'], 'selected tint set without color-mix()');
	assert.equal(palette({ background: null, foreground: '#333333', track: null, thumb: null })['--gramophone-background'], '#ffffff');
	// Grey text gets the background it reads better on.
	assert.equal(palette({ background: null, foreground: '#767676', track: null, thumb: null })['--gramophone-background'], '#ffffff');
});

test('volume: listeners can unsubscribe', () => {
	let calls = 0;
	const off = onVolume(() => calls++);
	setVolume(0.5);
	off();
	setVolume(0.6);
	assert.equal(calls, 1);
});

test('playState: the data-gramophone-state value', () => {
	const at = (o) => playState({ failure: '', wantsPlay: false, waiting: false, blocked: false, time: 0, ...o });
	assert.deepEqual(
		[at({}), at({ wantsPlay: true, waiting: true }), at({ wantsPlay: true }), at({ time: 12 }), at({ blocked: true }), at({ failure: 'load', time: 12 })],
		['idle', 'loading', 'playing', 'paused', 'blocked', 'error'],
	);
});
