<?php

namespace MediaWiki\Extension\Gramophone;

use JsonException;
use MediaWiki\Html\Html;

/**
 * Builds the host element the client script mounts on.
 *
 * All data for the client travels in one JSON `data-mw-gramophone` attribute. The light DOM holds
 * plain links to the audio, so the content stays usable without JavaScript.
 * The output is a single line, because the parser's paragraph pass works line by line.
 */
class PlayerRenderer {

	/** Data format version shared with the client */
	public const DATA_VERSION = 2;

	private const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG
		| JSON_HEX_AMP | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR;

	/** Track fields the client data always has. The others are left out at their defaults. */
	private const REQUIRED_TRACK_FIELDS = [ 'src' => true, 'title' => true ];

	/**
	 * @param PlayerInput $player
	 * @param array[] $tracks Resolved tracks, see TrackResolver::resolve()
	 * @param array[] $linkAttributes Extra attributes for each track's fallback link, in
	 *  track order, see TrackResolver::fallbackLinkAttributes()
	 * @param callable|null $convertText `fn ( string $text ): string` applied to the title,
	 *  artist and album in the client data only. The fallback links keep the original text,
	 *  because the parser converts page text itself and converting twice would undo
	 *  conversion markup such as `-{...}-`.
	 * @param string[] $hostAttributes Sanitised `class` and `style` from the tag. The classes
	 *  follow the host's own.
	 * @return string HTML
	 * @throws JsonException
	 */
	public function render(
		PlayerInput $player, array $tracks, array $linkAttributes = [], ?callable $convertText = null,
		array $hostAttributes = []
	): string {
		$isButton = $player->mode === PlayerInput::MODE_BUTTON;
		$attributes = [
			// A string, not a list: Html would drop a class such as '1' that equals a list key
			'class' => 'ext-gramophone ' . ( $isButton ? 'ext-gramophone-button' : 'ext-gramophone-player' )
				. ' ' . ( $hostAttributes['class'] ?? '' ),
			'style' => $hostAttributes['style'] ?? false,
			'data-mw-gramophone' => json_encode( self::clientData( $player, $tracks, $convertText ), self::JSON_FLAGS ),
		];

		$links = [];
		foreach ( $tracks as $i => $track ) {
			$links[] = $this->fallbackLink( $track, $isButton, $linkAttributes[$i] ?? [] );
		}
		if ( $isButton ) {
			return Html::rawElement( 'span', $attributes, implode( '', $links ) );
		}
		$items = array_map( static fn ( string $link ): string => Html::rawElement( 'li', [], $link ), $links );
		return Html::rawElement( 'div', $attributes,
			Html::rawElement( 'ol', [ 'class' => 'ext-gramophone-fallback' ], implode( '', $items ) )
		);
	}

	/**
	 * The `data-mw-gramophone` data. Options that are off, unset colours and track fields at their
	 * default ('', false or 0) are left out, because they add up on pages with hundreds of
	 * buttons.
	 *
	 * @param PlayerInput $player
	 * @param array[] $tracks
	 * @param callable|null $convertText
	 * @return array
	 */
	private static function clientData( PlayerInput $player, array $tracks, ?callable $convertText ): array {
		$data = [ 'v' => self::DATA_VERSION, 'mode' => $player->mode ];
		$options = [
			'autoPlay' => $player->autoPlay,
			'loop' => $player->loop,
			'playlistOpen' => $player->playlistOpen,
			'hideMissing' => $player->hideMissing,
		];
		$data += array_filter( $options );
		$colors = array_filter( $player->colors, static fn ( ?string $color ): bool => $color !== null );
		if ( $colors ) {
			$data['colors'] = $colors;
		}
		$data['tracks'] = array_map( static function ( array $track ) use ( $convertText ): array {
			if ( $convertText ) {
				$track = self::convertDisplayText( $track, $convertText );
			}
			return array_filter(
				$track,
				static fn ( $value, string $field ): bool => isset( self::REQUIRED_TRACK_FIELDS[$field] )
					|| ( $value !== '' && $value !== false && $value !== 0 ),
				ARRAY_FILTER_USE_BOTH
			);
		}, array_values( $tracks ) );
		return $data;
	}

	private static function convertDisplayText( array $track, callable $convertText ): array {
		foreach ( [ 'title', 'artist', 'album' ] as $field ) {
			if ( $track[$field] !== '' ) {
				$track[$field] = $convertText( $track[$field] );
			}
		}
		return $track;
	}

	/**
	 * @param string $message Plain text, escaped here
	 * @return string HTML
	 */
	public function renderError( string $message ): string {
		return Html::element( 'strong', [ 'class' => 'error ext-gramophone-error' ], $message );
	}

	/**
	 * A link to the audio file, or a red link to the missing file. A track with nothing to
	 * link to, such as a rejected URL, gets a span, because a link without href is neither
	 * focusable nor a link.
	 */
	private function fallbackLink( array $track, bool $withTooltip, array $extraAttributes ): string {
		$href = $track['missing'] ? $track['link'] : $track['src'];
		$attributes = [
			'class' => $track['missing'] ? [ 'new', 'ext-gramophone-fallback-link' ] : 'ext-gramophone-fallback-link',
			'title' => $withTooltip ? $track['title'] : false,
		];
		if ( $href === '' ) {
			return Html::element( 'span', $attributes, $track['title'] );
		}
		return Html::element( 'a', [ 'class' => $attributes['class'], 'href' => $href ]
			+ $attributes + $extraAttributes, $track['title'] );
	}
}
