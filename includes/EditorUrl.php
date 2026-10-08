<?php

namespace MediaWiki\Extension\Gramophone;

/**
 * Checks for URLs written by editors. Three forms are accepted, as the old Sm2Shim played
 * them: absolute http(s) URLs, protocol-relative URLs (`//host/path`) and paths on this site
 * (`/path`). Other schemes such as javascript: and data: never reach the page.
 */
final class EditorUrl {

	/**
	 * Whether the reference is meant as a URL rather than a wiki file or page name.
	 */
	public static function isUrl( string $reference ): bool {
		return preg_match( '#^(?:https?://|/)#i', trim( $reference ) ) === 1;
	}

	/**
	 * Whether the URL is a path on this site: one leading slash, not two.
	 */
	public static function isSameSite( string $url ): bool {
		return preg_match( '#^/(?!/)#', $url ) === 1;
	}

	/**
	 * Validate a URL.
	 *
	 * Protocol-relative URLs stay protocol-relative, so they follow the protocol of the page,
	 * the same way MediaWiki's own upload URLs can.
	 *
	 * @param string $url
	 * @return string|null The URL with spaces percent-encoded, or null when it is not usable
	 */
	public static function sanitize( string $url ): ?string {
		$url = str_replace( ' ', '%20', trim( $url ) );
		// Tabs, line breaks and other control characters have no place in a URL. Backslashes
		// are refused too, because browsers read `/\host` as `//host`.
		if ( preg_match( '/[\x00-\x1F\x7F\\\\]/', $url ) === 1 ) {
			return null;
		}
		if ( self::isSameSite( $url ) ) {
			return $url;
		}
		$parts = parse_url( str_starts_with( $url, '//' ) ? "https:$url" : $url );
		if ( !is_array( $parts ) || !isset( $parts['scheme'] ) || ( $parts['host'] ?? '' ) === '' ) {
			return null;
		}
		$scheme = strtolower( $parts['scheme'] );
		return ( $scheme === 'http' || $scheme === 'https' ) ? $url : null;
	}

	/**
	 * The host a browser contacts for a host as written in a URL: percent-decoded, mapped
	 * with UTS #46 to ASCII (letter case, fullwidth forms, soft hyphens, Unicode names), and
	 * without one trailing dot. Compare hosts in this form only.
	 *
	 * @param string $host As in the URL, an IPv6 address in brackets
	 * @return string|null Null when browsers would refuse the host, or would read it as an IPv4
	 *  address written other than as four decimal numbers (`127.1`, `2130706433`, `0x7f.0.0.1`)
	 */
	public static function canonicalHost( string $host ): ?string {
		$host = rawurldecode( $host );
		if ( str_starts_with( $host, '[' ) && str_ends_with( $host, ']' ) ) {
			$address = inet_pton( substr( $host, 1, -1 ) );
			return ( $address !== false && strlen( $address ) === 16 ) ? '[' . inet_ntop( $address ) . ']' : null;
		}
		$ascii = idn_to_ascii( $host, IDNA_NONTRANSITIONAL_TO_ASCII, INTL_IDNA_VARIANT_UTS46 );
		if ( $ascii === false ) {
			return null;
		}
		$ascii = strtolower( str_ends_with( $ascii, '.' ) ? substr( $ascii, 0, -1 ) : $ascii );
		// Code points that browsers refuse in a host, and empty labels
		if ( $ascii === '' || preg_match( '/[\x00-\x20#%\/:<>?@\[\\\\\]^|\x7F]|^\.|\.\.|\.$/', $ascii ) ) {
			return null;
		}
		// A host whose last label is a number is an IPv4 address to browsers
		$lastLabel = substr( strrchr( ".$ascii", '.' ), 1 );
		if ( preg_match( '/^(?:0x[0-9a-f]*|[0-9]+)$/', $lastLabel )
			&& !preg_match( '/^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(?:\.|$)){4}$/', $ascii )
		) {
			return null;
		}
		return $ascii;
	}

	/**
	 * A readable name for a URL: its last non-empty path segment, decoded, else its host,
	 * else the URL itself.
	 */
	public static function displayName( string $url ): string {
		$path = (string)parse_url( $url, PHP_URL_PATH );
		$segments = array_values( array_filter(
			explode( '/', $path ),
			static fn ( string $segment ): bool => $segment !== ''
		) );
		$host = (string)parse_url( $url, PHP_URL_HOST );
		$fallback = $host !== '' ? $host : $url;
		if ( !$segments ) {
			return $fallback;
		}
		$segment = end( $segments );
		$decoded = rawurldecode( $segment );
		$name = mb_check_encoding( $decoded, 'UTF-8' ) ? InputParser::cleanText( $decoded ) : $segment;
		return $name !== '' ? $name : $fallback;
	}
}
