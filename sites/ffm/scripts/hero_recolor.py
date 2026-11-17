#!/usr/bin/env python3
"""Bake the colour schemes of the one hero into heroes/<id>/ art.

    hero_recolor.py                    rebuild every scheme in hero_schemes.json
    hero_recolor.py --sheet OUT.png    also write a contact sheet (idle, walk, swing, dead per scheme)
    hero_recolor.py --only ember,rose  only these schemes

Source pixels: static/game/hero/hero-atlas.webp. Which pixel belongs to which region (hair, skin,
tunic, scarf, cape, gloves, boots) comes from scripts/data/hero-regions.png (built by hero_regions.py).
Schemes are edited in hero_schemes.json. The "adventurer" scheme is the original hero and is
not rewritten here. Each scheme gets its own atlas and portrait; hero-frames.js is a plain copy.
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

GAME = Path(__file__).resolve().parents[1] / "static" / "game"
DATA = Path(__file__).resolve().parent / "data"
SCHEMES = Path(__file__).resolve().parent / "hero_schemes.json"
REGION_IDS = {"hair": 1, "skin": 2, "tunic": 3, "scarf": 4, "gloves": 5, "boots": 6, "cape": 7}


def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 1e-9
    rm = nz & (mx == r); gm = nz & (mx == g) & ~rm; bm = nz & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6
    h[gm] = (b - r)[gm] / d[gm] + 2
    h[bm] = (r - g)[bm] / d[bm] + 4
    s = np.where(mx > 1e-9, d / np.maximum(mx, 1e-9), 0)
    return h * 60, s, mx


def hsv_to_rgb(h, s, v):
    h = (h % 360) / 60
    c = v * s; x = c * (1 - np.abs(h % 2 - 1)); m = v - c
    z = np.zeros_like(h)
    i = np.floor(h).astype(int) % 6
    r = np.choose(i, [c, x, z, z, x, c]); g = np.choose(i, [x, c, c, x, z, z]); b = np.choose(i, [z, z, x, c, c, x])
    return np.stack([r + m, g + m, b + m], -1)


def recolor(atlas, regions, scheme):
    rgb = atlas[..., :3].astype(np.float64) / 255
    h, s, v = rgb_to_hsv(rgb)
    h2, s2, v2 = h.copy(), s.copy(), v.copy()
    for name, op in scheme.items():
        m = regions == REGION_IDS[name]
        if not m.any():
            continue
        hm, sm, vm = h[m], s[m], v[m]
        if "set_h" in op:
            hm = np.full_like(hm, op["set_h"])
            sm = np.maximum(sm * 0 + op.get("set_s", 0.5), 0) * np.clip(vm * 4, 0, 1)
        hm = hm + op.get("h", 0)
        sm = np.clip(sm * op.get("s", 1.0), 0, 1)
        vm = vm * op.get("v", 1.0)
        lift = op.get("lift", 0.0)
        if lift:
            vm = lift + (1 - lift) * vm
        h2[m], s2[m], v2[m] = hm, sm, np.clip(vm, 0, 1)
    out = (hsv_to_rgb(h2, s2, np.clip(v2, 0, 1)) * 255 + 0.5).astype(np.uint8)
    return np.dstack([out, atlas[..., 3]])


def portrait_of(atlas):
    idle = atlas.crop((0, 0, 144, 163))
    return idle.crop((8, 0, 136, 128)).resize((256, 256), Image.NEAREST)


def main():
    schemes = {k: v for k, v in json.loads(SCHEMES.read_text()).items() if not k.startswith("_")}
    only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
    base = Image.open(GAME / "hero" / "hero-atlas.webp").convert("RGBA")
    atlas = np.asarray(base)
    regions = np.asarray(Image.open(DATA / "hero-regions.png"))
    assert regions.shape == atlas.shape[:2], "region map does not match the atlas: rerun hero_regions.py"
    sheet = []
    for sid, scheme in schemes.items():
        img = base if not scheme else Image.fromarray(recolor(atlas, regions, scheme), "RGBA")
        sheet.append((sid, img))
        if sid == "adventurer" or (only and sid not in only):
            continue
        out = GAME / "heroes" / sid
        out.mkdir(parents=True, exist_ok=True)
        img.save(out / "hero-atlas.webp", "WEBP", lossless=True, quality=100, method=6)
        portrait_of(img).save(out / "portrait.webp", "WEBP", lossless=True, quality=100, method=6)
        shutil.copy(GAME / "hero" / "hero-frames.js", out / "hero-frames.js")
        print(f"{sid}: atlas {(out / 'hero-atlas.webp').stat().st_size // 1024} KB")
    if "--sheet" in sys.argv:
        crops = [(0, 0, 144, 163), (148, 168, 326, 331), (345, 338, 471, 501), (0, 1005, 187, 1174)]
        cw = [c[2] - c[0] for c in crops]
        W = sum(cw) + 10 * len(crops); Hh = 175
        canvas = Image.new("RGBA", (W, Hh * len(sheet)), (60, 64, 72, 255))
        for r, (sid, img) in enumerate(sheet):
            x = 5
            for c, w in zip(crops, cw):
                canvas.alpha_composite(img.crop(c), (x, r * Hh)); x += w + 10
        canvas.save(sys.argv[sys.argv.index("--sheet") + 1])


if __name__ == "__main__":
    main()
