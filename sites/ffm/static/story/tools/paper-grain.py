#!/usr/bin/env python3
"""Generate the player's paper-grain tile (player/paper-grain.webp).

The diorama player lays a warm, uneven sheet of paper over the whole scene by
multiplying a repeating grain tile (see .diorama__paper in
../player/diorama-player.css). The tile used to be an inline SVG
<feTurbulence> filter, which Blink has to re-run every time it re-rasterises
the image - the paper covers the rotated, scaled, blend-mode player layer, so
on Android that re-raster happens constantly and some GPU raster paths came
back with black tiles (visible as a regular grid of dark squares across the
intro). A plain image tile is rasterised like any other texture.

The grain is periodic by construction: the noise is a sum of random-phase
sinusoids whose frequencies are whole cycles per tile, so opposite edges are
the same pixels and the tile repeats without a seam.

    python3 tools/paper-grain.py                    # writes player/paper-grain.webp
    python3 tools/paper-grain.py --size 320 --seed 7 --quality 85
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

# The warm grey the old feColorMatrix baked into the tile (0.62, 0.5, 0.34).
TONE = (158, 128, 87)
# Peak opacity of the grain. The old overlay multiplied the alpha channel by
# 0.55, but feTurbulence spends much of its range near zero, so its *mean*
# opacity was lower; 0.42 reproduces the darkening it produced on screen
# (measured as identical frame means over a scene, to within a level).
ALPHA = 0.42
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "player" / "paper-grain.webp"


def periodic_noise(size: int, seed: int) -> "np.ndarray":
    """Fibrous value noise in [0, 1], a whole number of cycles per tile."""
    rng = np.random.default_rng(seed)
    grid = np.arange(size)
    xx, yy = np.meshgrid(grid, grid)
    total = np.zeros((size, size))
    weight = 0.0
    for _ in range(48):
        # Roughly 3-30 fibres per tile, each wave oriented at a random angle.
        frequency = int(rng.integers(3, 31))
        angle = rng.uniform(0, 2 * np.pi)
        fx = int(round(frequency * np.cos(angle)))
        fy = int(round(frequency * np.sin(angle)))
        if fx == 0 and fy == 0:
            continue
        phase = rng.uniform(0, 2 * np.pi)
        amplitude = 1.0 / (1.0 + abs(fx) + abs(fy))
        total += amplitude * np.cos(2 * np.pi * (fx * xx + fy * yy) / size + phase)
        weight += amplitude
    noise = total / weight
    # Fine tooth on top, folded in as one-pixel grain that also wraps.
    grain = rng.uniform(-1, 1, (size, size))
    grain = (grain + np.roll(grain, 1, axis=0) + np.roll(grain, 1, axis=1)) / 3
    noise = 0.75 * noise + 0.25 * grain
    lo, hi = noise.min(), noise.max()
    return (noise - lo) / (hi - lo)


def build(size: int, seed: int) -> Image.Image:
    density = periodic_noise(size, seed)
    rgba = np.zeros((size, size, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = TONE
    rgba[..., 3] = np.clip(density * ALPHA * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(rgba)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--size", type=int, default=320, help="tile edge in px (default 320)")
    parser.add_argument("--seed", type=int, default=11, help="noise seed (default 11)")
    parser.add_argument("--quality", type=int, default=85, help="WebP quality (default 85)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output file")
    args = parser.parse_args()

    if args.size < 64 or args.size > 1024:
        raise SystemExit("--size must be between 64 and 1024")
    image = build(args.size, args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.out, format="WEBP", quality=args.quality, method=6, alpha_quality=100)
    print(f"{args.out} {args.size}x{args.size} {args.out.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
