#!/usr/bin/env python3
"""Render sites/ffm/static/promo/og-image.png (1200x630) from the page's own art.

The card is the wide key art the hero is built on (`game/title-art-wide.webp`)
plus the title logo (`game/title-logo.webp`) - the same two images the landing
page shows first. Nothing is drawn twice: the painted hero of the key art is
the hero of the card, so there is no second, mismatched character and no
half-cropped sprite at the edge.

The crop starts at the left edge and stops at x=1400, which is exactly the gap
between the arithmetic glyphs in the middle of the key art and the second
column of glyphs that the source image cuts off at its own right border; it is
also flush with the bottom so the glyph row is never sliced.

Usage:  python3 sites/ffm/static/promo/tools/render-og.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

STATIC = Path(__file__).resolve().parents[2]
PROMO = STATIC / "promo"
W, H = 1200, 630
BRASS = (196, 154, 72)
BRASS_LIGHT = (228, 197, 119)

# Source window in game/title-art-wide.webp. 1400x735 has exactly the 1200:630
# aspect ratio, so the resize never stretches anything.
CROP = (0, 206, 1400, 941)

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Andale Mono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def trim_alpha(image):
    box = image.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return image.crop(box) if box else image


def vertical_scrim(width, height, top, bottom):
    """Alpha mask that darkens the top and bottom edges of the card."""
    plate = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(plate)
    for y in range(height):
        edge = min(1.0, (y / 170) ** 2) * top + min(1.0, ((height - y) / 190) ** 2) * bottom
        draw.line([(0, y), (width, y)], fill=int(255 * min(1.0, edge)))
    return plate


def corner_glow(width, height, cx, cy, radius, alpha):
    """Radial alpha mask, used to sink the top-right corner behind the logo."""
    plate = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(plate)
    steps = 44
    for i in range(steps, 0, -1):
        r = radius * i / steps
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=int(alpha * (1 - i / steps) ** 0.8))
    return plate.filter(ImageFilter.GaussianBlur(radius / 10))


def main():
    base = Image.open(STATIC / "game" / "title-art-wide.webp").convert("RGB")
    base = base.crop(CROP).resize((W, H), Image.LANCZOS)

    canvas = base.convert("RGBA")

    # --- grade: keep the art readable, sink the corners ---------------------
    scrim = vertical_scrim(W, H, 0.40, 0.55)
    canvas = Image.composite(
        Image.new("RGBA", (W, H), (5, 13, 18, 255)), canvas, scrim.point(lambda v: v // 2)
    )
    glow = corner_glow(W, H, W - 40, 0, 720, 205)
    canvas = Image.composite(Image.new("RGBA", (W, H), (4, 11, 16, 255)), canvas, glow)

    # --- logo, top right ---------------------------------------------------
    logo = trim_alpha(Image.open(STATIC / "game" / "title-logo.webp").convert("RGBA"))
    logo_w = 470
    logo_h = round(logo.height * logo_w / logo.width)
    logo = logo.resize((logo_w, logo_h), Image.LANCZOS)

    logo_x, logo_y = W - logo_w - 42, 32
    shadow = Image.new("RGBA", (logo_w + 160, logo_h + 160), (0, 0, 0, 0))
    shadow.paste((2, 7, 11, 190), (80, 80, 80 + logo_w, 80 + logo_h), logo.getchannel("A"))
    shadow = shadow.filter(ImageFilter.GaussianBlur(30))
    canvas.alpha_composite(shadow, (logo_x - 80, logo_y - 80))
    canvas.alpha_composite(logo, (logo_x, logo_y))

    # --- tagline, bottom left ----------------------------------------------
    tagline = "KOPFRECHNEN FÜR JUNG UND ALT"
    font = load_font(30)
    tracking = 3
    widths = [font.getbbox(ch)[2] - font.getbbox(ch)[0] for ch in tagline]
    text_w = sum(widths) + tracking * (len(tagline) - 1)

    # Deliberate ink plate with a brass hairline: keeps the brass text legible
    # over the bright valley without looking like an accidental shadow.
    px0, py0 = 34, H - 98
    px1, py1 = px0 + text_w + 44, H - 34
    plate = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plate)
    pd.rounded_rectangle((px0, py0, px1, py1), radius=10, fill=(7, 16, 13, 216), outline=BRASS + (200,), width=2)
    pd.rounded_rectangle((px0 + 5, py0 + 5, px1 - 5, py1 - 5), radius=7, outline=(228, 197, 119, 55), width=1)
    canvas.alpha_composite(plate)

    draw = ImageDraw.Draw(canvas)
    x = px0 + 22
    baseline = py0 + 42
    for ch, width in zip(tagline, widths):
        draw.text((x, baseline), ch, font=font, fill=BRASS_LIGHT, anchor="ls")
        x += width + tracking

    # --- vignette + brass hairline frame -----------------------------------
    vignette = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vignette)
    for i in range(90):
        vd.rectangle((i, i, W - 1 - i, H - 1 - i), outline=255 - int(255 * i / 90) // 3, width=1)
    vignette = vignette.filter(ImageFilter.GaussianBlur(38))
    canvas = Image.composite(
        Image.new("RGBA", (W, H), (2, 7, 10, 255)), canvas, vignette.point(lambda v: v // 2)
    )

    draw = ImageDraw.Draw(canvas)
    inset = 16
    draw.rectangle((inset, inset, W - 1 - inset, H - 1 - inset), outline=BRASS + (215,), width=3)
    draw.rectangle((inset + 6, inset + 6, W - 7 - inset, H - 7 - inset), outline=(228, 197, 119, 70), width=1)
    tick = 26
    for cx, cy, dx, dy in (
        (inset, inset, 1, 1),
        (W - 1 - inset, inset, -1, 1),
        (inset, H - 1 - inset, 1, -1),
        (W - 1 - inset, H - 1 - inset, -1, -1),
    ):
        draw.line([(cx, cy), (cx + dx * tick, cy)], fill=BRASS_LIGHT + (235,), width=4)
        draw.line([(cx, cy), (cx, cy + dy * tick)], fill=BRASS_LIGHT + (235,), width=4)

    out = canvas.convert("RGB")
    target = PROMO / "og-image.png"
    out.save(target, format="PNG", optimize=True)

    size = target.stat().st_size
    # Keep the card under 400 KB. Dithering triples the compressed size of a
    # painted sky for no visible gain, so the palette comes without it.
    for colors in (256, 192, 160):
        if size <= 400_000:
            break
        quantized = out.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        quantized.save(target, format="PNG", optimize=True)
        size = target.stat().st_size
        print(f"quantized to {colors} colours: {size} bytes")

    print(f"wrote {target} ({size} bytes, {out.width}x{out.height})")


if __name__ == "__main__":
    main()
