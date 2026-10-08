/**
 * Page-wide volume and mute, persisted per viewer in localStorage.
 * Storage can be unavailable (private mode, blocked site data), so every
 * access is wrapped and the in-memory value keeps working.
 */
import { clamp } from './util';

const KEY = 'ext-gramophone-volume';
let volume = 1;
let muted = false;
let loaded = false;
let saveTimer = 0;
let canSet: boolean | null = null;
const subscribers = new Set<() => void>();

function load(): void {
	if (loaded) return;
	loaded = true;
	try {
		const data = JSON.parse(localStorage.getItem(KEY) || 'null');
		if (data && typeof data.v === 'number') volume = clamp(data.v, 0, 1);
		if (data && data.m === true) muted = true;
	} catch (e) {
		// Keep defaults.
	}
}

export function getVolume(): number {
	load();
	return volume;
}

export function isMuted(): boolean {
	load();
	return muted;
}

export function setVolume(v: number, mute?: boolean): void {
	load();
	volume = clamp(Math.round(v * 100) / 100, 0, 1);
	muted = mute === undefined ? muted : mute;
	clearTimeout(saveTimer);
	saveTimer = window.setTimeout(() => {
		try {
			localStorage.setItem(KEY, JSON.stringify({ v: volume, m: muted }));
		} catch (e) {
			// Not persisted, still applied for this page view.
		}
	}, 300);
	subscribers.forEach((fn) => fn());
}

export function setMuted(m: boolean): void {
	setVolume(getVolume(), m);
}

/** Calls fn after every volume or mute change. Returns the unsubscribe function. */
export function onVolume(fn: () => void): () => void {
	subscribers.add(fn);
	return () => {
		subscribers.delete(fn);
	};
}

export function applyVolume(a: HTMLMediaElement): void {
	load();
	a.volume = volume;
	a.muted = muted;
}

/** iOS ignores HTMLMediaElement.volume, so only mute can be offered there. */
export function volumeSettable(): boolean {
	if (canSet === null) {
		try {
			const a = document.createElement('audio');
			a.volume = 0.5;
			canSet = a.volume === 0.5;
		} catch (e) {
			canSet = false;
		}
	}
	return canSet;
}
