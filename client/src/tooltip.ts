/**
 * One tooltip bubble for the whole page, shown for any [data-tip] element in
 * a bound shadow root. It lives in its own host under <body> and uses the
 * top layer (popover="manual") when available, so table cells with
 * overflow:hidden and open menus never cover it.
 */
import { adopt } from './styles';
import { h } from './util';

const NATIVE = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
let bubble: HTMLElement | null = null;
let target: Element | null = null;
let timer = 0;
let lastHidden = 0;

function ensure(): HTMLElement {
	if (bubble && bubble.isConnected) return bubble;
	const host = h('div', 'ext-gramophone-tooltip');
	const root = host.attachShadow({ mode: 'open' });
	adopt(root, 'tooltip');
	bubble = h('div', 'tt', { 'aria-hidden': 'true', part: 'tooltip' });
	if (NATIVE) bubble.setAttribute('popover', 'manual');
	root.appendChild(bubble);
	document.body.appendChild(host);
	return bubble;
}

function place(el: Element, b: HTMLElement): void {
	const r = el.getBoundingClientRect();
	const w = b.offsetWidth;
	const hgt = b.offsetHeight;
	const vw = document.documentElement.clientWidth;
	let top = r.top - hgt - 6;
	let below = false;
	if (top < 4) {
		top = r.bottom + 6;
		below = true;
	}
	const left = Math.max(4, Math.min(r.left + r.width / 2 - w / 2, vw - w - 4));
	b.style.top = top + 'px';
	b.style.left = left + 'px';
	b.classList.toggle('below', below);
}

function show(el: Element): void {
	const text = el.getAttribute('data-tip');
	if (!text || !el.isConnected) return;
	const b = ensure();
	b.textContent = text;
	if (NATIVE) {
		try {
			// Re-showing moves the bubble above popovers opened in the meantime.
			if (b.matches(':popover-open')) b.hidePopover();
			b.showPopover();
		} catch (e) {
			// Fall back to fixed positioning only.
		}
	}
	place(el, b);
	b.classList.add('show');
	addEventListener('scroll', hide, { capture: true, passive: true, once: true });
}

export function hide(): void {
	clearTimeout(timer);
	target = null;
	if (bubble && bubble.classList.contains('show')) {
		bubble.classList.remove('show');
		lastHidden = Date.now();
	}
}

function schedule(el: Element, delay: number): void {
	clearTimeout(timer);
	target = el;
	timer = window.setTimeout(() => {
		if (target === el) show(el);
	}, delay);
}

/** Refreshes the bubble text if the element it points at changed its tip. */
export function refreshTip(el: Element): void {
	if (target === el && bubble && bubble.classList.contains('show')) bubble.textContent = el.getAttribute('data-tip');
}

// The listeners of a shadow root. They are the same functions for every root.
const tipOf = (e: Event) => {
	const el = e.target as Element | null;
	return el && el.closest ? el.closest('[data-tip]') : null;
};
const LISTENERS: Record<string, (e: Event) => void> = {
	pointerover: (e) => {
		if ((e as PointerEvent).pointerType === 'touch') return;
		const el = tipOf(e);
		// Moving between controls keeps tooltips coming without the initial delay.
		if (el && el !== target) schedule(el, Date.now() - lastHidden < 300 ? 0 : 450);
	},
	pointerout: (e) => {
		const to = (e as PointerEvent).relatedTarget as Node | null;
		if (target && !(to && target.contains(to))) hide();
	},
	focusin: (e) => {
		const el = tipOf(e);
		try {
			if (el && el.matches(':focus-visible')) schedule(el, 150);
		} catch (err) {
			// :focus-visible unsupported.
		}
	},
	focusout: hide,
	pointerdown: hide,
	keydown: (e) => {
		if ((e as KeyboardEvent).key === 'Escape') hide();
	},
};
/** Roots whose [data-tip] elements get the bubble. */
const bound = new WeakSet<ShadowRoot>();
/** Bound roots that have their listeners. */
const listening = new WeakSet<ShadowRoot>();
let entering = false;

/**
 * The document does not see pointer and focus moves between two elements of the same shadow root
 * (their relatedTarget would be the host itself), so those must be handled on the root. A page can
 * hold hundreds of roots, so a root gets its listeners only when the pointer or focus first enters
 * its host, an event the document sees. That event can target an element in the root, or the host
 * itself (the corner of a round button). The capture listener runs before the event reaches the
 * root, which then handles it with its new listeners.
 */
function enter(e: Event): void {
	for (const node of e.composedPath()) {
		const root = node instanceof ShadowRoot ? node : node instanceof Element ? node.shadowRoot : null;
		if (root && bound.has(root) && !listening.has(root)) {
			listening.add(root);
			for (const type in LISTENERS) root.addEventListener(type, LISTENERS[type]);
		}
	}
}

export function bindTooltips(root: ShadowRoot): void {
	bound.add(root);
	if (entering) return;
	entering = true;
	document.addEventListener('pointerover', enter, true);
	document.addEventListener('focusin', enter, true);
}
