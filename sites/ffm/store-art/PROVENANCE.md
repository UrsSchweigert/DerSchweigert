# Store art provenance

Every image under `sites/ffm/store-art/` must be traceable to an approved
generator (see `sites/ffm/static/story/ART-BIBLE.md`, "Approved generators
(licensing)"). FLUX.1 [dev] is never allowed on this paid product.

## source/

Two text-free paintings, generated 2026-11-12 with the `image_generation` tool
(the tool does not report its model; the GPT image model used for the intro
pilot and the promo hero figures is the approved equivalent). Both were prompted
against an existing reference image so the new art stays on-model with the title
screen instead of drifting.

| File | Size | Reference images passed in | Date |
| --- | --- | --- | --- |
| `source/header-master.png` | 1536×1024 | `static/game/title-art-wide.webp`, then its own previous render, then `static/game/fiend-sprites/{set1-04,set1-09,set2-06,dragon-3}.png`, then its own previous render twice more for the re-composition and the moon/castle move below | 2026-11-12 |
| `source/icon-master.png` | 1024×1024 | `mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` (the shipped app icon), then its own previous render plus `source/header-master.png` as the grade target | 2026-11-12 |

`source/header-master.png` is the third and final render of three chained
generations, each one editing the previous output and nothing else:

1. **Key art** — the moonlit valley, prompted against `title-art-wide.webp`.
2. **Fiends** — the same painting plus a swarm entering from the right, prompted
   against the four in-game fiend sprites so the dragon, magma golem, goblin and
   beholder match the shapes the player actually fights. Instructions were
   explicit that the left half, the moon and the castle must not move, and that
   the sprites had to be repainted as painted creatures in the painting's own
   style — no pixel art pasted into a painted scene.
3. **Colour grade** — the same painting re-graded to the app's title-screen
   palette (forest green land, brass-gold rim light, blue moon core kept), with
   the composition explicitly frozen.

4. **Re-composition for the store letterbox** — the earlier paintings spread the
   hero, the castle and the fiends toward the edges, which left the middle of the
   frame empty. App Store Connect does not show the asset as authored: it
   centre-crops it to a wide letterbox, so the edges it discards were exactly
   where the subjects were, and the banner read as empty sky and valley. The
   composition was repainted with the hero and the dragon confronting each other
   on the horizontal centre line, the supporting fiends clustered around that
   clash, and the left and right columns reduced to expendable forest and sky.
5. **Moon and castle moved behind the clash** — the floating castle and the blue
   moon moved from the top-left corner to the upper centre so they sit behind the
   confrontation instead of being cropped away, with the vacated corner filled
   with the same starry sky and distant islands.

The pre-re-composition painting is kept as `handoff/arithmo-slayer-keyart-master-v1.png`
so the earlier full-vista composition can be compared or restored.

Each step kept the art text-free, so the wordmark stays a composite step and can
be re-sized, moved or dropped without another generation.

`source/icon-master.png` is two generations:

1. **Icon art** — prompted against the shipped `AppIcon-512@2x.png` so the icon
   does not drift from the build's own launcher icon.
2. **Colour grade** — the same icon re-graded against `header-master.png` as the
   target, so the icon, the feature graphic and the header share one palette.
   Composition, pose, sword and the reserved lower band were frozen, and the
   brief asked for gold rim light on every lit edge with green in the cloud
   field, while the moon and castle stay luminous blue.

Quoted from the icon grade prompt: *"the cloak itself becomes midnight-blue shot
through with deep forest green"*, *"gold and green should alternate across the
icon"*, *"keep the bottom quarter a calm, dark forest-green-to-ink-green gradient
band with no detail, reserved for a wordmark"*.

The wordmark scrim in `tools/compose.py` was also retargeted: it used to be the
old icon's blue corner colour `#0b1533` and is now `--ink-950` `#091411`, so the
band the wordmark sits on is the same ink green the artwork sinks into.

Both prompts asked for the art with **no text, no letters and no logo**, and for
a calm band of sky (header) or darker lower band (icon) reserved for the
wordmark. That is why the wordmark can be re-composited, re-sized or dropped
later without another generation.

Prompt subjects, in short: the hero on a moonlit cliff with the crystal sword
engraved `+ − × ÷`, the floating castle against the blue moon, the moonlit
valley, drifting golden arithmetic glyphs and crystal-blue magic ribbons —
palette midnight blue `#1d2f6b`, slate blue `#4f6fa8`, brass gold `#c9a24a`,
crimson `#b3262d`, crystal blue glow `#7fd4ff`.

## Deliverables

`app-store/`, `google-play/` and `press/` are deterministic composites of
`source/` plus `static/game/title-logo.webp`. They are generated on demand with
`tools/compose.py` and are **not** checked in — the exception is
`app-store/icon-1024x1024.png`, which stays committed because the Android and iOS
launcher icons are rendered from it. **No generated model is involved**
in that step: `tools/compose.py` (Pillow) crops to the store aspect ratio,
upscales with LANCZOS and one unsharp pass, sinks the edges into the app's
forest-green palette, places the existing wordmark with a blurred dark halo
where one is wanted and, on the icons, a bottom scrim, then draws the brass
double hairline with corner ticks. Licence position of the wordmark is unchanged,
because it is the same RGBA WebP the title screen has always used.

The frame and vignette colours are not new: they are the `--forest-850`,
`--ink-950`, `--brass` and `--brass-light` values from `static/styles.css`. The
compositor keeps its own copies of them, so a palette change in the CSS and the
matching constants in `tools/compose.py` belong in the same commit.

| File | Derived from | Tool | Date |
| --- | --- | --- | --- |
| `app-store/icon-1024x1024.png` | `source/icon-master.png` + `title-logo.webp` | `tools/compose.py` | 2026-11-12 |
| `app-store/header-5244x2950.png` | `source/header-master.png` + the phone mockup showing `source/screenshot-gameplay.png`, **no wordmark or tagline** | `tools/compose.py` | 2026-11-12 |
| `app-store/header-3840x1646.png` | same | `tools/compose.py` | 2026-11-12 |
| `app-store/search-results-1920x1280.png` | same | `tools/compose.py` | 2026-11-12 |
| `app-store/search-results-3840x2560.png` | same | `tools/compose.py` | 2026-11-12 |
| `google-play/icon-512x512.png` | `source/icon-master.png` + `title-logo.webp` | `tools/compose.py` | 2026-11-12 |
| `google-play/feature-graphic-1024x500.png` | `source/header-master.png` + the phone mockup, **no wordmark**, same treatment as the App Store creatives | `tools/compose.py` | 2026-11-12 |
| `press/header-1920x1080.png` | `source/header-master.png` + the phone mockup | `tools/compose.py` | 2026-11-12 |

## The phone mockup

The wide creatives show a **real in-game portrait screenshot** on a portrait
device: `source/screenshot-gameplay.png` (1410×3060). No generated model is
involved and no screenshot is fabricated — it is a capture of the running web
game, taken in the German build to match the German-only v1 listing: HUD
(`Herzen`, `Zeit`, `Serie`, `Punkte`, `Besiegt`, `Feuerball`, `Heilen`), a live
question, the level art and the answer buttons.

How it was captured, so it can be redone when the UI changes:

1. `python3 -m http.server` in `sites/ffm/static`, then load `/index.html`.
2. A 470×1020 portrait viewport at `deviceScaleFactor: 3`, locale `de-DE`,
   `localStorage.ffm_locale = 'de'`.
3. Decline the cookie notice, choose the **Mittel** (medium) difficulty, wait for
   a question, skip the level narration, then screenshot.

`tools/compose.py` draws the bezel and corner radii as vector shapes around that
capture and adds a blurred drop shadow — it is a frame around real UI, not a
mock-up of UI that does not exist. There is no dynamic island; the device is
deliberately plain so it does not compete with the game screen.

The device is anchored so the play-area floor (`PLAY_AREA_FLOOR = 0.3742`, the
row where the pixel-art level ends and the answer grid begins) sits on the bottom
edge of the canvas. That number is measured from this capture, so it must be
re-measured if the in-game layout changes.

The screenshot is taken from gameplay rather than the title screen on purpose:
the title screen shows a `DE`/`EN` button naming the language you would switch
*to*, so on a German screen it reads `EN` and contradicts the German text beside
it. That button is hidden during gameplay, so the phone carries no language
indicator that could disagree with what it shows.

## Text in the artwork

Two kinds of text appear in the deliverables, and both come from the repository,
not from a generator:

* **Wordmark** — `static/game/title-logo.webp`, the RGBA WebP the title screen
  has always used. Licence position unchanged.
* **Tagline** — `hero.title` from `static/promo/promo.js`, in both languages:
  `KOPFRECHNEN FÜR JUNG UND ALT` (de) and `MENTAL MATH FOR YOUNG AND OLD` (en).
  Set in the same font stack the promo OG image uses for this line (Andale Mono,
  falling back to Menlo, then Courier New Bold), tracked at 0.09 em, in
  `--ivory` on an `--ink-950` plate (alpha 242) with a `--brass` hairline. No new
  copy is invented. Ivory rather than brass is a legibility decision: the brass
  tone sat too close to the luminance of the lit clouds, where ivory measures
  15.3:1 against the plate.

## Downstream: launcher icons

`app-store/icon-1024x1024.png` is not only uploaded — `sites/ffm/mobile/scripts/render-icons.py`
reads it at build time and derives every Android mipmap and the iOS `AppIcon`
from it. Those derivatives add no new artwork and no generated content: they are
resizes of this same file, plus one circular mask for `ic_launcher_round.png`.
Provenance therefore flows from the two generated masters recorded above.

`press/header-1920x1080.png` is not a store asset. 1920×1080 is not an offered
size in either console; it exists for banners, social previews and press kits.

The hero design follows the ART-BIBLE character sheet where the reference art
allowed it: golden-blonde tousled hair, crimson scarf, midnight-blue hooded
cloak with a brass plus-sign clasp, and a slender straight sword with the four
arithmetic signs engraved down the blade. The two paintings keep the reference
image's own linework and rendering style, which is the anime key-art style of
`title-art-wide.webp`, not the paper-cutout style used inside the story scenes.
