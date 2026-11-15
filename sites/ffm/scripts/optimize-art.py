#!/usr/bin/env python3
"""Shrink the game art: painted PNGs become WebP, the app icons get real sizes.

The stage backgrounds, title art and splash art are hand-painted illustrations
saved as 24-bit PNGs of 2-3 MB each. Lossy WebP at quality 85/90 is visually
identical at the sizes the game draws them and is about ten times smaller; the
alpha-carrying pieces (title logo, dragon) keep their alpha channel.

The three app icons were all the same 1254x1254 source at 2.7 MB each; they are
written at the size their markup actually declares.

    python3 scripts/optimize-art.py            # convert, then report
    python3 scripts/optimize-art.py --dry-run
    python3 scripts/optimize-art.py --only sprites   # re-convert just the fiend sprites

Run it after replacing any of the art. Code and tests reference the .webp names,
so update those too if you add a file.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

STATIC = Path(__file__).resolve().parent.parent / "static"

# Painted art that becomes WebP, with its quality.
WEBP = {
    "game/stage-1.png": 85,
    "game/stage-2.png": 85,
    "game/stage-3.png": 85,
    "game/stage-4.png": 85,
    "game/stage-5.png": 85,
    "game/stage-6.png": 85,
    "game/background.png": 85,
    "game/splash-bg.png": 85,
    "game/title-art.png": 85,
    "game/title-art-wide.png": 85,
    "game/title-logo.png": 90,
    "game/dragon.png": 90,
}

# Pixel art: keep PNG, but palette-quantise it losslessly for this content.
PALETTE = ["game/hero-spritesheet-clean.png"]

# The 60 fiend sprites (54 class sprites + 6 dragon variants) are the single
# largest startup download: asset-preload.js fetches all of them behind the
# loading bar on the title screen, so at 24-bit PNG they alone were 7 MB of a
# 12 MB first load. They are painted sprite art with a hard alpha edge, drawn
# into the canvas at 152 px wide from a 256-344 px source, so a downscale of
# roughly 2x hides any compression noise; q88 keeps the mean channel error at
# the drawn size at 3/255 for 78% less data. Quality is deliberately above the
# 85 used for the backgrounds: these sprites carry thin outlines on flat fills,
# which is exactly what low-quality WebP smears.
SPRITE_GLOBS = {
    "game/fiend-sprites/*.png": 88,
}

# Icons: written at the size their markup declares (index.html, site.webmanifest).
ICONS = {
    "favicon.png": 192,          # declared 32x32 and 192x192
    "apple-touch-icon.png": 180,  # declared 180x180
    "app-icon.png": 1024,         # manifest declares 1024x1024
}


def report(path: Path, before: int) -> None:
    after = path.stat().st_size
    print(f"{path.relative_to(STATIC)}: {before / 1048576:.2f} -> "
          f"{after / 1048576:.2f} MB ({100 - after * 100 / before:.0f}% smaller)")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--only",
        choices=["webp", "palette", "icons", "sprites"],
        action="append",
        help="run only the named section(s); default runs all of them. Keeps a "
             "one-section rerun from rewriting the already-converted art.",
    )
    args = parser.parse_args(argv)
    sections = set(args.only or ["webp", "palette", "icons", "sprites"])

    saved = 0
    for rel, quality in (WEBP.items() if "webp" in sections else ()):
        source = STATIC / rel
        if not source.exists():
            print(f"skipping {rel} (already converted?)")
            continue
        before = source.stat().st_size
        if args.dry_run:
            print(f"{rel}: {before / 1048576:.2f} MB -> webp q{quality}")
            continue
        with Image.open(source) as opened:
            image = opened.convert("RGBA")
        out = source.with_suffix(".webp")
        image.save(out, format="WEBP", quality=quality, method=6, alpha_quality=100)
        with Image.open(out) as check:
            assert check.size == image.size, f"{out}: size changed"
        source.unlink()
        report(out, before)
        saved += before - out.stat().st_size

    for rel in (PALETTE if "palette" in sections else []):
        source = STATIC / rel
        if not source.exists():
            continue
        before = source.stat().st_size
        if args.dry_run:
            print(f"{rel}: {before / 1048576:.2f} MB -> palette png")
            continue
        with Image.open(source) as opened:
            image = opened.convert("RGBA")
        image.quantize(colors=256, method=Image.FASTOCTREE).save(source, format="PNG", optimize=True)
        report(source, before)
        saved += before - source.stat().st_size

    for rel, size in (ICONS.items() if "icons" in sections else ()):
        source = STATIC / rel
        before = source.stat().st_size
        if args.dry_run:
            print(f"{rel}: {before / 1048576:.2f} MB -> {size}x{size}")
            continue
        with Image.open(source) as opened:
            image = opened.convert("RGBA")
        resized = image.resize((size, size), Image.LANCZOS)
        resized.quantize(colors=256, method=Image.FASTOCTREE).save(source, format="PNG", optimize=True)
        report(source, before)
        saved += before - source.stat().st_size

    for pattern, quality in (SPRITE_GLOBS.items() if "sprites" in sections else ()):
        sources = sorted(STATIC.glob(pattern))
        if not sources:
            print(f"skipping {pattern} (already converted?)")
            continue
        before_all = sum(source.stat().st_size for source in sources)
        for source in sources:
            before = source.stat().st_size
            if args.dry_run:
                continue
            with Image.open(source) as opened:
                image = opened.convert("RGBA")
            out = source.with_suffix(".webp")
            image.save(out, format="WEBP", quality=quality, method=6, alpha_quality=100)
            with Image.open(out) as check:
                assert check.size == image.size, f"{out}: size changed"
            source.unlink()
            saved += before - out.stat().st_size
        if args.dry_run:
            print(f"{pattern}: {before_all / 1048576:.2f} MB -> webp q{quality} "
                  f"({len(sources)} files)")
        else:
            after_all = sum(source.with_suffix(".webp").stat().st_size for source in sources)
            print(f"{pattern}: {before_all / 1048576:.2f} -> {after_all / 1048576:.2f} MB "
                  f"({100 - after_all * 100 / before_all:.0f}% smaller, {len(sources)} files)")

    if not args.dry_run:
        print(f"total saved: {saved / 1048576:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
