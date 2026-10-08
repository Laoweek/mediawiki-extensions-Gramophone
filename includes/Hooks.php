<?php

namespace MediaWiki\Extension\Gramophone;

use JsonException;
use MediaWiki\Config\Config;
use MediaWiki\Hook\ParserFirstCallInitHook;
use MediaWiki\Parser\Parser;
use MediaWiki\Parser\PPFrame;
use MediaWiki\Parser\Sanitizer;
use MediaWiki\Parser\StripState;
use MediaWiki\Utils\UrlUtils;
use WeakMap;

/**
 * Registers the parser tags and turns each tag into a player.
 *
 * - `<gramophone>` is the full player. It takes a JSON playlist, or a file list in the
 *   `FILES|key=value` syntax with the same options as tag attributes
 * - `<playbutton>` is a compact inline play button, with the file list syntax
 *
 * For compatibility:
 *
 * - `<flashmp3>` and `<sm2>` of Sm2Shim and FlashMP3 read the file list syntax like
 *   `<gramophone>` and `<playbutton>`, and `<modernsoundmanager>` takes a JSON playlist. They are
 *   registered only with $wgGramophoneSm2ShimTags, which is on by default
 * - `<ab>`, only with $wgGramophoneAudioButtonTag, is AudioButton's tag rendered as `<playbutton>`
 *
 * The `class` and `style` attributes of every tag go to the host element. The tags of one page
 * have at most MAX_TRACKS_PER_PAGE tracks together.
 */
class Hooks implements ParserFirstCallInitHook {

	/** Most tracks that the tags of one page may have together */
	public const MAX_TRACKS_PER_PAGE = 5000;

	/** Tag attributes passed on to the host element, sanitised as on a `div` */
	private const HOST_ATTRIBUTES = [ 'class' => true, 'style' => true ];

	private PlayerRenderer $renderer;

	/**
	 * Tracks rendered so far on each page, by the parser's strip state. The parser starts a new
	 * strip state for each page, also when Parsoid has it render one extension tag at a time with
	 * a new ParserOutput each. Kept here rather than in the ParserOutput so that the count stays
	 * out of the parser cache, and dropped with the strip state.
	 *
	 * @var WeakMap<StripState,int>
	 */
	private WeakMap $tracksUsed;

	public function __construct(
		private readonly Config $config,
		private readonly UrlUtils $urlUtils
	) {
		$this->renderer = new PlayerRenderer();
		$this->tracksUsed = new WeakMap();
	}

	/**
	 * @param Parser $parser
	 */
	public function onParserFirstCallInit( $parser ) {
		$parser->setHook( 'gramophone', [ $this, 'renderGramophone' ] );
		$parser->setHook( 'playbutton', [ $this, 'renderSm2' ] );
		if ( $this->config->get( 'GramophoneSm2ShimTags' ) ) {
			$parser->setHook( 'flashmp3', [ $this, 'renderFlashMp3' ] );
			$parser->setHook( 'sm2', [ $this, 'renderSm2' ] );
			$parser->setHook( 'modernsoundmanager', [ $this, 'renderModernSoundManager' ] );
		}
		if ( $this->config->get( 'GramophoneAudioButtonTag' ) ) {
			$parser->setHook( 'ab', [ $this, 'renderAudioButton' ] );
		}
	}

	/**
	 * `<gramophone>`: full player. Content that starts with `{`, as the reader sees it, is a JSON
	 * playlist read as in `<modernsoundmanager>`. Other content is a file list read as in
	 * `<flashmp3>`, without its `type="lastfm"` switch.
	 *
	 * @param string|null $text Tag content, null when self-closed
	 * @param string[] $attributes
	 * @param Parser $parser
	 * @param PPFrame $frame
	 * @return string HTML
	 */
	public function renderGramophone( ?string $text, array $attributes, Parser $parser, PPFrame $frame ): string {
		// A file list starts with a file name or URL. MediaWiki titles cannot contain `{`, so only
		// a JSON playlist starts with one.
		if ( str_starts_with( ltrim( self::unstrip( $parser, $text ?? '' ) ), '{' ) ) {
			return $this->renderModernSoundManager( $text, $attributes, $parser, $frame );
		}
		return $this->renderFileList( $text, $attributes, $parser, PlayerInput::MODE_PLAYER );
	}

	/**
	 * `<flashmp3>`: full player. The attribute `type="lastfm"` disables it.
	 *
	 * @param string|null $text Tag content, null when self-closed
	 * @param string[] $attributes
	 * @param Parser $parser
	 * @param PPFrame $frame
	 * @return string HTML
	 */
	public function renderFlashMp3( ?string $text, array $attributes, Parser $parser, PPFrame $frame ): string {
		if ( strtolower( trim( $attributes['type'] ?? '' ) ) === 'lastfm' ) {
			return '';
		}
		return $this->renderFileList( $text, $attributes, $parser, PlayerInput::MODE_PLAYER );
	}

	/**
	 * `<playbutton>` and `<sm2>`: compact inline play button.
	 *
	 * @param string|null $text Tag content, null when self-closed
	 * @param string[] $attributes
	 * @param Parser $parser
	 * @param PPFrame $frame
	 * @return string HTML
	 */
	public function renderSm2( ?string $text, array $attributes, Parser $parser, PPFrame $frame ): string {
		return $this->renderFileList( $text, $attributes, $parser, PlayerInput::MODE_BUTTON );
	}

	/**
	 * A tag with the file list syntax `FILES|key=value`, whose options can also be attributes.
	 *
	 * @param string|null $text Tag content, null when self-closed
	 * @param string[] $attributes
	 * @param Parser $parser
	 * @param string $mode PlayerInput::MODE_PLAYER or PlayerInput::MODE_BUTTON
	 * @return string HTML
	 */
	private function renderFileList( ?string $text, array $attributes, Parser $parser, string $mode ): string {
		return $this->renderTag( $parser, $text ?? '', $attributes,
			fn ( InputParser $input, string $text, array $options, int $maxTracks ): ?PlayerInput =>
				$input->parseLegacy( $text, $mode, $this->legacyColors(), $options, $maxTracks )
		);
	}

	/**
	 * `<ab>` from the AudioButton extension, as a `<playbutton>` button. As in AudioButton, the
	 * content is one file name and templates in it are expanded. The `<playbutton>` options are
	 * tag attributes. AudioButton's `vol` and `preload` are ignored.
	 *
	 * @param string|null $text Tag content, null when self-closed
	 * @param string[] $attributes
	 * @param Parser $parser
	 * @param PPFrame $frame
	 * @return string HTML
	 */
	public function renderAudioButton( ?string $text, array $attributes, Parser $parser, PPFrame $frame ): string {
		return $this->renderTag( $parser, $parser->recursivePreprocess( $text ?? '', $frame ), $attributes,
			fn ( InputParser $input, string $text, array $options, int $maxTracks ): ?PlayerInput =>
				$input->parseAudioButton( $text, $this->legacyColors(), $options, $maxTracks )
		);
	}

	/**
	 * `<modernsoundmanager>`, and `<gramophone>` with JSON content: full player from a JSON playlist.
	 *
	 * @param string|null $text Tag content, null when self-closed
	 * @param string[] $attributes
	 * @param Parser $parser
	 * @param PPFrame $frame
	 * @return string HTML
	 */
	public function renderModernSoundManager(
		?string $text, array $attributes, Parser $parser, PPFrame $frame
	): string {
		return $this->renderTag( $parser, $text ?? '', $attributes,
			static function ( InputParser $input, string $text, array $options, int $maxTracks ) use ( $parser ) {
				$plain = self::unstrip( $parser, $text );
				if ( trim( $plain ) === '' ) {
					return null;
				}
				try {
					// A strip marker holds `"`, which would end a JSON string. Escaped, the marker
					// stays in the string values, where the InputParser reads it.
					return $input->parseJson( self::escapeMarkersForJson( $text ), $maxTracks );
				} catch ( InputError $error ) {
					// The whole playlist can be inside <nowiki>, as `{{#tag:...}}` needs for `}}`
					if ( $error->getMessageKey() !== 'gramophone-invalidJson' || $plain === $text ) {
						throw $error;
					}
					return $input->parseJson( $plain, $maxTracks );
				}
			}
		);
	}

	/**
	 * Whether the file list tags apply their bg, text, tracker and track colours
	 * ($wgGramophoneLegacyColors). By default they do not: many pages carry Flash-era colours that
	 * would hide the site theme.
	 */
	private function legacyColors(): bool {
		return (bool)$this->config->get( 'GramophoneLegacyColors' );
	}

	/**
	 * Read a tag and render it, within the page's track budget.
	 *
	 * Strip markers, such as those of `<nowiki>` in a `{{#tag:...}}` argument, stay in the
	 * content until the InputParser has split it, so that a `|` or `,` in `<nowiki>` is text.
	 * Each value then shows `<nowiki>` content as its text and loses other markers, see
	 * unstrip(). Attribute values are read the same way.
	 *
	 * @param Parser $parser
	 * @param string $text Tag content
	 * @param string[] $attributes Tag attributes
	 * @param callable $parse `fn ( InputParser $input, string $text, array $attributes,
	 *  int $maxTracks ): ?PlayerInput`, which may throw an InputError
	 * @return string HTML
	 */
	private function renderTag( Parser $parser, string $text, array $attributes, callable $parse ): string {
		$unstrip = static fn ( string $value ): string => self::unstrip( $parser, $value );
		$attributes = array_map( $unstrip, $attributes );
		$page = $parser->getStripState();
		$tracksUsed = $this->tracksUsed[$page] ?? 0;
		try {
			$player = $parse(
				new InputParser( $unstrip ), $text, $attributes, self::MAX_TRACKS_PER_PAGE - $tracksUsed
			);
		} catch ( InputError $error ) {
			return $this->renderError( $parser, $error->getMessageKey() );
		}
		if ( !$player ) {
			return '';
		}
		$this->tracksUsed[$page] = $tracksUsed + count( $player->tracks );
		return $this->renderPlayer( $parser, $player, $attributes );
	}

	/**
	 * A value as the reader sees it: the content of `<nowiki>` as its literal text, with
	 * entities decoded, and other strip markers removed.
	 */
	private static function unstrip( Parser $parser, string $value ): string {
		$value = $parser->getStripState()->replaceNoWikis(
			$value,
			static fn ( string $content ): string => Sanitizer::decodeCharReferences( $content )
		);
		return $parser->killMarkers( $value );
	}

	/**
	 * Escape the `"` in each strip marker, so that a marker inside a JSON string keeps the
	 * string whole and is part of its value.
	 */
	private static function escapeMarkersForJson( string $json ): string {
		return preg_replace_callback(
			'/' . preg_quote( Parser::MARKER_PREFIX, '/' ) . '.*?' . preg_quote( Parser::MARKER_SUFFIX, '/' ) . '/s',
			static fn ( array $match ): string => str_replace( '"', '\\"', $match[0] ),
			$json
		);
	}

	private function renderPlayer( Parser $parser, PlayerInput $player, array $tagAttributes ): string {
		$parser->addTrackingCategory( 'gramophone-tracking-category' );
		$resolver = new TrackResolver( $parser, $this->config, $this->urlUtils );
		$resolver->preloadLinks( $player->tracks );
		$tracks = array_map(
			static fn ( TrackInput $track ): array => $resolver->resolve( $track, $player->hideMissing ),
			$player->tracks
		);
		$linkAttributes = array_map( [ $resolver, 'fallbackLinkAttributes' ], $player->tracks );
		if ( $player->autoPlay && !$resolver->mayAutoPlay( $player->tracks ) ) {
			$player = $player->withoutAutoPlay();
		}
		try {
			$html = $this->renderer->render(
				$player, $tracks, $linkAttributes, $this->variantConverter( $parser ),
				Sanitizer::validateTagAttributes( array_intersect_key( $tagAttributes, self::HOST_ATTRIBUTES ), 'div' )
			);
		} catch ( JsonException $e ) {
			return $this->renderError( $parser, 'gramophone-unknown' );
		}

		$output = $parser->getOutput();
		$output->addModuleStyles( [ 'ext.gramophone.styles' ] );
		$output->addModules( [ 'ext.gramophone' ] );
		if ( $player->mode === PlayerInput::MODE_PLAYER ) {
			$output->addModules( [ 'ext.gramophone.player' ] );
		}
		return $html;
	}

	/**
	 * Conversion of display text to the reader's language variant, for example zh-hans to
	 * zh-tw, under the same conditions as the parser's own conversion pass.
	 *
	 * That pass converts the fallback links but never attributes, so the client data needs
	 * converting here. Unlike the page text, `__NOCONTENTCONVERT__` is not honoured: tags are
	 * expanded before the parser reads double-underscore switches.
	 *
	 * @param Parser $parser
	 * @return callable|null `fn ( string $text ): string`, or null when the text stays as written
	 */
	private function variantConverter( Parser $parser ): ?callable {
		$options = $parser->getOptions();
		$converter = $parser->getTargetLanguageConverter();
		if ( !$converter->hasVariants()
			|| $options->getDisableContentConversion()
			|| $options->getInterfaceMessage()
		) {
			return null;
		}
		return static fn ( string $text ): string => $converter->convert( $text );
	}

	/**
	 * Inline error for invalid tag content. The page still joins the tracking category so
	 * that broken players are easy to find.
	 */
	private function renderError( Parser $parser, string $messageKey ): string {
		$parser->addTrackingCategory( 'gramophone-tracking-category' );
		$reason = $parser->msg( $messageKey );
		if ( $messageKey === 'gramophone-too-many-tracks' ) {
			$reason->numParams( self::MAX_TRACKS_PER_PAGE );
		}
		return $this->renderer->renderError( $parser->msg( 'gramophone-error', $reason->text() )->text() );
	}
}
