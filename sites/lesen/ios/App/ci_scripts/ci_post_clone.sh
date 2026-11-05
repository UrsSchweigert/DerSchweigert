#!/bin/bash
set -euo pipefail

trap 'status=$?; echo "Buchstabenzeit preparation failed at line $LINENO (exit $status)." >&2; exit "$status"' ERR

if [[ -n "${CI_PRIMARY_REPOSITORY_PATH:-}" ]]; then
    cd "$CI_PRIMARY_REPOSITORY_PATH/sites/lesen"
else
    cd "$(dirname "$0")/../../.."
fi

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
    if ! command -v brew >/dev/null 2>&1; then
        echo "Buchstabenzeit requires Node.js 22+; neither a supported Node.js nor Homebrew is available." >&2
        exit 1
    fi
    export HOMEBREW_NO_AUTO_UPDATE=1
    export HOMEBREW_NO_INSTALL_CLEANUP=1
    brew install node@22
    node_prefix="$(brew --prefix node@22)"
    export PATH="$node_prefix/bin:$PATH"
fi

node --version
npm --version
npm ci --no-audit --no-fund
npm run copy-assets
node scripts/verify-bundle.mjs
./node_modules/.bin/cap sync ios
npm test
