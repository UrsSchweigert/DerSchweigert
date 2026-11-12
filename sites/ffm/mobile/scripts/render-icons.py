#!/usr/bin/env python3
"""Render the generated Arithmo Slayer icon into the Android and iOS builds.

Source of truth:
  ../store-art/app-store/icon-1024x1024.png
      the committed store icon — full-bleed art with the gold wordmark — so the
      installed app, the App Store and Play Store listing all show one artwork.

Outputs:
  ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png   1024x1024 RGB
  android/…/mipmap-<density>/ic_launcher.png            legacy square icon
  android/…/mipmap-<density>/ic_launcher_round.png      legacy round icon
  android/…/mipmap-<density>/ic_launcher_foreground.png adaptive foreground layer
  android/…/mipmap-<density>/ic_launcher_background.png adaptive background layer

Android's adaptive icon is a 108dp canvas whose visible mask is the inner 72dp,
and the project's mipmap-anydpi-v26 XML already wraps both layers in
`android:inset="16.7%"`. That inset is what fits a 108dp layer into the 72dp
safe zone, so these layers stay full-bleed and the whole icon — hero, sword,
castle and wordmark — lands inside the circular mask with only the corners
cropped. Do not pre-shrink the artwork as well or the icon ends up doubly inset
and looks lost in the middle of the tile.

iOS applies its own squircle mask, so that asset is the untouched 1024px art.

Usage:
  python3 sites/ffm/mobile/scripts/render-icons.py
  python3 sites/ffm/mobile/scripts/render-icons.py --check   # verify, write nothing
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent.parent.parent
SOURCE = REPO / "sites" / "ffm" / "store-art" / "app-store" / "icon-1024x1024.png"

RES = ROOT / "android" / "app" / "src" / "main" / "res"
IOS_ICON = ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset" / "AppIcon-512@2x.png"

# Legacy launcher: 48dp at mdpi, so density scale x 48.
LEGACY = {"ldpi": 36, "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
# Adaptive layer: 108dp at mdpi (the mask takes the inner 72dp).
ADAPTIVE = {"ldpi": 81, "mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

# --ink-950 from static/styles.css; the icon's own darkest band colour.
INK_950 = (9, 20, 17)

# Anti-aliasing factor for the circular legacy mask.
SUPERSAMPLE = 4


def load_source() -> Image.Image:
    if not SOURCE.exists():
        sys.exit(f"missing source icon: {SOURCE.relative_to(REPO)} — run the store-art compositor first")
    return Image.open(SOURCE).convert("RGB")


def square(art: Image.Image, size: int) -> Image.Image:
    return art.resize((size, size), Image.LANCZOS)


def round_mask(art: Image.Image, size: int) -> Image.Image:
    """The legacy round icon: the art clipped to a circle, corners removed."""
    big = size * SUPERSAMPLE
    circle = Image.new("L", (big, big), 0)
    ImageDraw.Draw(circle).ellipse((0, 0, big - 1, big - 1), fill=255)
    circle = circle.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(square(art, size), (0, 0), circle)
    return out


def flat(size: int, colour: tuple[int, int, int]) -> Image.Image:
    return Image.new("RGB", (size, size), colour)


def plan(art: Image.Image) -> list[tuple[Path, Image.Image]]:
    """Every file to write, in one list, so --check can validate them all."""
    jobs: list[tuple[Path, Image.Image]] = []

    jobs.append((IOS_ICON, square(art, 1024)))

    for density, size in LEGACY.items():
        folder = RES / f"mipmap-{density}"
        jobs.append((folder / "ic_launcher.png", square(art, size)))
        jobs.append((folder / "ic_launcher_round.png", round_mask(art, size)))

    for density, size in ADAPTIVE.items():
        folder = RES / f"mipmap-{density}"
        # Full-bleed on purpose: mipmap-anydpi-v26 insets both layers by 16.7 %.
        jobs.append((folder / "ic_launcher_foreground.png", square(art, size)))
        # Never visible inside the mask (the inset square contains the circle),
        # but it keeps the parallax zoom from showing a transparent hole.
        jobs.append((folder / "ic_launcher_background.png", flat(size, INK_950)))

    return jobs


def write(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="verify the committed files match the source, write nothing")
    args = parser.parse_args()

    art = load_source()
    jobs = plan(art)
    if args.check:
        stale = [p for p, img in jobs if not p.exists() or Image.open(p).size != img.size]
        for path in stale:
            print(f"stale: {path.relative_to(REPO)}")
        sys.exit(1 if stale else 0)

    for path, image in jobs:
        write(path, image)
        print(f"{path.relative_to(REPO)}  {image.width}x{image.height}")


if __name__ == "__main__":
    main()
