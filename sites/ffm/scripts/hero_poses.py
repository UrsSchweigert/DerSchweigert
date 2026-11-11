#!/usr/bin/env python3
"""Turn a 2x2 pose sheet into four hero frames.

Each animation is generated as one image containing four poses in a 2x2 grid,
which is what keeps the character identical across the four frames of a clip -
four separate renders drift, and a clip that drifts reads as a shudder. This
splits the grid, cuts the flat backdrop and the model's grey contact shadow,
trims each pose and scales them all to the same figure height as the master
frame so the animation cannot change size.

Run:
  python3 sites/ffm/scripts/hero_poses.py --split build/hero-poses/idle.png --name idle
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

FFM_ROOT = Path(__file__).resolve().parent.parent
STAGE_DIR = FFM_ROOT / "build" / "hero-regen"
REFERENCE = FFM_ROOT / "build" / "hero-reference.png"

TARGET_HEIGHT_PX = 163      # the master idle frame's height (atlas pixels)
ALPHA_CUT = 110


def _largest(mask: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
    if count == 0:
        return mask
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    return labels == int(sizes.argmax())


def cut_pose(cell: Image.Image) -> Image.Image:
    """Key the flat backdrop and the model's soft grey contact shadow."""
    rgb = np.array(cell.convert("RGB")).astype(np.int16)
    lum = rgb.mean(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    flat_bright = (lum > 200) & (chroma < 18)
    labels, _ = ndimage.label(flat_bright, structure=np.ones((3, 3)))
    border = set(labels[0].tolist()) | set(labels[-1].tolist()) \
        | set(labels[:, 0].tolist()) | set(labels[:, -1].tolist())
    border.discard(0)
    backdrop = np.isin(labels, list(border)) if border else _largest(flat_bright)
    subject = ndimage.binary_fill_holes(~backdrop)
    subject = _largest(subject)
    # The model's contact shadow is light grey; the hero's boots are also
    # low-chroma but much darker, so the brightness window matters.
    grey = (chroma < 12) & (lum > 168) & (lum < 232)
    bottom = np.zeros_like(subject)
    bottom[int(rgb.shape[0] * 0.55):] = True
    subject = ndimage.binary_fill_holes(subject & ~(grey & bottom))
    subject = _largest(subject)
    rgba = np.dstack([rgb.astype(np.uint8), np.where(subject, 255, 0).astype(np.uint8)])
    ys, xs = np.nonzero(subject)
    return Image.fromarray(rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1], "RGBA")


def scale_by(image: Image.Image, factor: float) -> Image.Image:
    a = np.array(image).astype(np.float32)
    alpha = a[:, :, 3:4] / 255.0
    premultiplied = np.concatenate([a[:, :, :3] * alpha, a[:, :, 3:4]], axis=2)
    size = (max(1, round(image.width * factor)), max(1, round(image.height * factor)))
    scaled = np.array(Image.fromarray(premultiplied.astype(np.uint8), "RGBA").resize(size, Image.LANCZOS)).astype(np.float32)
    out_alpha = scaled[:, :, 3:4]
    with np.errstate(divide="ignore", invalid="ignore"):
        rgb = np.where(out_alpha > 0, scaled[:, :, :3] * 255.0 / np.maximum(out_alpha, 1e-6), 0)
    out = np.concatenate([np.clip(rgb, 0, 255), out_alpha], axis=2).astype(np.uint8)
    # keep the pixel-art edge hard rather than a soft ramp
    out[out[:, :, 3] <= ALPHA_CUT] = 0
    out[out[:, :, 3] > ALPHA_CUT, 3] = 255
    return Image.fromarray(out, "RGBA")


def split(args) -> int:
    sheet = Image.open(args.split)
    if sheet.width != sheet.height:
        print(f"expected a square sheet, got {sheet.size}", file=sys.stderr)
        return 1
    half = sheet.width // 2
    cells = {
        f"{args.name}-1": (0, 0),
        f"{args.name}-2": (half, 0),
        f"{args.name}-3": (0, half),
        f"{args.name}-4": (half, half),
    }
    STAGE_DIR.mkdir(parents=True, exist_ok=True)
    poses = {}
    for frame_id, (x, y) in cells.items():
        poses[frame_id] = cut_pose(sheet.crop((x, y, x + half, y + half)).convert("RGBA"))
    # One scale for the whole sheet, taken from a standing frame: normalising
    # each frame to the same height would inflate a crouched or fallen pose and
    # make the animation pulse in size.
    reference_id = f"{args.name}-{args.scale_from}"
    factor = args.height / poses[reference_id].height
    for frame_id, pose in poses.items():
        if args.flip:
            pose = pose.transpose(Image.FLIP_LEFT_RIGHT)
        fitted = scale_by(pose, factor)
        fitted.save(STAGE_DIR / f"{frame_id}.png", format="PNG", optimize=True)
        print(f"  {frame_id}: {pose.size[0]}x{pose.size[1]} -> {fitted.size[0]}x{fitted.size[1]}")
    print(f"  (scale {factor:.3f} taken from {reference_id})")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--split", metavar="PATH", help="2x2 pose sheet to split into frames")
    parser.add_argument("--name", default="idle", help="animation name, used for the frame ids")
    parser.add_argument("--height", type=int, default=TARGET_HEIGHT_PX,
                        help="height of the standing frame the sheet is scaled to")
    parser.add_argument("--scale-from", type=int, default=1,
                        help="which cell (1-4) supplies the reference height")
    parser.add_argument("--flip", action="store_true",
                        help="mirror the result: the generator often draws the hero facing "
                             "the direction named in the prompt, and the game's hero faces right")
    args = parser.parse_args(argv)
    if not args.split:
        parser.error("--split is required")
    return split(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
