/**
 * Playback engine shared by the full player and the compact button.
 *
 * It owns one lazily created <audio> element (preload="none", never
 * crossOrigin, never routed through Web Audio), the track list, repeat mode,
 * Media Session integration and the page-wide "one player at a time" policy,
 * and shows its state on the host (data-gramophone-state).
 * The <audio> element lives inside the host's shadow root, so the browser
 * pauses it when the host leaves the document. A document observer, which
 * runs only while some engine has an <audio> element or is held (an open
 * popover, a lyrics download), then releases the engine (Media Session, volume
 * subscription, open popovers, downloads), whether it was playing or not.
 * Other engines are released by prune() and claim().
 *
 * While playing, the engine reports the time every animation frame, but only
 * while its host is on screen. Off screen, timeupdate events (about 4 a
 * second) take over.
 */
import type { Track } from './config';
import { applyVolume, onVolume } from './volume';
import { clamp } from './util';

export type Repeat = 'off' | 'all' | 'one';
export type Change = 'state' | 'time' | 'track' | 'duration' | 'buffer' | 'rate' | 'repeat' | 'volume' | 'destroy';
export type Failure = '' | 'missing' | 'load';
export type State = 'idle' | 'loading' | 'playing' | 'paused' | 'blocked' | 'error';

/** The state that the host shows in its data-gramophone-state attribute, for site CSS. */
export function playState(e: { failure: Failure; wantsPlay: boolean; waiting: boolean; blocked: boolean; time: number }): State {
	if (e.failure) return 'error';
	if (e.wantsPlay) return e.waiting ? 'loading' : 'playing';
	if (e.blocked) return 'blocked';
	return e.time > 0 ? 'paused' : 'idle';
}

/** Engines whose host is on the page. */
const engines = new Set<Engine>();
/** Engines with an <audio> element or a hold: the document observer runs while there are any. */
const watched = new Set<Engine>();
let sessionOwner: Engine | null = null;
let foreignListener = false;
let observer: MutationObserver | null = null;
let screen: IntersectionObserver | null = null;
const screenWatchers = new Map<Element, (visible: boolean) => void>();

const ACTIONS: MediaSessionAction[] = ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'];

function setAction(ms: MediaSession, action: MediaSessionAction, fn: MediaSessionActionHandler | null): void {
	try {
		ms.setActionHandler(action, fn);
	} catch (e) {
		// Action unsupported by this browser.
	}
}

/** Releases the engines whose host left the document (live preview, VisualEditor, scripts). */
export function prune(): void {
	for (const x of engines) if (!x.host.isConnected) x.destroy();
}

/** Watches the document for removed hosts while some engine needs it. */
function watchDocument(e: Engine, on: boolean): void {
	if (on) watched.add(e);
	else watched.delete(e);
	if (watched.size && !observer && typeof MutationObserver !== 'undefined') {
		observer = new MutationObserver((records) => {
			if (records.some((r) => r.removedNodes.length)) prune();
		});
		observer.observe(document, { childList: true, subtree: true });
	} else if (!watched.size && observer) {
		observer.disconnect();
		observer = null;
	}
}

/** Calls fn whenever el comes on screen or leaves it, until unwatchScreen(el). */
function watchScreen(el: Element, fn: (visible: boolean) => void): void {
	if (typeof IntersectionObserver === 'undefined') return;
	if (!screen) {
		screen = new IntersectionObserver((entries) => {
			for (const en of entries) {
				const cb = screenWatchers.get(en.target);
				if (cb) cb(en.isIntersecting);
			}
		});
	}
	screenWatchers.set(el, fn);
	screen.observe(el);
}

function unwatchScreen(el: Element): void {
	if (screen && screenWatchers.delete(el)) screen.unobserve(el);
}

/** Pauses every other player, and plain audible <audio> elements of the page. */
function claim(owner: Engine): void {
	for (const e of engines) {
		if (e === owner) continue;
		if (!e.host.isConnected) {
			e.destroy();
			continue;
		}
		e.pause();
	}
	try {
		document.querySelectorAll('audio').forEach((a) => {
			if (!a.paused && !a.muted) a.pause();
		});
	} catch (e) {
		// Ignore media we are not allowed to control.
	}
	if (!foreignListener) {
		foreignListener = true;
		// Audible media starting in the light DOM (other widgets) pauses ours. Events
		// from our own shadow roots do not reach the document: "play" is not composed.
		document.addEventListener(
			'play',
			(ev) => {
				const m = ev.target;
				if (m instanceof HTMLMediaElement && !m.muted) for (const e of engines) e.pause();
			},
			true,
		);
	}
}

export class Engine {
	index: number;
	/** The viewer wants audio to play (pressed play, or autoplay succeeded). */
	wantsPlay = false;
	/** Waiting for data while wanting to play. */
	waiting = false;
	/** The last play() was refused by the browser autoplay policy. */
	blocked = false;
	failure: Failure = '';
	repeat: Repeat;
	rate = 1;

	private audio: HTMLAudioElement | null = null;
	private loaded = -1;
	private pendingSeek = 0;
	private raf = 0;
	/** Playing: the time is drawn every frame while the host is on screen. */
	private looping = false;
	private onScreen = true;
	private listeners: Array<(c: Change) => void> = [];
	private volumeOff: (() => void) | null = null;
	private holds = 0;
	private shownState = '';

	constructor(
		readonly host: HTMLElement,
		private readonly root: ShadowRoot,
		readonly tracks: Track[],
		repeat: Repeat,
	) {
		this.repeat = repeat;
		const first = tracks.findIndex((tr) => !tr.missing);
		this.index = first < 0 ? 0 : first;
		if (first < 0) this.failure = 'missing';
		this.attach();
		this.showState();
	}

	/** Registers the page-wide state that destroy() releases. */
	private attach(): void {
		if (this.volumeOff) return;
		engines.add(this);
		this.watchIfNeeded();
		this.volumeOff = onVolume(() => {
			if (this.audio) applyVolume(this.audio);
			this.emit('volume');
		});
	}

	/**
	 * The player has page-wide state open while held (a popover with window listeners, a lyrics
	 * download): until it lets go, the engine is released as soon as its host leaves the page.
	 */
	hold(on: boolean): void {
		this.holds = Math.max(0, this.holds + (on ? 1 : -1));
		this.watchIfNeeded();
	}

	private watchIfNeeded(): void {
		watchDocument(this, engines.has(this) && (!!this.audio || this.holds > 0));
	}

	get track(): Track {
		return this.tracks[this.index];
	}

	get multi(): boolean {
		return this.tracks.length > 1;
	}

	get time(): number {
		const a = this.audio;
		return a && this.loaded === this.index && a.readyState > 0 ? a.currentTime : this.pendingSeek;
	}

	/** Duration in seconds, 0 while unknown. */
	get duration(): number {
		const a = this.audio;
		if (!a || this.loaded !== this.index) return 0;
		const d = a.duration;
		return isFinite(d) && d > 0 ? d : 0;
	}

	/** End of the buffered range that contains the playback position. */
	get bufferedEnd(): number {
		const a = this.audio;
		if (!a || this.loaded !== this.index) return 0;
		const b = a.buffered;
		const now = a.currentTime;
		for (let i = 0; i < b.length; i++) {
			if (b.start(i) <= now + 0.5 && b.end(i) >= now) return b.end(i);
		}
		return 0;
	}

	on(fn: (c: Change) => void): void {
		this.listeners.push(fn);
	}

	private emit(c: Change): void {
		this.showState();
		for (const fn of this.listeners) fn(c);
	}

	private showState(): void {
		const s = playState(this);
		if (s !== this.shownState) {
			this.shownState = s;
			this.host.setAttribute('data-gramophone-state', s);
		}
	}

	private get playable(): number {
		return this.tracks.filter((tr) => !tr.missing).length;
	}

	private ensureAudio(): HTMLAudioElement {
		if (this.audio) return this.audio;
		const a = document.createElement('audio');
		a.preload = 'none';
		a.playbackRate = a.defaultPlaybackRate = this.rate;
		applyVolume(a);
		const on = (type: string, fn: () => void) => a.addEventListener(type, fn);
		on('play', () => {
			// A play that another player's claim() already paused (two autoplay players).
			if (a.paused) return;
			this.wantsPlay = true;
			this.blocked = false;
			claim(this);
			this.updateSession();
			this.emit('state');
		});
		on('playing', () => {
			this.waiting = false;
			this.startLoop();
			this.emit('state');
			this.updatePosition();
		});
		on('waiting', () => {
			if (!a.paused) {
				this.waiting = true;
				this.emit('state');
			}
		});
		on('pause', () => {
			// A pause queued by a source switch can arrive after play() resumed.
			if (!a.paused) return;
			this.wantsPlay = false;
			this.waiting = false;
			this.stopLoop();
			this.emit('state');
			this.emit('time');
			this.updatePosition();
		});
		on('timeupdate', () => {
			if (!this.raf) this.emit('time');
		});
		on('seeked', () => {
			this.emit('time');
			this.updatePosition();
		});
		on('loadedmetadata', () => {
			if (this.pendingSeek) {
				try {
					a.currentTime = this.pendingSeek;
				} catch (e) {
					// Not seekable yet.
				}
				this.pendingSeek = 0;
			}
			this.emit('duration');
		});
		on('durationchange', () => {
			this.emit('duration');
			this.updatePosition();
		});
		on('progress', () => this.emit('buffer'));
		on('ratechange', () => this.updatePosition());
		on('ended', () => this.onEnded());
		on('error', () => {
			if (!a.error || !a.getAttribute('src')) return;
			this.failure = 'load';
			this.wantsPlay = this.waiting = false;
			this.stopLoop();
			this.emit('state');
		});
		this.root.appendChild(a);
		this.audio = a;
		this.watchIfNeeded();
		this.applyLoop();
		return a;
	}

	private load(i: number): void {
		const a = this.ensureAudio();
		const tr = this.tracks[i];
		this.loaded = i;
		if (tr.src) {
			a.src = tr.src;
		} else {
			a.removeAttribute('src');
			a.load();
		}
	}

	play(): void {
		const tr = this.track;
		if (!tr || tr.missing) {
			this.failure = 'missing';
			this.emit('state');
			return;
		}
		// A host can come back after it was removed (moved by a script).
		this.attach();
		const a = this.ensureAudio();
		applyVolume(a);
		if (this.loaded !== this.index || this.failure === 'load') {
			const seek = this.pendingSeek;
			this.failure = '';
			this.load(this.index);
			this.pendingSeek = seek;
		}
		claim(this);
		this.wantsPlay = this.waiting = true;
		this.blocked = false;
		this.emit('state');
		let p: Promise<void> | undefined;
		try {
			p = a.play();
		} catch (e) {
			this.fail(e);
			return;
		}
		if (p && p.catch) p.catch((e) => this.fail(e));
	}

	private fail(err: unknown): void {
		const name = err && (err as Error).name;
		// AbortError: a later pause() or source switch superseded this play().
		if (name === 'AbortError') return;
		this.wantsPlay = this.waiting = false;
		if (name === 'NotAllowedError') this.blocked = true;
		else this.failure = 'load';
		this.stopLoop();
		this.emit('state');
	}

	pause(): void {
		if (this.audio && !this.audio.paused) {
			this.audio.pause();
		} else if (this.wantsPlay || this.waiting) {
			this.wantsPlay = this.waiting = false;
			this.emit('state');
		}
	}

	toggle(): void {
		if (this.wantsPlay) this.pause();
		else this.play();
	}

	select(i: number, play: boolean): void {
		if (i < 0 || i >= this.tracks.length) return;
		if (i !== this.index) {
			this.index = i;
			this.pendingSeek = 0;
			this.blocked = false;
			this.failure = this.tracks[i].missing ? 'missing' : '';
			if (this.audio) this.load(i);
			this.wantsPlay = this.waiting = false;
			this.applyLoop();
			if (sessionOwner === this) this.updateSession();
			this.emit('track');
			this.emit('duration');
			this.emit('time');
			this.emit('buffer');
			this.emit('state');
		}
		if (play) this.play();
	}

	next(auto = false): void {
		const n = this.tracks.length;
		for (let step = 1; step <= n; step++) {
			let i = this.index + step;
			if (i >= n) {
				if (auto && this.repeat !== 'all') break;
				i -= n;
			}
			if (!this.tracks[i].missing) {
				this.select(i, auto || this.wantsPlay);
				return;
			}
		}
		if (auto) this.stopAtEnd();
	}

	prev(): void {
		if (this.time > 3 || !this.multi) {
			this.seek(0);
			return;
		}
		const n = this.tracks.length;
		for (let step = 1; step < n; step++) {
			const i = (this.index - step + n) % n;
			if (!this.tracks[i].missing) {
				this.select(i, this.wantsPlay);
				return;
			}
		}
		this.seek(0);
	}

	private stopAtEnd(): void {
		const first = this.tracks.findIndex((tr) => !tr.missing);
		if (first >= 0 && first !== this.index) this.select(first, false);
		else this.seek(0);
	}

	private onEnded(): void {
		if (this.audio && this.audio.loop) return;
		this.next(true);
	}

	seek(sec: number): void {
		const a = this.audio;
		const d = this.duration;
		if (a && d) {
			try {
				a.currentTime = clamp(sec, 0, d);
			} catch (e) {
				// Not seekable.
			}
		} else {
			this.pendingSeek = Math.max(0, sec);
		}
		this.emit('time');
	}

	setRepeat(r: Repeat): void {
		this.repeat = r;
		this.applyLoop();
		this.emit('repeat');
	}

	private applyLoop(): void {
		if (this.audio) this.audio.loop = this.repeat === 'one' || (this.repeat === 'all' && this.playable === 1);
	}

	setRate(r: number): void {
		this.rate = r;
		if (this.audio) this.audio.playbackRate = this.audio.defaultPlaybackRate = r;
		this.emit('rate');
	}

	private startLoop(): void {
		if (this.looping) return;
		this.looping = true;
		watchScreen(this.host, (visible) => {
			this.onScreen = visible;
			if (!visible) this.cancelFrame();
			else if (!this.raf) {
				this.emit('time');
				this.frame();
			}
		});
		this.frame();
	}

	/** Requests the next animation frame while playing on screen. */
	private frame(): void {
		if (this.raf || !this.looping || !this.onScreen) return;
		const tick = () => {
			this.raf = 0;
			if (!this.host.isConnected) {
				this.destroy();
				return;
			}
			this.emit('time');
			this.frame();
		};
		this.raf = requestAnimationFrame(tick);
	}

	private cancelFrame(): void {
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	private stopLoop(): void {
		this.looping = false;
		this.onScreen = true;
		unwatchScreen(this.host);
		this.cancelFrame();
	}

	/** Stops playback and releases page-wide state (host removed from the page). */
	destroy(): void {
		this.pause();
		this.stopLoop();
		engines.delete(this);
		watchDocument(this, false);
		if (this.volumeOff) {
			this.volumeOff();
			this.volumeOff = null;
		}
		if (sessionOwner === this) {
			sessionOwner = null;
			const ms = navigator.mediaSession;
			if (ms) {
				try {
					ms.metadata = null;
					ms.playbackState = 'none';
				} catch (e) {
					// Ignore.
				}
				// The handlers hold this engine: media keys must not reach it any more.
				for (const action of ACTIONS) setAction(ms, action, null);
			}
		}
		this.emit('destroy');
	}

	private updateSession(): void {
		const ms = navigator.mediaSession;
		if (!ms) return;
		sessionOwner = this;
		const tr = this.track;
		try {
			ms.metadata = new MediaMetadata({
				title: tr.title,
				artist: tr.artist,
				album: tr.album,
				artwork: tr.cover ? [{ src: tr.cover }] : [],
			});
		} catch (e) {
			// MediaMetadata unsupported.
		}
		// Media keys act only while this engine owns the session and its host is on the page.
		const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) =>
			setAction(
				ms,
				action,
				fn &&
					((d) => {
						if (!this.host.isConnected) this.destroy();
						else if (sessionOwner === this) fn(d);
					}),
			);
		set('play', () => this.play());
		set('pause', () => this.pause());
		set('stop', () => {
			this.pause();
			this.seek(0);
		});
		set('seekbackward', (d) => this.seek(this.time - (d.seekOffset || 10)));
		set('seekforward', (d) => this.seek(this.time + (d.seekOffset || 10)));
		set('seekto', (d) => {
			if (d.seekTime != null) this.seek(d.seekTime);
		});
		set('previoustrack', this.multi ? () => this.prev() : null);
		set('nexttrack', this.multi ? () => this.next() : null);
	}

	private updatePosition(): void {
		const ms = navigator.mediaSession;
		const a = this.audio;
		if (!ms || !a || sessionOwner !== this) return;
		try {
			ms.playbackState = a.paused ? 'paused' : 'playing';
			const d = this.duration;
			if (d && ms.setPositionState) {
				ms.setPositionState({ duration: d, playbackRate: a.playbackRate || 1, position: clamp(a.currentTime, 0, d) });
			}
		} catch (e) {
			// Ignore invalid position states.
		}
	}
}
