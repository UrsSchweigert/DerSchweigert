#!/usr/bin/env python3
"""Add the story-diorama cream paper border to a cutout.

Every cutout layer in the art bible has "a thin cream paper border", which
reads as a cut paper flat standing in front of the backdrop. Asking an image
model for that border makes it draw an ink outline instead, so the border is
added here: the alpha is grown by a few pixels and filled with the paper cream,
which keeps every layer identical no matter which model rendered it.

    python3 tools/add-border.py scenes/act-1/village.png
    python3 tools/add-border.py --px 10 --color '#efe2c6' scenes/*/*.png
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageFilter

PAPER_CREAM = "#efe2c6"


def add_border(path: Path, px: int, color: str) -> tuple[int, int]:
    """Grow the silhouette by ``px`` and fill it with ``color``, in place."""
    with Image.open(path) as opened:
        layer = opened.convert("RGBA")
    alpha = layer.getchannel("A")
    grown = alpha.filter(ImageFilter.MaxFilter(px * 2 + 1))
    border = Image.new("RGBA", layer.size, color)
    border.putalpha(grown)
    # The painted layer sits inside the grown silhouette; its own alpha stays
    # as rendered, so no soft edge is lost.
    result = Image.alpha_composite(border, layer)
    result.save(path, format="PNG", optimize=True)
    return layer.size


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--px", type=int, default=8, help="border thickness in pixels")
    parser.add_argument("--color", default=PAPER_CREAM, help="border colour")
    args = parser.parse_args(argv)

    for path in args.paths:
        before = path.stat().st_size
        add_border(path, args.px, args.color)
        print(f"{path.name}: cream border {args.px}px "
              f"({before / 1024:.0f} -> {path.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
