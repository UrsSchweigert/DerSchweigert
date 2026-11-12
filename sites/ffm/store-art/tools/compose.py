#!/usr/bin/env python3
"""Composite the Arithmo Slayer store graphics from the two masters.

Inputs (committed, never edited by this script):
  ../source/header-master.png  1536x1024 text-free key art
  ../source/icon-master.png    1024x1024 text-free icon art
  ../../static/game/title-logo.webp   gold ARITHMO SLAYER wordmark (RGBA)

Outputs (sizes are the ones App Store Connect and Play Console actually offer):

  ../app-store/icon-1024x1024.png            24-bit RGB, no alpha, with the wordmark
  ../app-store/header-5244x2950.png          16:9   — Header slot, also valid for Search Results
  ../app-store/header-3840x1646.png          2.33:1 — Header slot, ultrawide alternative
  ../app-store/search-results-1920x1280.png  3:2    — Search Results slot, sharpest (least upscale)
  ../app-store/search-results-3840x2560.png  3:2    — Search Results slot, high-res
  ../google-play/feature-graphic-1024x500.png  24-bit PNG, no alpha
  ../google-play/icon-512x512.png            32-bit RGBA, alpha fully opaque (Play requires 32-bit)
  ../press/header-1920x1080.png              banner, NOT a store slot

Every wide creative is art + brass frame + a phone on the right showing the upper
half of the real title screen. None of them carries text: the store shows the app
name itself, and the phone supplies the identity. There is therefore one file per
size rather than one per locale.

App Store Connect's "Customize your app's product page … creative assets" panel
offers two tabs, one asset each ("0 of 1 Header Asset", "0 of 1 Search Results
Asset"). The sizes it lists are:

  Header        5244 x 2950 (16:9) | 3840 x 1646 (2.33:1)
  Search Results 5244 x 2950 (16:9) | 3840 x 2560 (3:2) | 1920 x 1280 (3:2)

5244x2950 is the only size valid in both tabs, so it is the primary deliverable
and the others are alternates for whichever tab prefers them. There is no
1920x1080 store slot on either platform; that file exists only under press/ for
banners, social previews and press kits, and must not be uploaded as a store
asset.

All the wide formats share one master: the aspect-ratio crop keeps the full
width and trims sky/foreground vertically, so the painted composition is never
squeezed. The artwork is full-bleed and never carries its own rounded corners —
both stores apply the mask themselves.

All wide formats get the forest-green vignette and the brass frame the app's own
title screen is built from, then the phone mockup, which is drawn after the frame
so the device runs out over the bottom border. Nothing carries text, so Play's
advice against repeating the icon's branding in the feature graphic is satisfied
by the whole set rather than by that one file.

Everything ships as 24-bit PNG with no alpha channel, which is what both
consoles accept. Note the asymmetry in the caps: Play limits the **app icon** to
1024 KB but sets no file-size limit on the feature graphic, and Apple publishes
no per-file cap for creative assets. PNG is the larger format at these pixel
counts (the 5244 px file is ~17 MB); if a console ever rejects it, the 1920x1280
search-result creative is the smallest at ~4.1 MB.

Usage:
  python3 sites/ffm/store-art/tools/compose.py
  python3 sites/ffm/store-art/tools/compose.py --preview   # 50% preview copies
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent.parent.parent
MASTER_HEADER = ROOT / "source" / "header-master.png"
MASTER_ICON = ROOT / "source" / "icon-master.png"
LOGO = REPO / "sites" / "ffm" / "static" / "game" / "title-logo.webp"
PHONE_SCREENSHOT = ROOT / "source" / "screenshot-gameplay.png"

APP_STORE = ROOT / "app-store"
GOOGLE_PLAY = ROOT / "google-play"
PRESS = ROOT / "press"

# Near-black device body; reads as a phone without inventing a brand.
PHONE_BEZEL = (18, 20, 24)

# The app's own CSS custom properties (static/styles.css, :root). The frame and
# the vignette below use these exact values, so the store art and the title
# screen are literally the same palette rather than a lookalike.
INK_950 = (9, 20, 17)  # --ink-950 #091411
FOREST_850 = (24, 53, 45)  # --forest-850 #18352d
BRASS = (196, 154, 72)  # --brass #c49a48
BRASS_LIGHT = (228, 197, 119)  # --brass-light #e4c577
IVORY = (243, 234, 214)  # --ivory #f3ead6

# The scrim covers the icon's reserved wordmark band, so it has to be the same
# ink green the artwork sinks into — not the blue it was before the re-grade.
SCRIM = INK_950


def crop_to_aspect(img: Image.Image, aspect: float, top_bias: float) -> Image.Image:
    """Crop to `aspect` (w/h) at full width, trimming height around `top_bias`."""
    width, height = img.size
    keep = round(width / aspect)
    if keep >= height:
        return img
    slack = height - keep
    top = round(slack * top_bias)
    return img.crop((0, top, width, top + keep))


def resize(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """LANCZOS resize, with the sharpen strength scaled to the enlargement.

    The App Store creative assets need the 1536 px master at 1920-5244 px wide,
    so the same one-size unsharp mask would either under-sharpen the 1.25x
    variant or ring badly on the 3.4x one.
    """
    factor = size[0] / img.width
    out = img.resize(size, Image.LANCZOS)
    if factor > 1.02:
        radius, percent = (1.6, 55) if factor < 1.6 else (2.0, 60) if factor < 2.6 else (2.2, 62)
        out = out.filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=2))
    return out


def load_logo() -> Image.Image:
    return Image.open(LOGO).convert("RGBA")


# The app's own tagline: `hero.title` from static/promo/promo.js, used verbatim as
# the site <title>, the og:title and the hero headline. Both strings are inside
# Apple's 30-character subtitle field, so the in-art subtitle matches the store's
# own metadata field instead of inventing a second claim.
SUBTITLES = {
    "de": "KOPFRECHNEN FÜR JUNG UND ALT",  # promo.js hero.title.de
    "en": "MENTAL MATH FOR YOUNG AND OLD",  # promo.js hero.title.en
}

# Same stack the promo OG image uses to set that tagline (render-og.py), so the
# store art and the social card are typographically identical.
FONT_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Andale Mono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
)


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def tracked_text(text: str, font, tracking: int) -> tuple[list[int], int]:
    """Advance widths per glyph and the total width once `tracking` is added."""
    widths = [font.getbbox(char)[2] - font.getbbox(char)[0] for char in text]
    return widths, sum(widths) + tracking * (len(text) - 1)


def place_logo(
    canvas: Image.Image,
    logo: Image.Image,
    width_fraction: float,
    center_x: float,
    top: float,
    shadow: int = 18,
) -> int:
    """Draw the wordmark with a soft dark halo; return its bottom edge in px."""
    target_width = round(canvas.width * width_fraction)
    target_height = round(target_width * logo.height / logo.width)
    mark = logo.resize((target_width, target_height), Image.LANCZOS)

    x = round(canvas.width * center_x - target_width / 2)
    y = round(canvas.height * top)

    halo = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    alpha = mark.getchannel("A").point(lambda v: int(v * 0.55))
    silhouette = Image.new("RGBA", mark.size, (4, 9, 26, 255))
    silhouette.putalpha(alpha)
    halo.paste(silhouette, (x, y))
    halo = halo.filter(ImageFilter.GaussianBlur(shadow))

    canvas.alpha_composite(halo)
    canvas.alpha_composite(mark, (x, y))
    return y + target_height


def place_subtitle(
    canvas: Image.Image,
    text: str,
    width_fraction: float,
    center_x: float,
    top: int,
    colour: tuple[int, int, int] = IVORY,
    plate: bool = True,
    tracking_ratio: float = 0.09,
) -> None:
    """Tracked, wide-set brass caps under the wordmark, sized to a width target.

    Brass lettering straight onto the sky disappears the moment it crosses a lit
    cloud or the hero's hair, so by default the tagline sits on the same ink
    plate with a brass hairline that the promo OG image uses for this exact line
    (static/promo/tools/render-og.py). That keeps it legible at the sizes the
    store actually displays, and reuses the app's own chip language rather than
    inventing a second one. `plate=False` falls back to a soft halo.
    """
    target = canvas.width * width_fraction
    size = max(8, round(canvas.height * 0.032))
    tracking = round(size * tracking_ratio)
    font = load_font(size)
    widths, total = tracked_text(text, font, tracking)

    # One proportional step lands close; a second refines it for the font's
    # hinting, so the subtitle reliably matches the width of the block above.
    for _ in range(2):
        size = max(8, round(size * target / max(total, 1)))
        tracking = round(size * tracking_ratio)
        font = load_font(size)
        widths, total = tracked_text(text, font, tracking)

    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x = canvas.width * center_x - total / 2
    # "la" anchors the ascender line, so `top` is the visual top of the caps and
    # the block never rides up into the wordmark above it.
    for char, advance in zip(text, widths):
        draw.text((x, top), char, font=font, fill=(*colour, 255), anchor="la")
        x += advance + tracking

    if plate:
        # Take the plate from the real ink bounds rather than from the font's
        # metrics, so tracking and letter shapes determine the padding.
        box = layer.getbbox()
        assert box is not None, "empty subtitle"
        pad_x, pad_y = round(size * 0.80), round(size * 0.52)
        rect = (box[0] - pad_x, box[1] - pad_y, box[2] + pad_x, box[3] + pad_y)
        radius = round(size * 0.30)
        width = max(2, round(size * 0.055))
        backdrop = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        bd = ImageDraw.Draw(backdrop)
        bd.rounded_rectangle(rect, radius=radius, fill=(*INK_950, 242), outline=(*BRASS, 225), width=width)
        inner = (rect[0] + width * 2, rect[1] + width * 2, rect[2] - width * 2, rect[3] - width * 2)
        bd.rounded_rectangle(inner, radius=max(1, radius - width * 2), outline=(*BRASS_LIGHT, 58), width=1)
        canvas.alpha_composite(backdrop)
    else:
        halo = layer.filter(ImageFilter.GaussianBlur(max(2, round(size * 0.34))))
        silhouette = Image.new("RGBA", canvas.size, (4, 9, 26, 255))
        silhouette.putalpha(halo.getchannel("A").point(lambda v: int(v * 0.88)))
        canvas.alpha_composite(silhouette)

    canvas.alpha_composite(layer)


def bottom_scrim(canvas: Image.Image, start: float, strength: float) -> None:
    """Darken the lower band so a wordmark stays legible over busy art."""
    height = canvas.height
    band_top = round(height * start)
    veil = Image.new("RGBA", (1, height - band_top), (0, 0, 0, 0))
    draw = ImageDraw.Draw(veil)
    span = veil.height
    for row in range(span):
        alpha = int(255 * strength * (row / max(span - 1, 1)) ** 1.35)
        draw.point((0, row), fill=(*SCRIM, alpha))
    canvas.alpha_composite(veil.resize((canvas.width, span), Image.BILINEAR), (0, band_top))


def forest_vignette(
    canvas: Image.Image, scale: float, forest: float = 0.46, ink: float = 0.20
) -> None:
    """Sink the edges into the app's deep forest green.

    Mirrors the vignette in static/promo/tools/render-og.py, but tinted with
    --forest-850/--ink-950 instead of near-black, which is what gives the store
    art the title screen's green cast instead of a generic dark border.
    """
    width, height = canvas.size
    depth = round(90 * scale)
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    for i in range(depth):
        shade = 255 - int(255 * i / depth) // 3
        draw.rectangle((i, i, width - 1 - i, height - 1 - i), outline=shade, width=1)
    mask = mask.filter(ImageFilter.GaussianBlur(38 * scale))
    # Two passes: forest green bleeding in, then a thinner ink-green core, so the
    # very corners reach --ink-950 while the middle band stays green.
    for colour, weight in ((FOREST_850, forest), (INK_950, ink)):
        canvas.alpha_composite(
            Image.composite(
                Image.new("RGBA", (width, height), (*colour, 255)),
                Image.new("RGBA", (width, height), (0, 0, 0, 0)),
                mask.point(lambda v, w=weight: int(v * w)),
            )
        )


def brass_frame(canvas: Image.Image, scale: float) -> None:
    """Draw the brass double hairline with corner ticks the title screen uses."""
    width, height = canvas.size
    inset = max(6, round(10 * scale))
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rectangle((inset, inset, width - 1 - inset, height - 1 - inset), outline=(*BRASS, 215), width=max(1, round(2 * scale)))
    inner = inset + max(3, round(4 * scale))
    draw.rectangle(
        (inner, inner, width - 1 - inner, height - 1 - inner), outline=(*BRASS_LIGHT, 70), width=1
    )
    tick = round(26 * scale)
    stroke = max(1, round(3 * scale))
    for cx, cy, dx, dy in (
        (inset, inset, 1, 1),
        (width - 1 - inset, inset, -1, 1),
        (inset, height - 1 - inset, 1, -1),
        (width - 1 - inset, height - 1 - inset, -1, -1),
    ):
        draw.line([(cx, cy), (cx + dx * tick, cy)], fill=(*BRASS_LIGHT, 235), width=stroke)
        draw.line([(cx, cy), (cx, cy + dy * tick)], fill=(*BRASS_LIGHT, 235), width=stroke)


def base_creative(width: int, height: int, top_bias: float = 0.42) -> Image.Image:
    """The expensive part: crop, upscale and grade. Reused across locales."""
    master = Image.open(MASTER_HEADER).convert("RGB")
    cropped = crop_to_aspect(master, width / height, top_bias=top_bias)
    canvas = resize(cropped, (width, height)).convert("RGBA")
    forest_vignette(canvas, min(width, height) / 500)
    return canvas


def add_lockup(
    canvas: Image.Image,
    logo: dict | None = None,
    subtitle: dict | None = None,
    center: bool = True,
) -> None:
    """Stamp the wordmark and the localised tagline onto a graded canvas.

    `subtitle` is laid out relative to the wordmark's bottom edge, so the two
    never collide however the logo is sized.

    With `center` the block is drawn on a scratch layer first and then placed by
    its own painted bounds, so the wordmark and plate end up exactly centred —
    horizontally and vertically — no matter how the two differ in size. That
    matters because the App Store does not show the asset as authored: it
    centre-crops it to fit the product-page header, which eats the top and
    bottom of the frame. A lockup anchored near the top edge loses the top of
    the wordmark, which is exactly what shipped the first time.
    """
    if not logo and not subtitle:
        return

    scale = min(canvas.width, canvas.height) / 500
    target = Image.new("RGBA", canvas.size, (0, 0, 0, 0)) if center else canvas

    logo_spec = dict(logo) if logo else None
    if logo_spec and center:
        # Start well inside the layer so the blurred halo is not clipped before
        # the bounding box is measured.
        logo_spec["top"] = 0.06

    logo_bottom = None
    if logo_spec:
        logo_bottom = place_logo(target, load_logo(), shadow=round(20 * scale), **logo_spec)

    if subtitle:
        spec = dict(subtitle)
        gap = spec.pop("gap", 0.030)
        top = round(logo_bottom + canvas.height * gap) if logo_bottom else round(canvas.height * spec.pop("top", 0.2))
        place_subtitle(target, spec.pop("text", ""), **spec, top=top)

    if center:
        box = target.getbbox()
        assert box is not None, "empty lockup"
        block = target.crop(box)
        canvas.alpha_composite(block, ((canvas.width - block.width) // 2, (canvas.height - block.height) // 2))


def phone_mockup(body_width: int, supersample: int = 3) -> Image.Image:
    """A portrait phone body showing a real in-game portrait screenshot.

    A genuine capture of the running game (German build, so it matches the
    German store listing), not the title screen and not a crop: a cropped or
    title-only screen made the device read wide and square, so a viewer could not
    tell what playing the app looks like. Drawn at `supersample`x and reduced, so
    the bezel and corner radii are smooth rather than stair-stepped at store
    resolution.
    """
    src = Image.open(PHONE_SCREENSHOT).convert("RGB")
    upper = src

    bezel = max(2, round(body_width * 0.038))
    radius = round(body_width * 0.135)
    screen_w = body_width - 2 * bezel
    screen_h = round(upper.height * screen_w / upper.width)
    body_h = screen_h + 2 * bezel

    big_w, big_h = body_width * supersample, body_h * supersample
    b, r = bezel * supersample, radius * supersample
    sw, sh = screen_w * supersample, screen_h * supersample

    body = Image.new("RGBA", (big_w, big_h), (0, 0, 0, 0))
    ImageDraw.Draw(body).rounded_rectangle((0, 0, big_w - 1, big_h - 1), radius=r, fill=(*PHONE_BEZEL, 255))

    screen = upper.resize((sw, sh), Image.LANCZOS)
    mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh - 1), radius=max(1, r - b), fill=255)
    body.paste(screen, (b, b), mask)
    return body.resize((body_width, body_h), Image.LANCZOS)


# Where the in-game play area ends, as a fraction of the screenshot's height.
# Measured from source/screenshot-gameplay.png: the pixel-art level runs from
# about 8 % to the floor at 37.4 %, and the answer grid sits below it.
PLAY_AREA_FLOOR = 0.3742

# Fraction of the phone body taken by the bezel on each side.
BEZEL_RATIO = 0.038


def add_phone(
    canvas: Image.Image,
    width_fraction: float,
    right_margin: float,
    floor: float = PLAY_AREA_FLOOR,
    shadow_alpha: int = 78,
    shadow_blur: float = 0.030,
    shadow_offset: float = 0.012,
) -> None:
    """Place the phone on the right, cut off exactly at the play-area floor.

    `width_fraction` is the share of the canvas width the device occupies — the
    honest control for "how large is it" — and the height follows from the
    screenshot's aspect. The device is then anchored so the floor of the in-game
    play area lands on the canvas' bottom edge: the viewer sees the HUD and the
    level itself, and the device leaves the frame where the game's ground ends
    rather than at an arbitrary crop. Call this after brass_frame() so the
    device breaks the border it crosses.
    """
    src = Image.open(PHONE_SCREENSHOT).convert("RGB")
    ratio = src.width / src.height

    body_w = round(canvas.width * width_fraction)
    bezel = max(2, round(body_w * BEZEL_RATIO))
    screen_w = body_w - 2 * bezel
    screen_h = screen_w / ratio
    body_h = round(screen_h + 2 * bezel)

    phone = phone_mockup(body_w)

    x = round(canvas.width - canvas.width * right_margin - body_w)
    # Put the floor line on the bottom edge of the canvas.
    y = round(canvas.height - bezel - floor * screen_h)

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    silhouette = Image.new("RGBA", phone.size, (6, 10, 18, shadow_alpha))
    silhouette.putalpha(phone.getchannel("A").point(lambda v: int(v * shadow_alpha / 255)))
    shadow.paste(silhouette, (x, round(y + canvas.height * shadow_offset)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(2, round(canvas.height * shadow_blur))))

    canvas.alpha_composite(shadow)
    canvas.alpha_composite(phone, (x, y))


def creative(
    width: int,
    height: int,
    logo: dict | None = None,
    subtitle: dict | None = None,
    phone: dict | None = None,
    top_bias: float = 0.42,
) -> Image.Image:
    """A wide store creative: key-art crop edged in the app's green-and-brass.

    `top_bias` picks where the vertical trim lands (0 = keep the top sky,
    1 = keep the foreground); the full width is always preserved.
    """
    canvas = base_creative(width, height, top_bias)
    add_lockup(canvas, logo, subtitle)
    brass_frame(canvas, min(width, height) / 500)
    if phone:
        # After the frame, so the device exits over the brass border at the
        # bottom instead of being contained by it.
        add_phone(canvas, **phone)
    return canvas


def icon(size: int, logo_width: float, logo_top: float, scrim: float) -> Image.Image:
    master = Image.open(MASTER_ICON).convert("RGB")
    canvas = resize(master, (size, size)).convert("RGBA")
    # Lighter than the wide formats: an icon is seen at 48 px, where the stores
    # mask the corners anyway, so this is only enough to share the green cast.
    forest_vignette(canvas, size / 500, forest=0.30, ink=0.10)
    if scrim:
        bottom_scrim(canvas, start=logo_top - 0.13, strength=scrim)
    place_logo(canvas, load_logo(), logo_width, center_x=0.5, top=logo_top, shadow=round(size * 0.02))
    return canvas


def save(img: Image.Image, path: Path, alpha: bool = False) -> None:
    """Write the store file. `alpha` keeps a real (opaque) alpha channel."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # Compression level 9 costs a few seconds on the 5244 px creative and is
    # worth it: painterly gradient sky is exactly what PNG handles worst.
    img.convert("RGBA" if alpha else "RGB").save(path, "PNG", optimize=True, compress_level=9)
    print(f"{path.relative_to(REPO)}  {img.width}x{img.height}  {path.stat().st_size / 1024:.0f} KiB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--preview", action="store_true", help="also write 50%% JPEG previews next to the outputs")
    args = parser.parse_args()

    # Google Play caps the icon at 1024 KB and demands a 32-bit PNG, so it keeps
    # an alpha channel even though every pixel is opaque.
    #
    # The wide creatives carry no text at all. The artwork's own composition puts
    # the clash in the middle, and the app's identity is carried by the phone on
    # the right showing a real in-game portrait capture — so there is no wordmark
    # or tagline to localise, and one file per size serves every store language.
    # The device is cut off where the play area's floor meets the bottom edge.
    phone = dict(width_fraction=0.45, right_margin=0.045)
    # Shorter formats have less room, so the device takes proportionally less width.
    wide_phone = dict(width_fraction=0.30, right_margin=0.030)

    # name, width, height, top_bias, phone placement
    slots = [
        ("header", 5244, 2950, 0.42, phone),
        ("header", 3840, 1646, 0.42, wide_phone),
        ("search-results", 1920, 1280, 0.0, phone),
        ("search-results", 3840, 2560, 0.0, phone),
    ]

    outputs = [
        (creative(w, h, phone=spec, top_bias=bias), APP_STORE / f"{name}-{w}x{h}.png", False)
        for name, w, h, bias, spec in slots
    ]

    outputs += [
        (creative(1024, 500, phone=wide_phone), GOOGLE_PLAY / "feature-graphic-1024x500.png", False),
        (icon(1024, logo_width=0.76, logo_top=0.588, scrim=0.82), APP_STORE / "icon-1024x1024.png", False),
        (icon(512, logo_width=0.76, logo_top=0.588, scrim=0.82), GOOGLE_PLAY / "icon-512x512.png", True),
        # Not a store slot on either platform: a banner for the website, social
        # previews and press kits.
        (creative(1920, 1080, phone=phone), PRESS / "header-1920x1080.png", False),
    ]

    for image, path, alpha in outputs:
        save(image, path, alpha)
        if args.preview:
            preview = image.convert("RGB")
            preview.thumbnail((preview.width // 2, preview.height // 2), Image.LANCZOS)
            preview.save(path.with_suffix(".preview.jpg"), "JPEG", quality=88)


if __name__ == "__main__":
    main()
