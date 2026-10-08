#!/usr/bin/env bash
# Runs the extension's PHP checks in a throwaway MediaWiki container (1.43 unless GRAMOPHONE_PHP_IMAGE says otherwise): parser tests (both
# runners), PHPUnit, phpcs, extension.json validation and php -l. Prints a summary and removes
# the container. Needs Docker (Colima). Takes a few minutes, mostly installing dev dependencies.
set -euo pipefail

IMAGE="${GRAMOPHONE_PHP_IMAGE:-mediawiki:1.43}"
NAME="gramophone-php-test-$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="Gramophone"

docker run -d --name "$NAME" --entrypoint sleep \
	-v "$ROOT:/var/www/html/extensions/$EXT:ro" "$IMAGE" infinity >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

# The image ships no Composer or unzip and the release tarball has no PHPUnit configuration.
docker exec "$NAME" sh -ec '
	export DEBIAN_FRONTEND=noninteractive
	apt-get update -qq > /dev/null && apt-get install -y -qq unzip > /dev/null
	cd /var/www/html
	version=$(grep -m1 -o "MW_VERSION'"'"', '"'"'[0-9.]*" includes/Defines.php | grep -o "[0-9][0-9.]*$")
	# Composer is pinned and checked against the sha256 published on getcomposer.org/download and
	# on the GitHub release. Change the version and the hash together.
	composer_version=2.10.3
	composer_sha256=7a2d379d5b8ffdaa028580ef26494c36d2feef4b178d3dd1473a4dbc5e17c8d6
	curl -fsSL --retry 4 --retry-all-errors "https://getcomposer.org/download/$composer_version/composer.phar" -o /usr/local/bin/composer
	echo "$composer_sha256  /usr/local/bin/composer" | sha256sum -c --quiet -
	chmod +x /usr/local/bin/composer
	# MediaWiki 1.46 replaced phpunit.xml.dist with phpunit.xml.template.
	curl -fsSL --retry 4 --retry-all-errors "https://raw.githubusercontent.com/wikimedia/mediawiki/$version/phpunit.xml.dist" -o phpunit.xml.dist \
		|| { rm -f phpunit.xml.dist; curl -fsSL --retry 4 --retry-all-errors "https://raw.githubusercontent.com/wikimedia/mediawiki/$version/phpunit.xml.template" -o phpunit.xml.template; }
	COMPOSER_ALLOW_SUPERUSER=1 composer update --no-interaction --no-progress --quiet
	php maintenance/run.php install --dbtype sqlite --dbpath /var/www/data --server http://localhost \
		--scriptpath "" --lang en --pass "gramophone-$(date +%s)-test" GramophoneTest Admin > /dev/null
	echo "wfLoadExtension( '"'"'Gramophone'"'"' );" >> LocalSettings.php
'

status=0
run() {
	local label="$1"
	shift
	echo "== $label"
	if docker exec -w /var/www/html "$NAME" "$@"; then echo "-- $label: pass"; else echo "-- $label: FAIL"; status=1; fi
}

run "php -l" sh -c "find extensions/$EXT/includes extensions/$EXT/tests -name '*.php' -print0 | xargs -0 -n1 php -l > /dev/null"
run "extension.json" php maintenance/run.php validateRegistrationFile "extensions/$EXT/extension.json"
run "parser tests" php tests/parser/parserTests.php --quiet --file="extensions/$EXT/tests/parser/gramophoneParserTests.txt"
run "parser tests (PHPUnit)" sh -c "COMPOSER_ALLOW_SUPERUSER=1 composer phpunit:entrypoint -- --testsuite parsertests --filter gramophoneParserTests"
run "PHPUnit" sh -c "COMPOSER_ALLOW_SUPERUSER=1 composer phpunit:entrypoint -- extensions/$EXT/tests/phpunit"
run "phpcs" vendor/bin/phpcs -p -s --standard=vendor/mediawiki/mediawiki-codesniffer/MediaWiki --extensions=php "extensions/$EXT/includes" "extensions/$EXT/tests"

[ "$status" = 0 ] && echo "all PHP checks passed" || echo "some PHP checks failed"
exit "$status"
