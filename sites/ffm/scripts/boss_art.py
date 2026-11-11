#!/usr/bin/env python3
"""Turn a rendered illustration into the game's pixel-art language.

The stage backgrounds in ``static/game/stage-N.webp`` are 16-bit pixel art, and
FLUX renders smooth, painterly images. Rather than fight the model, this script
does what the promo pipeline already does: pool the render down onto a fixed
pixel grid, snap the colours to a small palette, then scale the grid back up with
nearest-neighbour so every logical pixel is an exact square block.

Usage:
    python3 sites/ffm/scripts/boss_art.py arena in.png out.webp [--grid 256x144]
    python3 sites/ffm/scripts/boss_art.py figure in.png out.webp [--grid 96x96]

Arenas keep their full frame (16:9) and are delivered at 1536x864. Figures are
generated on a flat magenta key, so ``figure`` also derives alpha from the key,
removes magenta spill and crops to the character.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageEnhance

ARENA_OUTPUT = (1536, 864)



def _pool(image: Image.Image, grid: tuple[int, int]) -> Image.Image:
    """Downsample to the logical pixel grid with box averaging."""
    return image.convert("RGB").resize(grid, Image.Resampling.BOX)


def _lift(image: Image.Image, saturation: float, contrast: float) -> Image.Image:
    """Down-pooling flattens colour, so restore the punch the stage art has."""
    lifted = ImageEnhance.Color(image).enhance(saturation)
    return ImageEnhance.Contrast(lifted).enhance(contrast)


def _quantise(image: Image.Image, colours: int) -> Image.Image:
    """Snap to a small palette. Dithering keeps the shading clusters readable."""
    return image.convert("RGB").quantize(
        colors=colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG
    ).convert("RGB")


def _crop_to_frame(image: Image.Image, target: tuple[int, int]) -> Image.Image:
    """Scale the grid up by whole numbers, then centre-crop to the frame."""
    scale = max(1, round(target[0] / image.width))
    upscaled = image.resize((image.width * scale, image.height * scale), Image.Resampling.NEAREST)
    if upscaled.width < target[0] or upscaled.height < target[1]:
        upscaled = image.resize(target, Image.Resampling.NEAREST)
    left = max(0, (upscaled.width - target[0]) // 2)
    top = max(0, (upscaled.height - target[1]) // 2)
    return upscaled.crop((left, top, left + target[0], top + target[1]))


def pixelate(
    src: Path,
    out: Path,
    grid: tuple[int, int],
    colours: int,
    saturation: float = 1.15,
    contrast: float = 1.05,
) -> None:
    pooled = _lift(_pool(Image.open(src), grid), saturation, contrast)
    frame = _crop_to_frame(_quantise(pooled, colours), ARENA_OUTPUT)
    out.parent.mkdir(parents=True, exist_ok=True)
    frame.save(out, "WEBP", quality=92, method=6)


def _replace_background(image: Image.Image, target: tuple[int, int, int], tolerance: int) -> Image.Image:
    """Swap the flat render background for the panel colour it will sit on.

    The background is sampled from a corner rather than assumed, so a render that
    comes back rose or navy still lands on the right panel tone.
    """
    key = image.getpixel((2, 2))
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b = pixels[x, y]
            if abs(r - key[0]) + abs(g - key[1]) + abs(b - key[2]) <= tolerance:
                pixels[x, y] = target
    return image


def figure(
    src: Path,
    out: Path,
    grid: tuple[int, int],
    colours: int,
    background: tuple[int, int, int] | None = None,
) -> None:
    """Pixelate a portrait rendered on the fight panel's own midnight blue.

    No alpha is derived: the creature sits on the same #1d2f6b the overlay uses,
    so it composites without a cutout and without a keying fringe.
    """
    image = Image.open(src).convert("RGB")
    if background is not None:
        image = _replace_background(image, background, 70)
    pooled = _pool(image, _square_grid(image, grid))
    quantised = _quantise(pooled, colours)
    scale = max(1, 512 // max(quantised.width, quantised.height))
    final = quantised.resize(
        (quantised.width * scale, quantised.height * scale), Image.Resampling.NEAREST
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    final.save(out, "WEBP", lossless=True, method=6)


def _square_grid(image: Image.Image, grid: tuple[int, int]) -> tuple[int, int]:
    """Keep the portrait square so the card frame never distorts it."""
    side = min(grid)
    return (side, side)


def parse_grid(text: str) -> tuple[int, int]:
    width, height = text.lower().split("x")
    return (int(width), int(height))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["arena", "figure"])
    parser.add_argument("src", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--grid", default=None, help="logical pixel grid, e.g. 320x180")
    parser.add_argument("--colours", type=int, default=0, help="palette size")
    parser.add_argument(
        "--bg", default=None, help="figure background colour to replace, e.g. 10211b"
    )
    parser.add_argument("--saturation", type=float, default=1.15)
    parser.add_argument("--contrast", type=float, default=1.05)
    args = parser.parse_args()

    if args.kind == "arena":
        grid = parse_grid(args.grid or "320x180")
        pixelate(
            args.src, args.out, grid, args.colours or 48, args.saturation, args.contrast
        )
    else:
        grid = parse_grid(args.grid or "128x128")
        background = tuple(int(args.bg[i:i + 2], 16) for i in (0, 2, 4)) if args.bg else None
        figure(args.src, args.out, grid, args.colours or 28, background)


if __name__ == "__main__":
    main()
