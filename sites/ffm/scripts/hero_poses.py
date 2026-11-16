#!/usr/bin/env python3
"""Turn a 2x2 pose sheet into four hero frames, and generate such a sheet.

Each animation is generated as one image containing four poses in a 2x2 grid,
which is what keeps the character identical across the four frames of a clip -
four separate renders drift, and a clip that drifts reads as a shudder. This
splits the grid, cuts the backdrop and the model's contact shadow, trims each
pose and scales them all to the same figure height as the master frame so the
animation cannot change size.

Cutting a pose (see cut_pose) works for any flat backdrop, but a saturated
chroma plate is far more reliable than white: on white the contact shadow is
neutral grey, exactly like the steel of the blade and the shading of the
boots, while on magenta the shadow is a darker magenta that nothing on the
hero shares. --generate therefore asks for a magenta (or green) plate.

Run:
  python3 sites/ffm/scripts/hero_poses.py --generate hurt          # new sheet via fal, then split it
  python3 sites/ffm/scripts/hero_poses.py --split build/hero-poses/hurt.png --name hurt
"""

from __future__ import annotations

import argparse
import base64
import io
import re
import sys
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

FFM_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = FFM_ROOT.parents[1]
STAGE_DIR = FFM_ROOT / "build" / "hero-regen"
SHEET_DIR = FFM_ROOT / "build" / "hero-poses"
ATLAS = FFM_ROOT / "static" / "game" / "hero" / "hero-atlas.webp"
ATLAS_META = FFM_ROOT / "static" / "game" / "hero" / "hero-frames.js"

TARGET_HEIGHT_PX = 163      # the master idle frame's height (atlas pixels)
ALPHA_CUT = 110

# ── Cutting ──────────────────────────────────────────────────────────────────
# Distances are Euclidean in 0-255 RGB.
BACKDROP_TOLERANCE = 48         # this close to the backdrop colour counts as backdrop
POCKET_TOLERANCE = 20           # an enclosed region must be this close to count as a gap
POCKET_MIN_FRACTION = 0.00015   # of the cell area; smaller enclosed specks are eye whites and glints
SHADOW_SHADE = (0.2, 0.97)      # a shadow pixel is the backdrop colour times a factor in this range
SHADOW_RESIDUAL = 34            # ...give or take this much (chroma plates)
SHADOW_RESIDUAL_NEUTRAL = 9     # on a white/grey plate the shadow is grey like steel: be strict
SHADOW_BAND = 0.22              # the shadow sits in this bottom fraction of the figure
SHADOW_MIN_FRACTION = 0.0002    # of the cell area
EDGE_RING = 2                   # px of silhouette edge checked for backdrop fringe
DETACHED_MIN_FRACTION = 0.01    # of the largest part; smaller detached parts are dropped


@dataclass
class CutReport:
    backdrop: tuple[int, int, int] = (0, 0, 0)
    pockets: int = 0            # enclosed backdrop pixels removed (gaps between limbs)
    shadow: int = 0             # contact-shadow pixels removed
    fringe: int = 0             # edge pixels that were mostly backdrop
    detached: int = 0           # pixels in specks not attached to the figure
    despilled: int = 0          # edge pixels whose plate tint was removed
    notes: list[str] = field(default_factory=list)

    def line(self) -> str:
        return (f"backdrop {self.backdrop}, removed gaps {self.pockets}px, shadow {self.shadow}px, "
                f"fringe {self.fringe}px, specks {self.detached}px, despilled {self.despilled}px")


def estimate_backdrop(rgb: np.ndarray, ring: int = 3) -> np.ndarray:
    """The plate colour: the median of the cell's outer ring, which the figure never touches."""
    edge = np.concatenate([rgb[:ring].reshape(-1, 3), rgb[-ring:].reshape(-1, 3),
                           rgb[:, :ring].reshape(-1, 3), rgb[:, -ring:].reshape(-1, 3)])
    return np.median(edge, axis=0)


def _distance(rgb: np.ndarray, colour: np.ndarray) -> np.ndarray:
    return np.linalg.norm(rgb - colour.reshape(1, 1, 3), axis=2)


def _touches_border(labels: np.ndarray) -> set[int]:
    border = set(np.unique(labels[0])) | set(np.unique(labels[-1])) \
        | set(np.unique(labels[:, 0])) | set(np.unique(labels[:, -1]))
    border.discard(0)
    return border


def _shade_of(rgb: np.ndarray, backdrop: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(factor, residual): how well each pixel is explained as `factor * backdrop`.

    A contact shadow is the plate seen with less light, so its colour is the
    plate colour scaled down. Anything with a hue of its own (boots, skin,
    bluish steel on a magenta plate) leaves a large residual.
    """
    b = backdrop.astype(np.float64)
    factor = (rgb @ b) / max(float(b @ b), 1e-6)
    residual = np.linalg.norm(rgb - factor[:, :, None] * b, axis=2)
    return factor, residual


DESPILL_RING = 4            # px inside the silhouette edge that may carry plate colour
DESPILL_KEEP = 24           # inside the figure, this much plate-shaped tint is the art's own


def despill(rgb: np.ndarray, figure: np.ndarray, backdrop: np.ndarray) -> tuple[np.ndarray, int]:
    """Take the plate's tint out of the figure's outer pixels.

    The model paints soft edges, so the outline pixels are a mix of the hero and
    the plate (pinkish on magenta); downscaling then spreads that mix along the
    whole silhouette. Where the plate's dominant channels (red and blue for
    magenta, green for green) all stand above the others, the excess is plate,
    so it is pulled down to the others' level. The hero's own colours never
    have that shape, which is why the interior is left alone anyway.
    """
    dominant = backdrop > 128
    if dominant.all() or not dominant.any():
        return rgb, 0  # a white or black plate has no tint to remove
    edge = figure & ~ndimage.binary_erosion(figure, iterations=DESPILL_RING)
    out = rgb.astype(np.int16).copy()
    spill = out[:, :, dominant].min(axis=2) - out[:, :, ~dominant].max(axis=2)
    # The edge loses all of it. Inside, the hero's own dark shading is mildly
    # purple (the shipped atlas has ~31k pixels with spill above 10 but none above
    # 60), so only the excess beyond that is plate leaking into gaps and seams.
    excess = np.where(edge, spill, spill - DESPILL_KEEP)
    tinted = figure & (excess > 0)
    for channel in np.nonzero(dominant)[0]:
        out[:, :, channel] = np.where(tinted, out[:, :, channel] - excess, out[:, :, channel])
    return np.clip(out, 0, 255).astype(np.uint8), int(tinted.sum())


def cut_pose(cell: Image.Image, report: CutReport | None = None) -> Image.Image:
    """The pose cut out of its cell (see cut_mask), despilled and trimmed to its content."""
    report = report if report is not None else CutReport()
    rgb = np.array(cell.convert("RGB"))
    figure = cut_mask(cell, report)
    rgb, report.despilled = despill(rgb, figure, np.array(report.backdrop, float))
    rgba = np.dstack([rgb, np.where(figure, 255, 0).astype(np.uint8)])
    ys, xs = np.nonzero(figure)
    return Image.fromarray(rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1], "RGBA")


def cut_mask(cell: Image.Image, report: CutReport | None = None) -> np.ndarray:
    """Which pixels of the cell are the hero: backdrop, gaps between limbs, contact shadow and fringe removed.

    The earlier version keyed only the backdrop connected to the cell border and
    then filled every hole in the silhouette, so the backdrop showing between an
    arm and the body, or between the legs, came back as opaque white; and its
    shadow test was a grey brightness window, which missed the shadow's darker
    core and ate the blade tip where it reached the ground.
    """
    report = report if report is not None else CutReport()
    rgb = np.array(cell.convert("RGB")).astype(np.float64)
    h, w = rgb.shape[:2]
    area = h * w
    backdrop = estimate_backdrop(rgb)
    report.backdrop = tuple(int(round(v)) for v in backdrop)
    dist = _distance(rgb, backdrop)

    # 1. The backdrop around the figure: plate-coloured and connected to the border.
    near = dist < BACKDROP_TOLERANCE
    labels, _ = ndimage.label(near, structure=np.ones((3, 3)))
    outside = np.isin(labels, list(_touches_border(labels)))

    # 2. Gaps between limbs: plate-coloured regions the figure encloses. Never
    #    fill holes - only small enclosed specks (eye whites, glints on steel)
    #    stay, and only when they are not an almost exact plate match.
    #    On a chroma plate nothing on the hero shares the plate's hue, so every
    #    enclosed plate-coloured region is a gap, however narrow; the size and
    #    tightness guards only matter on white, where eye whites match the plate.
    neutral = float(backdrop.max() - backdrop.min()) < 60
    tight = (dist < (POCKET_TOLERANCE if neutral else BACKDROP_TOLERANCE)) & ~outside
    minimum = POCKET_MIN_FRACTION * area if neutral else 2
    labels, count = ndimage.label(tight, structure=np.ones((3, 3)))
    pockets = np.zeros_like(tight)
    if count:
        sizes = ndimage.sum(tight, labels, range(1, count + 1))
        big = [i + 1 for i, s in enumerate(sizes) if s >= minimum]
        if big:
            pockets = np.isin(labels, big)
            # Grow into the looser tolerance so the gap's own anti-aliased rim goes too.
            pockets = ndimage.binary_propagation(pockets, mask=near & ~outside)
    report.pockets = int(pockets.sum())
    figure = ~outside & ~pockets

    # 3. The contact shadow: a darker shade of the plate, low in the figure,
    #    touching the backdrop, wider than tall.
    if figure.any():
        ys = np.nonzero(figure.any(axis=1))[0]
        top, bottom = int(ys.min()), int(ys.max())
        band = np.zeros_like(figure)
        band[bottom - int((bottom - top) * SHADOW_BAND):] = True
        factor, residual = _shade_of(rgb, backdrop)
        limit = SHADOW_RESIDUAL_NEUTRAL if neutral else SHADOW_RESIDUAL
        shade = figure & band & (factor > SHADOW_SHADE[0]) & (factor < SHADOW_SHADE[1]) & (residual < limit)
        labels, count = ndimage.label(shade, structure=np.ones((3, 3)))
        touching = ndimage.binary_dilation(outside | pockets)
        shadow = np.zeros_like(shade)
        for k in range(1, count + 1):
            part = labels == k
            if part.sum() < SHADOW_MIN_FRACTION * area or not (part & touching).any():
                continue
            pys, pxs = np.nonzero(part)
            if np.ptp(pxs) + 1 >= 1.2 * (np.ptp(pys) + 1):
                shadow |= part
        report.shadow = int(shadow.sum())
        figure &= ~shadow

    # 4. Fringe: edge pixels that look more like the background next to them
    #    than like the figure just inside them are blends with the plate.
    if figure.any():
        background = ~figure
        ring = figure & ndimage.binary_dilation(background, iterations=EDGE_RING)
        inner = ndimage.binary_erosion(figure, iterations=EDGE_RING)
        if inner.any():
            _, bg_idx = ndimage.distance_transform_edt(~background, return_indices=True)
            _, in_idx = ndimage.distance_transform_edt(~inner, return_indices=True)
            bg_col = rgb[bg_idx[0], bg_idx[1]]
            in_col = rgb[in_idx[0], in_idx[1]]
            to_bg = np.linalg.norm(rgb - bg_col, axis=2)
            to_in = np.linalg.norm(rgb - in_col, axis=2)
            fringe = ring & (to_bg < to_in) & (to_bg < BACKDROP_TOLERANCE * 1.5)
            report.fringe = int(fringe.sum())
            figure &= ~fringe

    # 5. Specks: keep the figure and any sizeable detached part (a dropped sword).
    labels, count = ndimage.label(figure, structure=np.ones((3, 3)))
    if count == 0:
        raise ValueError("nothing left after cutting the backdrop: is the cell empty?")
    sizes = ndimage.sum(figure, labels, range(1, count + 1))
    keep = [i + 1 for i, s in enumerate(sizes) if s >= DETACHED_MIN_FRACTION * sizes.max()]
    kept = np.isin(labels, keep)
    report.detached = int((figure & ~kept).sum())
    return kept


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


def preview(frames: dict[str, Image.Image], path: Path, zoom: int = 3) -> Path:
    """The frames on a dark and on a light background, so leftover white or shadow shows."""
    pad = 6
    width = sum(f.width + pad for f in frames.values()) + pad
    height = max(f.height for f in frames.values()) + 2 * pad
    sheet = Image.new("RGBA", (width, height * 2), (0, 0, 0, 255))
    for row, colour in enumerate(((52, 18, 64, 255), (236, 236, 228, 255))):
        sheet.paste(Image.new("RGBA", (width, height), colour), (0, row * height))
        x = pad
        for frame in frames.values():
            sheet.alpha_composite(frame, (x, row * height + height - pad - frame.height))
            x += frame.width + pad
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.resize((sheet.width * zoom, sheet.height * zoom), Image.NEAREST).save(path)
    return path


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
    poses, reports = {}, {}
    for frame_id, (x, y) in cells.items():
        reports[frame_id] = CutReport()
        poses[frame_id] = cut_pose(sheet.crop((x, y, x + half, y + half)).convert("RGBA"), reports[frame_id])
    # One scale for the whole sheet, taken from a standing frame: normalising
    # each frame to the same height would inflate a crouched or fallen pose and
    # make the animation pulse in size.
    reference_id = f"{args.name}-{args.scale_from}"
    factor = args.height / poses[reference_id].height
    fitted_all = {}
    for frame_id, pose in poses.items():
        if args.flip:
            pose = pose.transpose(Image.FLIP_LEFT_RIGHT)
        fitted = scale_by(pose, factor)
        fitted.save(STAGE_DIR / f"{frame_id}.png", format="PNG", optimize=True)
        fitted_all[frame_id] = fitted
        print(f"  {frame_id}: {pose.size[0]}x{pose.size[1]} -> {fitted.size[0]}x{fitted.size[1]}  "
              f"{reports[frame_id].line()}")
    print(f"  (scale {factor:.3f} taken from {reference_id})")
    shown = preview(fitted_all, STAGE_DIR / f"{args.name}-preview.png")
    print(f"  preview: {shown}")
    return 0


# ── Generating a sheet ───────────────────────────────────────────────────────
MODEL = "fal-ai/flux-pro/kontext"
PLATES = {
    "magenta": ((255, 0, 255), "flat magenta (#FF00FF)"),
    "green": ((0, 255, 0), "flat pure green (#00FF00)"),
}
SHEET_SIZE = 1024
FEET_AT = 0.86              # baseline of each quadrant, as a fraction of its height


def atlas_frames(clip: str) -> list[Image.Image]:
    """The clip's four current frames, cut from the shipped atlas."""
    atlas = Image.open(ATLAS).convert("RGBA")
    meta = ATLAS_META.read_text(encoding="utf-8")
    frames = []
    for index in range(1, 5):
        match = re.search(r"'%s-%d': \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+)" % (re.escape(clip), index), meta)
        if not match:
            raise SystemExit(f"{clip}-{index} is not in {ATLAS_META.name}")
        x, y, w, h = map(int, match.groups())
        frames.append(atlas.crop((x, y, x + w, y + h)))
    return frames


def pick_plate(frames: list[Image.Image]) -> tuple[tuple[int, int, int], str]:
    """The plate colour the hero uses least, like regenerate_fiends.pick_plate."""
    pixels = np.concatenate([np.array(f)[np.array(f)[:, :, 3] > 0][:, :3] for f in frames]).astype(int)
    best = None
    for colour, label in PLATES.values():
        close = int((np.abs(pixels - np.array(colour)).max(axis=1) <= 90).sum())
        if best is None or close < best[0]:
            best = (close, colour, label)
    return best[1], best[2]


def reference_sheet(frames: list[Image.Image], colour: tuple[int, int, int]) -> Image.Image:
    """The four frames upscaled (nearest) into a 2x2 plate, feet on one baseline."""
    half = SHEET_SIZE // 2
    zoom = max(1, int(min(half * 0.8 / max(f.width for f in frames), half * 0.8 / max(f.height for f in frames))))
    sheet = Image.new("RGBA", (SHEET_SIZE, SHEET_SIZE), (*colour, 255))
    for index, frame in enumerate(frames):
        big = frame.resize((frame.width * zoom, frame.height * zoom), Image.NEAREST)
        cx, cy = (index % 2) * half, (index // 2) * half
        sheet.alpha_composite(big, (cx + (half - big.width) // 2, cy + int(half * FEET_AT) - big.height))
    return sheet.convert("RGB")


def prompt_for(label: str, clip: str) -> str:
    return (
        f"This is a 2x2 sheet with four frames of one pixel-art game character's '{clip}' animation. "
        "Redraw it keeping exactly the same character in every quadrant: the same four poses, "
        "proportions, colours, pixel-art shading and outline weight, and the same size and position "
        f"inside each quadrant. The background must be perfectly flat {label} everywhere. There is no "
        "ground, no floor line, no shadow under the feet, no glow and no reflection. Do not add, "
        "remove or change any other detail, and keep the four quadrants separate."
    )


def generate(args) -> int:
    sys.path.insert(0, str(REPO_ROOT / "tools"))
    import fal_client  # noqa: PLC0415
    import fal_image  # noqa: PLC0415
    import os  # noqa: PLC0415

    os.environ.setdefault("FAL_KEY", fal_image.resolve_key(None))
    frames = atlas_frames(args.generate)
    colour, label = pick_plate(frames)
    plate = reference_sheet(frames, colour)
    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    plate.save(SHEET_DIR / f"{args.generate}-reference.png")
    buffer = io.BytesIO()
    plate.save(buffer, format="PNG")
    data = base64.b64encode(buffer.getvalue()).decode()
    print(f"generating {args.generate} on {label} with {MODEL} (paid call)")
    result = fal_client.subscribe(MODEL, arguments={
        "prompt": prompt_for(label, args.generate), "image_url": f"data:image/png;base64,{data}",
        "image_size": "square_hd", "output_format": "png",
    }, with_logs=False)
    if not result.get("images"):
        raise SystemExit(f"no image in the response: {str(result)[:300]}")
    out = SHEET_DIR / f"{args.generate}.png"
    with urllib.request.urlopen(result["images"][0]["url"]) as response:
        raw = Image.open(io.BytesIO(response.read())).convert("RGB")
    if raw.size != (SHEET_SIZE, SHEET_SIZE):
        raw = raw.resize((SHEET_SIZE, SHEET_SIZE), Image.LANCZOS)
    raw.save(out)
    print(f"  sheet: {out}")
    args.split, args.name = str(out), args.generate
    return split(args)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--split", metavar="PATH", help="2x2 pose sheet to split into frames")
    parser.add_argument("--generate", metavar="CLIP",
                        help="render a new sheet for CLIP (idle, walk, swing, hurt, dead, victory, cast) "
                             "from its current atlas frames on a chroma plate, then split it")
    parser.add_argument("--name", default="idle", help="animation name, used for the frame ids")
    parser.add_argument("--height", type=int, default=TARGET_HEIGHT_PX,
                        help="height of the standing frame the sheet is scaled to")
    parser.add_argument("--scale-from", type=int, default=1,
                        help="which cell (1-4) supplies the reference height")
    parser.add_argument("--flip", action="store_true",
                        help="mirror the result: the generator often draws the hero facing "
                             "the direction named in the prompt, and the game's hero faces right")
    args = parser.parse_args(argv)
    if args.generate:
        return generate(args)
    if not args.split:
        parser.error("--split or --generate is required")
    return split(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
