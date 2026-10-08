<?php

namespace MediaWiki\Extension\Gramophone;

use MediaWiki\Extension\TemplateStyles\Hooks\TemplateStylesPropertySanitizerHook;
use Wikimedia\CSS\Grammar\MatcherFactory;
use Wikimedia\CSS\Sanitizer\StylePropertySanitizer;

/**
 * Lets TemplateStyles sheets set the players' public `--gramophone-*` custom properties.
 *
 * A handler of its own, so that its TemplateStyles interface is only loaded when TemplateStyles
 * runs the hook.
 */
class TemplateStylesHooks implements TemplateStylesPropertySanitizerHook {

	/** Public colour properties, as listed in the README's Theming section */
	private const COLORS = [
		'--gramophone-background', '--gramophone-foreground', '--gramophone-muted',
		'--gramophone-muted-foreground', '--gramophone-border', '--gramophone-accent',
		'--gramophone-accent-foreground', '--gramophone-primary', '--gramophone-primary-foreground',
		'--gramophone-primary-hover', '--gramophone-primary-soft', '--gramophone-highlight',
		'--gramophone-ring', '--gramophone-track', '--gramophone-range', '--gramophone-buffered',
		'--gramophone-thumb', '--gramophone-destructive', '--gramophone-cover-from',
		'--gramophone-cover-to', '--gramophone-cover-foreground',
	];

	/** Public size properties */
	private const LENGTHS = [ '--gramophone-cover-size', '--gramophone-row-height', '--gramophone-button-size' ];

	/** Public size properties that may also be a percentage */
	private const LENGTH_PERCENTAGES = [ '--gramophone-radius', '--gramophone-max-width' ];

	/**
	 * @param StylePropertySanitizer &$propertySanitizer
	 * @param MatcherFactory $matcherFactory
	 */
	public function onTemplateStylesPropertySanitizer(
		StylePropertySanitizer &$propertySanitizer,
		MatcherFactory $matcherFactory
	) {
		// Names must be lowercase. safeColor() refuses a bare var(), so a value cannot be just
		// another custom property. The font and the shadow take what font-family and box-shadow
		// take, unless the wiki disallows those ($wgTemplateStylesDisallowedProperties).
		$known = $propertySanitizer->getKnownProperties();
		$properties = array_fill_keys( self::COLORS, $matcherFactory->safeColor() )
			+ array_fill_keys( self::LENGTHS, $matcherFactory->length() )
			+ array_fill_keys( self::LENGTH_PERCENTAGES, $matcherFactory->lengthPercentage() );
		if ( isset( $known['font-family'] ) ) {
			$properties['--gramophone-font-family'] = $known['font-family'];
		}
		if ( isset( $known['box-shadow'] ) ) {
			$properties['--gramophone-shadow'] = $known['box-shadow'];
		}
		$propertySanitizer->addKnownProperties( $properties );
	}
}
