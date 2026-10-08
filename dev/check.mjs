#!/usr/bin/env node
// Browser checks for the Gramophone dev wiki. They cover what only a real MediaWiki and a real
// browser can show: the modules load, every host hydrates, nothing loads before a click, the skins
// lay the hosts out without overflow, and playback and lyrics work against the wiki's own uploads,
// a CORS mirror and a third-party host. The parser tests pin the markup and the data, the client
// checks pin the player UI. See dev/README.md.
//
//   node check.mjs                                   every page, scenarios vector and citizen-mobile-night
//   node check.mjs --pages=Bubblin,Previews          pages whose title contains one of these
//   node check.mjs --scenarios=vector,minerva-mobile
//   node check.mjs --no-interact --no-shots --headed
//
// Prints one line per check, writes screenshots/<page>-<scenario>.png and screenshots/summary.json,
// and exits with 1 when a check fails.
import { chromium, devices } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV = dirname( fileURLToPath( import.meta.url ) );
const args = Object.fromEntries( process.argv.slice( 2 ).map( ( a ) => {
	const [ k, v ] = a.replace( /^--/, '' ).split( '=' );
	return [ k, v ?? true ];
} ) );
const BASE = String( args.base || process.env.GRAMOPHONE_DEV_SERVER || 'http://localhost:8143' );
// Playwright browser channel: Google Chrome by default, `chromium` or `msedge` also work.
const CHANNEL = process.env.GRAMOPHONE_BROWSER_CHANNEL || 'chrome';
const SHOTS = join( DEV, 'screenshots' );
const PAGES = [ 'Main Page', 'Galaxy Triangle', 'Bubblin\'', 'VALIS', 'Previews', 'Sm2Shim compatibility' ];
// Pages with play buttons only: ext.gramophone.player must not load there.
const BUTTONS_ONLY = [ 'Previews' ];
const DESKTOP = { viewport: { width: 1280, height: 900 } };
const MOBILE = { viewport: { width: 375, height: 812 }, userAgent: devices[ 'iPhone 13' ].userAgent, isMobile: true, hasTouch: true };
const SCENARIOS = {
	vector: { ...DESKTOP },
	// Citizen keeps the theme in localStorage (core skins use the mwclientpreferences cookie).
	'citizen-mobile-night': { ...MOBILE, colorScheme: 'dark', clientPrefs: 'skin-theme-clientpref-night' },
	'minerva-mobile': { ...MOBILE, query: { useskin: 'minerva' } }
};
const pageNames = args.pages ? PAGES.filter( ( p ) => String( args.pages ).split( ',' ).some( ( w ) => p.toLowerCase().includes( w.trim().toLowerCase() ) ) ) : PAGES;
const scenarioNames = args.scenarios ? String( args.scenarios ).split( ',' ) : [ 'vector', 'citizen-mobile-night' ];
if ( !pageNames.length || scenarioNames.some( ( n ) => !SCENARIOS[ n ] ) ) {
	console.error( `check: pick pages from ${ PAGES.join( ', ' ) } and scenarios from ${ Object.keys( SCENARIOS ).join( ', ' ) }` );
	process.exit( 2 );
}

const results = [];
function check( where, name, ok, detail ) {
	results.push( { where, name, ok: !!ok, detail: ok ? undefined : detail } );
	console.log( `${ ok ? 'ok  ' : 'FAIL' } ${ where }: ${ name }${ ok ? '' : `\n     ${ detail }` }` );
}

async function api( params, post = false ) {
	const body = new URLSearchParams( { format: 'json', formatversion: '2', ...params } );
	const res = post ? await fetch( `${ BASE }/api.php`, { method: 'POST', body } ) : await fetch( `${ BASE }/api.php?${ body }` );
	if ( !res.ok ) {
		throw new Error( `API ${ params.action } HTTP ${ res.status }` );
	}
	return res.json();
}

// Line counts of the PHP logs in the wiki container, to find new lines after the run.
function phpLogs() {
	try {
		return Object.fromEntries( execFileSync( 'docker', [ 'compose', 'exec', '-T', 'mediawiki', 'sh', '-c',
			'for f in /var/www/data/logs/*.log; do [ -f "$f" ] && echo "$f $(wc -l < "$f")"; done; true' ],
		{ cwd: DEV, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] } ).split( '\n' ).filter( Boolean ).map( ( l ) => {
			const [ f, n ] = l.split( ' ' );
			return [ f, Number( n ) ];
		} ) );
	} catch {
		return null;
	}
}
function phpLogTail( file, from ) {
	try {
		return execFileSync( 'docker', [ 'compose', 'exec', '-T', 'mediawiki', 'tail', '-n', `+${ from + 1 }`, file ],
			{ cwd: DEV, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] } );
	} catch {
		return '(not readable)';
	}
}

// ------------------------------------------------------------------ in the page
// Runs before any page script. Records every shadow root (closed ones too) with the host's box
// before hydration, and the media elements the client plays, and adds helpers for the checks.
function instrument() {
	const dev = window.__gramophoneDev = { roots: [], media: [] };
	const attach = Element.prototype.attachShadow;
	Element.prototype.attachShadow = function ( init ) {
		const r = this.getBoundingClientRect();
		const root = attach.call( this, init );
		dev.roots.push( { host: this, root, mode: init && init.mode, before: { w: r.width, h: r.height } } );
		return root;
	};
	const play = HTMLMediaElement.prototype.play;
	HTMLMediaElement.prototype.play = function () {
		if ( !dev.media.includes( this ) ) {
			dev.media.push( this );
		}
		return play.apply( this, arguments );
	};
	const decode = ( u ) => {
		try {
			return decodeURI( u );
		} catch ( e ) {
			return u;
		}
	};
	dev.rootOf = ( el ) => el && ( el.shadowRoot || ( dev.roots.find( ( r ) => r.host === el ) || {} ).root ) || null;
	dev.hosts = () => [ ...document.querySelectorAll( '.ext-gramophone' ) ];
	dev.data = ( host ) => {
		try {
			return JSON.parse( host.dataset.mwGramophone );
		} catch ( e ) {
			return { mode: '?', tracks: [] };
		}
	};
	dev.name = ( host ) => {
		const d = dev.data( host );
		return `${ d.mode } "${ d.tracks.map( ( t ) => t.title ).join( ', ' ).slice( 0, 60 ) }"`;
	};
	// Elements in a host's shadow root, also in shadow roots nested in it.
	dev.within = ( host, selector ) => {
		const out = [];
		const walk = ( node ) => node.querySelectorAll( '*' ).forEach( ( el ) => {
			if ( el.matches( selector ) ) {
				out.push( el );
			}
			if ( dev.rootOf( el ) ) {
				walk( dev.rootOf( el ) );
			}
		} );
		if ( dev.rootOf( host ) ) {
			walk( dev.rootOf( host ) );
		}
		return out;
	};
	// The first host of a mode with a track whose fields match spec (regular expressions).
	dev.find = ( spec ) => dev.hosts().find( ( host ) => {
		const d = dev.data( host );
		return d.mode === spec.mode && d.tracks.some( ( t ) => Object.keys( spec ).every( ( k ) => k === 'mode' || new RegExp( spec[ k ] ).test( decode( String( t[ k ] || '' ) ) ) ) );
	} );
	// A label is the message, or the message and the track title ("播放 Ripple"), not "播放列表".
	dev.labelled = ( el, text ) => {
		const l = el.getAttribute( 'aria-label' ) || '';
		return !!text && ( l === text || l.startsWith( text + ' ' ) );
	};
	dev.control = ( spec, text ) => dev.within( dev.find( spec ), 'button' ).find( ( b ) => dev.labelled( b, text ) );
	dev.mediaState = () => dev.media.map( ( m ) => ( { src: decode( m.currentSrc || m.src ), paused: m.paused, t: Math.round( m.currentTime * 10 ) / 10 } ) );
	dev.verify = () => dev.hosts().flatMap( ( h ) => dev.data( h ).tracks.filter( ( t ) => t.verify ).map( ( t ) => new URL( t.src, location.href ).href ) );
}

// State right after hydration: modules, hosts, boxes and labels.
function inspect( play ) {
	const dev = window.__gramophoneDev;
	const hosts = dev.hosts();
	// Hosts laid out when they hydrated and now. Hidden ones (folded section, closed tab) have no box to compare.
	const sized = dev.roots.filter( ( e ) => hosts.includes( e.host ) && e.before.w > 0 && e.host.getBoundingClientRect().width > 0 );
	const resized = sized.map( ( e ) => {
		const r = e.host.getBoundingClientRect();
		const player = e.host.classList.contains( 'ext-gramophone-player' );
		const changed = Math.abs( r.height - e.before.h ) > 2 || ( !player && Math.abs( r.width - e.before.w ) > 2 );
		return changed && `${ dev.name( e.host ) } ${ Math.round( e.before.w ) }x${ Math.round( e.before.h ) } -> ${ Math.round( r.width ) }x${ Math.round( r.height ) }`;
	} ).filter( Boolean );
	const unlabelled = [];
	const notChinese = [];
	for ( const host of hosts.filter( ( h ) => dev.rootOf( h ) ) ) {
		const controls = dev.within( host, 'button, [role="slider"], input' );
		const named = ( c ) => c.getAttribute( 'aria-label' ) || c.getAttribute( 'aria-labelledby' ) || c.getAttribute( 'title' ) || c.textContent.trim();
		unlabelled.push( ...controls.filter( ( c ) => !named( c ) ).map( ( c ) => `${ dev.name( host ) } ${ c.tagName.toLowerCase() }.${ c.className }` ) );
		if ( !controls.some( ( c ) => dev.labelled( c, play ) ) ) {
			notChinese.push( `${ dev.name( host ) }: ${ controls.map( ( c ) => c.getAttribute( 'aria-label' ) ).filter( Boolean ).slice( 0, 3 ).join( ' | ' ) }` );
		}
	}
	return {
		gramophone: mw.loader.getState( 'ext.gramophone' ),
		player: mw.loader.getState( 'ext.gramophone.player' ),
		players: hosts.filter( ( h ) => h.classList.contains( 'ext-gramophone-player' ) ).length,
		hosts: hosts.length,
		hydrated: hosts.filter( ( h ) => dev.rootOf( h ) ).length,
		closed: dev.roots.filter( ( e ) => e.mode === 'closed' ).length,
		sized: sized.length,
		resized,
		unlabelled,
		notChinese,
		verify: dev.verify()
	};
}

// Geometry of the hosts as displayed now. Hosts that are not displayed (closed tab, hidden button) are skipped.
function measure() {
	const dev = window.__gramophoneDev;
	const out = { pageScrollsSideways: document.documentElement.scrollWidth > innerWidth + 1, wide: [], zero: [], strays: [], shown: [], all: [] };
	const stray = ( el ) => el && el.tagName === 'P' && !el.textContent.trim() && !el.querySelector( 'img' ) && el.getBoundingClientRect().height > 0;
	for ( const [ i, host ] of dev.hosts().entries() ) {
		// A hidemissing button that was found missing stays hidden, every other host must show up.
		if ( !host.hidden ) {
			out.all.push( `#${ i } ${ dev.name( host ) }` );
		}
		if ( !host.checkVisibility() ) {
			continue;
		}
		out.shown.push( `#${ i } ${ dev.name( host ) }` );
		const r = host.getBoundingClientRect();
		const p = host.parentElement.getBoundingClientRect();
		if ( r.width === 0 || r.height === 0 ) {
			out.zero.push( dev.name( host ) );
		} else if ( p.width > 0 && r.right > p.right + 1 ) {
			out.wide.push( `${ dev.name( host ) } ${ Math.round( r.width ) }px in ${ Math.round( p.width ) }px` );
		}
		if ( host.classList.contains( 'ext-gramophone-player' ) && ( stray( host.previousElementSibling ) || stray( host.nextElementSibling ) ) ) {
			out.strays.push( dev.name( host ) );
		}
	}
	return out;
}

// ------------------------------------------------------------------ browser helpers
async function openPage( browser, title, scenario ) {
	const { query, clientPrefs, ...options } = SCENARIOS[ scenario ];
	const ctx = await browser.newContext( { locale: 'zh-CN', ...options } );
	if ( clientPrefs ) {
		await ctx.addCookies( [ { name: 'gramophonedevmwclientpreferences', value: clientPrefs, url: BASE } ] );
		await ctx.addInitScript( ( v ) => {
			try {
				localStorage.setItem( 'mwclientpreferences', v );
			} catch ( e ) {}
		}, clientPrefs );
	}
	await ctx.addInitScript( instrument );
	const page = await ctx.newPage();
	const log = watch( page );
	const q = new URLSearchParams( query || {} ).toString();
	const res = await page.goto( `${ BASE }/wiki/${ encodeURIComponent( title.replace( / /g, '_' ) ) }${ q ? `?${ q }` : '' }`, { waitUntil: 'load', timeout: 60000 } );
	return { ctx, page, log, status: res ? res.status() : null };
}

const norm = ( u ) => {
	try {
		return new URL( u, BASE ).href;
	} catch {
		return u;
	}
};

function watch( page ) {
	const log = { errors: [], failed: [], media: [], heads: [], status: {}, lrc: [] };
	page.on( 'console', ( m ) => {
		if ( m.type() === 'error' ) {
			log.errors.push( { text: m.text().slice( 0, 300 ), url: norm( ( m.location() || {} ).url || '' ) } );
		}
	} );
	page.on( 'pageerror', ( e ) => log.errors.push( { text: String( e.message || e ).slice( 0, 300 ), url: '' } ) );
	page.on( 'dialog', ( d ) => {
		log.errors.push( { text: `dialog ${ d.type() }: ${ d.message() }`, url: '' } );
		d.dismiss().catch( () => {} );
	} );
	page.on( 'request', ( r ) => {
		if ( r.method() === 'HEAD' ) {
			log.heads.push( norm( r.url() ) );
		} else if ( r.resourceType() === 'media' || /\.(mp3|m4a|ogg|oga|wav|flac)(\?|$)/i.test( r.url() ) ) {
			log.media.push( r.url() );
		}
	} );
	page.on( 'requestfailed', ( r ) => {
		const error = r.failure() ? r.failure().errorText : '?';
		// Playback and lyrics abort requests they no longer need.
		if ( !/ERR_ABORTED/.test( error ) ) {
			log.failed.push( { status: error, method: r.method(), url: norm( r.url() ) } );
		}
	} );
	page.on( 'response', ( r ) => {
		if ( r.request().method() === 'HEAD' ) {
			log.status[ norm( r.url() ) ] = r.status();
		}
		if ( /\.lrc(\?|$)/i.test( r.url() ) ) {
			log.lrc.push( `${ r.status() } ${ r.url() }` );
		}
		if ( r.status() >= 400 ) {
			log.failed.push( { status: r.status(), method: r.request().method(), url: norm( r.url() ) } );
		}
	} );
	return log;
}

// Problems in the log. A hidemissing check that answers 404 is expected, with its console line.
function problems( log, verify ) {
	const gone = ( f ) => f.method === 'HEAD' && ( f.status === 404 || f.status === 410 ) && verify.includes( f.url );
	const expected = new Set( log.failed.filter( gone ).map( ( f ) => f.url ) );
	return [
		...log.errors.filter( ( e ) => !expected.has( e.url ) ).map( ( e ) => `console: ${ e.text }${ e.url ? ` (${ e.url })` : '' }` ),
		...log.failed.filter( ( f ) => !gone( f ) ).map( ( f ) => `${ f.status } ${ f.method } ${ f.url }` )
	];
}

// Waits until every host has a shadow root (the near ones mount at once, the rest when the browser
// is idle) and the page's other modules have run (MobileFrontend folds its sections only then).
async function hydration( page ) {
	await page.waitForFunction( () => window.mw && mw.loader.getState( 'ext.gramophone' ) === 'ready' &&
		window.__gramophoneDev.hosts().every( ( h ) => window.__gramophoneDev.rootOf( h ) ), null, { timeout: 20000 } ).catch( () => {} );
	await page.evaluate( () => Promise.race( [ mw.loader.using( window.RLPAGEMODULES || [] ).catch( () => {} ),
		new Promise( ( r ) => setTimeout( r, 15000 ) ) ] ) ).catch( () => {} );
}

// Opens MobileFrontend sections and collapsed tables and boxes. Clicks again until the skin's
// scripts have set up the toggles and everything is open.
async function unfold( page ) {
	const folded = '#mw-content-text [aria-expanded="false"][aria-controls^="content-collapsible-block"], .mw-collapsible.mw-collapsed';
	await page.waitForFunction( ( sel ) => {
		const left = document.querySelectorAll( sel );
		left.forEach( ( el ) => {
			const toggle = el.matches( '.mw-collapsible' ) ? el.querySelector( '.mw-collapsible-toggle' ) : el;
			if ( toggle ) {
				toggle.click();
			}
		} );
		return !left.length;
	}, folded, { timeout: 10000, polling: 500 } ).catch( () => {} );
}

// Opens every tab that is closed and measures the hosts in it.
async function measureTabs( page ) {
	const passes = [];
	for ( const tab of await page.$$( '.tabber__tab[aria-selected="false"]' ) ) {
		await tab.click();
		await page.waitForFunction( ( t ) => t.getAttribute( 'aria-selected' ) === 'true' && !document.getElementById( t.getAttribute( 'aria-controls' ) ).hidden, tab, { timeout: 5000 } ).catch( () => {} );
		passes.push( await page.evaluate( measure ) );
	}
	return passes;
}

function merge( passes ) {
	const all = ( k ) => [ ...new Set( passes.flatMap( ( m ) => m[ k ] ) ) ];
	const shown = all( 'shown' );
	return { pageScrollsSideways: passes.some( ( m ) => m.pageScrollsSideways ), wide: all( 'wide' ), zero: all( 'zero' ), strays: all( 'strays' ),
		shown: shown.length, never: passes[ passes.length - 1 ].all.filter( ( h ) => !shown.includes( h ) ) };
}

async function screenshot( page, file ) {
	// Scroll through the page so lazy images load, then wait for every image, also in shadow roots.
	await page.evaluate( async () => {
		const frame = () => new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( r ) ) );
		for ( let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2 ) {
			scrollTo( 0, y );
			await frame();
		}
		scrollTo( 0, 0 );
	} );
	await page.waitForFunction( () => [ ...document.images, ...window.__gramophoneDev.roots.flatMap( ( r ) => [ ...r.root.querySelectorAll( 'img' ) ] ) ]
		.every( ( i ) => i.complete ), null, { timeout: 10000 } ).catch( () => {} );
	// Fixed and sticky skin chrome would be painted over the middle of a full-page screenshot.
	await page.evaluate( () => {
		for ( const el of document.querySelectorAll( 'body *' ) ) {
			if ( !el.closest( '#mw-content-text' ) && /^(fixed|sticky)$/.test( getComputedStyle( el ).position ) ) {
				el.style.setProperty( 'visibility', 'hidden', 'important' );
			}
		}
	} );
	mkdirSync( SHOTS, { recursive: true } );
	await page.screenshot( { path: join( SHOTS, file ), fullPage: true, timeout: 60000 } );
}

// ------------------------------------------------------------------ page runs
async function runPage( browser, title, scenario, play ) {
	const where = `${ title } / ${ scenario }`;
	const { ctx, page, log, status } = await openPage( browser, title, scenario );
	try {
		check( where, 'page returns HTTP 200', status === 200, `HTTP ${ status }` );
		await hydration( page );
		const a = await page.evaluate( inspect, play );
		const buttonsOnly = BUTTONS_ONLY.includes( title );
		check( where, `ext.gramophone is ready, ext.gramophone.player ${ buttonsOnly ? 'is not loaded' : 'is ready' }`,
			a.gramophone === 'ready' && ( buttonsOnly ? a.players === 0 && a.player === 'registered' : a.player === 'ready' ),
			`ext.gramophone ${ a.gramophone }, ext.gramophone.player ${ a.player }, ${ a.players } players` );
		check( where, `every host hydrates (${ a.hydrated }/${ a.hosts }, ${ a.closed } closed roots)`, a.hosts > 0 && a.hydrated === a.hosts,
			`${ a.hosts - a.hydrated } of ${ a.hosts } hosts have no shadow root after 20 s` );
		check( where, `no host changes size on hydration (${ a.sized } measured)`, !a.resized.length, a.resized.join( '; ' ) );
		check( where, `controls are labelled in zh-cn ("${ play }")`, play && !a.unlabelled.length && !a.notChinese.length,
			[ ...a.unlabelled.map( ( u ) => `no name: ${ u }` ), ...a.notChinese.map( ( u ) => `no "${ play }" label: ${ u }` ) ].join( '; ' ) || 'no zh-cn message' );
		await unfold( page );
		const passes = [ await page.evaluate( measure ) ];
		// Before switching tabs: a full-page screenshot resizes the viewport, and TabberNeue then
		// scrolls a tabber that was switched to the wrong panel.
		if ( !args[ 'no-shots' ] ) {
			await screenshot( page, `${ title.replace( /[^A-Za-z0-9]+/g, '_' ).replace( /_$/, '' ) }-${ scenario }.png` );
		}
		const m = merge( [ ...passes, ...await measureTabs( page ) ] );
		check( where, 'no horizontal page scroll', !m.pageScrollsSideways, 'the page is wider than the viewport' );
		check( where, 'no host wider than its container', !m.wide.length, m.wide.join( '; ' ) );
		check( where, `every host shows with a size after opening sections, collapsibles and tabs (${ m.shown } shown)`, !m.zero.length && !m.never.length,
			[ ...m.zero.map( ( h ) => `zero size: ${ h }` ), ...m.never.map( ( h ) => `never displayed: ${ h }` ) ].join( '; ' ) );
		check( where, 'no stray empty paragraph next to a player', !m.strays.length, m.strays.join( '; ' ) );
		const verify = await page.evaluate( () => window.__gramophoneDev.verify() );
		const extra = log.heads.filter( ( u, i ) => !verify.includes( u ) || log.heads.indexOf( u ) !== i );
		check( where, 'nothing loads before a click (no audio or lyrics, HEAD only for verify tracks, once each)', !log.media.length && !log.lrc.length && !extra.length,
			`audio: ${ log.media.join( ' ' ) || 'none' }, lyrics: ${ log.lrc.join( ' ' ) || 'none' }, unexpected HEAD: ${ extra.join( ' ' ) || 'none' }` );
		const p = problems( log, verify );
		check( where, 'no console errors, failed requests or dialogs', !p.length, p.join( '; ' ) );
	} catch ( e ) {
		check( where, 'page run completes', false, e.message.split( '\n' )[ 0 ] );
	}
	await ctx.close();
}

// ------------------------------------------------------------------ interactions (desktop, legacy Vector)
async function press( page, spec, label ) {
	const el = ( await page.evaluateHandle( ( [ s, l ] ) => window.__gramophoneDev.control( s, l ), [ spec, label ] ) ).asElement();
	if ( !el ) {
		throw new Error( `no control "${ label }" in the ${ spec.mode } matching ${ JSON.stringify( spec ) }` );
	}
	await el.click( { timeout: 5000 } );
}

// Waits until a media element whose source matches re plays and its time moves on by half a second.
async function plays( page, re ) {
	await page.evaluate( () => delete window.__gramophoneDev.from );
	const ok = await page.waitForFunction( ( src ) => {
		const dev = window.__gramophoneDev;
		const m = dev.media.find( ( x ) => !x.paused && new RegExp( src ).test( decodeURI( x.currentSrc || x.src ) ) );
		if ( !m ) {
			return false;
		}
		dev.from ??= m.currentTime;
		return m.currentTime > dev.from + 0.5;
	}, re.source, { timeout: 20000 } ).then( () => true, () => false );
	return { ok, detail: `media: ${ JSON.stringify( await page.evaluate( () => window.__gramophoneDev.mediaState() ) ) }` };
}

async function interact( browser, title, fn ) {
	if ( !pageNames.includes( title ) ) {
		return;
	}
	const where = `${ title } / vector, interactions`;
	const { ctx, page, log } = await openPage( browser, title, 'vector' );
	try {
		await hydration( page );
		await fn( page, where, log );
		const media = await page.evaluate( () => window.__gramophoneDev.media.map( ( m ) => m.crossOrigin ) );
		check( where, `no crossOrigin on media elements (${ media.length })`, media.length && media.every( ( c ) => c === null ), JSON.stringify( media ) );
	} catch ( e ) {
		check( where, 'interactions complete', false, e.message.split( '\n' )[ 0 ] );
	}
	const p = problems( log, await page.evaluate( () => window.__gramophoneDev.verify() ).catch( () => [] ) );
	check( where, 'no console errors, failed requests or dialogs', !p.length, p.join( '; ' ) );
	await ctx.close();
}

async function interactions( browser, msg ) {
	await interact( browser, 'Galaxy Triangle', async ( page, where ) => {
		await press( page, { mode: 'player', src: '/images/.*/Div\\.A3\\.mp3$' }, msg.play );
		let r = await plays( page, /\/images\/.*\/Div\.A3\.mp3$/ );
		check( where, 'a wiki file plays in <gramophone> and its time advances', r.ok, r.detail );
		await press( page, { mode: 'button', src: '/images/.*/Ripple\\.mp3$' }, msg.play );
		r = await plays( page, /\/images\/.*\/Ripple\.mp3$/ );
		check( where, '<playbutton> plays', r.ok, r.detail );
	} );

	await interact( browser, 'Bubblin\'', async ( page, where, log ) => {
		for ( const [ from, lyrics ] of [ [ 'the wiki', '/images/.*/Bubblin\\.lrc$' ], [ 'the CORS mirror', '^http://127\\.0\\.0\\.1:8144/media/Bubblin\\.lrc$' ] ] ) {
			const spec = { mode: 'player', lyrics };
			await press( page, spec, msg.play );
			await press( page, spec, msg.lyrics );
			// The highlight moves on to a later line while the song plays.
			const moved = await page.waitForFunction( ( s ) => {
				const dev = window.__gramophoneDev;
				const lines = dev.within( dev.find( s ), 'li[data-time]' );
				const active = lines.findIndex( ( l ) => l.classList.contains( 'active' ) );
				const m = dev.media.find( ( x ) => !x.paused );
				return active > 0 && m && Number( lines[ active ].dataset.time ) <= m.currentTime &&
					( !lines[ active + 1 ] || Number( lines[ active + 1 ].dataset.time ) > m.currentTime - 0.5 );
			}, spec, { timeout: 20000 } ).then( () => true, () => false );
			const loaded = log.lrc.some( ( l ) => /^200 /.test( l ) && new RegExp( lyrics ).test( l.slice( 4 ) ) );
			check( where, `lyrics from ${ from }: the LRC loads and the active line follows playback`, loaded && moved,
				`LRC responses: ${ log.lrc.join( ' ' ) || 'none' }, highlight moved: ${ moved }` );
		}
	} );

	await interact( browser, 'Previews', async ( page, where, log ) => {
		const states = () => page.evaluate( () => {
			const dev = window.__gramophoneDev;
			return dev.hosts().filter( ( h ) => dev.data( h ).hideMissing ).map( ( h ) => ( {
				name: dev.name( h ),
				verify: dev.data( h ).tracks.filter( ( t ) => t.verify ).map( ( t ) => new URL( t.src, location.href ).href ),
				state: h.hidden ? 'hidden' : h.classList.contains( 'ext-gramophone-checking' ) ? 'checking' : 'shown',
				tab: !!h.closest( '.tabber__panel[hidden]' )
			} ) );
		} );
		// A button is hidden when every file it checks answered 404 or 410, each URL is checked once.
		const right = ( h ) => h.state === ( h.verify.length && h.verify.every( ( u ) => [ 404, 410 ].includes( log.status[ u ] ) ) ? 'hidden' : 'shown' ) &&
			h.verify.every( ( u ) => log.heads.filter( ( x ) => x === u ).length === 1 );
		await page.waitForFunction( () => !document.querySelector( '.ext-gramophone-checking:not(.tabber__panel[hidden] *)' ), null, { timeout: 15000 } ).catch( () => {} );
		const open = ( await states() ).filter( ( h ) => !h.tab );
		check( where, 'hidemissing: a file on the mirror keeps its button, a missing one hides it, one HEAD per URL',
			open.every( right ) && open.some( ( h ) => h.verify.length && h.state === 'hidden' ) && open.some( ( h ) => h.verify.length && h.state === 'shown' ),
			`${ JSON.stringify( open ) }, HEAD ${ JSON.stringify( log.status ) }` );
		const waiting = ( await states() ).filter( ( h ) => h.tab );
		const waited = waiting.length > 0 && waiting.every( ( h ) => h.state === 'checking' && h.verify.every( ( u ) => !log.heads.includes( u ) ) );
		await page.click( '.tabber__tab[aria-selected="false"]' );
		await page.waitForFunction( () => !document.querySelector( '.ext-gramophone-checking' ), null, { timeout: 15000 } ).catch( () => {} );
		const after = ( await states() ).filter( ( h ) => waiting.some( ( w ) => w.name === h.name ) );
		check( where, 'hidemissing: a button in a closed tab waits until the tab opens', waited && after.length && after.every( right ),
			`before: ${ JSON.stringify( waiting ) }, after: ${ JSON.stringify( after ) }` );
		await press( page, { mode: 'button', src: '^http://127\\.0\\.0\\.1:8145/' }, msg.play );
		let r = await plays( page, /^http:\/\/127\.0\.0\.1:8145\/media\/Galactic Love\.mp3$/ );
		check( where, 'audio from a host without CORS plays', r.ok, r.detail );
		await press( page, { mode: 'button', src: 'Special:FilePath/' }, msg.play );
		r = await plays( page, /\/wiki\/Special:FilePath\/Driven_Star_With_You\.mp3$/ );
		check( where, 'a Special:FilePath address plays', r.ok, r.detail );
	} );
}

// ------------------------------------------------------------------ main
const started = Date.now();
const logsBefore = phpLogs();
const msg = {};
let loaded = false;
try {
	const si = await api( { action: 'query', meta: 'siteinfo', siprop: 'extensions' } );
	loaded = si.query.extensions.some( ( e ) => e.name === 'Gramophone' );
	check( 'wiki', 'Gramophone is loaded (API siteinfo)', loaded, 'not in the extension list: extension.json is missing or does not parse' );
	const html = await ( await fetch( `${ BASE }/wiki/Special:Version?uselang=zh-cn` ) ).text();
	const row = html.match( /<tr[^>]*id="mw-version-ext-[a-z]+-Gramophone"[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>/ );
	const name = row && row[ 1 ].replace( /<[^>]+>/g, '' ).trim();
	check( 'wiki', 'Special:Version (zh-cn) shows the name "Gramophone"', name === 'Gramophone', `name ${ JSON.stringify( name ) }` );
	const text = async ( key, lang ) => ( await api( { action: 'query', meta: 'allmessages', ammessages: key, amlang: lang } ) ).query.allmessages[ 0 ].content;
	// The labels prove that ResourceLoader delivered the messages only if zh-cn differs from the English fallback.
	msg.play = await text( 'gramophone-play', 'zh-cn' );
	msg.lyrics = await text( 'gramophone-lyrics', 'zh-cn' );
	if ( msg.play === await text( 'gramophone-play', 'en' ) ) {
		msg.play = null;
	}
	await api( { action: 'purge', titles: PAGES.join( '|' ) }, true );
} catch ( e ) {
	check( 'wiki', 'the API answers', false, `${ BASE }: ${ e.message }. Is the wiki up (./setup.sh)?` );
}
if ( loaded ) {
	const browser = await chromium.launch( { channel: CHANNEL, headless: !args.headed } );
	for ( const title of pageNames ) {
		for ( const scenario of scenarioNames ) {
			await runPage( browser, title, scenario, msg.play );
		}
	}
	if ( !args[ 'no-interact' ] ) {
		await interactions( browser, msg );
	}
	await browser.close();
}
const logsAfter = phpLogs();
if ( logsBefore && logsAfter ) {
	const lines = Object.entries( logsAfter ).filter( ( [ f, n ] ) => n > ( logsBefore[ f ] || 0 ) )
		.map( ( [ f ] ) => `${ f }: ${ phpLogTail( f, logsBefore[ f ] || 0 ).trim().slice( 0, 1500 ) }` );
	check( 'wiki', 'no new lines in the PHP logs', !lines.length, lines.join( '\n' ) );
} else {
	console.log( 'skip wiki: PHP logs not readable (docker compose exec failed)' );
}
mkdirSync( SHOTS, { recursive: true } );
writeFileSync( join( SHOTS, 'summary.json' ), JSON.stringify( { started: new Date( started ).toISOString(), base: BASE, results }, null, '\t' ) );
const failed = results.filter( ( r ) => !r.ok ).length;
console.log( `\n${ results.length } checks in ${ Math.round( ( Date.now() - started ) / 1000 ) } s: ${ failed ? `${ failed } failed` : 'all checks passed' }` );
process.exit( failed ? 1 : 0 );
