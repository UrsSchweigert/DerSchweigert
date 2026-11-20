#!/bin/sh
# Fails when any Package.swift under the given directory declares a .package( entry with a url:
# a url dependency is downloaded code, and Tagwerk takes none. Local `path:` packages are fine.
# The manifest is flattened to one line first so an entry split over several lines is still caught.
set -u
dir=${1:-.}
status=0
list=$(mktemp) || exit 2
trap 'rm -f "$list"' EXIT
find "$dir" -name .build -prune -o -name Package.swift -type f -print > "$list"
while IFS= read -r manifest; do
  if tr '\n' ' ' < "$manifest" | grep -Eq '\.package[[:space:]]*\([^)]*url[[:space:]]*:'; then
    echo "third-party dependency in $manifest" >&2
    status=1
  fi
done < "$list"
exit $status
