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
