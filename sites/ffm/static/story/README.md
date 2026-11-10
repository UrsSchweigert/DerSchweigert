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
| `scenes/index.json` | every scene and the slot it plays in |
| `scenes/<id>/scene.json` | layers, motion, lighting, subtitles (source of truth) |
| `scenes/<id>/*.png` | final layers (backdrop opaque, others RGBA cutouts) |
| `scenes/<id>/subtitles.{en,de}.vtt` | generated WebVTT copies of the cues |
| `sources/<id>/` | art packet (`layers.json`: prompts, references, retouches) and raw renders |
| `references/` | approved hero reference sheet |
| `tools/` | cutout and subtitle scripts |
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

Every layer is rendered with the same reference-image model (GPT image), so
scenery and characters share one paper style. A local DiffusionKit /
FLUX.1-schnell scenery pass was tried for the pilot and dropped: it cannot take
reference images, ignores negative prompts, truncates prompts at 77 tokens, and
took about 30 minutes per backdrop on a 16 GB Mac.

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
4. **Scene** — write `scene.json`, add it to `scenes/index.json`, generate
   subtitles, preview, and run the tests:

   ```sh
   node sites/ffm/static/story/tools/build-subtitles.mjs
   python3 -m http.server 8190 --directory sites/ffm/static/story   # open /preview.html
   node --test sites/ffm/static/story/tests/*.test.mjs
   ```

5. **Review** — an independent reviewer compares every layer and preview frame
   with `ART-BIBLE.md` and the reference sheet before the scene is accepted.

## Integration

The intro is wired in `game/main.js` through
[game/story-intro.js](../game/story-intro.js), which owns the "when":

- **First open of an install** — the intro plays once, right after the loading
  screen, before the title screen is used. The device-wide flag
  `arithmoslayer:story-intro-open-shown` (localStorage) records that.
- **Starting level 1** — the intro plays again on every later run, but at most
  once per run, so the first run never repeats what it just showed. Other
  levels, practice runs and shapes mode never trigger it.

Playing a scene:

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
