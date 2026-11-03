"""Install the pinned Godot 4 editor binary for headless use inside the worker image.

The SHA512 values come from the official release checksum file
https://github.com/godotengine/godot/releases/download/<release>/SHA512-SUMS.txt
and are pinned here, so the image build fails on any other bytes.
Upgrading Godot means changing RELEASE and both hashes together, then rebuilding
the image and rerunning `harness isolation verify`.
"""
from __future__ import annotations

import hashlib
import io
import os
import sys
import urllib.request
import zipfile

RELEASE = "4.7.2-stable"
# arch -> (release file name, official sha512)
SHA512 = {
    "amd64": (
        "Godot_v4.7.2-stable_linux.x86_64.zip",
        "9aa00f7a605200940bce3027a567b782f49bd8e940dd06ae9e987bd65aee1b1467edd56ed84fcdcbdd44354bf613bdbb4e5d2913e925850368e150c59ed54c65",
    ),
    "arm64": (
        "Godot_v4.7.2-stable_linux.arm64.zip",
        "dd59918da086bd49bde2f5450b5e567ff8650cbde9abbd7b8f4ca1197ff8c609baa38834666d032deafb47099078d7822279e2a0e06e5665745468f26533e7e2",
    ),
}
DEST = "/opt/godot/godot"


def main(arch: str) -> int:
    if arch not in SHA512:
        print("install_godot: unsupported architecture %r (expected one of %s)" % (arch, ", ".join(sorted(SHA512))),
              file=sys.stderr)
        return 2
    name, expected = SHA512[arch]
    url = "https://github.com/godotengine/godot/releases/download/%s/%s" % (RELEASE, name)
    with urllib.request.urlopen(url, timeout=600) as response:
        data = response.read()
    actual = hashlib.sha512(data).hexdigest()
    print("install_godot: %s sha512 %s" % (name, actual))
    if actual != expected:
        print("install_godot: checksum mismatch for %s\n  expected %s\n  actual   %s" % (url, expected, actual),
              file=sys.stderr)
        return 1
    archive = zipfile.ZipFile(io.BytesIO(data))
    members = [n for n in archive.namelist() if not n.endswith("/")]
    if len(members) != 1:
        print("install_godot: unexpected archive layout: %s" % members, file=sys.stderr)
        return 1
    os.makedirs(os.path.dirname(DEST), exist_ok=True)
    with archive.open(members[0]) as source, open(DEST, "wb") as target:
        target.write(source.read())
    os.chmod(DEST, 0o755)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "amd64"))
