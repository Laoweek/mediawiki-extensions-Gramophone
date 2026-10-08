// Verifies the built modules: each must parse as ES2017 (the syntax level
// MediaWiki 1.43's ResourceLoader minifier supports) inside ResourceLoader's
// packageFiles wrapper, ext.gramophone.player may take shared code only from ext.gramophone,
// and sizes are reported.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import * as acorn from 'acorn';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../resources/dist');
const kb = (n) => (n / 1024).toFixed(1) + ' KiB';
let failed = false;

for (const [name, file, deps] of [
	['ext.gramophone', 'gramophone.js', []],
	['ext.gramophone.player', 'gramophone.player.js', ['ext.gramophone']],
]) {
	const full = path.join(dist, file);
	const rel = path.relative(process.cwd(), full);
	const code = await readFile(full, 'utf8');
	try {
		// ResourceLoader runs a package file as function ( require, module, exports ) { ... }.
		acorn.parse(`(function (require, module, exports) {\n${code}\n})`, { ecmaVersion: 2017, sourceType: 'script' });
	} catch (e) {
		console.error(`FAIL: ${rel} is not valid ES2017: ${e.message}`);
		failed = true;
		continue;
	}
	if (/[^\x00-\x7f]/.test(code)) {
		console.error(`FAIL: ${rel} contains non-ASCII characters`);
		failed = true;
	}
	const required = [...new Set([...code.matchAll(/\brequire\(("[^"]*")\)/g)].map((m) => JSON.parse(m[1])))];
	if (required.join() !== deps.join()) {
		console.error(`FAIL: ${rel} requires ${JSON.stringify(required)}, expected ${JSON.stringify(deps)}`);
		failed = true;
	}
	const min = (await esbuild.transform(code, { minify: true, target: 'es2017', legalComments: 'none' })).code;
	console.log(`${name} (${file}): shipped ${kb(code.length)} (gzip ${kb(gzipSync(code).length)}), minified ${kb(min.length)} (gzip ${kb(gzipSync(min).length)})`);
}
if (failed) process.exit(1);
console.log('OK: both modules parse as ES2017, ASCII only, ext.gramophone.player requires only ext.gramophone');
