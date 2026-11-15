#!/usr/bin/env python3
"""Build the Arithmo Slayer marketing pack: landscape screenshots in both languages.

The stills are real app frames. This script does not redraw or retouch anything:
it drives `static/promo/tools/capture-gameplay.py` (which plays the app bundle in
Chromium and freezes the requested animation frame) and then files the PNGs into
the folder layout the two stores expect.

Output (all under `build/`, which is gitignored — the pack is generated, not
checked in):

  build/<locale>/app-store-6.1-landscape/*.png   2556x1179  App Store 6.1"/6.3" slot
  build/<locale>/google-play-16x9/*.png          1920x1080  Play Store screenshots
  build/<locale>/web/*.webp                      1600/800 px website + social crops
  build/<locale>/manifest.json                   sizes, captions, alt texts
  build/arithmoslayer-marketing-pack.zip         the whole pack, ready to hand over

Requires the same environment as the capture script: `sites/ffm/mobile` installed
(`npm ci`), Playwright and Pillow in the active interpreter, Chrome available.

Usage:
  python3 sites/ffm/marketing/tools/build.py              # capture + derive + zip
  python3 sites/ffm/marketing/tools/build.py --no-capture # derive from existing PNGs
  python3 sites/ffm/marketing/tools/build.py --locale de  # one language only
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve()
MARKETING = HERE.parents[1]
REPO = HERE.parents[4]
CAPTURE = REPO / "sites/ffm/static/promo/tools/capture-gameplay.py"
WEB_ROOT = REPO / "sites/ffm/mobile/www"
BUILD = MARKETING / "build"
COPY = MARKETING / "copy"

# App Store Connect only offers the iPhone 6.1"/6.3" display on a new record,
# with four accepted screenshot sizes: 2556x1179, 1179x2556, 2622x1206 and
# 1206x2622. The pack ships the first (iPhone 15 Pro, landscape); switch
# APP_STORE_PRESET to "phone63" for 2622x1206.
APP_STORE_PRESET = "phone61"

# preset -> (folder in the pack, exact pixel size the store expects)
SLOTS = {
    APP_STORE_PRESET: ("app-store-6.1-landscape", (2556, 1179)),
    "wide": ("google-play-16x9", (1920, 1080)),
}
WEB_WIDTHS = (1600, 800)
WEB_QUALITY = 82
ZIP_NAME = "arithmoslayer-marketing-pack.zip"


def run_capture(preset: str, locale: str, png_dir: Path, webp_dir: Path, build_bundle: bool) -> None:
    cmd = [sys.executable, str(CAPTURE), "--preset", preset, "--locale", locale,
           "--shots-dir", str(png_dir), "--out", str(webp_dir)]
    if not build_bundle:
        cmd.append("--no-build")
    print(f"\n== {locale} / {preset}", flush=True)
    subprocess.run(cmd, check=True, cwd=REPO)


def load_captions() -> dict:
    return json.loads((COPY / "captions.json").read_text(encoding="utf-8"))


def write_web(png: Path, out_dir: Path, stem: str) -> list[dict]:
    files = []
    with Image.open(png) as image:
        for width in WEB_WIDTHS:
            height = round(image.height * width / image.width)
            target = out_dir / f"{stem}-{width}.webp"
            image.convert("RGB").resize((width, height), Image.LANCZOS).save(
                target, "WEBP", quality=WEB_QUALITY, method=6
            )
            files.append({"file": target.name, "width": width, "height": height,
                          "bytes": target.stat().st_size})
    return files


def build_locale(locale: str, captions: dict, capture: bool, build_bundle: bool) -> dict:
    lang_dir = BUILD / locale
    lang_dir.mkdir(parents=True, exist_ok=True)
    (lang_dir / "web").mkdir(exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_png = Path(tmp) / "png"
        tmp_webp = Path(tmp) / "webp"
        if capture:
            for preset in SLOTS:
                run_capture(preset, locale, tmp_png / preset, tmp_webp / preset, build_bundle)
        masters = {
            preset: sorted((tmp_png / preset).glob("*.png"))
            if capture else sorted((lang_dir / slot).glob("*.png"))
            for preset, (slot, _) in SLOTS.items()
        }

        entries = []
        for preset, (slot, size) in SLOTS.items():
            target_dir = lang_dir / slot
            target_dir.mkdir(exist_ok=True)
            for png in masters[preset]:
                with Image.open(png) as image:
                    if image.size != size:
                        raise SystemExit(
                            f"{locale}/{preset}: {png.name} is {image.size[0]}x{image.size[1]}, "
                            f"expected {size[0]}x{size[1]}"
                        )
                target = target_dir / png.name
                if capture:
                    shutil.copy2(png, target)
                shot = captions["shots"].get(png.stem, {}).get(locale, {})
                entries.append({
                    "slot": slot,
                    "file": f"{slot}/{png.name}",
                    "width": size[0],
                    "height": size[1],
                    "bytes": target.stat().st_size,
                    "caption": shot.get("caption", ""),
                    "alt": shot.get("alt", ""),
                })

        web = []
        for png in masters[APP_STORE_PRESET]:
            web.extend(write_web(png, lang_dir / "web", png.stem))

    missing = [stem for stem in captions["order"]
               if not any(e["file"].endswith(f"{stem}.png") for e in entries)]
    if missing:
        raise SystemExit(f"{locale}: missing captures for {', '.join(missing)}")

    manifest = {
        "app": "Arithmo Slayer",
        "locale": locale,
        "generated_by": "sites/ffm/marketing/tools/build.py",
        "capture_tool": "sites/ffm/static/promo/tools/capture-gameplay.py",
        "screenshots": entries,
        "web": web,
    }
    (lang_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"{locale}: {len(entries)} screenshots, {len(web)} web files", flush=True)
    return manifest


def write_zip(locales: list[str]) -> Path:
    target = BUILD / ZIP_NAME
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(MARKETING / "README.md", "README.md")
        for doc in sorted(COPY.glob("*.md")):
            archive.write(doc, f"copy/{doc.name}")
        archive.write(COPY / "captions.json", "copy/captions.json")
        for locale in locales:
            for path in sorted((BUILD / locale).rglob("*")):
                if path.is_file():
                    archive.write(path, str(path.relative_to(BUILD)))
    print(f"\nPack: {target} ({target.stat().st_size / (1024 * 1024):.1f} MB)", flush=True)
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--locale", action="append", choices=["de", "en"],
                        help="language to build (repeatable, default: both)")
    parser.add_argument("--no-capture", action="store_true",
                        help="reuse the PNGs already in build/ instead of capturing")
    parser.add_argument("--no-build", action="store_true",
                        help="do not rebuild mobile/www before capturing")
    parser.add_argument("--no-zip", action="store_true", help="skip the zip archive")
    args = parser.parse_args()

    locales = args.locale or ["de", "en"]
    build_bundle = not args.no_build

    if not args.no_capture and build_bundle and not WEB_ROOT.exists():
        raise SystemExit("mobile/www is missing; run without --no-build, or `npm ci` in sites/ffm/mobile")

    captions = load_captions()
    for locale in locales:
        build_locale(locale, captions, capture=not args.no_capture, build_bundle=build_bundle)

    if not args.no_zip:
        write_zip(sorted(set(locales) | {p.name for p in BUILD.iterdir() if p.is_dir()}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
