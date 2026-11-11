#!/usr/bin/env python3
"""Remove the hard baked ground shadows from the fiend sprites.

The hero's shadow is drawn at runtime as a radial gradient (`drawSoftShadow` in
`static/game/entities.js`), but every fiend sprite carries a flat, hard-edged
ellipse baked into the PNG by the art generator. Next to the hero's soft shadow
the fiends look like stickers on the background, so the baked ellipses are
removed here and the same runtime gradient is drawn under them instead - one
light for the whole cast.

Detection, in order:
  1. the colour that is common in the sprite's bottom band but does *not* occur
     on the creature itself (a body colour appears all over the sprite, the
     shadow only near the ground), then
  2. the sprite set's default shadow tone, for creatures whose own feet reach
     the bottom row (set 1 and set 2 were generated on different backgrounds,
     so their shadow tones differ).

A candidate is only accepted when the region it produces is wide and flat -
wider than 30% of the sprite and no taller than a quarter of it - which is what
keeps a creature's own flat base out of the mask. Anything that fails is
reported and left untouched, so re-running is safe.

Run: python3 sites/ffm/scripts/feather_fiend_shadows.py [--report-only]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

FFM_ROOT = Path(__file__).resolve().parent.parent
SPRITE_DIR = FFM_ROOT / "static" / "game" / "fiend-sprites"

ALPHA_MIN = 120           # the baked shadows sit at alpha ~210-250
BAND_HEIGHT = 0.24        # fraction of the sprite height the shadow lives in
MIN_BAND_PIXELS = 250     # ignore colours that only speckle the band
BODY_LEAK_MAX = 0.05      # a shadow tone appears on the body this rarely
MIN_WIDTH_RATIO = 0.30    # a shadow is wide...
MAX_HEIGHT_RATIO = 0.24   # ...and flat
TOLERANCES = (16, 26, 36)  # colour distance, tried from strict to loose
GROUND_GAP_PX = 8          # a shadow this far above the sprite's bottom is not one
RIM_ITERATIONS = 3         # how far the dithered rim around the flat core is followed
RIM_LUM_DELTA = 35         # keep the rim growth near the core's own brightness


def _frame(image: np.ndarray):
    alpha = image[:, :, 3].astype(int)
    rgb = image[:, :, :3].astype(int)
    opaque = alpha > ALPHA_MIN
    ys, xs = np.nonzero(opaque)
    bottom_row = int(ys.max())
    height = bottom_row - int(ys.min()) + 1
    width = int(xs.max() - xs.min() + 1)
    band_top = bottom_row - int(BAND_HEIGHT * height)
    return opaque, rgb, bottom_row, band_top, width, height


def _shadow_components(mask: np.ndarray, bottom_row: int,
                       width: int, height: int) -> np.ndarray:
    """Shadow-shaped pieces of `mask`, plus the ones that touch the ground.

    A creature whose legs reach the bottom row breaks the ellipse into pieces
    that no longer connect to the lowest row (the spider does), so the largest
    wide-and-flat piece is taken as well - the geometry test is what keeps body
    parts out, not the connection to the bottom.
    """
    labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
    touching = {lab for lab in np.unique(labels[bottom_row]) if lab}
    keep = set(touching)
    best = None
    for lab in range(1, count + 1):
        piece = labels == lab
        if piece.sum() < MIN_BAND_PIXELS // 2:
            continue
        ys, xs = np.nonzero(piece)
        w = xs.max() - xs.min() + 1
        h = ys.max() - ys.min() + 1
        if w < MIN_WIDTH_RATIO * width or h > MAX_HEIGHT_RATIO * height:
            continue
        if best is None or piece.sum() > best[1]:
            best = (lab, int(piece.sum()))
    if best is not None:
        keep.add(best[0])
    if not keep:
        return np.zeros_like(mask)
    region = np.isin(labels, list(keep))
    ys, _ = np.nonzero(region)
    if ys.size and bottom_row - ys.max() > GROUND_GAP_PX:
        return np.zeros_like(mask)
    return region


def _region_for_seed(opaque, rgb, bottom_row, band_top, seed, tolerance, width, height):
    near = opaque & (np.abs(rgb - seed).max(axis=2) <= tolerance)
    near[:band_top] = False
    return _shadow_components(near, bottom_row, width, height)


def _grow_rim(region: np.ndarray, opaque, rgb, band_top, bottom_row) -> np.ndarray:
    """Follow the dithered, darker rim that surrounds the flat shadow core.

    The baked ellipses are not one flat colour: the tone shifts where the shadow
    falls over the creature, and the outer edge is dithered. Removing only the
    flat core leaves a speckled ring that still reads as a hard shadow, so the
    removal is grown into neighbouring shadow-coloured pixels - but only ones
    close to the core's brightness, which keeps bright creature parts (claws,
    weapon highlights) out of it.
    """
    ref = rgb[region].mean(axis=0)
    lum = rgb.mean(axis=2)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    family = (opaque & (b - r >= 10) & (b - g >= 12)
              & (np.abs(lum - ref.mean()) <= RIM_LUM_DELTA))
    family[:band_top] = False
    grown = region.copy()
    for _ in range(RIM_ITERATIONS):
        step = ndimage.binary_dilation(grown, iterations=1) & family
        if step.sum() == grown.sum():
            break
        grown = step
    ys, _ = np.nonzero(grown)
    if ys.size and bottom_row - ys.max() > GROUND_GAP_PX:
        return region
    if grown.sum() > 2.2 * max(1, region.sum()):
        return region
    return grown


def _accept(region: np.ndarray, width: int, height: int) -> bool:
    if not region.any():
        return False
    ys, xs = np.nonzero(region)
    w = xs.max() - xs.min() + 1
    h = ys.max() - ys.min() + 1
    return w >= MIN_WIDTH_RATIO * width and h <= MAX_HEIGHT_RATIO * height


def _bottom_only_seed(opaque, rgb, bottom_row, band_top):
    """Colour that is common near the ground but absent from the creature."""
    buckets = rgb >> 3
    key = buckets[:, :, 0] * 4096 + buckets[:, :, 1] * 64 + buckets[:, :, 2]
    bottom = opaque.copy()
    bottom[:band_top] = False
    above = opaque & ~bottom
    bottom_keys, bottom_counts = np.unique(key[bottom], return_counts=True)
    above_keys, above_counts = np.unique(key[above], return_counts=True)
    above_map = dict(zip(above_keys.tolist(), above_counts.tolist()))
    best = None
    for value, count in zip(bottom_keys.tolist(), bottom_counts.tolist()):
        if count < MIN_BAND_PIXELS:
            continue
        if above_map.get(value, 0) > BODY_LEAK_MAX * count:
            continue
        if best is None or count > best[1]:
            best = (value, count)
    if best is None:
        return None
    value = best[0]
    return np.array([(value >> 12), (value >> 6) & 63, value & 63]) * 8 + 4


def _shadow_tone(opaque, rgb, bottom_row, band_top, width, height, fallback):
    seed = _bottom_only_seed(opaque, rgb, bottom_row, band_top)
    candidates = []
    if seed is not None:
        candidates.append((seed, "bottom-only tone"))
    if fallback is not None:
        candidates.append((fallback, "set default tone"))
    for tone, how in candidates:
        for tolerance in TOLERANCES:
            region = _region_for_seed(opaque, rgb, bottom_row, band_top, tone, tolerance,
                                      width, height)
            if _accept(region, width, height):
                region = _grow_rim(region, opaque, rgb, band_top, bottom_row)
                return region, tone, tolerance, how
    return None, seed, None, None


def _detected_seed(image: np.ndarray):
    opaque, rgb, bottom_row, band_top, width, height = _frame(image)
    region, seed, _, _ = _shadow_tone(opaque, rgb, bottom_row, band_top, width, height, None)
    return seed if region is not None else None


def _set_defaults(sprites: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Most common detected shadow tone per sprite set, used as a fallback."""
    per_set: dict[str, list[np.ndarray]] = {}
    for name, image in sprites.items():
        seed = _detected_seed(image)
        if seed is not None:
            per_set.setdefault(name.split("-")[0], []).append(seed)
    return {set_name: np.round(np.median(np.stack(seeds), axis=0)).astype(int)
            for set_name, seeds in per_set.items()}


def strip_sprite(image: np.ndarray, fallback=None):
    opaque, rgb, bottom_row, band_top, width, height = _frame(image)
    region, seed, tolerance, how = _shadow_tone(
        opaque, rgb, bottom_row, band_top, width, height, fallback)
    if region is None:
        return None, seed, None
    out = image.copy()
    out[region] = 0
    ys, xs = np.nonzero(region)
    info = dict(how=how, tolerance=tolerance,
                w=int(xs.max() - xs.min() + 1), h=int(ys.max() - ys.min() + 1),
                px=int(region.sum()))
    return out, seed, info


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--report-only", action="store_true",
                        help="measure the baked shadows without writing anything")
    args = parser.parse_args(argv)

    paths = sorted(SPRITE_DIR.glob("set*.png"))
    if not paths:
        print(f"no fiend sprites in {SPRITE_DIR}", file=sys.stderr)
        return 1
    sprites = {p.name: np.array(Image.open(p).convert("RGBA")) for p in paths}
    defaults = _set_defaults(sprites)

    cleaned = skipped = 0
    for path in paths:
        out, seed, info = strip_sprite(sprites[path.name],
                                       defaults.get(path.name.split("-")[0]))
        if out is None:
            skipped += 1
            tone = "?" if seed is None else np.round(seed).astype(int).tolist()
            print(f"  {path.name}: no baked shadow found (tone candidate {tone}) - untouched")
            continue
        cleaned += 1
        print(f"  {path.name}: {info['how']} tone={np.round(seed).astype(int).tolist()} "
              f"tolerance={info['tolerance']} shadow={info['w']}x{info['h']} "
              f"{info['px']}px removed")
        if not args.report_only:
            Image.fromarray(out, "RGBA").save(path, format="PNG", optimize=True)

    print(f"{'measured' if args.report_only else 'cleaned'} {cleaned} sprites, "
          f"{skipped} left untouched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
