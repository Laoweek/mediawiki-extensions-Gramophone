<?php

namespace MediaWiki\Extension\Gramophone\Tests\Unit;

use MediaWiki\Extension\Gramophone\InputError;
use MediaWiki\Extension\Gramophone\InputParser;
use MediaWiki\Extension\Gramophone\PlayerInput;
use MediaWiki\Extension\Gramophone\TrackInput;
use MediaWikiUnitTestCase;

/**
 * @covers \MediaWiki\Extension\Gramophone\InputParser
 */
class InputParserTest extends MediaWikiUnitTestCase {

	private const NO_COLORS = [ 'background' => null, 'foreground' => null, 'track' => null, 'thumb' => null ];

	public static function provideColors(): iterable {
		yield 'six digits with hash' => [ '#3A7194', '#3a7194' ];
		yield 'six digits with 0x' => [ '0x98C5E9', '#98c5e9' ];
		yield 'six digits with 0X' => [ '0X98c5e9', '#98c5e9' ];
		yield 'six digits bare' => [ 'abcdef', '#abcdef' ];
		yield 'three digits expand' => [ '#FfF', '#ffffff' ];
		yield 'three digits bare' => [ '1a2', '#11aa22' ];
		yield 'surrounding spaces' => [ ' #000 ', '#000000' ];
		yield 'five digits' => [ '#12345', null ];
		yield 'seven digits' => [ '1234567', null ];
		yield 'eight digits with alpha' => [ '#11223344', null ];
		yield 'colour name' => [ 'red', null ];
		yield 'non-hex letters' => [ '#ggg', null ];
		yield 'double prefix' => [ '#0x123', null ];
		yield 'trailing newline' => [ "#123\n", '#112233' ];
		yield 'inner newline' => [ "#12\n3", null ];
		yield 'css injection' => [ '#fff;background:url(x)', null ];
		yield 'empty' => [ '', null ];
		yield 'number' => [ 123, null ];
		yield 'null' => [ null, null ];
		yield 'array' => [ [ '#fff' ], null ];
	}

	/**
	 * @dataProvider provideColors
	 */
	public function testNormalizeColor( $input, ?string $expected ): void {
		$this->assertSame( $expected, InputParser::normalizeColor( $input ) );
	}

	public static function provideCleanText(): iterable {
		yield 'plain' => [ 'Port theme', 'Port theme' ];
		yield 'line breaks' => [ "Line one\r\nLine two", 'Line one Line two' ];
		yield 'tabs and null bytes' => [ "\tA\0\0B\t", 'A B' ];
		yield 'strip marker byte' => [
			"a\x7f'\"`UNIQ--nowiki-00000000-QINU`\"'\x7fb",
			"a '\"`UNIQ--nowiki-00000000-QINU`\"' b",
		];
		yield 'unicode kept' => [ ' 港区 ', '港区' ];
	}

	/**
	 * @dataProvider provideCleanText
	 */
	public function testCleanText( string $input, string $expected ): void {
		$this->assertSame( $expected, InputParser::cleanText( $input ) );
	}

	public function testParseJsonCleansDisplayText(): void {
		$track = ( new InputParser() )->parseJson(
			'{"playlist":[{"audioFileUrl":"a.mp3","title":"A\\nB","artist":"\\u007fC","album":"D\\t"}]}'
		)->tracks[0];
		$this->assertSame( [ 'A B', 'C', 'D' ], [ $track->title, $track->artist, $track->album ] );
	}

	public static function provideFileLists(): iterable {
		yield 'single' => [ 'a.mp3', [ 'a.mp3' ] ];
		yield 'commas and spaces' => [ ' a.mp3 , b.mp3,c.mp3 ', [ 'a.mp3', 'b.mp3', 'c.mp3' ] ];
		yield 'empty entries dropped' => [ ',a.mp3,, ,b.mp3,', [ 'a.mp3', 'b.mp3' ] ];
		yield 'quoted comma kept' => [ '"a,b.mp3",c.mp3', [ 'a,b.mp3', 'c.mp3' ] ];
		yield 'quotes stripped once' => [ '""a.mp3""', [ '"a.mp3"' ] ];
		yield 'quoted with spaces' => [ ' " a.mp3 " ', [ 'a.mp3' ] ];
		yield 'empty quotes dropped' => [ '"",a.mp3', [ 'a.mp3' ] ];
		yield 'unbalanced quote splits on every comma' => [ '"a.mp3,b.mp3', [ '"a.mp3', 'b.mp3' ] ];
		yield 'unbalanced quotes ignore quoted commas' => [
			'"a,b.mp3",c.mp3,"d.mp3', [ '"a', 'b.mp3"', 'c.mp3', '"d.mp3' ]
		];
		yield 'inner quotes kept' => [ 'say "hi".mp3', [ 'say "hi".mp3' ] ];
		yield 'multibyte names' => [ '港区.mp3，x,船长.mp3', [ '港区.mp3，x', '船长.mp3' ] ];
		yield 'nothing' => [ '', [] ];
		yield 'only separators' => [ ' , , ', [] ];
	}

	/**
	 * @dataProvider provideFileLists
	 */
	public function testSplitFileList( string $input, array $expected ): void {
		$this->assertSame( $expected, InputParser::splitFileList( $input ) );
	}

	public static function provideFileListLimits(): iterable {
		yield 'under the limit' => [ 'a.mp3,b.mp3', 2, [ 'a.mp3', 'b.mp3' ] ];
		yield 'empty entries do not count' => [ 'a.mp3,, ,b.mp3,c.mp3,d.mp3', 2, [ 'a.mp3', 'b.mp3', 'c.mp3' ] ];
		yield 'quoted' => [ '"a,b.mp3",c.mp3,d.mp3', 1, [ 'a,b.mp3', 'c.mp3' ] ];
		yield 'unbalanced quotes' => [ '"a.mp3,b.mp3,c.mp3', 1, [ '"a.mp3', 'b.mp3' ] ];
		yield 'limit 0' => [ 'a.mp3,b.mp3', 0, [ 'a.mp3' ] ];
	}

	/**
	 * @dataProvider provideFileListLimits
	 */
	public function testSplitFileListStopsAfterTheLimit( string $input, int $limit, array $expected ): void {
		$this->assertSame( $expected, InputParser::splitFileList( $input, $limit ) );
	}

	public function testSplitFileListReadsOnlyWhatTheLimitNeeds(): void {
		$list = str_repeat( 'a.mp3,', 400000 );
		$this->assertCount( 6, InputParser::splitFileList( $list, 5 ) );
		$this->assertCount( 6, InputParser::splitFileList( '"q"' . $list, 5 ) );
	}

	public function testTrackLimit(): void {
		$parser = new InputParser();
		$this->assertCount( 2, $parser->parseLegacy( 'a.mp3,b.mp3', PlayerInput::MODE_PLAYER, false, [], 2 )->tracks );
		$this->assertNull( $parser->parseLegacy( ' , ', PlayerInput::MODE_PLAYER, false, [], 0 ) );
		$this->assertCount( 1, $parser->parseAudioButton( 'a.mp3', false, [], 1 )->tracks );
		$this->assertNull( $parser->parseAudioButton( ' ', false, [], 0 ) );
		$json = '{"playlist":[{"audioFileUrl":"a.mp3"},null,"c.mp3",{"audioFileUrl":"b.mp3"}]}';
		$this->assertCount( 2, $parser->parseJson( $json, 2 )->tracks );
		// Every object counts before the JSON is decoded, also an entry without audio
		$json = '{"playlist":[{"audioFileUrl":"a.mp3"},{"title":"no audio"},{"audioFileUrl":"b.mp3"}]}';
		$this->assertCount( 2, $parser->parseJson( $json, 3 )->tracks );
		$this->expectException( InputError::class );
		$parser->parseJson( $json, 2 );
	}

	public function testValuesAreReadAfterSplitting(): void {
		// `@` stands for a separator the parser keeps away from splitting, as for <nowiki>
		$parser = new InputParser( static fn ( string $value ): string => str_replace( '@', '|,', $value ) );
		$player = $parser->parseLegacy( 'a@b.mp3,c.mp3|title=x@y|loop@=yes', PlayerInput::MODE_BUTTON );
		$this->assertEquals(
			[ new TrackInput( 'a|,b.mp3', 'x|,y' ), new TrackInput( 'c.mp3', 'x|,y' ) ], $player->tracks
		);
		$this->assertEquals(
			[ new TrackInput( 'a|,b.mp3', 'T|,itle', 'A|,rtist' ) ],
			$parser->parseJson(
				'{"playlist":[{"audioFileUrl":"a@b.mp3","title":"T@itle","artist":"A@rtist"}]}'
			)->tracks
		);
		$this->assertEquals(
			[ new TrackInput( 'a|,b.mp3' ) ], $parser->parseAudioButton( ' a@b.mp3 ', false, [] )->tracks
		);
	}

	public function testLongPlaylistIsRefusedBeforeDecoding(): void {
		$json = '{"playlist":[' . rtrim( str_repeat( '{},', 700000 ), ',' ) . ']}';
		try {
			( new InputParser() )->parseJson( $json, 5000 );
			$this->fail( 'Expected an InputError' );
		} catch ( InputError $error ) {
			$this->assertSame( 'gramophone-too-many-tracks', $error->getMessageKey() );
		}
	}

	public function testBracesInStringsDoNotCountAsEntries(): void {
		$title = str_repeat( '{', 100 ) . '\\"{';
		$json = '{"playlist":[{"audioFileUrl":"a.mp3","title":"' . $title . '"},{"audioFileUrl":"b.mp3"}]}';
		$this->assertCount( 2, ( new InputParser() )->parseJson( $json, 2 )->tracks );
	}

	public static function provideTooManyTracks(): iterable {
		yield 'flashmp3' => [ static fn ( InputParser $parser ) => $parser->parseLegacy(
			'a.mp3,b.mp3,c.mp3', PlayerInput::MODE_PLAYER, false, [], 2
		) ];
		yield 'sm2' => [ static fn ( InputParser $parser ) => $parser->parseLegacy(
			str_repeat( 'a.mp3,', 100000 ), PlayerInput::MODE_BUTTON, false, [], 5000
		) ];
		yield 'ab' => [ static fn ( InputParser $parser ) => $parser->parseAudioButton( 'a.mp3', false, [], 0 ) ];
		yield 'modernsoundmanager' => [ static fn ( InputParser $parser ) => $parser->parseJson(
			'{"playlist":[{"audioFileUrl":"a.mp3"},{"audioFileUrl":"b.mp3"}]}', 1
		) ];
	}

	/**
	 * @dataProvider provideTooManyTracks
	 */
	public function testTooManyTracks( callable $parse ): void {
		try {
			$parse( new InputParser() );
			$this->fail( 'Expected an InputError' );
		} catch ( InputError $error ) {
			$this->assertSame( 'gramophone-too-many-tracks', $error->getMessageKey() );
		}
	}

	public static function provideIgnoredOptions(): iterable {
		yield 'value must be exactly yes' => [ 'a.mp3|autostart=Yes|loop=true|openplaylist=1' ];
		yield 'two equals signs' => [ 'a.mp3|autostart=yes=yes' ];
		yield 'no equals sign' => [ 'a.mp3|autostart|loop' ];
		yield 'key is case-sensitive' => [ 'a.mp3|AutoStart=yes' ];
	}

	/**
	 * @dataProvider provideIgnoredOptions
	 */
	public function testParseLegacyIgnoredOptions( string $text ): void {
		$player = ( new InputParser() )->parseLegacy( $text, PlayerInput::MODE_PLAYER );
		$this->assertFalse( $player->autoPlay );
		$this->assertFalse( $player->loop );
		$this->assertFalse( $player->playlistOpen );
	}

	public function testParseLegacyOptionWhitespace(): void {
		$player = ( new InputParser() )->parseLegacy(
			'a.mp3| autostart = yes |bg = #fff', PlayerInput::MODE_PLAYER, true
		);
		$this->assertTrue( $player->autoPlay );
		$this->assertSame( '#ffffff', $player->colors['background'] );
	}

	public static function provideHideMissing(): iterable {
		yield 'button with yes' => [ 'a.mp3|hidemissing=yes', PlayerInput::MODE_BUTTON, true ];
		yield 'spaces around the option' => [ 'a.mp3| hidemissing = yes ', PlayerInput::MODE_BUTTON, true ];
		yield 'value must be exactly yes' => [ 'a.mp3|hidemissing=Yes', PlayerInput::MODE_BUTTON, false ];
		yield 'off by default' => [ 'a.mp3', PlayerInput::MODE_BUTTON, false ];
		yield 'the player ignores it' => [ 'a.mp3|hidemissing=yes', PlayerInput::MODE_PLAYER, false ];
	}

	/**
	 * @dataProvider provideHideMissing
	 */
	public function testParseLegacyHideMissing( string $text, string $mode, bool $expected ): void {
		$this->assertSame( $expected, ( new InputParser() )->parseLegacy( $text, $mode )->hideMissing );
	}

	public function testParseLegacyReadsAttributes(): void {
		$player = ( new InputParser() )->parseLegacy(
			'a.mp3|loop=no',
			PlayerInput::MODE_PLAYER,
			true,
			[ 'autostart' => ' yes ', 'loop' => 'yes', 'openplaylist' => 'Yes', 'bg' => '#FFF', 'title' => 'T' ]
		);
		$this->assertEquals(
			new PlayerInput(
				PlayerInput::MODE_PLAYER,
				true,
				false,
				false,
				[ 'background' => '#ffffff' ] + self::NO_COLORS,
				[ new TrackInput( 'a.mp3' ) ]
			),
			$player
		);
	}

	public function testParseLegacyButtonTitle(): void {
		$parser = new InputParser();
		$this->assertEquals(
			[ new TrackInput( 'a.mp3', 'Captain: greeting' ), new TrackInput( 'b.mp3', 'Captain: greeting' ) ],
			$parser->parseLegacy( 'a.mp3,b.mp3', PlayerInput::MODE_BUTTON, false, [ 'title' => "Captain:\ngreeting" ] )
				->tracks
		);
		$this->assertEquals(
			[ new TrackInput( 'a.mp3', 'Content' ) ],
			$parser->parseLegacy( 'a.mp3|title=Content', PlayerInput::MODE_BUTTON, false, [ 'title' => 'Attribute' ] )
				->tracks
		);
	}

	public function testParseAudioButton(): void {
		$parser = new InputParser();
		$this->assertEquals(
			new PlayerInput(
				PlayerInput::MODE_BUTTON,
				false,
				false,
				false,
				self::NO_COLORS,
				[ new TrackInput( '"Hello, world|1".mp3', 'Hi' ) ],
				true
			),
			$parser->parseAudioButton(
				' "Hello, world|1".mp3 ', false, [ 'hidemissing' => 'yes', 'title' => 'Hi', 'vol' => '0.5' ]
			)
		);
		$this->assertNull( $parser->parseAudioButton( " \n ", false, [ 'title' => 'Hi' ] ) );
	}

	public static function provideEmptyLegacy(): iterable {
		yield 'empty' => [ '' ];
		yield 'spaces' => [ "  \n " ];
		yield 'options only' => [ '|autostart=yes' ];
		yield 'empty entries' => [ ' , "" ,|loop=yes' ];
	}

	/**
	 * @dataProvider provideEmptyLegacy
	 */
	public function testParseLegacyWithoutFiles( string $text ): void {
		$this->assertNull( ( new InputParser() )->parseLegacy( $text, PlayerInput::MODE_PLAYER ) );
	}

	public static function provideOffsets(): iterable {
		yield 'integer' => [ '1500', 1500 ];
		yield 'negative' => [ '-20', -20 ];
		yield 'rounded' => [ '12.5', 13 ];
		yield 'exponent' => [ '1e3', 1000 ];
		yield 'too large' => [ '1e12', 0 ];
		yield 'overflow' => [ '1e999', 0 ];
	}

	/**
	 * @dataProvider provideOffsets
	 */
	public function testParseJsonLyricsOffset( string $offset, int $expected ): void {
		$player = ( new InputParser() )->parseJson(
			'{"playlist":[{"audioFileUrl":"a.mp3","lrcFileOffset":' . $offset . '}]}'
		);
		$this->assertSame( $expected, $player->tracks[0]->lyricsOffset );
	}

	public function testParseJsonSkipsEntriesWithoutAudio(): void {
		$player = ( new InputParser() )->parseJson(
			'{"playlist":[null,"a.mp3",{"title":"No file"},{"audioFileUrl":null},{"audioFileUrl":""},'
				. '{"audioFileUrl":"  "},{"audioFileUrl":0},{"audioFileUrl":false},{"audioFileUrl":[]},'
				. '{"audioFileUrl":{}},{"audioFileUrl":" b.mp3 "}]}'
		);
		$this->assertEquals( [ new TrackInput( 'b.mp3' ) ], $player->tracks );
	}

	public static function provideInvalidJson(): iterable {
		yield 'syntax error' => [ '{oops}', 'gramophone-invalidJson' ];
		yield 'trailing comma' => [ '{"playlist":[],}', 'gramophone-invalidJson' ];
		yield 'array' => [ '[{"audioFileUrl":"a.mp3"}]', 'gramophone-invalidJson' ];
		yield 'string' => [ '"a.mp3"', 'gramophone-invalidJson' ];
		yield 'null' => [ 'null', 'gramophone-invalidJson' ];
		yield 'nested 600 levels deep' => [
			'{"playlist":[{"audioFileUrl":"a.mp3"}],"x":' . str_repeat( '[', 600 ) . str_repeat( ']', 600 ) . '}',
			'gramophone-invalidJson'
		];
		yield 'no playlist' => [ '{}', 'gramophone-playlistRequired' ];
		yield 'empty playlist' => [ '{"playlist":[]}', 'gramophone-playlistRequired' ];
		yield 'playlist object' => [ '{"playlist":{"audioFileUrl":"a.mp3"}}', 'gramophone-playlistRequired' ];
		yield 'playlist string' => [ '{"playlist":"a.mp3"}', 'gramophone-playlistRequired' ];
		yield 'only skipped entries' => [
			'{"playlist":[null,"a.mp3",["a.mp3"],{"title":"x"},{"audioFileUrl":null}]}', 'gramophone-playlistRequired'
		];
		yield 'only unusable audioFileUrl values' => [
			'{"playlist":[{"audioFileUrl":""},{"audioFileUrl":"  "},{"audioFileUrl":42},{"audioFileUrl":false},'
				. '{"audioFileUrl":["a.mp3"]},{"audioFileUrl":{}}]}',
			'gramophone-playlistRequired'
		];
	}

	/**
	 * @dataProvider provideInvalidJson
	 */
	public function testParseJsonErrors( string $json, string $messageKey ): void {
		try {
			( new InputParser() )->parseJson( $json );
			$this->fail( 'Expected an InputError' );
		} catch ( InputError $error ) {
			$this->assertSame( $messageKey, $error->getMessageKey() );
		}
	}
}
