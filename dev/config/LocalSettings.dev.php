<?php
// Dev overrides for the Gramophone test wiki, loaded after the
// installer output. They model a typical Chinese game wiki: zh-cn content,
// uploads on a second origin with CORS, legacy Vector on desktop and Citizen
// on phones. dev/README.md describes the setup.

// Hosts. Uploads are served from a second origin, as on many wikis with a CDN.
$wgServer = getenv( 'GRAMOPHONE_DEV_SERVER' ) ?: 'http://localhost:8143';
$wgCanonicalServer = $wgServer;
$wgArticlePath = '/wiki/$1';
$wgLanguageCode = 'zh-cn';
$wgCookiePrefix = 'gramophonedev';
$wgEnableEmail = false;
$wgEnableUserEmail = false;

// Uploads, served by the `uploads` container on a second origin that sends
// Access-Control-Allow-Origin for the wiki origin.
$wgEnableUploads = true;
$wgUploadDirectory = "$IP/images";
$wgUploadPath = ( getenv( 'GRAMOPHONE_DEV_UPLOADS' ) ?: 'http://localhost:8144' ) . '/images';
$wgMaxUploadSize = 52428800;
$wgFileExtensions = [
	'png', 'gif', 'jpg', 'jpeg', 'pdf', 'mp3', 'mp4', 'wma', 'flv', 'webp', 'wav', 'svg',
	'flac', 'mkv', 'mov', 'oga', 'ogg', 'ogv', 'webm', 'lrc',
];
// .lrc files are text/plain, which fails the extension to MIME match.
$wgVerifyMimeType = false;
$wgUseImageMagick = true;
$wgImageMagickConvertCommand = '/usr/bin/convert';
$wgThumbLimits = [ 120, 150, 180, 200, 250, 300 ];

// External URLs that may load before a click (covers, hidemissing checks, autoplay), through
// core's external image setting. The pages reach the uploads container as 127.0.0.1, because
// the extension treats localhost on any port as the wiki's own host. http://127.0.0.1:8144/
// stands for a mirror the wiki trusts. Protocol-relative //127.0.0.1:8144/ URLs match through their
// http: form. The third-party host http://127.0.0.1:8145/ keeps the default: its covers are
// dropped, its hidemissing buttons are not checked and its audio does not autoplay.
$wgAllowExternalImagesFrom = [ 'http://127.0.0.1:8144/' ];

// Skins. Desktop default is legacy Vector (the "vector" key is legacy Vector in 1.43).
$wgDefaultSkin = 'vector';
if ( is_file( "$IP/skins/Citizen/skin.json" ) ) {
	wfLoadSkin( 'Citizen' );
	$wgCitizenThemeDefault = 'light';
}

// Mobile. MobileFrontend detects mobile browsers on the same host and serves
// them the Citizen skin. Minerva is available with ?useskin=minerva.
if ( is_file( "$IP/extensions/MobileFrontend/extension.json" ) ) {
	wfLoadExtension( 'MobileFrontend' );
	$wgMFAutodetectMobileView = true;
	$wgDefaultMobileSkin = is_file( "$IP/skins/Citizen/skin.json" ) ? 'citizen' : 'minerva';
}

// TabberNeue, for players inside tabs that start hidden.
if ( is_file( "$IP/extensions/TabberNeue/extension.json" ) ) {
	wfLoadExtension( 'TabberNeue' );
}

// The extension under test, mounted from the repository root. An extension.json
// that does not parse is skipped instead of breaking the wiki while it is being edited.
$gramophoneDevLoaded = null;
$gramophoneDevJson = "$IP/extensions/Gramophone/extension.json";
if ( is_file( $gramophoneDevJson ) && json_decode( (string)file_get_contents( $gramophoneDevJson ) ) !== null ) {
	wfLoadExtension( 'Gramophone' );
	$gramophoneDevLoaded = 'Gramophone';
	// The page "Sm2Shim compatibility" also uses <ab>.
	$wgGramophoneAudioButtonTag = true;
}

if ( $gramophoneDevLoaded ) {
	// Keep the parser cache on, but invalidate it whenever a PHP,
	// JSON or i18n file of the extension changes, so edits show on the next view.
	$gramophoneDevNewest = 0;
	$gramophoneDevFiles = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator( "$IP/extensions/$gramophoneDevLoaded", FilesystemIterator::SKIP_DOTS )
	);
	foreach ( $gramophoneDevFiles as $gramophoneDevFile ) {
		$gramophoneDevPath = $gramophoneDevFile->getPathname();
		if ( preg_match( '/\.(php|json)$/', $gramophoneDevPath )
			&& !preg_match( '#/(tests|vendor|node_modules|client|dev)/#', $gramophoneDevPath )
		) {
			$gramophoneDevNewest = max( $gramophoneDevNewest, $gramophoneDevFile->getMTime() );
		}
	}
	$wgCacheEpoch = max( $wgCacheEpoch, gmdate( 'YmdHis', $gramophoneDevNewest ) );
}

// Caches. The installer picks APCu, which maintenance scripts (CLI) do not share with
// Apache, so pages and templates saved by setup.sh were served stale from the web
// server's cache. Use the database as the shared object cache instead .
$wgMainCacheType = CACHE_DB;
$wgParserCacheType = CACHE_DB;
$wgSessionCacheType = CACHE_DB;

// Debugging. PHP warnings, deprecations and exceptions go to log files in the
// data volume (read them with `docker compose exec mediawiki tail /var/www/data/logs/*.log`).
$wgShowExceptionDetails = true;
$wgDebugToolbar = false;
$wgShowDebug = false;
$wgDevelopmentWarnings = true;
error_reporting( E_ALL );
$wgDebugLogGroups['exception'] = '/var/www/data/logs/exception.log';
$wgDebugLogGroups['error'] = '/var/www/data/logs/error.log';
$wgDebugLogGroups['fatal'] = '/var/www/data/logs/fatal.log';
ini_set( 'error_log', '/var/www/data/logs/php.log' );

// ResourceLoader debug mode: off by default. `touch dev/config/rl-debug.on` turns
// it on for every request (remove the file to turn it off), `?debug=1` for one page.
$wgResourceLoaderDebug = is_file( __DIR__ . '/rl-debug.on' );
// Do not let browsers keep the startup module for 5 minutes after a client change.
$wgResourceLoaderMaxage = [ 'unversioned' => 1 ];

// Site name.
$wgSitename = 'Gramophone Dev';
