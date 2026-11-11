# Warden art provenance

Arenas and boss portraits for the six Wardens and the Hollow King.

All fourteen images come from **`fal-ai/flux-1/schnell`** (Apache-2.0; commercial
use permitted, listed as approved in `static/story/ART-BIBLE.md`). FLUX.1 [dev]
was not used. Renders are converted to the game's pixel language by
`sites/ffm/scripts/boss_art.py`; the seed plus that script reproduces the shipped
file.

## Why the pipeline looks like this

The shipped stage art (`static/game/stage-N.webp`) is dense pixel art: measuring
horizontal colour runs gives a dominant run of **1-2 px** at 1536 wide, not the
5-6 px blocks of a chunky downscale. An early version pooled renders to 320x180
and the arenas read as a blurry low-res copy next to the stages. The shipped
grid is **768x432** (exactly 2x at 1536x864), which matches that density, and the
renders are prompted for saturated colour with strong shadows because pooling a
pastel illustration loses the contrast the stage art has.

- **arena** — box-pool to 768x432, saturation 1.2 / contrast 1.1, adaptive
  40-colour quantise with Floyd-Steinberg dithering, nearest-neighbour 2x
  upscale to 1536x864, WebP q92.
- **figure** — background sampled from a corner and replaced with the panel's
  ink `#10211b`, box-pool to a 128x128 grid, 28-colour quantise, nearest-neighbour
  upscale to 1024x1024, WebP lossless.

Figures are rendered on a flat dark background and recoloured to `#10211b` so
they sit in the fight panel's brass plaque. No alpha channel is used: a keyed
cutout is fragile (the model returns "magenta" keys that are actually rose, and
bakes in a ground shadow), and the plaque makes a solid backdrop deliberate.

## Files

| File | Seed | Prompt concept |
| --- | --- | --- |
| `arena-1.webp` | 1654177126 | Village gate at day: stone arch, sealed red door with a cyan keyhole, rune fence, windmill, cobbled courtyard |
| `arena-2.webp` | 1472205117 | Golden wheat at sunset: two-pan brass scale on a stone dais, cyan crystal pivot, lantern posts |
| `arena-3.webp` | 1641464686 | Lantern-lit forest: ring of plain standing stones with cyan cracks, blue flowers, strung lanterns |
| `arena-4.webp` | 305633073 | Woodland hall: green roof beams, crimson banners, stone oath table with a glowing open book |
| `arena-5.webp` | 1075157479 | Night market: fountain inside a golden rune circle, striped awnings, lit windows, moon |
| `arena-6.webp` | 767019257 | Blue-and-gold throne room: empty gilded throne, crown-shaped lock with a cyan gem |
| `arena-final.webp` | 801853831 | The same hall broken: cracked throne, six split brass rings leaking cyan, tarnished crown above a void |
| `figure-dawn.webp` | 1589664121 | Living oaken door: carved kindly face, brass-ringed keyhole, small lantern, stone feet |
| `figure-harvest.webp` | 904076816 | Straw-and-post scale warden: brass pans for arms, button eyes, wheat shoulders |
| `figure-memory.webp` | 1783013891 | Rune-stone golem: three stacked stones, glowing cyan eyes, moss and blue flowers |
| `figure-keep.webp` | 560880158 | Banner warden: crimson standard body, carved deer head, brass bell |
| `figure-market.webp` | 67388676 | Lantern merchant spirit: brass lantern head, striped awning cape, coin scale |
| `figure-throne.webp` | 641554919 | Living throne: blue velvet seat, mitten hands, crown-shaped lock above the back |
| `figure-hollow-king.webp` | 530751709 | A tarnished crown floating over an empty void - no body, per the art bible |

## Review notes

- The Hollow King is deliberately bodyless: a floating crown with a shadow, as
  `ART-BIBLE.md` requires.
- Act IV's Warden is a **banner**, not a knight. Plate armour repeatedly pulled
  cross-shaped iconography and an adult bearded face out of the model; both are
  `ART-BIBLE.md` rejection criteria, so the concept changed rather than the
  prompt being argued with.
- `arena-3` is the second attempt: the first carried letter-like glyphs carved on
  the stones, which the art bible forbids.
- UI colour comes from the title page (`styles.css :root` forest/ink/ivory/brass
  tokens), not from the lore palette, so the fight reads as part of the menu.
