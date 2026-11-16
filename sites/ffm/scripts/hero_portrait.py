#!/usr/bin/env python3
"""Turn one generated bust image into a hero's portrait.webp.

The recipe is the one recorded under avatars/ in static/promo/art/PROVENANCE.md:
magenta keyed by chroma, opening plus keep-largest-blob, premultiplied-alpha
Lanczos downsample to a 55 px logical bust, 28-colour median-cut quantise, then
a x4 nearest upscale onto a 256x256 transparent canvas, so every block is 4 px.

Run:
  python3 sites/ffm/scripts/hero_portrait.py --reference idle-1.png --out plate.png
  python3 sites/ffm/scripts/hero_portrait.py --hero rogue --from bust.png
  python3 sites/ffm/scripts/hero_portrait.py --contact-sheet build/portraits.png
  python3 sites/ffm/scripts/hero_portrait.py --check
"""

from __future__ import annotations

import argparse
import io
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

FFM_ROOT = Path(__file__).resolve().parent.parent
HEROES_JS = FFM_ROOT / "static" / "game" / "heroes.js"
HEROES_DIR = FFM_ROOT / "static" / "game" / "heroes"

KEY_RATIO = 0.72            # magenta: g < min(r, b) * KEY_RATIO
BUST_PX = 55                # logical bust size
COLOURS = 28
BLOCK = 4
CANVAS = 256
GRID = CANVAS // BLOCK
MAX_BYTES = 24 * 1024
SHEET_BG = (0x20, 0x46, 0x3A)
CIRCLE_PX = 56
PLATE = (255, 0, 255)


class PortraitError(Exception):
    pass


def roster_ids() -> list[str]:
    """Hero ids in roster order, read from heroes.js."""
    ids = re.findall(r"\bhero\('([a-z][a-z0-9-]*)'", HEROES_JS.read_text(encoding="utf-8"))
    if not ids:
        raise PortraitError(f"no hero ids found in {HEROES_JS}")
    return ids


def key_magenta(rgb: np.ndarray) -> np.ndarray:
    """True where a pixel is figure, False where it is magenta plate."""
    r, g, b = (rgb[..., i].astype(np.float32) for i in range(3))
    return ~(g < np.minimum(r, b) * KEY_RATIO)


def clean_mask(mask: np.ndarray) -> np.ndarray:
    """Opening drops crumbs and fringe; only the largest blob stays."""
    opened = ndimage.binary_opening(mask, structure=np.ones((3, 3), bool))
    labels, count = ndimage.label(opened)
    if count == 0:
        return opened
    sizes = ndimage.sum(opened, labels, range(1, count + 1))
    return labels == (int(np.argmax(sizes)) + 1)


def downsample_premultiplied(rgb: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Crop to the figure and Lanczos it to fit 55 px, with colour premultiplied by alpha."""
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgb, mask = rgb[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    h, w = mask.shape
    scale = BUST_PX / max(h, w)
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    alpha = mask.astype(np.float32)
    planes = [Image.fromarray(rgb[..., i].astype(np.float32) * alpha).resize(size, Image.LANCZOS)
              for i in range(3)]
    a = np.asarray(Image.fromarray(alpha).resize(size, Image.LANCZOS))
    solid = a >= 0.5
    safe = np.where(a > 1e-4, a, 1.0)
    out = np.stack([np.asarray(p) / safe for p in planes], axis=-1)
    return np.clip(out, 0, 255).astype(np.uint8), solid


def quantise(rgb: np.ndarray, solid: np.ndarray) -> np.ndarray:
    """Median-cut the opaque pixels to 28 colours; returns RGBA with binary alpha."""
    out = np.zeros(solid.shape + (4,), np.uint8)
    pixels = rgb[solid]
    if len(pixels):
        strip = Image.fromarray(pixels.reshape(1, -1, 3))
        q = strip.quantize(colors=COLOURS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        out[solid, :3] = np.asarray(q.convert("RGB")).reshape(-1, 3)
    out[solid, 3] = 255
    return out


def upscale_to_canvas(small: np.ndarray) -> Image.Image:
    """x4 nearest onto the transparent canvas, centred on the block grid, bottom-aligned."""
    h, w = small.shape[:2]
    block = Image.fromarray(small).resize((w * BLOCK, h * BLOCK), Image.NEAREST)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(block, (((GRID - w) // 2) * BLOCK, (GRID - h) * BLOCK))
    return canvas


def build_portrait(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"))
    mask = clean_mask(key_magenta(rgb))
    if not mask.any():
        raise PortraitError("the image has no figure after keying the magenta plate")
    small_rgb, solid = downsample_premultiplied(rgb, mask)
    return upscale_to_canvas(quantise(small_rgb, solid))


def encode_webp(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, "WEBP", lossless=True, exact=True, method=6)
    return buf.getvalue()


def validate(data: bytes) -> None:
    """Refuse anything check-heroes would: size, bytes, partial alpha, empty figure."""
    if len(data) > MAX_BYTES:
        raise PortraitError(f"portrait is {len(data)} bytes, over the {MAX_BYTES} limit")
    image = Image.open(io.BytesIO(data)).convert("RGBA")
    if image.size != (CANVAS, CANVAS):
        raise PortraitError(f"portrait is {image.size[0]}x{image.size[1]}, not {CANVAS}x{CANVAS}")
    alpha = np.asarray(image)[..., 3]
    if np.any((alpha != 0) & (alpha != 255)):
        raise PortraitError("portrait has partial alpha")
    if not alpha.any():
        raise PortraitError("portrait has an empty figure")


def write_portrait(hero: str, source: Path, heroes_dir: Path | None = None) -> Path:
    if hero not in roster_ids():
        raise PortraitError(f"{hero!r} is not a roster id")
    with Image.open(source) as image:
        data = encode_webp(build_portrait(image))
    validate(data)
    target = (heroes_dir or HEROES_DIR) / hero / "portrait.webp"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return target


def write_reference(frame: Path, out: Path) -> None:
    """The hero's idle-1 frame, x4 nearest, on flat magenta."""
    with Image.open(frame) as src:
        sprite = src.convert("RGBA")
    sprite = sprite.resize((sprite.width * BLOCK, sprite.height * BLOCK), Image.NEAREST)
    plate = Image.new("RGBA", sprite.size, PLATE + (255,))
    plate.alpha_composite(sprite)
    out.parent.mkdir(parents=True, exist_ok=True)
    plate.convert("RGB").save(out)


def write_contact_sheet(path: Path, heroes_dir: Path | None = None) -> list[str]:
    """Every delivered portrait as a 56 px circle on #20463a, roster order, id as label."""
    root = heroes_dir or HEROES_DIR
    shown = [(i, root / i / "portrait.webp") for i in roster_ids()]
    shown = [(i, p) for i, p in shown if p.is_file()]
    if not shown:
        raise PortraitError("no delivered portraits to show")
    cell_w, label_h, pad = 96, 14, 8
    sheet = Image.new("RGB", (cell_w * len(shown), CIRCLE_PX + label_h + 2 * pad), SHEET_BG)
    draw = ImageDraw.Draw(sheet)
    circle = Image.new("L", (CIRCLE_PX, CIRCLE_PX), 0)
    ImageDraw.Draw(circle).ellipse((0, 0, CIRCLE_PX - 1, CIRCLE_PX - 1), fill=255)
    for n, (hero, p) in enumerate(shown):
        with Image.open(p) as src:
            face = src.convert("RGBA").resize((CIRCLE_PX, CIRCLE_PX), Image.LANCZOS)
        x = n * cell_w + (cell_w - CIRCLE_PX) // 2
        sheet.paste(face.convert("RGB"), (x, pad), Image.fromarray(
            np.minimum(np.asarray(face)[..., 3], np.asarray(circle))))
        draw.text((n * cell_w + cell_w // 2, pad + CIRCLE_PX + 4), hero, fill=(255, 255, 255), anchor="mt")
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)
    return [h for h, _ in shown]


def synthetic_bust() -> Image.Image:
    """A smooth gradient figure on magenta with a stray crumb, built in memory."""
    img = np.zeros((600, 500, 3), np.uint8)
    img[:] = PLATE
    yy, xx = np.mgrid[0:600, 0:500]
    head = ((xx - 250) / 120.0) ** 2 + ((yy - 220) / 150.0) ** 2 <= 1
    body = (yy > 360) & (np.abs(xx - 250) < 200 - (600 - yy) * 0.2)
    fig = head | body
    img[fig] = np.stack([60 + xx[fig] // 4, 40 + yy[fig] // 5, 90 + (xx[fig] + yy[fig]) // 12], axis=-1)
    img[10:14, 10:14] = (200, 180, 40)
    return Image.fromarray(img)


def check() -> int:
    data = encode_webp(build_portrait(synthetic_bust()))
    validate(data)
    arr = np.asarray(Image.open(io.BytesIO(data)).convert("RGBA"))
    blocks = arr.reshape(GRID, BLOCK, GRID, BLOCK, 4)
    if not np.all(blocks == blocks[:, :1, :, :1, :]):
        raise PortraitError("pixels are not on a 4 px block grid")
    colours = {tuple(p[:3]) for p in arr[arr[..., 3] == 255]}
    if len(colours) > COLOURS:
        raise PortraitError(f"{len(colours)} colours, over {COLOURS}")
    print(f"ok: {CANVAS}x{CANVAS}, {len(colours)} colours, {len(data)} bytes")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hero", help="roster id to write the portrait for (with --from)")
    ap.add_argument("--from", dest="source", type=Path, help="generated bust PNG on a magenta plate")
    ap.add_argument("--reference", type=Path, help="idle-1 frame PNG to turn into the reference plate (with --out)")
    ap.add_argument("--out", type=Path, help="where --reference writes the plate")
    ap.add_argument("--contact-sheet", type=Path, metavar="PATH", help="render all delivered portraits at 56 px")
    ap.add_argument("--check", action="store_true", help="run the recipe on a synthetic bust")
    args = ap.parse_args(argv)
    try:
        if args.check:
            return check()
        if args.contact_sheet:
            print("contact sheet:", ", ".join(write_contact_sheet(args.contact_sheet)))
            return 0
        if args.reference:
            if not args.out:
                ap.error("--reference needs --out")
            write_reference(args.reference, args.out)
            return 0
        if args.hero:
            if not args.source:
                ap.error("--hero needs --from")
            print("wrote", write_portrait(args.hero, args.source))
            return 0
    except (PortraitError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
