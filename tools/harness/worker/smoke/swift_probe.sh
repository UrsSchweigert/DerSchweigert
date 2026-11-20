#!/bin/sh
# Trusted probe for the Swift toolchain. Baked into the worker image; workers cannot change it.
# Usage: sh /opt/harness/smoke/swift_probe.sh [scratch directory]
#
# It writes a throwaway package with one library and one test, then builds and tests it the way a worker
# would: under the read-only root filesystem, as the unprivileged user, with no package to download. A
# toolchain that only prints its version but cannot link or cannot find XCTest fails here. The package is
# built in the scratch directory because /tmp in the sandbox is too small for a build tree.
set -eu

scratch="${1:-/work}"
dir="$scratch/.harness-swift-probe"
rm -rf "$dir"
mkdir -p "$dir/Sources/Probe" "$dir/Tests/ProbeTests"
trap 'rm -rf "$dir"' EXIT

cat > "$dir/Package.swift" <<'EOF'
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Probe",
    targets: [
        .target(name: "Probe"),
        .testTarget(name: "ProbeTests", dependencies: ["Probe"]),
    ]
)
EOF

cat > "$dir/Sources/Probe/Probe.swift" <<'EOF'
import Foundation

public func minutes(from start: Date, to end: Date) -> Int {
    Int(end.timeIntervalSince(start) / 60)
}
EOF

cat > "$dir/Tests/ProbeTests/ProbeTests.swift" <<'EOF'
import XCTest
@testable import Probe

final class ProbeTests: XCTestCase {
    func testMinutes() {
        let start = Date(timeIntervalSince1970: 0)
        XCTAssertEqual(minutes(from: start, to: start.addingTimeInterval(7200)), 120)
    }
}
EOF

cd "$dir"
# No pipe here: `sh` has no pipefail, so piping the output would hide a failed build behind the pipe's exit status.
if ! swift test > "$dir/probe.log" 2>&1; then
    tail -n 20 "$dir/probe.log" >&2
    echo "FAIL: swift test did not pass" >&2
    exit 1
fi
echo "OK: swift package built and tested"
