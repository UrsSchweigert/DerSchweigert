#!/bin/sh
# Fails when any package manifest under the given directory declares a .package( entry with a url or a
# registry id: either is downloaded code, and Tagwerk takes none. Local `path:` packages are fine.
# Package@swift-<version>.swift manifests are checked too, because SwiftPM prefers them over Package.swift.
# The manifest is flattened to one line first so an entry split over several lines is still caught.
set -u
dir=${1:-.}
[ -d "$dir" ] || { echo "no such directory: $dir" >&2; exit 2; }
status=0
list=$(mktemp) || exit 2
trap 'rm -f "$list"' EXIT
find "$dir" -name .build -prune -o \( -name Package.swift -o -name 'Package@swift-*.swift' \) -type f -print > "$list"
while IFS= read -r manifest; do
  if tr '\n' ' ' < "$manifest" | grep -Eq '\.package[[:space:]]*\([^)]*(url|id)[[:space:]]*:'; then
    echo "third-party dependency in $manifest" >&2
    status=1
  fi
done < "$list"
exit $status
