// Ad hoc screenshot helper for design iteration.
//   node scripts/shot.mjs <path?query> <out.png> [width] [selector] [--eval file.js]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { startServer } from './serve.mjs';

const [, , page = '/client/demo/', out = 'demo/screenshots/shot.png', width = '1280', selector, ...rest] = process.argv;
const evalIdx = rest.indexOf('--eval');
const server = await startServer(8766);
// Playwright browser channel: Google Chrome by default, `msedge` also works. Playwright's bundled
// Chromium (`chromium`) cannot play the AAC previews in demo/media/.
const browser = await chromium.launch({ channel: process.env.GRAMOPHONE_BROWSER_CHANNEL || 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' });
const p = await ctx.newPage();
const logs = [];
p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await p.goto('http://127.0.0.1:8766' + page, { waitUntil: 'load' });
await p.waitForTimeout(800);
let result = null;
if (evalIdx >= 0) result = await p.evaluate(readFileSync(rest[evalIdx + 1], 'utf8'));
if (selector && selector !== '-') await (await p.$(selector)).screenshot({ path: out });
else await p.screenshot({ path: out, fullPage: false });
console.log(JSON.stringify({ result, logs }, null, 1));
await browser.close();
server.close();
