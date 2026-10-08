/**
 * LRC lyrics: fetch on demand (abortable), decode UTF-8 with a GB18030
 * fallback for older Chinese files, and parse lines with one or more
 * [mm:ss.xx] timestamps. Later lines that repeat a timestamp are its
 * translations. Plain text without timestamps is shown unsynced.
 * A file over MAX_BYTES is refused, and at most MAX_ENTRIES lines and
 * translations with MAX_CHARS characters in all are kept, so a huge file
 * cannot freeze the page.
 */

export interface LyricLine {
	/** Seconds from the start of the track, before the per-track offset. */
	time: number;
	text: string;
	/** Non-empty later lines with the same timestamp, in file order. */
	translations?: string[];
}

export interface Lyrics {
	lines: LyricLine[];
	synced: boolean;
}

const TIME = /^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/;
/** Largest lyrics file read, in bytes. */
export const MAX_BYTES = 1024 * 1024;
/** Most lines plus translations kept from one file. */
export const MAX_ENTRIES = 5000;
/** Most characters kept from one file, over all its lines and translations: one line can carry thousands of timestamps. */
export const MAX_CHARS = 1024 * 1024;
const cache = new Map<string, Lyrics>();

export function parseLrc(source: string): Lyrics {
	const byTime = new Map<number, LyricLine>();
	const plain: string[] = [];
	let offset = 0;
	let entries = 0;
	let chars = 0;
	let full = false;
	/** Counts text that is about to be kept. False, and nothing more is kept, once a limit is passed. */
	const keep = (text: string, entry: boolean): boolean => {
		if (entry) entries++;
		chars += text.length;
		full = full || entries > MAX_ENTRIES || chars > MAX_CHARS;
		return !full;
	};
	for (const raw of source.split(/\r\n|\r|\n/)) {
		if (full) break;
		let rest = raw.trim();
		const stamps: number[] = [];
		let tag: RegExpExecArray | null;
		let meta = false;
		while ((tag = /^\[([^\]]*)\]/.exec(rest))) {
			const inner = tag[1].trim();
			const m = TIME.exec(inner);
			if (m) {
				const frac = m[3] ? parseInt(m[3], 10) / Math.pow(10, m[3].length) : 0;
				stamps.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac);
			} else {
				meta = true;
				const off = /^offset:\s*([+-]?\d+)$/i.exec(inner);
				// LRC convention: a positive [offset] shows lyrics earlier.
				if (off) offset = parseInt(off[1], 10) / 1000;
			}
			rest = rest.slice(tag[0].length);
		}
		// Enhanced LRC word timings: <mm:ss.xx>
		const text = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
		if (stamps.length) {
			for (const s of stamps) {
				const line = byTime.get(s);
				if (!line) {
					if (!keep(text, true)) break;
					byTime.set(s, { time: s, text });
				}
				// An empty line (a gap) gives way to the first real line at its time.
				else if (!line.text) {
					if (!keep(text, false)) break;
					line.text = text;
				} else if (text) {
					if (!keep(text, true)) break;
					(line.translations || (line.translations = [])).push(text);
				}
			}
		} else if (!meta && text) {
			if (!keep(text, true)) break;
			plain.push(text);
		}
	}
	if (byTime.size) {
		const timed = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
		if (offset) for (const l of timed) l.time = Math.max(0, l.time - offset);
		return { lines: timed, synced: true };
	}
	return { lines: plain.map((text) => ({ time: 0, text })), synced: false };
}

function decode(buf: ArrayBuffer): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(buf);
	} catch (e) {
		try {
			return new TextDecoder('gb18030').decode(buf);
		} catch (err) {
			return new TextDecoder().decode(buf);
		}
	}
}

/** The response body, or an error when it is larger than max bytes. Stops reading at max. */
export async function readCapped(res: Response, max: number): Promise<ArrayBuffer> {
	const tooLarge = () => new Error('larger than ' + max + ' bytes');
	if (Number(res.headers.get('Content-Length')) > max) throw tooLarge();
	const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
	if (!reader) {
		const buf = await res.arrayBuffer();
		if (buf.byteLength > max) throw tooLarge();
		return buf;
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			// Cancelling the stream also stops the download.
			reader.cancel().catch(() => undefined);
			throw tooLarge();
		}
		chunks.push(value);
	}
	const out = new Uint8Array(size);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.byteLength;
	}
	return out.buffer;
}

export async function loadLyrics(url: string, signal: AbortSignal): Promise<Lyrics> {
	const hit = cache.get(url);
	if (hit) return hit;
	const res = await fetch(url, { signal, credentials: 'same-origin' });
	if (!res.ok) throw new Error('HTTP ' + res.status);
	const lyrics = parseLrc(decode(await readCapped(res, MAX_BYTES)));
	if (!lyrics.lines.length) throw new Error('empty');
	cache.set(url, lyrics);
	return lyrics;
}

/** Index of the last line whose time is <= t, or -1. */
export function activeLine(lines: LyricLine[], t: number): number {
	let lo = 0;
	let hi = lines.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (lines[mid].time <= t) {
			found = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return found;
}
