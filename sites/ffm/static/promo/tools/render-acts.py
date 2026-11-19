#!/usr/bin/env python3
"""Render sites/ffm/static/promo/art/acts/act-1..6.webp from the live story scenes.

The landing page's act band shows the same dioramas the game plays, so the images are
composited from `story/scenes/act-N/scene.json` (layers, placement, motion) instead of
being kept as a second, hand-exported set that drifts when a scene is repainted
(the story art pass of 2026-11-18 left the old exports behind).

Each frame is the scene at one chosen moment, on the 1920x1080 stage: layers back to
front, placed by x/y/width plus the motion keyframes at that moment (smoothstep eased, as
in the player), scaled about the player's pivot (50% / 60% of the stage). Pose layers
are skipped. No lighting overlay and no fiends: the scenes show none.

    python3 sites/ffm/static/promo/tools/render-acts.py
"""
import json
from pathlib import Path

from PIL import Image

STATIC = Path(__file__).resolve().parents[2]
SCENES = STATIC / "story" / "scenes"
OUT = STATIC / "promo" / "art" / "acts"
STAGE = (1920, 1080)
PIVOT = (STAGE[0] * 0.5, STAGE[1] * 0.6)
# Seconds into the scene. Act V waits for the ancient dragon to arrive; the others show
# the settled composition about a third of the way in.
MOMENT = {1: 14, 2: 15, 3: 13, 4: 12, 5: 44, 6: 14}


def ease(u):
    return u * u * (3 - 2 * u)


def state(motion, t):
    base = {"x": 0, "y": 0, "scale": 1, "opacity": 1}
    if not motion:
        return base
    keys = sorted(motion, key=lambda k: k["t"])
    if t <= keys[0]["t"]:
        return {**base, **keys[0]}
    for a, b in zip(keys, keys[1:]):
        if t <= b["t"]:
            u = ease((t - a["t"]) / (b["t"] - a["t"]) if b["t"] > a["t"] else 1)
            out = dict(base)
            for prop in ("x", "y", "scale", "opacity"):
                va, vb = a.get(prop, base[prop]), b.get(prop, base[prop])
                out[prop] = va + (vb - va) * u
            return out
    return {**base, **keys[-1]}


def render(act):
    scene = json.loads((SCENES / f"act-{act}" / "scene.json").read_text())
    canvas = Image.new("RGBA", STAGE, (0, 0, 0, 255))
    for layer in scene["layers"]:
        if layer.get("poseOf"):
            continue
        s = state(layer.get("motion"), MOMENT[act])
        if s["opacity"] <= 0.01:
            continue
        img = Image.open(SCENES / f"act-{act}" / layer["src"]).convert("RGBA")
        w = layer["width"] * s["scale"]
        h = w * img.height / img.width
        img = img.resize((round(w), round(h)), Image.LANCZOS)
        if s["opacity"] < 1:
            img.putalpha(img.getchannel("A").point(lambda v: round(v * s["opacity"])))
        # The element's own box scales about the stage pivot, then the keyframe offset applies.
        x = PIVOT[0] + (layer["x"] - PIVOT[0]) * s["scale"] + s["x"]
        y = PIVOT[1] + (layer["y"] - PIVOT[1]) * s["scale"] + s["y"]
        canvas.alpha_composite(img, (round(x), round(y))) if x >= 0 and y >= 0 else _paste(canvas, img, round(x), round(y))
    return canvas.convert("RGB")


def _paste(canvas, img, x, y):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(img, (x, y))
    canvas.alpha_composite(layer)


if __name__ == "__main__":
    for act in range(1, 7):
        render(act).save(OUT / f"act-{act}.webp", quality=84, method=6)
        print("wrote", OUT / f"act-{act}.webp")
