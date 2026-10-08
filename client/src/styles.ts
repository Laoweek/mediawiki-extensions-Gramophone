/**
 * Shadow DOM styles. One constructable stylesheet per kind is shared by every
 * instance on the page, with a <style> fallback for older browsers. This
 * module has the button styles, ext.gramophone.player adds the player and row
 * styles with addSheet().
 */
import common from './styles/common.css';
import button from './styles/button.css';

export type SheetKind = 'button' | 'player' | 'row' | 'tooltip';

const TEXT: Record<string, string> = { common, button };
const sheets: Record<string, CSSStyleSheet> = {};

/** Makes the CSS of a kind from another module available to adopt(). */
export function addSheet(kind: SheetKind, css: string): void {
	TEXT[kind] = css;
}

function sheet(name: string): CSSStyleSheet {
	if (!sheets[name]) {
		const s = new CSSStyleSheet();
		s.replaceSync(TEXT[name]);
		sheets[name] = s;
	}
	return sheets[name];
}

export function adopt(root: ShadowRoot, kind: SheetKind): void {
	const names = kind === 'tooltip' ? ['common'] : ['common', kind];
	if ('adoptedStyleSheets' in root) {
		try {
			root.adoptedStyleSheets = names.map(sheet);
			return;
		} catch (e) {
			// Constructable stylesheets are not supported, use <style>.
		}
	}
	const style = document.createElement('style');
	style.textContent = names.map((n) => TEXT[n]).join('\n');
	root.appendChild(style);
}
