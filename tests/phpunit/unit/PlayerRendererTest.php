<?php

namespace MediaWiki\Extension\Gramophone\Tests\Unit;

use MediaWiki\Extension\Gramophone\PlayerInput;
use MediaWiki\Extension\Gramophone\PlayerRenderer;
use MediaWikiUnitTestCase;

/**
 * @covers \MediaWiki\Extension\Gramophone\PlayerRenderer
 */
class PlayerRendererTest extends MediaWikiUnitTestCase {

	private const COLORS = [ 'background' => '#98c5e9', 'foreground' => null, 'track' => null, 'thumb' => null ];

	private static function track( array $overrides = [] ): array {
		return $overrides + [
			'src' => 'https://example.com/a.mp3',
			'title' => 'a.mp3',
			'artist' => '',
			'album' => '',
			'explicit' => false,
			'cover' => '',
			'lyrics' => '',
			'lyricsOffset' => 0,
			'link' => '',
			'missing' => false,
			'verify' => false,
			'nofollow' => false,
		];
	}

	private static function player( string $mode ): PlayerInput {
		return new PlayerInput( $mode, true, false, true, self::COLORS, [] );
	}

	/**
	 * @return string The raw, still HTML-escaped value of the data-mw-gramophone attribute
	 */
	private static function dataAttribute( string $html ): string {
		return preg_match( '/data-mw-gramophone="([^"]*)"/', $html, $match ) ? $match[1] : '';
	}

	private static function decodeData( string $html ): array {
		return json_decode( html_entity_decode( self::dataAttribute( $html ), ENT_QUOTES | ENT_HTML5 ), true );
	}

	public function testDataKeepsEveryFieldThatIsSet(): void {
		$track = [
			'src' => '',
			'title' => '',
			'artist' => 'Artist',
			'album' => 'Album',
			'explicit' => true,
			'cover' => 'https://example.com/c.jpg',
			'lyrics' => 'https://example.com/a.lrc',
			'lyricsOffset' => -250,
			'link' => '/wiki/Main_Page',
			'missing' => true,
			'verify' => true,
			'nofollow' => true,
		];
		$colors = [ 'background' => '#000000', 'foreground' => '#111111', 'track' => '#222222', 'thumb' => '#333333' ];
		$player = new PlayerInput( PlayerInput::MODE_PLAYER, true, true, true, $colors, [], true );
		$this->assertSame(
			[
				'v' => 2,
				'mode' => 'player',
				'autoPlay' => true,
				'loop' => true,
				'playlistOpen' => true,
				'hideMissing' => true,
				'colors' => $colors,
				'tracks' => [ $track ],
			],
			self::decodeData( ( new PlayerRenderer() )->render( $player, [ $track ] ) )
		);
	}

	public function testInvalidUtf8IsReplaced(): void {
		$html = ( new PlayerRenderer() )->render( self::player( PlayerInput::MODE_PLAYER ), [
			self::track( [ 'artist' => "bad \xFF byte" ] ),
		] );
		$this->assertSame( "bad \u{FFFD} byte", self::decodeData( $html )['tracks'][0]['artist'] );
	}
}
