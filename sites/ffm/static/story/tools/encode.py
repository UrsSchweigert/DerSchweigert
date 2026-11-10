#!/usr/bin/env python3
"""Encode the shipped story layers as WebP.

The renders are hand-painted paper illustrations, so lossy WebP at quality 80
is visually identical at display size while being about ten times smaller than
the rendered PNG: the intro goes from 8.8 MB to under 1 MB. WebP keeps the
cutouts' alpha channel, so feathering and cream borders survive exactly.

    python3 tools/encode.py scenes/*/*.png             # writes .webp, drops the .png
    python3 tools/encode.py --quality 88 scenes/*/*.png
    python3 tools/encode.py --dry-run scenes/*/*.png
    python3 tools/encode.py --format png scenes/*/*.png  # palette-PNG fallback

The raw renders in sources/ are the archive; only scenes/ holds shipped files.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

QUALITY = 80
COLORS = 256
DITHER = Image.Dither.FLOYDSTEINBERG


def has_transparency(image: Image.Image) -> bool:
    return image.convert("RGBA").getchannel("A").getextrema()[0] < 255


def encode(path: Path, fmt: str, quality: int, colors: int) -> tuple[Path, bool]:
    """Write the encoded layer next to ``path``; returns (output, is_cutout)."""
    with Image.open(path) as opened:
        image = opened.convert("RGBA")
    cutout = has_transparency(image)

    if fmt == "webp":
        out = path.with_suffix(".webp")
        image.save(out, format="WEBP", quality=quality, method=6, alpha_quality=100)
    else:
        out = path.with_suffix(".png")
        if cutout:
            # One palette entry per colour+alpha pair, stored in a tRNS chunk.
            image.quantize(colors=colors, method=Image.FASTOCTREE).save(
                out, format="PNG", optimize=True)
        else:
            image.convert("RGB").quantize(colors=colors, dither=DITHER).save(
                out, format="PNG", optimize=True)
    return out, cutout


def verify(source: Path, out: Path, cutout: bool) -> None:
    with Image.open(source) as original, Image.open(out) as check:
        if check.size != original.size:
            raise SystemExit(f"{out}: size changed {original.size} -> {check.size}")
    if cutout and check.convert("RGBA").getchannel("A").getextrema()[0] == 255:
        raise SystemExit(f"{out}: cutout lost its transparency")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--format", choices=("webp", "png"), default="webp")
    parser.add_argument("--quality", type=int, default=QUALITY, help="WebP quality")
    parser.add_argument("--colors", type=int, default=COLORS, help="palette size for --format png")
    parser.add_argument("--dry-run", action="store_true", help="report sizes only")
    parser.add_argument("--keep-source", action="store_true", help="keep the input PNG")
    args = parser.parse_args(argv)

    total_before = total_after = 0
    for path in args.paths:
        before = path.stat().st_size
        if args.dry_run:
            with Image.open(path) as image:
                kind = "cutout" if has_transparency(image) else "opaque"
            print(f"{path.name}: {before / 1048576:.2f} MB, {kind}")
            continue
        out, cutout = encode(path, args.format, args.quality, args.colors)
        verify(path, out, cutout)
        if not args.keep_source and out != path:
            path.unlink()
        after = out.stat().st_size
        total_before += before
        total_after += after
        print(f"{out.name}: {before / 1048576:.2f} -> {after / 1048576:.2f} MB "
              f"({100 - after * 100 / before:.0f}% smaller)")

    if not args.dry_run and total_before:
        print(f"total: {total_before / 1048576:.2f} -> {total_after / 1048576:.2f} MB "
              f"({100 - total_after * 100 / total_before:.0f}% smaller)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
