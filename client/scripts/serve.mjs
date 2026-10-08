// Tiny static file server for the demo, with HTTP Range support so audio
// seeking works. Serves the repository root (so both client/demo and the
// extension's resources/ are reachable).
//
//   node scripts/serve.mjs [port]      then open http://localhost:8765/client/demo/
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchMedia, SONGS } from '../../scripts/demo-media.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MEDIA = path.join(ROOT, 'client/demo/media');
const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.mp3': 'audio/mpeg',
	'.m4a': 'audio/mp4',
	'.ogg': 'audio/ogg',
	'.lrc': 'text/plain',
};

/**
 * Downloads the song previews and covers that the demo plays into demo/media/ (gitignored) when
 * one of them is missing. Needs the network only then.
 */
export async function ensureMedia() {
	const files = [...SONGS.map((s) => `${s.slug}.m4a`), ...new Set(SONGS.map((s) => `${s.cover}.jpg`))];
	const missing = await Promise.all(files.map((f) => stat(path.join(MEDIA, f)).then((i) => !i.size, () => true)));
	if (!missing.includes(true)) return;
	console.log(`Downloading the demo media into ${path.relative(process.cwd(), MEDIA)}/ (scripts/demo-media.mjs)`);
	await fetchMedia(MEDIA);
}

export function startServer(port = 8765) {
	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url, 'http://localhost');
			let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
			// The separator keeps out sibling folders whose name starts with ROOT's.
			if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
				res.writeHead(403).end();
				return;
			}
			let info = await stat(file).catch(() => null);
			if (info && info.isDirectory()) {
				file = path.join(file, 'index.html');
				info = await stat(file).catch(() => null);
			}
			if (!info) {
				res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
				return;
			}
			const headers = {
				'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
				'Accept-Ranges': 'bytes',
				'Cache-Control': 'no-store',
			};
			const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
			if (range) {
				const start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
				const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
				if (start > end || start >= info.size) {
					res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
					return;
				}
				res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
				createReadStream(file, { start, end }).pipe(res);
				return;
			}
			res.writeHead(200, { ...headers, 'Content-Length': info.size });
			if (req.method === 'HEAD') res.end();
			else createReadStream(file).pipe(res);
		} catch (e) {
			res.writeHead(500).end(String(e));
		}
	});
	return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const port = Number(process.argv[2]) || 8765;
	await ensureMedia();
	await startServer(port);
	console.log(`Serving ${ROOT} at http://localhost:${port}/client/demo/`);
}
