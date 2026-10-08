/**
 * Accessible slider (role="slider") in the shadcn/ui style: thin rounded
 * track, filled range, optional buffered range and hover time bubble.
 * Pointer Events with pointer capture for dragging, full keyboard support.
 */
import { clamp, h } from './util';

export interface SliderOptions {
	label: string;
	cls?: string;
	/** Prefix of the part names for site CSS: "seek" gives seek-slider, seek-track, seek-range... */
	part: string;
	step: number;
	page: number;
	text(value: number): string;
	/** Text for the hover bubble at a pointer position, or null for no bubble. */
	hover?: (value: number) => string;
	input(value: number): void;
	commit?(value: number): void;
}

/**
 * A fraction rounded to 1/1000, as the CSS value of --p or --b. Playback calls set() every frame,
 * and a smaller move is not visible, so the style is written only when this text changes.
 */
function step(frac: number): string {
	return String(Math.round(clamp(frac, 0, 1) * 1000) / 1000);
}

export class Slider {
	readonly el: HTMLDivElement;
	value = 0;
	max = 1;
	dragging = false;
	private disabled = false;
	private text = '';
	private shown = '';
	private shownBuffer = '';
	private readonly tip: HTMLDivElement | null = null;

	constructor(private readonly o: SliderOptions) {
		const el = (this.el = h('div', 'slider' + (o.cls ? ' ' + o.cls : ''), {
			role: 'slider',
			tabindex: '0',
			'aria-label': o.label,
			'aria-valuemin': '0',
			'aria-orientation': 'horizontal',
			part: o.part + '-slider',
		}));
		const part = (name: string) => ({ part: o.part + '-' + name });
		el.append(
			h('div', 'slider-track', part('track'), [
				h('div', 'slider-buffer', part('buffer')),
				h('div', 'slider-hover', part('hover')),
				h('div', 'slider-range', part('range')),
			]),
			h('div', 'slider-thumb', part('thumb')),
		);
		if (o.hover) {
			this.tip = h('div', 'slider-tip', { 'aria-hidden': 'true', part: o.part + '-tooltip' });
			el.appendChild(this.tip);
		}
		el.addEventListener('pointerdown', (e) => this.down(e));
		el.addEventListener('pointermove', (e) => this.move(e));
		el.addEventListener('pointerup', (e) => this.up(e));
		el.addEventListener('pointercancel', (e) => this.up(e));
		el.addEventListener('lostpointercapture', (e) => this.up(e));
		el.addEventListener('pointerleave', () => el.classList.remove('hovering'));
		el.addEventListener('keydown', (e) => this.key(e));
		this.render();
	}

	set(value: number, max = this.max): void {
		this.max = max > 0 ? max : 1;
		if (!this.dragging) this.value = clamp(value, 0, this.max);
		this.render();
	}

	setBuffered(value: number): void {
		const b = step(value / this.max);
		if (b !== this.shownBuffer) {
			this.shownBuffer = b;
			this.el.style.setProperty('--b', b);
		}
	}

	setDisabled(disabled: boolean): void {
		if (disabled === this.disabled) return;
		this.disabled = disabled;
		if (disabled) {
			this.el.setAttribute('aria-disabled', 'true');
			this.dragging = false;
		} else {
			this.el.removeAttribute('aria-disabled');
		}
	}

	private render(): void {
		const el = this.el;
		const p = step(this.value / this.max);
		if (p !== this.shown) {
			this.shown = p;
			el.style.setProperty('--p', p);
		}
		// Update ARIA only when the spoken value changes, not on every frame.
		const text = this.o.text(this.value);
		if (text !== this.text) {
			this.text = text;
			el.setAttribute('aria-valuemax', String(Math.round(this.max * 100) / 100));
			el.setAttribute('aria-valuenow', String(Math.round(this.value * 100) / 100));
			el.setAttribute('aria-valuetext', text);
		}
	}

	/** Value at a pointer x position, accounting for the thumb staying inside the track. */
	private at(clientX: number): number {
		const r = this.el.getBoundingClientRect();
		const thumb = this.el.querySelector('.slider-thumb') as HTMLElement;
		const t = thumb.offsetWidth || 0;
		const frac = r.width > t ? (clientX - r.left - t / 2) / (r.width - t) : 0;
		return clamp(frac, 0, 1) * this.max;
	}

	private down(e: PointerEvent): void {
		if (this.disabled || e.button !== 0) return;
		e.preventDefault();
		this.el.focus({ preventScroll: true });
		try {
			this.el.setPointerCapture(e.pointerId);
		} catch (err) {
			// Capture is a nicety, dragging still works inside the element.
		}
		this.dragging = true;
		this.el.classList.add('dragging');
		this.update(this.at(e.clientX));
		this.showTip(e.clientX);
	}

	private move(e: PointerEvent): void {
		if (this.disabled) return;
		if (this.dragging) {
			this.update(this.at(e.clientX));
		}
		if (e.pointerType !== 'touch' || this.dragging) this.showTip(e.clientX);
	}

	private up(e: PointerEvent): void {
		if (!this.dragging) return;
		this.dragging = false;
		this.el.classList.remove('dragging');
		if (e.pointerType === 'touch') this.el.classList.remove('hovering');
		if (this.o.commit) this.o.commit(this.value);
	}

	private showTip(clientX: number): void {
		if (!this.tip || !this.o.hover) return;
		const r = this.el.getBoundingClientRect();
		const v = this.dragging ? this.value : this.at(clientX);
		const x = this.dragging ? this.thumbCenter() : clamp(clientX - r.left, 0, r.width);
		this.tip.textContent = this.o.hover(v);
		this.el.style.setProperty('--x', x + 'px');
		this.el.style.setProperty('--h', String(v / this.max));
		this.el.classList.add('hovering');
	}

	private thumbCenter(): number {
		const thumb = this.el.querySelector('.slider-thumb') as HTMLElement;
		const t = thumb.offsetWidth || 0;
		return t / 2 + (this.value / this.max) * (this.el.clientWidth - t);
	}

	private update(v: number): void {
		this.value = clamp(v, 0, this.max);
		this.render();
		this.o.input(this.value);
	}

	private key(e: KeyboardEvent): void {
		if (this.disabled) return;
		const { step, page } = this.o;
		let v: number;
		switch (e.key) {
			case 'ArrowLeft':
			case 'ArrowDown':
				v = this.value - step;
				break;
			case 'ArrowRight':
			case 'ArrowUp':
				v = this.value + step;
				break;
			case 'PageDown':
				v = this.value - page;
				break;
			case 'PageUp':
				v = this.value + page;
				break;
			case 'Home':
				v = 0;
				break;
			case 'End':
				v = this.max;
				break;
			default:
				return;
		}
		e.preventDefault();
		e.stopPropagation();
		this.update(v);
		if (this.o.commit) this.o.commit(this.value);
	}
}
