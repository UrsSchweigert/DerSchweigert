#!/usr/bin/env python3
"""Build the fiend still sprites and 8-frame walk strips from raw generated frames.

Input  (--src): for every fiend `<name>` (set1-01 ... set3-18, dragon-1 ... dragon-6)
        <name>_0.png        the still the walk was animated from
        <name>_1.png ... <name>_8.png   the eight walk frames, as generated
Output (--out, default sites/ffm/static/game):
        fiend-sprites/<name>.webp       the still, cropped to the crop box
        fiend-walk/<name>.webp          the 8 frames side by side, same crop box

The crop box is the union of the opaque area over the still and all eight frames,
so every frame of one fiend is cut identically. That is the only change made to
the frames: they are NOT re-aligned or retimed (aligning the feet frame by frame
made the walks look choppy, and the raw motion is what was approved). Because
the still has the same box as every frame, the sprite's aspect ratio - which the
game uses to size the fiend and to place its hit box - does not change when the
walk starts.

Run:  python3 sites/ffm/scripts/build_fiend_walks.py --src <dir with the PNGs>
"""
import argparse
import sys
from pathlib import Path

from PIL import Image

FRAMES = 8
ALPHA_MIN = 8     # ignore the faintest generator fringe when measuring the box
MARGIN = 2


def names():
    out = [f"dragon-{i}" for i in range(1, 7)]
    out += [f"set{s}-{i:02d}" for s in (1, 2, 3) for i in range(1, 19)]
    return out


def crop_box(images):
    box = None
    for im in images:
        a = im.getchannel("A").point(lambda v: 255 if v >= ALPHA_MIN else 0)
        b = a.getbbox()
        if b is None:
            continue
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]),
                                     max(box[2], b[2]), max(box[3], b[3]))
    if box is None:
        raise ValueError("fully transparent frames")
    w, h = images[0].size
    return (max(0, box[0] - MARGIN), max(0, box[1] - MARGIN),
            min(w, box[2] + MARGIN), min(h, box[3] + MARGIN))


def build(name, src, out, quality):
    still = Image.open(src / f"{name}_0.png").convert("RGBA")
    frames = [Image.open(src / f"{name}_{k}.png").convert("RGBA") for k in range(1, FRAMES + 1)]
    for im in frames:
        if im.size != still.size:
            raise ValueError(f"{name}: frame size {im.size} differs from the still {still.size}")
    box = crop_box([still] + frames)
    w, h = box[2] - box[0], box[3] - box[1]
    still.crop(box).save(out / "fiend-sprites" / f"{name}.webp", "WEBP", quality=quality, method=4)
    strip = Image.new("RGBA", (w * FRAMES, h), (0, 0, 0, 0))
    for k, im in enumerate(frames):
        strip.paste(im.crop(box), (k * w, 0))
    strip.save(out / "fiend-walk" / f"{name}.webp", "WEBP", quality=quality, method=4)
    return w, h


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, type=Path)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "static" / "game")
    ap.add_argument("--quality", type=int, default=80)
    ap.add_argument("--only", nargs="*", help="build just these fiend names")
    args = ap.parse_args()

    (args.out / "fiend-sprites").mkdir(parents=True, exist_ok=True)
    (args.out / "fiend-walk").mkdir(parents=True, exist_ok=True)
    todo = args.only or names()
    missing = [n for n in todo if not (args.src / f"{n}_0.png").exists()]
    if missing:
        sys.exit(f"missing inputs for: {', '.join(missing)}")
    for n in todo:
        w, h = build(n, args.src, args.out, args.quality)
        print(f"{n}: frame {w}x{h}")


if __name__ == "__main__":
    main()
