#!/bin/sh
# Runs the built modules and the light-DOM stylesheet through MediaWiki 1.43's
# own ResourceLoader minifiers (wikimedia/minify, from the official
# mediawiki:1.43 Docker image), writes the results to demo/build/, and fails
# if the JavaScript minifier reports a parse error. The output is for local
# checks only and is not committed: the minifier drops the Lucide license header.
#
#   sh scripts/rl-minify.sh      then: node scripts/visual-check.mjs --rl
set -eu
cd "$(dirname "$0")/.."
REPO="$(cd .. && pwd)"
mkdir -p demo/build
for name in gramophone gramophone.player; do
	docker run --rm -v "$REPO:/src:ro" --entrypoint php mediawiki:1.43 \
		/var/www/html/vendor/wikimedia/minify/bin/minify js "/src/resources/dist/$name.js" > "demo/build/$name.rl.js"
	if grep -q "ParseError\|Parse error" "demo/build/$name.rl.js"; then
		echo "FAIL: MediaWiki JavaScriptMinifier reported an error in $name.js:" >&2
		grep -o "Parse.*" "demo/build/$name.rl.js" >&2
		exit 1
	fi
	# ResourceLoader runs each package file inside function ( require, module, exports ) { ... }.
	node -e "const a=require('acorn');a.parse('(function(require,module,exports){'+require('fs').readFileSync(process.argv[1],'utf8')+'\n})',{ecmaVersion:2017})" "demo/build/$name.rl.js"
done
docker run --rm -v "$REPO:/src:ro" --entrypoint php mediawiki:1.43 \
	/var/www/html/vendor/wikimedia/minify/bin/minify css /src/resources/ext.gramophone.styles.css > demo/build/ext.gramophone.styles.rl.css
wc -c ../resources/dist/gramophone.js demo/build/gramophone.rl.js ../resources/dist/gramophone.player.js demo/build/gramophone.player.rl.js ../resources/ext.gramophone.styles.css demo/build/ext.gramophone.styles.rl.css
echo "OK: MediaWiki 1.43 minifier output parses as ES2017"
