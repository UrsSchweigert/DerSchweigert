# Campaign switch dragons: provenance

Two dragons for the campaign button: a young dragon frames Campaign I ("Arithmetic"), an ancient dragon frames
Campaign II ("Genius"). Each comes as a left piece and a right piece. The right piece is the left one mirrored, so
the two ends match exactly.

| File | Size | SHA-256 prefix |
| --- | --- | --- |
| `campaign-dragon-young-left.webp` | 402x480 | `11e1aa4743f9` |
| `campaign-dragon-young-right.webp` | 402x480 | `623b07180d75` |
| `campaign-dragon-ancient-left.webp` | 354x480 | `c4735d903ea1` |
| `campaign-dragon-ancient-right.webp` | 354x480 | `24a1f8c46006` |

Wired into the campaign switch and the title-screen Campaign II picture (`static/index.html`, `styles.css`, `game/campaign2/selection.js`); the apps ship all four files (`mobile/scripts/bundle-check.mjs`).

## Generation

- Model: `fal-ai/gpt-image-1.5/edit` through `tools/fal_image.py:generate()`, `image_size: 1024x1536`,
  `quality: high`, `background: transparent`. The model returns a real alpha channel, so no chroma key or
  background-removal step was needed. It reports no seed.
- Reference image: `static/game/intro-replay.webp`, the dragon ring the campaign switch uses today, scaled to 512 px
  on magenta. It sets the style: painted emblem, forest green, brass and gold trim.
- 13 images in total: 6 in a first model comparison (gpt-image-1.5/edit, nano-banana-pro/edit, flux-pro/kontext; the
  gpt model alone matched the crescent shape and the ring's style), then 4 and 3 refinements with gpt-image-1.5.
- Picks: young from round 2, ancient from round 3. The ancient prompt was rewritten in round 3 because the round 2
  heads were too small to read at button size.

Shared prompt tail (both dragons):

> The dragon's body curls into a tall crescent shape like a left round bracket '(' : its head at the top, turned to
> the right and looking right, its neck and body arching down along the left side, and its tail curling back to the
> right at the bottom. The right side of the crescent is open and empty, because the dragon will hug the left end of a
> wide rectangular button. Whole dragon visible, nothing cropped, centred, small margin. Same art style as the
> reference image: a polished painted fantasy game emblem with crisp dark outlines, forest green scales with brass and
> gold trim, metallic gold highlights, rich shading, mobile game UI ornament. Friendly for a children's game, no
> blood, no gore. No text, no letters, no button, no frame, no ground, no shadow. Transparent background.

Young (prefix):

> A young baby dragon, small, bright and friendly: light fresh spring-green scales, pale golden belly plates, very big
> round sparkling eyes, a happy open smile, two tiny stubby brass horns, little leaf-like wings, chubby cute
> proportions, soft rounded spikes along the back.

Ancient (prefix; the round 3 prompt also adds "Head large and readable even when the picture is shown very small."
before "Whole dragon visible"):

> An ancient elder dragon, enormous, wise and majestic. Its LARGE head is the focus and fills the top third of the
> picture: a broad noble head in three-quarter view, two very long, ridged, swept-back golden horns, brow ridges, a
> long flowing beard of golden whiskers, eyes glowing bright warm amber-gold with a soft light, calm dignified knowing
> expression, mouth closed, kind not scary. Thick powerful body of dark bronze and antique gold scales with deep
> forest-green shadows, darker and older than a young dragon, a few old healed scars and chipped scales on the body
> and a notch in one horn.

## Encoding

1. Alpha below 16 set to 0. The model leaves faint alpha noise across the canvas, and without this the crop is not
   tight. RGB under fully transparent pixels is zeroed, so no hidden glow colour bleeds in when the browser scales.
2. Crop to the alpha bounding box plus 6 px, resize to 480 px high (Lanczos). That is about 3x the expected display
   height on a phone.
3. Right piece = horizontal mirror of the left piece.
4. WebP, `quality=88`, `alpha_quality=95`, `method=6`: about 72 to 74 KB each.

Edges were checked on forest green, near-black and parchment backgrounds: no halo.
