# `/store-art/` — Arithmo Slayer store graphics

The source masters for the App Store and Play Store graphics, plus the compositor
that turns them into uploadable files. Nothing in this folder is served by the
website or bundled into the Capacitor app, so it must stay out of
`sites/ffm/static/`.

**Only the masters and the compositor are checked in.** The store-sized
deliverables are generated on demand — they are large, and one of them is
reproducible from the other nine only by running the recipe below. Regenerate
before uploading.

The one deliverable that *is* committed is `app-store/icon-1024x1024.png`,
because it is also the source for the app's launcher icons:
`sites/ffm/mobile/scripts/render-icons.py` renders the Android mipmaps and the
iOS `AppIcon` from it, so the installed app and both store listings show one
artwork. See `sites/ffm/mobile/README.md`, "Launcher icons".

## Inputs

| File | Size | Note |
| --- | --- | --- |
| `source/header-master.png` | 1536×1024 | Text-free key art. Feeds every wide creative. |
| `source/icon-master.png` | 1024×1024 | Text-free icon art. Feeds both store icons. |
| `source/screenshot-gameplay.png` | 1410×3060 | Real portrait gameplay, captured from the running game. The phone mockup in every wide creative shows the top of this. |

The two icons are square, full-bleed and **not** rounded: Play and iOS both apply
their own corner mask, and a baked-in mask would show up as a double-rounded or
letterboxed tile.

`icon-master.png` and `header-master.png` carry no text and no wordmark. The
wordmark is composited on from `static/game/title-logo.webp`, so a logo change
does not mean regenerating the art.

## Regenerate

```sh
python3 sites/ffm/store-art/tools/compose.py            # every deliverable
python3 sites/ffm/store-art/tools/compose.py --preview  # + 50 % preview copies
```

The script needs Pillow. It is deterministic: same masters in, byte-comparable
art out. For each wide creative it crops the master to the target aspect at full
width, trims sky and foreground vertically, upsamples with LANCZOS plus one
unsharp pass whose strength scales with the enlargement factor, sinks the edges
into the app's forest green, draws the brass frame, and composites the phone on
the right so it exits over the bottom border.

Re-running it must leave `app-store/icon-1024x1024.png` byte-identical, because
the launcher icons are rendered from that exact file. If the icon changes, run
`python3 sites/ffm/mobile/scripts/render-icons.py --check` before committing.

## App Store Connect — "creative assets"

App Store Connect's *Customize your app's product page and how it appears in App
Store search results using creative assets* panel has two tabs, each accepting
**one** asset ("0 of 1 Header Asset", "0 of 1 Search Results Asset"). The upload
dialog lists these sizes:

| Tab | Offered sizes |
| --- | --- |
| **Header** | 5244 × 2950 (16:9) · 3840 × 1646 (2.33:1) |
| **Search Results** | 5244 × 2950 (16:9) · 3840 × 2560 (3:2) · 1920 × 1280 (3:2) |

`5244 × 2950` is the only size valid in **both** tabs, so it is the one to upload
if you want a single file for both. If no Search Results asset is added, App
Store Connect falls back to your app previews and screenshots.

The wide creatives carry no text at all. No wordmark, no tagline — the app's
identity comes from the phone on the right showing the real title screen, and the
composition puts the clash in the middle. Because there is nothing to translate,
one file per size serves every store language.

| File | Size | Format | Upload to |
| --- | --- | --- | --- |
| `app-store/header-5244x2950.png` | 5244×2950 | PNG, no alpha | **Header** tab — and also valid in **Search Results**. Primary deliverable. |
| `app-store/header-3840x1646.png` | 3840×1646 | PNG, no alpha | **Header** tab, ultrawide alternative. |
| `app-store/search-results-1920x1280.png` | 1920×1280 | PNG, no alpha | **Search Results**. Native 3:2 crop, only a 1.25× upscale, so the sharpest of the set. |
| `app-store/search-results-3840x2560.png` | 3840×2560 | PNG, no alpha | **Search Results**, high-resolution 3:2 alternative. |
| `app-store/icon-1024x1024.png` | 1024×1024 | 24-bit PNG, no alpha | App icon. **Committed** — see above. |

## Google Play Console

| File | Size | Format | Upload to |
| --- | --- | --- | --- |
| `google-play/icon-512x512.png` | 512×512 | **32-bit** PNG, alpha opaque | Store listing → App icon. Play uses it on the listing, in search results and in top charts. |
| `google-play/feature-graphic-1024x500.png` | 1024×500 | PNG, no alpha | Store listing → Feature graphic, i.e. the header banner. Same treatment: art, brass frame, phone. |

## Not a store slot

| File | Size | Format | Use |
| --- | --- | --- | --- |
| `press/header-1920x1080.png` | 1920×1080 | 24-bit PNG | **Do not upload as a store asset** — 1920×1080 is not an offered size on either platform. It is a banner for the website, social previews and press kits. |

## Provenance

Every master must be traceable to an approved generator — see
[PROVENANCE.md](./PROVENANCE.md) and `static/story/ART-BIBLE.md`, "Approved
generators (licensing)". FLUX.1 [dev] is never allowed on this paid product.
