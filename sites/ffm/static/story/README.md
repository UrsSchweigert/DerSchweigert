# Arithmo Slayer story dioramas

Full-screen, layered paper-theatre scenes for the campaign story
(*The Hollow Crown*): an intro, an opening for each act, one scene per level,
and the finish. Each scene is 3-4 PNG cutout layers moving in relation to one
another, a lighting overlay, and English/German subtitles on top.

This folder ships with the game: the website deploy syncs `static/`, and the
app bundle copies what `mobile/scripts/copy-assets.mjs` keeps (the generation
sources, reference sheets, art bible and `preview.html` stay web-side). Only
the intro is wired into the game so far — it plays on the first open of an
install and again before level 1 (see [Integration](#integration)).

## Layout

| Path | Contents |
| --- | --- |
| `player/` | `diorama-player.js` (ES module, no game dependency) and its CSS |
| `scenes/index.json` | every scene and the slot it plays in (`intro`, `act`, `level`, `finish`) |
| `scenes/<id>/scene.json` | layers, motion, lighting, subtitles (source of truth) |
| `scenes/<id>/*.webp` | final layers (backdrop opaque, others with alpha) |
| `scenes/<id>/subtitles.{en,de}.vtt` | generated WebVTT copies of the cues |
| `sources/<id>/` | art packet (`layers.json`: prompts, references, retouches) and raw renders |
| `references/` | approved hero reference sheet |
| `tools/` | cutout, encoding and subtitle scripts |
| `ART-BIBLE.md` | consistency rules every layer is reviewed against |
| `preview.html` | development preview |

## Scene format (`scene.json`)

```jsonc
{
  "id": "intro",
  "slot": { "type": "intro" },            // or { "type": "level", "level": 12, "when": "before" } / { "type": "finish" }
  "title": { "en": "…", "de": "…" },
  "duration": 42,                         // seconds; a Continue button appears at the end
  "layers": [                             // back to front, 3-4 entries, first is the backdrop
    { "id": "backdrop", "role": "backdrop", "src": "backdrop.png",
      "x": -48, "y": -150, "width": 2016, // placement on the 1920×1080 stage (height follows the PNG)
      "motion": [{ "t": 0, "x": 0, "scale": 1 }, { "t": 42, "x": -20, "scale": 1.03 }] }
  ],
  "lighting": {
    "ambient": "linear-gradient(…)",      // multiplied over the stage
    "glows": [{ "layer": "hero", "x": 1420, "y": 760, "radius": 220, "color": "rgba(…)", "from": 21, "pulse": 2.4 }],
    "motes": { "count": 24, "color": "#9fdcff" },
    "events": [{ "type": "flash", "at": 27, "duration": 1.2, "color": "#bfe8ff" }] // "flash" brightens (screen), "dim" darkens (multiply, default intensity 0.6)
  },
  "subtitles": [{ "start": 0.8, "end": 5.2, "text": { "en": "…", "de": "…" } }]
}
```

Motion keyframes accept `x`, `y`, `scale`, `rotate`, `opacity` and are eased
with smoothstep. Layers scale around 50% / 60% of the stage.

A character can change pose mid-scene: add the second pose as its own layer
with `"poseOf": "<base layer id>"`, the same role and motion, and crossfade the
two with `opacity` keyframes (ideally under a `flash`). Poses share their base
layer's depth plane, so they don't count towards the 3-4 planes.

## Producing a scene

Use only generators approved in [ART-BIBLE.md](ART-BIBLE.md): `flux-1/schnell`
(Apache-2.0) or a `flux-pro` API model for commercial work. FLUX.1 [dev] is
excluded — its licence does not permit commercial use of the outputs.

The intro pilot was rendered entirely with the GPT image model, which takes
several reference images at once and held the hero on-model across poses. Two
faster, cheaper paths were verified on 2026-11-10:

- **Scenery** — `fal-ai/flux-1/schnell`: about 4 seconds and $0.003 per image,
  re-runnable from a seed, and strong on the paper-cardstock look.
- **Characters** — `fal-ai/flux-pro/kontext` ($0.04 per image): fed
  `references/hero-reference-sheet.png`, it kept the hair, scarf, clasp and
  sword on a new pose. It takes one reference per call, so check the hem,
  tatters and props against the sheet.

Local DiffusionKit is not practical for the set: about 30 minutes per render
here, and its 77-token prompt limit makes it fragile.

1. **Art packet** — write `sources/<id>/layers.json` from the story text and
   `ART-BIBLE.md`: one prompt per layer plus the reference images it is
   rendered against.
2. **Backdrop** — a full-bleed 1536×1024 render (no frame, no characters, calm
   lower third), using the hero sheet and the act's `static/game/stage-N.png`
   or title art as style references. Save the raw render as
   `sources/<id>/backdrop-raw.png` and an opaque copy as `scenes/<id>/backdrop.png`.
3. **Midground, foreground and characters** — rendered as one cutout with a
   cream paper border on plain pure white, referencing the scene's backdrop
   (scenery) or `references/hero-reference-sheet.png` (hero), saved as
   `sources/<id>/<layer>-raw.png`, then cut out:

   ```sh
   python3 sites/ffm/static/story/tools/cutout.py sources/<id>/hero-raw.png scenes/<id>/hero.png
   ```

   Record any manual retouch of a raw render in `layers.json`.
4. **Encode** — shipped layers are WebP (quality 80), which keeps the cutout
   alpha and cuts an intro-sized scene from ~9 MB to under 1 MB with no visible
   difference at display size. WebP is supported by every target browser and by
   the app's iOS 15+ / Android WebView baseline:

   ```sh
   python3 sites/ffm/static/story/tools/encode.py sites/ffm/static/story/scenes/<id>/*.png
   ```

   The PNG inputs are the archive in `sources/`; `scenes/` holds only what ships.

5. **Scene** — write `scene.json`, add it to `scenes/index.json`, generate
   subtitles, preview, and run the tests:

   ```sh
   node sites/ffm/static/story/tools/build-subtitles.mjs
   python3 -m http.server 8190 --directory sites/ffm/static/story   # open /preview.html
   node --test sites/ffm/static/story/tests/*.test.mjs
   ```

6. **Review** — an independent reviewer compares every layer and preview frame
   with `ART-BIBLE.md` and the reference sheet before the scene is accepted.

## Integration

The intro is wired in `game/main.js` through
[game/story-intro.js](../game/story-intro.js), which owns the "when":

- **First open of an install** — the prologue (`intro`) plays once, right after
  the loading screen, before the title screen is used. The device-wide flag
  `arithmoslayer:story-intro-open-shown` (localStorage) records that.
- **Act openings** — `scenes/index.json` maps each act to its first level
  (1, 11, 21, 31, 41, 51); starting that level plays the act's opening. Each
  scene plays at most once per run.
- **No stacking on the first run** — when the prologue has just played, the
  act I opening is skipped, so a new player never gets two scenes before the
  first level. Other levels, practice runs and shapes mode play nothing.
- **Replay on demand** — the dragon-circle replay button at the start of the
  title bar, left of Login (`#btn-replay-intro`), plays the prologue again,
  however often the player asks for it. It never rewrites the first-open flag,
  and `story-intro.js` keeps one scene on screen at a time.

Playing a scene:

The scene is always presented in landscape. A portrait window or a
portrait-held phone gets the same treatment: the player is laid out in the
screen's landscape box (width and height swapped) and rotated 90°, so the
16:9 stage fills the screen edge to edge instead of sitting in a letterbox
band. Turning the device to landscape mid-scene drops back to an unrotated
box on the next resize, and no native orientation lock is involved.

```js
import { createDioramaPlayer } from '../story/player/diorama-player.js';

const player = createDioramaPlayer({ container: document.body, scene, baseUrl, locale: getLocale() });
const result = await player.play(); // 'ended' or 'skipped'
player.destroy();
```

The stylesheet (`story/player/diorama-player.css`) is linked from
`index.html`. Scenes stay optional and skippable: a missing or broken scene
logs and continues into the level.

Still to come: an act opening before each act's first level, a `before` scene
when a level is started from the level-clear "Next level" button, and the
finish after level 60's "Finish game". Pause the player with `pause()` and
`resume()` from the app lifecycle hooks.
