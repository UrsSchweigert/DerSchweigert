#!/usr/bin/env python3
"""Build the Buchstabenzeit marketing pack: portrait screenshots in both languages.

The stills are real app frames. This script serves the **app bundle** (`www/`,
built by `npm run copy-assets`) — not the website — drives the app through its
own UI in Chromium, and screenshots the five moments the stores need. Nothing is
retouched, no phone frame is composited in, and no text is drawn on top: both
stores require screenshots to show the app itself.

Output (all under `build/`, which is gitignored — the pack is generated):

  build/<locale>/app-store-6.1-portrait/*.png   1179x2556  App Store 6.1"/6.3" slot
  build/<locale>/google-play-9x16/*.png         1080x1920  Play Store screenshots
  build/<locale>/web/*.webp                     1179/600 px website and press crops
  build/<locale>/manifest.json                  sizes, captions, alt texts
  build/buchstabenzeit-marketing-pack.zip       the whole pack, ready to hand over

Requires `sites/lesen` dependencies installed (`npm ci`), Playwright with a
Chrome channel and Pillow in the active interpreter.

Usage:
  python3 sites/lesen/marketing-pack/tools/build.py
  python3 sites/lesen/marketing-pack/tools/build.py --locale de
  python3 sites/lesen/marketing-pack/tools/build.py --no-capture   # derive from existing PNGs
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import re
import socketserver
import subprocess
import sys
import threading
import zipfile
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve()
PACK = HERE.parents[1]
REPO = HERE.parents[4]
LESEN = REPO / "sites/lesen"
WEB_ROOT = LESEN / "www"
BUILD = PACK / "build"
COPY = PACK / "copy"

# preset -> (viewport in CSS px, device scale factor, folder in the pack, exact size)
PRESETS = {
    "appstore61": (
        {"width": 393, "height": 852}, 3, "app-store-6.1-portrait", (1179, 2556)
    ),
    "play": (
        {"width": 360, "height": 640}, 3, "google-play-9x16", (1080, 1920)
    ),
}
LOCALES = {"de": "de-DE", "en": "en-US"}
WEB_WIDTHS = (1179, 600)
WEB_QUALITY = 86
ZIP_NAME = "buchstabenzeit-marketing-pack.zip"

# How long a card stays on screen before the next one, so the parent report in
# the last shot shows a plausible practice time instead of a few milliseconds.
CARD_DWELL_MS = 900


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D102
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def build_bundle() -> None:
    print("Building sites/lesen/www ...", flush=True)
    subprocess.run(["npm", "run", "copy-assets"], cwd=LESEN, check=True)
    if not (WEB_ROOT / "index.html").exists():
        raise SystemExit("sites/lesen/www was not built correctly")


def open_page(browser, base_url: str, preset: str, locale: str):
    viewport, scale, _, _ = PRESETS[preset]
    page = browser.new_page(
        viewport=viewport,
        device_scale_factor=scale,
        locale=LOCALES[locale],
    )
    page.goto(f"{base_url}/index.html", wait_until="load")
    page.wait_for_function("document.documentElement.lang !== ''", timeout=15000)
    page.wait_for_timeout(700)
    select_language(page, locale)
    scroll_top(page)
    return page


def select_language(page, locale: str) -> None:
    if page.evaluate("document.documentElement.lang") == locale:
        return
    page.locator(f"#lang-{locale}").click()
    page.wait_for_function(
        f"document.documentElement.lang === {json.dumps(locale)}", timeout=10000
    )
    page.wait_for_timeout(500)


def scroll_top(page) -> None:
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(120)


def screenshot(page, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(target))
    print(f"  shot {target.name}", flush=True)
    return target


def card_text(page) -> str:
    return page.locator("#syllable").inner_text().strip()


def pick_card(page, *accepts, tries: int = 20) -> str:
    """Cycle the deck until a card matches the first predicate that ever matches.

    Each predicate gets its own pass, so a strict shape (a four-letter word) is
    tried first and a looser one catches decks that simply have none.
    """
    for accept in accepts:
        for _ in range(tries):
            text = card_text(page)
            if text and accept(text):
                return text
            page.locator("#retry").click()
            page.wait_for_timeout(160)
    raise RuntimeError(f"No matching card (last: {card_text(page)!r})")


def mark_correct(page, count: int) -> None:
    for _ in range(count):
        page.locator("#correct").click()
        page.wait_for_timeout(CARD_DWELL_MS)


def start_deck(page, mode: str) -> None:
    page.locator(f'input[name="mode"][value="{mode}"]').check()
    page.wait_for_timeout(150)
    page.locator("#start-button").click()
    page.wait_for_timeout(650)


def back_to_setup(page) -> None:
    if page.locator("#complete").is_visible():
        page.locator("#change-letters").click()
    else:
        # The practice screen returns to setup directly; the confirm dialog belongs
        # to the Android hardware back button.
        page.locator("#finish-early").click()
    page.wait_for_selector("#setup", state="visible", timeout=10000)
    page.wait_for_timeout(450)
    scroll_top(page)


def finish_deck(page) -> None:
    for _ in range(30):
        if page.locator("#complete").is_visible():
            break
        page.locator("#correct").click()
        page.wait_for_timeout(CARD_DWELL_MS)
    if not page.locator("#complete").is_visible():
        raise RuntimeError("The deck never reached the completion screen")
    page.wait_for_timeout(500)


SYLLABLE = re.compile(r"^[a-zäöüß]{2,3}$")
WORD = re.compile(r"^[A-Za-zÄÖÜäöüß]{4,}$")
SHORT_WORD = re.compile(r"^[A-Za-zÄÖÜäöüß]{3}$")


def capture_locale(p, base_url: str, preset: str, locale: str, out_dir: Path) -> list[Path]:
    _, _, _, expected = PRESETS[preset]
    browser = p.chromium.launch(channel="chrome", headless=True)
    produced: list[Path] = []
    try:
        page = open_page(browser, base_url, preset, locale)
        produced.append(screenshot(page, out_dir / "01-setup.png"))

        start_deck(page, "PATTERNS")
        mark_correct(page, 2)
        pick_card(page, lambda text: bool(SYLLABLE.match(text)))
        scroll_top(page)
        produced.append(screenshot(page, out_dir / "02-card-syllable.png"))

        back_to_setup(page)
        start_deck(page, "WORDS")
        mark_correct(page, 3)
        pick_card(page, lambda text: bool(WORD.match(text)),
                  lambda text: bool(SHORT_WORD.match(text)))
        scroll_top(page)
        produced.append(screenshot(page, out_dir / "03-card-word.png"))

        finish_deck(page)
        scroll_top(page)
        produced.append(screenshot(page, out_dir / "04-complete.png"))

        # The report lists every card ever practised, so it is captured after a
        # fresh start with a short deck: the dialog then fits on one screen instead
        # of scrolling under its own action bar. Progress and the language live in
        # localStorage, so clearing it is what "fresh install" means here.
        page.evaluate("localStorage.clear()")
        page.reload(wait_until="load")
        page.wait_for_timeout(700)
        select_language(page, locale)
        page.fill("#card-count", "4")
        start_deck(page, "PATTERNS")
        mark_correct(page, 3)
        page.locator("#retry").click()
        page.wait_for_timeout(CARD_DWELL_MS)
        back_to_setup(page)
        page.locator("#export-report").click()
        page.wait_for_selector("#report-dialog", state="visible", timeout=10000)
        page.wait_for_timeout(400)
        produced.append(screenshot(page, out_dir / "05-report.png"))
    finally:
        browser.close()

    for png in produced:
        with Image.open(png) as image:
            if image.size != expected:
                raise SystemExit(
                    f"{locale}/{preset}: {png.name} is {image.size[0]}x{image.size[1]}, "
                    f"expected {expected[0]}x{expected[1]}"
                )
    return produced


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


def load_captions() -> dict:
    return json.loads((COPY / "captions.json").read_text(encoding="utf-8"))


def build_locale(p, base_url: str, locale: str, captions: dict, capture: bool) -> dict:
    lang_dir = BUILD / locale
    (lang_dir / "web").mkdir(parents=True, exist_ok=True)

    entries = []
    for preset, (_, _, slot, size) in PRESETS.items():
        target_dir = lang_dir / slot
        if capture:
            print(f"\n== {locale} / {preset}", flush=True)
            capture_locale(p, base_url, preset, locale, target_dir)
        pngs = sorted(target_dir.glob("*.png"))
        if not pngs:
            raise SystemExit(f"{locale}/{slot}: no screenshots in {target_dir}")
        for png in pngs:
            with Image.open(png) as image:
                if image.size != size:
                    raise SystemExit(
                        f"{locale}/{slot}/{png.name} is {image.size[0]}x{image.size[1]}, "
                        f"expected {size[0]}x{size[1]}"
                    )
            shot = captions["shots"].get(png.stem, {}).get(locale, {})
            entries.append({
                "slot": slot,
                "file": f"{slot}/{png.name}",
                "width": size[0],
                "height": size[1],
                "bytes": png.stat().st_size,
                "caption": shot.get("caption", ""),
                "alt": shot.get("alt", ""),
            })

    web_preset = "appstore61" if "appstore61" in PRESETS else next(iter(PRESETS))
    web = []
    for png in sorted((lang_dir / PRESETS[web_preset][2]).glob("*.png")):
        web.extend(write_web(png, lang_dir / "web", png.stem))

    missing = [stem for stem in captions["order"]
               if not any(e["file"].endswith(f"{stem}.png") for e in entries)]
    if missing:
        raise SystemExit(f"{locale}: missing captures for {', '.join(missing)}")

    manifest = {
        "app": "Buchstabenzeit",
        "locale": locale,
        "generated_by": "sites/lesen/marketing-pack/tools/build.py",
        "capture_source": "sites/lesen/www (app bundle)",
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
        archive.write(PACK / "README.md", "README.md")
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
    parser.add_argument("--locale", action="append", choices=sorted(LOCALES),
                        help="language to build (repeatable, default: both)")
    parser.add_argument("--preset", action="append", choices=sorted(PRESETS),
                        help="screen shape to capture (repeatable, default: both)")
    parser.add_argument("--no-capture", action="store_true",
                        help="reuse the PNGs already in build/ instead of capturing")
    parser.add_argument("--no-build", action="store_true",
                        help="do not rebuild sites/lesen/www before capturing")
    parser.add_argument("--no-zip", action="store_true", help="skip the zip archive")
    args = parser.parse_args()

    if args.preset:
        selected = set(args.preset)
        for key in list(PRESETS):
            if key not in selected:
                del PRESETS[key]

    locales = args.locale or sorted(LOCALES)
    if not args.no_capture and not args.no_build:
        build_bundle()
    elif not args.no_capture and not (WEB_ROOT / "index.html").exists():
        raise SystemExit("sites/lesen/www is missing; run without --no-build first")

    if not args.no_capture:
        BUILD.mkdir(parents=True, exist_ok=True)
        server = socketserver.ThreadingTCPServer(
            ("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(WEB_ROOT))
        )
        base_url = f"http://127.0.0.1:{server.server_address[1]}"
        threading.Thread(target=server.serve_forever, daemon=True).start()
        print(f"Serving {WEB_ROOT} at {base_url}", flush=True)
    else:
        server = None
        base_url = ""

    captions = load_captions()
    try:
        with sync_playwright() as p:
            for locale in locales:
                build_locale(p, base_url, locale, captions, capture=not args.no_capture)
    finally:
        if server is not None:
            server.shutdown()

    if not args.no_zip:
        present = sorted({p.name for p in BUILD.iterdir() if p.is_dir()})
        write_zip(present)
    return 0


if __name__ == "__main__":
    sys.exit(main())
