# `/marketing-pack/` — Buchstabenzeit store pack

Portrait app screenshots in German and English, ready for the App Store and
Google Play, plus the listing copy that goes with them.

Nothing in this folder is served by the website and nothing is bundled into the
native shells. The folder holds the recipe (this README, `copy/`, `tools/`); the
images are generated on demand into `build/`, which is gitignored.

## Build the pack

```sh
python3 sites/lesen/marketing-pack/tools/build.py
```

The script serves the **app bundle** (`sites/lesen/www`, built by
`npm run copy-assets`), drives the app through its own UI in Chromium and
screenshots five moments per language and screen shape:

| Output | Size | Upload to |
| --- | --- | --- |
| `build/<lang>/app-store-6.1-portrait/*.png` | 1179 × 2556 | App Store Connect → iPhone 6.1"/6.3" display. Five files per language. |
| `build/<lang>/google-play-9x16/*.png` | 1080 × 1920 | Play Console → Phone screenshots. Play only accepts 16:9 … 9:16, so this is a separate capture. |
| `build/<lang>/web/*.webp` | 1179 px and 600 px wide | Landing pages, press kit, Open Graph cards. |
| `build/<lang>/manifest.json` | — | Per-file dimensions, byte size, caption and alt text. |
| `build/buchstabenzeit-marketing-pack.zip` | — | Everything above plus this README and `copy/`, ready to hand over. |

Options: `--locale de|en` (repeatable, default both), `--preset appstore61|play`
(repeatable), `--no-capture` (rebuild derivatives from PNGs already in `build/`),
`--no-build` (reuse the existing `www/` bundle), `--no-zip`.

Requires the same environment as the site tooling: `npm ci` in `sites/lesen`,
Playwright with Chrome, and Pillow in the active interpreter.

## What the screenshots are

Real frames from the installed app's web bundle — not mock-ups, not composites.
The script clicks through the app exactly like an adult would:

| File | Screen | How it is reached |
| --- | --- | --- |
| `01-setup.png` | Selection screen | App start |
| `02-card-syllable.png` | Reading card, syllable | Patterns deck, two cards marked, a lower-case syllable selected |
| `03-card-word.png` | Reading card, word | Words deck, three cards marked, a word of four or more letters selected |
| `04-complete.png` | Completion screen | The rest of the deck marked correct |
| `05-report.png` | Parent report | `Bericht` / `Report` in the footer |

The language is the app's own: the German set is read from the German UI, the
English set after tapping the Union Jack. Cards are drawn at random, so the
script cycles the deck until the wanted card shape appears instead of retouching
a screenshot. Cards stay on screen for a moment before the next click so the
report in the last shot shows a plausible practice time.

No phone frame is composited in and no text is drawn on top: both stores require
screenshots to show the app itself.

## `copy/`

| File | Contents |
| --- | --- |
| `copy/de.md` | German listing fields with real character counts, screenshot captions, social posts, press boilerplate, fact sheet. |
| `copy/en.md` | The same in English. |
| `copy/captions.json` | Captions and alt texts per shot and language; `tools/build.py` reads it to fill `manifest.json`. |

Both files are grounded in `sites/lesen/docs/store-listing.md`, the approved
listing drafts, so the pack cannot claim more than the product does: optional
read-aloud only with an installed voice, reminders only behind the adult gate,
the free browser version stated plainly, no advertising, analytics or tracking.

## Store icon and feature graphic

Play wants two images this pack does not produce: the 512 px listing icon and a
1024 × 500 feature graphic per language. They are rendered from the app's own
artwork by `sites/lesen/store-art/tools/compose.py`; see
`sites/lesen/store-art/README.md` for the sizes, the titles and the upload slots.

## Uploading

App Store Connect: **App Store → Screenshots → iPhone 6.1"/6.3" display**. Upload
the PNGs in filename order. Apple caps screenshots at ten per set; five keeps the
set short. The v1 listing is German, so use the `de` set there; the `en` set is
for Play and for a later App Store localisation.

Play Console: **Grow → Store presence → Main store listing → Phone screenshots**.
Play accepts 2–8 screenshots per language, so either upload all five or drop the
report shot.

## Status

The app is not published yet. These assets are prepared for submission; price
tier, contact URLs and the submission itself remain owner actions.

## Provenance

Every image is a capture of the running app produced by the committed tool; no
generated model and no hand retouching. Changing the app's UI means re-running
the build — the pack is never edited by hand.
