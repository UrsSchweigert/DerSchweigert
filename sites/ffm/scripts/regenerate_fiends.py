#!/usr/bin/env python3
"""Re-render the fiend sprites with flux-pro/kontext, keeping their look.

The shipped fiends came from the art generator with a hard-edged ground shadow
baked into the PNG. Rather than erase that shadow (which leaves a rim where it
touched the creature), each sprite is re-rendered from itself: same creature,
pose, colours and pixel-art weight, but standing on a flat chroma plate with no
shadow. The plate is keyed out, the result is scaled back onto the original's
pixel density and written to a staging directory for review - nothing in
`static/game/fiend-sprites/` is touched unless --write is passed.

The chroma colour is chosen per sprite: a purple creature cannot be keyed off a
magenta plate (its own body has magenta hue), so the plate is picked from a
short list as the colour that appears least in the sprite.

Run:
  python3 sites/ffm/scripts/regenerate_fiends.py            # render to build/
  python3 sites/ffm/scripts/regenerate_fiends.py --write    # replace the sprites
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

FFM_ROOT = Path(__file__).resolve().parent.parent
SPRITE_DIR = FFM_ROOT / "static" / "game" / "fiend-sprites"
STAGE_DIR = FFM_ROOT / "build" / "fiend-regen"
MODEL = "fal-ai/flux-pro/kontext"
PLATE_ZOOM = 4            # feed a nearest-neighbour plate so the model sees pixel art
KEY_TOLERANCE = 70        # colour distance to the plate that still counts as plate
ALPHA_CUT = 110           # after downscaling, alpha below this becomes transparent

# Plate colours, most preferred first. The first one whose colour barely occurs
# in the sprite wins, which keeps a purple beholder off a magenta plate.
PLATES = {
    "magenta": ((255, 0, 255), "flat magenta (#FF00FF)"),
    "green": ((0, 255, 0), "flat pure green (#00FF00)"),
    "cyan": ((0, 255, 255), "flat cyan (#00FFFF)"),
    "yellow": ((255, 255, 0), "flat pure yellow (#FFFF00)"),
}


def resolve_fal_key() -> None:
    if os.environ.get("FAL_KEY"):
        return
    for candidate in (Path.home() / ".config" / "fal" / "key", Path("/Users/ursschweigert/Documents/GitHub/DerSchweigert/tools/fal_key.txt")):
        if candidate.is_file():
            os.environ["FAL_KEY"] = candidate.read_text().strip()
            return
    sys.path.insert(0, str(Path("/Users/ursschweigert/Documents/GitHub/DerSchweigert/tools")))
    try:
        import fal_image  # noqa: PLC0415
        os.environ["FAL_KEY"] = fal_image.resolve_key(None)
    except Exception as exc:  # pragma: no cover - environment problem
        raise SystemExit(f"no FAL key: {exc}")


def pick_plate(image: Image.Image) -> tuple[str, tuple[int, int, int], str]:
    rgb = np.array(image.convert("RGBA"))[:, :, :3].astype(int)
    alpha = np.array(image.convert("RGBA"))[:, :, 3]
    pixels = rgb[alpha > 40]
    best = None
    for name, (colour, label) in PLATES.items():
        close = int((np.abs(pixels - np.array(colour)).max(axis=1) <= 90).sum())
        if best is None or close < best[0]:
            best = (close, name, colour, label)
    return best[1], best[2], best[3]


def plate_image(sprite: Image.Image, colour: tuple[int, int, int]) -> Image.Image:
    big = sprite.resize((sprite.width * PLATE_ZOOM, sprite.height * PLATE_ZOOM), Image.NEAREST)
    plate = Image.new("RGBA", big.size, (*colour, 255))
    plate.alpha_composite(big)
    return plate.convert("RGB")


def prompt_for(label: str, creature: str) -> str:
    return (
        f"Keep this exact creature unchanged: same species ({creature}), same pose, same "
        f"proportions, same colours, same pixel-art shading and outline weight, same size and "
        f"framing inside the canvas. Change only the ground: remove the ground shadow under it "
        f"completely, so it stands on a perfectly flat {label} background with no shadow, no "
        f"glow and no reflection underneath. Do not add or remove any other detail."
    )


def render(sprite_path: Path) -> dict:
    import fal_client  # noqa: PLC0415

    sprite = Image.open(sprite_path).convert("RGBA")
    name, colour, label = pick_plate(sprite)
    plate = plate_image(sprite, colour)
    data = base64.b64encode(_png_bytes(plate)).decode()
    prompt = prompt_for(label, sprite_path.stem)
    started = time.time()
    result = fal_client.subscribe(
        MODEL,
        arguments={"prompt": prompt, "image_url": f"data:image/png;base64,{data}",
                   "image_size": "square_hd"},
        with_logs=False,
    )
    if not result.get("images"):
        raise RuntimeError(f"no image in response: {sorted(result)} {str(result)[:200]}")
    url = result["images"][0]["url"]
    import urllib.request  # noqa: PLC0415
    STAGE_DIR.mkdir(parents=True, exist_ok=True)
    raw = STAGE_DIR / f"{sprite_path.stem}-raw.jpg"
    with urllib.request.urlopen(url) as response:
        raw.write_bytes(response.read())
    final = key_and_fit(raw, colour, sprite.size)
    out = STAGE_DIR / f"{sprite_path.stem}.png"
    final.save(out, format="PNG", optimize=True)
    return {"id": sprite_path.stem, "plate": name, "seconds": round(time.time() - started, 1),
            "raw": str(raw.name), "out": str(out.name), "size": list(final.size)}


def cut_backdrop(raw_path: Path, original: tuple[int, int]) -> Image.Image:
    """Turn an opaque render into a sprite: key the flat backdrop, fit it back.

    GPT-image cannot emit alpha (it paints a flat or checkerboard backdrop
    instead), so the backdrop is found as the bright, colourless region that is
    connected to the border. Keeping it border-connected is what protects the
    creature's own white highlights - teeth, claws, ice - which are identical in
    colour but enclosed by the silhouette.
    """
    rgb = np.array(Image.open(raw_path).convert("RGB")).astype(np.int16)
    lum = rgb.mean(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    backdropish = (lum > 200) & (chroma < 18)
    labels, _ = __import__("scipy").ndimage.label(backdropish, structure=np.ones((3, 3)))
    border = set(labels[0].tolist()) | set(labels[-1].tolist()) \
        | set(labels[:, 0].tolist()) | set(labels[:, -1].tolist())
    border.discard(0)
    backdrop = np.isin(labels, list(border))
    subject = ndimage_fill(~backdrop)
    subject = ndimage_fill(subject)
    # GPT-image usually paints a soft grey contact shadow even when told not to.
    # It is neutral grey and darker than the flat backdrop, which is what
    # separates it from the creature: bone, ice and stone parts all carry more
    # chroma than this, and the check is limited to the bottom of the frame.
    border_lum = float(np.median(lum[background_mask(labels)])) if background_mask(labels).any() else 237.0
    # Only the light grey contact shadow is removed: a creature's own dark,
    # low-chroma parts (boots, black robes) sit far below this window.
    grey = (chroma < 12) & (lum > 168) & (lum < border_lum - 12)
    bottom = np.zeros_like(subject)
    bottom[int(rgb.shape[0] * 0.55):] = True
    subject = ndimage_fill(subject & ~(grey & bottom))
    rgba = np.dstack([rgb.astype(np.uint8), np.where(subject, 255, 0).astype(np.uint8)])
    ys, xs = np.nonzero(subject)
    cropped = Image.fromarray(rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1], "RGBA")
    scale = original[1] / cropped.height
    return _resize_rgba(cropped, (max(1, round(cropped.width * scale)), original[1]))


def background_mask(labels: np.ndarray) -> np.ndarray:
    border = set(labels[0].tolist()) | set(labels[-1].tolist()) \
        | set(labels[:, 0].tolist()) | set(labels[:, -1].tolist())
    border.discard(0)
    return np.isin(labels, list(border))


def ndimage_fill(mask: np.ndarray) -> np.ndarray:
    from scipy import ndimage  # noqa: PLC0415
    filled = ndimage.binary_fill_holes(mask)
    labels, count = ndimage.label(filled, structure=np.ones((3, 3)))
    if count == 0:
        return filled
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    return labels == int(sizes.argmax())


def _png_bytes(image: Image.Image) -> bytes:
    import io  # noqa: PLC0415
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _plate_like(rgb: np.ndarray, plate: np.ndarray) -> np.ndarray:
    """Pixels that are the chroma plate, including where it is shaded or blended.

    A plain distance test misses the plate under the feet, where it comes back
    darker (a half-erased shadow); those pixels are still dominated by the
    plate's own channel, which is what this tests. It is only safe because the
    plate colour is chosen to be nearly absent from the creature.
    """
    dominant = [c for c in range(3) if plate[c] > 200]
    others = [c for c in range(3) if c not in dominant]
    near = np.abs(rgb - plate).max(axis=2) <= KEY_TOLERANCE
    if len(dominant) == 2:
        # magenta/cyan/yellow: both strong channels sit far above the third
        excess = np.minimum(rgb[:, :, dominant[0]], rgb[:, :, dominant[1]]) - rgb[:, :, others[0]]
    else:
        # a single strong channel: it sits far above both others
        excess = rgb[:, :, dominant[0]] - np.maximum(rgb[:, :, others[0]], rgb[:, :, others[1]])
    return near | (excess > 40)


def key_and_fit(raw_path: Path, plate_colour: tuple[int, int, int], original: tuple[int, int]) -> Image.Image:
    rgb = np.array(Image.open(raw_path).convert("RGB")).astype(np.int16)
    plate = np.array(plate_colour, dtype=np.int16)
    subject = ~_plate_like(rgb, plate)
    subject = _largest_blob(subject)
    rgba = np.dstack([rgb.astype(np.uint8), np.where(subject, 255, 0).astype(np.uint8)])
    rgba = _despill(rgba, plate)
    ys, xs = np.nonzero(subject)
    cropped = Image.fromarray(rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1], "RGBA")
    scale = original[1] / cropped.height
    return _resize_rgba(cropped, (max(1, round(cropped.width * scale)), original[1]))


def _largest_blob(mask: np.ndarray) -> np.ndarray:
    from scipy import ndimage  # noqa: PLC0415
    labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
    if count == 0:
        return mask
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    return labels == int(sizes.argmax())


def _despill(rgba: np.ndarray, plate: np.ndarray) -> np.ndarray:
    """Clamp the plate's own channel down to the other two, killing the fringe.

    Pixels left along the cut edge carry a blend of the creature and the plate;
    with the plate's channel capped at the brighter of the two remaining
    channels that blend reads as neutral instead of glowing in plate colour.
    """
    out = rgba.copy()
    rgb = out[:, :, :3].astype(np.int16)
    dominant = [c for c in range(3) if plate[c] > 200]
    others = [c for c in range(3) if c not in dominant]
    if len(dominant) == 2:
        # Two strong plate channels means one weak one (magenta -> green): a
        # vertical stripe of plate reads as the weak channel trailing the
        # others, so it is raised to their lower one. Lowering the strong
        # channels instead would repaint the creature (a purple body is high in
        # exactly those two).
        low = others[0]
        ceiling = np.minimum(rgb[:, :, dominant[0]], rgb[:, :, dominant[1]])
        cast = ceiling - rgb[:, :, low] > 6
        rgb[:, :, low] = np.where(cast, ceiling, rgb[:, :, low])
    else:
        high = dominant[0]
        floor = np.maximum(rgb[:, :, others[0]], rgb[:, :, others[1]]) + 12
        rgb[:, :, high] = np.minimum(rgb[:, :, high], floor)
    out[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return out


def _resize_rgba(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    a = np.array(image).astype(np.float32)
    alpha = a[:, :, 3:4] / 255.0
    premultiplied = np.concatenate([a[:, :, :3] * alpha, a[:, :, 3:4]], axis=2)
    scaled = np.array(Image.fromarray(premultiplied.astype(np.uint8), "RGBA").resize(size, Image.LANCZOS)).astype(np.float32)
    out_alpha = scaled[:, :, 3:4]
    with np.errstate(divide="ignore", invalid="ignore"):
        rgb = np.where(out_alpha > 0, scaled[:, :, :3] * 255.0 / np.maximum(out_alpha, 1e-6), 0)
    out = np.concatenate([np.clip(rgb, 0, 255), out_alpha], axis=2).astype(np.uint8)
    out[out[:, :, 3] <= ALPHA_CUT] = 0
    out[out[:, :, 3] > ALPHA_CUT, 3] = 255
    return Image.fromarray(out, "RGBA")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--write", action="store_true",
                        help="replace the sprites in static/game/fiend-sprites with the result")
    parser.add_argument("--only", nargs="*", help="limit to these sprite ids (e.g. set1-01)")
    parser.add_argument("--workers", type=int, default=4, help="parallel requests (default 4)")
    parser.add_argument("--gpt-source", metavar="DIR",
                        help="read opaque GPT-image renders named <sprite>.png from DIR, "
                             "key their backdrop and fit them to the sprite size")
    parser.add_argument("--fit-from", metavar="PREFIX", default="set2",
                        help="for a render whose sprite does not exist yet (e.g. set3-07), "
                             "take the size from this set's sprite of the same index")
    parser.add_argument("--key-only", action="store_true",
                        help="re-key the already generated raw images; costs nothing")
    args = parser.parse_args(argv)

    if args.gpt_source:
        source = Path(args.gpt_source)
        if not source.is_dir():
            print(f"no such directory: {source}", file=sys.stderr)
            return 1
        STAGE_DIR.mkdir(parents=True, exist_ok=True)
        done = 0
        for raw in sorted(source.glob("set*.png")):
            stem = raw.stem
            target = SPRITE_DIR / f"{stem}.png"
            if not target.is_file():
                index = stem.split("-")[-1]
                target = SPRITE_DIR / f"{args.fit_from}-{index}.png"
            if not target.is_file():
                print(f"  {stem}: no size reference ({target.name}) - skipped", file=sys.stderr)
                continue
            original = Image.open(target).convert("RGBA")
            final = cut_backdrop(raw, original.size)
            final.save(STAGE_DIR / f"{stem}.png", format="PNG", optimize=True)
            done += 1
            print(f"  {stem}: fitted to {target.stem} {original.size[0]}x{original.size[1]} -> "
                  f"{final.size[0]}x{final.size[1]}")
        print(f"cut {done} sprites from {source}")
        return 0

    if not args.key_only:
        resolve_fal_key()
    paths = sorted(SPRITE_DIR.glob("set*.png"))
    if args.only:
        wanted = set(args.only)
        paths = [p for p in paths if p.stem in wanted]
    if not paths:
        print("no sprites to render", file=sys.stderr)
        return 1
    STAGE_DIR.mkdir(parents=True, exist_ok=True)
    if not args.only and not args.write:
        # Rerunning after a partial batch only fills the gaps.
        remaining = [p for p in paths if not (STAGE_DIR / f"{p.stem}.png").is_file()]
        if remaining:
            print(f"resuming: {len(paths) - len(remaining)} already staged")
        paths = remaining
        if not paths:
            print("nothing to do: every sprite is staged")
    done: list[dict] = []
    failures: list[tuple[str, str]] = []

    if args.key_only:
        STAGE_DIR.mkdir(parents=True, exist_ok=True)
        keyed = 0
        for path in paths:
            raw = STAGE_DIR / f"{path.stem}-raw.jpg"
            if not raw.is_file():
                continue
            sprite = Image.open(path).convert("RGBA")
            name, colour, label = pick_plate(sprite)
            final = key_and_fit(raw, colour, sprite.size)
            final.save(STAGE_DIR / f"{path.stem}.png", format="PNG", optimize=True)
            keyed += 1
            print(f"  {path.stem}: plate={name} -> {final.size[0]}x{final.size[1]}")
        print(f"re-keyed {keyed} sprites (no API calls)")
        return 0

    def job(path: Path) -> dict | None:
        for attempt in (1, 2, 3):
            try:
                info = render(path)
                print(f"  {info['id']}: plate={info['plate']} {info['seconds']}s -> {info['out']} "
                      f"{info['size'][0]}x{info['size'][1]}")
                return info
            except Exception as exc:  # noqa: BLE001
                if attempt == 3:
                    failures.append((path.stem, str(exc)))
                    print(f"  {path.stem}: FAILED {exc}", file=sys.stderr)
                else:
                    time.sleep(2 * attempt)
        return None

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        for info in pool.map(job, paths):
            if info:
                done.append(info)

    (STAGE_DIR / "manifest.json").write_text(json.dumps({"model": MODEL, "items": done,
                                                         "failures": failures}, indent=1))
    print(f"rendered {len(done)}/{len(paths)} sprites into {STAGE_DIR}")
    if failures:
        print(f"failures: {failures}", file=sys.stderr)
    if args.write and done:
        for info in done:
            Image.open(STAGE_DIR / info["out"]).convert("RGBA").save(
                SPRITE_DIR / f"{info['id']}.png", format="PNG", optimize=True)
        print(f"wrote {len(done)} sprites into {SPRITE_DIR}")
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
