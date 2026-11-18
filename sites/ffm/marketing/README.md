# `/marketing/` — Arithmo Slayer marketing pack

Landscape app screenshots in German and English, ready for the App Store, Google
Play and the website, plus the store copy that goes with them.

Nothing in this folder is served by the website or bundled into the Capacitor
app. The folder holds the recipe (this README, `copy/`, `tools/`); the images
are generated on demand into `build/`, exactly like `../store-art/`.

## Build the pack

```sh
python3 sites/ffm/marketing/tools/build.py
```

The script drives `sites/ffm/static/promo/tools/capture-gameplay.py` — the same
tool that produced the portrait `/promo/` filmstrip — once per language and
screen shape, then files the result:

| Output | Size | Upload to |
| --- | --- | --- |
| `build/<lang>/app-store-6.1-landscape/*.png` | 2556 × 1179 | App Store Connect → iPhone 6.1"/6.3" display (landscape). Five files per language. |
| `build/<lang>/google-play-16x9/*.png` | 1920 × 1080 | Play Console → Phone screenshots. Play rejects anything wider than 16:9, so this is a separate capture, not the App Store file cropped. |
| `build/<lang>/web/*.webp` | 1600 px and 800 px wide | Landing pages, press kit, Open Graph cards. Derived from the landscape master. |
| `build/<lang>/manifest.json` | — | Per-file dimensions, byte size, caption and alt text. |
| `build/arithmoslayer-marketing-pack.zip` | — | Everything above plus this README and `copy/`, ready to hand over. |

Options: `--locale de|en` (repeatable, default both), `--no-capture` (rebuild the
derivatives from PNGs already in `build/`), `--no-build` (reuse the existing
`mobile/www` bundle), `--no-zip`.

## What the screenshots are

Real frames from the **app bundle** (`mobile/www`, built by `npm run copy-assets`),
not the website and not a mock-up. Each still is a frozen animation frame: the
capture tool wraps `requestAnimationFrame` before the game boots, plays the level
through the app's own DOM (level grid → difficulty → real answers), and stops the
frame loop once the requested effect has played for a few hundred milliseconds.
Nothing is retouched, no phone frame is composited in, and no text is drawn on
top — the stores require the screenshots to show the app itself.

| Shot | Level | Moment |
| --- | --- | --- |
| `level-01-strike` | 1 | melee strike |
| `level-10-fireball` | 10 | fireball in flight |
| `level-20-blitz` | 20 | lightning ball mid-flight |
| `level-30-dragon` | 30 | the dragon's ice breath |
| `level-40-healing` | 40 | hold-to-heal at 78 % |

The language is the app's own (`ffm_locale`), seeded before boot, so the German
stills show German HUD labels and the English stills show English ones. The
seeded profile is a purchased install with every level cleared, which is why the
level grid offers the five capture targets.

Landscape stages are shorter than portrait ones, so the freeze timings differ per
preset (`FX_FREEZE_MS` in `capture-gameplay.py`): the fiend's question bubble sits
in the projectile's path and has to stay readable.

## `copy/`

| File | Contents |
| --- | --- |
| `copy/de.md` | German store listing (App Store Connect fields, Play fields) with real character counts, screenshot captions, social posts, press boilerplate and fact sheet. |
| `copy/en.md` | The same in English. |
| `copy/captions.json` | Captions and alt texts per shot and language; read by `tools/build.py` to fill `manifest.json`, and the single place to edit them. |

The German caption and alt values are the ones the `/promo/` page already uses
(`static/promo/promo.js`, `static/promo/index.html`), so the filmstrip, the store
listing and the press kit cannot drift apart.

## Uploading

App Store Connect: **App Store → Screenshots → iPhone 6.1"/6.3" display**. Upload
the PNGs in filename order. That slot accepts exactly four sizes — 2556 × 1179,
1179 × 2556, 2622 × 1206 and 1206 × 2622 — and the pack ships the first. For the
2622 × 1206 variant set `APP_STORE_PRESET = "phone63"` in `tools/build.py` and
re-run the capture; nothing else has to change. Apple caps screenshots at ten per
set; five keeps the set short and leaves room to add the level-clear and title
screens later.

Play Console: **Grow → Store presence → Main store listing → Phone screenshots**.
Play accepts 2–8 screenshots per language, so either upload all five or drop the
healing shot. The 16:9 set is also what the Play feature-graphic area expects to
sit next to; the feature graphic itself lives in `../store-art/`.

## Provenance

Every image is a capture of the running game, produced by the committed tool with
a seeded app state; there is no generated model and no hand retouching. Changing
the app's HUD or art means re-running the build — the pack is never edited by
hand.
