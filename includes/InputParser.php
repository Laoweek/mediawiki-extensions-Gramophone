<?php

namespace MediaWiki\Extension\Gramophone;

use Generator;
use JsonException;
use stdClass;

/**
 * Turns tag content into a PlayerInput. Pure PHP with no MediaWiki dependencies.
 *
 * Two syntaxes are supported:
 * - the file list `FILES|key=value|...` of `<gramophone>`, `<playbutton>`, `<flashmp3>` and `<sm2>`
 * - the JSON playlist of `<gramophone>` and `<modernsoundmanager>`
 */
class InputParser {

	/** Legacy option name => colour slot */
	private const LEGACY_COLORS = [
		'bg' => 'background',
		'text' => 'foreground',
		'tracker' => 'track',
		'track' => 'thumb',
	];

	/** Legacy options besides the colours. Others are ignored. */
	private const LEGACY_OPTIONS = [ 'autostart', 'loop', 'openplaylist', 'hidemissing', 'title' ];

	/** JSON property name => colour slot */
	private const JSON_COLORS = [
		'backgroundColor' => 'background',
		'foregroundColor' => 'foreground',
		'trackColor' => 'track',
		'thumbColor' => 'thumb',
	];

	/** Lyrics offsets beyond this many milliseconds (about 11 days) are treated as invalid */
	private const MAX_LYRICS_OFFSET = 1e9;

	/** @var callable `fn ( string $value ): string` */
	private $readValue;

	/**
	 * @param callable|null $readValue `fn ( string $value ): string` applied to each value of
	 *  the content after it is split: a file name, an option name or value, a JSON string. The
	 *  parser's strip markers can stay in the content until then, so that a separator in
	 *  `<nowiki>` does not split.
	 */
	public function __construct( ?callable $readValue = null ) {
		$this->readValue = $readValue ?? static fn ( string $value ): string => $value;
	}

	/**
	 * Parse the legacy `FILES|key=value|...` syntax.
	 *
	 * @param string $text Tag content
	 * @param string $mode PlayerInput::MODE_PLAYER or PlayerInput::MODE_BUTTON. The button
	 *  ignores autostart, loop and openplaylist, the player ignores hidemissing and title.
	 * @param bool $withColors Whether to read the bg, text, tracker and track colours. When
	 *  false every colour is null, so the player follows the site theme.
	 * @param string[] $attributes Tag attributes, read as the same options. An option written
	 *  in the content wins over the attribute of the same name.
	 * @param int $maxTracks Most tracks the tag may have
	 * @return PlayerInput|null Null when no file is given
	 * @throws InputError When there are more than $maxTracks files
	 */
	public function parseLegacy(
		string $text, string $mode, bool $withColors = false, array $attributes = [],
		int $maxTracks = PHP_INT_MAX
	): ?PlayerInput {
		$segments = self::split( $text, '|' );
		$files = self::splitFileList( $segments->current(), $maxTracks, $this->readValue );
		self::checkTrackCount( count( $files ), $maxTracks );

		// Only options that are read are kept, so that a tag full of options needs little memory
		$options = [];
		for ( $segments->next(); $segments->valid(); $segments->next() ) {
			$segment = $segments->current();
			if ( substr_count( $segment, '=' ) === 1 ) {
				[ $name, $value ] = explode( '=', $segment );
				$name = trim( ( $this->readValue )( $name ) );
				if ( in_array( $name, self::LEGACY_OPTIONS, true ) || isset( self::LEGACY_COLORS[$name] ) ) {
					$options[$name] = trim( ( $this->readValue )( $value ) );
				}
			}
		}
		return $this->legacyPlayer( $files, $options + array_map( 'trim', $attributes ), $mode, $withColors );
	}

	/**
	 * Parse the content of AudioButton's `<ab>` tag: one file name or URL, taken whole, so
	 * commas and `|` stay part of the name. The options come from the tag attributes.
	 *
	 * @param string $text Tag content
	 * @param bool $withColors As in parseLegacy()
	 * @param string[] $attributes Tag attributes, read as the options of `<sm2>`
	 * @param int $maxTracks Most tracks the tag may have
	 * @return PlayerInput|null Null when no file is given
	 * @throws InputError When a file is given and $maxTracks is 0
	 */
	public function parseAudioButton(
		string $text, bool $withColors, array $attributes, int $maxTracks = PHP_INT_MAX
	): ?PlayerInput {
		$file = trim( ( $this->readValue )( $text ) );
		self::checkTrackCount( $file === '' ? 0 : 1, $maxTracks );
		return $this->legacyPlayer(
			$file === '' ? [] : [ $file ], array_map( 'trim', $attributes ), PlayerInput::MODE_BUTTON, $withColors
		);
	}

	/**
	 * @param string[] $files
	 * @param string[] $options Trimmed option values by name
	 * @param string $mode
	 * @param bool $withColors
	 * @return PlayerInput|null Null when no file is given
	 */
	private function legacyPlayer( array $files, array $options, string $mode, bool $withColors ): ?PlayerInput {
		if ( !$files ) {
			return null;
		}
		$isOn = static fn ( string $name ): bool => $mode === PlayerInput::MODE_PLAYER
			&& ( $options[$name] ?? '' ) === 'yes';

		$colors = [];
		foreach ( self::LEGACY_COLORS as $name => $slot ) {
			$colors[$slot] = $withColors ? self::normalizeColor( $options[$name] ?? null ) : null;
		}
		// The button's title names every file it plays. The client adds the part number.
		$title = $mode === PlayerInput::MODE_BUTTON ? self::cleanText( $options['title'] ?? '' ) : '';

		return new PlayerInput(
			$mode,
			$isOn( 'autostart' ),
			$isOn( 'loop' ),
			$isOn( 'openplaylist' ),
			$colors,
			array_map( static fn ( string $file ): TrackInput => new TrackInput( $file, $title ), $files ),
			$mode === PlayerInput::MODE_BUTTON && ( $options['hidemissing'] ?? '' ) === 'yes'
		);
	}

	/**
	 * Parse the `<modernsoundmanager>` JSON playlist.
	 *
	 * Invalid JSON, a playlist without playable entries and more than $maxTracks playable
	 * entries raise an InputError. Playlist entries that are not objects or whose audioFileUrl
	 * is not a non-blank string are skipped, as in Sm2Shim. Optional fields with the wrong type
	 * fall back to their defaults.
	 *
	 * @param string $text Tag content
	 * @param int $maxTracks Most tracks the tag may have
	 * @return PlayerInput
	 * @throws InputError
	 */
	public function parseJson( string $text, int $maxTracks = PHP_INT_MAX ): PlayerInput {
		// json_decode() builds every entry before any is counted, about 50 MB for 2 MB of `{},`.
		// Each track is an object, so a text with more objects than the tag may have tracks,
		// besides the outer object, is too long. A playlist whose entries hold objects of their
		// own can be refused although it has few enough tracks.
		if ( substr_count( $text, '{' ) > $maxTracks + 1 && self::countObjects( $text ) > $maxTracks + 1 ) {
			throw new InputError( 'gramophone-too-many-tracks' );
		}
		try {
			$data = json_decode( $text, false, 512, JSON_THROW_ON_ERROR );
		} catch ( JsonException $e ) {
			throw new InputError( 'gramophone-invalidJson' );
		}
		if ( !$data instanceof stdClass ) {
			throw new InputError( 'gramophone-invalidJson' );
		}
		$playlist = $data->playlist ?? null;
		if ( !is_array( $playlist ) ) {
			throw new InputError( 'gramophone-playlistRequired' );
		}

		$tracks = [];
		foreach ( $playlist as $item ) {
			// Like Sm2Shim, skip entries that are not objects or have no usable audioFileUrl,
			// so a page that showed a player there never turns into an error
			$source = $item instanceof stdClass ? $this->stringField( $item, 'audioFileUrl' ) : '';
			if ( $source === '' ) {
				continue;
			}
			self::checkTrackCount( count( $tracks ) + 1, $maxTracks );
			$tracks[] = new TrackInput(
				$source,
				$this->textField( $item, 'title' ),
				$this->textField( $item, 'artist' ),
				$this->textField( $item, 'album' ),
				( $item->isExplicit ?? null ) === true,
				$this->stringField( $item, 'coverImageUrl' ),
				$this->stringField( $item, 'lrcFileUrl' ),
				self::offsetField( $item, 'lrcFileOffset' ),
				$this->stringField( $item, 'navigationUrl' )
			);
		}

		if ( !$tracks ) {
			throw new InputError( 'gramophone-playlistRequired' );
		}

		$colors = [];
		foreach ( self::JSON_COLORS as $name => $slot ) {
			$colors[$slot] = self::normalizeColor( $this->stringField( $data, $name ) );
		}

		return new PlayerInput(
			PlayerInput::MODE_PLAYER,
			( $data->autoPlay ?? null ) === true,
			( $data->loop ?? null ) === true,
			( $data->isPlaylistOpen ?? null ) === true,
			$colors,
			$tracks
		);
	}

	/**
	 * Normalise a colour to lowercase `#rrggbb`.
	 *
	 * Accepts 3 or 6 hex digits with an optional `#` or `0x` prefix, in any letter case.
	 *
	 * @param mixed $value
	 * @return string|null Null for anything else
	 */
	public static function normalizeColor( $value ): ?string {
		if ( !is_string( $value )
			|| !preg_match( '/^(?:#|0x)?([0-9a-f]{3}|[0-9a-f]{6})$/iD', trim( $value ), $match )
		) {
			return null;
		}
		$hex = strtolower( $match[1] );
		if ( strlen( $hex ) === 3 ) {
			$hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
		}
		return '#' . $hex;
	}

	/**
	 * Make editor text safe for a single line of output: runs of control characters,
	 * including line breaks, become one space.
	 *
	 * The page output must stay on one line for the parser's paragraph pass, and DEL
	 * (\x7F) is reserved for the parser's strip markers.
	 */
	public static function cleanText( string $text ): string {
		return trim( preg_replace( '/[\x00-\x1F\x7F]+/', ' ', $text ) );
	}

	/**
	 * Split the legacy file list on commas that are outside double quotes. When the quotes
	 * are unbalanced, every comma splits, as in Sm2Shim. Each entry is trimmed and loses one
	 * pair of surrounding quotes. Empty entries are dropped.
	 *
	 * @param string $list
	 * @param int $limit Stop after this many entries plus one, so that a caller can tell that
	 *  the list is too long without the cost of splitting all of it
	 * @param callable|null $readEntry `fn ( string $entry ): string` applied to each entry
	 *  after its quotes are removed, see the constructor
	 * @return string[]
	 */
	public static function splitFileList( string $list, int $limit = PHP_INT_MAX, ?callable $readEntry = null ): array {
		$quotes = substr_count( $list, '"' );
		$entries = ( $quotes === 0 || $quotes % 2 === 1 )
			? self::split( $list, ',' )
			: self::splitOutsideQuotes( $list );

		$files = [];
		foreach ( $entries as $entry ) {
			$entry = trim( $entry );
			if ( strlen( $entry ) >= 2 && $entry[0] === '"' && $entry[-1] === '"' ) {
				$entry = trim( substr( $entry, 1, -1 ) );
			}
			if ( $readEntry ) {
				$entry = trim( $readEntry( $entry ) );
			}
			if ( $entry !== '' ) {
				$files[] = $entry;
				if ( count( $files ) > $limit ) {
					break;
				}
			}
		}
		return $files;
	}

	/**
	 * explode(), one piece at a time, so that a long text is not split further than the
	 * caller reads.
	 *
	 * @param string $text
	 * @param string $separator
	 * @return Generator<string>
	 */
	private static function split( string $text, string $separator ): Generator {
		$start = 0;
		$end = strpos( $text, $separator );
		while ( $end !== false ) {
			yield substr( $text, $start, $end - $start );
			$start = $end + strlen( $separator );
			$end = strpos( $text, $separator, $start );
		}
		yield substr( $text, $start );
	}

	/**
	 * @param string $list
	 * @return Generator<string>
	 */
	private static function splitOutsideQuotes( string $list ): Generator {
		$current = '';
		$quoted = false;
		// Byte-wise scanning is safe for UTF-8 because `"` and `,` never occur inside
		// a multibyte sequence.
		$length = strlen( $list );
		for ( $i = 0; $i < $length; $i++ ) {
			$char = $list[$i];
			if ( $char === ',' && !$quoted ) {
				yield $current;
				$current = '';
				continue;
			}
			if ( $char === '"' ) {
				$quoted = !$quoted;
			}
			$current .= $char;
		}
		yield $current;
	}

	/**
	 * @param int $count Number of tracks read so far
	 * @param int $maxTracks
	 * @throws InputError
	 */
	private static function checkTrackCount( int $count, int $maxTracks ): void {
		if ( $count > $maxTracks ) {
			throw new InputError( 'gramophone-too-many-tracks' );
		}
	}

	private function stringField( stdClass $object, string $name ): string {
		$value = $object->$name ?? null;
		return is_string( $value ) ? trim( ( $this->readValue )( $value ) ) : '';
	}

	/**
	 * A string field that is shown as text, such as the title.
	 */
	private function textField( stdClass $object, string $name ): string {
		return self::cleanText( $this->stringField( $object, $name ) );
	}

	/**
	 * @param string $json
	 * @return int The number of `{` outside JSON strings
	 */
	private static function countObjects( string $json ): int {
		$withoutStrings = preg_replace( '/"(?:[^"\\\\]++|\\\\.)*+"/s', '', $json );
		return substr_count( $withoutStrings ?? $json, '{' );
	}

	private static function offsetField( stdClass $object, string $name ): int {
		$value = $object->$name ?? null;
		if ( ( is_int( $value ) || is_float( $value ) ) && abs( $value ) <= self::MAX_LYRICS_OFFSET ) {
			return (int)round( $value );
		}
		return 0;
	}
}
