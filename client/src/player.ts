/**
 * Full player for <flashmp3> and <modernsoundmanager>: cover, title line,
 * transport, seek bar, repeat, speed, volume, playlist drawer and synced
 * lyrics panel.
 */
import { applyColors } from './colors';
import type { Config, Track } from './config';
import { Engine, type Change, type Repeat } from './engine';
import { CircleAlert, Pause, Play, icon, type IconNode } from './icons';
import {
	Check,
	Download,
	ExternalLink,
	ListMusic,
	LoaderCircle,
	MicVocal,
	Music,
	Repeat as RepeatIcon,
	Repeat1,
	SkipBack,
	SkipForward,
	Volume,
	Volume1,
	Volume2,
	VolumeX,
} from './player-icons';
import { t } from './i18n';
import { activeLine, loadLyrics, type Lyrics } from './lyrics';
import { Popover } from './popover';
import { Slider } from './slider';
import { adopt } from './styles';
import { bindTooltips, refreshTip } from './tooltip';
import { formatTime, h, label, partState, reducedMotion, setPressed } from './util';
import { getVolume, isMuted, setMuted, setVolume, volumeSettable } from './volume';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const REPEAT_ORDER: Repeat[] = ['off', 'all', 'one'];

function speedText(r: number): string {
	return r + '×';
}

function iconButton(cls: string, part: string, node: IconNode, text: string): HTMLButtonElement {
	const b = h('button', 'btn ' + cls, { type: 'button', part: part + ' button' }, [icon(node)]);
	label(b, text);
	return b;
}

function iconLink(cls: string, part: string, node: IconNode, text: string): HTMLAnchorElement {
	const a = h('a', 'btn ' + cls, { rel: 'noopener', part: part + ' button' }, [icon(node)]);
	label(a, text);
	return a;
}

/** Points the link at href, or hides it. A nofollow track adds rel="nofollow" for other sites. */
function setLink(a: HTMLAnchorElement, href: string, nofollow: boolean): void {
	a.hidden = !href;
	if (!href) {
		a.removeAttribute('href');
		return;
	}
	a.href = href;
	let offsite = false;
	try {
		offsite = new URL(href, location.href).origin !== location.origin;
	} catch (e) {
		// safeUrl() only lets valid URLs through.
	}
	a.rel = nofollow && offsite ? 'noopener nofollow' : 'noopener';
}

function setIcon(el: Element, node: IconNode, cls?: string): void {
	const old = el.querySelector('.icon');
	const next = icon(node, cls);
	if (old) old.replaceWith(next);
	else el.prepend(next);
}

/** Mounts the full player and returns its play button (the control to focus). */
export function mountPlayer(host: HTMLElement, root: ShadowRoot, cfg: Config): HTMLElement {
	adopt(root, 'player');
	applyColors(host, cfg.colors);
	return new Player(host, root, cfg).playBtn;
}

class Player {
	private readonly e: Engine;
	private readonly card: HTMLDivElement;
	private readonly cover: HTMLDivElement;
	private readonly title: HTMLSpanElement;
	private readonly badge: HTMLSpanElement;
	private readonly sub: HTMLDivElement;
	readonly playBtn: HTMLButtonElement;
	private readonly prevBtn: HTMLButtonElement;
	private readonly nextBtn: HTMLButtonElement;
	private readonly repeatBtn: HTMLButtonElement;
	private readonly speedBtn: HTMLButtonElement;
	private readonly volBtn: HTMLButtonElement;
	private readonly lyricsBtn: HTMLButtonElement;
	private readonly listBtn: HTMLButtonElement;
	private readonly dlLink: HTMLAnchorElement;
	private readonly fileLink: HTMLAnchorElement;
	private readonly seek: Slider;
	private readonly cur: HTMLSpanElement;
	private readonly dur: HTMLSpanElement;
	private readonly live: HTMLDivElement;
	private readonly drawer: HTMLDivElement;
	private readonly list: HTMLOListElement | null = null;
	private readonly lyricsPanel: HTMLDivElement;
	private readonly lyricsBody: HTMLDivElement;
	private readonly lyricsWrap: HTMLDivElement;
	private volSlider: Slider | null = null;
	private volPct: HTMLSpanElement | null = null;
	private muteBtn: HTMLButtonElement | null = null;
	private speedMenu: HTMLDivElement | null = null;
	private readonly pops: Popover[] = [];

	private playGlyph = '';
	private spinTimer = 0;
	private shownCover = '\0';
	private lyrics: Lyrics | null = null;
	private lyricsFor = '';
	private lyricsAbort: AbortController | null = null;
	private lyricLine = -1;
	private userScrollUntil = 0;
	private curText = '';
	private scrollQueued = false;

	constructor(host: HTMLElement, root: ShadowRoot, cfg: Config) {
		const e = (this.e = new Engine(host, root, cfg.tracks, cfg.loop ? 'all' : 'off'));
		const multi = e.multi;

		// Cover art or a gradient placeholder.
		this.cover = h('div', 'cover', { 'aria-hidden': 'true', part: 'cover' });

		// Title, explicit badge and the artist / status line.
		this.title = h('span', 'title', { part: 'title' });
		this.badge = h('span', 'badge', { role: 'img', 'aria-label': t('gramophone-explicit'), 'data-tip': t('gramophone-explicit'), part: 'badge' }, ['E']);
		this.sub = h('div', 'sub', { part: 'subtitle' });
		const info = h('div', 'info', {}, [h('div', 'title-row', {}, [this.title, this.badge]), this.sub]);

		this.dlLink = iconLink('subtle dl', 'download-button', Download, t('gramophone-download'));
		this.dlLink.setAttribute('download', '');
		this.dlLink.setAttribute('target', '_blank');
		this.fileLink = iconLink('subtle file', 'file-page-button', ExternalLink, t('gramophone-open-file-page'));
		this.lyricsBtn = iconButton('subtle', 'lyrics-button', MicVocal, t('gramophone-lyrics'));
		this.lyricsBtn.setAttribute('aria-pressed', 'false');
		this.listBtn = iconButton('subtle', 'playlist-button', ListMusic, t('gramophone-playlist'));
		this.listBtn.setAttribute('aria-pressed', String(cfg.playlistOpen && multi));
		this.listBtn.hidden = !multi;
		const actions = h('div', 'actions', { part: 'actions' }, [this.dlLink, this.fileLink, this.lyricsBtn, this.listBtn]);
		const meta = h('div', 'meta', {}, [info, actions]);

		// Transport.
		this.prevBtn = iconButton('prev', 'previous-button', SkipBack, t('gramophone-previous'));
		this.playBtn = iconButton('play', 'play-button', Play, t('gramophone-play'));
		this.nextBtn = iconButton('next', 'next-button', SkipForward, t('gramophone-next'));
		this.prevBtn.hidden = this.nextBtn.hidden = !multi;
		const transport = h('div', 'transport', { part: 'transport' }, [this.prevBtn, this.playBtn, this.nextBtn]);

		// Seek bar.
		this.cur = h('span', 'time cur', { 'aria-hidden': 'true', part: 'time current-time' }, ['0:00']);
		this.dur = h('span', 'time dur', { 'aria-hidden': 'true', part: 'time duration' }, ['--:--']);
		this.seek = new Slider({
			label: t('gramophone-seek'),
			cls: 'seek-slider',
			part: 'seek',
			step: 5,
			page: 30,
			text: (v) => formatTime(v) + ' / ' + (this.e.duration ? formatTime(this.e.duration) : '--:--'),
			hover: (v) => formatTime(v),
			input: (v) => this.setCur(v),
			commit: (v) => this.e.seek(v),
		});
		this.seek.setDisabled(true);
		const seek = h('div', 'seek', {}, [this.cur, this.seek.el, this.dur]);

		// Repeat, speed and volume.
		this.repeatBtn = iconButton('subtle repeat', 'repeat-button', RepeatIcon, '');
		this.speedBtn = h('button', 'btn subtle speed', { type: 'button', part: 'speed-button button' }, [speedText(1)]);
		this.volBtn = iconButton('subtle vol', 'volume-button', Volume2, t('gramophone-volume'));
		const loop = h('div', 'loop', {}, [this.repeatBtn]);
		const opts = h('div', 'opts', {}, [this.speedBtn, this.volBtn]);
		const ctrl = h('div', 'ctrl', { part: 'controls' }, [transport, seek, loop, opts]);

		const bar = h('div', 'bar', { part: 'bar' }, [this.cover, meta, ctrl]);

		// Playlist drawer and lyrics panel.
		this.drawer = h('div', 'drawer');
		if (multi) {
			this.list = h('ol', 'list', { 'aria-label': t('gramophone-playlist'), part: 'playlist' });
			cfg.tracks.forEach((tr, i) => this.list!.appendChild(this.row(tr, i)));
			this.drawer.appendChild(h('div', 'drawer-inner', {}, [this.list]));
			this.listBtn.setAttribute('aria-controls', 'gramophone-list');
			this.list.id = 'gramophone-list';
		}
		this.lyricsBody = h('div', 'lyrics-body');
		this.lyricsPanel = h('div', 'lyrics', { id: 'gramophone-lyrics', role: 'region', 'aria-label': t('gramophone-lyrics'), tabindex: '0', part: 'lyrics' }, [this.lyricsBody]);
		this.lyricsBtn.setAttribute('aria-controls', 'gramophone-lyrics');
		// The wrapper carries the separator, the scroller fades its edges.
		this.lyricsWrap = h('div', 'lyrics-wrap', { part: 'lyrics-panel' }, [this.lyricsPanel]);
		this.lyricsWrap.hidden = true;

		this.live = h('div', 'sr-only', { 'aria-live': 'polite', 'aria-atomic': 'true' });
		this.card = h('div', 'card', { tabindex: '-1', part: 'card' }, [bar, this.drawer, this.lyricsWrap, this.live]);
		root.appendChild(this.card);

		this.setupPopovers(opts);
		this.bind();
		bindTooltips(root);
		this.setDrawer(cfg.playlistOpen);

		e.on((c) => this.update(c));
		this.renderTrack();
		this.renderState();
		this.renderRepeat();
		this.renderVolume();

		if (cfg.autoPlay) e.play();
	}

	// ---- Building blocks -------------------------------------------------

	private row(tr: Track, i: number): HTMLLIElement {
		const b = h('button', 'row', { type: 'button', 'data-index': String(i), part: 'playlist-item' });
		const idx = h('span', 'row-idx', { 'aria-hidden': 'true', part: 'playlist-number' }, [String(i + 1)]);
		const eq = h('span', 'eq', { 'aria-hidden': 'true', part: 'playlist-equalizer' }, [h('i'), h('i'), h('i')]);
		const title = h('span', 'row-title', { part: 'playlist-title' }, [tr.title]);
		b.append(h('span', 'row-lead', {}, [idx, eq]), title);
		if (tr.explicit) b.appendChild(h('span', 'badge', { role: 'img', 'aria-label': t('gramophone-explicit'), part: 'badge' }, ['E']));
		if (tr.artist) b.appendChild(h('span', 'row-artist', { part: 'playlist-artist' }, [tr.artist]));
		if (tr.missing) {
			b.setAttribute('aria-disabled', 'true');
			b.setAttribute('data-tip', t('gramophone-missing-file'));
			partState(b, 'missing', true);
			b.appendChild(icon(CircleAlert, 'row-warn', 'playlist-warning'));
		}
		return h('li', '', {}, [b]);
	}

	private setupPopovers(wrap: HTMLElement): void {
		// Speed menu.
		const menu = h('div', 'menu', { role: 'menu', 'aria-label': t('gramophone-speed') });
		for (const r of SPEEDS) {
			const item = h('button', 'menu-item', { type: 'button', role: 'menuitemradio', 'data-rate': String(r), part: 'speed-option' }, [
				icon(Check, 'check'),
				speedText(r),
			]);
			menu.appendChild(item);
		}
		this.speedMenu = menu;
		const speedPop = new Popover(this.speedBtn, wrap, 'speed-pop', 'speed-popover', (open) => {
			// An open popover listens on the window: release it if the player leaves the page.
			this.e.hold(open);
			if (open) {
				const checked = menu.querySelector('[aria-checked="true"]') as HTMLElement | null;
				(checked || (menu.firstElementChild as HTMLElement)).focus();
			}
		});
		speedPop.el.appendChild(menu);
		this.pops.push(speedPop);
		menu.addEventListener('click', (ev) => {
			const item = (ev.target as Element).closest('[data-rate]');
			if (!item) return;
			this.e.setRate(parseFloat(item.getAttribute('data-rate') || '1'));
			speedPop.hide();
			this.speedBtn.focus();
		});
		menu.addEventListener('keydown', (ev) => {
			const items = Array.from(menu.querySelectorAll<HTMLElement>('.menu-item'));
			const i = items.indexOf(ev.target as HTMLElement);
			let next = -1;
			if (ev.key === 'ArrowDown') next = (i + 1) % items.length;
			else if (ev.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
			else if (ev.key === 'Home') next = 0;
			else if (ev.key === 'End') next = items.length - 1;
			else if (ev.key === 'Tab') speedPop.hide();
			if (next >= 0) {
				ev.preventDefault();
				items[next].focus();
			}
			// Escape goes on to the popover, which closes itself.
			if (ev.key !== 'Escape') ev.stopPropagation();
		});
		this.renderRate();

		// Volume. Where volume cannot be set (iOS), the button only toggles mute.
		if (!volumeSettable()) {
			this.volBtn.addEventListener('click', () => setMuted(!isMuted()));
			return;
		}
		this.muteBtn = iconButton('mute', 'mute-button', Volume2, t('gramophone-mute'));
		this.volSlider = new Slider({
			label: t('gramophone-volume'),
			cls: 'vol-slider',
			part: 'volume',
			step: 0.05,
			page: 0.2,
			text: (v) => Math.round(v * 100) + '%',
			input: (v) => setVolume(v, false),
		});
		this.volPct = h('span', 'vol-pct', { 'aria-hidden': 'true', part: 'volume-percent' });
		const volPop = new Popover(this.volBtn, wrap, 'vol-pop', 'volume-popover', (open) => {
			this.e.hold(open);
			if (open) this.volSlider!.el.focus();
		});
		volPop.el.appendChild(h('div', 'vol-row', {}, [this.muteBtn, this.volSlider.el, this.volPct]));
		this.pops.push(volPop);
		this.muteBtn.addEventListener('click', () => setMuted(!isMuted()));
	}

	private bind(): void {
		const e = this.e;
		this.playBtn.addEventListener('click', () => e.toggle());
		this.prevBtn.addEventListener('click', () => e.prev());
		this.nextBtn.addEventListener('click', () => e.next());
		this.repeatBtn.addEventListener('click', () => {
			e.setRepeat(REPEAT_ORDER[(REPEAT_ORDER.indexOf(e.repeat) + 1) % REPEAT_ORDER.length]);
		});
		this.listBtn.addEventListener('click', () => this.setDrawer(!this.drawer.classList.contains('open')));
		this.lyricsBtn.addEventListener('click', () => this.setLyrics(!!this.lyricsWrap.hidden));

		if (this.list) {
			const list = this.list;
			list.addEventListener('click', (ev) => {
				const row = (ev.target as Element).closest('.row');
				if (!row || row.getAttribute('aria-disabled') === 'true') return;
				const i = Number(row.getAttribute('data-index'));
				if (i === e.index) e.toggle();
				else e.select(i, true);
			});
			list.addEventListener('keydown', (ev) => {
				const rows = Array.from(list.querySelectorAll<HTMLElement>('.row'));
				const i = rows.indexOf(ev.target as HTMLElement);
				let next = -1;
				if (ev.key === 'ArrowDown') next = Math.min(rows.length - 1, i + 1);
				else if (ev.key === 'ArrowUp') next = Math.max(0, i - 1);
				else if (ev.key === 'Home') next = 0;
				else if (ev.key === 'End') next = rows.length - 1;
				if (next >= 0) {
					ev.preventDefault();
					ev.stopPropagation();
					rows[next].focus();
				}
			});
		}

		this.lyricsBody.addEventListener('click', (ev) => {
			const line = (ev.target as Element).closest('[data-time]');
			if (!line || !this.lyrics || !this.lyrics.synced) return;
			e.seek(Number(line.getAttribute('data-time')) + this.e.track.lyricsOffset / 1000);
			if (!e.wantsPlay) e.play();
		});
		const userScroll = () => {
			this.userScrollUntil = Date.now() + 3000;
		};
		this.lyricsPanel.addEventListener('wheel', userScroll, { passive: true });
		this.lyricsPanel.addEventListener('touchmove', userScroll, { passive: true });
		this.lyricsPanel.addEventListener('keydown', (ev) => {
			if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown' || ev.key === 'PageUp' || ev.key === 'PageDown') {
				userScroll();
				ev.stopPropagation();
			}
		});

		this.card.addEventListener('keydown', (ev) => this.key(ev));
	}

	private key(ev: KeyboardEvent): void {
		if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.defaultPrevented) return;
		const target = ev.composedPath()[0] as HTMLElement;
		const tag = target && target.tagName;
		const onControl = tag === 'BUTTON' || tag === 'A';
		const e = this.e;
		switch (ev.key) {
			case ' ':
				if (onControl) return;
				e.toggle();
				break;
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

	// ---- Rendering ---------------------------------------------------------

	private update(c: Change): void {
		switch (c) {
			case 'time':
				this.renderTime();
				break;
			case 'duration':
			case 'buffer':
				this.renderTime();
				break;
			case 'state':
				this.renderState();
				break;
			case 'track':
				this.renderTrack();
				this.announce();
				break;
			case 'rate':
				this.renderRate();
				break;
			case 'repeat':
				this.renderRepeat();
				break;
			case 'volume':
				this.renderVolume();
				break;
			case 'destroy':
				// The host left the page.
				this.pops.forEach((p) => p.dispose());
				if (this.lyricsAbort) this.lyricsAbort.abort();
				break;
		}
	}

	private announce(): void {
		const title = this.e.track.title;
		let text = t('gramophone-now-playing', title);
		if (text.indexOf(title) < 0) text += ' ' + title;
		this.live.textContent = text;
	}

	private renderTrack(): void {
		const e = this.e;
		const tr = e.track;
		this.title.textContent = tr.title;
		this.title.title = tr.title;
		this.badge.hidden = !tr.explicit;
		this.renderCover(tr);

		setLink(this.dlLink, tr.src, tr.nofollow);
		setLink(this.fileLink, tr.link, tr.nofollow);

		this.lyricsBtn.hidden = !tr.lyrics;
		if (!tr.lyrics && !this.lyricsWrap.hidden) this.setLyrics(false);
		else if (!this.lyricsWrap.hidden) this.showLyrics();

		if (this.list) {
			this.list.querySelectorAll('.row').forEach((row, i) => {
				partState(row, 'current', i === e.index);
				if (i === e.index) row.setAttribute('aria-current', 'true');
				else row.removeAttribute('aria-current');
			});
			if (this.drawer.classList.contains('open')) this.queueScroll();
		}
		this.curText = '';
		this.renderSub();
		this.renderTime();
	}

	/**
	 * Scrolls the open playlist to the current row in the next frame callback: measuring the rows
	 * here would force a layout while the player is still being built.
	 */
	private queueScroll(): void {
		if (this.scrollQueued) return;
		this.scrollQueued = true;
		requestAnimationFrame(() => {
			this.scrollQueued = false;
			const list = this.list;
			const r = list && (list.querySelector('[aria-current="true"]') as HTMLElement | null);
			if (!list || !r || !this.drawer.classList.contains('open')) return;
			if (r.offsetTop < list.scrollTop || r.offsetTop + r.offsetHeight > list.scrollTop + list.clientHeight) {
				list.scrollTop = r.offsetTop - list.clientHeight / 2 + r.offsetHeight / 2;
			}
		});
	}

	private renderCover(tr: Track): void {
		if (tr.cover === this.shownCover) return;
		this.shownCover = tr.cover;
		this.cover.textContent = '';
		this.cover.classList.remove('has-img');
		this.cover.appendChild(icon(Music, 'cover-icon', 'cover-icon'));
		if (tr.cover) {
			const img = h('img', '', { alt: '', decoding: 'async', loading: 'lazy', part: 'cover-image' });
			img.addEventListener('load', () => this.cover.classList.add('has-img'));
			img.addEventListener('error', () => img.remove());
			img.src = tr.cover;
			this.cover.appendChild(img);
		}
	}

	private renderSub(): void {
		const e = this.e;
		const tr = e.track;
		const sub = this.sub;
		sub.textContent = '';
		sub.className = 'sub';
		if (e.failure) {
			sub.classList.add('is-error');
			sub.append(icon(CircleAlert), t(e.failure === 'missing' ? 'gramophone-missing-file' : 'gramophone-load-error'));
		} else if (e.blocked) {
			sub.classList.add('is-blocked');
			sub.textContent = t('gramophone-autoplay-blocked');
		} else {
			if (tr.artist) sub.appendChild(h('span', '', { part: 'artist' }, [tr.artist]));
			if (tr.artist && tr.album) sub.append(' · ');
			if (tr.album) sub.appendChild(h('span', '', { part: 'album' }, [tr.album]));
		}
		// Without artist and album the title stands alone, centred.
		sub.hidden = !sub.textContent;
		sub.title = sub.textContent || '';
	}

	private renderState(): void {
		const e = this.e;
		const playing = e.wantsPlay;
		const waiting = playing && e.waiting;
		this.card.classList.toggle('is-playing', playing);
		this.card.classList.toggle('is-blocked', e.blocked);
		this.card.classList.toggle('is-error', !!e.failure);

		if (!waiting) {
			clearTimeout(this.spinTimer);
			this.spinTimer = 0;
			this.setPlayGlyph(playing ? 'pause' : 'play');
		} else if (!this.spinTimer && this.playGlyph !== 'spin') {
			// Brief buffering (seeks, track switches) should not flash a spinner.
			this.setPlayGlyph('pause');
			this.spinTimer = window.setTimeout(() => {
				this.spinTimer = 0;
				if (this.e.wantsPlay && this.e.waiting) this.setPlayGlyph('spin');
			}, 250);
		}
		const missing = e.failure === 'missing';
		if (missing) this.playBtn.setAttribute('aria-disabled', 'true');
		else this.playBtn.removeAttribute('aria-disabled');
		label(this.playBtn, waiting && this.playGlyph === 'spin' ? t('gramophone-loading') : t(playing ? 'gramophone-pause' : 'gramophone-play'));
		refreshTip(this.playBtn);

		if (this.list) {
			this.list.classList.toggle('is-playing', playing && !waiting);
		}
		this.renderSub();
		this.renderTime();
	}

	private setPlayGlyph(g: 'play' | 'pause' | 'spin'): void {
		if (g === this.playGlyph) return;
		this.playGlyph = g;
		setIcon(this.playBtn, g === 'spin' ? LoaderCircle : g === 'pause' ? Pause : Play, g === 'spin' ? 'spin' : '');
		if (g === 'spin') label(this.playBtn, t('gramophone-loading'));
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
		this.syncLyrics(time);
	}

	private renderRepeat(): void {
		const r = this.e.repeat;
		setIcon(this.repeatBtn, r === 'one' ? Repeat1 : RepeatIcon);
		setPressed(this.repeatBtn, r !== 'off');
		label(this.repeatBtn, t(r === 'one' ? 'gramophone-repeat-one' : r === 'all' ? 'gramophone-repeat-all' : 'gramophone-repeat-off'));
		refreshTip(this.repeatBtn);
	}

	private renderRate(): void {
		const r = this.e.rate;
		this.speedBtn.textContent = speedText(r);
		this.speedBtn.classList.toggle('is-changed', r !== 1);
		label(this.speedBtn, t('gramophone-speed') + ' ' + speedText(r));
		if (this.speedMenu) {
			this.speedMenu.querySelectorAll('[data-rate]').forEach((item) => {
				const checked = Number(item.getAttribute('data-rate')) === r;
				item.setAttribute('aria-checked', String(checked));
				partState(item, 'checked', checked);
			});
		}
	}

	private renderVolume(): void {
		const v = getVolume();
		const muted = isMuted() || v === 0;
		const node = muted ? VolumeX : v < 0.34 ? Volume : v < 0.67 ? Volume1 : Volume2;
		setIcon(this.volBtn, node);
		if (!this.volSlider) {
			label(this.volBtn, t(isMuted() ? 'gramophone-unmute' : 'gramophone-mute'));
			setPressed(this.volBtn, isMuted());
			return;
		}
		this.volBtn.classList.toggle('is-muted', muted);
		label(this.volBtn, t('gramophone-volume') + ' ' + (muted ? '0' : Math.round(v * 100)) + '%');
		this.volSlider.set(muted ? 0 : v, 1);
		if (this.volPct) this.volPct.textContent = (muted ? 0 : Math.round(v * 100)) + '%';
		if (this.muteBtn) {
			setIcon(this.muteBtn, muted ? VolumeX : node);
			label(this.muteBtn, t(isMuted() ? 'gramophone-unmute' : 'gramophone-mute'));
			setPressed(this.muteBtn, isMuted());
		}
	}

	// ---- Panels ------------------------------------------------------------

	private setDrawer(open: boolean): void {
		if (!this.list) return;
		if (open && !this.lyricsWrap.hidden) this.setLyrics(false);
		this.drawer.classList.toggle('open', open);
		setPressed(this.listBtn, open);
		const inner = this.drawer.firstElementChild as HTMLElement & { inert: boolean };
		inner.inert = !open;
		if (open) this.renderTrack();
	}

	private setLyrics(open: boolean): void {
		if (open && this.drawer.classList.contains('open')) this.setDrawer(false);
		this.lyricsWrap.hidden = !open;
		setPressed(this.lyricsBtn, open);
		if (open) {
			this.showLyrics();
			// The position may have changed while the panel was closed.
			if (this.lyrics) this.syncLyrics(this.e.time, true);
		} else if (this.lyricsAbort) this.lyricsAbort.abort();
	}

	private lyricsStatus(node: IconNode, text: string, cls: string): void {
		this.lyricsBody.textContent = '';
		const part = 'lyrics-status' + (cls === 'is-error' ? ' error' : '');
		this.lyricsBody.appendChild(h('div', 'lyrics-status ' + cls, { part }, [icon(node, cls === 'is-loading' ? 'spin' : ''), text]));
	}

	private showLyrics(): void {
		const url = this.e.track.lyrics;
		if (!url || (url === this.lyricsFor && this.lyrics)) return;
		if (this.lyricsAbort) this.lyricsAbort.abort();
		const ctrl = (this.lyricsAbort = new AbortController());
		this.lyrics = null;
		this.lyricsFor = url;
		this.lyricLine = -1;
		this.lyricsStatus(LoaderCircle, t('gramophone-lyrics-loading'), 'is-loading');
		// The download is aborted if the player leaves the page meanwhile.
		this.e.hold(true);
		const release = () => this.e.hold(false);
		loadLyrics(url, ctrl.signal)
			.then(
				(ly) => {
					if (ctrl.signal.aborted || this.lyricsFor !== url) return;
					this.lyrics = ly;
					this.renderLyrics(ly);
				},
				(err) => {
					if (ctrl.signal.aborted || this.lyricsFor !== url) return;
					this.lyricsFor = '';
					this.lyricsStatus(CircleAlert, t('gramophone-lyrics-error'), 'is-error');
					if (err && err.name !== 'AbortError') console.warn('gramophone lyrics:', url, err);
				},
			)
			.then(release, (err) => {
				release();
				throw err;
			});
	}

	private renderLyrics(ly: Lyrics): void {
		const body = this.lyricsBody;
		body.textContent = '';
		const ol = h('ol', 'lines' + (ly.synced ? ' synced' : ''));
		for (const l of ly.lines) {
			const li = h('li', 'line' + (l.text ? '' : ' gap'), { part: 'lyrics-line' }, [l.text || '♪']);
			if (l.translations) for (const tr of l.translations) li.appendChild(h('div', 'translation', { part: 'lyrics-translation' }, [tr]));
			if (ly.synced) li.setAttribute('data-time', String(l.time));
			ol.appendChild(li);
		}
		body.appendChild(ol);
		this.lyricLine = -1;
		this.syncLyrics(this.e.time, true);
	}

	private syncLyrics(time: number, jump = false): void {
		const ly = this.lyrics;
		if (!ly || !ly.synced || this.lyricsWrap.hidden) return;
		const i = activeLine(ly.lines, time - this.e.track.lyricsOffset / 1000);
		if (i === this.lyricLine && !jump) return;
		const lines = this.lyricsBody.querySelectorAll('.line');
		if (this.lyricLine >= 0 && lines[this.lyricLine]) {
			lines[this.lyricLine].classList.remove('active');
			partState(lines[this.lyricLine], 'active', false);
		}
		this.lyricLine = i;
		const el = lines[i] as HTMLElement | undefined;
		if (el) {
			el.classList.add('active');
			partState(el, 'active', true);
		}
		if (Date.now() < this.userScrollUntil) return;
		const panel = this.lyricsPanel;
		const target = el ? el.offsetTop - panel.clientHeight / 2 + el.offsetHeight / 2 : 0;
		try {
			panel.scrollTo({ top: target, behavior: jump || reducedMotion() ? 'auto' : 'smooth' });
		} catch (e) {
			panel.scrollTop = target;
		}
	}
}
