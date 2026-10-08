declare module '*.css' {
	const css: string;
	export default css;
}

/** The subset of the MediaWiki client API this bundle uses. */
interface MwMessage {
	exists(): boolean;
	text(): string;
}

interface MwHook {
	add(handler: (...args: unknown[]) => void): MwHook;
}

/** Resolves like jQuery.Promise or Promise: only then(done, fail) is used. */
interface MwThenable<T> {
	then(done: (value: T) => void, fail: (err: unknown) => void): unknown;
}

interface MwLoader {
	using(modules: string | string[]): MwThenable<(name: string) => unknown>;
}

interface MwGlobal {
	message?: (key: string, ...params: string[]) => MwMessage;
	hook?: (name: string) => MwHook;
	loader?: MwLoader;
	log?: { error?: (...args: unknown[]) => void };
}

interface Window {
	mw?: MwGlobal;
}
