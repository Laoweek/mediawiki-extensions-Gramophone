/**
 * Entry point of the ext.gramophone.player module: the card player and the table row,
 * with their styles. The ext.gramophone module loads it when a page has a player
 * (index.ts). Imports of the modules that ext.gramophone already has become
 * require('ext.gramophone') in the build (build.mjs), so that code ships once.
 */
import { addSheet } from './styles';
import playerBase from './styles/player.css';
import narrow from './styles/player-narrow.css';
import rowBase from './styles/row.css';
import slider from './styles/slider.css';

// Keep in sync with the placeholder breakpoints in ext.gramophone.styles.css.
addSheet(
	'player',
	slider +
		playerBase +
		'@container (max-width:34.99rem){' +
		narrow +
		'}@supports not (container-type:inline-size){@media (max-width:40rem){' +
		narrow +
		'}}',
);
addSheet('row', slider + rowBase);

export { mountPlayer } from './player';
export { mountRow } from './row';
