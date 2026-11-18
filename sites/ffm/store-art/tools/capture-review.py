#!/usr/bin/env python3
"""Capture app-bundle screens (mobile/www) for the Campaign II purchase review.

Build the bundle first (`cd sites/ffm/mobile && npm ci && npm run copy-assets`), then:

  python3 sites/ffm/store-art/tools/capture-review.py sites/ffm/mobile/www OUT_DIR en paywall

LOCALE is en or de; SCENE is players | paywall | title. The default viewport 414x896 at
3x gives 1242x2688 PNGs; convert them to JPEG for store-art/review/. UPTO=n seeds a player
who has cleared levels 1..n (default 60, which also reveals the campaign switch; the
reveal flag is set anyway). Needs Playwright with the Chrome channel.
"""
import functools, http.server, json, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

www, out, locale, scene = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4]
width = int(sys.argv[5]) if len(sys.argv) > 5 else 414
height = int(sys.argv[6]) if len(sys.argv) > 6 else 896
out.mkdir(parents=True, exist_ok=True)
PID = 'review-player'
name = 'Spieler 1' if locale == 'de' else 'Player 1'
ENT = {"version": 1, "entitled": True, "product_id": "arithmoslayer_full_unlock",
       "transaction_id": "t-full", "checked_at": "2026-11-18T00:00:00.000Z", "reason": "store_purchase"}
PROFILES = {"version": 1, "activeProfileId": PID, "profiles": [{
    "id": PID, "name": name, "best": [], "history": [], "completed": list(range(1, int(__import__("os").environ.get("UPTO", "60")) + 1)), "completions": {}}]}
NOTICE = {"version": 1, "acknowledged": True, "acknowledged_at": "2026-11-18T00:00:00.000Z"}
seed = {
    "arithmoslayer:entitlement": ENT,
    "arithmoslayer:profiles": PROFILES,
    "arithmoslayer:first-open-notice": NOTICE,
}
init = """
window.Capacitor = { Plugins: {
  Preferences: {
    get: async (o) => ({ value: localStorage.getItem(o.key) }),
    set: async (o) => { localStorage.setItem(o.key, o.value); },
    remove: async (o) => { localStorage.removeItem(o.key); },
    keys: async () => ({ keys: Object.keys(localStorage) }),
  },
  // A store account that owns the full unlock but not Campaign II. No price is
  // reported, so the app shows its generic buy label instead of an invented amount.
  NativePurchases: {
    getProduct: async () => ({ product: null }),
    getPurchases: async () => ({ purchases: [{ productIdentifier: 'arithmoslayer_full_unlock', transactionId: 't-full' }] }),
    purchaseProduct: async () => { throw new Error('cancelled'); },
    restorePurchases: async () => {},
    acknowledgePurchase: async () => {},
  },
} };
""" + "".join("localStorage.setItem(%s, %s);\n" % (json.dumps(k), json.dumps(json.dumps(v))) for k, v in seed.items()) + f"""
localStorage.setItem('arithmoslayer:story-intro-open-shown', '1');
localStorage.setItem('arithmoslayer:genius:{PID}', '1');
localStorage.setItem('ffm_locale', '{locale}');
"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


handler = functools.partial(Quiet, directory=str(www))
with socketserver.TCPServer(("127.0.0.1", 0), handler) as httpd:
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=3,
                                  locale='de-DE' if locale == 'de' else 'en-US', is_mobile=True, has_touch=True)
        ctx.add_init_script(init)
        page = ctx.new_page()
        page.on("console", lambda m: m.type == "error" and print("console:", m.text))
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_timeout(2500)
        if scene in ("players", "paywall"):
            page.locator("#title-family-btn").click()
            page.wait_for_timeout(800)
            page.locator("#genius-campaign-btn").scroll_into_view_if_needed()
            page.wait_for_timeout(400)
        if scene == "paywall":
            page.locator("#genius-campaign-btn").click()
            page.wait_for_selector(".paywall-card", timeout=5000)
            page.wait_for_timeout(600)
        target = out / f"{scene}-{locale}-{width * 3}x{height * 3}.png"
        page.screenshot(path=str(target))
        print(target)
        browser.close()
    httpd.shutdown()
