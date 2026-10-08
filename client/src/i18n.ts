/**
 * Interface messages. MediaWiki provides them through the ext.gramophone module
 * "messages" list. The English text below is only used when a message is
 * missing (for example outside MediaWiki).
 */
const FALLBACK: Record<string, string> = {
	'gramophone-play': 'Play',
	'gramophone-pause': 'Pause',
	'gramophone-previous': 'Previous',
	'gramophone-next': 'Next',
	'gramophone-seek': 'Seek',
	'gramophone-volume': 'Volume',
	'gramophone-mute': 'Mute',
	'gramophone-unmute': 'Unmute',
	'gramophone-repeat-off': 'Repeat off',
	'gramophone-repeat-all': 'Repeat all',
	'gramophone-repeat-one': 'Repeat one',
	'gramophone-playlist': 'Playlist',
	'gramophone-lyrics': 'Lyrics',
	'gramophone-lyrics-loading': 'Loading lyrics',
	'gramophone-lyrics-error': 'Lyrics could not be loaded',
	'gramophone-download': 'Download',
	'gramophone-open-file-page': 'Open file page',
	'gramophone-speed': 'Playback speed',
	'gramophone-loading': 'Loading',
	'gramophone-load-error': 'This audio could not be played',
	'gramophone-missing-file': 'This file does not exist',
	'gramophone-autoplay-blocked': 'Click to play',
	'gramophone-explicit': 'Explicit',
	'gramophone-unknown-title': 'Untitled',
	'gramophone-track-of': 'Track $1 of $2',
	'gramophone-now-playing': 'Now playing: $1',
};

export function t(key: string, ...params: Array<string | number>): string {
	const args = params.map(String);
	try {
		const mw = window.mw;
		if (mw && mw.message) {
			const msg = mw.message(key, ...args);
			if (msg.exists()) return msg.text();
		}
	} catch (e) {
		// Fall through to the built-in text.
	}
	const raw = FALLBACK[key] || key;
	return raw.replace(/\$(\d)/g, (m, n) => (args[n - 1] !== undefined ? args[n - 1] : m));
}
