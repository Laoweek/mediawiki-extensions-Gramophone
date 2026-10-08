// Checks the interface messages of the client against extension.json and i18n/ (see
// docs/contract.md, Messages):
//
// - every key of a t() call in src/ has a FALLBACK text in src/i18n.ts, and every FALLBACK key is used
// - every used key is listed under `messages` of exactly one module: ext.gramophone when code in
//   that module uses it, otherwise ext.gramophone.player. A module lists no key that its code does not use.
// - every used key has English text (i18n/en.json) and documentation (i18n/qqq.json), and every
//   English key is documented. Translations (zh-hans, zh-hant) may lag behind.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.resolve(here, '..');
const repo = path.resolve(client, '..');
const json = async (file) => JSON.parse(await readFile(path.join(repo, file), 'utf8'));
const problems = [];

// The source files of each module, as build.mjs bundles them: ext.gramophone.player takes the
// files that ext.gramophone already has from ext.gramophone.
async function inputs(entry) {
	const { metafile } = await esbuild.build({ entryPoints: [path.join(client, 'src', entry)], bundle: true, write: false, metafile: true, outdir: 'out', loader: { '.css': 'empty' }, logLevel: 'error' });
	return Object.keys(metafile.inputs).filter((f) => f.endsWith('.ts')).map((f) => path.resolve(f));
}
const base = await inputs('index.ts');
const MODULES = { 'ext.gramophone': base, 'ext.gramophone.player': (await inputs('players.ts')).filter((f) => !base.includes(f)) };

// The string literals 'gramophone-...' inside the parentheses of each t( call.
function calledKeys(code) {
	const keys = new Set();
	for (const m of code.matchAll(/\bt\(/g)) {
		let i = m.index + 1;
		for (let depth = 0; i < code.length; i++) {
			if (code[i] === '(') depth++;
			else if (code[i] === ')' && --depth === 0) break;
		}
		for (const k of code.slice(m.index, i).matchAll(/'(gramophone-[\w-]+)'/g)) keys.add(k[1]);
	}
	return keys;
}

const usedBy = new Map();
for (const [module, files] of Object.entries(MODULES)) {
	for (const file of files) {
		for (const key of calledKeys(await readFile(file, 'utf8'))) {
			if (!usedBy.has(key)) usedBy.set(key, new Set());
			usedBy.get(key).add(module);
		}
	}
}

const i18n = await readFile(path.join(client, 'src/i18n.ts'), 'utf8');
const fallback = new Set([...i18n.slice(i18n.indexOf('const FALLBACK')).split('};')[0].matchAll(/^\s*'(gramophone-[\w-]+)':/gm)].map((m) => m[1]));
for (const key of usedBy.keys()) if (!fallback.has(key)) problems.push(`${key} is used in src/ but has no FALLBACK text in src/i18n.ts`);
for (const key of fallback) if (!usedBy.has(key)) problems.push(`${key} has a FALLBACK text in src/i18n.ts but no t() call uses it`);

const modules = (await json('extension.json')).ResourceModules;
const en = await json('i18n/en.json');
const qqq = await json('i18n/qqq.json');
for (const [key, users] of usedBy) {
	const want = users.has('ext.gramophone') ? 'ext.gramophone' : 'ext.gramophone.player';
	const listed = Object.keys(MODULES).filter((m) => (modules[m].messages || []).includes(key));
	if (listed.join() !== want) problems.push(`${key} is used by ${[...users].join(' and ')}: list it under messages of ${want} in extension.json${listed.length ? `, not ${listed.join(' and ')}` : ''}`);
	if (!(key in en)) problems.push(`${key} is used in src/ but missing from i18n/en.json`);
}
for (const module of Object.keys(MODULES)) {
	for (const key of modules[module].messages || []) if (!usedBy.has(key)) problems.push(`${key} is listed under messages of ${module} in extension.json but no t() call uses it`);
}
for (const key of Object.keys(en)) if (key !== '@metadata' && !(key in qqq)) problems.push(`${key} is in i18n/en.json but has no documentation in i18n/qqq.json`);

for (const p of problems) console.error(`FAIL: ${p}`);
if (problems.length) process.exit(1);
console.log(`OK: ${usedBy.size} client messages are in FALLBACK, listed in their module in extension.json, and in en.json and qqq.json`);
