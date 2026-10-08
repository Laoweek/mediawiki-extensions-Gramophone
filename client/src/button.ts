/**
 * Compact inline button for <sm2>: a small round play button with a circular
 * progress ring. Pages can hold hundreds of these, so mounting only clones a
 * template; the audio element and engine are created on first press.
 */
import { backgroundFor, isDark } from './colors';
import type { Config } from './config';
import { Engine } from './engine';
import { onMissing } from './exists';
import { CircleAlert, Pause, Play, icon } from './icons';
import { adopt } from './styles';
import { bindTooltips, refreshTip } from './tooltip';
import { t } from './i18n';
import { h, ringOffset, svg } from './util';

const R = 14.75;
const C = 2 * Math.PI * R;
let template: HTMLButtonElement | null = null;

function makeTemplate(): HTMLButtonElement {
	const b = h('button', 'b', { type: 'button', part: 'button' });
	const ring = svg('svg', { class: 'ring', viewBox: '0 0 32 32', 'aria-hidden': 'true', focusable: 'false', part: 'ring' });
	ring.append(
		svg('circle', { class: 'ring-bg', cx: 16, cy: 16, r: R, part: 'ring-track' }),
		svg('circle', { class: 'ring-fg', cx: 16, cy: 16, r: R, 'stroke-dasharray': C.toFixed(2), 'stroke-dashoffset': C.toFixed(2), part: 'ring-range' }),
	);
	// The disc is inset so the progress ring sits around it.
	b.append(h('span', 'disc', { part: 'disc' }), ring, icon(Play));
	return b;
}

type Glyph = 'play' | 'pause' | 'error';

/** Mounts the button and returns it (the control to focus). */
export function mountButton(host: HTMLElement, root: ShadowRoot, cfg: Config): HTMLElement {
	adopt(root, 'button');
	if (!template) template = makeTemplate();
	const btn = template.cloneNode(true) as HTMLButtonElement;
	const fg = btn.querySelector('.ring-fg') as SVGCircleElement;
	root.appendChild(btn);
	bindTooltips(root);

	const { tracks, colors } = cfg;
	// A custom disc colour stays while playing, with a readable glyph colour.
	// A text colour alone gets a neutral disc it reads on.
	if (colors.background || colors.foreground) {
		const disc = colors.background || backgroundFor(colors.foreground as string);
		host.style.setProperty('--gramophone-button-background', disc);
		host.style.setProperty('--gramophone-button-foreground', colors.foreground || (isDark(disc) ? '#ffffff' : '#18181b'));
		btn.classList.add('custom');
	}
	if (colors.track) host.style.setProperty('--gramophone-range', colors.track);

	let count: HTMLSpanElement | null = null;
	if (tracks.length > 1) {
		count = h('span', 'count', { 'aria-hidden': 'true', part: 'count' }, [String(tracks.length)]);
		root.appendChild(count);
	}

	let engine: Engine | null = null;
	let glyph: Glyph = 'play';
	let spinTimer = 0;
	let lastOffset = '';
	// A function: hidemissing marks files missing when their check answers (exists.ts).
	const first = () => Math.max(0, tracks.findIndex((tr) => !tr.missing));
	// The engine shows the state from the first press on.
	host.setAttribute('data-gramophone-state', tracks[first()].missing ? 'error' : 'idle');

	const setGlyph = (g: Glyph) => {
		if (g === glyph) return;
		glyph = g;
		const node = g === 'error' ? CircleAlert : g === 'pause' ? Pause : Play;
		(btn.querySelector('.icon') as Element).replaceWith(icon(node));
	};

	const setProgress = (p: number) => {
		const off = ringOffset(C, p);
		if (off !== lastOffset) {
			lastOffset = off;
			fg.setAttribute('stroke-dashoffset', off);
		}
	};

	const render = () => {
		const e = engine;
		const index = e ? e.index : first();
		const tr = tracks[index];
		const playing = !!e && e.wantsPlay;
		const failure = e ? e.failure : tr.missing ? 'missing' : '';
		setGlyph(failure ? 'error' : playing ? 'pause' : 'play');
		btn.classList.toggle('playing', playing);
		btn.classList.toggle('error', !!failure);
		btn.classList.toggle('active', !!e && (playing || e.time > 0));
		if (failure === 'missing') btn.setAttribute('aria-disabled', 'true');
		else btn.removeAttribute('aria-disabled');

		const waiting = !!e && e.waiting && playing;
		if (!waiting) {
			clearTimeout(spinTimer);
			spinTimer = 0;
			btn.classList.remove('loading');
		} else if (!spinTimer && !btn.classList.contains('loading')) {
			// Only show the spinner for loads that take noticeable time.
			spinTimer = window.setTimeout(() => {
				spinTimer = 0;
				if (engine && engine.waiting && engine.wantsPlay) btn.classList.add('loading');
			}, 200);
		}

		let tip = tr.title;
		if (tracks.length > 1) tip += ' (' + t('gramophone-track-of', index + 1, tracks.length) + ')';
		if (failure) tip += '\n' + t(failure === 'missing' ? 'gramophone-missing-file' : 'gramophone-load-error');
		const action = t(playing ? 'gramophone-pause' : 'gramophone-play');
		btn.setAttribute('aria-label', action + ' ' + tr.title);
		if (btn.getAttribute('data-tip') !== tip) {
			btn.setAttribute('data-tip', tip);
			refreshTip(btn);
		}
		if (count) count.textContent = String(e && (playing || e.time > 0 || index !== first()) ? index + 1 : tracks.length);
		progress();
	};

	const progress = () => {
		const d = engine ? engine.duration : 0;
		setProgress(d ? Math.min(1, engine!.time / d) : 0);
	};

	btn.addEventListener('click', () => {
		if (!engine) {
			if (tracks[first()].missing) return;
			engine = new Engine(host, root, tracks, 'off');
			engine.on((c) => {
				if (c === 'time') progress();
				else if (c !== 'volume') render();
			});
		}
		if (engine.failure === 'missing') return;
		engine.toggle();
	});

	render();
	// hidemissing: a file can turn out missing after the button was built (exists.ts).
	onMissing(host, render);
	return btn;
}
