#!/usr/bin/env bash
# Fetch the third-party code the dev wiki needs that is not committed (all gitignored):
# MobileFrontend REL1_43, TabberNeue 4.0.2 and the Citizen 3.21.0 skin.
# Idempotent: existing checkouts are kept. Delete them to refetch.
set -euo pipefail
cd "$(dirname "$0")"

clone() {
	local url=$1 ref=$2 dest=$3
	if [ -f "$dest/extension.json" ] || [ -f "$dest/skin.json" ]; then
		echo "fetch: have $dest"
		return
	fi
	rm -rf "$dest"
	echo "fetch: cloning $url@$ref into $dest"
	git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$ref" "$url" "$dest"
}

clone https://github.com/wikimedia/mediawiki-extensions-MobileFrontend.git REL1_43 extensions/MobileFrontend
clone https://github.com/StarCitizenTools/mediawiki-extensions-TabberNeue.git v4.0.2 extensions/TabberNeue
clone https://github.com/StarCitizenTools/mediawiki-skins-Citizen.git v3.21.0 skins/Citizen
