// End-to-end visual and behaviour check of the demo page in Google Chrome
// (or the Playwright channel in GRAMOPHONE_BROWSER_CHANNEL). Needs the network only to
// download the demo media into demo/media/ when a file is missing (pnpm media).
//
//   node scripts/visual-check.mjs            (bundle from resources/dist)
//   node scripts/visual-check.mjs --rl       (ResourceLoader-minified copy, see scripts/rl-minify.sh)
//
// Writes screenshots to demo/screenshots/ and prints one line per check.
// Exits non-zero if any check fails or the page logs errors.
import { chromium } from 'playwright-core';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureMedia, startServer } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '../demo/screenshots');
// GRAMOPHONE_DEMO_PORT picks another port when 8767 is taken.
const PORT = Number(process.env.GRAMOPHONE_DEMO_PORT) || 8767;
const BASE = `http://127.0.0.1:${PORT}/client/demo/`;
const RL = process.argv.includes('--rl');
const Q = RL ? 'bundle=rl&' : '';

await mkdir(SHOTS, { recursive: true });
await ensureMedia();
const server = await startServer(PORT);
const results = [];
const pageErrors = [];
const offsite = [];
const dialogs = [];

function check(name, ok, detail = '') {
	results.push({ name, ok: !!ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

async function step(name, fn) {
	try {
		await fn();
	} catch (e) {
		check(name, false, e.message.split('\n')[0]);
	}
}

// Playwright browser channel: Google Chrome by default, `msedge` also works. Playwright's bundled
// Chromium (`chromium`) cannot play the AAC previews.
const CHANNEL = process.env.GRAMOPHONE_BROWSER_CHANNEL || 'chrome';
const browser = await chromium.launch({
	channel: CHANNEL,
	headless: true,
	args: ['--autoplay-policy=no-user-gesture-required'],
});

async function open(url, { width = 1280, height = 900, scheme = 'light', reducedMotion = 'no-preference', autoplay = true, init = null, onConsole = null } = {}) {
	// Without autoplay, the policy is explicit: headless Chrome lets a late play() through otherwise.
	const b = autoplay ? browser : await chromium.launch({ channel: CHANNEL, headless: true, args: ['--autoplay-policy=user-gesture-required'] });
	const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: 'en-US', colorScheme: scheme, reducedMotion });
	if (init) await ctx.addInitScript(init);
	const page = await ctx.newPage();
	page.on('console', (m) => {
		if (onConsole) onConsole(m);
		const text = m.text();
		// Expected: the deliberately broken demo URLs (404 audio, 404 lyrics) and the favicon.
		if (m.type() === 'error' && !/Failed to load resource/.test(text)) pageErrors.push(`${url}: ${text}`);
	});
	page.on('pageerror', (e) => pageErrors.push(`${url}: ${e.message}`));
	// An alert from the hostile test case would mean that its text ran as script.
	page.on('dialog', (d) => {
		dialogs.push(`${url}: ${d.type()} ${d.message()}`);
		d.dismiss().catch(() => {});
	});
	page.on('request', (r) => {
		if (!r.url().startsWith(`http://127.0.0.1:${PORT}/`) && !r.url().startsWith('data:')) offsite.push(r.url());
	});
	await page.goto(BASE + url, { waitUntil: 'load' });
	return { page, close: () => (autoplay ? ctx.close() : b.close()) };
}

// Hosts mount lazily (near the viewport, then when idle): wait for all of them.
const mounted = (page) =>
	page.waitForFunction(() => window.gramophoneLoaded === true && Array.from(document.querySelectorAll('.ext-gramophone')).every((h) => h.shadowRoot), null, { timeout: 15000 });
const audioState = (page, sel) =>
	page.evaluate((s) => {
		const host = document.querySelector(s);
		const a = host && host.shadowRoot && host.shadowRoot.querySelector('audio');
		return a ? { t: a.currentTime, d: a.duration, paused: a.paused, rate: a.playbackRate, vol: a.volume, muted: a.muted, src: a.currentSrc } : null;
	}, sel);
const waitPlaying = (page, sel, min = 0.3) =>
	page.waitForFunction(
		([s, m]) => {
			const a = document.querySelector(s)?.shadowRoot?.querySelector('audio');
			return a && !a.paused && a.currentTime > m;
		},
		[sel, min],
		{ timeout: 20000 },
	);

// Waits until the audio of a host has moved more than 1 s away from `from` and finished seeking.
// Resolves to its state.
async function waitSeeked(page, sel, from) {
	await page
		.waitForFunction(
			([s, t]) => {
				const a = document.querySelector(s)?.shadowRoot?.querySelector('audio');
				return a && !a.seeking && Math.abs(a.currentTime - t) > 1;
			},
			[sel, from],
			{ timeout: 5000 },
		)
		.catch(() => {});
	return audioState(page, sel);
}

// ---------------------------------------------------------------------------
// 1. No layout shift: host boxes before and after hydration, wide and narrow.
for (const width of [1280, 375]) {
	await step(`layout shift @${width}px`, async () => {
		const { page, close } = await open(`?${Q}hold`, { width });
		const measure = () =>
			page.evaluate(() =>
				Array.from(document.querySelectorAll('.ext-gramophone')).map((el) => {
					const r = el.getBoundingClientRect();
					return { id: el.closest('[id]')?.id, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, y: Math.round(r.top), hidden: el.hidden };
				}),
			);
		const before = await measure();
		if (width === 1280) await page.screenshot({ path: `${SHOTS}/placeholder-1280.png`, fullPage: false });
		const bundle = await readFile(path.resolve(here, RL ? '../demo/build/gramophone.rl.js' : '../../resources/dist/gramophone.js'), 'utf8');
		// Runs ext.gramophone as ResourceLoader would. Players then load ext.gramophone.player through mw.loader.using().
		const sync = await page.evaluate((code) => {
			mw.loader.implement('ext.gramophone', code);
			const content = document.getElementById('mw-content-text');
			mw.hook('wikipage.content').fire({ get: () => [content] });
			return Array.from(document.querySelectorAll('.ext-gramophone')).filter((h) => h.shadowRoot).length;
		}, bundle);
		await page.waitForFunction(() => Array.from(document.querySelectorAll('.ext-gramophone')).every((h) => h.shadowRoot), null, { timeout: 15000 });
		const after = await measure();
		const hosts = await page.evaluate(() => document.querySelectorAll('.ext-gramophone').length);
		const hydrated = await page.evaluate(() => Array.from(document.querySelectorAll('.ext-gramophone')).filter((h) => h.shadowRoot && h.shadowRoot.childElementCount).length);
		// hidemissing=yes buttons whose file is missing are meant to disappear.
		const diffs = before
			.map((b, i) => ({ ...b, h2: after[i].h, w2: after[i].w, gone: after[i].hidden }))
			.filter((d) => !d.gone && (Math.abs(d.h - d.h2) > 0.5 || Math.abs(d.w - d.w2) > 0.5));
		check(`layout shift @${width}px: ${hosts} hosts, ${hydrated} hydrated, no size change`, hydrated === hosts && diffs.length === 0, diffs.slice(0, 4).map((d) => `${d.id} ${d.w}x${d.h} -> ${d.w2}x${d.h2}`).join('; '));
		check(`lazy mount @${width}px: only autoplay hosts mount at once, the rest later`, sync < hosts, `${sync} of ${hosts} at once`);
		await close();
	});
}

// ---------------------------------------------------------------------------
// 2. Static screenshots: light, dark, narrow, no-JS.
await step('static screenshots', async () => {
	for (const [name, url, opts] of [
		['light-1280', `?${Q}`, {}],
		['dark-night-1280', `?${Q}theme=night`, {}],
		['dark-os-1280', `?${Q}theme=os`, { scheme: 'dark' }],
		['narrow-375', `?${Q}`, { width: 375, height: 812 }],
		['narrow-375-dark', `?${Q}theme=night`, { width: 375, height: 812 }],
		['nojs-1280', `?nojs`, {}],
	]) {
		const { page, close } = await open(url, opts);
		if (!url.includes('nojs')) await mounted(page);
		await page.waitForTimeout(400);
		await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
		for (const id of ['demo-narrow', 'demo-buttons', 'demo-album', 'demo-lyrics', 'demo-single', 'demo-tracks', 'demo-playlist', 'demo-colors', 'demo-explicit', 'demo-missing', 'demo-button-cases', 'demo-themed', 'demo-hostile', 'demo-long']) {
			const el = await page.$('#' + id);
			if (el && !url.includes('nojs')) await el.screenshot({ path: `${SHOTS}/${name}-${id}.png` });
		}
		await close();
	}
	check('static screenshots written', true);
});

// ---------------------------------------------------------------------------
// 2b. Theme selection: OS dark only applies with skin-theme-clientpref-os.
await step('theme selection', async () => {
	const bg = async (url, scheme) => {
		const { page, close } = await open(url, { scheme });
		await mounted(page);
		const v = await page.evaluate(() => getComputedStyle(document.querySelector('#demo-single .ext-gramophone').shadowRoot.querySelector('.card')).backgroundColor);
		await close();
		return v;
	};
	check('OS dark without a clientpref class stays light (legacy Vector)', (await bg(`?${Q}`, 'dark')) === 'rgb(255, 255, 255)');
	check('clientpref-os follows OS dark', (await bg(`?${Q}theme=os`, 'dark')) === 'rgb(28, 28, 31)');
	check('clientpref-os follows OS light', (await bg(`?${Q}theme=os`, 'light')) === 'rgb(255, 255, 255)');
	check('clientpref-night is dark', (await bg(`?${Q}theme=night`, 'light')) === 'rgb(28, 28, 31)');
});

// ---------------------------------------------------------------------------
// 2c. Site CSS: ::part() rules, tokens and the tag's style attribute reach the shadow DOM.
await step('theming', async () => {
	const { page, close } = await open(`?${Q}`);
	await mounted(page);
	const t = await page.evaluate(() => {
		const r = document.querySelector('#demo-themed .ext-gramophone-player').shadowRoot;
		const css = (sel, prop) => getComputedStyle(r.querySelector(sel))[prop];
		return { radius: css('.card', 'borderTopLeftRadius'), font: css('.title', 'fontFamily'), play: css('.play', 'backgroundColor'), dl: css('.dl', 'display'), cover: css('.cover', 'width') };
	});
	check('theming: ::part() rules, tokens and the style attribute apply', t.radius === '0px' && /Georgia/.test(t.font) && t.play === 'rgb(58, 113, 148)' && t.dl === 'none' && t.cover === '120px', JSON.stringify(t));
	// The styling showcase (#demo-styles) applies the README snippets: default, accent, square, compact, playlist colours.
	const v = await page.evaluate(() => {
		const roots = Array.from(document.querySelectorAll('#demo-styles > .ext-gramophone-player')).map((h) => h.shadowRoot);
		const css = (i, sel, prop) => getComputedStyle(roots[i].querySelector(sel))[prop];
		const shown = (i, sel) => roots[i].querySelector(sel).getClientRects().length > 0;
		return {
			players: roots.filter((r) => r && r.querySelector('.card')).length,
			accent: css(1, '.play', 'backgroundColor'),
			square: [css(2, '.card', 'borderTopLeftRadius'), css(2, '.play', 'borderTopLeftRadius'), /Georgia/.test(css(2, '.title', 'fontFamily'))].join(),
			compact: [shown(0, '.cover'), shown(3, '.cover'), shown(3, '.speed'), shown(3, '.play')].join(),
			colors: css(4, '.card', 'backgroundColor'),
		};
	});
	check(
		'styles showcase: accent colour, square corners and serif font, compact without cover, playlist colours',
		v.players === 5 && v.accent === 'rgb(31, 122, 140)' && v.square === '0px,0px,true' && v.compact === 'true,false,false,true' && v.colors === 'rgb(27, 31, 59)',
		JSON.stringify(v),
	);
	await close();
});

// ---------------------------------------------------------------------------
// 3. Full player interactions.
await step('player interactions', async () => {
	const { page, close } = await open(`?${Q}`);
	await mounted(page);
	const S = '#demo-single .ext-gramophone';
	const P = '#demo-playlist .ext-gramophone';

	// Nothing is fetched before play (preload="none", no <audio> yet).
	const pre = await audioState(page, S);
	check('no audio element before first play', pre === null);

	await page.click(`${S} >> .play`);
	await waitPlaying(page, S);
	check('play starts playback', !(await audioState(page, S)).paused);
	const host = await page.evaluate((s) => [document.querySelector(s).dataset.gramophoneLayout, document.querySelector(s).dataset.gramophoneState].join(), S);
	check('host shows its layout and state for site CSS', host === 'card,playing', host);
	const session = await page.evaluate(() => ({ title: navigator.mediaSession.metadata && navigator.mediaSession.metadata.title, state: navigator.mediaSession.playbackState }));
	check('Media Session metadata and state', session.title === 'Mukyu Platonic' && session.state === 'playing', JSON.stringify(session));
	check('play button label switches to pause', (await page.getAttribute(`${S} >> .play`, 'aria-label')) === 'Pause');
	// The seek bar style changes only in steps of 1/1000 of the track: about 33 a second for a 30 s
	// preview, where a write every frame would make about 60.
	const writes = await page.evaluate(async (s) => {
		const el = document.querySelector(s).shadowRoot.querySelector('.seek-slider');
		let n = 0;
		const mo = new MutationObserver((r) => (n += r.length));
		mo.observe(el, { attributes: true, attributeFilter: ['style'] });
		await new Promise((r) => setTimeout(r, 1000));
		mo.disconnect();
		return n;
	}, S);
	check('playing: the seek bar moves, and its style is written only when it moves visibly', writes > 0 && writes < 40, `${writes} writes in 1 s`);
	// The single player's track links to Apple Music and is marked nofollow, the test playlist's tracks are not.
	const rels = await page.evaluate(
		([s, p]) => [s, p].map((sel) => {
			const r = document.querySelector(sel).shadowRoot;
			return [r.querySelector('.file').rel, r.querySelector('.dl').rel, r.querySelector('.dl').getAttribute('href').replace(/^.*\//, '')];
		}),
		[S, P],
	);
	check(
		'nofollow: only on the link to another site, the download link is the audio URL',
		JSON.stringify(rels) === JSON.stringify([['noopener nofollow', 'noopener', 'mukyu-platonic.m4a'], ['noopener', 'noopener', 'div-a3.m4a']]),
		JSON.stringify(rels),
	);

	// Hover tooltip on the seek bar.
	const slider = await page.$(`${S} >> .seek-slider`);
	const box = await slider.boundingBox();
	await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
	await page.waitForTimeout(250);
	await (await page.$('#demo-single')).screenshot({ path: `${SHOTS}/single-playing-hover.png` });

	// Seek by click to 50%.
	let st = await audioState(page, S);
	await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
	st = await waitSeeked(page, S, st.t);
	check('seek by click lands near 50%', Math.abs(st.t / st.d - 0.5) < 0.04, `${st.t.toFixed(1)}/${st.d.toFixed(1)}`);

	// Seek by drag 20% -> 75%, in twentieths so that the last step is 75%.
	const from = st.t;
	await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
	await page.mouse.down();
	for (let i = 4; i <= 15; i++) await page.mouse.move(box.x + (box.width * i) / 20, box.y + box.height / 2);
	await page.mouse.up();
	st = await waitSeeked(page, S, from);
	check('seek by drag lands near 75%', Math.abs(st.t / st.d - 0.75) < 0.04, `${st.t.toFixed(1)}/${st.d.toFixed(1)}`);

	// Keyboard on the focused card.
	await page.focus(`${S} >> .seek-slider`);
	const t0 = (await audioState(page, S)).t;
	await page.keyboard.press('ArrowLeft');
	await page.waitForFunction(([s, t]) => document.querySelector(s).shadowRoot.querySelector('audio').currentTime < t - 3, [S, t0], { timeout: 3000 }).catch(() => {});
	const t1 = (await audioState(page, S)).t;
	check('slider ArrowLeft seeks back about 5 s', t0 - t1 > 3.5 && t0 - t1 < 6.5, `${t0.toFixed(1)} -> ${t1.toFixed(1)}`);
	await page.keyboard.press('k');
	await page.waitForTimeout(200);
	check('K pauses', (await audioState(page, S)).paused);
	await page.keyboard.press(' ');
	await page.waitForTimeout(400);
	check('Space resumes', !(await audioState(page, S)).paused);
	await page.keyboard.press('m');
	await page.waitForTimeout(100);
	check('M mutes', (await audioState(page, S)).muted);
	await page.keyboard.press('m');
	await page.focus(`${S} >> .card`);
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await page.waitForTimeout(100);
	const vol = (await audioState(page, S)).vol;
	check('ArrowDown lowers volume', vol < 0.95 && vol > 0.85, `volume ${vol}`);
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ArrowUp');
	const stored = await page.evaluate(() => localStorage.getItem('ext-gramophone-volume'));
	await page.waitForTimeout(400);
	check('volume persisted in localStorage', (await page.evaluate(() => localStorage.getItem('ext-gramophone-volume'))) !== null, String(stored));

	// Volume popover and speed menu.
	await page.click(`${S} >> .vol`);
	await page.waitForTimeout(250);
	check('volume popover opens', (await page.getAttribute(`${S} >> .vol`, 'aria-expanded')) === 'true');
	await page.screenshot({ path: `${SHOTS}/single-volume-popover.png`, clip: await clipAround(page, '#demo-single', 90) });
	await page.keyboard.press('Escape');
	await page.click(`${S} >> .speed`);
	await page.waitForTimeout(250);
	await page.screenshot({ path: `${SHOTS}/single-speed-menu.png`, clip: await clipAround(page, '#demo-single', 260) });
	await page.click(`${S} >> [data-rate="1.5"]`);
	await page.waitForTimeout(150);
	check('speed menu sets 1.5x', (await audioState(page, S)).rate === 1.5);
	check('speed button shows 1.5x', (await page.textContent(`${S} >> .speed`)).trim() === '1.5×');

	// Single-player policy: starting the playlist pauses the single player.
	await page.click(`${P} >> .play`);
	await waitPlaying(page, P);
	check('starting another player pauses the first', (await audioState(page, S)).paused && !(await audioState(page, P)).paused);

	// Next / previous / repeat.
	await page.click(`${P} >> .next`);
	await waitPlaying(page, P, 0.1);
	check('next switches to track 2', (await audioState(page, P)).src.includes('diva-of-the-battlefield'));
	const live = await page.textContent(`${P} >> [aria-live]`);
	check('track change is announced', live === 'Now playing Lyrics test: GB18030 file, 500 ms offset', live);
	await page.click(`${P} >> .prev`);
	await page.waitForTimeout(300);
	check('prev returns to track 1', (await audioState(page, P)).src.includes('div-a3'));
	const labels = [];
	let loopAtOne = null;
	for (let i = 0; i < 3; i++) {
		labels.push(await page.getAttribute(`${P} >> .repeat`, 'aria-label'));
		await page.click(`${P} >> .repeat`);
		if (i === 0) loopAtOne = await page.evaluate((s) => document.querySelector(s).shadowRoot.querySelector('audio').loop, P);
	}
	check('repeat cycles all -> one -> off', labels.join(',') === 'Repeat all,Repeat one,Repeat off', labels.join(','));
	check('repeat one sets audio.loop', loopAtOne === true);

	// Playlist click.
	await page.click(`${P} >> .row[data-index="4"]`);
	await waitPlaying(page, P, 0.1);
	check('playlist row click plays that track', (await audioState(page, P)).src.includes('ripple'));
	check('current row marked aria-current', (await page.getAttribute(`${P} >> .row[data-index="4"]`, 'aria-current')) === 'true');
	await page.click(`${P} >> .row[data-index="3"]`, { force: true });
	check('missing row is not playable', (await audioState(page, P)).src.includes('ripple'));
	await (await page.$('#demo-playlist')).screenshot({ path: `${SHOTS}/playlist-playing.png` });

	// Keyboard navigation in the playlist.
	await page.focus(`${P} >> .row[data-index="0"]`);
	await page.keyboard.press('ArrowDown');
	const focused = await page.evaluate((s) => document.querySelector(s).shadowRoot.activeElement?.getAttribute('data-index'), P);
	check('ArrowDown moves focus to the next row', focused === '1', `focused ${focused}`);

	// Lyrics: track 1 (UTF-8, demo/lyrics/test-two-stamps.lrc). Line A has the timestamps 0:03 and 0:18,
	// and line E starts at 0:21. Each line carries the gloss line that repeats its timestamp.
	await page.click(`${P} >> .row[data-index="0"]`);
	await waitPlaying(page, P, 0.1);
	await page.click(`${P} >> .btn[aria-label="Lyrics"]`);
	await page.waitForSelector(`${P} >> .line`);
	await page.evaluate((s) => {
		const a = document.querySelector(s).shadowRoot.querySelector('audio');
		a.currentTime = 18.2;
	}, P);
	const active = await page
		.waitForFunction(
			(s) => {
				const a = document.querySelector(s).shadowRoot.querySelector('.line.active');
				return a && a.getAttribute('data-time') === '18' && a.textContent;
			},
			P,
			{ timeout: 5000 },
		)
		.then((h) => h.jsonValue(), () => null);
	check('lyrics highlight the line at 0:18 (two timestamps per line)', !!active && active.startsWith('Line A has two timestamps'), String(active));
	await (await page.$('#demo-playlist')).screenshot({ path: `${SHOTS}/lyrics-utf8.png` });
	// Click a lyric line to seek: line B at 0:06 lies behind the playing position, so playback cannot reach it.
	await page.click(`${P} >> .line >> text=Line B starts at 0:06`);
	const sought = await page
		.waitForFunction((s) => {
			const a = document.querySelector(s).shadowRoot.querySelector('audio');
			return !a.seeking && a.currentTime >= 6 && a.currentTime < 7.2;
		}, P, { timeout: 5000 })
		.then(() => true, () => false);
	st = await audioState(page, P);
	check('clicking a lyric line seeks to it', sought, st.t.toFixed(1));

	// Track 2: GB18030 encoded LRC with +500 ms offset (demo/lyrics/test-gb18030.lrc, Chinese test text).
	await page.click(`${P} >> .next`);
	await page.waitForSelector(`${P} >> .line >> text=测试第一行`, { timeout: 8000 });
	check('GB18030 lyrics decode', true);
	// Paused, so the position stays at 7.7 s however fast the file loads. Line 2
	// starts at 7.5 s in the file, 8 s with the offset.
	await page.evaluate((s) => {
		const a = document.querySelector(s).shadowRoot.querySelector('audio');
		a.pause();
		a.currentTime = 7.7;
	}, P);
	await page.waitForTimeout(500);
	const off = await page.textContent(`${P} >> .line.active`).catch(() => null);
	check('lyricsOffset 500 ms applied (7.7 s still shows line 1)', off === '测试第一行：这个文件用 GB18030 编码', String(off));

	// Track 3: lyrics 404 -> error state.
	await page.click(`${P} >> .next`);
	await page.waitForSelector(`${P} >> .lyrics-status.is-error`, { timeout: 8000 });
	check('lyrics fetch failure shows error state', true);
	await (await page.$('#demo-playlist')).screenshot({ path: `${SHOTS}/lyrics-error.png` });

	// Removing a playing host stops playback.
	await page.click(`${S} >> .play`);
	await waitPlaying(page, S);
	const audioPaused = await page.evaluate(async (s) => {
		const host = document.querySelector(s);
		const a = host.shadowRoot.querySelector('audio');
		host.remove();
		await new Promise((r) => setTimeout(r, 400));
		return a.paused;
	}, S);
	check('removing a playing host pauses it', audioPaused);

	// Re-firing wikipage.content does not mount twice.
	const before = await page.evaluate(() => document.querySelectorAll('.ext-gramophone').length);
	await page.evaluate(() => {
		const c = document.getElementById('mw-content-text');
		mw.hook('wikipage.content').fire({ get: () => [c] });
	});
	check('re-firing wikipage.content is idempotent', (await page.evaluate(() => document.querySelectorAll('.ext-gramophone').length)) === before);
	await close();
});

// ---------------------------------------------------------------------------
// 4. Error, missing and compact buttons.
await step('errors and buttons', async () => {
	const { page, close } = await open(`?${Q}`);
	await mounted(page);
	check('missing file player: play disabled', (await page.getAttribute('#demo-missing .ext-gramophone >> .play', 'aria-disabled')) === 'true');
	await page.click('#demo-broken .ext-gramophone >> .play');
	await page.waitForSelector('#demo-broken .ext-gramophone >> .sub.is-error', { timeout: 15000 });
	check('broken URL shows load error', (await page.textContent('#demo-broken .ext-gramophone >> .sub')).includes('could not be played'));
	await (await page.$('#demo-broken')).screenshot({ path: `${SHOTS}/broken-error.png` });

	const B = '#demo-tracklist .ext-gramophone-button';
	await page.click(B);
	await waitPlaying(page, B, 0.6);
	const ring = await page.evaluate((s) => Number(document.querySelector(s).shadowRoot.querySelector('.ring-fg').getAttribute('stroke-dashoffset')), B);
	check('button progress ring advances', ring < 92.6, `dashoffset ${ring}`);
	await page.mouse.move(5, 5);
	await page.hover(B);
	await page.waitForTimeout(700);
	await page.screenshot({ path: `${SHOTS}/button-playing-tooltip.png`, clip: await clipAround(page, '#demo-tracklist', 70, 320) });
	// Starting another button pauses this one.
	const B2 = '#demo-tracklist tr:nth-child(5) .ext-gramophone-button';
	await page.click(B2);
	await waitPlaying(page, B2, 0.1);
	check('second button pauses the first', (await audioState(page, B)).paused);
	// Sequential playback: 3 files in one button.
	const SEQ = '#case-sequence .ext-gramophone-button';
	await page.click(SEQ);
	await waitPlaying(page, SEQ, 0.1);
	await page.evaluate((s) => {
		const a = document.querySelector(s).shadowRoot.querySelector('audio');
		a.currentTime = a.duration - 0.2;
	}, SEQ);
	await page.waitForFunction((s) => document.querySelector(s).shadowRoot.querySelector('audio').currentSrc.includes('diva-of-the-battlefield'), SEQ, { timeout: 8000 });
	check('multi-file button continues with the next file', true);
	check('count badge shows the current index', (await page.textContent(`${SEQ} >> .count`)) === '2');
	await (await page.$('#demo-button-cases')).screenshot({ path: `${SHOTS}/button-sequence.png` });
	check('missing button is disabled', (await page.getAttribute('#case-missing .ext-gramophone-button >> .b', 'aria-disabled')) === 'true');
	await close();
});

// ---------------------------------------------------------------------------
// 4a. A playing host stops redrawing every frame while it is off screen, and resumes on screen.
await step('frame loop off screen', async () => {
	const init = () => {
		window.__frames = 0;
		const raf = window.requestAnimationFrame.bind(window);
		window.requestAnimationFrame = (fn) => {
			window.__frames++;
			return raf(fn);
		};
	};
	const { page, close } = await open(`?${Q}`, { init });
	await mounted(page);
	const B = '#case-one .ext-gramophone-button';
	await page.click(B);
	await waitPlaying(page, B, 0.3);
	const frames = () =>
		page.evaluate(async () => {
			const n = window.__frames;
			await new Promise((r) => setTimeout(r, 1000));
			return window.__frames - n;
		});
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	await page.waitForTimeout(300);
	const offScreen = await frames();
	const ring = (s) => document.querySelector(s).shadowRoot.querySelector('.ring-fg').getAttribute('stroke-dashoffset');
	const before = await page.evaluate(ring, B);
	await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), B);
	const moved = await page
		.waitForFunction(([s, b]) => Number(document.querySelector(s).shadowRoot.querySelector('.ring-fg').getAttribute('stroke-dashoffset')) < Number(b), [B, before], { timeout: 5000 })
		.then(() => true, () => false);
	const after = await page.evaluate(ring, B);
	// timeupdate moves the ring too, so the frame loop must also run again.
	const back = await frames();
	check('frame loop stops off screen', offScreen < 5, `${offScreen} frames in 1 s off screen`);
	check('the ring keeps moving after coming back on screen', moved && back > offScreen && !(await audioState(page, B)).paused, `${before} -> ${after}, ${back} frames in 1 s back on screen`);
	await close();
});

// ---------------------------------------------------------------------------
// 4c. A page with only buttons never loads ext.gramophone.player; a player added later loads it.
await step('player module on demand', async () => {
	const { page, close } = await open(`?${Q}hold`);
	await page.evaluate(() => {
		const players = Array.from(document.querySelectorAll('.ext-gramophone-player'));
		window.__player = players[0].outerHTML;
		players.forEach((p) => p.remove());
		window.gramophoneLoad();
	});
	await page.waitForFunction(() => window.gramophoneLoaded === true && Array.from(document.querySelectorAll('.ext-gramophone')).every((h) => h.shadowRoot), null, { timeout: 15000 });
	await page.waitForTimeout(300);
	const files = () => page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name.replace(/^.*\//, '')).filter((n) => /^gramophone\./.test(n)).join());
	const buttonsOnly = await files();
	const mountedPlayer = await page.evaluate(async () => {
		const box = document.createElement('div');
		box.innerHTML = window.__player;
		document.getElementById('mw-content-text').appendChild(box);
		mw.hook('wikipage.content').fire({ get: () => [box] });
		for (let i = 0; i < 100 && !box.firstElementChild.shadowRoot; i++) await new Promise((r) => setTimeout(r, 50));
		return !!box.firstElementChild.shadowRoot;
	});
	const later = await files();
	const rlName = RL ? '.rl' : '';
	check(
		'buttons-only page loads ext.gramophone only, a player added later loads ext.gramophone.player',
		buttonsOnly === `gramophone${rlName}.js` && mountedPlayer && later === `gramophone${rlName}.js,gramophone.player${rlName}.js`,
		`${buttonsOnly} -> ${later}, player mounted: ${mountedPlayer}`,
	);
	await close();
});

// ---------------------------------------------------------------------------
// 4b. hidemissing=yes: a HEAD check per file, only the button whose file exists stays.
await step('hidemissing', async () => {
	const { page, close } = await open(`?${Q}`);
	await mounted(page);
	const S = '#demo-hidemissing .ext-gramophone-button';
	// The section is at the end of the page: nothing is checked until it comes within two screens.
	await page.waitForTimeout(500);
	const far = await page.evaluate((s) => ({
		checking: Array.from(document.querySelectorAll(s)).map((h) => (h.hidden ? 'hidden' : h.classList.contains('ext-gramophone-checking') ? 'checking' : 'shown')).join(),
		heads: performance.getEntriesByType('resource').filter((e) => /\/ripple\.m4a|gramophone-does-not-exist\.m4a/.test(e.name)).length,
	}), S);
	check('hidemissing: buttons far below the viewport wait, unchecked', far.checking === 'checking,checking,hidden' && far.heads === 0, JSON.stringify(far));
	await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), S);
	await page.waitForFunction((s) => Array.from(document.querySelectorAll(s)).every((h) => h.hidden || h.classList.contains('ext-gramophone-checked')), S, { timeout: 10000 });
	const states = await page.evaluate((s) => Array.from(document.querySelectorAll(s)).map((h) => (h.hidden ? 'hidden' : 'shown')), S);
	check('hidemissing: existing file shown, missing files hidden', states.join() === 'shown,hidden,hidden', states.join());
	const loads = await page.evaluate(() =>
		performance.getEntriesByType('resource').filter((e) => /\/ripple\.m4a|gramophone-does-not-exist\.m4a/.test(e.name)).map((e) => `${e.initiatorType} ${e.name.replace(/^.*\//, '')}`),
	);
	check('hidemissing: one fetch per file, no audio download before a click', loads.length === 2 && loads.every((l) => l.startsWith('fetch ')), loads.join('; '));
	const box = await page.evaluate((s) => {
		const r = document.querySelector(s).getBoundingClientRect();
		return [r.width, r.height];
	}, S);
	check('hidemissing: the shown button has the normal button size', box[0] > 20 && box[0] === box[1], box.join('x'));
	await (await page.$('#demo-hidemissing')).screenshot({ path: `${SHOTS}/hidemissing.png` });
	await page.click(S);
	await waitPlaying(page, S, 0.2);
	check('hidemissing: the shown button plays', true);
	await close();
});

// Without the script the buttons stay invisible, then the stylesheet reveals them after 10 s
// (finished here instead of waiting). A button the script has taken over loses that timer.
await step('hidemissing without the script', async () => {
	const { page, close } = await open(`?${Q}hold`);
	const S = '#demo-hidemissing .ext-gramophone-button';
	const vis = () => page.evaluate((s) => Array.from(document.querySelectorAll(s)).map((h) => getComputedStyle(h).visibility).join(), S);
	const before = await vis();
	const taken = await page.evaluate((s) => {
		const h = document.querySelector(s);
		h.classList.add('ext-gramophone-checking');
		return document.getAnimations().filter((a) => a.effect && a.effect.target === h).length;
	}, S);
	await page.evaluate((s) => document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.matches(s)).forEach((a) => a.finish()), S);
	const after = await vis();
	check('hidemissing: without the script the buttons wait, then the stylesheet reveals them', before === 'hidden,hidden,hidden' && after === 'hidden,visible,visible' && taken === 0, `${before} -> ${after}, ${taken} timers on the taken-over button`);
	await close();
});

// The check does not wait for mounting: with idle mounting off, the section at the end of the page
// stays unmounted, yet the found button shows its placeholder and keyboard focus mounts it.
await step('hidemissing before mount', async () => {
	const { page, close } = await open(`?${Q}`, { init: () => (window.requestIdleCallback = () => 0) });
	await page.waitForFunction(() => window.gramophoneLoaded === true);
	const S = '#demo-hidemissing .ext-gramophone-button';
	// Hosts mount within one screen of the viewport and are checked within two: stop 2.5 screens above.
	await page.evaluate((s) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - 2.5 * innerHeight), S);
	await page.waitForFunction((s) => Array.from(document.querySelectorAll(s)).every((h) => h.hidden || h.classList.contains('ext-gramophone-checked')), S, { timeout: 10000 });
	const before = await page.evaluate((s) => Array.from(document.querySelectorAll(s)).map((h) => (h.hidden ? 'hidden' : 'shown') + (h.shadowRoot ? ' mounted' : '')), S);
	check('hidemissing: checked before mounting', before.join() === 'shown,hidden,hidden', before.join());
	await page.focus(`${S} .ext-gramophone-fallback-link`);
	await page.waitForFunction((s) => !!document.querySelector(s).shadowRoot, S, { timeout: 5000 });
	await page.waitForTimeout(200);
	const focused = await page.evaluate((s) => {
		const host = document.querySelector(s);
		return host.shadowRoot && host.shadowRoot.activeElement ? host.shadowRoot.activeElement.getAttribute('aria-label') : null;
	}, S);
	check('hidemissing: focusing the placeholder mounts the button and moves focus to it', focused === 'Play Ripple', String(focused));
	await close();
});

// ---------------------------------------------------------------------------
// 5. Autoplay: blocked without a gesture, playing when allowed.
await step('autoplay', async () => {
	// Playwright's evaluate calls count as a user gesture, so nothing may run in the page before
	// the player tries to play: the page logs the outcome instead.
	const logPlay = () => {
		const play = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function () {
			const p = play.call(this);
			p.then(() => console.log('gramophone-autoplay played'), (e) => console.log('gramophone-autoplay ' + e.name));
			return p;
		};
	};
	let attempted;
	const attempt = new Promise((res) => (attempted = res));
	const blocked = await open(`autoplay.html?${Q}`, { autoplay: false, init: logPlay, onConsole: (m) => m.text().startsWith('gramophone-autoplay') && attempted(m.text()) });
	const outcome = await Promise.race([attempt, new Promise((res) => setTimeout(() => res('no play() within 15 s'), 15000))]);
	check('autoplay without a gesture is refused by the browser', outcome === 'gramophone-autoplay NotAllowedError', outcome);
	await mounted(blocked.page);
	await blocked.page.waitForSelector('#demo-autoplay .ext-gramophone >> .card.is-blocked', { timeout: 8000 });
	check('autoplay blocked shows click-to-play state', (await blocked.page.textContent('#demo-autoplay .ext-gramophone >> .sub')).includes('blocked autoplay'));
	await (await blocked.page.$('#demo-autoplay')).screenshot({ path: `${SHOTS}/autoplay-blocked.png` });
	await blocked.close();
	const allowed = await open(`autoplay.html?${Q}`);
	await mounted(allowed.page);
	await waitPlaying(allowed.page, '#demo-autoplay .ext-gramophone');
	check('autoplay plays when allowed', true);
	await allowed.close();
});

// ---------------------------------------------------------------------------
// 5b. Keyboard focus rings and hover states.
await step('focus and hover', async () => {
	const { page, close } = await open(`?${Q}`);
	await mounted(page);
	const P = '#demo-playlist .ext-gramophone';
	await page.focus(`${P} >> .play`);
	await page.keyboard.press('Tab');
	await page.waitForTimeout(400);
	const name = await page.evaluate((s) => document.querySelector(s).shadowRoot.activeElement?.getAttribute('aria-label'), P);
	check('Tab moves from play to next', name === 'Next track', String(name));
	await page.screenshot({ path: `${SHOTS}/focus-next.png`, clip: await clipAround(page, '#demo-playlist', 50) });
	await page.keyboard.press('Tab');
	await page.waitForTimeout(200);
	await page.screenshot({ path: `${SHOTS}/focus-seek.png`, clip: await clipAround(page, '#demo-playlist', 50) });
	// Scrolling hides a tooltip, so the player is scrolled to before the pointer enters.
	await page.$eval('#demo-single', (el) => el.scrollIntoView({ block: 'center' }));
	await page.mouse.move(5, 5);
	await page.hover('#demo-single .ext-gramophone >> .dl');
	await page.waitForTimeout(700);
	await page.screenshot({ path: `${SHOTS}/hover-download.png`, clip: await clipAround(page, '#demo-single', 50) });
	check('hover tooltip shows the button label', await page.evaluate(() => {
		const host = document.querySelector('.ext-gramophone-tooltip');
		const tt = host && host.shadowRoot.querySelector('.tt.show');
		return tt ? tt.textContent : null;
	}) === 'Download');
	// A round button entered through a corner of its host: the first event targets the host itself.
	await page.$eval('#demo-inline .ext-gramophone-button', (el) => el.scrollIntoView({ block: 'center' }));
	const bb = await (await page.$('#demo-inline .ext-gramophone-button')).boundingBox();
	await page.mouse.move(5, 5);
	await page.mouse.move(bb.x + 1, bb.y + 1);
	await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 4 });
	await page.waitForTimeout(700);
	const cornerTip = await page.evaluate(() => {
		const host = document.querySelector('.ext-gramophone-tooltip');
		const tt = host && host.shadowRoot.querySelector('.tt.show');
		return tt ? tt.textContent : null;
	});
	check('hover tooltip also shows when the pointer enters a round button through its corner', cornerTip === 'Div.A3', String(cornerTip));
	await close();
});

// ---------------------------------------------------------------------------
// 5d. Buffering spinner on a slow network.
await step('loading spinner', async () => {
	const { page, close } = await open(`?${Q}`);
	await mounted(page);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Network.enable');
	await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: 20000, uploadThroughput: 20000 });
	const S = '#demo-explicit .ext-gramophone';
	const B = '#case-another .ext-gramophone-button';
	await page.click(`${S} >> .play`);
	await page.waitForSelector(`${S} >> .play .spin`, { timeout: 5000 });
	check('player shows a spinner while buffering', (await page.getAttribute(`${S} >> .play`, 'aria-label')) === 'Loading…');
	await (await page.$('#demo-explicit')).screenshot({ path: `${SHOTS}/player-loading.png` });
	await page.click(B);
	await page.waitForSelector(`${B} >> .b.loading`, { timeout: 5000 });
	check('button shows a spinning ring while buffering', true);
	await page.screenshot({ path: `${SHOTS}/button-loading.png`, clip: await clipAround(page, '#case-another') });
	await close();
});

// ---------------------------------------------------------------------------
// 5c. Fallbacks: no Popover API, no constructable stylesheets.
await step('fallback paths', async () => {
	const init = () => {
		delete HTMLElement.prototype.popover;
		delete ShadowRoot.prototype.adoptedStyleSheets;
	};
	const { page, close } = await open(`?${Q}`, { init });
	await mounted(page);
	const S = '#demo-single .ext-gramophone';
	const styled = await page.evaluate((s) => !!document.querySelector(s).shadowRoot.querySelector('style'), S);
	check('<style> fallback without adoptedStyleSheets', styled);
	const h = await page.evaluate((s) => document.querySelector(s).getBoundingClientRect().height, S);
	check('fallback styles give the same player height', Math.abs(h - 122) < 0.6, String(h));
	await page.click(`${S} >> .vol`);
	await page.waitForTimeout(200);
	const shown = await page.evaluate((s) => {
		const pop = document.querySelector(s).shadowRoot.querySelector('.vol-pop');
		return pop && !pop.hidden && pop.classList.contains('pop-inline');
	}, S);
	check('inline popover opens without the Popover API', shown);
	// The inline panel sits just above its button, at its natural size.
	const placed = (btn, pop) =>
		page.evaluate(
			([s, b, p]) => {
				const r = document.querySelector(s).shadowRoot;
				const a = r.querySelector(b).getBoundingClientRect();
				const q = r.querySelector(p).getBoundingClientRect();
				return { gap: Math.round(a.top - q.bottom), w: Math.round(q.width), h: Math.round(q.height), right: Math.round(q.right - a.right) };
			},
			[S, btn, pop],
		);
	const volBox = await placed('.vol', '.vol-pop');
	check('inline volume popover sits above its button', volBox.gap >= 4 && volBox.gap <= 16 && volBox.w > 150 && volBox.h > 30, JSON.stringify(volBox));
	await (await page.$('#demo-single')).screenshot({ path: `${SHOTS}/fallback-volume.png` });
	await page.mouse.click(5, 300);
	await page.waitForTimeout(150);
	check('outside click closes the inline popover', await page.evaluate((s) => document.querySelector(s).shadowRoot.querySelector('.vol-pop').hidden, S));
	await page.click(`${S} >> .speed`);
	await page.waitForTimeout(200);
	const speedBox = await placed('.speed', '.speed-pop');
	check('inline speed menu sits above its button', speedBox.gap >= 4 && speedBox.gap <= 16 && speedBox.w > 80 && speedBox.h > 150, JSON.stringify(speedBox));
	await (await page.$('#demo-single')).screenshot({ path: `${SHOTS}/fallback-speed.png` });
	await page.keyboard.press('Escape');
	await page.waitForTimeout(150);
	const esc = await page.evaluate((s) => {
		const r = document.querySelector(s).shadowRoot;
		return { hidden: r.querySelector('.speed-pop').hidden, focus: r.activeElement && r.activeElement.classList.contains('speed') };
	}, S);
	check('Escape closes the inline speed menu and refocuses its button', esc.hidden && esc.focus, JSON.stringify(esc));
	await page.hover(`${S} >> .dl`);
	await page.waitForTimeout(700);
	check('tooltip works without the Popover API', await page.evaluate(() => !!document.querySelector('.ext-gramophone-tooltip')?.shadowRoot.querySelector('.tt.show')));
	await close();
});

// ---------------------------------------------------------------------------
// 5b. A removed player lets go of the page: Media Session, popovers, lyrics.
await step('host removal and lyrics resync', async () => {
	const init = () => {
		window.__ms = {};
		if (navigator.mediaSession) {
			const set = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
			navigator.mediaSession.setActionHandler = (a, fn) => {
				window.__ms[a] = fn;
				return set(a, fn);
			};
		}
	};
	const { page, close } = await open(`?${Q}`, { init });
	await mounted(page);
	const P = '#demo-playlist .ext-gramophone';
	const S = '#demo-single .ext-gramophone';

	// Reopening the lyrics panel after a seek shows the line for the new position.
	await page.click(`${P} >> .play`);
	await waitPlaying(page, P);
	await page.click(`${P} >> .btn[aria-label="Lyrics"]`);
	await page.waitForSelector(`${P} >> .line.active`, { timeout: 8000 });
	await page.click(`${P} >> .play`);
	await page.click(`${P} >> .btn[aria-label="Lyrics"]`);
	// Three 5 s steps forward: the 30 s preview has no room for a 30 s PageUp.
	await page.focus(`${P} >> .seek-slider`);
	for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
	await page.waitForFunction((s) => {
		const a = document.querySelector(s).shadowRoot.querySelector('audio');
		return !a.seeking && a.currentTime > 10;
	}, P, { timeout: 5000 });
	await page.click(`${P} >> .btn[aria-label="Lyrics"]`);
	await page.waitForSelector(`${P} >> .line.active`, { timeout: 5000 });
	const sync = await page.evaluate((s) => {
		const r = document.querySelector(s).shadowRoot;
		const t = r.querySelector('audio').currentTime;
		const lines = Array.from(r.querySelectorAll('.line'));
		let want = -1;
		lines.forEach((l, i) => {
			if (Number(l.getAttribute('data-time')) <= t) want = i;
		});
		return { t: Math.round(t), want, active: lines.findIndex((l) => l.classList.contains('active')) };
	}, P);
	check('reopened lyrics panel follows a seek made while it was closed', sync.want > 0 && sync.active === sync.want, JSON.stringify(sync));

	// A paused player that owns the Media Session, with its speed menu open, is removed.
	await page.click(`${S} >> .play`);
	await waitPlaying(page, S);
	await page.click(`${S} >> .play`);
	await page.click(`${S} >> .speed`);
	await page.waitForTimeout(200);
	const cdp = await page.context().newCDPSession(page);
	const winListeners = async () => {
		const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
		const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
		return listeners.filter((l) => l.type === 'scroll' || l.type === 'resize').length;
	};
	const listenersOpen = await winListeners();
	const after = await page.evaluate(async (s) => {
		const host = document.querySelector(s);
		const a = host.shadowRoot.querySelector('audio');
		host.remove();
		await new Promise((r) => setTimeout(r, 100));
		const ms = navigator.mediaSession;
		const meta = ms.metadata ? ms.metadata.title : null;
		// A media key after removal must not wake the detached player.
		if (window.__ms.play) window.__ms.play();
		await new Promise((r) => setTimeout(r, 600));
		return { meta, state: ms.playbackState, handlers: Object.keys(window.__ms).filter((k) => window.__ms[k]), paused: a.paused };
	}, S);
	const listenersAfter = await winListeners();
	check('removed player clears Media Session metadata and handlers', after.meta === null && after.state === 'none' && after.handlers.length === 0 && after.paused, JSON.stringify(after));
	check('removed player releases the open popover window listeners', listenersAfter === listenersOpen - 2, `${listenersOpen} -> ${listenersAfter}`);
	await close();
});

// ---------------------------------------------------------------------------
// 5e. A player that never played, removed with a popover open, lets go of the window.
await step('never-played player removal', async () => {
	const { page, close } = await open(`?${Q}`);
	await mounted(page);
	const C = '#demo-colors .ext-gramophone';
	await page.click(`${C} >> .speed`);
	await page.waitForTimeout(200);
	const cdp = await page.context().newCDPSession(page);
	const winListeners = async () => {
		const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
		const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
		return listeners.filter((l) => l.type === 'scroll' || l.type === 'resize').length;
	};
	const before = await winListeners();
	const played = await page.evaluate(async (s) => {
		const host = document.querySelector(s);
		const audio = !!document.querySelector('.ext-gramophone') && Array.from(document.querySelectorAll('.ext-gramophone')).some((h) => h.shadowRoot && h.shadowRoot.querySelector('audio'));
		host.remove();
		await new Promise((r) => setTimeout(r, 100));
		return audio;
	}, C);
	const after = await winListeners();
	check('a removed player that never played releases its open popover listeners', !played && after === before - 2, `${before} -> ${after}`);
	await close();
});

// ---------------------------------------------------------------------------
// 5f. ext.gramophone.player cannot load: players show all their links; a later host tries again.
await step('player module cannot load', async () => {
	const { page, close } = await open(`?${Q}hold`);
	await page.route('**/gramophone.player*.js', (route) => route.fulfill({ status: 500, body: 'oops' }));
	await page.evaluate(() => {
		window.__errors = [];
		mw.log.error = (e) => window.__errors.push(String((e && e.message) || e));
		window.__using = 0;
		const using = mw.loader.using;
		mw.loader.using = (n) => {
			window.__using++;
			return using(n);
		};
		window.gramophoneLoad();
	});
	await page.waitForFunction(() => window.gramophoneLoaded === true && Array.from(document.querySelectorAll('.ext-gramophone-player')).every((h) => h.shadowRoot), null, { timeout: 15000 });
	const r = await page.evaluate(async () => {
		const host = document.querySelector('#demo-playlist .ext-gramophone-player');
		const links = Array.from(host.shadowRoot.querySelectorAll('a'));
		// A host added later asks for the module again, and shows its list too.
		const box = document.createElement('div');
		box.innerHTML = host.outerHTML;
		document.getElementById('mw-content-text').appendChild(box);
		const asked = window.__using;
		mw.hook('wikipage.content').fire({ get: () => [box] });
		const late = box.firstElementChild;
		for (let i = 0; i < 50 && !late.shadowRoot; i++) await new Promise((res) => setTimeout(res, 50));
		return {
			links: links.length,
			shown: links.filter((a) => a.getBoundingClientRect().height > 0).length,
			retried: window.__using > asked,
			late: late.shadowRoot ? late.shadowRoot.querySelectorAll('a').length : 0,
			errors: window.__errors.length,
		};
	});
	check(
		'player module cannot load: each player lists all its links, one error, a later host tries again',
		r.links === 7 && r.shown === 7 && r.retried && r.late === 7 && r.errors === 1,
		JSON.stringify(r),
	);
	await (await page.$('#demo-playlist')).screenshot({ path: `${SHOTS}/player-module-failed.png` });
	await close();
});

// ---------------------------------------------------------------------------
// 5g. A player removed while ext.gramophone.player loads mounts when it comes back.
await step('player removed while its code loads', async () => {
	const { page, close } = await open(`?${Q}hold`);
	await page.route('**/gramophone.player*.js', async (route) => {
		await new Promise((res) => setTimeout(res, 1500));
		await route.continue();
	});
	const r = await page.evaluate(async () => {
		window.gramophoneLoad();
		while (!window.gramophoneLoaded) await new Promise((res) => setTimeout(res, 20));
		const host = document.querySelector('#demo-single .ext-gramophone-player');
		host.scrollIntoView();
		// The observer takes it, and it waits for the module.
		await new Promise((res) => setTimeout(res, 300));
		const parent = host.parentNode;
		host.remove();
		await new Promise((res) => setTimeout(res, 2500));
		const skipped = !host.shadowRoot;
		parent.appendChild(host);
		mw.hook('wikipage.content').fire({ get: () => [parent] });
		for (let i = 0; i < 60 && !host.shadowRoot; i++) await new Promise((res) => setTimeout(res, 50));
		return { skipped, mounted: !!(host.shadowRoot && host.shadowRoot.querySelector('.card')) };
	});
	check('a player removed while ext.gramophone.player loads mounts when it comes back', r.skipped && r.mounted, JSON.stringify(r));
	await close();
});

// ---------------------------------------------------------------------------
// 5h. hidemissing: a button built before its check drops the missing file from its label.
await step('hidemissing button built before its check', async () => {
	const { page, close } = await open(`?${Q}hold`, { height: 700 });
	const S = '#demo-late-check .ext-gramophone-button';
	await page.evaluate(() => {
		const p = document.createElement('p');
		p.id = 'demo-late-check';
		p.style.marginTop = '20000px';
		p.innerHTML = 'Far below: <span class="ext-gramophone ext-gramophone-button"><a class="ext-gramophone-fallback-link" href="#">Gone</a></span>';
		const tracks = [
			{ src: '/client/demo/media/gramophone-does-not-exist.m4a', title: 'Gone', verify: true },
			{ src: '/client/demo/media/e-div.m4a', title: 'Present', verify: true },
		];
		p.lastElementChild.setAttribute('data-mw-gramophone', JSON.stringify({ v: 2, mode: 'button', hideMissing: true, tracks }));
		document.getElementById('mw-content-text').appendChild(p);
		window.gramophoneLoad();
	});
	// The idle loop builds it while it is still far away and unchecked.
	await page.waitForFunction((s) => !!document.querySelector(s).shadowRoot, S, { timeout: 15000 });
	const unchecked = await page.evaluate((s) => document.querySelector(s).classList.contains('ext-gramophone-checking'), S);
	await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), S);
	await page.waitForFunction((s) => document.querySelector(s).classList.contains('ext-gramophone-checked'), S, { timeout: 10000 });
	const label = await page.evaluate((s) => {
		const b = document.querySelector(s).shadowRoot.querySelector('button');
		return [b.getAttribute('aria-label'), b.getAttribute('data-tip')];
	}, S);
	check('hidemissing: a button built before its check drops the missing file from its label', unchecked && label[0] === 'Play Present' && label[1] === 'Present (Track 2 of 2)', JSON.stringify(label));
	await close();
});

// ---------------------------------------------------------------------------
// 5c. Single tracks in table cells render as one row; keyboard focus mounts.
await step('table rows and focus mounting', async () => {
	const { page, close } = await open(`?${Q}`);
	await mounted(page);
	const rows = await page.evaluate(() =>
		Array.from(document.querySelectorAll('#demo-tracks-legacy .ext-gramophone-player, #demo-tracks .ext-gramophone-player')).map((h) => {
			const r = h.shadowRoot;
			return { h: Math.round(h.getBoundingClientRect().height), pill: !!r.querySelector('.pill'), label: r.querySelector('.play').getAttribute('aria-label') };
		}),
	);
	check(`track tables: ${rows.length} single tracks in cells render as 40px rows`, rows.length === 18 && rows.every((r) => r.pill && r.h === 40), JSON.stringify(rows.find((r) => !r.pill || r.h !== 40) || ''));
	check('row play button is named after the track', rows[0] && rows[0].label === "Play Bubblin'", rows[0] && rows[0].label);
	const unknown = await page.evaluate(() => Array.from(document.querySelectorAll('.ext-gramophone')).filter((h) => h.shadowRoot && /unknown artist/i.test(h.shadowRoot.textContent)).length);
	check('no "unknown artist" placeholder anywhere', unknown === 0, String(unknown));
	const R = '#demo-tracks tr:nth-child(2) .ext-gramophone-player';
	await page.click(`${R} >> .play`);
	await waitPlaying(page, R, 0.5);
	const st = await page.evaluate((s) => {
		const r = document.querySelector(s).shadowRoot;
		return { label: r.querySelector('.play').getAttribute('aria-label'), cur: r.querySelector('.cur').textContent, dur: r.querySelector('.dur').textContent, meta: navigator.mediaSession.metadata && navigator.mediaSession.metadata.title };
	}, R);
	check('row plays, shows time and duration, sets Media Session title', st.label === "Pause Bubblin'" && st.dur !== '--:--' && st.meta === "Bubblin'", JSON.stringify(st));
	await (await page.$('#demo-tracks')).screenshot({ path: `${SHOTS}/tracks-playing.png` });
	await (await page.$('#demo-tracks-legacy')).screenshot({ path: `${SHOTS}/tracks-legacy.png` });
	await page.click(`${R} >> .play`);
	await close();

	// Nothing mounts by itself (idle callbacks and intersection stubbed): Tab onto a fallback link.
	const init = () => {
		window.requestIdleCallback = () => 0;
		window.IntersectionObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	};
	const lazyPage = await open(`?${Q}`, { init });
	const p = lazyPage.page;
	await p.waitForFunction(() => window.gramophoneLoaded === true);
	const T = '#demo-tracks tr:nth-child(3) .ext-gramophone-player';
	const before = await p.evaluate((s) => !!document.querySelector(s).shadowRoot, T);
	await p.focus(`${T} .ext-gramophone-fallback-link`);
	// The row's code (ext.gramophone.player) loads first.
	await p.waitForFunction((s) => !!document.querySelector(s).shadowRoot, T, { timeout: 5000 });
	await p.waitForTimeout(100);
	const focus = await p.evaluate((s) => {
		const host = document.querySelector(s);
		const a = host.shadowRoot && host.shadowRoot.activeElement;
		return { mounted: !!host.shadowRoot, active: document.activeElement === host, inner: a && a.className };
	}, T);
	check('focus on a fallback link mounts the host and keeps focus on its play button', !before && focus.mounted && focus.active && focus.inner === 'play', JSON.stringify(focus));
	await p.keyboard.press('Enter');
	await waitPlaying(p, T, 0.3);
	check('Enter on the focused row button plays', true);
	await lazyPage.close();
});

// ---------------------------------------------------------------------------
// 5i. Hostile input (#demo-hostile): markup in the title, artist and album stays text, and no
// element on the page, in light or shadow DOM, carries an event handler or a script URL.
await step('hostile text', async () => {
	const { page, close } = await open(`?${Q}`);
	await mounted(page);
	const H = '#demo-hostile .ext-gramophone-player';
	// Scrolling hides a tooltip, so the case is scrolled to first.
	await page.$eval('#demo-hostile', (el) => el.scrollIntoView({ block: 'center' }));
	await page.click(`${H} >> .play`);
	await waitPlaying(page, H);
	await page.mouse.move(5, 5);
	await page.hover('#demo-hostile .ext-gramophone-button');
	const tooltip = await page
		.waitForFunction((h) => {
			const tt = document.querySelector('.ext-gramophone-tooltip')?.shadowRoot.querySelector('.tt.show');
			return tt && tt.textContent === JSON.parse(document.querySelector(h).getAttribute('data-mw-gramophone')).tracks[0].title;
		}, H, { timeout: 5000 })
		.then(() => true, () => false);
	const text = await page.evaluate((h) => {
		const host = document.querySelector(h);
		const t = JSON.parse(host.getAttribute('data-mw-gramophone')).tracks[0];
		const r = host.shadowRoot;
		const b = document.querySelector('#demo-hostile .ext-gramophone-button');
		return {
			title: r.querySelector('.title').textContent === t.title,
			sub: r.querySelector('.sub').textContent === `${t.artist} · ${t.album}`,
			session: navigator.mediaSession.metadata.title === t.title && navigator.mediaSession.metadata.artist === t.artist,
			fallback: host.querySelector('.ext-gramophone-fallback-link').textContent === t.title,
			button: b.shadowRoot.querySelector('button').getAttribute('data-tip') === t.title,
			link: r.querySelector('.file').hidden && !r.querySelector('.file').hasAttribute('href'),
			cover: !r.querySelector('.cover img'),
		};
	}, H);
	text.tooltip = tooltip;
	check('hostile text: title, artist and album show as text (also in the tooltip), javascript: link and cover dropped', Object.values(text).every(Boolean), JSON.stringify(text));
	const unsafe = await page.evaluate(() => {
		const out = [];
		const scan = (el) => {
			for (const a of el.attributes) {
				const v = a.value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
				if (/^on/i.test(a.name)) out.push(`${el.tagName.toLowerCase()} ${a.name}`);
				else if (['href', 'src', 'poster', 'action', 'formaction', 'xlink:href'].includes(a.name) && /^(javascript|data|vbscript):/.test(v)) out.push(`${el.tagName.toLowerCase()} ${a.name}=${a.value.slice(0, 40)}`);
			}
			if (el.tagName === 'SCRIPT' || el.tagName === 'IFRAME' || el.tagName === 'OBJECT') out.push(`${el.tagName.toLowerCase()} element`);
		};
		const walk = (root) =>
			root.querySelectorAll('*').forEach((el) => {
				scan(el);
				if (el.shadowRoot) walk(el.shadowRoot);
			});
		const hosts = Array.from(document.querySelectorAll('.ext-gramophone, .ext-gramophone-tooltip'));
		hosts.forEach((h) => {
			scan(h);
			walk(h);
			if (h.shadowRoot) walk(h.shadowRoot);
		});
		return { hosts: hosts.length, unsafe: out };
	});
	check(`hostile text: no event handler or script URL in ${unsafe.hosts} hosts, light and shadow DOM`, unsafe.unsafe.length === 0, unsafe.unsafe.slice(0, 5).join('; '));
	await (await page.$('#demo-hostile')).screenshot({ path: `${SHOTS}/hostile.png` });
	await close();
});

// 5j. A 3000-character title with bidi controls (#demo-long) keeps the player within its column.
for (const width of [1280, 375]) {
	await step(`long title @${width}px`, async () => {
		const { page, close } = await open(`?${Q}`, { width, height: 812 });
		await mounted(page);
		const r = await page.evaluate(() => {
			const host = document.querySelector('#demo-long .ext-gramophone-player');
			const root = host.shadowRoot;
			const over = (el) => el.scrollWidth - el.clientWidth;
			const right = (el) => el.getBoundingClientRect().right;
			return {
				chars: JSON.parse(host.getAttribute('data-mw-gramophone')).tracks[0].title.length,
				host: Math.round(right(host) - right(host.parentElement)),
				card: over(root.querySelector('.card')),
				info: over(root.querySelector('.info')),
				title: Math.round(right(root.querySelector('.title')) - right(root.querySelector('.info'))),
				list: over(root.querySelector('.list')),
				page: over(document.documentElement),
			};
		});
		check(`3000-character bidi title: no horizontal overflow @${width}px`, r.chars === 3000 && Object.keys(r).every((k) => k === 'chars' || r[k] <= 0), JSON.stringify(r));
		await (await page.$('#demo-long')).screenshot({ path: `${SHOTS}/long-title-${width}.png` });
		await close();
	});
}

// 5k. Every control in every host has an accessible name.
await step('accessible names', async () => {
	const { page, close } = await open(`?${Q}`);
	await mounted(page);
	const r = await page.evaluate(() => {
		let controls = 0;
		const unnamed = [];
		for (const host of document.querySelectorAll('.ext-gramophone')) {
			const root = host.shadowRoot;
			root.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="link"], [role="slider"], [role^="menuitem"], [tabindex="0"]').forEach((el) => {
				controls++;
				const by = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => (root.getElementById(id) || {}).textContent || '').join(' ');
				// Buttons, links and menu items may take their name from their text, sliders and fields not.
				const content = el.matches('button, a, [role="button"], [role="link"], [role^="menuitem"]') ? el.textContent : '';
				if (!(el.getAttribute('aria-label') || by || el.getAttribute('title') || content || '').trim()) unnamed.push(`${host.closest('[id]').id}: <${el.tagName.toLowerCase()} class="${el.getAttribute('class')}">`);
			});
		}
		return { controls, unnamed };
	});
	check(`every control in the hosts has an accessible name (${r.controls} controls)`, r.controls > 0 && r.unnamed.length === 0, r.unnamed.slice(0, 5).join('; '));
	await close();
});

// ---------------------------------------------------------------------------
// 6. Narrow viewport with open panels, reduced motion.
await step('narrow panels', async () => {
	const { page, close } = await open(`?${Q}`, { width: 375, height: 812, reducedMotion: 'reduce' });
	await mounted(page);
	const A = '#demo-album .ext-gramophone';
	const L = '#demo-lyrics .ext-gramophone';
	await page.click(`${A} >> .play`);
	await waitPlaying(page, A);
	await (await page.$('#demo-album')).screenshot({ path: `${SHOTS}/narrow-375-playlist.png` });
	await page.click(`${L} >> .play`);
	await waitPlaying(page, L);
	await page.click(`${L} >> .btn[aria-label="Lyrics"]`);
	await page.waitForSelector(`${L} >> .line.active`, { timeout: 8000 });
	await page.waitForTimeout(300);
	await (await page.$('#demo-lyrics')).screenshot({ path: `${SHOTS}/narrow-375-lyrics.png` });
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	check('no horizontal page overflow at 375px', overflow <= 0, `${overflow}px`);
	await close();
});

async function clipAround(page, sel, extraBottom = 0, maxWidth = 0) {
	const b = await (await page.$(sel)).boundingBox();
	return { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8 - extraBottom), width: maxWidth || b.width + 16, height: b.height + 16 + extraBottom };
}

await browser.close();
server.close();

check('no console errors or uncaught exceptions', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
check('no request leaves the demo server', offsite.length === 0, [...new Set(offsite)].slice(0, 5).join(' | '));
check('no dialog opened on any page (hostile text never runs)', dialogs.length === 0, dialogs.slice(0, 5).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${path.relative(process.cwd(), SHOTS)}/`);
process.exit(failed.length ? 1 : 0);
