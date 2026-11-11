#!/usr/bin/env python3
"""Export and re-import hand-edit sheets for the hero frames and the fiends.

Both sheets are laid out at native sprite size on a transparent background, one
sprite per cell, with a solid red cell border and a caption outside the cell.
That is the whole guide: everything inside a red cell is the sprite, so painting
alpha there is exactly what the build will read back. No tinted overlay, no
inset guides - they would sit on top of the pixels being edited.

Each sheet is written next to a `.json` layout file; `--import-*` uses it to cut
the cells back out, so a sheet can never be re-imported against the wrong grid.

Run:
  python3 sites/ffm/scripts/edit_sheets.py --hero build/hero-edit.png
  python3 sites/ffm/scripts/edit_sheets.py --fiends build/fiends-edit.png --cols 6
  python3 sites/ffm/scripts/edit_sheets.py --import-hero build/hero-edit.png
  python3 sites/ffm/scripts/edit_sheets.py --import-fiends build/fiends-edit.png
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

FFM_ROOT = Path(__file__).resolve().parent.parent
HERO_DIR = FFM_ROOT / "build" / "hero-regen"
SPRITE_DIR = FFM_ROOT / "static" / "game" / "fiend-sprites"

BORDER = (255, 45, 111, 255)
CAPTION = (255, 210, 90, 255)
CAPTION_H = 20
PAD = 10

HERO_ORDER = [
    *(f"idle-{i}" for i in range(1, 5)),
    *(f"walk-{i}" for i in range(1, 5)),
    *(f"swing-{i}" for i in range(1, 5)),
    *(f"hurt-{i}" for i in range(1, 5)),
    *(f"dead-{i}" for i in range(1, 5)),
    *(f"victory-{i}" for i in range(1, 5)),
    *(f"cast-{i}" for i in range(1, 5)),
]


def _items_hero() -> list[tuple[str, Path]]:
    items = []
    for frame_id in HERO_ORDER:
        path = HERO_DIR / f"{frame_id}.png"
        if path.is_file():
            items.append((frame_id, path))
        else:
            print(f"  missing hero frame {frame_id}", file=sys.stderr)
    return items


def _items_fiends() -> list[tuple[str, Path]]:
    paths = sorted(SPRITE_DIR.glob("set*.png")) + sorted(SPRITE_DIR.glob("dragon-*.png"))
    return [(p.stem, p) for p in paths]


def build_sheet(items: list[tuple[str, Path]], path: Path, cols: int, kind: str) -> Path:
    images = [(item_id, Image.open(item_path).convert("RGBA")) for item_id, item_path in items]
    cell_w = max(image.width for _, image in images) + 2 * PAD
    cell_h = max(image.height for _, image in images) + 2 * PAD
    rows = (len(images) + cols - 1) // cols
    width = cols * cell_w + PAD
    height = rows * (cell_h + CAPTION_H) + PAD
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(sheet)
    layout = {"kind": kind, "cell": [cell_w, cell_h], "pad": PAD, "caption_h": CAPTION_H,
              "cols": cols, "size": [width, height], "items": []}

    for index, (item_id, image) in enumerate(images):
        col, row = index % cols, index // cols
        x0 = PAD + col * cell_w
        y0 = PAD + row * (cell_h + CAPTION_H)
        # centred, bottom-aligned: every cell has the same ground line
        left = x0 + (cell_w - image.width) // 2
        top = y0 + cell_h - PAD - image.height
        sheet.alpha_composite(image, (left, top))
        draw.rectangle([x0, y0, x0 + cell_w - 1, y0 + cell_h - 1], outline=BORDER, width=2)
        draw.text((x0 + 4, y0 - CAPTION_H + 4), item_id, fill=CAPTION)
        layout["items"].append({"id": item_id, "col": col, "row": row,
                                "left": left, "top": top,
                                "w": image.width, "h": image.height})

    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, format="PNG", optimize=True)
    path.with_suffix(".json").write_text(json.dumps(layout) + "\n", encoding="utf-8")
    print(f"wrote {path} ({width}x{height}, {len(images)} cells) and {path.stem}.json")
    return path


def _read(sheet_path: Path) -> tuple[Image.Image, dict]:
    layout_path = sheet_path.with_suffix(".json")
    if not layout_path.is_file():
        raise SystemExit(f"missing layout next to {sheet_path.name}")
    return Image.open(sheet_path).convert("RGBA"), json.loads(layout_path.read_text())


def _cut(sheet: Image.Image, layout: dict) -> list[tuple[str, Image.Image]]:
    cell_w, cell_h = layout["cell"]
    pad = layout["pad"]
    out = []
    for item in layout["items"]:
        x0 = pad + item["col"] * cell_w
        y0 = pad + item["row"] * (cell_h + layout["caption_h"])
        # The border is drawn INSIDE the cell rectangle with width 2, so the
        # crop starts two pixels in: the geometry alone excludes it, whatever
        # the editor did to its colours. The colour strip below is only a
        # belt-and-braces for a brush that grazed the line.
        crop = np.array(sheet.crop((x0 + 2, y0 + 2, x0 + cell_w - 2, y0 + cell_h - 2)))
        border = np.all(crop[:, :, :4] == np.array(BORDER, dtype=np.uint8), axis=2)
        crop[border] = 0
        alpha = crop[:, :, 3] > 0
        if not alpha.any():
            print(f"  {item['id']}: cell is empty - skipped", file=sys.stderr)
            continue
        ys, xs = np.nonzero(alpha)
        out.append((item["id"], Image.fromarray(
            crop[ys.min():ys.max() + 1, xs.min():xs.max() + 1], "RGBA")))
    return out


def import_hero(sheet_path: Path) -> int:
    sheet, layout = _read(sheet_path)
    frames = _cut(sheet, layout)
    HERO_DIR.mkdir(parents=True, exist_ok=True)
    for frame_id, image in frames:
        image.save(HERO_DIR / f"{frame_id}.png", format="PNG", optimize=True)
    print(f"imported {len(frames)} hero frames into {HERO_DIR.relative_to(FFM_ROOT)}")
    print("next: python3 sites/ffm/scripts/hero_frames.py --from-frames "
          f"{HERO_DIR.relative_to(FFM_ROOT)}")
    return 0


def import_fiends(sheet_path: Path) -> int:
    sheet, layout = _read(sheet_path)
    sprites = _cut(sheet, layout)
    for sprite_id, image in sprites:
        image.save(SPRITE_DIR / f"{sprite_id}.png", format="PNG", optimize=True)
    print(f"imported {len(sprites)} fiend sprites into {SPRITE_DIR.relative_to(FFM_ROOT)}")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--hero", metavar="PATH", help="write the hero edit sheet")
    parser.add_argument("--fiends", metavar="PATH", help="write the fiend edit sheet")
    parser.add_argument("--cols", type=int, default=6, help="columns (default 6)")
    parser.add_argument("--import-hero", metavar="PATH", help="read an edited hero sheet back")
    parser.add_argument("--import-fiends", metavar="PATH", help="read an edited fiend sheet back")
    args = parser.parse_args(argv)

    if args.hero:
        build_sheet(_items_hero(), Path(args.hero), max(1, args.cols // 2), "hero")
    if args.fiends:
        build_sheet(_items_fiends(), Path(args.fiends), max(1, args.cols), "fiends")
    if args.import_hero:
        return import_hero(Path(args.import_hero))
    if args.import_fiends:
        return import_fiends(Path(args.import_fiends))
    if not args.hero and not args.fiends:
        parser.error("nothing to do: pass --hero and/or --fiends")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
