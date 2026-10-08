<?php

namespace MediaWiki\Extension\Gramophone;

/**
 * One playlist entry as written by the editor, before any wiki lookup.
 *
 * The reference fields (source, cover, lyrics, navigation) hold raw text:
 * an http(s) URL, a file name or a page title. TrackResolver turns them into URLs.
 */
final class TrackInput {

	/**
	 * @param string $source Audio URL or wiki file name
	 * @param string $title Display title, empty to derive one from the source
	 * @param string $artist
	 * @param string $album
	 * @param bool $explicit
	 * @param string $cover Cover image URL or wiki file name
	 * @param string $lyrics LRC file URL or wiki file name
	 * @param int $lyricsOffset Milliseconds added to every LRC timestamp
	 * @param string $navigation URL or page title the track links to
	 */
	public function __construct(
		public readonly string $source,
		public readonly string $title = '',
		public readonly string $artist = '',
		public readonly string $album = '',
		public readonly bool $explicit = false,
		public readonly string $cover = '',
		public readonly string $lyrics = '',
		public readonly int $lyricsOffset = 0,
		public readonly string $navigation = ''
	) {
	}
}
