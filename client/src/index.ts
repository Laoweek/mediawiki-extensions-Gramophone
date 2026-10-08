/**
 * Gramophone client entry point (the ext.gramophone module). Finds
 * `.ext-gramophone[data-mw-gramophone]` hosts emitted by the parser tags and hydrates each
 * one into a shadow root.
 *
 * Pages can hold a hundred players, so hosts mount lazily: when they come
 * within about a viewport of the screen, when keyboard focus reaches their
 * fallback link, or when the browser is idle. Autoplay players mount at once.
 * Mounting is idempotent, and a broken host never stops the others.
 *
 * Buttons are built here. The card player and the table row are in the
 * ext.gramophone.player module, loaded once the page has a player host (also on
 * cached pages whose HTML only asked for ext.gramophone).
 */
import { parseConfig, type Config } from './config';
import { mountButton } from './button';
import { prune } from './engine';
import { hideIfMissing } from './exists';
import { h, report } from './util';
import type * as Players from './players';

// ext.gramophone.player reuses these modules through require('ext.gramophone'). build.mjs reads this list.
export * from './colors';
export * from './engine';
export * from './i18n';
export * from './icons';
export * from './styles';
export * from './tooltip';
export * from './util';
export * from './volume';

const SELECTOR = '.ext-gramophone[data-mw-gramophone]';
const seen = new WeakSet<Element>();
/** Hosts waiting to mount, in document order. */
const pending = new Map<HTMLElement, Config>();
let io: IntersectionObserver | null = null;
let idleQueued = false;

const PLAYERS = 'ext.gramophone.player';
let players: typeof Players | null = null;
/** What waits for ext.gramophone.player while it loads: a callback, and the host it mounts. */
let playersLoading: Array<{ fn: (p: typeof Players) => void; host?: HTMLElement }> | null = null;
let playersFailed = false;

/**
 * Calls fn with the ext.gramophone.player module, at once when it is loaded. When the module cannot load,
 * host and the other players waiting for it show their links as a plain list, and a later call
 * tries again.
 */
function withPlayers(fn: (p: typeof Players) => void, host?: HTMLElement): void {
	if (players) {
		fn(players);
		return;
	}
	if (playersLoading) {
		playersLoading.push({ fn, host });
		return;
	}
	const waiting = (playersLoading = [{ fn, host }]);
	const failed = (err: unknown) => {
		playersLoading = null;
		// Once: in ResourceLoader every later attempt fails the same way.
		if (!playersFailed) report(err);
		playersFailed = true;
		for (const w of waiting) if (w.host) showList(w.host);
		// The card and row players not taken yet would wait for nothing.
		for (const [h, cfg] of pending) {
			if (cfg.mode !== 'player') continue;
			pending.delete(h);
			if (io) io.unobserve(h);
			showList(h);
		}
	};
	const loaded = (require: (name: string) => unknown) => {
		try {
			players = require(PLAYERS) as typeof Players;
		} catch (err) {
			failed(err);
			return;
		}
		playersLoading = null;
		for (const w of waiting) {
			try {
				w.fn(players);
			} catch (err) {
				report(err);
			}
		}
		// The players that the idle loop left for later.
		drainWhenIdle();
	};
	const loader = window.mw && window.mw.loader;
	try {
		if (!loader) throw new Error('mw.loader is missing, players cannot load');
		loader.using(PLAYERS).then(loaded, failed);
	} catch (err) {
		failed(err);
	}
}

/**
 * ext.gramophone.player could not load: the host shows all its fallback links as a plain list, as without
 * JavaScript. The list is copied into a shadow root, where the page's placeholder styles do not reach.
 */
function showList(host: HTMLElement): void {
	if (host.shadowRoot) return;
	if (!host.isConnected) {
		seen.delete(host);
		return;
	}
	const list = host.querySelector('.ext-gramophone-fallback');
	const links = Array.from(host.querySelectorAll('a'));
	const focused = links.indexOf(document.activeElement as HTMLAnchorElement);
	const root = host.attachShadow({ mode: 'open' });
	if (!list) return;
	const copy = list.cloneNode(true) as Element;
	root.appendChild(copy);
	if (focused >= 0) (copy.querySelectorAll('a')[focused] as HTMLElement).focus();
}

/** The full player shows as a row: one track, inside a table cell. */
function isRow(host: HTMLElement, cfg: Config): boolean {
	return cfg.tracks.length === 1 && !!host.closest('td, th');
}

function attach(host: HTMLElement, layout: string, build: (root: ShadowRoot) => HTMLElement): void {
	if (host.shadowRoot) return;
	if (!host.isConnected) {
		// Removed while ext.gramophone.player loaded: mount it again if it comes back with wikipage.content.
		seen.delete(host);
		return;
	}
	// Keyboard focus on a fallback link (perhaps while ext.gramophone.player loaded) moves to the new control.
	const active = document.activeElement;
	const focus = !!active && host.contains(active);
	const root = host.attachShadow({ mode: 'open' });
	try {
		const control = build(root);
		// For site CSS, next to the data-gramophone-state that the engine sets.
		host.setAttribute('data-gramophone-layout', layout);
		// The focused fallback link is no longer rendered: move focus to the new control.
		if (focus) control.focus();
	} catch (err) {
		// Show the light-DOM fallback links again.
		root.textContent = '';
		root.appendChild(h('slot'));
		host.removeAttribute('data-gramophone-state');
		report(err);
	}
}

function mountHost(host: HTMLElement, cfg: Config): void {
	if (host.shadowRoot) return;
	if (cfg.mode === 'button') {
		attach(host, 'button', (root) => mountButton(host, root, cfg));
		return;
	}
	const row = isRow(host, cfg);
	withPlayers((p) => attach(host, row ? 'row' : 'card', (root) => (row ? p.mountRow(host, root, cfg) : p.mountPlayer(host, root, cfg))), host);
}

function take(host: HTMLElement): void {
	const cfg = pending.get(host);
	if (!cfg) return;
	pending.delete(host);
	if (io) io.unobserve(host);
	if (!host.isConnected) {
		seen.delete(host);
		return;
	}
	try {
		mountHost(host, cfg);
	} catch (err) {
		report(err);
	}
}

/** The idle loop leaves card and row players for later while ext.gramophone.player loads, so they too mount in slices. */
const idleReady = (cfg: Config) => cfg.mode === 'button' || !!players;

/** Mounts the remaining hosts a few at a time while the browser is idle. */
function drainWhenIdle(): void {
	if (idleQueued) return;
	let any = false;
	for (const cfg of pending.values()) if ((any = idleReady(cfg))) break;
	if (!any) return;
	idleQueued = true;
	const run = (deadline?: IdleDeadline) => {
		idleQueued = false;
		const end = Date.now() + 8;
		for (const [host, cfg] of pending) {
			if (!idleReady(cfg)) continue;
			take(host);
			if (deadline ? deadline.timeRemaining() < 2 : Date.now() > end) break;
		}
		drainWhenIdle();
	};
	if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3000 });
	else setTimeout(run, 50);
}

function lazy(): boolean {
	if (io) return true;
	if (typeof IntersectionObserver === 'undefined') return false;
	io = new IntersectionObserver(
		(entries) => {
			for (const en of entries) if (en.isIntersecting) take(en.target as HTMLElement);
		},
		{ rootMargin: '100% 0px' },
	);
	// Keyboard users tabbing onto a fallback link land on the mounted control.
	document.addEventListener(
		'focusin',
		(ev) => {
			const el = ev.target;
			const host = el instanceof Element ? el.closest(SELECTOR) : null;
			if (host && pending.has(host as HTMLElement)) take(host as HTMLElement);
		},
		true,
	);
	return true;
}

export function mount(scope: ParentNode): void {
	// New content (live preview, VisualEditor) often replaced hosts: release their engines.
	prune();
	const hosts: Element[] = [];
	if (scope instanceof Element && scope.matches(SELECTOR)) hosts.push(scope);
	scope.querySelectorAll(SELECTOR).forEach((el) => hosts.push(el));
	for (const el of hosts) {
		const host = el as HTMLElement;
		if (seen.has(host) || host.shadowRoot) continue;
		seen.add(host);
		try {
			const cfg = parseConfig(host);
			if (!cfg || !cfg.tracks.length) continue;
			// Start loading the player code now, so it is there when the host comes into view.
			if (cfg.mode === 'player') withPlayers(() => undefined);
			const lazily = !cfg.autoPlay && lazy();
			if (lazily) pending.set(host, cfg);
			// Observing many hosts costs time on every scroll, so a host has one observer at a time:
			// a hidemissing button is watched by exists.ts until it comes near, then by io.
			const watch = () => {
				if (io && pending.has(host)) io.observe(host);
			};
			// Independent of mounting: a found button shows its focusable placeholder until it mounts.
			if (cfg.hideMissing) hideIfMissing(host, cfg.tracks, watch);
			else watch();
			if (!lazily) mountHost(host, cfg);
		} catch (err) {
			report(err);
		}
	}
	drainWhenIdle();
}

function start(): void {
	const mw = window.mw;
	if (mw && mw.hook) {
		mw.hook('wikipage.content').add(($content: unknown) => {
			const jq = $content as { get?: () => Element[] } | Element | null;
			const els = jq && typeof (jq as { get?: unknown }).get === 'function' ? (jq as { get: () => Element[] }).get() : [jq];
			for (const el of els) {
				if (el && (el as Element).querySelectorAll) mount(el as Element);
			}
		});
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount(document));
	else mount(document);
}

try {
	start();
} catch (err) {
	report(err);
}
