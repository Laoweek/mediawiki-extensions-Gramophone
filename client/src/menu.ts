/**
 * Track menu: a right-click on a player or button opens a small menu that downloads the track's
 * audio or opens its file page, in place of the browser's menu. A long press on a touch screen,
 * the context menu key and Shift+F10 open it too. Links inside a player keep the browser's menu.
 *
 * The document listens once for every host, because a page can hold hundreds of buttons. A shadow
 * root gets its menu on first use, so the menu takes the host's tokens. The menu shows in the top
 * layer (popover="manual") where the Popover API exists, so table cells with overflow:hidden do
 * not clip it. Dismissing is done here: the browser's light dismiss would close a menu that a long
 * press opened as soon as the finger lifts.
 */
import type { Track } from './config';
import { t } from './i18n';
import { Download, ExternalLink, icon, type IconNode } from './icons';
import { hide as hideTip } from './tooltip';
import { clamp, h, setLink } from './util';

/** The track that a right-click on target offers, or null to leave the browser's menu. */
export type MenuTrack = (target: Element) => Track | null;

interface Hit {
	root: ShadowRoot;
	area: Element;
	target: Element;
	track: Track;
}

const NATIVE = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
/** Milliseconds a finger rests on a control before the menu opens. */
const LONG_PRESS = 500;
/** Pixels a finger may move during a long press. More is a scroll. */
const SLOP = 10;
/** Pixels between a finger and the menu above it, so the fingertip does not hide the menu's edge. */
const FINGER = 24;

const areas = new WeakMap<Element, MenuTrack>();
const menus = new WeakMap<ShadowRoot, HTMLDivElement>();
let listening = false;
/** The open menu. It keeps its offset dx, dy from its area while the page scrolls. */
let shown: { pop: HTMLDivElement; area: Element; at: number; restore: HTMLElement | null; dx: number; dy: number; above: boolean } | null = null;
/** A finger or pen on an area. On a slider it has no timer: it drags the slider. */
let press: { id: number; x: number; y: number; timer: number } | null = null;
/** A long press opened the menu: the click that follows the lift must not press the control. */
let swallowClick = false;

/** A right-click anywhere in area opens the menu for the track that track() returns. */
export function bindMenu(area: Element, track: MenuTrack): void {
	areas.set(area, track);
	if (listening) return;
	listening = true;
	document.addEventListener('contextmenu', onContextMenu, true);
	document.addEventListener('keydown', onKeyDown, true);
	document.addEventListener('pointerdown', onPointerDown, true);
	document.addEventListener('click', onClick, true);
}

function find(ev: Event): Hit | null {
	const path = ev.composedPath();
	for (const node of path) {
		if (!(node instanceof Element)) continue;
		// Links keep the browser's menu: open in a new tab, copy the address.
		if (node.tagName === 'A') return null;
		const fn = areas.get(node);
		if (!fn) continue;
		const target = path[0] instanceof Element ? path[0] : node;
		const track = fn(target);
		const root = node.getRootNode();
		if (!track || !(track.src || track.link) || !(root instanceof ShadowRoot)) return null;
		return { root, area: node, target, track };
	}
	return null;
}

function onContextMenu(ev: MouseEvent): void {
	// The Menu key on Windows fires contextmenu on keyup, at the focused menu item, and a late long
	// press can land on the menu: the browser's menu must not open over it.
	if (shown && ev.composedPath().includes(shown.pop)) {
		ev.preventDefault();
		return;
	}
	const hit = find(ev);
	if (!hit) return;
	const finger = press !== null;
	if (press) {
		// Android fires contextmenu for a long press of a finger.
		const dragging = !press.timer;
		cancelPress();
		if (dragging) {
			ev.preventDefault();
			return;
		}
	}
	const r = hit.target.getBoundingClientRect();
	// The context menu key gives the event no pointer position inside the control.
	const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
	if (!show(hit, inside ? ev.clientX : r.left, inside ? ev.clientY : r.bottom, finger)) return;
	ev.preventDefault();
	if (finger) swallowClick = true;
}

function onKeyDown(ev: KeyboardEvent): void {
	// A long press gesture can move focus back to the control.
	if (shown && ev.key === 'Escape' && !ev.composedPath().includes(shown.pop)) {
		ev.preventDefault();
		close(true);
		return;
	}
	if (ev.key !== 'ContextMenu' && !(ev.key === 'F10' && ev.shiftKey)) return;
	const hit = find(ev);
	if (!hit) return;
	const r = hit.target.getBoundingClientRect();
	if (show(hit, r.left, r.bottom, false)) ev.preventDefault();
}

function onPointerDown(ev: PointerEvent): void {
	swallowClick = false;
	cancelPress();
	if (shown && !ev.composedPath().includes(shown.pop)) close(false);
	// Mouse users right-click. A pen counts as a finger: on iPad it has no other way.
	if (ev.pointerType === 'mouse' || !ev.isPrimary) return;
	const hit = find(ev);
	if (!hit) return;
	const x = ev.clientX;
	const y = ev.clientY;
	const opens = () => {
		cancelPress();
		if (show(hit, x, y, true)) swallowClick = true;
	};
	const timer = hit.target.closest('[role="slider"]') ? 0 : window.setTimeout(opens, LONG_PRESS);
	press = { id: ev.pointerId, x, y, timer };
	addEventListener('pointermove', onPressMove, true);
	addEventListener('pointerup', cancelPress, true);
	addEventListener('pointercancel', cancelPress, true);
}

function onPressMove(ev: PointerEvent): void {
	if (press && ev.pointerId === press.id && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > SLOP) cancelPress();
}

function cancelPress(): void {
	if (!press) return;
	clearTimeout(press.timer);
	press = null;
	removeEventListener('pointermove', onPressMove, true);
	removeEventListener('pointerup', cancelPress, true);
	removeEventListener('pointercancel', cancelPress, true);
}

function onClick(ev: MouseEvent): void {
	// Clicks from the keyboard or a script (detail 0) are never the lift of a finger.
	if (!swallowClick || ev.detail === 0) return;
	swallowClick = false;
	ev.preventDefault();
	ev.stopPropagation();
}

const dismiss = () => close(false);
const follow = () => {
	if (!shown) return;
	// The area, not the element under the pointer: that one may be rebuilt while the menu is open.
	const r = shown.area.getBoundingClientRect();
	place(shown.pop, r.left + shown.dx, r.top + shown.dy, shown.above);
};

/** Opens the menu of hit at x, y. False when site CSS hides every entry, so the browser's menu may open instead. */
function show(hit: Hit, x: number, y: number, above: boolean): boolean {
	// After a long press, Android fires contextmenu too, and may have moved focus back to the control.
	if (shown && shown.area === hit.area && Date.now() - shown.at < 600) {
		if (!shown.pop.contains(focused())) visibleItems(shown.pop)[0].focus({ preventScroll: true });
		return true;
	}
	close(false);
	hideTip();
	const pop = popFor(hit.root);
	const menu = pop.firstElementChild as HTMLDivElement;
	const tr = hit.track;
	menu.setAttribute('aria-label', tr.title);
	menu.textContent = '';
	if (tr.src) {
		const a = item(Download, t('gramophone-download'), 'download-option');
		setLink(a, tr.src, tr.nofollow);
		a.setAttribute('download', '');
		a.target = '_blank';
		menu.appendChild(a);
	}
	if (tr.link) {
		const a = item(ExternalLink, t('gramophone-open-file-page'), 'file-page-option');
		setLink(a, tr.link, tr.nofollow);
		menu.appendChild(a);
	}
	// A wiki without downloads hides download-option.
	const items = visibleItems(menu);
	if (!items.length) return false;
	const restore = focused();
	if (NATIVE) {
		try {
			pop.showPopover();
		} catch (e) {
			// Disconnected.
		}
	} else pop.hidden = false;
	place(pop, x, y, above);
	const r = hit.area.getBoundingClientRect();
	shown = { pop, area: hit.area, at: Date.now(), restore, dx: x - r.left, dy: y - r.top, above };
	items[0].focus({ preventScroll: true });
	addEventListener('scroll', follow, { capture: true, passive: true });
	addEventListener('resize', dismiss);
	addEventListener('blur', dismiss);
	return true;
}

function close(refocus: boolean): void {
	if (!shown) return;
	const { pop, restore } = shown;
	shown = null;
	removeEventListener('scroll', follow, true);
	removeEventListener('resize', dismiss);
	removeEventListener('blur', dismiss);
	if (NATIVE) {
		try {
			pop.hidePopover();
		} catch (e) {
			// Already closed.
		}
	} else pop.hidden = true;
	if (refocus && restore && restore.isConnected) restore.focus({ preventScroll: true });
}

function popFor(root: ShadowRoot): HTMLDivElement {
	let pop = menus.get(root);
	if (pop) return pop;
	const menu = h('div', 'menu', { role: 'menu' });
	pop = h('div', 'pop ctx', { part: 'popover track-menu' }, [menu]);
	if (NATIVE) pop.setAttribute('popover', 'manual');
	else pop.hidden = true;
	menu.addEventListener('keydown', onMenuKey);
	// After the link has done its work: a download, a new tab or the file page.
	menu.addEventListener('click', () => setTimeout(() => close(true)));
	root.appendChild(pop);
	menus.set(root, pop);
	return pop;
}

function item(node: IconNode, text: string, part: string): HTMLAnchorElement {
	return h('a', 'menu-item', { role: 'menuitem', tabindex: '-1', part }, [icon(node), text]);
}

/** The entries that site CSS leaves visible. */
function visibleItems(menu: Element): HTMLElement[] {
	return Array.from(menu.querySelectorAll<HTMLElement>('.menu-item')).filter((a) => getComputedStyle(a).display !== 'none');
}

function onMenuKey(ev: KeyboardEvent): void {
	const items = visibleItems(ev.currentTarget as Element);
	const i = items.indexOf(ev.target as HTMLElement);
	let next = -1;
	if (ev.key === 'ArrowDown') next = (i + 1) % items.length;
	else if (ev.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
	else if (ev.key === 'Home') next = 0;
	else if (ev.key === 'End') next = items.length - 1;
	else if (ev.key === ' ') (ev.target as HTMLElement).click();
	else if (ev.key !== 'Escape' && ev.key !== 'Tab') return;
	ev.preventDefault();
	ev.stopPropagation();
	if (next >= 0) items[next].focus();
	else if (ev.key !== ' ') close(true);
}

/** The focused element, also inside shadow roots. */
function focused(): HTMLElement | null {
	let el = document.activeElement;
	while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
	return el instanceof HTMLElement && el !== document.body ? el : null;
}

/**
 * Puts the menu inside the viewport: its corner at x, y for a mouse or the keyboard, and centred
 * above x, y for a finger, whose hand would hide a menu below it. Each flips when there is no room.
 */
function place(pop: HTMLElement, x: number, y: number, above: boolean): void {
	pop.style.left = pop.style.top = '0px';
	// Without the top layer, the host of a container query is the containing block of a fixed element.
	const origin = pop.getBoundingClientRect();
	const w = pop.offsetWidth;
	const hgt = pop.offsetHeight;
	const doc = document.documentElement;
	const left = clamp(above ? x - w / 2 : x, 8, doc.clientWidth - w - 8);
	let top: number;
	if (above) top = y - FINGER - hgt >= 8 ? y - FINGER - hgt : y + FINGER;
	else top = y + hgt + 8 > doc.clientHeight ? Math.max(8, y - hgt) : y;
	pop.style.left = left - origin.left + 'px';
	pop.style.top = top - origin.top + 'px';
}
