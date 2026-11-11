# Warden art provenance

Six arenas (one per act) and seven boss portraits.

Every image was produced with the **GPT image model** through the VS Code
`image_generation` tool. That model is the one `static/story/ART-BIBLE.md` lists
as approved from the intro pilot ("provider terms permit commercial use of
outputs"); the tool does not report a model id or a seed, so each shipped file is
identified by its SHA-256 prefix instead. FLUX.1 [dev] was never used.

## Why this model

FLUX 1 schnell was tried first, and it cannot draw pixel art: it returns
smooth, painterly renders whatever the prompt says. Two post-processing
attempts were shipped and rejected on review:

1. **320x180 pool** — read as a blurry low-res copy of an illustration.
2. **768x432 pool + ordered Bayer dither** — closer, still not 16-bit. Ordering
   dither noise over a smooth painting gives texture, not pixel art, because the
   underlying shapes still have soft edges and continuous tone.

The GPT image model draws on a genuine pixel grid — chunky square pixels, hard
edges, banded dithering — so the art needs no reconstruction. The script only
crops and encodes it, and any pooling would smear the grid it was drawn on.

## Encoding

- **arena** — trim the 3:2 render to the 16:9 frame on a multiple of the pixel
  size (80 px top and bottom), WebP **q92**. Full 1536x864 at ~380 KB, the same
  weight as the shipped `stage-N.webp` files; lossless dithering cost 1.6 MB per
  arena for no visible gain.
- **portrait** — centre-crop to square, nearest-neighbour step down to 256x256,
  WebP lossless (~50-70 KB). 256 px is 2x the largest on-screen size (8 rem).

## Atmosphere

Deliberately **ominous and gloomy**, per review: night, storm, fog, long
shadows, cold cyan and violet light, black silhouettes, no sunshine and no warm
fill. The creatures stay gentle rather than frightening; the Hollow King remains
a bodyless floating crown, as the art bible requires.

## Files

| File | SHA-256 (first 16) |
| --- | --- |
| `arena-1.webp` | d8e194c3c30c6635 |
| `arena-2.webp` | c3cc9865ee4a12f4 |
| `arena-3.webp` | e339bf2c77df61f6 |
| `arena-4.webp` | fb2c94ad4f1933fb |
| `arena-5.webp` | 436082f695a18769 |
| `arena-6.webp` | f19fdbc906d75c7d |
| `figure-dawn.webp` | 559317bddd1d48f7 |
| `figure-harvest.webp` | b690f0c7fcb44fc4 |
| `figure-hollow-king.webp` | 8bbccf05b304ce98 |
| `figure-keep.webp` | d9251ca990c5490b |
| `figure-market.webp` | 4a74edf253abbbad |
| `figure-memory.webp` | 843e9205fdb01026 |
| `figure-throne.webp` | 02d6112291a31666 |

## Review notes

- Act IV's Warden is a **banner** (deer-headed standard), not a knight. Plate
  armour repeatedly produced cross-shaped iconography and an adult bearded face,
  both ART-BIBLE rejection criteria; the concept was changed instead.
- `arena-6` is the ruined throne room, and it is also the Hollow King's arena:
  the game ships one background per act, not a seventh for the finale.
- No arena carries text, letters, numerals or a religious symbol. The Act VI
  throne uses a plain star finial after an earlier render put a cross on it.
