/**
 * Custom colours from the wikitext (bg=, text=, tracker=, track= and the
 * modernsoundmanager colour fields). A custom background or text colour
 * replaces the whole palette, computed here in plain sRGB math so it works
 * without CSS color-mix() and wins over the light and dark theme tokens
 * (inline style). Every text colour is checked for contrast.
 */
import type { Colors } from './config';

type RGB = [number, number, number];

const WHITE = '#ffffff';
const INK = '#18181b';
const NIGHT = '#1c1c1f';

function rgb(hex: string): RGB {
	const n = parseInt(hex.slice(1), 16);
	return [n >> 16, (n >> 8) & 255, n & 255];
}

/** Blend a over b with weight w (0..1) of a. */
export function mix(a: string, b: string, w: number): string {
	const x = rgb(a);
	const y = rgb(b);
	return '#' + x.map((v, i) => Math.round(v * w + y[i] * (1 - w)).toString(16).padStart(2, '0')).join('');
}

function luminance(hex: string): number {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	const [r, g, b] = rgb(hex);
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
	const x = luminance(a);
	const y = luminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** True when white text reads better than near-black text on this colour. */
export function isDark(hex: string): boolean {
	return luminance(hex) < 0.179;
}

/** White or near-black, whichever contrasts more with the colour. */
function readable(on: string): string {
	return contrast(WHITE, on) >= contrast(INK, on) ? WHITE : INK;
}

/** A neutral background for a custom text colour: white or the dark card colour. */
export function backgroundFor(fg: string): string {
	return contrast(fg, WHITE) >= contrast(fg, NIGHT) ? WHITE : NIGHT;
}

/** The first blend of fg into bg, from weight w up, that reaches the ratio on every surface. */
function blendTo(fg: string, bg: string, w: number, ratio: number, surfaces: string[]): string {
	for (; w < 1; w += 0.04) {
		const c = mix(fg, bg, w);
		if (surfaces.every((x) => contrast(c, x) >= ratio)) return c;
	}
	return fg;
}

/** The --gramophone-* properties to set inline on a full player host. */
export function palette(c: Colors): Record<string, string> {
	const out: Record<string, string> = {};
	if (c.track) out['--gramophone-range'] = c.track;
	if (c.thumb) out['--gramophone-thumb'] = c.thumb;
	if (!c.background && !c.foreground) return out;
	// A text colour without a background gets a neutral background it reads on.
	const bg = c.background || backgroundFor(c.foreground as string);
	const fg = c.foreground || (contrast('#fafafa', bg) >= contrast(INK, bg) ? '#fafafa' : INK);
	// Hover, selected rows and toggles get a neutral tint (a tint of the
	// accent can turn muddy, yellow on blue). It leans toward the text colour,
	// or away from it when that would cost the text its contrast.
	const lean = contrast(fg, mix(fg, bg, 0.14)) >= 4.5 ? fg : readable(fg);
	let soft = mix(lean, bg, 0.14);
	let hover = mix(lean, bg, 0.08);
	// Text that barely reads on the background gets no tint at all.
	if (contrast(fg, soft) < 4.5) soft = hover = bg;
	const surfaces = [bg, soft, hover];
	const track = blendTo(fg, bg, 0.22, 1.5, [bg]);
	Object.assign(out, {
		'--gramophone-background': bg,
		'--gramophone-foreground': fg,
		'--gramophone-muted': hover,
		'--gramophone-muted-foreground': blendTo(fg, bg, 0.66, 4.5, surfaces),
		'--gramophone-border': mix(fg, bg, 0.18),
		'--gramophone-accent': hover,
		'--gramophone-accent-foreground': fg,
		'--gramophone-primary-soft': soft,
		'--gramophone-track': track,
		'--gramophone-buffered': mix(fg, track, 0.22),
		'--gramophone-destructive': ['#dc2626', '#f87171', '#fca5a5'].find((x) => contrast(x, bg) >= 4.5) || fg,
		'--gramophone-cover-from': mix(fg, bg, 0.24),
		'--gramophone-cover-to': mix(fg, bg, 0.08),
		'--gramophone-cover-foreground': fg,
	});
	// Accent: the first author colour that stands out from the background and
	// the selected tint. With only a text colour, the theme accent stays (it
	// suits both neutral backgrounds).
	const candidates = [c.track, c.thumb, c.background ? fg : null];
	const accent =
		candidates.find((x): x is string => !!x && surfaces.every((y) => contrast(x, y) >= 3)) || (c.background ? readable(bg) : '');
	if (!accent) {
		out['--gramophone-highlight'] = fg;
		return out;
	}
	const onAccent = contrast(bg, accent) >= 4.5 ? bg : readable(accent);
	Object.assign(out, {
		'--gramophone-primary': accent,
		'--gramophone-primary-foreground': onAccent,
		'--gramophone-primary-hover': mix(accent, onAccent, 0.86),
		'--gramophone-highlight': [accent, fg].find((x) => contrast(x, soft) >= 4.5) || fg,
		'--gramophone-ring': accent,
		'--gramophone-range': c.track && contrast(c.track, bg) >= 1.5 ? c.track : accent,
	});
	return out;
}

export function applyColors(host: HTMLElement, c: Colors): void {
	const p = palette(c);
	for (const k in p) host.style.setProperty(k, p[k]);
}
