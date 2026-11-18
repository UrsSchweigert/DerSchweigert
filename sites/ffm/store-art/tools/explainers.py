#!/usr/bin/env python3
"""Draw the three Arithmo Slayer explainer screenshots: combat, combos, levels.

Each card is a landscape store screenshot in the art's own language: the key-art
backdrop and brass frame from compose.py, the app's green overlay-card panels
with brass borders, real gameplay frames from ../../promo-shots/, and text set
in the game's own face. The words live in ../copy/explainers.json, one entry per
language, and every claim there is checked against the game code by
sites/ffm/tests/test_store_art_explainers.py.

Outputs (gitignored, regenerate before uploading):

  ../explainers/<locale>/app-store-6.1-landscape/0N-<card>.png  2556x1179
  ../explainers/<locale>/google-play-16x9/0N-<card>.png         1920x1080

The two sizes are the screenshot slots the marketing pack fills
(marketing/tools/build.py, SLOTS), so the explainers upload next to those
captures: Apple's iPhone 6.1"/6.3" landscape size and Play's 16:9 phone size.

Usage:
  python3 sites/ffm/store-art/tools/explainers.py
  python3 sites/ffm/store-art/tools/explainers.py --locale en --preview
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compose import (  # noqa: E402  (compose.py sits next to this file)
    BRASS,
    BRASS_LIGHT,
    INK_950,
    IVORY,
    REPO,
    ROOT,
    base_creative,
    brass_frame,
    save,
)

COPY = ROOT / "copy" / "explainers.json"
SHOTS = REPO / "sites" / "ffm" / "promo-shots"
OUT = ROOT / "explainers"

# The same two slots the marketing pack's captures use.
SLOTS = {
    "app-store-6.1-landscape": (2556, 1179),
    "google-play-16x9": (1920, 1080),
}

# styles.css :root, beyond what compose.py already names.
IVORY_MUTED = (211, 204, 185)  # --ivory-muted #d3ccb9
BRASS_DEEP = (128, 96, 45)  # --brass-deep #80602d
# .overlay-card background: linear-gradient(145deg, rgba(33,65,53,.96), rgba(13,30,24,.97)).
PANEL_TOP = (33, 65, 53)
PANEL_BOTTOM = (13, 30, 24)

# The game sets every heading, question and answer in CSS `monospace`
# (styles.css: body, .splash-title, --font-prose), which WebKit and Chromium on
# Apple platforms resolve to Courier — that is the face in every capture in
# promo-shots/. Bold, because the in-game headings and the question line are
# bold, and because Courier's regular weight is a hairline at thumbnail size.
GAME_FONTS = (
    ("/System/Library/Fonts/Courier.ttc", 1),  # Courier Bold, the in-game face
    ("/System/Library/Fonts/Supplemental/Courier New Bold.ttf", 0),
    ("/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf", 0),
)

# The play area inside a 1170x2532 portrait capture in promo-shots/: from below
# the top of the HP/LEVEL bar to the ground line, inside the playfield border.
SHOT_SIZE = (1170, 2532)
SCENE_BOX = (36, 452, 1134, 1084)


class LayoutError(RuntimeError):
    """Text did not fit its box at the smallest legible size."""


def game_font(size: int) -> ImageFont.FreeTypeFont:
    for path, index in GAME_FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, size, index=index)
    raise SystemExit("No Courier-style bold monospace font found; see GAME_FONTS in explainers.py")


def load_copy() -> dict:
    return json.loads(COPY.read_text(encoding="utf-8"))


def scene(shot: str) -> Image.Image:
    """The play area of a committed gameplay capture."""
    image = Image.open(SHOTS / f"{shot}.png").convert("RGB")
    if image.size != SHOT_SIZE:
        raise SystemExit(f"{shot}.png is {image.size}, SCENE_BOX expects {SHOT_SIZE}")
    return image.crop(SCENE_BOX)


# --- drawing primitives -----------------------------------------------------


def text_width(font: ImageFont.FreeTypeFont, text: str) -> float:
    return font.getlength(text)


def wrap(text: str, font: ImageFont.FreeTypeFont, width: float) -> list[str]:
    """Greedy word wrap; a single word wider than `width` is a layout error."""
    lines: list[str] = []
    for word in text.split():
        if text_width(font, word) > width:
            raise LayoutError(f"word {word!r} is wider than {width:.0f}px at {font.size}px")
        if lines and text_width(font, f"{lines[-1]} {word}") <= width:
            lines[-1] = f"{lines[-1]} {word}"
        else:
            lines.append(word)
    return lines


def fit(
    texts: list[str], width: float, height: float, start: int, minimum: int, max_lines: int, leading: float = 1.18
) -> tuple[ImageFont.FreeTypeFont, list[list[str]]]:
    """Largest size from `start` down to `minimum` at which every text wraps
    into `max_lines` lines of `width` and the stack fits `height`. Raise
    LayoutError rather than shrink below `minimum`: smaller is illegible in a
    store listing, so the copy has to get shorter instead."""
    for size in range(start, minimum - 1, -1):
        font = game_font(size)
        try:
            blocks = [wrap(text, font, width) for text in texts]
        except LayoutError:
            continue
        if any(len(block) > max_lines for block in blocks):
            continue
        if sum(len(block) for block in blocks) * size * leading <= height:
            return font, blocks
    raise LayoutError(f"{texts!r} does not fit {width:.0f}x{height:.0f} at {minimum}px or larger")


def draw_text(
    canvas: Image.Image,
    xy: tuple[float, float],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int],
    anchor: str = "la",
    glow: tuple[int, int, int] | None = None,
) -> None:
    """Text with the splash title's treatment: a hard dark drop shadow, a soft
    dark halo and, for headings, a faint brass glow (styles.css .splash-title)."""
    size = font.size
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).text(xy, text, font=font, fill=(*fill, 255), anchor=anchor)

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text(
        (xy[0], xy[1] + max(1, round(size * 0.06))), text, font=font, fill=(7, 14, 11, 255), anchor=anchor
    )
    halo = shadow.filter(ImageFilter.GaussianBlur(max(2, round(size * 0.22))))
    halo.putalpha(halo.getchannel("A").point(lambda v: int(v * 0.85)))
    canvas.alpha_composite(halo)
    if glow:
        tint = Image.new("RGBA", canvas.size, (*glow, 0))
        tint.putalpha(layer.getchannel("A").filter(ImageFilter.GaussianBlur(round(size * 0.35))).point(lambda v: int(v * 0.45)))
        canvas.alpha_composite(tint)
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(layer)


def panel(canvas: Image.Image, rect: tuple[int, int, int, int], s: float, border=BRASS) -> None:
    """The app's overlay card: green diagonal gradient, brass border, an ivory
    inset highlight on the top edge and a soft drop shadow."""
    x0, y0, x1, y1 = rect
    w, h = x1 - x0, y1 - y0
    radius = max(4, round(10 * s))
    stroke = max(2, round(3 * s))

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (x0, y0 + round(10 * s), x1, y1 + round(10 * s)), radius=radius, fill=(0, 0, 0, 120)
    )
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(round(22 * s))))

    # 145deg runs from the top left to the bottom right: average a horizontal
    # and a vertical ramp.
    down = Image.linear_gradient("L").resize((w, h), Image.BILINEAR)
    across = Image.linear_gradient("L").rotate(90).resize((w, h), Image.BILINEAR)
    ramp = ImageChops.add(down, across, scale=2)
    fill = Image.composite(
        Image.new("RGBA", (w, h), (*PANEL_BOTTOM, 247)), Image.new("RGBA", (w, h), (*PANEL_TOP, 245)), ramp
    )
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    card.paste(fill, (0, 0), mask)
    canvas.alpha_composite(card, (x0, y0))

    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rounded_rectangle(rect, radius=radius, outline=(*border, 235), width=stroke)
    inset = stroke + max(2, round(3 * s))
    draw.rounded_rectangle(
        (x0 + inset, y0 + inset, x1 - inset, y1 - inset),
        radius=max(1, radius - inset),
        outline=(*BRASS_LIGHT, 55),
        width=1,
    )
    draw.line((x0 + radius, y0 + stroke + 1, x1 - radius, y0 + stroke + 1), fill=(*IVORY, 26), width=1)


def framed_image(canvas: Image.Image, image: Image.Image, rect: tuple[int, int, int, int], s: float) -> None:
    """A gameplay frame set into a brass border, like the answer buttons."""
    x0, y0, x1, y1 = rect
    stroke = max(2, round(4 * s))
    radius = max(3, round(8 * s))
    shot = image.resize((x1 - x0, y1 - y0), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width - 1, shot.height - 1), radius=radius, fill=255)

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x0, y0 + round(10 * s), x1, y1 + round(10 * s)), radius=radius, fill=(0, 0, 0, 130))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(round(20 * s))))
    canvas.paste(shot, (x0, y0), mask)
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rounded_rectangle((x0, y0, x1, y1), radius=radius, outline=(*BRASS, 240), width=stroke)
    inner = stroke + max(1, round(2 * s))
    draw.rounded_rectangle(
        (x0 + inner, y0 + inner, x1 - inner, y1 - inner), radius=max(1, radius - inner), outline=(*BRASS_LIGHT, 90), width=1
    )


def badge(canvas: Image.Image, centre: tuple[float, float], diameter: float, label: str, s: float) -> None:
    """A round brass medallion with an ink numeral, the combo-band marker."""
    cx, cy = centre
    r = diameter / 2
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.ellipse((cx - r, cy - r + 6 * s, cx + r, cy + r + 6 * s), fill=(0, 0, 0, 110))
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(*BRASS, 255), outline=(*BRASS_DEEP, 255), width=max(2, round(3 * s)))
    ring = r * 0.82
    draw.ellipse((cx - ring, cy - ring, cx + ring, cy + ring), outline=(*BRASS_LIGHT, 255), width=max(1, round(2 * s)))
    size = round(diameter * (0.56 if len(label) < 2 else 0.46))
    draw.text((cx, cy), label, font=game_font(size), fill=(*INK_950, 255), anchor="mm")


def backdrop(width: int, height: int) -> Image.Image:
    """Key art, forest vignette, an ink veil so panels read, then the frame."""
    canvas = base_creative(width, height, top_bias=0.42)
    canvas.alpha_composite(Image.new("RGBA", canvas.size, (*INK_950, 120)))
    brass_frame(canvas, min(width, height) / 500)
    return canvas


def heading(canvas: Image.Image, title: str, subtitle: str | None, s: float) -> int:
    """Centred title (ivory, brass glow) and optional brass subtitle; return the
    y where content may start."""
    w = canvas.width
    title_font = game_font(round(84 * s))
    if text_width(title_font, title) > w * 0.86:
        raise LayoutError(f"title {title!r} is too wide")
    top = round(54 * s)
    draw_text(canvas, (w / 2, top), title, title_font, IVORY, anchor="ma", glow=BRASS)
    bottom = top + round(84 * s)
    if subtitle:
        sub_font = game_font(round(46 * s))
        if text_width(sub_font, subtitle) > w * 0.86:
            raise LayoutError(f"subtitle {subtitle!r} is too wide")
        draw_text(canvas, (w / 2, bottom + round(18 * s)), subtitle, sub_font, BRASS_LIGHT, anchor="ma")
        bottom += round(18 * s) + round(46 * s)
    return bottom + round(40 * s)


# --- the three cards ----------------------------------------------------------


def combat_card(size: tuple[int, int], copy: dict, locale: str) -> Image.Image:
    width, height = size
    s = height / 1080
    text = copy["combat"][locale]
    canvas = backdrop(width, height)
    top = heading(canvas, text["title"], None, s)
    margin = round(width * 0.045)
    bottom = height - round(70 * s)

    # The scene takes what the height allows at 16:9, capped at half the width.
    src = scene(copy["combat"]["shot"])
    scene_h = bottom - top
    scene_w = round(scene_h * src.width / src.height)
    scene_w = min(scene_w, round(width * 0.5))
    scene_h = round(scene_w * src.height / src.width)
    scene_y = top + (bottom - top - scene_h) // 2
    framed_image(canvas, src, (margin, scene_y, margin + scene_w, scene_y + scene_h), s)

    px0 = margin + scene_w + round(width * 0.03)
    rect = (px0, scene_y, width - margin, scene_y + scene_h)
    panel(canvas, rect, s)

    pad = round(34 * s)
    dot = round(70 * s)
    rows = text["rows"]
    text_x = rect[0] + pad + dot + round(24 * s)
    text_w = rect[2] - pad - text_x
    slot_h = (rect[3] - rect[1] - 2 * pad) / len(rows)
    font, blocks = fit(rows, text_w, slot_h * len(rows) - pad, start=round(58 * s), minimum=round(42 * s), max_lines=2)
    line_h = font.size * 1.18
    for i, block in enumerate(blocks):
        cy = rect[1] + pad + slot_h * (i + 0.5)
        badge(canvas, (rect[0] + pad + dot / 2, cy), dot, str(i + 1), s)
        y = cy - line_h * len(block) / 2
        for line in block:
            draw_text(canvas, (text_x, y + line_h / 2), line, font, IVORY, anchor="lm")
            y += line_h
    return canvas


def footer_height(lines: list[str], s: float, size: int) -> int:
    px = round(size * s)
    return round(len(lines) * px * 1.3 + px * 0.9)


def footer_panel(canvas: Image.Image, lines: list[str], top: int, s: float, size: int) -> int:
    """A centred overlay card holding one or two short lines; return its bottom."""
    font = game_font(round(size * s))
    margin = round(canvas.width * 0.05)
    fw = max(text_width(font, line) for line in lines)
    if fw > canvas.width - 2 * margin - round(96 * s):
        raise LayoutError(f"footer {lines!r} too wide")
    line_h = font.size * 1.3
    height = footer_height(lines, s, size)
    half = fw / 2 + round(48 * s)
    cx = canvas.width / 2
    panel(canvas, (round(cx - half), top, round(cx + half), top + height), s)
    y = top + height / 2 - line_h * len(lines) / 2
    for line in lines:
        draw_text(canvas, (cx, y + line_h / 2), line, font, IVORY, anchor="mm")
        y += line_h
    return top + height


def combos_card(size: tuple[int, int], copy: dict, locale: str) -> Image.Image:
    width, height = size
    s = height / 1080
    spec = copy["combos"]
    text = spec[locale]
    canvas = backdrop(width, height)
    top = heading(canvas, text["title"], text["subtitle"], s)

    margin = round(width * 0.05)
    gap = round(width * 0.025)
    pad = round(22 * s)
    footer = [text["footer"]]
    footer_gap = round(40 * s)
    room = height - round(70 * s) - footer_height(footer, s, 50) - footer_gap - top

    tile_w = (width - 2 * margin - 2 * gap) // 3
    name_font = game_font(round(56 * s))
    for name in (t["name"] for t in text["tiles"]):
        if text_width(name_font, name) > tile_w - 2 * pad:
            raise LayoutError(f"tile name {name!r} too wide")
    name_h = round(56 * s * 1.3)
    font, blocks = fit(
        [t["text"] for t in text["tiles"]], tile_w - 2 * pad, 10_000, start=round(48 * s), minimum=round(40 * s), max_lines=2
    )
    text_h = round(max(len(block) for block in blocks) * font.size * 1.18)

    # The gameplay frame takes the tile's width unless that would push the
    # text out of the space between heading and footer.
    sample = scene(spec["tiles"][0]["shot"])
    aspect = sample.width / sample.height
    fixed = 2 * pad + round(20 * s) + name_h + text_h
    img_w = tile_w - 2 * pad
    img_h = round(img_w / aspect)
    if img_h + fixed > room:
        img_h = room - fixed
        img_w = round(img_h * aspect)
    tile_h = img_h + fixed
    y0 = top + (room - tile_h) // 2

    for i, (tile, words, block) in enumerate(zip(spec["tiles"], text["tiles"], blocks)):
        x0 = margin + i * (tile_w + gap)
        panel(canvas, (x0, y0, x0 + tile_w, y0 + tile_h), s)
        ix = x0 + (tile_w - img_w) // 2
        iy = y0 + pad
        framed_image(canvas, scene(tile["shot"]), (ix, iy, ix + img_w, iy + img_h), s)
        d = round(112 * s)
        badge(canvas, (ix + d * 0.42, iy + d * 0.42), d, str(tile["combo"]), s)
        cx = x0 + tile_w / 2
        y = iy + img_h + round(20 * s)
        draw_text(canvas, (cx, y), words["name"], name_font, BRASS_LIGHT, anchor="ma", glow=BRASS)
        y += name_h
        for line in block:
            draw_text(canvas, (cx, y), line, font, IVORY, anchor="ma")
            y += font.size * 1.18

    footer_panel(canvas, footer, y0 + tile_h + footer_gap, s, 50)
    return canvas


def levels_card(size: tuple[int, int], copy: dict, locale: str) -> Image.Image:
    width, height = size
    s = height / 1080
    spec = copy["levels"]
    text = spec[locale]
    steps = spec["steps"]
    canvas = backdrop(width, height)
    top = heading(canvas, text["title"], text["subtitle"], s)

    margin = round(width * 0.05)
    gap = round(width * 0.018)
    pad = round(20 * s)
    col_w = (width - 2 * margin - gap * (len(steps) - 1)) // len(steps)
    footer_gap = round(36 * s)
    floor = height - round(70 * s) - footer_height(text["footer"], s, 44) - footer_gap

    label_font = game_font(round(38 * s))
    op_size = round(96 * s)
    example_font, example_blocks = fit(
        [step["example"] for step in steps], col_w - 2 * pad, 10_000, start=round(50 * s), minimum=round(38 * s), max_lines=1
    )
    caption_font, caption_blocks = fit(
        text["steps"], col_w - 2 * pad, 10_000, start=round(42 * s), minimum=round(34 * s), max_lines=2
    )
    caption_lines = max(len(block) for block in caption_blocks)
    label_h = round(label_font.size * 1.35)
    op_h = round(op_size * 1.08)
    example_h = round(example_font.size * 1.45)
    panel_h = 2 * pad + round(6 * s) + label_h + op_h + example_h + round(caption_lines * caption_font.size * 1.18)

    # A staircase: equal cards, each one step higher than the last, so the
    # climb reads left to right without empty card bottoms.
    rise = min(round(56 * s), (floor - top - panel_h) // (len(steps) - 1))
    if rise < round(20 * s):
        raise LayoutError("no room for the staircase")

    for i, step in enumerate(steps):
        last = i == len(steps) - 1
        x0 = margin + i * (col_w + gap)
        y1 = floor - rise * i
        y0 = y1 - panel_h
        panel(canvas, (x0, y0, x0 + col_w, y1), s, border=BRASS_LIGHT if last else BRASS)
        cx = x0 + col_w / 2
        label = (text["level_from"] if last else text["level"]).format(n=step["level"])
        if text_width(label_font, label) > col_w - 2 * pad:
            raise LayoutError(f"step label {label!r} too wide")
        # Centre a one-line caption's shorter block in the shared card height.
        spare = (caption_lines - len(caption_blocks[i])) * caption_font.size * 1.18
        y = y0 + pad + round(6 * s) + spare / 2
        draw_text(canvas, (cx, y), label, label_font, IVORY_MUTED, anchor="ma")
        y += label_h

        font = game_font(op_size)
        while text_width(font, step["op"]) > col_w - 2 * pad:
            font = game_font(font.size - 4)
        draw_text(canvas, (cx, y + op_h / 2), step["op"], font, BRASS_LIGHT, anchor="mm", glow=BRASS)
        y += op_h

        draw_text(canvas, (cx, y), example_blocks[i][0], example_font, IVORY, anchor="ma")
        y += example_h
        for line in caption_blocks[i]:
            draw_text(canvas, (cx, y), line, caption_font, IVORY_MUTED, anchor="ma")
            y += caption_font.size * 1.18

    footer_panel(canvas, text["footer"], floor + footer_gap, s, 44)
    return canvas


CARDS = (("01-combat", combat_card), ("02-combos", combos_card), ("03-levels", levels_card))


def render_all(locales: list[str], preview: bool = False) -> list[Path]:
    copy = load_copy()
    written = []
    for locale in locales:
        for slot, size in SLOTS.items():
            for name, draw in CARDS:
                image = draw(size, copy, locale)
                path = OUT / locale / slot / f"{name}.png"
                save(image, path)
                written.append(path)
                if preview:
                    small = image.convert("RGB")
                    small.thumbnail((small.width // 2, small.height // 2), Image.LANCZOS)
                    small.save(path.with_suffix(".preview.jpg"), "JPEG", quality=88)
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--locale", action="append", choices=["de", "en"], help="repeatable; default both")
    parser.add_argument("--preview", action="store_true", help="also write 50%% JPEG previews")
    args = parser.parse_args()
    render_all(args.locale or ["de", "en"], args.preview)


if __name__ == "__main__":
    main()
