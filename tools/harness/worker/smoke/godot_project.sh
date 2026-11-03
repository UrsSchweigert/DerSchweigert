#!/bin/sh
# Trusted smoke test for a Godot project. Baked into the worker image; workers cannot change it.
# Usage: sh /opt/harness/smoke/godot_project.sh <repository root> <project dir>
#
# It imports the project headless on a throwaway copy and loads every scene, script, and resource,
# so a parse error, a broken scene, or a missing dependency fails the merge instead of the player.
set -eu

root="${1:-/work}"
project="${2:-}"
if [ -z "$project" ]; then
    echo "FAIL: godot_project.sh needs a project directory (for example apps/arithmoslayer)" >&2
    exit 2
fi

src="$root/$project"
if [ ! -f "$src/project.godot" ]; then
    echo "FAIL: $project/project.godot does not exist"
    exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -a "$src"/. "$work"/
# The test framework lives in the image, so test scripts compile here without the repository vendoring it.
rm -rf "$work/addons/gut"
mkdir -p "$work/addons"
cp -a /opt/harness/godot/addons/gut "$work/addons/gut"
cp /opt/harness/smoke/godot_verify.gd "$work/harness_verify.gd"

cd "$work"
if ! godot --headless --path . --import >/tmp/godot-smoke-import.log 2>&1; then
    echo "FAIL: the project does not import headless; last lines of the import log:"
    tail -n 40 /tmp/godot-smoke-import.log
    exit 1
fi

godot --headless --path . --script res://harness_verify.gd
