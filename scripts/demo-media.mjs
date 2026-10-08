// The songs that the demo page (client/demo/) and the dev wiki (dev/) play.
//
// The audio is Apple Music's 30-second preview of each song and the pictures are its cover art,
// found through the iTunes Search API. They belong to the artists and labels, so they are not
// committed: this script downloads them into a gitignored folder for local demos and checks.
// Every track links to its Apple Music page.
//
//   node scripts/demo-media.mjs <folder> [--force]
//
// writes <slug>.m4a for each song and <cover>.jpg for each cover into <folder>. Files that are
// already there are kept unless --force is given. Importing this module downloads nothing.
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALBUM_URL = 'https://music.apple.com/us/album/galaxy-triangle/1550726371';

/** The full album: Galaxy Triangle by La prière (2020). */
export const ALBUM = {
	title: 'Galaxy Triangle',
	artist: 'La prière',
	year: 2020,
	cover: 'galaxy-triangle',
	url: ALBUM_URL,
	tracks: [
		[1550726374, 'div-a3', 'Div.A3'],
		[1550726375, 'diva-of-the-battlefield', 'Diva of the Battlefield'],
		[1550726676, 'testament-of-the-twin-stars', 'Testament of the Twin Stars'],
		[1550726677, 'ripple', 'Ripple'],
		[1550726679, 'driven-star-with-you', 'Driven Star With You'],
		[1550726680, 'galactic-love', 'Galactic Love'],
		[1550726681, 'e-div', 'E Div.'],
	].map(([id, slug, title], i) => ({
		id, slug, title, number: i + 1, artist: 'La prière', album: 'Galaxy Triangle',
		cover: 'galaxy-triangle', url: `${ALBUM_URL}?i=${id}`,
	})),
};

/** The song with lyrics: Bubblin' by HIMEHINA (2025). */
export const LYRICS_SONG = {
	id: 1818284945, slug: 'bubblin', title: 'Bubblin\'', artist: 'HIMEHINA', album: 'Bubblin',
	cover: 'bubblin', url: 'https://music.apple.com/us/album/bubblin/1818284776?i=1818284945',
};

/** The single song: Mukyu Platonic by VALIS (2023). */
export const SINGLE = {
	id: 1678711098, slug: 'mukyu-platonic', title: 'Mukyu Platonic', artist: 'VALIS',
	album: 'Mukyu Platonic - Single', cover: 'mukyu-platonic',
	url: 'https://music.apple.com/us/album/mukyu-platonic/1678711097?i=1678711098',
};

export const SONGS = [...ALBUM.tracks, LYRICS_SONG, SINGLE];

/** A line for credits next to the demos. */
export const CREDITS = 'Music: "Galaxy Triangle" by La prière, "Bubblin\'" by HIMEHINA and "Mukyu Platonic" by VALIS. '
	+ '30-second previews and cover art from Apple Music, owned by the artists and their labels.';

// Downloads go only to Apple's hosts, whatever the lookup answers.
const ALLOWED_HOSTS = /(^|\.)(apple\.com|mzstatic\.com)$/;

async function download(url, file, type, force) {
	if (!force && (await stat(file).catch(() => null))?.size > 0) {
		return false;
	}
	const { hostname, protocol } = new URL(url);
	if (protocol !== 'https:' || !ALLOWED_HOSTS.test(hostname)) {
		throw new Error(`refusing to download ${url}`);
	}
	const response = await fetch(url);
	if (!response.ok || !(response.headers.get('content-type') || '').startsWith(type)) {
		throw new Error(`${url}: HTTP ${response.status} ${response.headers.get('content-type')}`);
	}
	await writeFile(file + '.part', Buffer.from(await response.arrayBuffer()));
	await rename(file + '.part', file);
	return true;
}

/** Download every preview and cover into folder. Resolves to the number of files written. */
export async function fetchMedia(folder, { force = false } = {}) {
	await mkdir(folder, { recursive: true });
	const lookup = await fetch(`https://itunes.apple.com/lookup?country=us&id=${SONGS.map((s) => s.id).join(',')}`);
	if (!lookup.ok) {
		throw new Error(`iTunes lookup: HTTP ${lookup.status}`);
	}
	const found = new Map((await lookup.json()).results.map((r) => [r.trackId, r]));
	let written = 0;
	const covers = new Set();
	for (const song of SONGS) {
		const result = found.get(song.id);
		if (!result?.previewUrl || !result.artworkUrl100) {
			throw new Error(`iTunes lookup has no preview or cover for ${song.title} (${song.id})`);
		}
		written += await download(result.previewUrl, path.join(folder, `${song.slug}.m4a`), 'audio/', force);
		if (!covers.has(song.cover)) {
			covers.add(song.cover);
			const cover = result.artworkUrl100.replace(/\/100x100bb\.jpg$/, '/600x600bb.jpg');
			written += await download(cover, path.join(folder, `${song.cover}.jpg`), 'image/', force);
		}
	}
	return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const folder = process.argv.slice(2).find((a) => !a.startsWith('--'));
	if (!folder) {
		console.error('usage: node scripts/demo-media.mjs <folder> [--force]');
		process.exit(2);
	}
	const written = await fetchMedia(path.resolve(folder), { force: process.argv.includes('--force') });
	console.log(`demo-media: ${written} file(s) downloaded into ${folder}, the rest were already there`);
}
