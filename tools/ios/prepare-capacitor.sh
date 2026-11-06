#!/bin/bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "error: expected the Capacitor app directory and bundle verification script" >&2
  exit 1
fi

export PATH="${PATH:-/usr/bin:/bin}:/opt/homebrew/bin:/usr/local/bin"
cd "$1"

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo "error: Node.js 22+ is required for the iOS build; make it available to Xcode." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1 || [ ! -x node_modules/.bin/cap ]; then
  echo "error: Capacitor dependencies are missing; run npm ci in $PWD before building." >&2
  exit 1
fi
if ! npm ls --all --omit=optional --parseable >/dev/null; then
  echo "error: Capacitor dependencies are incomplete or inconsistent; run npm ci in $PWD." >&2
  exit 1
fi

npm run copy-assets
node "$2"
./node_modules/.bin/cap sync ios
