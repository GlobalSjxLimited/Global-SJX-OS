#!/usr/bin/env bash
# Builds the two upload packages for cPanel. Run on your own computer from the project root:
#   API_URL=https://api.globalsjxltd.com ./deploy/pack-for-cpanel.sh
# Produces deploy/out/backend-upload.zip and deploy/out/frontend-upload.zip
set -euo pipefail
: "${API_URL:?Set API_URL, e.g. API_URL=https://api.globalsjxltd.com}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="$ROOT/deploy/out"; rm -rf "$OUT"; mkdir -p "$OUT/b"
echo "==> Backend: install + compile"
cd "$ROOT/backend"; npm ci; npm run build
cp -r dist "$OUT/b/dist"; cp package.json package-lock.json "$OUT/b/"
(cd "$OUT/b" && zip -qr ../backend-upload.zip .)
echo "==> Frontend: build against $API_URL/api"
cd "$ROOT/frontend"; npm ci; VITE_API_URL="${API_URL%/}/api" npm run build
(cd dist && zip -qr "$OUT/frontend-upload.zip" . -x '.DS_Store')
unzip -l "$OUT/frontend-upload.zip" | grep -q '\.htaccess' || { echo "ERROR: .htaccess missing from the frontend package"; exit 1; }
rm -rf "$OUT/b"; echo; ls -lh "$OUT"
