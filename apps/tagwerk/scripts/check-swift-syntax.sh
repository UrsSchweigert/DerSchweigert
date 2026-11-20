#!/bin/sh
# Syntax-only check (swiftc -parse) of every .swift file under the given directories, .build excluded.
# -parse needs no SDK, so files that import CoreBluetooth or SwiftUI are checked on Linux too; whether they
# compile against the Apple frameworks only a Mac proves.
# Exit 0 when there is no file; stop with non-zero at the first syntax error.
set -u
[ "$#" -gt 0 ] || set -- .
list=$(mktemp) || exit 2
trap 'rm -f "$list"' EXIT
for dir in "$@"; do
  find "$dir" -name .build -prune -o -name '*.swift' -type f -print >> "$list"
done
count=0
while IFS= read -r file; do
  count=$((count + 1))
  swiftc -parse "$file" || { echo "syntax error in $file" >&2; exit 1; }
done < "$list"
echo "checked $count Swift file(s)"
