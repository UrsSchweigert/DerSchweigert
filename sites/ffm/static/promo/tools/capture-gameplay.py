#!/usr/bin/env python3
"""Capture the five portrait gameplay stills used by the /promo/ filmstrip.

The page must show the *app* build, not the website, so this script serves
`mobile/www` (built by `npm run copy-assets`) and screenshots it in Chromium at
390x844 with a 3x device scale factor. No level is played by hand and no
campaign is completed: the target levels are opened from the app's own Levels
grid, and the combo is built by answering real questions through the DOM.

Captures are taken from a frozen frame. `requestAnimationFrame` is wrapped
before the game boots; once the requested action effect has played for the
requested time, the callback is dropped, so the screenshot shows exactly that
animation frame instead of racing a live canvas.

Requires:
  * `sites/ffm/mobile` dependencies installed (`npm ci`)
  * Playwright with a Chrome channel available to the active interpreter

Run:
  python3 sites/ffm/static/promo/tools/capture-gameplay.py
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
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright
from PIL import Image

HERE = Path(__file__).resolve()
REPO = HERE.parents[5]
WEB_ROOT = REPO / "sites/ffm/mobile/www"
MOBILE_DIR = REPO / "sites/ffm/mobile"
DEFAULT_OUT = REPO / "sites/ffm/static/promo/art/shots"
DEFAULT_SHOTS = REPO / "sites/ffm/promo-shots"

VIEWPORT = {"width": 390, "height": 844}
DEVICE_SCALE = 3
LOCALE = "de-DE"

# Seeded into the app's Capacitor Preferences backend so the bundle starts as a
# purchased install that has already seen the thank-you notice. `completed`
# holds every level so the Levels grid offers the five capture targets.
ENTITLEMENT = {
    "version": 1,
    "entitled": True,
    "product_id": "de.derschweigert.arithmoslayer.unlock",
    "transaction_id": None,
    "checked_at": "2026-11-13T00:00:00.000Z",
    "reason": "store_purchase",
}
PROFILES = {
    "version": 1,
    "activeProfileId": "promo-shot",
    "profiles": [{
        "id": "promo-shot",
        "name": "Spieler 1",
        "best": [],
        "history": [],
        "completed": list(range(1, 61)),
        "completions": {},
    }],
}
NOTICE = {
    "version": 1,
    "acknowledged": True,
    "acknowledged_at": "2026-11-13T00:00:00.000Z",
}

# The app bundle asks for `Capacitor.Plugins.Preferences`, which only exists in a
# native shell. This localStorage-backed shim keeps the real app adapter,
# entitlement check and progress store in the code path.
INIT_SCRIPT = """
window.Capacitor = { Plugins: { Preferences: {
  get: async (o) => ({ value: localStorage.getItem(o.key) }),
  set: async (o) => { localStorage.setItem(o.key, o.value); },
  remove: async (o) => { localStorage.removeItem(o.key); },
  keys: async () => ({ keys: Object.keys(localStorage) }),
} } };
""" + "".join(
    "localStorage.setItem(%s, %s);\n" % (json.dumps(key), json.dumps(json.dumps(value)))
    for key, value in [
        ("arithmoslayer:entitlement", ENTITLEMENT),
        ("arithmoslayer:profiles", PROFILES),
        ("arithmoslayer:first-open-notice", NOTICE),
    ]
) + """
localStorage.setItem('arithmoslayer:story-intro-open-shown', '1');
localStorage.setItem('ffm_locale', 'de');
localStorage.setItem('ffm_cookie_consent', 'declined');

(() => {
  const native = window.requestAnimationFrame.bind(window);
  let frozen = false;
  let timeGate = null;
  let timeOrigin = 0;
  let fxName = null;
  let fxGate = null;
  let fxOrigin = 0;

  window.__promoShot = {
    freezeAfter(ms) {
      timeOrigin = performance.now();
      timeGate = ms;
      fxName = null;
      fxGate = null;
      frozen = false;
    },
    freezeAfterFx(name, ms) {
      fxName = name;
      fxGate = ms;
      fxOrigin = 0;
      timeGate = null;
      frozen = false;
    },
    noteFx(name) {
      if (name === fxName && !fxOrigin) fxOrigin = performance.now();
    },
    get frozen() { return frozen; },
  };

  window.requestAnimationFrame = (cb) => native((ts) => {
    if (!frozen) {
      if (timeGate !== null && performance.now() - timeOrigin >= timeGate) frozen = true;
      else if (fxOrigin && fxGate !== null && performance.now() - fxOrigin >= fxGate) frozen = true;
    }
    if (frozen) return;
    cb(ts);
  });
})();
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D102
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def build_app_bundle() -> None:
    print("Building mobile/www ...", flush=True)
    subprocess.run(["npm", "run", "copy-assets"], cwd=MOBILE_DIR, check=True)
    if not (WEB_ROOT / "game/level-data.js").exists():
        raise SystemExit("mobile/www was not built correctly")


def answer_of(question: str) -> int:
    match = re.match(r"\s*(\d+)\s*([+\-×÷])\s*(\d+)", question)
    if not match:
        raise RuntimeError(f"Cannot parse question: {question!r}")
    a, operator, b = int(match.group(1)), match.group(2), int(match.group(3))
    return {"+": a + b, "-": a - b, "×": a * b, "÷": a // b}[operator]


def timer_value(page) -> float | None:
    try:
        return float(page.locator("#accessible-timer-progress").get_attribute("value"))
    except (TypeError, ValueError):
        return None


def wait_for_enabled_answers(page, timeout: int = 25_000) -> None:
    page.wait_for_selector("#mc-buttons .mc-btn:not([disabled])", timeout=timeout)


def wait_for_timer_window(page, low: float, high: float, timeout: float = 30.0) -> float:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = timer_value(page)
        if last is not None and low <= last <= high:
            return last
        page.wait_for_timeout(20)
    raise RuntimeError(f"Timer window {low}-{high} not reached (last value: {last})")


def answer_current_question(page) -> tuple[str, int]:
    question = page.locator("#active-question").inner_text()
    expected = answer_of(question)
    for button in page.locator("#mc-buttons .mc-btn").all():
        if button.inner_text().strip() == str(expected):
            button.click()
            return question, expected
    labels = page.locator("#mc-buttons .mc-btn").all_inner_texts()
    raise RuntimeError(f"No answer button for {question!r} (expected {expected}); buttons={labels}")


def patch_screen_fx(page) -> None:
    page.evaluate(
        """() => {
          const fx = window.ffmScreenFx;
          if (!fx || fx.__promoShotPatched) return false;
          const play = fx.play.bind(fx);
          fx.play = (effect, payload) => {
            try { window.__promoShot.noteFx(effect); } catch (_) {}
            return play(effect, payload);
          };
          fx.__promoShotPatched = true;
          return true;
        }"""
    )


def start_level(page, level: int, difficulty: str) -> None:
    page.wait_for_timeout(1200)
    page.locator("#title-levels-btn").click()
    page.wait_for_timeout(250)
    page.locator(f'#level-jump-grid .level-tile[data-level="{level}"]').click()
    page.wait_for_timeout(250)
    page.locator(f'#difficulty-select .diff-btn[data-difficulty="{difficulty}"]').click()
    try:
        page.locator("button.diorama__btn--skip").first.click(timeout=4000)
    except PlaywrightTimeout:
        pass
    wait_for_enabled_answers(page)
    print(f"  started level {level} ({difficulty})", flush=True)


def answer_warmups(page, count: int) -> None:
    for _ in range(count):
        wait_for_enabled_answers(page)
        wait_for_timer_window(page, 0.72, 1.0)
        answer_current_question(page)
    print(f"  combo after warm-up: {page.locator('#accessible-combo').inner_text()}", flush=True)


def arm_fx_freeze(page, effect: str, ms: int) -> None:
    # Must be armed before the answer that casts the spell: fireball and
    # lightning play their effect synchronously inside the click handler.
    page.evaluate(f"window.__promoShot.freezeAfterFx({json.dumps(effect)}, {ms})")


def arm_timer_freeze(page, ms: int) -> None:
    page.evaluate(f"window.__promoShot.freezeAfter({ms})")


def wait_frozen_and_screenshot(page, name: str, master_dir: Path) -> Path:
    page.wait_for_function("window.__promoShot.frozen", timeout=15000, polling=50)
    png = master_dir / f"{name}.png"
    page.screenshot(path=str(png))
    print(f"  froze -> {png.name}", flush=True)
    return png


def write_webp(png: Path, webp: Path) -> None:
    with Image.open(png) as image:
        image.convert("RGB").save(webp, "WEBP", quality=82, method=6)
    print(f"  wrote {webp.name} ({(webp.stat().st_size / 1024):.0f} KB)", flush=True)


def open_page(browser, base_url: str):
    page = browser.new_page(
        viewport=VIEWPORT,
        device_scale_factor=DEVICE_SCALE,
        locale=LOCALE,
    )
    page.add_init_script(INIT_SCRIPT)
    page.goto(f"{base_url}/index.html", wait_until="domcontentloaded")
    return page


def capture_action(p, base_url, master_dir, level, difficulty, warmups, name, effect, ms):
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = open_page(browser, base_url)
    start_level(page, level, difficulty)
    answer_warmups(page, warmups)
    patch_screen_fx(page)
    wait_for_timer_window(page, 0.45, 0.56)
    arm_fx_freeze(page, effect, ms)
    answer_current_question(page)
    png = wait_frozen_and_screenshot(page, name, master_dir)
    browser.close()
    return png


def capture_healing(p, base_url, master_dir):
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = open_page(browser, base_url)
    start_level(page, 40, "easy")

    question = page.locator("#active-question").inner_text()
    correct = answer_of(question)
    wrong = next(
        button for button in page.locator("#mc-buttons .mc-btn").all()
        if button.inner_text().strip() != str(correct)
    )
    wrong.click()
    wait_for_enabled_answers(page)

    canvas = page.locator("#game").bounding_box()
    page.mouse.move(canvas["x"] + canvas["width"] * 0.10, canvas["y"] + canvas["height"] * 0.5)
    page.mouse.down()
    deadline = time.time() + 14
    while time.time() < deadline:
        text = page.locator("#heal-progress").inner_text()
        match = re.search(r"(\d+)\s*%", text)
        if match and int(match.group(1)) >= 78:
            break
        page.wait_for_timeout(50)
    else:
        raise RuntimeError("Hold-to-heal never reached 78%")
    print(f"  healing at {text} (timer {timer_value(page):.2f})", flush=True)
    arm_timer_freeze(page, 0)
    png = wait_frozen_and_screenshot(page, "level-40-healing", master_dir)
    page.mouse.up()
    browser.close()
    return png


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="directory for the WebP page assets")
    parser.add_argument("--shots-dir", type=Path, default=DEFAULT_SHOTS,
                        help="tracked directory for the full-resolution PNG masters")
    parser.add_argument("--no-build", action="store_true", help="use the existing mobile/www bundle")
    parser.add_argument("--only", choices=["strike", "fireball", "blitz", "dragon", "heal"],
                        action="append", help="capture only these shots (repeatable)")
    args = parser.parse_args()

    if not args.no_build:
        build_app_bundle()
    elif not (WEB_ROOT / "index.html").exists():
        raise SystemExit("mobile/www is missing; run without --no-build first")

    args.out.mkdir(parents=True, exist_ok=True)
    args.shots_dir.mkdir(parents=True, exist_ok=True)
    server = socketserver.ThreadingTCPServer(
        ("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(WEB_ROOT))
    )
    base_url = f"http://127.0.0.1:{server.server_address[1]}"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"Serving {WEB_ROOT} at {base_url}", flush=True)

    shots = [
        ("strike", "level-01-strike", 1, "medium", 0, "heroStrike", 150),
        ("fireball", "level-10-fireball", 10, "medium", 5, "fireball", 700),
        ("blitz", "level-20-blitz", 20, "medium", 10, "lightning", 180),
        ("dragon", "level-30-dragon", 30, "medium", 20, "dragonFinisher", 1000),
    ]
    selected = set(args.only or [name for name, *_ in shots] + ["heal"])
    produced: list[Path] = []
    try:
        with sync_playwright() as p:
            for key, name, level, difficulty, warmups, effect, ms in shots:
                if key not in selected:
                    continue
                print(f"Capturing {name} ...", flush=True)
                produced.append(
                    capture_action(p, base_url, args.shots_dir, level, difficulty, warmups, name, effect, ms)
                )
            if "heal" in selected:
                print("Capturing level-40-healing ...", flush=True)
                produced.append(capture_healing(p, base_url, args.shots_dir))
    finally:
        server.shutdown()

    for png in produced:
        write_webp(png, args.out / f"{png.stem}.webp")
    print("Done.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
