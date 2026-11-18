# `/store-art/` — Buchstabenzeit store graphics

Google Play asks for two images that neither the app bundle nor the marketing pack
produces: the **512 px listing icon** and a **1024 × 500 feature graphic** per
language. Both are rendered here from the app's own artwork by
`tools/compose.py`, so they cannot drift from the icon and typeface that ship in
the build.

Nothing in this folder is served by the website and nothing is bundled into the
native shells. It sits outside `static/` and `www/` on purpose.

## Deliverables

| File | Size | Format | Upload to |
| --- | --- | --- | --- |
| `google-play/icon-512x512.png` | 512 × 512 | 32-bit PNG with alpha | Play Console → **App icon**. One file for every language. |
| `google-play/feature-graphic-de-1024x500.png` | 1024 × 500 | 24-bit PNG, no alpha | Play Console → **Feature graphic**, German listing. |
| `google-play/feature-graphic-en-1024x500.png` | 1024 × 500 | 24-bit PNG, no alpha | Play Console → **Feature graphic**, English listing. |

These are exactly the formats [Play's preview asset
guidelines](https://support.google.com/googleplay/android-developer/answer/9866151)
ask for, and `tests/store-art.test.mjs` pins them: the icon as an 8-bit RGBA PNG
of 512 × 512 under 1 MB, the feature graphics as 8-bit RGB PNGs of 1024 × 500
under 15 MB. The icon's alpha channel is fully opaque — the art is full-bleed and
the launchers and Play apply their own corner mask.

## Regenerate

```sh
python3 sites/lesen/store-art/tools/compose.py
```

Needs Pillow, `fontTools` and `brotli` in the active interpreter — the last two
so the app's woff2 typeface can be decompressed into a temporary directory. No
font binary is duplicated in this folder.

The script is deterministic: same master in, same three PNGs out. Re-run it after
changing the key art, the launcher icon or the titles, and re-run
`npm test` in `sites/lesen` before committing.

## How the files are made

**Icon.** A plain Lanczos downsample of `assets/icon-only.png`, the 1024 px art
the Android mipmaps and the iOS `AppIcon` are rendered from, with one mild unsharp
pass so 512 px does not look soft next to other listings. No rounding, no border,
no wordmark: Play and the launchers apply their own corner mask, and a baked-in
one would show up as a double-rounded tile.

**Feature graphic.** `source/key-art-3136x1344.png` — the text-free key art that
also feeds the App Store header — is cropped anchored right to Play's 2.048 : 1
banner and then downsampled. The right anchor keeps the alphabet blocks in frame
and the owl on the right, which leaves the left half clean for the title.
The title is set in **Grundschrift**, the app's own typeface, in the site palette:
headline 78 px in `#172f57`, subtitle 34 px in `#4a6080`, left margin 104 px.
`TITLE_SAFE_EDGE` stops a longer title from running into the owl.

The two lines carry the copy that was asked for, brand first and descriptor
second:

| Locale | Headline | Subtitle |
| --- | --- | --- |
| `de` | Buchstabenzeit | geführt lesen |
| `en` | Letter time | guided reading |

Play overlays the preview-video play button on the centre of the graphic and cuts
the outer edge off on some surfaces, so the owl and the book stay in the middle
and the title starts 10 % of the width in rather than hugging the frame.

> The English listing name is `Buchstabenzeit` in
> `marketing-pack/copy/en.md`; the English feature graphic reads *Letter time*
> because that title was requested. To align the two, change
> `FEATURE_GRAPHIC_COPY["en"]` and re-run the script.

## Provenance

`source/key-art-3136x1344.png` is generated artwork, committed here because
`uploads/` is not tracked: one of the 2026-11-13 header renders made with
`fal-ai/flux-1/schnell` through `tools/fal_image.py`, prompted against the mascot
and the app icon so the owl, the glasses and the palette stay on-model. Its file
name records the seed the model returned, `4711`. It carries no text — every word
in the deliverables is composited by the script — and it was not retouched by
hand. The same master produced the App Store header pair.

The two titles are literal copies of the list above, and the German one is
spelled the way the app and the listings spell it: **Buchstabenzeit**.

## Alt text for the upload dialog

Play asks for alt text per graphic. These are the strings used in
`marketing-pack/copy/`:

| Asset | Locale | Alt text |
| --- | --- | --- |
| Feature graphic | `de` | Die Eule mit blauer Brille und ein kleines gelbes Küken lesen gemeinsam in einem aufgeschlagenen Buch, daneben schweben Buchstabenwürfel. |
| Feature graphic | `en` | The owl in blue glasses and a small yellow fledgling read an open book together, with alphabet blocks floating beside them. |
| App icon | `de` | App-Icon: Das Gesicht der Eule mit blauer Brille vor blauen Strahlen, ein aufgeschlagenes Buch in den Flügeln. |
| App icon | `en` | App icon: the face of the owl in blue glasses against blue rays, an open book held in its wings. |

## Status

The app is not published yet. These files are ready for submission; the
submission itself, the price tier and the contact URLs remain owner actions.
