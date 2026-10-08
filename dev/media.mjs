#!/usr/bin/env node
// Puts the dev wiki's media into dev/media/wiki/ (gitignored), named as the wiki pages use them:
// the songs as MP3 ("Div.A3.mp3", "E Div.mp3", "Bubblin.mp3"), the covers ("Galaxy Triangle
// cover.jpg") and the lyrics file "Bubblin.lrc". setup.sh runs it, then imports the folder into
// the wiki, and the uploads container serves it on ports 8144 and 8145.
//
// The songs are Apple Music's 30-second previews, downloaded by scripts/demo-media.mjs into
// dev/media/download/ and converted to MP3 in the ffmpeg container. They are never committed.
// Bubblin.lrc is copied from client/demo/lyrics/bubblin.lrc: original lines that explain the
// lyrics panel, not the song's lyrics.
//
// Idempotent: files that are already there are kept, and nothing is downloaded when every song
// and cover is there. The lyrics file is copied every time.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALBUM, LYRICS_SONG, SINGLE, SONGS, fetchMedia } from '../scripts/demo-media.mjs';

const DEV = dirname( fileURLToPath( import.meta.url ) );
const DOWNLOAD = join( DEV, 'media/download' );
const WIKI = join( DEV, 'media/wiki' );

// The wiki file name of a title: without a trailing dot or apostrophe ("E Div." is "E Div.mp3").
const fileName = ( title ) => title.replace( /['.]+$/, '' );

const have = ( name, download ) => existsSync( join( WIKI, name ) ) || existsSync( join( DOWNLOAD, download ) );
if ( SONGS.every( ( s ) => have( `${ fileName( s.title ) }.mp3`, `${ s.slug }.m4a` ) ) &&
	[ ALBUM, LYRICS_SONG, SINGLE ].every( ( r ) => have( `${ fileName( r.title ) } cover.jpg`, `${ r.cover }.jpg` ) ) ) {
	console.log( 'media: every song and cover is there, nothing to download' );
} else {
	const written = await fetchMedia( DOWNLOAD );
	console.log( `media: ${ written } file(s) downloaded from Apple Music, the rest were already there` );
}
mkdirSync( WIKI, { recursive: true } );

for ( const song of SONGS ) {
	const target = `${ fileName( song.title ) }.mp3`;
	if ( existsSync( join( WIKI, target ) ) ) {
		continue;
	}
	console.log( `media: converting ${ song.slug }.m4a to ${ target }` );
	execFileSync( 'docker', [ 'compose', '--progress', 'quiet', '--profile', 'tools', 'run', '--rm', '-T', 'ffmpeg',
		'-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', `/media/download/${ song.slug }.m4a`,
		'-vn', '-map_metadata', '-1', '-c:a', 'libmp3lame', '-q:a', '4', '-f', 'mp3', `/media/wiki/${ target }.part` ],
	{ cwd: DEV, stdio: [ 'ignore', 'inherit', 'inherit' ] } );
	renameSync( join( WIKI, `${ target }.part` ), join( WIKI, target ) );
}

for ( const release of [ ALBUM, LYRICS_SONG, SINGLE ] ) {
	const target = `${ fileName( release.title ) } cover.jpg`;
	if ( !existsSync( join( WIKI, target ) ) ) {
		copyFileSync( join( DOWNLOAD, `${ release.cover }.jpg` ), join( WIKI, target ) );
	}
}

copyFileSync( join( DEV, '../client/demo/lyrics/bubblin.lrc' ), join( WIKI, 'Bubblin.lrc' ) );
