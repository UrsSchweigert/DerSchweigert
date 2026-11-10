#!/usr/bin/env python3
"""Widen a foreground strip by mirror-tiling it, so it can cover the stage.

The rendered foreground bands are about 3:1, but a layer that spans the 1920 px
stage at a height that keeps its dense line near the midground's base needs
roughly 4.5:1. Mirror-tiling keeps the join seamless (the mirrored tile's edge
is the same pixels as the original's) and repeats the vegetation without a
visible seam.

    python3 tools/tile-foreground.py scenes/act-1/foreground.webp --height 560 --width 2500
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image


def tile(src: Path, width: int, height: int, out: Path | None = None) -> Path:
    with Image.open(src) as opened:
        strip = opened.convert("RGBA")
    scale = height / strip.height
    strip = strip.resize((max(1, round(strip.width * scale)), height), Image.LANCZOS)

    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    x = 0
    flip = False
    while x < width:
        piece = strip.transpose(Image.Transpose.FLIP_LEFT_RIGHT) if flip else strip
        canvas.alpha_composite(piece, (x, 0))
        x += strip.width
        flip = not flip

    target = out or src.with_name(f"{src.stem}-wide{src.suffix}")
    if target.suffix == ".webp":
        canvas.save(target, format="WEBP", quality=80, method=6, alpha_quality=100)
    else:
        canvas.save(target, format="PNG", optimize=True)
    return target


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--width", type=int, default=2500)
    parser.add_argument("--height", type=int, default=560)
    args = parser.parse_args(argv)

    for path in args.paths:
        out = tile(path, args.width, args.height)
        print(f"{out.name}: {args.width}x{args.height} ({out.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
