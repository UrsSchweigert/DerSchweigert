#!/usr/bin/env python3
"""Create the six higher-tier dragon sprites for levels 55-60.

Three stages - young, old, ancient - exist as grid position 5 in sets 1, 2 and
3. Two colour shifts of each give the six remaining classes. The shift is a
hue rotation in HSV that leaves luminance and saturation alone, so the pixel-art
shading and outline weight survive, and the result stays a real sprite rather
than a tinted flat overlay.

Run: python3 sites/ffm/scripts/make_dragon_variants.py [--write]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

FFM_ROOT = Path(__file__).resolve().parent.parent
SPRITE_DIR = FFM_ROOT / "static" / "game" / "fiend-sprites"
STAGE_DIR = FFM_ROOT / "build" / "dragon-variants"

# (source sprite, output name, hue rotation in degrees)
VARIANTS = [
    ("set1-05", "dragon-1", 145),   # young, molten red (blue + 145 deg)
    ("set1-05", "dragon-2", 300),   # young, verdant green (blue + 300 deg)
    ("set2-05", "dragon-3", 145),   # old, molten red
    ("set2-05", "dragon-4", 300),   # old, verdant green
    ("set3-05", "dragon-5", 145),   # ancient, molten red
    ("set3-05", "dragon-6", 300),   # ancient, verdant green
]


def hue_shift(image: Image.Image, degrees: float) -> Image.Image:
    rgba = np.array(image.convert("RGBA")).astype(np.float32)
    rgb = rgba[:, :, :3] / 255.0
    alpha = rgba[:, :, 3]
    hsv = np.array(Image.fromarray((rgb * 255).astype(np.uint8), "RGB").convert("HSV")).astype(np.float32)
    hsv[:, :, 0] = (hsv[:, :, 0] + degrees / 360.0 * 255.0) % 255.0
    shifted = np.array(Image.fromarray(hsv.astype(np.uint8), "HSV").convert("RGB")).astype(np.float32)
    out = np.dstack([shifted, alpha]).astype(np.uint8)
    out[alpha == 0] = 0
    return Image.fromarray(out, "RGBA")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--write", action="store_true",
                        help="write the variants into static/game/fiend-sprites")
    args = parser.parse_args(argv)

    STAGE_DIR.mkdir(parents=True, exist_ok=True)
    made = 0
    for source, name, degrees in VARIANTS:
        path = SPRITE_DIR / f"{source}.png"
        if not path.is_file():
            print(f"  {name}: missing {path.name}", file=sys.stderr)
            continue
        out = hue_shift(Image.open(path), degrees)
        target = (SPRITE_DIR if args.write else STAGE_DIR) / f"{name}.png"
        out.save(target, format="PNG", optimize=True)
        made += 1
        print(f"  {name}: {source} hue {degrees:+d}° -> {target}")
    print(f"wrote {made} dragon variants")
    return 0 if made else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
