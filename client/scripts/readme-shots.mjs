// Screenshots of the demo page for README.md, each in a light and a dark version.
//
//   node scripts/readme-shots.mjs      (or pnpm readme-shots)
//
// Loads demo/index.html with the bundle in resources/dist, so run `pnpm build && pnpm demo`
// first when the client changed. Writes docs/screenshots/<name>-light.png and
// <name>-dark.png at device scale factor 2. Needs Google Chrome (or the Playwright channel in
// GRAMOPHONE_BROWSER_CHANNEL), and the network only to download the demo media into demo/media/
// when a file is missing (pnpm media). GRAMOPHONE_DEMO_PORT picks the port of the local server,
// by default any free one.
import { chromium } from 'playwright-core';
import { mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureMedia, startServer } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../docs/screenshots');
await ensureMedia();
const server = await startServer(Number(process.env.GRAMOPHONE_DEMO_PORT) || 0);
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
// Software rendering and a fixed colour profile: an unchanged page gives the same files on every run.
const browser = await chromium.launch({
	channel: process.env.GRAMOPHONE_BROWSER_CHANNEL || 'chrome',
	headless: true,
	args: ['--autoplay-policy=no-user-gesture-required', '--disable-gpu', '--force-color-profile=srgb'],
});
const problems = [];

// Only the target shows, on a transparent page, so each image sits on GitHub's own background.
const isolate = (target) => `html, body { background: transparent !important; } body { visibility: hidden; } ${target} { visibility: visible; }`;
// The infobox floats next to the start of the article.
const NO_INFOBOX = '#demo-narrow { display: none; }';
const ALBUM = '#demo-album .ext-gramophone';
const LYRICS = '#demo-lyrics .ext-gramophone';
const SINGLE = '#demo-single .ext-gramophone';

// Clicks an element inside a host's shadow root from script: no hover, no focus ring, no tooltip.
const press = (page, host, sel) => page.evaluate(([h, s]) => document.querySelector(h).shadowRoot.querySelector(s).click(), [host, sel]);

// Waits until the host plays, then holds it at `at` seconds (or at that fraction of the track,
// below 1). The audio pauses, but the player does not hear of it and keeps its playing look.
async function hold(page, host, at) {
	await page.waitForFunction(
		(h) => {
			const a = document.querySelector(h).shadowRoot.querySelector('audio');
			return a && !a.paused && a.currentTime > 0.05 && a.duration > 0;
		},
		host,
		{ timeout: 20000 },
	);
	await page.evaluate(
		async ([h, t]) => {
			const a = document.querySelector(h).shadowRoot.querySelector('audio');
			a.addEventListener('pause', (e) => e.stopImmediatePropagation(), { capture: true });
			a.pause();
			a.currentTime = t < 1 ? a.duration * t : t;
			await new Promise((r) => a.addEventListener('seeked', r, { once: true }));
		},
		[host, at],
	);
}

const SHOTS = [
	{
		// The album with its track list open, playing Galactic Love (track 6).
		name: 'album',
		target: ALBUM,
		async prepare(page) {
			await press(page, ALBUM, '.row[data-index="5"]');
			await hold(page, ALBUM, 0.4);
		},
	},
	{
		// Bubblin' at 0:15.2, on the line "A translation can sit under every line" (demo/lyrics/bubblin.lrc).
		name: 'lyrics',
		target: LYRICS,
		async prepare(page) {
			await press(page, LYRICS, '.play');
			await press(page, LYRICS, '[part~="lyrics-button"]');
			await hold(page, LYRICS, 15.2);
			await page.waitForFunction((h) => document.querySelector(h).shadowRoot.querySelector('.line.active'), LYRICS, { timeout: 8000 });
		},
	},
	{
		name: 'single',
		target: SINGLE,
		async prepare(page) {
			await press(page, SINGLE, '.play');
			await hold(page, SINGLE, 0.4);
		},
	},
	{
		// The opening paragraph and the track listing, with the button of Galactic Love playing. Its text
		// stands on the page itself, so the picture keeps the page background, 12px wider on each side.
		name: 'buttons',
		target: '#demo-buttons',
		pad: 0,
		css: NO_INFOBOX + ' #demo-buttons { margin: 0 -12px; padding: 12px; background: #fff; } html.skin-theme-clientpref-night #demo-buttons { background: #101418; }',
		async prepare(page) {
			const B = '#demo-tracklist tr:nth-child(7) .ext-gramophone-button';
			await press(page, B, '.b');
			await hold(page, B, 0.4);
		},
	},
	{
		name: 'track-list',
		target: '#demo-tracks table',
		// The header and the first four songs.
		css: NO_INFOBOX + ' #demo-tracks tr:nth-child(n+6) { display: none; }',
		async prepare(page) {
			const R = '#demo-tracks tr:nth-child(2) .ext-gramophone-player';
			await press(page, R, '.play');
			await hold(page, R, 0.4);
		},
	},
	{
		name: 'styles',
		height: 1300,
		// The styling showcase: five captioned players, the accent colour one playing. Its captions
		// stand on the page itself, so the picture keeps the page background, 12px wider on each side.
		target: '#demo-styles',
		pad: 0,
		css: NO_INFOBOX + ' #demo-styles { margin: 0 -12px; padding: 1px 12px 12px; background: #fff; } html.skin-theme-clientpref-night #demo-styles { background: #101418; }',
		async prepare(page) {
			const A = '#demo-styles > .ext-gramophone:nth-of-type(2)';
			await press(page, A, '.play');
			await hold(page, A, 0.4);
		},
	},
	{
		name: 'phone',
		width: 375,
		height: 812,
		// The article down to the paragraph with buttons, framed like a phone screen. The
		// demo's note for developers is left out.
		target: '.mw-body',
		pad: 0,
		css: '.demo-note, #demo-inline ~ *, #demo-buttons ~ * { display: none; } .mw-body { border: 1px solid #a2a9b1; border-radius: 16px; } html.skin-theme-clientpref-night .mw-body { border-color: #54595d; }',
		async prepare(page) {
			const N = '#demo-narrow .ext-gramophone';
			await press(page, N, '.play');
			await hold(page, N, 0.4);
		},
	},
];

await mkdir(OUT, { recursive: true });
let total = 0;
for (const shot of SHOTS) {
	for (const [theme, query] of [
		['light', ''],
		['dark', '?theme=night'],
	]) {
		const file = `${shot.name}-${theme}.png`;
		const ctx = await browser.newContext({
			viewport: { width: shot.width || 1000, height: shot.height || 1000 },
			deviceScaleFactor: 2,
			locale: 'en-US',
			colorScheme: theme,
			reducedMotion: 'reduce',
		});
		const page = await ctx.newPage();
		page.on('console', (m) => {
			// The demo's deliberately missing files log "Failed to load resource".
			if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`${file}: ${m.text()}`);
		});
		page.on('pageerror', (e) => problems.push(`${file}: ${e.message}`));
		page.on('request', (r) => {
			if (!r.url().startsWith(ORIGIN + '/') && !r.url().startsWith('data:')) problems.push(`${file}: request to ${r.url()}`);
		});
		try {
			await page.goto(`${ORIGIN}/client/demo/${query}`, { waitUntil: 'load' });
			await page.addStyleTag({ content: isolate(shot.target) + (shot.css || '') });
			await page.waitForFunction(() => window.gramophoneLoaded === true && Array.from(document.querySelectorAll('.ext-gramophone')).every((h) => h.shadowRoot), null, { timeout: 15000 });
			const target = page.locator(shot.target);
			// Centred, so that the margin around the target is inside the viewport too.
			await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
			await shot.prepare(page);
			// Covers and fonts fully loaded, nothing hovered.
			await page.waitForFunction(
				(sel) => {
					const el = document.querySelector(sel);
					const hosts = [el, ...el.querySelectorAll('.ext-gramophone')].filter((h) => h.shadowRoot && h.getClientRects().length);
					// A cover that site CSS hides (display: none) never loads, and is not in the picture.
					return hosts.every((h) => Array.from(h.shadowRoot.querySelectorAll('img')).every((i) => !i.getClientRects().length || (i.complete && i.naturalWidth > 0)));
				},
				shot.target,
				{ timeout: 10000 },
			);
			await page.evaluate(() => document.fonts.ready);
			await page.mouse.move(0, 0);
			await page.waitForTimeout(400);
			const box = await target.boundingBox();
			const pad = shot.pad ?? 12;
			// Whole CSS pixels, rounded inwards: a box at a half pixel would leave a transparent edge row.
			const [left, top] = [Math.ceil(box.x - pad), Math.ceil(box.y - pad)];
			const [right, bottom] = [Math.floor(box.x + box.width + pad), Math.floor(box.y + box.height + pad)];
			await page.screenshot({
				path: path.join(OUT, file),
				clip: { x: left, y: top, width: right - left, height: bottom - top },
				omitBackground: true,
				animations: 'disabled',
			});
			const { size } = await stat(path.join(OUT, file));
			total += size;
			console.log(`${file}  ${Math.round(box.width)}x${Math.round(box.height)} css px  ${(size / 1024).toFixed(0)} KB`);
		} catch (e) {
			problems.push(`${file}: ${e.message.split('\n')[0]}`);
		}
		await ctx.close();
	}
}

await browser.close();
server.close();
for (const p of problems) console.log(`FAIL  ${p}`);
console.log(`\n${problems.length ? 'failed' : 'done'}: ${(total / 1024).toFixed(0)} KB in ${path.relative(process.cwd(), OUT)}/`);
process.exit(problems.length ? 1 : 0);
