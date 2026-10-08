/**
 * Hides `<sm2>…|hidemissing=yes</sm2>` buttons whose audio does not exist. Only tracks with the
 * `verify` flag are checked: the server sets it for URLs the wiki allows to load automatically.
 * Other tracks count as existing unless they are `missing`.
 *
 * Each URL is checked once per page with a HEAD request, once its button is displayed and within
 * about two screen heights of the viewport, so buttons further down, in a closed tab or in a folded
 * section wait. At most PARALLEL requests run at once page-wide, and each one gets TIMEOUT from the
 * moment it is sent. After a timeout, the waiting checks for that site are skipped, so buttons do not
 * wait for a site that does not answer. Only a 404 or 410 answer hides a button. Network errors,
 * hosts without CORS headers and slow answers keep it, so nothing playable disappears.
 *
 * The host is invisible but keeps its box (ext.gramophone.styles.css) while it has the class
 * ext-gramophone-checking. Then it gets the class ext-gramophone-checked, or the hidden attribute when none of its
 * files exist. A host this script never takes over appears after 10 s through the stylesheet.
 */
import type { Track } from './config';

/** Milliseconds to wait for an answer, counted from when the request is sent, before the button is shown anyway. */
const TIMEOUT = 5000;
/** Most HEAD requests in flight at once on the page. */
const PARALLEL = 6;
const answers = new Map<string, Promise<boolean>>();
/** Origins that let a request time out. */
const slow = new Set<string>();
/** Requests waiting for a free slot, oldest first. */
const queue: Array<() => void> = [];
let running = 0;
const waiting = new WeakMap<Element, () => void>();
const redraw = new WeakMap<Element, () => void>();
let io: IntersectionObserver | null = null;

function drain(): void {
	while (running < PARALLEL && queue.length) {
		running++;
		(queue.shift() as () => void)();
	}
}

/** Resolves false only when the server answers 404 or 410. Never rejects. */
export function exists(url: string): Promise<boolean> {
	let answer = answers.get(url);
	if (!answer) {
		answer = new Promise<boolean>((resolve) => {
			if (typeof fetch !== 'function') {
				resolve(true);
				return;
			}
			let origin = url;
			try {
				origin = new URL(url, location.href).origin;
			} catch (e) {
				// Keep the URL as its own key.
			}
			queue.push(() => {
				if (slow.has(origin)) {
					// drain() goes on with the next request.
					running--;
					resolve(true);
					return;
				}
				const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
				let settled = false;
				const done = (found: boolean) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					running--;
					resolve(found);
					drain();
				};
				// The time starts now that the request is sent, not while it waited for a slot.
				const timer = setTimeout(() => {
					slow.add(origin);
					done(true);
					if (ctrl) ctrl.abort();
				}, TIMEOUT);
				fetch(url, { method: 'HEAD', signal: ctrl ? ctrl.signal : undefined }).then(
					(res) => done(res.status !== 404 && res.status !== 410),
					() => done(true),
				);
			});
			drain();
		});
		answers.set(url, answer);
	}
	return answer;
}

/**
 * Runs fn once el is displayed within about two screen heights of the viewport: not inside
 * display: none, a closed hidden="until-found", or the clipped part of a scroll container
 * (TabberNeue lays closed tabs out that way, and so are table columns scrolled out of view sideways).
 */
function whenNear(el: Element, fn: () => void): void {
	if (typeof IntersectionObserver === 'undefined') {
		fn();
		return;
	}
	if (!io) {
		io = new IntersectionObserver(
			(entries) => {
				for (const en of entries) {
					const run = waiting.get(en.target);
					if (!en.isIntersecting || !run) continue;
					waiting.delete(en.target);
					(io as IntersectionObserver).unobserve(en.target);
					run();
				}
			},
			{ rootMargin: '200% 0px' },
		);
	}
	waiting.set(el, fn);
	io.observe(el);
}

/** Calls fn when a check marks one of host's files missing after the button was built (button.ts redraws). */
export function onMissing(host: Element, fn: () => void): void {
	redraw.set(host, fn);
}

/**
 * Shows the button once one of its files is known to exist, hides it when none does. Files that
 * answered 404 or 410 become missing tracks, so the button plays only the others. near() runs when
 * the checks start, or at once when there is nothing to check.
 */
export function hideIfMissing(host: HTMLElement, tracks: Track[], near?: () => void): void {
	const checked = tracks.filter((tr) => !tr.missing && tr.verify);
	const known = tracks.some((tr) => !tr.missing && !tr.verify);
	if (known) host.classList.add('ext-gramophone-checked');
	else if (!checked.length) host.hidden = true;
	else host.classList.add('ext-gramophone-checking');
	if (!checked.length) {
		if (near) near();
		return;
	}
	whenNear(host, () => {
		if (near) near();
		Promise.all(checked.map((tr) => exists(tr.src))).then((found) => {
			checked.forEach((tr, i) => {
				if (!found[i]) tr.missing = true;
			});
			const fn = redraw.get(host);
			if (fn && found.indexOf(false) >= 0) fn();
			if (known) return;
			host.classList.remove('ext-gramophone-checking');
			if (found.indexOf(true) >= 0) host.classList.add('ext-gramophone-checked');
			else host.hidden = true;
		});
	});
}
