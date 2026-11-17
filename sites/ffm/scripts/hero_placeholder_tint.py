#!/usr/bin/env python3
"""Interim hero art: give each pack hero a hue-shifted copy of the existing hero.

    hero_placeholder_tint.py            rebuild heroes/<id>/hero-atlas.webp, hero-frames.js, portrait.webp
                                        for the nine pack heroes from static/game/hero/ (the adventurer is untouched)

Stand-in until real sprites exist: same pixels, a different hue per hero, so the roster is tellable apart.
Overwriting a hero's three files with real art replaces its tint; delete its row here when it does.
"""
import colorsys
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

GAME = Path(__file__).resolve().parents[1] / "static" / "game"
SHIFT_DEGREES = {
    "adventuress": 40, "princess": 320, "princess-armed": 280, "rogue": 100, "rogue-f": 140,
    "soldier": 200, "soldier-f": 240, "monk": 70, "priestess": 170,
}


def shift_hue(image: Image.Image, degrees: float) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[..., 3]
    hsv = np.asarray(Image.fromarray(rgba[..., :3], "RGB").convert("HSV"), dtype=np.int16)
    hsv[..., 0] = (hsv[..., 0] + round(degrees / 360 * 256)) % 256
    rgb = np.asarray(Image.fromarray(hsv.astype(np.uint8), "HSV").convert("RGB"))
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def portrait_of(atlas: Image.Image) -> Image.Image:
    idle = atlas.crop((0, 0, 144, 163))
    return idle.crop((8, 0, 136, 128)).resize((256, 256), Image.NEAREST)


def main() -> None:
    atlas = Image.open(GAME / "hero" / "hero-atlas.webp").convert("RGBA")
    for hero, degrees in SHIFT_DEGREES.items():
        out = GAME / "heroes" / hero
        out.mkdir(parents=True, exist_ok=True)
        tinted = shift_hue(atlas, degrees)
        tinted.save(out / "hero-atlas.webp", "WEBP", lossless=True, quality=100, method=6)
        portrait_of(tinted).save(out / "portrait.webp", "WEBP", lossless=True, quality=100, method=6)
        shutil.copy(GAME / "hero" / "hero-frames.js", out / "hero-frames.js")
        print(f"{hero}: hue {degrees:+d} deg, atlas {(out / 'hero-atlas.webp').stat().st_size} B, "
              f"portrait {(out / 'portrait.webp').stat().st_size} B")


if __name__ == "__main__":
    main()
