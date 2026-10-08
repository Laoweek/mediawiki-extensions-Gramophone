/**
 * Anchored popover for the volume and speed controls. Uses the Popover API
 * (top layer, light dismiss) with fixed positioning next to the anchor, and
 * falls back to an absolutely positioned panel inside the player.
 */
import { h, partState } from './util';

const NATIVE = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

export class Popover {
	readonly el: HTMLDivElement;
	open = false;
	private readonly reposition = () => this.position();
	private readonly outside = (e: Event) => {
		if (!e.composedPath().includes(this.wrap)) this.hide();
	};

	constructor(
		private readonly anchor: HTMLButtonElement,
		private readonly wrap: HTMLElement,
		cls: string,
		part: string,
		private readonly onChange: (open: boolean) => void,
	) {
		this.el = h('div', 'pop ' + cls, { part: 'popover ' + part });
		anchor.setAttribute('aria-expanded', 'false');
		if (NATIVE) {
			this.el.setAttribute('popover', 'auto');
			anchor.popoverTargetElement = this.el;
			// Position before the first painted frame, once the popover has a size.
			this.el.addEventListener('beforetoggle', (e) => {
				if ((e as ToggleEvent).newState === 'open') requestAnimationFrame(this.reposition);
			});
			this.el.addEventListener('toggle', (e) => this.changed((e as ToggleEvent).newState === 'open'));
		} else {
			this.el.hidden = true;
			this.el.classList.add('pop-inline');
			anchor.addEventListener('click', () => (this.open ? this.hide() : this.show()));
		}
		this.el.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				this.hide();
				anchor.focus();
			}
		});
		wrap.appendChild(this.el);
	}

	show(): void {
		if (this.open) return;
		if (NATIVE) {
			try {
				this.el.showPopover();
			} catch (e) {
				// Already open or disconnected.
			}
		} else {
			this.el.hidden = false;
			this.changed(true);
		}
	}

	hide(): void {
		if (!this.open) return;
		if (NATIVE) {
			try {
				this.el.hidePopover();
			} catch (e) {
				// Already closed.
			}
		} else {
			this.el.hidden = true;
			this.changed(false);
		}
	}

	/** Releases the window listeners when the player leaves the page while open. */
	dispose(): void {
		if (!this.open) return;
		if (!NATIVE) this.el.hidden = true;
		this.changed(false);
	}

	private changed(open: boolean): void {
		// The inline fallback is placed by CSS next to its anchor.
		if (open && NATIVE) this.position();
		if (open === this.open) return;
		this.open = open;
		this.anchor.setAttribute('aria-expanded', String(open));
		partState(this.anchor, 'expanded', open);
		const method = open ? 'addEventListener' : 'removeEventListener';
		if (NATIVE) {
			window[method]('scroll', this.reposition, true);
			window[method]('resize', this.reposition);
		} else {
			document[method]('pointerdown', this.outside, true);
		}
		this.onChange(open);
	}

	private position(): void {
		const a = this.anchor.getBoundingClientRect();
		const w = this.el.offsetWidth;
		const hgt = this.el.offsetHeight;
		const vw = document.documentElement.clientWidth;
		let top = a.top - hgt - 8;
		if (top < 8) top = a.bottom + 8;
		const left = Math.max(8, Math.min(a.left + a.width / 2 - w / 2, vw - w - 8));
		this.el.style.top = top + 'px';
		this.el.style.left = left + 'px';
	}
}
