# Level background style spec

Every level background is checked against this list before it is accepted. The
values below were measured from the six shipped stage backgrounds in the parent
directory (`../stage-1.webp` through `../stage-6.webp`, all 1536x1024) and are
the target for the 60 per-level `level-<NN>.webp` images described in
PROMPTS.md and listed in manifest.json.

## Canvas

- Output resolution: **1536x1024** (16:9), the same frame as the shipped
  `stage-N.webp` backgrounds.
- Display width: **800px**. The level background is drawn 800 CSS pixels wide
  and scaled by the renderer, so detail must read cleanly at that width.

## Framing

- Visible band: **y 80-944**. Keep the subject and the horizon inside this
  vertical band; anything above y 80 or below y 944 may be cropped.
- Landmark safe box: **x 120-1416**. The level's landmark sits inside this
  horizontal box so it survives narrow displays.
- Empty ground plane: the **lower 35-50%** of the frame is an empty ground
  plane — plain ground with no landmark and no detail the player must read.
- Strong vignette: darken the frame edges so the landmark reads as the focal
  point.

## Technique

- One-point perspective: a single vanishing point on the horizon behind the
  landmark.
- Ordered dithering: colour transitions use ordered (Bayer-style) dithering on
  a fixed pixel grid, never smooth gradients or random noise dithering.
- Colour ramps: each palette uses **3-5 step** ramps (3 to 5 discrete tones per
  hue), matching the banded look of the shipped stage art.
- No characters, no text or lettering, no UI, and no frame or border in any
  level image.

## Chapter dominant colours

Measured from the shipped stage backgrounds; each chapter's ten level images
keep this colour as their dominant tone.

| Chapter | Levels | Measured from | Dominant colour |
| --- | --- | --- | --- |
| I | 1-10 | stage-1.webp | `#606149` |
| II | 11-20 | stage-2.webp | `#8c593a` |
| III | 21-30 | stage-3.webp | `#275228` |
| IV | 31-40 | stage-4.webp | `#5f9e66` |
| V | 41-50 | stage-5.webp | `#3f2f36` |
| VI | 51-60 | stage-6.webp | `#2e293a` |

## Byte budget

Each `level-<NN>.webp` must stay at or under **409600 bytes** (~400 KB), the
weight of the shipped stage backgrounds, and be WebP-encoded.

## Reviewer checklist (six chapters)

Apply four checks per chapter — **medium**, **palette**, **border** and
**ground band** — to every delivered image. An image is **manifest-approved**
only after all four pass for its chapter; a failed check sends the image back to
the owner instead of a signed PROVENANCE.md row.

| Chapter | Levels | Medium | Palette | Border | Ground band |
| --- | --- | --- | --- | --- | --- |
| I | 1-10 | 1536x1024 WebP, at or under 409600 bytes | dominant `#606149`, 3-5 step ramps, ordered dithering | no frame or border, no text, lettering, UI or watermark | lower 35-50% empty ground plane, landmark in x 120-1416 / y 80-944 |
| II | 11-20 | 1536x1024 WebP, at or under 409600 bytes | dominant `#8c593a`, 3-5 step ramps, ordered dithering | no frame or border, no text, lettering, UI or watermark | lower 35-50% empty ground plane, landmark in x 120-1416 / y 80-944 |
| III | 21-30 | 1536x1024 WebP, at or under 409600 bytes | dominant `#275228`, 3-5 step ramps, ordered dithering | no frame or border, no text, lettering, UI or watermark | lower 35-50% empty ground plane, landmark in x 120-1416 / y 80-944 |
| IV | 31-40 | 1536x1024 WebP, at or under 409600 bytes | dominant `#5f9e66`, 3-5 step ramps, ordered dithering | no frame or border, no text, lettering, UI or watermark | lower 35-50% empty ground plane, landmark in x 120-1416 / y 80-944 |
| V | 41-50 | 1536x1024 WebP, at or under 409600 bytes | dominant `#3f2f36`, 3-5 step ramps, ordered dithering | no frame or border, no text, lettering, UI or watermark | lower 35-50% empty ground plane, landmark in x 120-1416 / y 80-944 |
| VI | 51-60 | 1536x1024 WebP, at or under 409600 bytes | dominant `#2e293a`, 3-5 step ramps, ordered dithering | no frame or border, no text, lettering, UI or watermark | lower 35-50% empty ground plane, landmark in x 120-1416 / y 80-944 |

The same checks, in the order a reviewer runs them:

1. It is 1536x1024 WebP at or under 409600 bytes (`check-art.mjs --all` says
   `ok`, never `oversized` or `wrong size`).
2. The landmark sits in the safe box x 120-1416 and the visible band y 80-944.
3. The lower 35-50% stays an empty ground plane; nothing the player must read
   sits there.
4. The chapter's dominant colour (table above) is the image's dominant tone.
5. Ramps stay 3-5 steps with ordered dithering, one-point perspective and a
   strong vignette.
6. No characters, text, lettering, UI, watermark or frame appears.

## Provenance handoff

Provenance is the owner's responsibility and is appended one row per image,
alongside the images, to `levels/PROVENANCE.md` (the tooling here never creates
or edits it). Each row records the image file, its generator or source, a
SHA-256 prefix, the date and the reviewer's sign-off.

`check-art.mjs --provenance` audits that file without failing: it reads
`levels/PROVENANCE.md` when present, prints `missing provenance level-<NN>.webp`
for every manifest level with no matching row, and exits 0 whether the file or
any row is absent. A row counts once it names the file in a Markdown table cell,
so the owner can append rows as the images arrive.
