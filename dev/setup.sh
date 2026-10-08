#!/usr/bin/env bash
# Bring up the dev wiki for the Gramophone extension. Safe to run again at any time: it only does
# what is missing, saves the pages again and recreates containers whose configuration changed.
#
#   ./setup.sh           start or update the environment
#   ./setup.sh --reset   delete the wiki database and uploads first, then set up again
set -euo pipefail
cd "$(dirname "$0")"

export GRAMOPHONE_DEV_WIKI_PORT=${GRAMOPHONE_DEV_WIKI_PORT:-8143}
export GRAMOPHONE_DEV_UPLOADS_PORT=${GRAMOPHONE_DEV_UPLOADS_PORT:-8144}
export GRAMOPHONE_DEV_NOCORS_PORT=${GRAMOPHONE_DEV_NOCORS_PORT:-8145}
WIKI="http://localhost:$GRAMOPHONE_DEV_WIKI_PORT"

log() { printf '\033[1msetup:\033[0m %s\n' "$*"; }

if ! docker info >/dev/null 2>&1; then
	echo "setup: Docker is not running. Start it first (for example: colima start)." >&2
	exit 1
fi
if ! command -v node >/dev/null 2>&1; then
	echo "setup: Node is missing. Install Node 20 or newer (media.mjs downloads the songs)." >&2
	exit 1
fi

# Mount the extension (the repository root) live.
export GRAMOPHONE_SRC=..

if [ "${1:-}" = "--reset" ]; then
	log "deleting containers and volumes (database and uploads)"
	docker compose down --volumes --remove-orphans
fi

log "fetching third-party code"
./fetch.sh | sed 's/^/  /'

log "getting the songs, covers and lyrics (dev/media, not committed)"
docker compose --profile tools build --quiet ffmpeg
node media.mjs | sed 's/^/  /'

# Dev-only admin credentials, never printed.
if [ ! -s .env.local ]; then
	log "creating dev admin credentials in dev/.env.local"
	(
		umask 077
		printf 'GRAMOPHONE_DEV_ADMIN_USER=Admin\nGRAMOPHONE_DEV_ADMIN_PASSWORD=%s\n' \
			"$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)" > .env.local
	)
	new_credentials=1
fi
# shellcheck disable=SC1091
. ./.env.local

log "starting containers"
docker compose up -d --build --remove-orphans mediawiki uploads

mw() { docker compose exec -T -u www-data mediawiki "$@"; }

for _ in $(seq 1 60); do
	if mw true 2>/dev/null; then break; fi
	sleep 1
done
mw mkdir -p /var/www/data/logs

if ! mw test -f /var/www/data/LocalSettings.php; then
	log "installing MediaWiki (SQLite, zh-cn)"
	# MW_CONFIG_FILE points at a missing file so the installer runs without settings.
	printf '%s' "$GRAMOPHONE_DEV_ADMIN_PASSWORD" | mw sh -c '
		umask 077
		cat > /tmp/gramophone-dev-pass
		MW_CONFIG_FILE=/tmp/no-settings.php php maintenance/run.php install \
			--dbtype=sqlite --dbpath=/var/www/data --dbname=gramophone_dev \
			--server="$GRAMOPHONE_DEV_SERVER" --scriptpath="" --lang=zh-cn \
			--confpath=/var/www/data --passfile=/tmp/gramophone-dev-pass \
			--skins=MinervaNeue,MonoBook,Timeless,Vector \
			--extensions=CategoryTree,Cite,CiteThisPage,CodeEditor,Echo,Gadgets,ImageMap,InputBox,Interwiki,Linter,LoginNotify,MultimediaViewer,Nuke,ParserFunctions,Poem,ReplaceText,Thanks,VisualEditor,WikiEditor \
			"Gramophone Dev" "$0"
		status=$?
		rm -f /tmp/gramophone-dev-pass
		exit $status
	' "$GRAMOPHONE_DEV_ADMIN_USER" | sed 's/^/  /'
elif [ -n "${new_credentials:-}" ]; then
	log "resetting the admin password to the new one in dev/.env.local"
	mw php maintenance/run.php changePassword --user="$GRAMOPHONE_DEV_ADMIN_USER" \
		--password="$GRAMOPHONE_DEV_ADMIN_PASSWORD" >/dev/null
fi

log "updating the database schema for the loaded extensions"
mw php maintenance/run.php update --quick | tail -n 2 | sed 's/^/  /'

media_extensions=mp3,jpg,lrc
log "importing the media files"
mw php maintenance/run.php importImages --user="$GRAMOPHONE_DEV_ADMIN_USER" \
	--comment="Gramophone dev media" --extensions="$media_extensions" \
	/media/wiki | grep -E 'Importing .+[.][.][.]|Failed|failed' | sed 's/^/  /' || true

# importImages skips files the wiki already has. Re-import the files whose content differs
# from the wiki's copy (SHA-1 from the API), so unchanged files get no new revision.
changed=$(mw php -- "$media_extensions" <<'PHP'
<?php
$extensions = explode( ',', $argv[1] );
$files = [];
foreach ( scandir( '/media/wiki' ) as $name ) {
	if ( in_array( strtolower( pathinfo( $name, PATHINFO_EXTENSION ) ), $extensions, true ) ) {
		$files["File:$name"] = "/media/wiki/$name";
	}
}
foreach ( array_chunk( array_keys( $files ), 50 ) as $titles ) {
	$query = http_build_query( [ 'action' => 'query', 'prop' => 'imageinfo', 'iiprop' => 'sha1',
		'format' => 'json', 'formatversion' => 2, 'titles' => implode( '|', $titles ) ] );
	$result = json_decode( (string)file_get_contents( "http://localhost/api.php?$query" ), true );
	if ( !isset( $result['query'] ) ) {
		fwrite( STDERR, "setup: could not read the wiki's file hashes, changed files are not re-imported\n" );
		exit;
	}
	$normalized = array_column( $result['query']['normalized'] ?? [], 'to', 'from' );
	$sha1 = [];
	foreach ( $result['query']['pages'] ?? [] as $page ) {
		$sha1[$page['title']] = $page['imageinfo'][0]['sha1'] ?? null;
	}
	foreach ( $titles as $title ) {
		$wiki = $sha1[$normalized[$title] ?? $title] ?? null;
		if ( $wiki !== null && $wiki !== sha1_file( $files[$title] ) ) {
			echo $files[$title], "\n";
		}
	}
}
PHP
)
if [ -n "$changed" ]; then
	log "re-importing changed media files"
	printf '%s\n' "$changed" | mw sh -c 'rm -rf /tmp/gramophone-changed && mkdir /tmp/gramophone-changed &&
		while IFS= read -r f; do cp "$f" /tmp/gramophone-changed/; done'
	mw php maintenance/run.php importImages --user="$GRAMOPHONE_DEV_ADMIN_USER" --overwrite \
		--comment="Gramophone dev media" --extensions="$media_extensions" \
		/tmp/gramophone-changed | grep -E 'overwriting|Failed|failed' | sed 's/^/  /' || true
	mw rm -rf /tmp/gramophone-changed
fi

edit_page() {
	local title=$1 file=$2
	local out
	if ! out=$(mw sh -c 'php maintenance/run.php edit --user="$0" --summary="Gramophone dev page" "$1" < "$2"' \
		"$GRAMOPHONE_DEV_ADMIN_USER" "$title" "$file" </dev/null 2>&1); then
		echo "  failed to save $title: $out" >&2
	fi
}

log "saving the pages"
while IFS=$'\t' read -r file title; do
	case "$file" in '' | '#'*) continue ;; esac
	edit_page "$title" "/pages/$file"
	echo "  $title"
done < pages/pages.tsv

log "running queued jobs"
mw php maintenance/run.php runJobs --quiet >/dev/null

if mw test -f /var/www/html/extensions/Gramophone/extension.json; then
	ext_state="mounted from $GRAMOPHONE_SRC"
else
	ext_state="not loaded yet (no extension.json in $GRAMOPHONE_SRC)"
fi
cat <<EOF

Dev wiki is up (Gramophone).
  Wiki:      $WIKI/wiki/Main_Page
  Uploads:   http://localhost:$GRAMOPHONE_DEV_UPLOADS_PORT/images/ (CORS for $WIKI)
  Mirror:    http://127.0.0.1:$GRAMOPHONE_DEV_UPLOADS_PORT/media/ (CORS, may load before a click)
  No CORS:   http://127.0.0.1:$GRAMOPHONE_DEV_NOCORS_PORT/media/ (third party, loads only on a click)
  Admin:     user and password in dev/.env.local
  Extension: $ext_state
  Checks:    node check.mjs   (in dev/, after pnpm install)
EOF
