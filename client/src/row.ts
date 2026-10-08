/**
 * Slim one-row player for a single track inside a table cell, where the
 * row already shows the title and artist: play button, seek bar and time.
 * Container queries in row.css drop to one time label, then to the play
 * button with a progress ring, in narrow cells.
 */
import { applyColors } from './colors';
import type { Config } from './config';
import { Engine, type Change } from './engine';
import { CircleAlert, Pause, Play, icon, type IconNode } from './icons';
import { LoaderCircle } from './player-icons';
import { t } from './i18n';
import { Slider } from './slider';
import { adopt } from './styles';
import { bindTooltips, refreshTip } from './tooltip';
import { formatTime, h, ringOffset, svg } from './util';
import { getVolume, isMuted, setMuted, setVolume } from './volume';

const R = 17;
const C = 2 * Math.PI * R;

/** Mounts the row and returns its play button (the control to focus). */
export function mountRow(host: HTMLElement, root: ShadowRoot, cfg: Config): HTMLElement {
	adopt(root, 'row');
	applyColors(host, cfg.colors);
	return new Row(root, host, cfg).playBtn;
}

class Row {
	readonly playBtn: HTMLButtonElement;
	private readonly e: Engine;
	private readonly el: HTMLDivElement;
	private readonly seek: Slider;
	private readonly cur: HTMLSpanElement;
	private readonly dur: HTMLSpanElement;
	private readonly msg: HTMLSpanElement;
	private readonly ring: SVGCircleElement;
	private readonly live: HTMLSpanElement;
	private glyph = '';
	private spinTimer = 0;
	private curText = '';
	private ringOffset = '';

	constructor(root: ShadowRoot, host: HTMLElement, cfg: Config) {
		const e = (this.e = new Engine(host, root, cfg.tracks, cfg.loop ? 'all' : 'off'));

		const ringSvg = svg('svg', { class: 'ring', viewBox: '0 0 38 38', 'aria-hidden': 'true', focusable: 'false', part: 'ring' });
		this.ring = svg('circle', { class: 'ring-fg', cx: 19, cy: 19, r: R, 'stroke-dasharray': C.toFixed(2), 'stroke-dashoffset': C.toFixed(2), part: 'ring-range' }) as SVGCircleElement;
		ringSvg.append(svg('circle', { class: 'ring-bg', cx: 19, cy: 19, r: R, part: 'ring-track' }), this.ring);
		this.playBtn = h('button', 'play', { type: 'button', part: 'play-button button' }, [ringSvg]);

		this.cur = h('span', 'time cur', { 'aria-hidden': 'true', part: 'time current-time' }, ['0:00']);
		this.dur = h('span', 'time dur', { 'aria-hidden': 'true', part: 'time duration' }, ['--:--']);
		this.seek = new Slider({
			label: t('gramophone-seek'),
			cls: 'seek-slider',
			part: 'seek',
			step: 5,
			page: 30,
			text: (v) => formatTime(v) + ' / ' + (e.duration ? formatTime(e.duration) : '--:--'),
			hover: (v) => formatTime(v),
			input: (v) => this.setCur(v),
			commit: (v) => e.seek(v),
		});
		this.seek.setDisabled(true);
		this.msg = h('span', 'msg', { part: 'message' });
		this.live = h('span', 'sr-only', { 'aria-live': 'polite' });

		this.el = h('div', 'pill' + (cfg.colors.background ? ' custom' : ''), { part: 'row' }, [this.playBtn, this.cur, this.seek.el, this.dur, this.msg, this.live]);
		root.appendChild(this.el);
		bindTooltips(root);

		this.playBtn.addEventListener('click', () => {
			if (e.failure !== 'missing') e.toggle();
		});
		// Without a seek bar (very narrow cells) the whole pill is a tap target.
		this.el.addEventListener('click', (ev) => {
			const target = ev.target as Node;
			if (this.playBtn.contains(target) || this.seek.el.offsetWidth || e.failure === 'missing') return;
			e.toggle();
		});
		this.el.addEventListener('keydown', (ev) => this.key(ev));
		e.on((c) => this.update(c));
		this.renderState();
		this.renderTime();

		if (cfg.autoPlay) e.play();
	}

	private update(c: Change): void {
		if (c === 'time' || c === 'duration' || c === 'buffer' || c === 'track') this.renderTime();
		else if (c === 'state') this.renderState();
	}

	private key(ev: KeyboardEvent): void {
		if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.defaultPrevented) return;
		const e = this.e;
		switch (ev.key) {
			case 'k':
			case 'K':
				e.toggle();
				break;
			case 'ArrowLeft':
				e.seek(e.time - 5);
				break;
			case 'ArrowRight':
				e.seek(e.time + 5);
				break;
			case 'ArrowUp':
				setVolume(getVolume() + 0.05, false);
				break;
			case 'ArrowDown':
				setVolume(getVolume() - 0.05);
				break;
			case 'm':
			case 'M':
				setMuted(!isMuted());
				break;
			default:
				return;
		}
		ev.preventDefault();
	}

	private renderState(): void {
		const e = this.e;
		const playing = e.wantsPlay;
		const waiting = playing && e.waiting;
		const failure = e.failure;
		this.el.classList.toggle('is-playing', playing);
		this.el.classList.toggle('is-blocked', e.blocked);
		this.el.classList.toggle('is-error', !!failure);

		if (failure) {
			this.setGlyph('error', CircleAlert);
		} else if (!waiting) {
			clearTimeout(this.spinTimer);
			this.spinTimer = 0;
			this.setGlyph(playing ? 'pause' : 'play', playing ? Pause : Play);
		} else if (!this.spinTimer && this.glyph !== 'spin') {
			// Brief buffering (seeks) should not flash a spinner.
			this.setGlyph('pause', Pause);
			this.spinTimer = window.setTimeout(() => {
				this.spinTimer = 0;
				if (this.e.wantsPlay && this.e.waiting) {
					this.setGlyph('spin', LoaderCircle);
					this.renderLabel();
				}
			}, 250);
		}
		if (failure === 'missing') this.playBtn.setAttribute('aria-disabled', 'true');
		else this.playBtn.removeAttribute('aria-disabled');

		const note = failure ? t(failure === 'missing' ? 'gramophone-missing-file' : 'gramophone-load-error') : e.blocked ? t('gramophone-autoplay-blocked') : '';
		// Errors replace the seek bar, a blocked autoplay shows on the button.
		const shown = failure ? note : '';
		if (this.msg.textContent !== shown) this.msg.textContent = shown;
		if (this.live.textContent !== note) this.live.textContent = note;
		this.renderLabel(note);
		this.renderTime();
	}

	/** Accessible name and tooltip of the play button, with the track title. */
	private renderLabel(note = ''): void {
		const e = this.e;
		const title = e.track.title;
		const action = this.glyph === 'spin' ? t('gramophone-loading') : t(e.wantsPlay ? 'gramophone-pause' : 'gramophone-play');
		const text = action + ' ' + title;
		this.playBtn.setAttribute('aria-label', text);
		const tip = note ? title + '\n' + note : text;
		if (this.playBtn.getAttribute('data-tip') !== tip) {
			this.playBtn.setAttribute('data-tip', tip);
			refreshTip(this.playBtn);
		}
	}

	private setGlyph(g: string, node: IconNode): void {
		if (g === this.glyph) return;
		this.glyph = g;
		const old = this.playBtn.querySelector('.icon');
		const next = icon(node, g === 'spin' ? 'spin' : '');
		if (old) old.replaceWith(next);
		else this.playBtn.appendChild(next);
	}

	private setCur(v: number): void {
		const text = formatTime(v);
		if (text !== this.curText) {
			this.curText = text;
			this.cur.textContent = text;
		}
	}

	private renderTime(): void {
		const e = this.e;
		const d = e.duration;
		const time = e.time;
		this.seek.setDisabled(!d);
		this.seek.set(time, d || 1);
		this.seek.setBuffered(d ? e.bufferedEnd : 0);
		if (!this.seek.dragging) this.setCur(time);
		const dt = d ? formatTime(d) : '--:--';
		if (this.dur.textContent !== dt) this.dur.textContent = dt;
		const off = ringOffset(C, d ? time / d : 0);
		if (off !== this.ringOffset) {
			this.ringOffset = off;
			this.ring.setAttribute('stroke-dashoffset', off);
		}
	}
}
