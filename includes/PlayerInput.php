<?php

namespace MediaWiki\Extension\Gramophone;

/**
 * Player options and tracks parsed from one tag, before any wiki lookup.
 */
final class PlayerInput {

	/** Full player with controls and playlist */
	public const MODE_PLAYER = 'player';
	/** Compact inline play button */
	public const MODE_BUTTON = 'button';

	/**
	 * @param string $mode One of the MODE_* constants
	 * @param bool $autoPlay
	 * @param bool $loop
	 * @param bool $playlistOpen
	 * @param array<string,?string> $colors Normalised `#rrggbb` values or null, keyed by
	 *  background, foreground, track and thumb
	 * @param TrackInput[] $tracks At least one track
	 * @param bool $hideMissing Whether the client hides the button when none of its files exist
	 */
	public function __construct(
		public readonly string $mode,
		public readonly bool $autoPlay,
		public readonly bool $loop,
		public readonly bool $playlistOpen,
		public readonly array $colors,
		public readonly array $tracks,
		public readonly bool $hideMissing = false
	) {
	}

	/**
	 * The same player, but it waits for the reader to press play.
	 */
	public function withoutAutoPlay(): self {
		return new self(
			$this->mode, false, $this->loop, $this->playlistOpen, $this->colors, $this->tracks, $this->hideMissing
		);
	}
}
