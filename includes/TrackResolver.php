<?php

namespace MediaWiki\Extension\Gramophone;

use File;
use MediaWiki\Config\Config;
use MediaWiki\Linker\Linker;
use MediaWiki\MainConfigNames;
use MediaWiki\MediaWikiServices;
use MediaWiki\Parser\Parser;
use MediaWiki\Title\Title;
use MediaWiki\Utils\UrlUtils;
use StringUtils;

/**
 * Resolves the raw references in a TrackInput (file names, page titles, URLs) into the
 * track data the client receives.
 *
 * Everything is registered with the parser output the way core links are: wiki files as
 * file usage, pages as links and external URLs as external links (so spam filters and
 * Special:LinkSearch see them). A file or URL that cannot be used adds the missing-file
 * tracking category to the page. So does an audio, cover or lyrics URL on a host that
 * $wgGramophoneAllowedHosts does not list, a path on this site that is not a file the wiki serves,
 * and a cover that may not load automatically (see mayLoadAutomatically()).
 */
class TrackResolver {

	/** Width in pixels of the cover thumbnail */
	private const COVER_WIDTH = 240;

	/** Script schemes, matched in addition to $wgUrlProtocols, that are never read as wiki names */
	private const SCRIPT_SCHEMES = 'javascript:|data:|vbscript:|blob:';

	/** @var string[]|null Regular expressions from MediaWiki:External image whitelist, read once */
	private ?array $imageWhitelist = null;

	public function __construct(
		private readonly Parser $parser,
		private readonly Config $config,
		private readonly UrlUtils $urlUtils
	) {
	}

	/**
	 * Look up the pages that the tracks link to in one query, so that registering each link
	 * does not need a query of its own.
	 *
	 * @param TrackInput[] $tracks
	 */
	public function preloadLinks( array $tracks ): void {
		$batch = MediaWikiServices::getInstance()->getLinkBatchFactory()->newLinkBatch()->setCaller( __METHOD__ );
		foreach ( $tracks as $track ) {
			$title = $this->navigationTitle( $track->navigation );
			if ( $title && !$title->isExternal() ) {
				$batch->addObj( $title );
			}
		}
		if ( !$batch->isEmpty() ) {
			$batch->execute();
		}
	}

	/**
	 * @param TrackInput $track
	 * @param bool $hideMissing Whether the player hides itself when none of its files exist.
	 *  Only then does a track get `verify`.
	 * @return array Track data in the shape of the `data-mw-gramophone` contract, with every field.
	 *  PlayerRenderer leaves out the fields at their defaults.
	 */
	public function resolve( TrackInput $track, bool $hideMissing = false ): array {
		$audio = $this->resolveAudio( $track->source );
		$navigation = $this->resolveNavigation( $track->navigation );
		$linksToNavigation = $navigation !== '' && !$audio['missing'];
		$link = $linksToNavigation ? $navigation : $audio['link'];
		// The editor-supplied audio URL the player uses, if any
		$audioUrl = ( $audio['isUrl'] && !$audio['missing'] ) ? $audio['src'] : null;
		return [
			'src' => $audio['src'],
			'title' => $track->title !== '' ? $track->title : $audio['title'],
			'artist' => $track->artist,
			'album' => $track->album,
			'explicit' => $track->explicit,
			'cover' => $this->resolveFileReference( $track->cover, true ),
			'lyrics' => $this->resolveFileReference( $track->lyrics, false ),
			'lyricsOffset' => $track->lyricsOffset,
			'link' => $link,
			'missing' => $audio['missing'],
			// The client checks these with a request of its own, before any click
			'verify' => $hideMissing && $audioUrl !== null && $this->mayLoadAutomatically( $audioUrl ),
			'nofollow' => ( $audioUrl !== null && $this->isNoFollow( $audioUrl ) )
				|| ( $linksToNavigation && EditorUrl::isUrl( $track->navigation ) && $this->isNoFollow( $link ) ),
		];
	}

	/**
	 * Extra attributes for the no-JS fallback link of a track: `rel="nofollow"` when the audio
	 * is an editor-supplied URL that core would give `rel="nofollow"`, see isNoFollow().
	 *
	 * @param TrackInput $track
	 * @return string[]
	 */
	public function fallbackLinkAttributes( TrackInput $track ): array {
		$url = EditorUrl::isUrl( $track->source ) ? self::editorUrl( $track->source ) : null;
		return ( $url !== null && $this->isNoFollow( $url ) ) ? [ 'rel' => 'nofollow' ] : [];
	}

	/**
	 * Whether a player with these tracks may start playing on its own: every track that can
	 * play has audio that may load automatically, see mayLoadAutomatically(). Registers nothing.
	 *
	 * @param TrackInput[] $tracks
	 * @return bool
	 */
	public function mayAutoPlay( array $tracks ): bool {
		foreach ( $tracks as $track ) {
			// Wiki files may load automatically, and a track whose URL is unusable does not play
			$url = EditorUrl::isUrl( $track->source ) ? $this->mediaUrl( $track->source ) : null;
			if ( $url !== null && !$this->mayLoadAutomatically( $url ) ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * @param string $reference
	 * @return array{src:string,title:string,link:string,missing:bool,isUrl:bool}
	 */
	private function resolveAudio( string $reference ): array {
		if ( EditorUrl::isUrl( $reference ) ) {
			$url = $this->mediaUrl( $reference );
			return $url === null
				? $this->unusableAudio( $reference )
				: [
					'src' => $this->registerUrl( $url ),
					'title' => EditorUrl::displayName( $url ),
					'link' => '',
					'missing' => false,
					'isUrl' => true,
				];
		}

		$title = $this->fileTitle( $reference );
		if ( !$title ) {
			return $this->unusableAudio( $reference );
		}
		[ $file, $title ] = $this->parser->fetchFileAndTitle( $title );
		if ( !$file || !$file->exists() ) {
			$this->trackMissing();
			return [
				'src' => '',
				'title' => $title->getText(),
				'link' => $this->missingFileUrl( $title ),
				'missing' => true,
				'isUrl' => false,
			];
		}
		return [
			'src' => $file->getUrl(),
			'title' => $title->getText(),
			'link' => $title->getLocalURL(),
			'missing' => false,
			'isUrl' => false,
		];
	}

	/**
	 * A track whose audio reference is neither a usable URL nor a valid file name.
	 *
	 * @param string $reference
	 * @return array{src:string,title:string,link:string,missing:bool,isUrl:bool}
	 */
	private function unusableAudio( string $reference ): array {
		$this->trackMissing();
		return [
			'src' => '',
			'title' => InputParser::cleanText( $reference ),
			'link' => '',
			'missing' => true,
			'isUrl' => EditorUrl::isUrl( $reference ),
		];
	}

	/**
	 * Resolve a cover or lyrics reference to a URL.
	 *
	 * @param string $reference URL or wiki file name
	 * @param bool $isCover Whether this is a cover, which the reader's browser loads with the
	 *  page: a cover-sized thumbnail of an image file, and only a URL that may load automatically
	 * @return string URL, or '' when the reference is empty or unusable
	 */
	private function resolveFileReference( string $reference, bool $isCover ): string {
		if ( $reference === '' ) {
			return '';
		}
		if ( EditorUrl::isUrl( $reference ) ) {
			$url = $this->mediaUrl( $reference );
			if ( $url !== null && $isCover && !$this->mayLoadAutomatically( $url ) ) {
				$url = null;
			}
			$url = $url === null ? null : $this->registerUrl( $url );
		} else {
			$file = $this->findFile( $reference );
			$url = $file ? ( $isCover ? $this->thumbnailUrl( $file ) : $file->getUrl() ) : null;
		}
		if ( $url === null ) {
			$this->trackMissing();
			return '';
		}
		return $url;
	}

	private function thumbnailUrl( File $file ): string {
		if ( $file->canRender() ) {
			$thumb = $file->transform( [ 'width' => self::COVER_WIDTH ] );
			if ( $thumb && !$thumb->isError() ) {
				return $thumb->getUrl();
			}
		}
		return $file->getUrl();
	}

	/**
	 * A URL is kept, including any path on this site, because the reader follows it with a
	 * click. Anything else is read as a wiki page title.
	 */
	private function resolveNavigation( string $reference ): string {
		if ( EditorUrl::isUrl( $reference ) ) {
			$url = self::editorUrl( $reference );
			return $url === null ? '' : $this->registerUrl( $url );
		}
		$title = $this->navigationTitle( $reference );
		if ( !$title ) {
			return '';
		}
		$this->parser->getOutput()->addLink( $title );
		return $title->getLinkURL();
	}

	/**
	 * @param string $reference
	 * @return Title|null The page a navigation reference names, null when it is empty, a URL or
	 *  not a valid title
	 */
	private function navigationTitle( string $reference ): ?Title {
		if ( $reference === '' || EditorUrl::isUrl( $reference ) || $this->isOtherUrl( $reference ) ) {
			return null;
		}
		return Title::newFromText( $reference );
	}

	/**
	 * Validate an editor-supplied URL for audio, a cover or lyrics, which the reader's browser
	 * loads. Registers nothing.
	 *
	 * @param string $reference
	 * @return string|null The URL, or null when it is not usable: not a valid URL, a path on
	 *  this site or a URL on this wiki's host that is not a file the wiki serves, or a host
	 *  $wgGramophoneAllowedHosts does not list
	 */
	private function mediaUrl( string $reference ): ?string {
		$url = self::editorUrl( $reference );
		if ( $url === null ) {
			return null;
		}
		if ( EditorUrl::isSameSite( $url ) ) {
			return $this->isServedFile( $url ) ? $url : null;
		}
		$parts = $this->urlUtils->parse( $url );
		$host = $parts ? EditorUrl::canonicalHost( $parts['host'] ?? '' ) : null;
		if ( $host === null ) {
			return null;
		}
		// A full URL to a host that gets the wiki's cookies reaches the same pages
		if ( $this->isWikiHost( $host ) ) {
			$path = ( $parts['path'] ?? '' ) . ( isset( $parts['query'] ) ? '?' . $parts['query'] : '' );
			if ( !$this->isServedFile( str_starts_with( $path, '/' ) ? $path : "/$path" ) ) {
				return null;
			}
		}
		return $this->isAllowedHost( $host ) ? $url : null;
	}

	/**
	 * Validate an editor-supplied URL and bring it into the form core registers external links
	 * in (Parser::normalizeLinkUrl(), which ParserOutput::addExternalLink() applies): escapes
	 * that need none are decoded, as in `http://ex%61mple.org`, unsafe characters are encoded
	 * and dot segments are resolved. The output uses this form too, so that what spam filters
	 * and Special:LinkSearch see is what the browser loads.
	 *
	 * @param string $reference
	 * @return string|null Null when the URL is not usable, see EditorUrl::sanitize()
	 */
	private static function editorUrl( string $reference ): ?string {
		$url = EditorUrl::sanitize( $reference );
		return $url === null ? null : Parser::normalizeLinkUrl( $url );
	}

	/**
	 * Register a validated URL as an external link, unless it is a path on this site.
	 */
	private function registerUrl( string $url ): string {
		if ( !EditorUrl::isSameSite( $url ) ) {
			$this->parser->getOutput()->addExternalLink( $url );
		}
		return $url;
	}

	/**
	 * Whether the reader's browser may load a usable audio, cover or lyrics URL without a
	 * click. This decides which covers are shown, which tracks the client checks for
	 * `hidemissing` (`verify`) and whether a player may start on its own.
	 *
	 * - A path on this site: yes, it points at a file the wiki serves (see isServedFile()).
	 * - Another site, with $wgGramophoneAllowedHosts as a list: yes, the host is listed.
	 * - Another site, with $wgGramophoneAllowedHosts null: only when core would show the URL as an
	 *   external image, through $wgAllowExternalImages, a prefix in $wgAllowExternalImagesFrom
	 *   or a line of MediaWiki:External image whitelist with $wgEnableImageWhitelist. This
	 *   follows Parser::maybeMakeExternalImage(), without its check for an image file
	 *   extension. A protocol-relative URL matches when its http: or its https: form does,
	 *   because both load from the same host.
	 *
	 * @param string $url A URL that mediaUrl() accepted
	 * @return bool
	 */
	private function mayLoadAutomatically( string $url ): bool {
		if ( EditorUrl::isSameSite( $url ) || is_array( $this->config->get( 'GramophoneAllowedHosts' ) ) ) {
			return true;
		}
		$options = $this->parser->getOptions();
		if ( $options->getAllowExternalImages() ) {
			return true;
		}
		$forms = str_starts_with( $url, '//' ) ? [ "http:$url", "https:$url" ] : [ $url ];
		foreach ( $forms as $form ) {
			foreach ( (array)$options->getAllowExternalImagesFrom() as $prefix ) {
				if ( is_string( $prefix ) && $prefix !== '' && str_starts_with( $form, $prefix ) ) {
					return true;
				}
			}
			if ( $options->getEnableImageWhitelist() ) {
				foreach ( $this->imageWhitelist() as $pattern ) {
					if ( preg_match( $pattern, $form ) ) {
						return true;
					}
				}
			}
		}
		return false;
	}

	/**
	 * @return string[] The lines of MediaWiki:External image whitelist as regular
	 *  expressions, read as core reads them. A line that is not a valid expression never
	 *  matches, as in core, but without a PHP warning.
	 */
	private function imageWhitelist(): array {
		if ( $this->imageWhitelist === null ) {
			$this->imageWhitelist = [];
			$lines = explode( "\n", wfMessage( 'external_image_whitelist' )->inContentLanguage()->text() );
			foreach ( $lines as $line ) {
				$pattern = '/' . str_replace( '/', '\\/', $line ) . '/i';
				if ( $line !== '' && !str_starts_with( $line, '#' ) && StringUtils::isValidPCRERegex( $pattern ) ) {
					$this->imageWhitelist[] = $pattern;
				}
			}
		}
		return $this->imageWhitelist;
	}

	/**
	 * Whether $wgGramophoneAllowedHosts allows a host. An entry allows that host and its subdomains,
	 * compared in the form EditorUrl::canonicalHost() gives. Null allows every host.
	 *
	 * @param string $host From EditorUrl::canonicalHost()
	 * @return bool
	 */
	private function isAllowedHost( string $host ): bool {
		$hosts = $this->config->get( 'GramophoneAllowedHosts' );
		if ( !is_array( $hosts ) ) {
			return true;
		}
		foreach ( $hosts as $entry ) {
			if ( self::isWithin( $host, EditorUrl::canonicalHost( (string)$entry ) ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * @param string $host
	 * @param string|null $domain
	 * @return bool Whether the host is the domain or one of its subdomains
	 */
	private static function isWithin( string $host, ?string $domain ): bool {
		return $domain !== null && ( $host === $domain || str_ends_with( $host, ".$domain" ) );
	}

	/**
	 * Whether a path on this site points at a file the wiki serves:
	 * - under $wgUploadPath, when that is a path or a URL on this wiki's host
	 * - under `$wgScriptPath/img_auth.php/`
	 * - Special:FilePath, or Special:Redirect/file/, under any of their names, in the article
	 *   path form or the `$wgScript?title=` form, without `curid`, which would show another page
	 *
	 * @param string $url A sanitised path on this site, see EditorUrl::isSameSite()
	 * @return bool
	 */
	private function isServedFile( string $url ): bool {
		[ $path, $query ] = explode( '?', explode( '#', $url, 2 )[0], 2 ) + [ '', '' ];
		// Browsers resolve `.` and `..` segments, also percent-encoded ones, and web servers
		// decode the path before they resolve them, so `/images/..%2Fapi.php` is not an upload.
		// `%25` is refused because some servers decode twice.
		$decoded = rawurldecode( $path );
		if ( preg_match( '#(?:^|/)\.{1,2}(?:/|$)|[\x00-\x1F\x7F\\\\]#', $decoded )
			|| stripos( $path, '%25' ) !== false
		) {
			return false;
		}
		$uploadPath = $this->localUploadPath();
		if ( ( $uploadPath !== null && str_starts_with( $path, "$uploadPath/" ) )
			|| str_starts_with( $path, $this->config->get( MainConfigNames::ScriptPath ) . '/img_auth.php/' )
		) {
			return true;
		}
		// PHP reads at most max_input_vars parameters, and parse_str() warns about the rest
		if ( substr_count( $query, '&' ) >= (int)ini_get( 'max_input_vars' ) ) {
			return false;
		}
		parse_str( $query, $parameters );
		$title = isset( $parameters['curid'] ) ? null : $this->specialPageTitle( $path, $parameters );
		if ( !$title ) {
			return false;
		}
		[ $name, $subpage ] = MediaWikiServices::getInstance()->getSpecialPageFactory()
			->resolveAlias( $title->getDBkey() );
		return $name === 'Filepath' || ( $name === 'Redirect' && str_starts_with( $subpage ?? '', 'file/' ) );
	}

	/**
	 * @return string|null The path of $wgUploadPath without a trailing slash, when it is a path
	 *  or a URL on this wiki's host. Null otherwise.
	 */
	private function localUploadPath(): ?string {
		$uploadPath = $this->config->get( MainConfigNames::UploadPath );
		if ( !EditorUrl::isSameSite( $uploadPath ) ) {
			$upload = $this->urlUtils->parse( $uploadPath );
			$host = $upload ? EditorUrl::canonicalHost( $upload['host'] ?? '' ) : null;
			if ( $host === null || !$this->isWikiHost( $host ) ) {
				return null;
			}
			$uploadPath = $upload['path'] ?? '';
		}
		$uploadPath = rtrim( $uploadPath, '/' );
		return $uploadPath !== '' ? $uploadPath : null;
	}

	/**
	 * Whether a host gets the wiki's cookies: the host of $wgServer or $wgCanonicalServer, on
	 * any port, because browsers send the same cookies to every port of a host, or a host
	 * within $wgCookieDomain.
	 *
	 * @param string $host From EditorUrl::canonicalHost()
	 * @return bool
	 */
	private function isWikiHost( string $host ): bool {
		foreach ( [ MainConfigNames::Server, MainConfigNames::CanonicalServer ] as $name ) {
			$server = $this->urlUtils->parse( (string)$this->config->get( $name ) );
			if ( $server && EditorUrl::canonicalHost( $server['host'] ?? '' ) === $host ) {
				return true;
			}
		}
		$cookieDomain = ltrim( (string)$this->config->get( MainConfigNames::CookieDomain ), '.' );
		return $cookieDomain !== '' && self::isWithin( $host, EditorUrl::canonicalHost( $cookieDomain ) );
	}

	/**
	 * @param string $path
	 * @param array $parameters The query parameters
	 * @return Title|null The special page a path on this site shows, in the `$wgScript?title=`
	 *  form or the article path form (`/wiki/Special:FilePath/A.mp3`). Null for anything else.
	 */
	private function specialPageTitle( string $path, array $parameters ): ?Title {
		$text = null;
		$articlePath = $this->config->get( MainConfigNames::ArticlePath );
		if ( $path === $this->config->get( MainConfigNames::Script ) ) {
			$text = is_string( $parameters['title'] ?? null ) ? $parameters['title'] : null;
		} elseif ( !str_contains( $articlePath, '?' ) ) {
			[ $before, $after ] = explode( '$1', $articlePath, 2 ) + [ '', '' ];
			if ( strlen( $path ) > strlen( $before ) + strlen( $after )
				&& str_starts_with( $path, $before ) && str_ends_with( $path, $after )
			) {
				$text = rawurldecode( substr( $path, strlen( $before ), $after === '' ? null : -strlen( $after ) ) );
			}
		}
		// As core reads the title of a request, so that entities stay text
		$title = $text === null ? null : Title::newFromURL( $text );
		return ( $title && $title->isSpecialPage() ) ? $title : null;
	}

	/**
	 * Whether core would give a link to an editor-supplied URL `rel="nofollow"`: a URL on
	 * another site, with $wgNoFollowLinks on and neither $wgNoFollowNsExceptions nor
	 * $wgNoFollowDomainExceptions applying. This mirrors Parser::getExternalLinkRel(), which
	 * is internal to core.
	 *
	 * @param string $url A sanitised URL
	 * @return bool
	 */
	private function isNoFollow( string $url ): bool {
		if ( EditorUrl::isSameSite( $url ) || !$this->config->get( MainConfigNames::NoFollowLinks ) ) {
			return false;
		}
		$namespace = $this->parser->getTitle()->getNamespace();
		$exceptNamespaces = $this->config->get( MainConfigNames::NoFollowNsExceptions );
		$exceptDomains = $this->config->get( MainConfigNames::NoFollowDomainExceptions );
		return !in_array( $namespace, $exceptNamespaces )
			&& !$this->urlUtils->matchesDomainList( $url, $exceptDomains );
	}

	/**
	 * Look up a wiki file and record its usage on the page.
	 *
	 * @param string $name
	 * @return File|null Null when the name is invalid or the file does not exist
	 */
	private function findFile( string $name ): ?File {
		$title = $this->fileTitle( $name );
		$file = $title ? $this->parser->fetchFileAndTitle( $title )[0] : false;
		return ( $file && $file->exists() ) ? $file : null;
	}

	/**
	 * Read a name, with or without a namespace prefix such as `File:`, as a file title.
	 *
	 * @param string $name
	 * @return Title|null Null for names that are not valid file names or that are URLs
	 */
	private function fileTitle( string $name ): ?Title {
		if ( $this->isOtherUrl( $name ) ) {
			return null;
		}
		$title = Title::newFromText( $name, NS_FILE );
		if ( $title && $title->isExternal() ) {
			// An interwiki-like prefix belongs to the file name, as in [[File:en:Foo.mp3]]
			$title = Title::makeTitleSafe( NS_FILE, $name );
		}
		if ( $title && $title->inNamespace( NS_MEDIA ) ) {
			$title = Title::makeTitle( NS_FILE, $title->getDBkey() );
		}
		return ( $title && $title->inNamespace( NS_FILE ) ) ? $title : null;
	}

	/**
	 * Whether the reference starts with a URL scheme other than http and https (URLs in the
	 * forms EditorUrl accepts are handled first). Core refuses such names as internal links too.
	 */
	private function isOtherUrl( string $reference ): bool {
		$schemes = $this->urlUtils->validProtocols() . '|' . self::SCRIPT_SCHEMES;
		return preg_match( '/^(?i:' . $schemes . ')/', $reference ) === 1;
	}

	/**
	 * Where a red link to a missing file goes, following core: the upload form when
	 * uploading is possible, otherwise the file description page.
	 */
	private function missingFileUrl( Title $title ): string {
		if ( $this->config->get( MainConfigNames::EnableUploads )
			|| $this->config->get( MainConfigNames::UploadMissingFileUrl )
			|| $this->config->get( MainConfigNames::UploadNavigationUrl )
		) {
			return Linker::getUploadUrl( $title );
		}
		return $title->exists()
			? $title->getLocalURL()
			: $title->getLocalURL( [ 'action' => 'edit', 'redlink' => '1' ] );
	}

	private function trackMissing(): void {
		$this->parser->addTrackingCategory( 'gramophone-missing-file-category' );
	}
}
