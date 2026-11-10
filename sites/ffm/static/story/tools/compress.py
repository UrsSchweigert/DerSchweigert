#!/usr/bin/env python3
"""Palette-compress the shipped story layers.

The renders are hand-painted paper illustrations, so 256 colours with
dithering keep the look at display size while cutting the files by about
three quarters. Cutouts are stored as palette PNGs with a tRNS alpha table
rather than 32-bit RGBA, which is what makes them small; their feathering and
cream borders survive because the alpha is quantised together with the colour.

    python3 tools/compress.py scenes/*/*.png
    python3 tools/compress.py --colors 128 scenes/intro/backdrop.png
    python3 tools/compress.py --dry-run scenes/*/*.png
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

COLORS = 256
DITHER = Image.Dither.FLOYDSTEINBERG


def is_cutout(image: Image.Image) -> bool:
    """True when the layer has real transparency (a cutout, not a backdrop)."""
    return image.convert("RGBA").getchannel("A").getextrema()[0] < 255


def compress(path: Path, colors: int = COLORS) -> int:
    """Rewrite ``path`` in place as a palette PNG; returns the new size."""
    with Image.open(path) as opened:
        image = opened.convert("RGBA")

    if is_cutout(image):
        # One palette entry per colour+alpha pair, stored in a tRNS chunk.
        result = image.quantize(colors=colors, method=Image.FASTOCTREE)
    else:
        result = image.convert("RGB").quantize(colors=colors, dither=DITHER)

    result.save(path, format="PNG", optimize=True)
    return path.stat().st_size


def verify(path: Path, cutout: bool) -> None:
    with Image.open(path) as check:
        if check.mode != "P":
            raise SystemExit(f"{path}: expected a palette PNG, got mode {check.mode}")
        if cutout and check.info.get("transparency") is None:
            raise SystemExit(f"{path}: cutout lost its transparency table")
        if not cutout and check.info.get("transparency") is not None:
            raise SystemExit(f"{path}: backdrop gained a transparency table")
        if cutout and check.convert("RGBA").getchannel("A").getextrema()[0] == 255:
            raise SystemExit(f"{path}: cutout is fully opaque after compression")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--colors", type=int, default=COLORS)
    parser.add_argument("--dry-run", action="store_true", help="report sizes only")
    args = parser.parse_args(argv)

    total_before = total_after = 0
    for path in args.paths:
        before = path.stat().st_size
        with Image.open(path) as image:
            mode = image.mode
            cutout = is_cutout(image)
        if args.dry_run:
            print(f"{path.name}: {before / 1048576:.2f} MB, {mode}, "
                  f"{'cutout' if cutout else 'opaque'}")
            continue
        after = compress(path, args.colors)
        verify(path, cutout)
        total_before += before
        total_after += after
        print(f"{path.name}: {before / 1048576:.2f} -> {after / 1048576:.2f} MB "
              f"({100 - after * 100 / before:.0f}% smaller)")

    if not args.dry_run and total_before:
        print(f"total: {total_before / 1048576:.2f} -> {total_after / 1048576:.2f} MB "
              f"({100 - total_after * 100 / total_before:.0f}% smaller)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
