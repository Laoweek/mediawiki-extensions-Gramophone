<?php
// Settings entry point of the Gramophone dev wiki, selected with MW_CONFIG_FILE in
// dev/compose.yaml. It loads the installer output (database, secret keys and the
// bundled extensions chosen by setup.sh) from the data volume, then the dev
// overrides in LocalSettings.dev.php.

$devBase = '/var/www/data/LocalSettings.php';
if ( !is_file( $devBase ) ) {
	if ( PHP_SAPI !== 'cli' ) {
		http_response_code( 503 );
		header( 'Content-Type: text/plain; charset=utf-8' );
	}
	echo "The dev wiki is not installed yet. Run dev/setup.sh.\n";
	exit( 1 );
}
require $devBase;
require __DIR__ . '/LocalSettings.dev.php';
