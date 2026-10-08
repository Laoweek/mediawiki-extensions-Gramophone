<?php

namespace MediaWiki\Extension\Gramophone\Tests\Unit;

use MediaWiki\Extension\Gramophone\EditorUrl;
use MediaWikiUnitTestCase;

/**
 * @covers \MediaWiki\Extension\Gramophone\EditorUrl
 */
class EditorUrlTest extends MediaWikiUnitTestCase {

	public static function provideIsUrl(): iterable {
		yield 'https' => [ 'https://example.com/a.mp3', true ];
		yield 'http' => [ 'http://example.com/a.mp3', true ];
		yield 'upper case scheme' => [ 'HTTPS://EXAMPLE.COM/A.MP3', true ];
		yield 'leading space' => [ ' https://example.com/a.mp3', true ];
		yield 'protocol-relative' => [ '//example.com/a.mp3', true ];
		yield 'same site' => [ '/images/a/ab/a.mp3', true ];
		yield 'file name' => [ 'Port-day.mp3', false ];
		yield 'file prefix' => [ 'File:Port-day.mp3', false ];
		yield 'relative path' => [ 'images/a.mp3', false ];
		yield 'javascript' => [ 'javascript:alert(1)', false ];
		yield 'data' => [ 'data:audio/mp3;base64,AAAA', false ];
		yield 'ftp' => [ 'ftp://example.com/a.mp3', false ];
	}

	/**
	 * @dataProvider provideIsUrl
	 */
	public function testIsUrl( string $reference, bool $expected ): void {
		$this->assertSame( $expected, EditorUrl::isUrl( $reference ) );
	}

	public static function provideIsSameSite(): iterable {
		yield 'path' => [ '/images/a.mp3', true ];
		yield 'root' => [ '/', true ];
		yield 'protocol-relative' => [ '//example.com/a.mp3', false ];
		yield 'absolute' => [ 'https://example.com/a.mp3', false ];
	}

	/**
	 * @dataProvider provideIsSameSite
	 */
	public function testIsSameSite( string $url, bool $expected ): void {
		$this->assertSame( $expected, EditorUrl::isSameSite( $url ) );
	}

	public static function provideSanitize(): iterable {
		yield 'https' => [ 'https://example.com/a.mp3', 'https://example.com/a.mp3' ];
		yield 'query and fragment' => [ 'http://example.com/a.mp3?x=1#t=5', 'http://example.com/a.mp3?x=1#t=5' ];
		yield 'trimmed' => [ "  https://example.com/a.mp3\n", 'https://example.com/a.mp3' ];
		yield 'spaces encoded' => [ 'https://example.com/my song.mp3', 'https://example.com/my%20song.mp3' ];
		yield 'non-ASCII kept' => [ 'https://example.com/港区.mp3', 'https://example.com/港区.mp3' ];
		yield 'upper case scheme' => [ 'HTTP://example.com/', 'HTTP://example.com/' ];
		yield 'protocol-relative kept' => [ '//cdn.example.com/images/a.mp3', '//cdn.example.com/images/a.mp3' ];
		yield 'same-site path kept' => [ '/images/9/9a/a b.mp3', '/images/9/9a/a%20b.mp3' ];
		yield 'no host' => [ 'http://', null ];
		yield 'no host with path' => [ 'http:///a.mp3', null ];
		yield 'protocol-relative without host' => [ '///a.mp3', null ];
		yield 'backslash host trick' => [ '/\\evil.example/a.mp3', null ];
		yield 'backslash in URL' => [ 'https://example.com\\@evil.example/', null ];
		yield 'tab' => [ "https://example.com/a\t.mp3", null ];
		yield 'inner line break' => [ "/images/a\n.mp3", null ];
		yield 'null byte' => [ "https://example.com/a\0.mp3", null ];
		yield 'javascript' => [ 'javascript:alert(1)', null ];
		yield 'javascript with slashes' => [ 'javascript://example.com/%0Aalert(1)', null ];
		yield 'data' => [ 'data:text/plain,hi', null ];
		yield 'relative path' => [ 'images/a.mp3', null ];
		yield 'empty' => [ '', null ];
	}

	/**
	 * @dataProvider provideSanitize
	 */
	public function testSanitize( string $url, ?string $expected ): void {
		$this->assertSame( $expected, EditorUrl::sanitize( $url ) );
	}

	public static function provideDisplayName(): iterable {
		yield 'file name' => [ 'https://example.com/music/a.mp3', 'a.mp3' ];
		yield 'decoded' => [ 'https://example.com/%E6%B8%AF%E5%8C%BA%20day.mp3', '港区 day.mp3' ];
		yield 'plus kept' => [ 'https://example.com/a+b.mp3', 'a+b.mp3' ];
		yield 'query ignored' => [ 'https://example.com/a.mp3?name=b.mp3', 'a.mp3' ];
		yield 'trailing slash' => [ 'https://example.com/music/', 'music' ];
		yield 'no path' => [ 'https://example.com', 'example.com' ];
		yield 'root path' => [ 'https://example.com/', 'example.com' ];
		yield 'protocol-relative' => [ '//example.com/images/Voice_attack.mp3', 'Voice_attack.mp3' ];
		yield 'same-site path' => [ '/images/a/ab/Local.mp3', 'Local.mp3' ];
		yield 'same-site root' => [ '/', '/' ];
		yield 'invalid UTF-8 stays encoded' => [ 'https://example.com/%FF.mp3', '%FF.mp3' ];
		yield 'control characters become a space' => [ 'https://example.com/a%00%0A.mp3', 'a .mp3' ];
		yield 'blank segment falls back to the host' => [ 'https://example.com/%20', 'example.com' ];
		yield 'control-only segment falls back to the host' => [ 'https://example.com/%00', 'example.com' ];
	}

	/**
	 * @dataProvider provideDisplayName
	 */
	public function testDisplayName( string $url, string $expected ): void {
		$this->assertSame( $expected, EditorUrl::displayName( $url ) );
	}

	public static function provideCanonicalHost(): iterable {
		yield 'plain' => [ 'example.org', 'example.org' ];
		yield 'letter case' => [ 'EXAMPLE.org', 'example.org' ];
		yield 'percent-encoded' => [ 'ex%61mple.org', 'example.org' ];
		yield 'fullwidth letters' => [ "\u{FF45}\u{FF58}\u{FF41}\u{FF4D}\u{FF50}\u{FF4C}\u{FF45}.org", 'example.org' ];
		yield 'soft hyphen' => [ "exam\u{00AD}ple.org", 'example.org' ];
		yield 'encoded soft hyphen' => [ 'exam%C2%ADple.org', 'example.org' ];
		yield 'one trailing dot' => [ 'example.org.', 'example.org' ];
		yield 'Unicode name' => [ "b\u{00FC}cher.example", 'xn--bcher-kva.example' ];
		yield 'punycode name' => [ 'xn--bcher-kva.example', 'xn--bcher-kva.example' ];
		yield 'IPv4' => [ '127.0.0.1', '127.0.0.1' ];
		yield 'IPv6 long form' => [ '[0:0:0:0:0:0:0:1]', '[::1]' ];
		yield 'IPv6 upper case' => [ '[2001:DB8::1]', '[2001:db8::1]' ];
		yield 'IPv4 as one number' => [ '2130706433', null ];
		yield 'IPv4 with three parts' => [ '127.1', null ];
		yield 'IPv4 in hex' => [ '0x7f.0.0.1', null ];
		yield 'IPv4 in octal' => [ '0177.0.0.1', null ];
		yield 'IPv4 with fullwidth digits' => [ "\u{FF11}\u{FF12}\u{FF17}.0.0.1", '127.0.0.1' ];
		yield 'too many parts for IPv4' => [ '1.2.3.4.5', null ];
		yield 'octet over 255' => [ '256.0.0.1', null ];
		yield 'IPv4 in brackets' => [ '[127.0.0.1]', null ];
		yield 'IPv6 zone' => [ '[fe80::1%25eth0]', null ];
		yield 'empty label' => [ 'example..org', null ];
		yield 'two trailing dots' => [ 'example.org..', null ];
		yield 'encoded slash' => [ 'example.org%2Fevil', null ];
		yield 'encoded percent' => [ 'example%2525.org', null ];
		yield 'empty' => [ '', null ];
	}

	/**
	 * @dataProvider provideCanonicalHost
	 */
	public function testCanonicalHost( string $host, ?string $expected ): void {
		$this->assertSame( $expected, EditorUrl::canonicalHost( $host ) );
	}
}
