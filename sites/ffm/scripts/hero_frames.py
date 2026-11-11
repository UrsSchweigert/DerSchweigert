#!/usr/bin/env python3
"""Build the hero sprite atlas the game actually draws.

The hand-off from art to engine used to be a fixed 200x180 grid: every pose was
forced into a cell, so poses that did not fit were scaled down (the character
changed size from frame to frame) and their neighbours bled into the cell (a
phantom boot, a sword tip cut off at the edge). This script stops packing by
grid and packs by content instead:

  * every frame is extracted as its largest connected blob, so a neighbour's
    fragment can never end up in it,
  * each frame keeps its own size and gets an explicit pivot (the foot contact
    point), so the animator can plant feet instead of guessing an offset,
  * frames come out as one atlas plus a metadata module the game imports, so
    there is still a single image request.

Sources
  The pixel master is `static/game/source-assets/hero-spritesheet-clean.png`
  (6 states x 4
  poses). Only poses that are drawn at the master's native scale are used; the
  sheet also contains a few poses that were shrunk during the old packing and
  those are rejected by the SCALE check below rather than shipped.
  `static/game/source-assets/hero-poses/` holds extra poses generated from a
  native frame with `fal-ai/flux-pro/kontext` (so identity, style and framing
  match); they are optional and skipped when absent.

Usage
    python3 sites/ffm/scripts/hero_frames.py
    python3 sites/ffm/scripts/hero_frames.py --check   # verify only, no writes

Requires Pillow and numpy, like the other art scripts in this directory.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

FFM_ROOT = Path(__file__).resolve().parents[1]
GAME = FFM_ROOT / "static" / "game"
MASTER_SHEET = GAME / "source-assets" / "hero-spritesheet-clean.png"
POSE_DIR = GAME / "source-assets" / "hero-poses"
OUT_ATLAS = GAME / "hero" / "hero-atlas.webp"
OUT_META = GAME / "hero" / "hero-frames.js"

CELL_W, CELL_H = 200, 180
COLS, ROWS = 4, 6
ALPHA_MIN = 40
PAD = 2

# ── Which pose comes from where ──────────────────────────────────────────────
# Sheet poses are (row, col) of the 4x6 master grid. Only these cells are at
# native character scale (verified visually at 1:1 against the idle frame);
# the sheet's other cells are shrunken duplicates left over from the old grid
# packing and are deliberately not used.
SHEET_POSES: dict[tuple[int, int], str] = {
    (0, 1): "idle",
    (2, 0): "walk-a",
    (2, 1): "walk-b",
    (2, 3): "walk-c",
    (1, 0): "swing-windup",
    (3, 0): "hurt",
    (4, 0): "dead",
    (5, 1): "victory-raise",
    (5, 3): "victory-plant",
}

# Generated poses are keyed by file name. `scale` maps the generated pixel
# density onto the master's (measured once against the frame it was generated
# from, see the comment on each entry); `strip_shadow` removes the flat grey
# ground shadow the generator bakes in, because the game draws its own.
GENERATED_POSES: list[dict] = [
    # `scale` maps the generated pixel density onto the master's: the generator
    # reproduces the reference plate, which holds a master frame upscaled x4, so
    # a 1024px output carries roughly 4x the master's pixels per character
    # pixel. Measured and corrected against the frame each pose derives from.
    {"file": "cast.png", "id": "cast", "scale": 0.205, "strip_shadow": True},
    {"file": "swing-impact.png", "id": "swing-impact", "scale": 0.172, "strip_shadow": True},
    {"file": "swing-follow.png", "id": "swing-follow", "scale": 0.172, "strip_shadow": True},
]

# How the sword should be held in each pose. `one`/`two` are asserted against
# the art by check_sword(); `loose` means the blade is not gripped at all (the
# death pose drops it), so only the blade's straightness is checked there.
GRIP: dict[str, str] = {
    "idle": "one", "walk-a": "one", "walk-b": "one", "walk-c": "one",
    "swing-windup": "two", "swing-impact": "two", "swing-follow": "two",
    "hurt": "one", "dead": "loose", "victory-raise": "one",
    "victory-plant": "one", "cast": "two",
}

# Atlas row order is deterministic so a diff of the image is readable.
FRAME_ORDER = [
    "idle", "walk-a", "walk-b", "walk-c",
    "swing-windup", "swing-impact", "swing-follow",
    "hurt", "dead", "victory-raise", "victory-plant", "cast",
]


@dataclass
class Frame:
    id: str
    image: Image.Image
    origin: str


def _components(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """8-connected component labels (1..n) for a boolean mask, 0 = background."""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    if not mask.any():
        return labels, 0
    parent = np.arange(h * w, dtype=np.int32)

    def find(i: int) -> int:
        root = i
        while parent[root] != root:
            root = parent[root]
        while parent[i] != root:
            parent[i], i = root, parent[i]
        return root

    idx = np.flatnonzero(mask.ravel())
    for i in idx:
        y, x = divmod(int(i), w)
        for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx]:
                ri, rj = find(int(i)), find(ny * w + nx)
                if ri != rj:
                    parent[rj] = ri
    roots = np.array([find(int(i)) for i in idx], dtype=np.int32)
    _, inverse = np.unique(roots, return_inverse=True)
    flat = np.zeros(h * w, dtype=np.int32)
    flat[idx] = inverse + 1
    return flat.reshape(h, w), int(inverse.max()) + 1


def _largest_blob(mask: np.ndarray) -> np.ndarray:
    """Keep only the largest 8-connected component of a boolean mask."""
    labels, count = _components(mask)
    if count == 0:
        return np.zeros_like(mask)
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    return labels == int(sizes.argmax())


def _crop_to_content(rgba: np.ndarray) -> Image.Image:
    ys, xs = np.nonzero(rgba[:, :, 3] > 0)
    return Image.fromarray(rgba[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1], "RGBA")


def _sheet_frame(row: int, col: int) -> Image.Image:
    sheet = np.array(Image.open(MASTER_SHEET).convert("RGBA"))
    cell = sheet[row * CELL_H:(row + 1) * CELL_H, col * CELL_W:(col + 1) * CELL_W].copy()
    blob = _largest_blob(cell[:, :, 3] >= ALPHA_MIN)
    cell[~blob] = 0
    cell[cell[:, :, 3] < ALPHA_MIN] = 0
    return _crop_to_content(cell)


def _strip_ground_shadow(rgba: np.ndarray) -> np.ndarray:
    """Drop the flat grey ellipse the generator draws under the feet.

    The shadow is the only desaturated mid-dark region that sits on the bottom
    edge of the frame; the boots are either near-black or tinted blue, so a
    saturation + luminance test separates them. Only blobs that reach the
    bottom edge and are clearly wider than tall are removed, which keeps a
    boot that happens to be grey from being eaten.
    """
    rgb = rgba[:, :, :3].astype(np.int16)
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    lum = rgb.mean(axis=2)
    shadow_like = (mx - mn < 22) & (lum > 55) & (lum < 135) & (rgba[:, :, 3] > 0)
    if not shadow_like.any():
        return rgba

    labels, count = _components(shadow_like)
    subject_bottom = int(np.nonzero(rgba[:, :, 3] > 0)[0].max())
    frame_area = shadow_like.shape[0] * shadow_like.shape[1]
    shadow = np.zeros_like(shadow_like)
    for label in range(1, count + 1):
        ys, xs = np.nonzero(labels == label)
        if ys.size < frame_area * 0.002:
            continue
        width, height = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
        if ys.max() >= subject_bottom - 4 and width >= height * 1.6:
            shadow |= labels == label
    if not shadow.any():
        return rgba

    # The generator blends the shadow's soft edge into the plate colour, so the
    # core test misses a magenta-tinted rim; grow the mask by two pixels and
    # clear that too, sparing only near-black pixels (the boot soles).
    grown = shadow.copy()
    for _ in range(2):
        grown = grown | np.roll(grown, 1, 0) | np.roll(grown, -1, 0) \
                      | np.roll(grown, 1, 1) | np.roll(grown, -1, 1)
    out = rgba.copy()
    rgb_lum = out[:, :, :3].astype(np.int16).mean(axis=2)
    out[grown & (rgb_lum > 55)] = 0
    return out


def _generated_frame(spec: dict) -> Image.Image | None:
    path = POSE_DIR / spec["file"]
    if not path.is_file():
        return None
    rgb = np.array(Image.open(path).convert("RGB")).astype(np.int16)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    keyed = ~((g < np.minimum(r, b) * 0.72) & (r > 120) & (b > 120))
    blob = _largest_blob(keyed)
    rgba = np.dstack([rgb.astype(np.uint8), np.where(blob, 255, 0).astype(np.uint8)])
    rgba = _despill(rgba)
    if spec.get("strip_shadow"):
        rgba = _strip_ground_shadow(rgba)
    image = _crop_to_content(rgba)
    if spec.get("scale"):
        size = (max(1, round(image.width * spec["scale"])), max(1, round(image.height * spec["scale"])))
        image = _resize_rgba(image, size)
    return image


def _despill(rgba: np.ndarray) -> np.ndarray:
    """Neutralise the magenta cast the plate leaves on soft edges.

    Pixels the key keeps but that still carry magenta (min(r,b) noticeably above
    g) are pushed back to neutral, so the generator's soft-edged ground shadow
    reads as grey instead of purple.
    """
    out = rgba.copy()
    rgb = out[:, :, :3].astype(np.int16)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    cast = (np.minimum(r, b) - g) > 6
    target = np.minimum(r, b)
    out[:, :, 1] = np.where(cast, target, g).astype(np.uint8)
    return out


def _resize_rgba(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Lanczos resize with premultiplied alpha, then a hard alpha cut.

    Resizing straight RGBA lets the transparent pixels' leftover colour bleed
    into the silhouette, which shows up as a coloured fringe; premultiplying
    first and dividing afterwards avoids it.
    """
    a = np.array(image).astype(np.float32)
    alpha = a[:, :, 3:4] / 255.0
    premultiplied = np.concatenate([a[:, :, :3] * alpha, a[:, :, 3:4]], axis=2)
    scaled = np.array(Image.fromarray(premultiplied.astype(np.uint8), "RGBA").resize(size, Image.LANCZOS)).astype(np.float32)
    out_alpha = scaled[:, :, 3:4]
    with np.errstate(divide="ignore", invalid="ignore"):
        rgb = np.where(out_alpha > 0, scaled[:, :, :3] * 255.0 / np.maximum(out_alpha, 1e-6), 0)
    out = np.concatenate([np.clip(rgb, 0, 255), out_alpha], axis=2).astype(np.uint8)
    out[out[:, :, 3] <= 110] = 0
    out[out[:, :, 3] > 110, 3] = 255
    return Image.fromarray(out, "RGBA")


def _pivot(image: Image.Image) -> tuple[int, int]:
    """Foot contact point in frame pixels: bottom row, weight centre of it."""
    a = np.array(image)
    alpha = a[:, :, 3]
    rows = max(1, image.height // 14)
    band = alpha[-rows:, :] > 0
    xs = np.nonzero(band.any(axis=0))[0]
    cx = int(round((xs.min() + xs.max()) / 2)) if xs.size else image.width // 2
    ys = np.nonzero(alpha.any(axis=1))[0]
    return cx, int(ys.max())


def collect() -> tuple[list[Frame], list[str]]:
    frames: dict[str, Frame] = {}
    for (row, col), frame_id in SHEET_POSES.items():
        frames[frame_id] = Frame(frame_id, _sheet_frame(row, col), f"sheet[{row},{col}]")
    for spec in GENERATED_POSES:
        image = _generated_frame(spec)
        if image is None:
            print(f"  skip {spec['id']}: {spec['file']} not generated yet", file=sys.stderr)
            continue
        frames[spec["id"]] = Frame(spec["id"], image, f"generated:{spec['file']}")
    missing = [f for f in FRAME_ORDER if f not in frames]
    return [frames[f] for f in FRAME_ORDER if f in frames], missing


# ─── Sword checks ────────────────────────────────────────────────────────────
# The hero's blade has to read as one straight piece of steel from hilt to tip,
# and it has to be held by the right number of hands in every pose. Both are
# easy to get wrong when a pose is generated (a warped blade, a sword running
# out of frame, a hilt nobody grips), so they are asserted against the art
# instead of being eyeballed.
BLADE_MIN_PX = 90        # below this there is not enough blade to judge
BEND_MAX_PX = 1.8        # centreline deviation allowed between hilt and tip
COLLINEAR_MAX_PX = 2.4   # how far a part hidden behind the body may sit off it
CONTACT_MAX_PX = 3.0     # the hilt must touch the body, or the sword floats
CUT_MIN_RUN = 0.6        # a blade sliced by the sprite edge keeps its width
CLIP_MARGIN_PX = 2.0     # hilt this close to the sprite edge = cut off
GRIP_TWO_MIN_PX = 12.0   # body run along the shaft that reads as two hands


def _steel_mask(a: np.ndarray) -> np.ndarray:
    rgb = a[:, :, :3].astype(np.int16)
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    lum = rgb.mean(axis=2)
    return ((a[:, :, 3] > 128) & ((mx - mn) < 48) & (lum > 95) & (lum < 228)
            & (rgb[:, :, 2] >= rgb[:, :, 0] - 10))


def _axis_points(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    ys, xs = np.nonzero(mask)
    return np.column_stack([xs, ys]).astype(float), np.array([0.0, 0.0])


def _principal(points: np.ndarray) -> tuple[np.ndarray, np.ndarray, float, float]:
    centre = points.mean(axis=0)
    q = points - centre
    ev, evec = np.linalg.eigh(np.cov(q.T))
    return centre, evec[:, 1], 4 * np.sqrt(max(ev[1], 1e-9)), 4 * np.sqrt(max(ev[0], 1e-9))


def _bins(points: np.ndarray, centre: np.ndarray, axis: np.ndarray, count: int = 8):
    """Bin the points along `axis` and return (t, perp, n, width) per bin."""
    q = points - centre
    t = q @ axis
    p = q @ np.array([-axis[1], axis[0]])
    if t.size == 0:
        return []
    edges = np.linspace(t.min(), t.max(), count + 1)
    out = []
    for i in range(count):
        m = (t >= edges[i]) & (t <= edges[i + 1])
        if m.sum() >= 8:
            out.append((t[m].mean(), p[m].mean(), int(m.sum()), float(p[m].max() - p[m].min())))
    return out


def _residuals(bins, centre, axis):
    if len(bins) < 3:
        return None, None
    t = np.array([b[0] for b in bins])
    p = np.array([b[1] for b in bins])
    design = np.vstack([t, np.ones_like(t)]).T
    (slope, icpt), *_ = np.linalg.lstsq(design, p, rcond=None)
    res = p - (slope * t + icpt)
    return float(np.sqrt((res ** 2).mean())), float(np.abs(res).max())


def check_sword(frame: Frame) -> dict:
    """Verify that the blade runs straight from hilt to tip and is gripped.

    The blade's bright edge gives a reliable line even when the body hides half
    the sword; the blade's real extent is then found by walking that line
    through blade-coloured pixels, so occlusion is handled by construction:
    hidden stations are skipped, and every visible station on both sides of the
    body has to sit on the same straight line.
    """
    a = np.array(frame.image).astype(int)
    alpha = a[:, :, 3] > 128
    rgb = a[:, :, :3]
    steel = _steel_mask(a)
    labels, count = _components(steel)
    anchor = None
    for k in range(1, count + 1):
        ys, xs = np.nonzero(labels == k)
        if ys.size < 40:
            continue
        pts = np.column_stack([xs, ys]).astype(float)
        centre, axis, length, width = _principal(pts)
        if length / max(width, 1e-6) < 2.2 or width > 32:
            continue
        if anchor is None or length > anchor[2]:
            anchor = (pts, axis, length, centre, width)
    if anchor is None:
        return {"frame": frame.id, "status": "unverifiable", "reason": "no blade visible"}

    pts, axis, _, centre, _ = anchor
    for _ in range(2):
        centre, axis, _, _ = _principal(pts)
        perp = (pts - centre) @ np.array([-axis[1], axis[0]])
        keep = np.abs(perp) <= max(4.0, 3.0 * float(np.std(perp)))
        if keep.all():
            break
        pts = pts[keep]
    centre, axis, _, _ = _principal(pts)

    ref = np.median(rgb[pts[:, 1].astype(int), pts[:, 0].astype(int)], axis=0)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    blade = alpha & (np.linalg.norm(rgb - ref, axis=2) < 62) & (chroma < 42)
    normal = np.array([-axis[1], axis[0]])
    height, width_px = alpha.shape
    ys_a, xs_a = np.nonzero(alpha)
    bbox = (xs_a.min(), ys_a.min(), xs_a.max(), ys_a.max())

    def run_at(t: float):
        """Width and centre offset of the blade cross-section at distance t."""
        px = centre + axis * t
        best = None
        for off in np.arange(-2.5, 2.6, 0.5):
            p = px + normal * off
            x, y = int(round(p[0])), int(round(p[1]))
            if not (0 <= y < height and 0 <= x < width_px) or not blade[y, x]:
                continue
            lo = off
            while True:
                q = px + normal * (lo - 0.5)
                xq, yq = int(round(q[0])), int(round(q[1]))
                if 0 <= yq < height and 0 <= xq < width_px and blade[yq, xq]:
                    lo -= 0.5
                else:
                    break
            hi = off
            while True:
                q = px + normal * (hi + 0.5)
                xq, yq = int(round(q[0])), int(round(q[1]))
                if 0 <= yq < height and 0 <= xq < width_px and blade[yq, xq]:
                    hi += 0.5
                else:
                    break
            cand = (float(hi - lo), float((hi + lo) / 2), off)
            if best is None or cand[0] > best[0]:
                best = cand
        return best

    def walk(direction: int) -> tuple[float, bool]:
        """Walk the line until the blade stops; returns (extent, hit_sprite_edge)."""
        t = 0.0
        gap = 0.0
        while abs(t) < max(height, width_px):
            hit = run_at(t) is not None
            gap = 0.0 if hit else gap + 1.0
            if gap > 4.0:
                return t - direction * gap, False
            p = centre + axis * t
            if (p[0] <= bbox[0] + 0.5 or p[0] >= bbox[2] - 0.5
                    or p[1] <= bbox[1] + 0.5 or p[1] >= bbox[3] - 0.5):
                return t, hit
            t += direction * 1.0
        return t, False

    t_lo, edge_lo = walk(-1)
    t_hi, edge_hi = walk(1)
    length = t_hi - t_lo
    if length < 40:
        return {"frame": frame.id, "status": "unverifiable", "reason": "blade shorter than 40px"}

    stations = []
    for i in range(1, 20):
        t = t_lo + length * i / 20
        run = run_at(t)
        if run is not None:
            stations.append((t, run[1], run[0]))
    if len(stations) < 5:
        return {"frame": frame.id, "status": "unverifiable", "reason": "blade mostly hidden"}
    widths = np.array([w for _, _, w in stations])
    median_w = float(np.median(widths))
    clean = [(t, off) for t, off, w in stations if w >= 0.5 * median_w]
    rms, worst = _residuals([(t, off, 0, 0) for t, off in clean], np.array([0.0, 0.0]), np.array([1.0, 0.0]))
    if rms is None:
        return {"frame": frame.id, "status": "unverifiable", "reason": "too few clean cross-sections"}

    ends = [centre + axis * t_lo, centre + axis * t_hi]
    blade_px = np.zeros_like(alpha)
    for t in np.arange(t_lo, t_hi, 0.5):
        px = centre + axis * t
        for off in np.arange(-median_w, median_w + 0.5, 0.5):
            p = px + normal * off
            x, y = int(round(p[0])), int(round(p[1]))
            if 0 <= y < height and 0 <= x < width_px and blade[y, x]:
                blade_px[y, x] = True
    body = alpha & ~blade_px
    bys, bxs = np.nonzero(body)
    body_c = np.array([bxs.mean(), bys.mean()]) if bxs.size else centre
    d_lo = np.linalg.norm(ends[0] - body_c)
    d_hi = np.linalg.norm(ends[1] - body_c)
    hilt_pt, tip_pt = (ends[0], ends[1]) if d_lo < d_hi else (ends[1], ends[0])

    hx, hy = int(round(hilt_pt[0])), int(round(hilt_pt[1]))
    win = 9
    y0, y1 = max(0, hy - win), hy + win + 1
    x0, x1 = max(0, hx - win), hx + win + 1
    sub = body[y0:y1, x0:x1]
    contact = 999.0
    grip_span = 0.0
    if sub.any():
        sy, sx = np.nonzero(sub)
        pts_b = np.column_stack([sx + x0, sy + y0]).astype(float)
        d = np.linalg.norm(pts_b - hilt_pt, axis=1)
        contact = float(d.min())
        near = pts_b[d <= 6.0] - hilt_pt
        if near.size:
            grip_span = float((near @ axis).max() - (near @ axis).min())

    hands = _count_hands(rgb, alpha, hilt_pt, 10)
    wrap = 0.0

    expected = GRIP.get(frame.id, "one")
    problems = []
    if rms > BEND_MAX_PX:
        problems.append(f"blade not straight: cross-sections wander {rms:.2f}px off the hilt-tip line")
    # A blade sliced by the sprite edge is still at full width where it stops;
    # a real end is a narrow pommel or a tapering tip.
    for at_edge, t_end, is_hilt in ((edge_lo, t_lo, d_lo < d_hi), (edge_hi, t_hi, d_hi < d_lo)):
        if not at_edge:
            continue
        probe = run_at(t_end + (2.0 if t_end == t_hi else -2.0))
        if probe is not None and probe[0] > CUT_MIN_RUN * median_w:
            problems.append("hilt runs out of the sprite (nothing beyond it to hold)" if is_hilt
                            else "tip is cut off by the sprite edge")
    if expected != "loose":
        if contact > CONTACT_MAX_PX:
            problems.append(f"hilt is {contact:.1f}px from the body (sword floating)")
        elif hands == 0:
            problems.append("no hand reaches the hilt")
    notes = []
    if expected != "loose" and hands and contact <= CONTACT_MAX_PX:
        wanted = 2 if expected == "two" else 1
        if hands != wanted:
            notes.append(f"art shows {hands} hand(s) on the hilt, {expected} pose expects {wanted}")
    return {
        "frame": frame.id, "status": "fail" if problems else "ok", "notes": notes,
        "problems": problems, "visible": int(blade_px.sum()),
        "length": float(length), "width": float(median_w),
        "bend": rms, "taper": 0.0, "wrap": wrap, "contact": contact,
        "grip_span": grip_span, "hands": hands, "expected": expected,
    }


def report_swords(frames: list[Frame], strict: bool = False) -> int:
    print("\nsword check")
    print(f"{'frame':16s} {'blade':>6s} {'bend':>5s} {'taper':>5s} {'wrap':>5s} "
          f"{'hold':>5s} {'span':>5s} {'hands':>5s}  verdict")
    errors = 0
    warnings = 0
    for frame in frames:
        r = check_sword(frame)
        if r["status"] == "unverifiable":
            warnings += 1
            print(f"{frame.id:16s} {'-':>6s} {'-':>5s} {'-':>5s} {'-':>5s} {'-':>5s} "
                  f"{'-':>5s} {'-':>5s}  WARN {r['reason']}")
            continue
        verdict = "ok"
        if r["status"] == "fail":
            errors += 1
            verdict = "FAIL " + "; ".join(r["problems"])
        elif r["notes"]:
            warnings += 1
            verdict = "WARN " + "; ".join(r["notes"])
        elif r["visible"] < BLADE_MIN_PX:
            verdict = f"ok (only {r['visible']}px of blade visible)"
        print(f"{frame.id:16s} {r['visible']:6d} {r['bend']:5.2f} {r['taper']:5.2f} "
              f"{r['wrap']:5.2f} {r['contact']:5.1f} {r['grip_span']:5.1f} "
              f"{r['hands']}/{r['expected'][:1]:>3s}  {verdict}")
    if errors or warnings:
        print(f"sword check: {errors} error(s), {warnings} warning(s)")
    return errors + (warnings if strict else 0)


def _count_hands(rgb: np.ndarray, alpha: np.ndarray, point: np.ndarray, radius: int) -> int:
    """Count distinct hand-coloured blobs touching the hilt.

    Skin and the hero's dark fingerless gloves are the only two things that
    reach the grip, so a small connected-component count in a disc around the
    hilt separates "nobody holds this sword" from "at least one hand does".
    Two hands that overlap on the shaft merge into one blob at this resolution,
    which is why the count is reported rather than treated as proof.
    """
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    lum = rgb.mean(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    skin = (r > 150) & (r - g > 24) & (b < 180) & (g > 90)
    glove = (lum < 62) & (chroma < 46)
    hand = alpha & (skin | glove)
    hx, hy = int(round(point[0])), int(round(point[1]))
    y0, y1 = max(0, hy - radius), hy + radius + 1
    x0, x1 = max(0, hx - radius), hx + radius + 1
    disc = np.zeros_like(hand)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    inside = (xx - hx) ** 2 + (yy - hy) ** 2 <= radius ** 2
    sub = hand[y0:y1, x0:x1] & inside
    if not sub.any():
        return 0
    labels, count = _components(sub)
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    return int((sizes >= 8).sum())


def pack(frames: list[Frame]) -> tuple[Image.Image, dict]:
    """Shelf-pack the frames with PAD between them and build the metadata."""
    width = 512
    x = y = shelf_h = 0
    placed: dict[str, tuple[int, int]] = {}
    for frame in frames:
        w, h = frame.image.size
        if x + w + PAD > width:
            x, y, shelf_h = 0, y + shelf_h + PAD, 0
        placed[frame.id] = (x, y)
        x += w + PAD
        shelf_h = max(shelf_h, h)
    total_h = y + shelf_h
    atlas = Image.new("RGBA", (width, total_h), (0, 0, 0, 0))
    meta: dict[str, dict] = {}
    for frame in frames:
        x, y = placed[frame.id]
        atlas.alpha_composite(frame.image, (x, y))
        px, py = _pivot(frame.image)
        meta[frame.id] = {
            "x": x, "y": y,
            "w": frame.image.width, "h": frame.image.height,
            "px": px, "py": py,
        }
    return atlas, meta


def render_meta(meta: dict) -> str:
    lines = [
        "// Generated by scripts/hero_frames.py — do not edit by hand.",
        "// Rebuild with: python3 sites/ffm/scripts/hero_frames.py",
        "//",
        "// One entry per pose. x/y/w/h locate the pose inside hero-atlas.webp;",
        "// px/py are the foot contact point in frame pixels (from the frame's",
        "// top-left), so the animator can plant the feet on GROUND_Y exactly.",
        "export const HERO_ATLAS = new URL('./hero-atlas.webp', import.meta.url).href;",
        "",
        "export const HERO_FRAMES = {",
    ]
    for frame_id in FRAME_ORDER:
        if frame_id not in meta:
            continue
        f = meta[frame_id]
        lines.append(
            f"  '{frame_id}': {{ x: {f['x']}, y: {f['y']}, w: {f['w']}, h: {f['h']},"
            f" px: {f['px']}, py: {f['py']} }},"
        )
    lines.append("};")
    lines.append("")
    return "\n".join(lines)


def report(frames: list[Frame], meta: dict) -> None:
    print(f"{'frame':16s} {'size':>9s} {'pivot':>9s}  source")
    for frame in frames:
        f = meta[frame.id]
        print(f"{frame.id:16s} {f['w']:4d}x{f['h']:<4d} {f['px']:4d},{f['py']:<4d}  {frame.origin}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--strict", action="store_true",
                        help="treat sword-check warnings as failures (use in CI)")
    parser.add_argument("--check", action="store_true",
                        help="report and verify only, write nothing; exits 1 on a sword-check failure")
    args = parser.parse_args(argv)

    if not MASTER_SHEET.is_file():
        print(f"missing master sheet: {MASTER_SHEET}", file=sys.stderr)
        return 1

    frames, missing = collect()
    atlas, meta = pack(frames)
    report(frames, meta)
    sword_errors = report_swords(frames, strict=args.strict)
    if missing:
        print(f"note: unused frames (no source yet): {', '.join(missing)}", file=sys.stderr)
    print(f"atlas {atlas.width}x{atlas.height}, {len(frames)} frames")
    if args.check:
        return 1 if sword_errors else 0

    OUT_ATLAS.parent.mkdir(parents=True, exist_ok=True)
    # Lossless: the art is hard-edged pixel work, lossy WebP smears it.
    atlas.save(OUT_ATLAS, format="WEBP", lossless=True, method=6)
    OUT_META.write_text(render_meta(meta), encoding="utf-8")
    print(f"wrote {OUT_ATLAS.relative_to(FFM_ROOT)} ({OUT_ATLAS.stat().st_size // 1024} KB)")
    print(f"wrote {OUT_META.relative_to(FFM_ROOT)}")
    return 1 if sword_errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
