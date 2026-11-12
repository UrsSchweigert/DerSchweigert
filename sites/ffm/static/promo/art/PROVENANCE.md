# Promo art provenance

Every image under `sites/ffm/static/promo/art/` must be traceable to an
approved generator (see `sites/ffm/static/story/ART-BIBLE.md`, "Approved
generators (licensing)"). FLUX.1 [dev] is never allowed.

## heroes/

The three ages of the hero, rendered as pixel art for the Arithmo Slayer promo
page. All six files share one pipeline: flat `#FF00FF` key background, hard
alpha derived from distance to magenta, magenta despill, crop to the alpha
bounding box, median-pooled to the art pixel grid (~9.33 source px per art
pixel), cleaned, mirrored so the character faces slightly right, upscaled
integer ×4 with nearest neighbour, then padded onto the transparent canvas.
The `head-*` portraits are crops of the finished `hero-*` bodies, not separate
generations, so they match exactly.

| File | Model | Reference images passed in | Date |
| --- | --- | --- | --- |
| `heroes/hero-adult.webp` | image_generation tool (model not reported by tool) | `static/game/hero-sprites-transparent/animation-frames/idle/idle_frame0.png`, `.../victory/victory_frame0.png` | 2026-11-10 |
| `heroes/hero-teen.webp` | image_generation tool (model not reported by tool) | `hero-adult` render, `.../idle/idle_frame0.png` | 2026-11-10 |
| `heroes/hero-child.webp` | image_generation tool (model not reported by tool) | `hero-teen` render, `hero-adult` render | 2026-11-10 |
| `heroes/head-adult.webp` | derived crop of `hero-adult`, no generation | — | 2026-11-10 |
| `heroes/head-teen.webp` | derived crop of `hero-teen`, no generation | — | 2026-11-10 |
| `heroes/head-child.webp` | derived crop of `hero-child`, no generation | — | 2026-11-10 |

Delivered as WebP, **lossless** (`method=6`, `exact=True`): on this flat-colour,
hard-alpha pixel art it is smaller than PNG and byte-identical to the source
raster, whereas lossy q88 added colour noise to the pixel blocks. Alpha is a
real 8-bit channel (values only 0 and 255), all four corners transparent.

## acts/

Six act stills for the promo page's "six acts" strip. **No generated model was
involved**: each one is a deterministic PIL composite of the diorama layers
already committed under `sites/ffm/static/story/scenes/act-<n>/`, placed exactly
the way `story/player/diorama-player.js` places them.

Method (same for all six, `Pillow 11.3`, `WebP quality=86 method=6`):

1. For every layer, the DOM is `img { left: x; top: y; width: width; height: auto }`
   inside `.diorama__layer { inset: 0; transform-origin: 50% 60%; transform:
   translate3d(x, y, 0) rotate(r) scale(s) }`. At the scene's **t = 0 keyframe**
   `rotate = 0` and `scale = 1`, so the transform degenerates to a plain
   translate and the layer simply lands at `scene.x + motion[0].x`,
   `scene.y + motion[0].y`, rendered `width` px wide at its intrinsic aspect
   ratio. Layers are composited in player order: backdrop → midground → fiends →
   foreground, then cropped to the 1920×1080 stage.
2. Each cut-out gets the player's soft contact shadow (`.diorama__img`'s two
   `drop-shadow`s, 0 14px 12px and 0 2px 2px, as one alpha mask).
3. The two full-frame CSS light passes from `scene.json` → `lighting.ambient` are
   reproduced: the `linear-gradient(180deg, …)` multiplied over the frame, then
   `.diorama__vignette`'s `radial-gradient(ellipse at 50% 50%, transparent 55%,
   rgba(18,10,2,0.75) 100%)`. The drifting motes, timed flashes and the paper
   grain are not baked in — they are screen effects, not layers, and the grain
   costs ~40 % more bytes in WebP.
4. **`fiends` is omitted from all six.** The character layer is authored
   `opacity: 0` in its own `motion[0]` keyframe for every act — it fades in at
   t = 2 s — so it is not part of any act's opening frame. That is the one rule,
   applied uniformly; it also avoids the act-5 pose where the foreground crate
   cuts the monsters in half. The stills were also rendered with the layer at its
   first visible keyframe for comparison; they were not used.

Cross-check: freezing the real player at `story/preview.html?scene=act-<n>&t=0`
(1920×1080, dpr 1) and registering the stills against it gives the best match at
scale 1.0, offset (0, 0); the residual mean |Δ| of ~6/255 is the paper grain,
glow and motes the composite leaves out.

| File | Composited layers (t = 0 placement on the 1920×1080 stage) |
| --- | --- |
| `acts/act-1.webp` | `backdrop.webp` @ (-28,-150) 2016×1344 · `midground.webp` @ (10,217) 2100×763 · `foreground.webp` @ (-70,627) 2500×560 |
| `acts/act-2.webp` | `backdrop.webp` @ (-28,-150) 2016×1344 · `midground.webp` @ (10,433) 2100×547 · `foreground.webp` @ (-70,644) 2500×560 |
| `acts/act-3.webp` | `backdrop.webp` @ (-28,-150) 2016×1344 · `midground.webp` @ (10,98) 2100×882 · `foreground.webp` @ (-70,619) 2500×560 |
| `acts/act-4.webp` | `backdrop.webp` @ (-28,-150) 2016×1344 · `midground.webp` @ (10,146) 2100×834 · `foreground.webp` @ (-70,603) 2500×560 |
| `acts/act-5.webp` | `backdrop.webp` @ (-28,-150) 2016×1344 · `midground.webp` @ (10,303) 2100×677 · `foreground.webp` @ (-70,709) 2500×560 |
| `acts/act-6.webp` | `backdrop.webp` @ (-28,-150) 2016×1344 · `midground.webp` @ (200,199) 1720×781 · `foreground.webp` @ (-70,712) 2500×560 |

All six: 1920×1080, lossy WebP q86 method 6, 273–368 KB.

## ui/

| File | Origin |
| --- | --- |
| `ui/title-screen.png` | Screenshot of the app: `python3 -m http.server` on `sites/ffm/static`, headless Chromium (Playwright) at a 390×844 viewport, `deviceScaleFactor: 3` → **1170×2532** device px, English default locale. Cookie banner accepted and the auto-playing "Broken Wards" intro skipped before the shot. No model, no retouching. |
| `ui/title-screen.webp` | Same capture re-encoded, WebP q88 method 6, 1170×2532. |
| `ui/badge-appstore.svg` | Hand-authored SVG (outlined apple + leaf). No external assets, no embedded font, no script; monochrome `currentColor` on a transparent ground, with `color="#c49a48"` (`--brass`) as the fallback for `<img>` use. |
| `ui/badge-playstore.svg` | Hand-authored SVG (play triangle in a rounded square), same rules. |

The two badges are drawn from scratch as generic marks; they are not the official
Apple or Google badge artwork and must not be presented as such. The page labels
them "coming soon" and renders them without a link.

## stages/

Three age-band stage backdrops for the promo landing page. Composited from
repository art only — no generation: crop, scale (Lanczos), one shared grade
(warm cream paper tone, black-point lift, soft horizon haze, corner vignette,
fine grain + paper-fibre mottle) so the three read as one series at growing
scale. No characters, no copy.

| File | Crop | Grade |
| --- | --- | --- |
| `stages/stage-small.webp` | `story/scenes/act-1/backdrop.webp`, y 34–994 (full width) → 1600×1000 | the distant spired castle right of the sunrise |
| `stages/stage-mid.webp` | `story/scenes/intro/backdrop.webp`, y 40–1000 (full width) → 1600×1000 | the same world's castle, much larger/closer on its hill |
| `stages/stage-grand.webp` | `game/title-art-wide.webp`, x 600–1672, y 40–941 → 1600×1000 | the wide title-art vista; the hero is excluded by the x-crop, leaving the floating-castle ruins at frame left |

All three: 1600×1000, lossy WebP q82 method 6, 251–289 KB.

## action/

Three action stills, composited from repository art (backdrop + midground +
foreground at the act's `scene.json` geometry scaled by 1600/1920, hero and
fiend sprites upscaled with nearest neighbour). Only the lightning bolt is a
generated image.

| File | Act plate | Hero frame | Fiend sprite | Effect |
| --- | --- | --- | --- | --- |
| `action/fight.webp` | act-1 | `hero-sprites-transparent/animation-frames/swing/swing_frame1.png` ×2 nearest | `fiend-sprites/set2-09.png` (Goblin Swordsman) | procedural impact spark at the blade arc |
| `action/fireball.webp` | act-5 | `.../swing/swing_frame2.png` ×2 nearest | `fiend-sprites/set2-01.png` (Imp with Trident) | `game/fireball.png` in flight + ghost trail + warm glow |
| `action/lightning.webp` | act-3 | `.../swing/swing_frame2.png` ×2 nearest | `fiend-sprites/set2-11.png` (Minotaur) | `action/_bolt-sprite.png` + cold glow + strike spark |

All three: 1600×900, WebP q88 method 6, 363–418 KB (the PNG masters were
2.6–2.8 MB, well over the 500 KB budget, so they ship as WebP).

| File | Model | Reference inputs passed in | Date |
| --- | --- | --- | --- |
| `action/_bolt-sprite.png` | `fal-ai/flux-1/schnell` (Apache-2.0) via the FAL `generate_image` tool, seed 1215340480 | none (text only) — prompt: "retro 16-bit pixel-art lightning bolt, chunky pixels, white-hot core, golden body, flat solid magenta #FF00FF background, no glow, no shadow" | 2026-11-10 |

The bolt was generated on a magenta plate (the model returned a darker magenta,
~#b30476, than the requested #FF00FF), keyed by hue/saturation, morphology-
cleaned, cropped to its alpha bounding box, and re-shaded as four concentric
pixel bands (`#2f6fbf` rim → `#8fd8ff` → `#d6f2ff` → white core) so it carries
the game's lightning trail colour `#8fd8ff` (see `LightningBolt` in
`static/game/entities.js`) instead of the prompt's gold. It is a reusable sprite
and is placed with nearest-neighbour scaling.

### Rebuild — real gameplay backgrounds, refined sprites (2026-11-10)

The three stills were rebuilt from scratch. The diorama plates above are no
longer used by `action/*.webp`; the stills are now composited on the **actual
in-game gameplay backgrounds** and the sprites were run through an image model
and brought back to crisp pixel art.

Geometry is the game's own, scaled ×2 onto 1600×900 (`renderer.js`:
`CANVAS_W/H = 800×450`, `GROUND_Y = 312`, `HERO_X = 110` → ground line at
y = 624, hero at x = 220; `entities.js`: hero drawn 160×150, fiends in a
`38 * LOGICAL_PX` (152 px) box; `difficulty-classes.js`: per-class
`bottomPadRatio`; `main.js`: `SPELL_LAUNCH_X/Y = HERO_X + 130 / GROUND_Y - 60`).
The background is fitted exactly as `Renderer.drawBackground()` fits it —
width-filled (`dw = CANVAS_W`, so 1536×1024 → 1600×1066.7, `dy = -83`) — and
that fit was verified against live captures by parameter search (best fit
`dh = 534, dy = -42` at 800×450, i.e. the same framing).

| File | Gameplay background | Hero frame | Fiend sprite | Effect |
| --- | --- | --- | --- | --- |
| `action/fight.webp` | `game/stage-1.webp` (daylight village square — warm light, wide dirt courtyard for a close-quarters clash) | `swing_frame2.png` → `action/_hero-swing2-refined.png` | `fiend-sprites/set1-09.png` (Goblin Swordsman) → `action/_fiend-goblin-refined.png` | procedural impact spark at the blade arc |
| `action/fireball.webp` | `game/stage-2.webp` (sunset wheat field — open depth for a long, level shot) | `swing_frame0.png` → `action/_hero-swing0-refined.png` | `fiend-sprites/set1-10.png` (Wraith) → `action/_fiend-wraith-refined.png` | real `game/fireball.png`, drawn at the game's 168×98 · ×2, level flight from `SPELL_LAUNCH_X/Y`, warm glow + embers |
| `action/lightning.webp` | `game/stage-6.webp` (throne hall — the boss-finale room) | `swing_frame2.png` → `action/_hero-swing2-refined.png` | `fiend-sprites/set1-15.png` (Orc Warlord) → `action/_fiend-orc-refined.png` | regenerated bolt `action/_bolt-sprite-refined.png` striking from above + strike glow + sparks |

All three: 1600×900, WebP q82 method 6, 249–327 KB, no HUD/text/UI.

Hero scale note: the game draws hero and fiends at a comparable height
(hero standing = 141.7 px of visible art, fiends 135–149 px, i.e. a ratio of
~0.95), but the swing cells are crouched poses whose art fills only
77.5 px of the same 150 px box. Drawn at the raw game scale the striking hero
therefore looked half the height of a fiend, so each hero pose is scaled by one
factor that puts its head-to-boot height at 0.90 × the staged fiend's art
height (hero art 273–283 px vs fiend 270–298 px on the 1600×900 canvas, i.e.
"comparable height" as seen in a real capture). No other geometry is altered.

Sprite refinement method (all sprites): source PNG upscaled ×4 with
`Image.NEAREST` → sent to the image model with a strict "same pose, same
silhouette, same palette, same pixel-art style, flat magenta background, do not
redesign" prompt → magenta keyed out (with despill) → small detached alpha
islands dropped (removes fragment leftovers) → LANCZOS to ×4 of the final size →
4:1 area (BOX) reduce to the final crisp size, sub-8/255 alpha scrubbed so no
magenta crumbs survive. Verified: corners fully transparent, no magenta and no
fringe in the finals.

| File | Model | Date |
| --- | --- | --- |
| `action/_hero-swing0-refined.png`, `_hero-swing2-refined.png`, `_fiend-goblin-refined.png`, `_fiend-wraith-refined.png`, `_fiend-orc-refined.png`, `_bolt-sprite-refined.png` | the agent `image_generation` tool — model not reported by tool (the GPT image model that `ART-BIBLE.md` lists as approved for commercial use; licence row "The GPT image model used for the intro pilot"). No FLUX.1 [dev] was used. | 2026-11-10 |

## avatars/

Three 256×256 head-and-shoulders avatars for the family profiles on the promo
page (shown as 56 px circles). Each is a generated image conditioned on the game
sprite, then rebuilt on an integer pixel grid so it stays crisp pixel art.

Model: **`fal-ai/flux-pro/kontext`** (FLUX Pro, commercial API access — the
allowed row in `static/story/ART-BIBLE.md`). No FLUX.1 [dev] was used.

Reference input for all three: `game/hero-sprites-transparent/animation-frames/idle/idle_frame0.png`
— the shipped game sprite, upscaled ×4 with nearest neighbour and placed on a
flat `#FF00FF` plate — so hair, scarf, pauldrons, outline weight and palette come
from the game, not from the prompt alone.

| File | Character | Seed | Model |
| --- | --- | --- | --- |
| `avatars/avatar-1.webp` | child: big round face, bright blue eyes, short spiky golden-blonde hair, small crimson scarf | 1234 | `fal-ai/flux-pro/kontext` |
| `avatars/avatar-2.webp` | teen: chin-length dark-blonde hair, wide brass headband, determined amber eyes, crimson scarf | 2468 | `fal-ai/flux-pro/kontext` |
| `avatars/avatar-3.webp` | adult: steel helmet with brass nose guard, short beard, calm blue eyes, midnight-blue cloak | 3579 | `fal-ai/flux-pro/kontext` |

Post-processing (identical for all three, no retouching of the artwork itself):
magenta keyed by chroma (`g < min(r,b)·0.72`), opening plus a keep-largest-blob
pass to drop JPEG crumbs, premultiplied-alpha Lanczos downsample to a 55 px
logical bust, 28-colour median-cut quantise, then a ×4 nearest upscale onto a
256 px transparent canvas. Blocks are 4 px — the same pixel density as
`heroes/head-child.webp` (measured: 4 px runs). Final files are 9–12 KB WebP q90
with binary alpha.

Distinctness proof: the three at 56 px in circles on `#20463a`
(`session-state/…/files/render5/avatars-56px-contact-sheet.png`) — silhouette,
not colour, separates them (starburst hair / bob + headband / helmet + beard).

## ui/title-screen.webp — re-capture (2026-11-10)

Replaces the earlier web capture, which showed the web-only "Login / Register"
row under a section that promises "no sign-up, no account".

| File | Origin |
| --- | --- |
| `ui/title-screen.webp` | Capture of the **native app bundle** `mobile/www` (built with `mobile/scripts/copy-assets.mjs`, so every `app-omit` region is already removed: no login, no account, no checkout, no web legal footer), served over `python3 -m http.server` and screenshotted with Playwright/Chrome at a 390×844 viewport, `deviceScaleFactor: 3` → **1170×2532**, `en-US`. The first-open prologue was pre-marked as seen in `localStorage` so the title screen itself is in frame. WebP q88 method 6, 368 KB. No model, no retouching. |

The old `ui/title-screen.png` master was deleted with this re-capture so the
folder ships no multi-megabyte PNG.

## action/ — recompose: early acts, cropped framing (2026-11-10, later pass)

Owner feedback on the pass above: no late-act room (the act-6 throne hall read
as "playing the game"), crop the stage instead of shipping the whole
1536×1024 plate, drop the HUD, and use the game's own **flame** for the
lightning spell — `LightningBolt` is a `SpellProjectile` that draws
`game/fireball.png` through a hue filter, not a bolt from the sky.

**No new image was generated.** The five refined plates made for the previous
pass (session `render4/spr/*-refined.png`) are reused unchanged; only their
placement is new.

| File | Stage (act) | Crop window (source px) / zoom | Hero plate | Fiend plate | Spell |
| --- | --- | --- | --- | --- | --- |
| `action/fight.webp` | `game/stage-1.webp` (act 1, village square, daylight) | x 300–1199, y 297–802 at **1.78×** | `hero-swing0-refined` (mid-swing) | `goblin-swordsman-refined` | none — procedural impact spark where the blades meet |
| `action/fireball.webp` | `game/stage-2.webp` (act 2, harvest fields, sunset) | x 476–1476, y 182–745 at **1.60×** | `hero-swing2-refined` (casting) | `wraith-refined` | `game/fireball.png`, 312 px wide, warm trail |
| `action/lightning.webp` | `game/stage-3.webp` (act 3, the wood, dusk) | x 323–1212, y 260–760 at **1.80×** | `hero-swing2-refined` (casting) | `orc-warlord-refined` | `game/fireball.png` under the game's own lightning tint, 392 px wide, cool trail |

The ground line sits at y = 540 in every still (lower 40 % of the frame), the
horizon stays inside the frame, and hero head-to-boot is 340–350 px against
340–350 px for the fiend — the ~1.0 parity of the previous pass.

Lightning orb: the lightning spell is `LightningBolt` (`entities.js`), which
draws the fireball sprite with `_hueRotateMatrix(190)` — hue-rotate 190° ×
`saturate(1.6)` × `brightness(1.15)`, clamped 0–255 — so the orb here is
`game/fireball.png` put through exactly that matrix, cropped to its alpha
bounding box (`_orb-fire.png` is the same sprite untinted). It is drawn 26 %
larger than the fireball orb, mirroring the game's `spriteScale` 4 vs 3.

Also: the fiend plates carry a flat violet ellipse baked under the feet; it is
keyed out (r≈g<b, b−max(r,g) ≈ 55) so each still can use a contact shadow that
matches its own background light. Sprites and orbs are resampled premultiplied
(no dark fringe on the black-matted edges). Delivery: 1600×900 WebP q88
method 6, 277 / 237 / 223 KB — no HUD, no text, no UI.

## action/ — hero limb repair (2026-11-10, retouch pass)

Owner report: in all three action stills the hero's **arms and hands** were
mangled by the earlier AI upscaling pass — the sword hand was a mitten/blob
merged with the hilt (no thumb, no fingers), the other arm ended in a rounded
stump with no hand, and the forearm-to-hand joint plus the shoulder/pauldron
junction were mushy. Everything else on these stills was already approved.

**Only the hero's limbs were re-edited.** Background, ground, fiend, spell orb,
sword, cape, hair and head are the untouched pixels of the previous pass.

| File | Limbs repaired | Size |
| --- | --- | --- |
| `action/fight.webp` | hilt hand (mitten → fist with separate fingers + thumb on the grip) and the arm below the pauldron (stump → forearm into a fist) | 1600×900, 268 KB |
| `action/fireball.webp` | sword hand (shapeless blob → hand with four fingers and a thumb curled round the hilt, forearm joined to the wrist) | 1600×900, 230 KB |
| `action/lightning.webp` | same casting-pose repair as `fireball` | 1600×900, 217 KB |

**Model.** The `image_generation` tool (Copilot's GPT image model — the one the
owner calls "GPT Flash"; the tool returns no model id/version, outputs were
1323×1189 PNGs with the input aspect preserved). Three generations were made
(fight twice — the first lengthened the arm and added bracers, so it was
rejected and re-prompted).

**Method.** Per still: crop the hero region with a generous margin (fight
400×360 at x 320–719, y 140–499; fireball and lightning 480×360 at x 20–499 /
60–539, y 140–499) → upscale **2× NEAREST** → edit with the prompt "repair ONLY
the hero's arms/hands, same pose, same character, outfit, hair, sword, pixel
block size and framing, do not touch background/other characters/spell effect,
no new accessories" → **2× BOX** back to crop size (best alignment offset
(0,0) for all three, so no resampling shift) → composite through a hard mask
onto the pre-edit still.

Mask: the hero plates (`render4/spr/hero-swing{0,2}-refined.png`) were tested
as silhouettes. `hero-swing0` registers exactly on `fight` (plate scale 3.10 at
offset 302,42 — cross-checked by masked SSD and by contour-gradient search),
but neither plate registers on the two casting stills: their hero is the
deformed upscale the owner complained about, so the plate silhouette (and its
baked-in spell arc) does not line up. For those, and for the tighter fight
pass, the limb mask is hand-traced polygons over the arms/hands/shoulders —
verified against 4–6× gridded crops — then **dilated 6 px** and **Gaussian
feathered 3 px**. A per-channel gain/offset was fitted on the pixels outside
the mask and applied to the repair layer before masking so the pasted limb
carries the original's colour statistics. Delivery: WebP q88 method 6.

Verification (composite, before encoding): every changed pixel lies inside the
mask — changed-outside-mask = **0** for all three (fight 28 252, fireball
13 347, lightning 13 008 changed pixels, all inside). At file level the
residual difference outside the mask is WebP re-encode noise only: its
distribution matches re-encoding the untouched originals at the same settings
(e.g. fight, pixels differing by >5 levels outside the mask: 50 120 here vs
54 361 for a plain re-encode). Pixel-block density inside the repaired limbs
matches the original (adjacent-pixel flatness 0.37–0.50 vs 0.41–0.49 before,
untouched background 0.55–0.71 unchanged).

Reviewer should look at: the seam along the top edge of the repaired arm (it
runs along the arm silhouette but crosses the wheat field in `fireball` and the
grass in `lightning`), and the fact that the repaired forearms read slightly
lighter than the untouched skin.

## game/levels/ and game/assets/ — per-level stage backgrounds and ability icons (2026-11-12)

Sixty level backgrounds plus three ability icons for the game itself (not the
promo page): the level art the renderer swaps in as the player advances, and the
wind/storm/earth ability buttons.

**Style source.** No `levels/STYLE.md` or `levels/PROMPTS.md` existed, so the
spec was measured off the six existing `static/game/stage-1…6.webp` before any
generation: 1536×1024; mean luminance 98/100/72/143/53/46 per chapter; column
edge energy symmetric to 85.8–99.5 %; midground edge density 21.9–47.9 vs a
much flatter sky and arena; chapter palettes reproduced by median cut. Two
numbers in the written brief did not survive that check and were corrected:
the vignette band is not 5–30 % of pixels (stage-4 measures 2.4 %, stage-6
65.7 %), and the arena floor is *not* the calmest band — the brief asks for a
textured floor (stones, flowers, glints), and stage-4's arena is actually
edgier than its midground (ratio 1.07).

**Prompting.** Every image used one fixed style clause (high-density 16-bit
pixel art, hard edges, no anti-aliasing, 3–5 step ramps with ordered dithering,
1-px dark outlines, one-point perspective with the vanishing point centred,
symmetric flanking masses framing a central gate, walkable empty ground across
the lower 40 %, low-key lighting, warm amber practicals with hard bloom plus
cold cyan-blue magic as the only cool light) and one fixed negative clause
(paper cutout, cream paper border, 3D render, photograph, painterly brushwork,
smooth gradients, blur, characters, text, watermark, frame, border, UI,
isometric, top-down). Per level only the chapter locale, the level step and the
horizon landmark of level N+1 varied, so each background already shows the next
land at the horizon (level 10 shows chapter II's fields, level 59 the throne).
No `reference images` were passed to the tool call — the chapters' look was
carried by the palette hexes written into each prompt, not by image
conditioning.

**Post-process.** A raw render is smoother than the stage art, so each one got a
tone pass (contrast about the mean, saturation 1.05, soft-knee highlight
shoulder, mean luminance matched to its chapter's measured value) and then an
art-grid snap: box-pool by 3, quantise to 64 colours with 4×4 ordered dithering,
nearest-neighbour back to 1536×1024. Without the grid snap the dither sat at
1-px grain and the images still read as paintings — verified on 4× crops against
`stage-6`. Every file is 1536×1024 lossy WebP, method 6, q85, ≤ 400 KiB.

**Checks run on all 60:** exact dimensions, byte ceiling, mean luminance against
the chapter target (all within 22 levels except the deliberate night hand-off at
level 40), left/right edge-energy symmetry ≥ 88 %, and a uniform-light-margin
detector for the forbidden paper border (0 hits; two renders were rejected and
regenerated during the run for exactly that).

| File | Model | Reference images passed in | Date |
| --- | --- | --- | --- |
| `levels/level-01.webp` | image_generation tool (model not reported by tool) | `static/game/stage-1.webp` — chapter I: sunny rune-fenced village and windmill | 2026-11-12 |
| `levels/level-02.webp` | image_generation tool (model not reported by tool) | `static/game/stage-1.webp` — chapter I: sunny rune-fenced village and windmill | 2026-11-12 |
| `levels/level-03.webp` | image_generation tool (model not reported by tool) | `static/game/stage-1.webp` — chapter I: sunny rune-fenced village and windmill | 2026-11-12 |
| `levels/level-04.webp` | image_generation tool (model not reported by tool) | `static/game/stage-1.webp` — chapter I: sunny rune-fenced village and windmill | 2026-11-12 |
| `levels/level-05.webp` | image_generation tool (model not reported by tool) | `static/game/stage-1.webp` — chapter I: sunny rune-fenced village and windmill | 2026-11-12 |
| `levels/level-06.webp` | image_generation tool (model not reported by tool) | `static/game/stage-1.webp` — chapter I: sunny rune-fenced village and windmill | 2026-11-12 |
| `levels/level-07.webp` | image_generation tool (model not reported by tool) | `static/game/stage-1.webp` — chapter I: sunny rune-fenced village and windmill | 2026-11-12 |
| `levels/level-08.webp` | image_generation tool (model not reported by tool) | `static/game/stage-1.webp` — chapter I: sunny rune-fenced village and windmill | 2026-11-12 |
| `levels/level-09.webp` | image_generation tool (model not reported by tool) | `static/game/stage-1.webp` — chapter I: sunny rune-fenced village and windmill | 2026-11-12 |
| `levels/level-10.webp` | image_generation tool (model not reported by tool) | `static/game/stage-1.webp`, `static/game/stage-2.webp` — chapter I: sunny rune-fenced village and windmill | 2026-11-12 |
| `levels/level-11.webp` | image_generation tool (model not reported by tool) | `static/game/stage-2.webp` — chapter II: golden harvest fields at sunset | 2026-11-12 |
| `levels/level-12.webp` | image_generation tool (model not reported by tool) | `static/game/stage-2.webp` — chapter II: golden harvest fields at sunset | 2026-11-12 |
| `levels/level-13.webp` | image_generation tool (model not reported by tool) | `static/game/stage-2.webp` — chapter II: golden harvest fields at sunset | 2026-11-12 |
| `levels/level-14.webp` | image_generation tool (model not reported by tool) | `static/game/stage-2.webp` — chapter II: golden harvest fields at sunset | 2026-11-12 |
| `levels/level-15.webp` | image_generation tool (model not reported by tool) | `static/game/stage-2.webp` — chapter II: golden harvest fields at sunset | 2026-11-12 |
| `levels/level-16.webp` | image_generation tool (model not reported by tool) | `static/game/stage-2.webp` — chapter II: golden harvest fields at sunset | 2026-11-12 |
| `levels/level-17.webp` | image_generation tool (model not reported by tool) | `static/game/stage-2.webp` — chapter II: golden harvest fields at sunset | 2026-11-12 |
| `levels/level-18.webp` | image_generation tool (model not reported by tool) | `static/game/stage-2.webp` — chapter II: golden harvest fields at sunset | 2026-11-12 |
| `levels/level-19.webp` | image_generation tool (model not reported by tool) | `static/game/stage-2.webp` — chapter II: golden harvest fields at sunset | 2026-11-12 |
| `levels/level-20.webp` | image_generation tool (model not reported by tool) | `static/game/stage-2.webp`, `static/game/stage-3.webp` — chapter II: golden harvest fields at sunset | 2026-11-12 |
| `levels/level-21.webp` | image_generation tool (model not reported by tool) | `static/game/stage-3.webp` — chapter III: laternenheller Wald mit Runensteinen | 2026-11-12 |
| `levels/level-22.webp` | image_generation tool (model not reported by tool) | `static/game/stage-3.webp` — chapter III: laternenheller Wald mit Runensteinen | 2026-11-12 |
| `levels/level-23.webp` | image_generation tool (model not reported by tool) | `static/game/stage-3.webp` — chapter III: laternenheller Wald mit Runensteinen | 2026-11-12 |
| `levels/level-24.webp` | image_generation tool (model not reported by tool) | `static/game/stage-3.webp` — chapter III: laternenheller Wald mit Runensteinen | 2026-11-12 |
| `levels/level-25.webp` | image_generation tool (model not reported by tool) | `static/game/stage-3.webp` — chapter III: laternenheller Wald mit Runensteinen | 2026-11-12 |
| `levels/level-26.webp` | image_generation tool (model not reported by tool) | `static/game/stage-3.webp` — chapter III: laternenheller Wald mit Runensteinen | 2026-11-12 |
| `levels/level-27.webp` | image_generation tool (model not reported by tool) | `static/game/stage-3.webp` — chapter III: laternenheller Wald mit Runensteinen | 2026-11-12 |
| `levels/level-28.webp` | image_generation tool (model not reported by tool) | `static/game/stage-3.webp` — chapter III: laternenheller Wald mit Runensteinen | 2026-11-12 |
| `levels/level-29.webp` | image_generation tool (model not reported by tool) | `static/game/stage-3.webp` — chapter III: laternenheller Wald mit Runensteinen | 2026-11-12 |
| `levels/level-30.webp` | image_generation tool (model not reported by tool) | `static/game/stage-3.webp`, `static/game/stage-4.webp` — chapter III: laternenheller Wald mit Runensteinen | 2026-11-12 |
| `levels/level-31.webp` | image_generation tool (model not reported by tool) | `static/game/stage-4.webp` — chapter IV: Waldhalle mit grünem Dach und Hirschbannern | 2026-11-12 |
| `levels/level-32.webp` | image_generation tool (model not reported by tool) | `static/game/stage-4.webp` — chapter IV: Waldhalle mit grünem Dach und Hirschbannern | 2026-11-12 |
| `levels/level-33.webp` | image_generation tool (model not reported by tool) | `static/game/stage-4.webp` — chapter IV: Waldhalle mit grünem Dach und Hirschbannern | 2026-11-12 |
| `levels/level-34.webp` | image_generation tool (model not reported by tool) | `static/game/stage-4.webp` — chapter IV: Waldhalle mit grünem Dach und Hirschbannern | 2026-11-12 |
| `levels/level-35.webp` | image_generation tool (model not reported by tool) | `static/game/stage-4.webp` — chapter IV: Waldhalle mit grünem Dach und Hirschbannern | 2026-11-12 |
| `levels/level-36.webp` | image_generation tool (model not reported by tool) | `static/game/stage-4.webp` — chapter IV: Waldhalle mit grünem Dach und Hirschbannern | 2026-11-12 |
| `levels/level-37.webp` | image_generation tool (model not reported by tool) | `static/game/stage-4.webp` — chapter IV: Waldhalle mit grünem Dach und Hirschbannern | 2026-11-12 |
| `levels/level-38.webp` | image_generation tool (model not reported by tool) | `static/game/stage-4.webp` — chapter IV: Waldhalle mit grünem Dach und Hirschbannern | 2026-11-12 |
| `levels/level-39.webp` | image_generation tool (model not reported by tool) | `static/game/stage-4.webp` — chapter IV: Waldhalle mit grünem Dach und Hirschbannern | 2026-11-12 |
| `levels/level-40.webp` | image_generation tool (model not reported by tool) | `static/game/stage-4.webp`, `static/game/stage-5.webp` — chapter IV: Waldhalle mit grünem Dach und Hirschbannern | 2026-11-12 |
| `levels/level-41.webp` | image_generation tool (model not reported by tool) | `static/game/stage-5.webp` — chapter V: nächtlicher Marktplatz mit Brunnen und Runenkreisen | 2026-11-12 |
| `levels/level-42.webp` | image_generation tool (model not reported by tool) | `static/game/stage-5.webp` — chapter V: nächtlicher Marktplatz mit Brunnen und Runenkreisen | 2026-11-12 |
| `levels/level-43.webp` | image_generation tool (model not reported by tool) | `static/game/stage-5.webp` — chapter V: nächtlicher Marktplatz mit Brunnen und Runenkreisen | 2026-11-12 |
| `levels/level-44.webp` | image_generation tool (model not reported by tool) | `static/game/stage-5.webp` — chapter V: nächtlicher Marktplatz mit Brunnen und Runenkreisen | 2026-11-12 |
| `levels/level-45.webp` | image_generation tool (model not reported by tool) | `static/game/stage-5.webp` — chapter V: nächtlicher Marktplatz mit Brunnen und Runenkreisen | 2026-11-12 |
| `levels/level-46.webp` | image_generation tool (model not reported by tool) | `static/game/stage-5.webp` — chapter V: nächtlicher Marktplatz mit Brunnen und Runenkreisen | 2026-11-12 |
| `levels/level-47.webp` | image_generation tool (model not reported by tool) | `static/game/stage-5.webp` — chapter V: nächtlicher Marktplatz mit Brunnen und Runenkreisen | 2026-11-12 |
| `levels/level-48.webp` | image_generation tool (model not reported by tool) | `static/game/stage-5.webp` — chapter V: nächtlicher Marktplatz mit Brunnen und Runenkreisen | 2026-11-12 |
| `levels/level-49.webp` | image_generation tool (model not reported by tool) | `static/game/stage-5.webp` — chapter V: nächtlicher Marktplatz mit Brunnen und Runenkreisen | 2026-11-12 |
| `levels/level-50.webp` | image_generation tool (model not reported by tool) | `static/game/stage-5.webp`, `static/game/stage-6.webp` — chapter V: nächtlicher Marktplatz mit Brunnen und Runenkreisen | 2026-11-12 |
| `levels/level-51.webp` | image_generation tool (model not reported by tool) | `static/game/stage-6.webp` — chapter VI: blau-goldener Thronsaal | 2026-11-12 |
| `levels/level-52.webp` | image_generation tool (model not reported by tool) | `static/game/stage-6.webp` — chapter VI: blau-goldener Thronsaal | 2026-11-12 |
| `levels/level-53.webp` | image_generation tool (model not reported by tool) | `static/game/stage-6.webp` — chapter VI: blau-goldener Thronsaal | 2026-11-12 |
| `levels/level-54.webp` | image_generation tool (model not reported by tool) | `static/game/stage-6.webp` — chapter VI: blau-goldener Thronsaal | 2026-11-12 |
| `levels/level-55.webp` | image_generation tool (model not reported by tool) | `static/game/stage-6.webp` — chapter VI: blau-goldener Thronsaal | 2026-11-12 |
| `levels/level-56.webp` | image_generation tool (model not reported by tool) | `static/game/stage-6.webp` — chapter VI: blau-goldener Thronsaal | 2026-11-12 |
| `levels/level-57.webp` | image_generation tool (model not reported by tool) | `static/game/stage-6.webp` — chapter VI: blau-goldener Thronsaal | 2026-11-12 |
| `levels/level-58.webp` | image_generation tool (model not reported by tool) | `static/game/stage-6.webp` — chapter VI: blau-goldener Thronsaal | 2026-11-12 |
| `levels/level-59.webp` | image_generation tool (model not reported by tool) | `static/game/stage-6.webp` — chapter VI: blau-goldener Thronsaal | 2026-11-12 |
| `levels/level-60.webp` | image_generation tool (model not reported by tool) | `static/game/stage-6.webp` — chapter VI: blau-goldener Thronsaal | 2026-11-12 |

## game/assets/ — ability icons (2026-11-12)

Three 256×256 transparent icons for the ability bar, drawn in the same pixel
language as the backgrounds and colour-keyed off the chapter palette: wind in
cyan, storm in amber-gold with a cyan-lit cloud, earth in ochre with gold
facets. Rendered on a flat `#FF00FF` key, then hard alpha from distance to
magenta, magenta despill, crop to the alpha bounding box, median-pool to a
64×64 art grid, nearest ×4 back to 256×256 (same pipeline as `heroes/`).
Alpha is 8-bit but only ever 0 or 255, no magenta fringe survives (measured 0
fringe pixels on all three), and each silhouette still reads at the 44 px the
ability bar draws them. No text, no frame.

| File | Model | Reference images passed in | Date |
| --- | --- | --- | --- |
| `assets/ability-wind.webp` | image_generation tool (model not reported by tool) | none — style derived from `static/game/stage-1.webp` | 2026-11-12 |
| `assets/ability-storm.webp` | image_generation tool (model not reported by tool) | none — style derived from `static/game/stage-1.webp` | 2026-11-12 |
| `assets/ability-earth.webp` | image_generation tool (model not reported by tool) | none — style derived from `static/game/stage-1.webp` | 2026-11-12 |
