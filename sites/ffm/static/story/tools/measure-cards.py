#!/usr/bin/env python3
"""Measure every story card with the real player CSS in headless Chromium.

The cards carry the whole story, so each one must fit the smallest screens the
game runs on. This opens preview.html for every scene and locale at each
viewport, seeks to every card and checks the rendered card:

* no line runs past the card (scrollWidth <= clientWidth),
* the card stays inside the landscape box the scene is laid out in and below
  the Skip button,
* the card covers at most MAX_SHARE of the box, so the scene stays visible
  (the letterboxed phone frame has the screen below the band for it instead).

  python3 sites/ffm/static/story/tools/measure-cards.py ROOT [--shots DIR]

ROOT is the folder that holds story/: sites/ffm/static (web) or
sites/ffm/mobile/www (the app bundle, after npm run copy-assets). The bundle
does not ship preview.html, so the web copy is served in its place. Prints one
JSON line per viewport and exits non-zero when any card fails. Needs Playwright
(pip install playwright; it uses the installed Chrome, else
Playwright's Chromium).
"""
import functools
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

PREVIEW = Path(__file__).resolve().parent.parent / 'preview.html'
# (label, width, height, framed): the phones the game supports at their
# smallest, a landscape phone, and the web's 390x844 desktop phone frame.
VIEWPORTS = [
    ('320x568', 320, 568, False),
    ('390x844', 390, 844, False),
    ('568x320', 568, 320, False),
    ('844x390', 844, 390, False),
    ('phone-frame-390x844', 390, 844, True),
]
MAX_SHARE = 0.42

MEASURE = """() => {
  const root = document.querySelector('.diorama');
  const card = root.querySelector('.diorama__subtitle');
  const controls = root.querySelector('.diorama__controls');
  return {
    text: card.textContent,
    title: card.classList.contains('is-title'),
    turned: root.classList.contains('is-turned'),
    letterboxed: root.classList.contains('is-letterboxed'),
    compact: root.classList.contains('is-compact'),
    boxW: root.offsetWidth, boxH: root.offsetHeight,
    top: card.offsetTop, height: card.offsetHeight, width: card.offsetWidth,
    scrollW: card.scrollWidth, clientW: card.clientWidth,
    scrollH: card.scrollHeight, clientH: card.clientHeight,
    controlsBottom: controls.offsetTop + controls.offsetHeight,
    fontSize: parseFloat(getComputedStyle(card).fontSize),
  };
}"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(root):
    handler = functools.partial(QuietHandler, directory=str(root))
    server = socketserver.TCPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def check(m, framed):
    problems = []
    if m['scrollW'] > m['clientW'] + 1:
        problems.append('a line runs past the card')
    if m['scrollH'] > m['clientH'] + 1:
        problems.append('text is clipped')
    if m['top'] < m['controlsBottom'] + 4:
        problems.append('card reaches the Skip button')
    if m['top'] + m['height'] > m['boxH']:
        problems.append('card runs off the screen')
    if not framed and m['height'] > MAX_SHARE * m['boxH']:
        problems.append(f"card covers {m['height'] / m['boxH']:.0%} of the scene")
    return problems


def main():
    root = Path(sys.argv[1]).resolve()
    shots = Path(sys.argv[sys.argv.index('--shots') + 1]) if '--shots' in sys.argv else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    index = json.loads((root / 'story/scenes/index.json').read_text())
    server = serve(root)
    base = f'http://127.0.0.1:{server.server_address[1]}/story/'
    failures = 0
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel='chrome')
        except Exception:  # no installed Chrome: Playwright's own Chromium
            browser = p.chromium.launch()
        for label, width, height, framed in VIEWPORTS:
            page = browser.new_page(viewport={'width': width, 'height': height}, device_scale_factor=2)
            # The app bundle has no preview.html: serve the web copy for it.
            page.route('**/story/preview.html', lambda route: route.fulfill(
                status=200, content_type='text/html', body=PREVIEW.read_text()))
            worst = {'height': 0}
            for entry in index['scenes']:
                scene = json.loads((root / f"story/scenes/{entry['id']}/scene.json").read_text())
                for lang in ('en', 'de'):
                    frame = '&frame=1' if framed else ''
                    page.goto(f"{base}preview.html?scene={entry['id']}&lang={lang}&t=0{frame}")
                    page.wait_for_selector('html[data-ready="1"]')
                    page.evaluate('document.fonts.ready')
                    for number, cue in enumerate(scene['subtitles']):
                        mid = (cue['start'] + cue['end']) / 2
                        page.evaluate(f'window.__diorama.seek({mid})')
                        page.wait_for_function("document.querySelector('.diorama__subtitle.is-visible')")
                        page.wait_for_timeout(500)
                        m = page.evaluate(MEASURE)
                        problems = check(m, framed)
                        if m['height'] > worst['height']:
                            worst = {**m, 'scene': entry['id'], 'lang': lang, 'card': number}
                        if problems:
                            failures += 1
                            print(f"FAIL {label} {entry['id']} {lang} card {number}: {', '.join(problems)}"
                                  f" ({m['height']}px of {m['boxH']}px) {m['text']!r}")
                        if shots and entry['id'] == 'act-2' and number == 2:
                            page.screenshot(path=str(shots / f'card-{label}-{lang}.png'))
                        if shots and entry['id'] == 'act-2' and number == 4 and lang == 'en' and label == '568x320':
                            page.screenshot(path=str(shots / f'card-bold-{label}-{lang}.png'))
                        if shots and entry['id'] == 'finish' and number in (0, 7) and lang == 'de' and label == '568x320':
                            page.screenshot(path=str(shots / f'finish-{number}-{label}-{lang}.png'))
            print(json.dumps({
                'viewport': label, 'box': [worst.get('boxW'), worst.get('boxH')],
                'turned': worst.get('turned'), 'letterboxed': worst.get('letterboxed'),
                'fontSize': worst.get('fontSize'), 'tallestCard': worst.get('height'),
                'share': round(worst.get('height', 0) / max(1, worst.get('boxH') or 1), 3),
                'at': f"{worst.get('scene')} {worst.get('lang')} card {worst.get('card')}",
            }))
            page.close()
        browser.close()
    server.shutdown()
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
