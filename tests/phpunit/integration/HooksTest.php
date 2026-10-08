<?php

namespace MediaWiki\Extension\Gramophone\Tests\Integration;

use MediaWiki\Extension\Gramophone\Hooks;
use MediaWiki\Extension\Gramophone\TrackInput;
use MediaWiki\Extension\Gramophone\TrackResolver;
use MediaWiki\Parser\ParserOptions;
use MediaWiki\Parser\ParserOutput;
use MediaWiki\Parser\ParserOutputLinkTypes;
use MediaWiki\Title\Title;
use MediaWikiIntegrationTestCase;

/**
 * Checks the page metadata the tags add. The HTML itself is covered by the parser tests.
 *
 * @group Database
 * @covers \MediaWiki\Extension\Gramophone\Hooks
 * @covers \MediaWiki\Extension\Gramophone\TrackResolver
 */
class HooksTest extends MediaWikiIntegrationTestCase {

	private const TRACKING = 'Pages_with_audio_players';

	protected function setUp(): void {
		parent::setUp();
		$this->setUserLang( 'en' );
		$this->overrideConfigValue( 'LanguageCode', 'en' );
	}

	private function parse( string $wikitext ): ParserOutput {
		$parser = $this->getServiceContainer()->getParserFactory()->create();
		return $parser->parse(
			$wikitext, Title::makeTitle( NS_MAIN, 'Gramophone test' ), ParserOptions::newFromAnon()
		);
	}

	/**
	 * @return array Data from the `data-mw-gramophone` attribute of each host, in page order
	 */
	private static function clientData( string $html ): array {
		// Parsoid writes the attribute in single quotes
		preg_match_all( '/data-mw-gramophone=(?:"([^"]*)"|\'([^\']*)\')/', $html, $matches, PREG_SET_ORDER );
		return array_map(
			static fn ( array $match ): array => json_decode(
				html_entity_decode( $match[1] !== '' ? $match[1] : $match[2], ENT_QUOTES | ENT_HTML5 ), true
			),
			$matches
		);
	}

	public static function providePlayers(): iterable {
		$player = [ 'ext.gramophone', 'ext.gramophone.player' ];
		yield 'gramophone with a file list' => [ '<gramophone>https://example.com/a.mp3</gramophone>', $player ];
		yield 'gramophone with JSON' => [
			'<gramophone>{"playlist":[{"audioFileUrl":"https://example.com/a.mp3"}]}</gramophone>', $player
		];
		yield 'playbutton' => [ 'Text <playbutton>https://example.com/a.mp3</playbutton>', [ 'ext.gramophone' ] ];
		yield 'flashmp3' => [ '<flashmp3>https://example.com/a.mp3</flashmp3>', $player ];
		yield 'sm2' => [ 'Text <sm2>https://example.com/a.mp3</sm2>', [ 'ext.gramophone' ] ];
		yield 'modernsoundmanager' => [
			'<modernsoundmanager>{"playlist":[{"audioFileUrl":"https://example.com/a.mp3"}]}</modernsoundmanager>',
			$player
		];
		yield 'a player and a button' => [
			'<sm2>https://example.com/a.mp3</sm2> <flashmp3>https://example.com/a.mp3</flashmp3>', $player
		];
	}

	/**
	 * @dataProvider providePlayers
	 */
	public function testPlayerAddsModulesAndTrackingCategory( string $wikitext, array $modules ): void {
		$output = $this->parse( $wikitext );
		$this->assertSame( $modules, $output->getModules() );
		$this->assertSame( [ 'ext.gramophone.styles' ], $output->getModuleStyles() );
		$this->assertSame( [ self::TRACKING ], $output->getCategoryNames() );
		$this->assertSame( [], $output->getHeadItems(), 'No head items or inline scripts' );
		$this->assertStringNotContainsString( '<script', $output->getRawText() );
	}

	public static function provideNoFollow(): iterable {
		yield 'nofollow off' => [ [ 'NoFollowLinks' => false ], null ];
		yield 'namespace exception' => [ [ 'NoFollowLinks' => true, 'NoFollowNsExceptions' => [ NS_MAIN ] ], null ];
	}

	/**
	 * @dataProvider provideNoFollow
	 */
	public function testExternalFallbackLinkNoFollow( array $config, ?string $expectedRel ): void {
		$this->overrideConfigValues( $config );
		$html = $this->parse( '<sm2>https://example.com/a.mp3,Gramophone missing.mp3</sm2>' )->getRawText();
		$this->assertSame( $expectedRel === null ? 0 : 1, substr_count( $html, 'rel="nofollow"' ) );
		$this->assertSame(
			[ $expectedRel !== null, false ],
			array_map(
				static fn ( array $track ): bool => $track['nofollow'] ?? false,
				self::clientData( $html )[0]['tracks']
			),
			'The client data marks the same tracks'
		);
	}

	/**
	 * @dataProvider provideNoFollow
	 */
	public function testExternalNavigationLinkNoFollow( array $config, ?string $expectedRel ): void {
		$this->overrideConfigValues( $config );
		$html = $this->parse( '<modernsoundmanager>{"playlist":[{"audioFileUrl":"Gramophone missing.mp3"},'
			. '{"audioFileUrl":"/images/a.mp3","navigationUrl":"https://example.com/page"}]}</modernsoundmanager>'
		)->getRawText();
		$this->assertSame(
			[ false, $expectedRel !== null ],
			array_map(
				static fn ( array $track ): bool => $track['nofollow'] ?? false,
				self::clientData( $html )[0]['tracks']
			)
		);
		$this->assertStringNotContainsString( 'rel="nofollow"', $html, 'The fallback link goes to the audio' );
	}

	public static function provideNothing(): iterable {
		yield 'self-closed gramophone' => [ '<gramophone/>' ];
		yield 'lastfm' => [ '<flashmp3 type="lastfm">a.mp3</flashmp3>' ];
		yield 'empty flashmp3' => [ '<flashmp3></flashmp3>' ];
		yield 'self-closed sm2' => [ '<sm2/>' ];
		yield 'empty modernsoundmanager' => [ '<modernsoundmanager> </modernsoundmanager>' ];
	}

	/**
	 * @dataProvider provideNothing
	 */
	public function testEmptyTagsAddNothing( string $wikitext ): void {
		$output = $this->parse( $wikitext );
		$this->assertSame( [], $output->getModules() );
		$this->assertSame( [], $output->getModuleStyles() );
		$this->assertSame( [], $output->getCategoryNames() );
		$this->assertSame( '', trim( $output->getRawText() ) );
	}

	public function testErrorIsTrackedWithoutModules(): void {
		$output = $this->parse( '<modernsoundmanager>{oops}</modernsoundmanager>' );
		$this->assertSame( [], $output->getModules() );
		$this->assertSame( [ self::TRACKING ], $output->getCategoryNames() );
		$this->assertStringContainsString(
			'<strong class="error ext-gramophone-error">'
				. 'Audio player error: The playlist is not a valid JSON object.</strong>',
			$output->getRawText()
		);
	}

	public function testImageWhitelistAllowsCoversHidemissingChecksAndAutoplay(): void {
		$this->overrideConfigValues( [
			'AllowExternalImages' => false,
			'EnableImageWhitelist' => true,
			'UseDatabaseMessages' => true,
		] );
		// A line that is not a valid expression is ignored without a PHP warning
		$this->editPage( 'MediaWiki:External image whitelist', "# A comment\n[unclosed(\n^https://img\\.example/\n" );
		$data = self::clientData( $this->parse(
			'<modernsoundmanager>{"autoPlay":true,"playlist":['
				. '{"audioFileUrl":"https://img.example/a.mp3","coverImageUrl":"//img.example/c.jpg"},'
				. '{"audioFileUrl":"https://img.example/b.mp3","coverImageUrl":"https://other.example/c.jpg"}'
				. ']}</modernsoundmanager>'
				. '<modernsoundmanager>{"autoPlay":true,"playlist":[{"audioFileUrl":"https://other.example/a.mp3"}]}'
				. '</modernsoundmanager>'
				. '<sm2>https://img.example/a.mp3,https://other.example/a.mp3|hidemissing=yes</sm2>'
		)->getRawText() );

		$this->assertTrue( $data[0]['autoPlay'] ?? false );
		$this->assertSame(
			[ '//img.example/c.jpg', null ],
			array_map( static fn ( array $track ): ?string => $track['cover'] ?? null, $data[0]['tracks'] )
		);
		$this->assertFalse( $data[1]['autoPlay'] ?? false, 'Audio on another host may not start on its own' );
		$this->assertSame(
			[ true, false ],
			array_map( static fn ( array $track ): bool => $track['verify'] ?? false, $data[2]['tracks'] )
		);
	}

	public function testTracksArePerPage(): void {
		$this->overrideConfigValue( 'GramophoneAudioButtonTag', true );
		$output = $this->parse(
			'<sm2>' . str_repeat( 'https://example.com/a.mp3,', Hooks::MAX_TRACKS_PER_PAGE - 1 ) . '</sm2>'
			// Two tracks are over the budget, one is not. A tag over the budget uses none of it.
			. '<sm2>https://example.com/a.mp3,https://example.com/b.mp3</sm2>'
			. '<modernsoundmanager>{"playlist":[{"audioFileUrl":"a.mp3"},{"audioFileUrl":"b.mp3"}]}'
			. '</modernsoundmanager>'
			. '<sm2>https://example.com/c.mp3</sm2>'
			. '<ab>https://example.com/d.mp3</ab>'
			. '<flashmp3>https://example.com/e.mp3</flashmp3>'
		);
		$html = $output->getRawText();
		$this->assertSame(
			[ Hooks::MAX_TRACKS_PER_PAGE - 1, 1 ],
			array_map( static fn ( array $data ): int => count( $data['tracks'] ), self::clientData( $html ) )
		);
		$this->assertSame( 4, substr_count(
			$html,
			'<strong class="error ext-gramophone-error">Audio player error: This page has too many audio tracks. '
				. 'The players on one page can have at most 5,000 tracks together.</strong>'
		) );
		$this->assertSame(
			[ 'https://example.com/a.mp3', 'https://example.com/c.mp3' ], array_keys( $output->getExternalLinks() )
		);

		$this->assertCount( 1, self::clientData( $this->parse( '<sm2>https://example.com/a.mp3</sm2>' )->getRawText() ),
			'The next parse starts with a new budget' );
	}

	public function testExactlyTheTrackLimitRenders(): void {
		$html = $this->parse(
			'<sm2>' . str_repeat( 'https://example.com/a.mp3,', Hooks::MAX_TRACKS_PER_PAGE ) . '</sm2>'
		)->getRawText();
		$data = self::clientData( $html );
		$this->assertCount( 1, $data );
		$this->assertCount( Hooks::MAX_TRACKS_PER_PAGE, $data[0]['tracks'] );
		$this->assertStringNotContainsString( 'ext-gramophone-error', $html );
	}

	public function testTracksArePerPageWithParsoid(): void {
		// Parsoid renders each tag with a new ParserOutput, but on the same page
		$tag = '<sm2>' . str_repeat( 'https://example.com/a.mp3,', 3000 ) . '</sm2>';
		$html = $this->getServiceContainer()->getParsoidParserFactory()->create()->parse(
			"$tag\n\n$tag", Title::makeTitle( NS_MAIN, 'Gramophone test' ), ParserOptions::newFromAnon()
		)->getRawText();
		$this->assertCount( 1, self::clientData( $html ) );
		$this->assertStringContainsString( 'This page has too many audio tracks.', $html );
	}

	public function testPreloadLinksLooksUpEveryPageAtOnce(): void {
		$this->editPage( 'Gramophone existing page', 'Text' );
		$services = $this->getServiceContainer();
		$linkCache = $services->getLinkCache();
		$linkCache->clear();
		$resolver = new TrackResolver(
			$services->getParserFactory()->create(), $services->getMainConfig(), $services->getUrlUtils()
		);
		$resolver->preloadLinks( [
			new TrackInput( 'a.mp3', '', '', '', false, '', '', 0, 'Gramophone missing page' ),
			new TrackInput( 'a.mp3', '', '', '', false, '', '', 0, 'Gramophone existing page' ),
			new TrackInput( 'a.mp3', '', '', '', false, '', '', 0, 'https://example.com/page' ),
			new TrackInput( 'a.mp3' ),
		] );
		$this->assertTrue( $linkCache->isBadLink( Title::makeTitle( NS_MAIN, 'Gramophone_missing_page' ) ) );
		$this->assertGreaterThan(
			0, $linkCache->getGoodLinkID( Title::makeTitle( NS_MAIN, 'Gramophone_existing_page' ) )
		);
	}

	public function testNavigationLinksKeepTheirPageIds(): void {
		$this->editPage( 'Gramophone existing page', 'Text' );
		$this->getServiceContainer()->getLinkCache()->clear();
		$playlist = [];
		for ( $i = 0; $i < 20; $i++ ) {
			$playlist[] = [ 'audioFileUrl' => 'https://example.com/a.mp3', 'navigationUrl' => "Gramophone page $i" ];
		}
		$playlist[] = [ 'audioFileUrl' => 'https://example.com/a.mp3', 'navigationUrl' => 'Gramophone existing page' ];

		$output = $this->parse(
			'<modernsoundmanager>' . json_encode( [ 'playlist' => $playlist ] ) . '</modernsoundmanager>'
		);
		$ids = [];
		foreach ( $output->getLinkList( ParserOutputLinkTypes::LOCAL ) as $item ) {
			$ids[$item['link']->getDBkey()] = $item['pageid'];
		}
		$this->assertCount( 21, $ids );
		$this->assertSame( 0, $ids['Gramophone_page_0'] );
		$this->assertGreaterThan( 0, $ids['Gramophone_existing_page'] );
	}
}
