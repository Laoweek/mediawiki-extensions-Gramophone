/**
 * Lucide icons (https://lucide.dev, ISC license, see the bundle header).
 * Only the icons imported here end up in the bundle. These are the ones the
 * button needs, the player and row icons are in player-icons.ts.
 */
export { CircleAlert, Pause, Play } from 'lucide';

import { svg } from './util';

export type IconNode = Array<[string, Record<string, string | number | undefined>]>;

export function icon(node: IconNode, cls?: string, part?: string): SVGElement {
	const root = svg('svg', {
		class: cls ? 'icon ' + cls : 'icon',
		part: part ? 'icon ' + part : 'icon',
		viewBox: '0 0 24 24',
		fill: 'none',
		stroke: 'currentColor',
		'stroke-width': 2,
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round',
		'aria-hidden': 'true',
		focusable: 'false',
	});
	for (const [tag, attrs] of node) {
		const clean: Record<string, string | number> = {};
		for (const k in attrs) if (attrs[k] !== undefined && k !== 'key') clean[k] = attrs[k] as string | number;
		root.appendChild(svg(tag, clean));
	}
	return root;
}
