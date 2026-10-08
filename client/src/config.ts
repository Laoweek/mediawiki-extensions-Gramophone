/**
 * Reads the data-mw-gramophone JSON that the parser tags emit. Every field is
 * optional here: unknown or wrongly typed values fall back to defaults so a
 * malformed host never throws. Version 2 leaves out keys at their default.
 */
import { t } from './i18n';

export type Mode = 'player' | 'button';

export interface Track {
	src: string;
	title: string;
	artist: string;
	album: string;
	explicit: boolean;
	cover: string;
	lyrics: string;
	/** Milliseconds added to every LRC timestamp. */
	lyricsOffset: number;
	link: string;
	missing: boolean;
	/** hidemissing: check with a HEAD request whether the file exists (exists.ts). */
	verify: boolean;
	/** Links to this track's URLs on another site get rel="nofollow". */
	nofollow: boolean;
}

export interface Colors {
	background: string | null;
	foreground: string | null;
	track: string | null;
	thumb: string | null;
}

export interface Config {
	mode: Mode;
	autoPlay: boolean;
	loop: boolean;
	playlistOpen: boolean;
	/** Button only: hide it when none of its files exist (`hidemissing=yes`). */
	hideMissing: boolean;
	colors: Colors;
	tracks: Track[];
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0);
const color = (v: unknown): string | null =>
	typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;

/** Accepts http(s), protocol-relative and relative URLs. Anything else becomes ''. */
export function safeUrl(v: unknown): string {
	const s = str(v);
	if (!s) return '';
	try {
		const u = new URL(s, location.href);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
	} catch (e) {
		return '';
	}
}

function fileName(src: string): string {
	try {
		const path = new URL(src, location.href).pathname;
		return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
	} catch (e) {
		return '';
	}
}

function track(raw: Json): Track {
	const src = safeUrl(raw.src);
	const missing = raw.missing === true || !src;
	return {
		src: missing ? '' : src,
		// fileName('') would name the track after the page URL.
		title: str(raw.title) || (src && fileName(src)) || t('gramophone-unknown-title'),
		artist: str(raw.artist),
		album: str(raw.album),
		explicit: raw.explicit === true,
		cover: safeUrl(raw.cover),
		lyrics: safeUrl(raw.lyrics),
		lyricsOffset: num(raw.lyricsOffset),
		link: safeUrl(raw.link),
		missing,
		verify: raw.verify === true,
		nofollow: raw.nofollow === true,
	};
}

export function parseConfig(host: Element): Config | null {
	let data: unknown;
	try {
		data = JSON.parse(host.getAttribute('data-mw-gramophone') || '');
	} catch (e) {
		return null;
	}
	if (!isObj(data)) return null;
	const colors = isObj(data.colors) ? data.colors : {};
	const mode: Mode =
		data.mode === 'button' || (data.mode !== 'player' && host.classList.contains('ext-gramophone-button'))
			? 'button'
			: 'player';
	const tracks = Array.isArray(data.tracks) ? data.tracks.filter(isObj).map(track) : [];
	return {
		mode,
		autoPlay: mode === 'player' && data.autoPlay === true,
		loop: mode === 'player' && data.loop === true,
		playlistOpen: mode === 'player' && data.playlistOpen === true,
		hideMissing: mode === 'button' && data.hideMissing === true,
		colors: {
			background: color(colors.background),
			foreground: color(colors.foreground),
			track: color(colors.track),
			thumb: color(colors.thumb),
		},
		tracks,
	};
}
