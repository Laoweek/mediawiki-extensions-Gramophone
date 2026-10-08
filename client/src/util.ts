/** Small DOM and formatting helpers shared by both player modes. */

export function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	cls?: string,
	attrs?: Record<string, string>,
	children?: Array<Node | string>,
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	if (cls) el.className = cls;
	if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
	if (children) el.append(...children);
	return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
	const el = document.createElementNS(SVG_NS, tag);
	for (const k in attrs) el.setAttribute(k, String(attrs[k]));
	return el;
}

export function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

/** Formats seconds as m:ss or h:mm:ss. */
export function formatTime(sec: number): string {
	if (!isFinite(sec) || sec < 0) sec = 0;
	sec = Math.floor(sec);
	const hh = Math.floor(sec / 3600);
	const mm = Math.floor((sec % 3600) / 60);
	const ss = sec % 60;
	const pad = (n: number) => (n < 10 ? '0' : '') + n;
	return hh ? hh + ':' + pad(mm) + ':' + pad(ss) : mm + ':' + pad(ss);
}

/**
 * The stroke-dashoffset that shows fraction p of a progress ring with circumference c. It moves in
 * whole user units (about 1 px), so a playing ring is redrawn only when the change is visible.
 */
export function ringOffset(c: number, p: number): string {
	return Math.max(0, c - Math.round(c * clamp(p, 0, 1))).toFixed(2);
}

export function reducedMotion(): boolean {
	try {
		return matchMedia('(prefers-reduced-motion: reduce)').matches;
	} catch (e) {
		return false;
	}
}

/** Adds or removes a state name, such as "current", in the part attribute (site CSS reads it through ::part()). */
export function partState(el: Element, name: string, on: boolean): void {
	if (el.part) el.part.toggle(name, on);
}

/** Sets a toggle button's aria-pressed and its "pressed" part state. */
export function setPressed(el: Element, on: boolean): void {
	el.setAttribute('aria-pressed', String(on));
	partState(el, 'pressed', on);
}

/** Sets an accessible name and the matching tooltip text. */
export function label(el: Element, text: string): void {
	if (el.getAttribute('aria-label') !== text) {
		el.setAttribute('aria-label', text);
		el.setAttribute('data-tip', text);
	}
}

export function report(err: unknown): void {
	try {
		const mw = window.mw;
		if (mw && mw.log && mw.log.error) mw.log.error(err);
		else console.error(err);
	} catch (e) {
		// Logging must never throw.
	}
}
