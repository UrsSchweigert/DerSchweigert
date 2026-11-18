#!/usr/bin/env python3
"""Render the Buchstabenzeit graphics that Google Play asks for.

Inputs (committed, never edited by this script):

  ../source/key-art-3136x1344.png          text-free key art: the owl, the fledgling,
                                           the open book and the alphabet blocks
  ../../assets/icon-only.png               1024x1024 launcher icon art, also the source
                                           of the Android mipmaps and the iOS AppIcon
  ../../static/fonts/grundschrift-*.woff2  the app's own typeface

Outputs (the formats Play Console asks for):

  ../google-play/icon-512x512.png                 512x512, 32-bit PNG with alpha
  ../google-play/feature-graphic-de-1024x500.png  1024x500, 24-bit PNG, no alpha
  ../google-play/feature-graphic-en-1024x500.png  1024x500, 24-bit PNG, no alpha

The icon is deliberately nothing but a downsample of the shipped launcher art, so
the listing and the installed app cannot drift apart. The feature graphics use the
same key art as the App Store header, cropped to Play's wide banner and titled in
the app's own Grundschrift.

Requires Pillow, fontTools and brotli. The woff2 fonts are decompressed into a
temporary directory on every run, so no font binaries are duplicated here.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ART_DIR = Path(__file__).resolve().parent.parent
SITE_DIR = ART_DIR.parent
REPO_DIR = SITE_DIR.parent.parent
OUT_DIR = ART_DIR / "google-play"

KEY_ART = ART_DIR / "source" / "key-art-3136x1344.png"
ICON_ART = SITE_DIR / "assets" / "icon-only.png"
FONT_DIR = SITE_DIR / "static" / "fonts"

ICON_SIZE = 512
GRAPHIC_WIDTH = 1024
GRAPHIC_HEIGHT = 500

INK = (23, 47, 87)
MUTED = (74, 96, 128)

HEADLINE_SIZE = 78
SUBTITLE_SIZE = 34
# Play cuts the outer edge of the graphic off on some surfaces, so the title starts
# at 10 % of the width instead of hugging the frame.
MARGIN_LEFT = 104
LINE_GAP = 18
OPTICAL_LIFT = 8
TITLE_SAFE_EDGE = 0.62

FEATURE_GRAPHIC_COPY = {
    "de": ("Buchstabenzeit", "geführt lesen"),
    "en": ("Letter time", "guided reading"),
}


def _truetype(woff2: Path, size: int, scratch: Path) -> ImageFont.FreeTypeFont:
    ttf = scratch / woff2.with_suffix(".ttf").name
    if not ttf.exists():
        font = TTFont(woff2)
        font.flavor = None
        font.save(ttf)
    return ImageFont.truetype(str(ttf), size)


def _key_art() -> Image.Image:
    art = Image.open(KEY_ART).convert("RGB")
    width, height = art.size
    crop_width = round(height * GRAPHIC_WIDTH / GRAPHIC_HEIGHT)
    if crop_width > width:
        raise SystemExit(f"{KEY_ART.name} is too narrow for a {GRAPHIC_WIDTH}x{GRAPHIC_HEIGHT} crop")
    # Anchored right, so the alphabet blocks stay in frame and the left half stays clean for the title.
    art = art.crop((width - crop_width, 0, width, height))
    return art.resize((GRAPHIC_WIDTH, GRAPHIC_HEIGHT), Image.LANCZOS)


def render_feature_graphic(headline: str, subtitle: str, scratch: Path) -> Image.Image:
    image = _key_art()
    draw = ImageDraw.Draw(image)
    headline_font = _truetype(FONT_DIR / "grundschrift-bold.woff2", HEADLINE_SIZE, scratch)
    subtitle_font = _truetype(FONT_DIR / "grundschrift-regular.woff2", SUBTITLE_SIZE, scratch)

    head = draw.textbbox((0, 0), headline, font=headline_font)
    sub = draw.textbbox((0, 0), subtitle, font=subtitle_font)
    head_height = head[3] - head[1]
    sub_height = sub[3] - sub[1]

    top = round((GRAPHIC_HEIGHT - (head_height + LINE_GAP + sub_height)) / 2) - OPTICAL_LIFT
    draw.text((MARGIN_LEFT - head[0], top - head[1]), headline, font=headline_font, fill=INK)
    draw.text(
        (MARGIN_LEFT - sub[0], top + head_height + LINE_GAP - sub[1]),
        subtitle,
        font=subtitle_font,
        fill=MUTED,
    )

    right = MARGIN_LEFT + max(head[2] - head[0], sub[2] - sub[0])
    if right > round(GRAPHIC_WIDTH * TITLE_SAFE_EDGE):
        raise SystemExit(f"'{headline}' runs {right}px into the owl; shorten it or lower HEADLINE_SIZE")
    return image


def render_icon() -> Image.Image:
    # Play requires a 32-bit PNG with alpha; the art is full-bleed, so the channel is opaque
    # and the stores apply their own corner mask.
    icon = Image.open(ICON_ART).convert("RGBA")
    icon = icon.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
    return icon.filter(ImageFilter.UnsharpMask(radius=1.1, percent=48, threshold=2))


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        scratch = Path(tmp)
        outputs = [("icon-512x512.png", render_icon())]
        for locale, (headline, subtitle) in FEATURE_GRAPHIC_COPY.items():
            name = f"feature-graphic-{locale}-{GRAPHIC_WIDTH}x{GRAPHIC_HEIGHT}.png"
            outputs.append((name, render_feature_graphic(headline, subtitle, scratch)))
        for name, image in outputs:
            path = OUT_DIR / name
            image.save(path, format="PNG", optimize=True)
            size = f"{path.stat().st_size:,} bytes"
            print(f"{path.relative_to(REPO_DIR)}  {image.width}x{image.height}  {image.mode}  {size}")


if __name__ == "__main__":
    main()
