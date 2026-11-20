"""Install the pinned Swift toolchain for Linux inside the worker image.

Workers use it to build and test Swift packages that need no Apple framework (`swift build`, `swift test`).
It cannot build an iOS or macOS app: SwiftUI, CoreBluetooth, WidgetKit and the other Apple frameworks exist
only in Xcode on macOS, which stays outside the sandbox.

swift.org publishes a PGP signature next to each archive, not a checksum file. The SHA256 values below were
computed from the archives at https://download.swift.org/ and are pinned here, so the image build fails on any
other bytes. Upgrading Swift means changing RELEASE and both hashes together, then rebuilding the image and
rerunning `harness isolation verify`.
"""
from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import tempfile
import urllib.request

RELEASE = "6.4.2"
# arch -> (download directory, archive name, sha256)
SHA256 = {
    "amd64": (
        "debian12",
        "swift-6.4.2-RELEASE-debian12.tar.gz",
        "25fb98a4a9c91cf88c81e35098cca1f165ae3ca295d9b776eea9aaa31bed7ed9",
    ),
    "arm64": (
        "debian12-aarch64",
        "swift-6.4.2-RELEASE-debian12-aarch64.tar.gz",
        "a3398796390db7e0ec2e06029c302d3b6702c0c1ce0a36c9099912db6711844b",
    ),
}
DEST = "/opt/swift"


def archive_url(arch: str) -> str:
    directory, name, _ = SHA256[arch]
    return "https://download.swift.org/swift-%s-release/%s/swift-%s-RELEASE/%s" % (RELEASE, directory, RELEASE, name)


def main(arch: str) -> int:
    if arch not in SHA256:
        print("install_swift: unsupported architecture %r (expected one of %s)" % (arch, ", ".join(sorted(SHA256))),
              file=sys.stderr)
        return 2
    _, name, expected = SHA256[arch]
    url = archive_url(arch)
    digest = hashlib.sha256()
    # The archive is over 1 GB, so it is hashed while it streams to disk and never held in memory.
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as target:
        path = target.name
        with urllib.request.urlopen(url, timeout=600) as response:
            for chunk in iter(lambda: response.read(1 << 20), b""):
                digest.update(chunk)
                target.write(chunk)
    try:
        actual = digest.hexdigest()
        print("install_swift: %s sha256 %s" % (name, actual))
        if actual != expected:
            print("install_swift: checksum mismatch for %s\n  expected %s\n  actual   %s" % (url, expected, actual),
                  file=sys.stderr)
            return 1
        os.makedirs(DEST, exist_ok=True)
        # The archive holds one top-level directory with `usr/` inside; only verified bytes are unpacked.
        subprocess.run(["tar", "-xzf", path, "-C", DEST, "--strip-components=1", "--no-same-owner"], check=True)
    finally:
        os.unlink(path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "amd64"))
