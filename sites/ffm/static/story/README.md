# Arithmo Slayer story dioramas

Full-screen, layered paper-theatre scenes for the campaign story
(*The Stolen Dawn*): a prologue, an opening for each of the six acts, and the
finish (*A World in Balance*) after level 60. Each scene is 3-4 cutout layers
moving in relation to one another, a lighting overlay, and English/German text
cards on top. The scenes are silent: there is no voice-over, and the story is
told by the parchment cards alone (see [Cards and pacing](#cards-and-pacing)).

This folder ships with the game: the website deploy syncs `static/`, and the
app bundle copies what `mobile/scripts/copy-assets.mjs` keeps (the generation
sources, reference sheets, art bible, tools and `preview.html` stay web-side).
The prologue plays on the first open of an install, every act opening plays
when its first level starts, and the finish plays the first time level 60 is
finished (see [Integration](#integration)).

Most of the art was painted for an earlier draft of the story. A first pass
(2026-11-18) replaced the backdrops of acts II, IV, V and VI and the finish's
dawn, and added the ancient dragon to act V; the midgrounds and foregrounds
were kept. What still does not match the cards:

- **Act II**: the backdrop is the mountain range the cards climb, but the
  wheat, windmill and haystacks of the old harvest scene still stand in front.
- **Act III**: unchanged, a night forest.
- **Act IV**: the backdrop is the buried stone city; the midground and
  foreground are still the meadow and timber hall.
- **Act V**: the backdrop is the silent capital with still banners; the stalls
  stand on the cobbles instead of floating, and there is a fountain where the
  cards have clocks running backward.
- **Act VI**: the backdrop is the climb to the throne room; the midground is
  still the old hall.
- **Finish**: the throne-room backdrop is gone, so the opening cards (the crown
  cracks, dawn pours through the throne-room windows) play over act VI's hall
  pillars standing in the new dawn landscape.
- No scene shows fiends any more (the owner took them out of every scene on
  2026-11-18), although cards in acts I, III and V still talk about them.

## Layout

| Path | Contents |
| --- | --- |
| `player/` | `diorama-player.js` (ES module, no game dependency), its CSS, and the generated paper-grain tile |
| `scenes/index.json` | every scene and the slot it plays in (`intro`, `act`, `level`, `finish`) |
| `scenes/<id>/scene.json` | layers, motion, lighting, cards (source of truth) |
| `scenes/<id>/*.webp` | final layers (backdrop opaque, others with alpha) |
| `scenes/<id>/subtitles.{en,de}.vtt` | generated WebVTT copies of the cards |
| `sources/<id>/` | art packet (`layers.json`: prompts, references, retouches) and raw renders |
| `references/` | approved hero reference sheet |
| `tools/` | cutout, encoding, paper-grain, card timing, card measuring and subtitle scripts |
| `ART-BIBLE.md` | consistency rules every layer is reviewed against |
| `preview.html` | development preview |

## Scene format (`scene.json`)

```jsonc
{
  "id": "act-2",
  "slot": { "type": "act", "act": 2, "fromLevel": 11 }, // or { "type": "intro" } / { "type": "finish" }
  "title": { "en": "Act II: The Long Country", "de": "Akt II: Das weite Land" },
  "duration": 43,                         // seconds, set by tools/card-timing.mjs; the scene ends by itself
  "layers": [                             // back to front, 3-4 planes, first is the backdrop
    { "id": "backdrop", "role": "backdrop", "src": "backdrop.webp",
      "x": -48, "y": -150, "width": 2016, // placement on the 1920×1080 stage (height follows the image)
      "motion": [{ "t": 0, "x": 0, "scale": 1 }, { "t": 43, "x": -20, "scale": 1.03 }] }
  ],
  "lighting": {
    "ambient": "linear-gradient(…)",      // multiplied over the stage
    "glows": [{ "layer": "hero", "x": 1420, "y": 760, "radius": 220, "color": "rgba(…)", "from": 21, "pulse": 2.4 }],
    "motes": { "count": 24, "color": "#9fdcff" },
    "events": [                           // "flash" brightens (screen), "dim" darkens (multiply, default intensity 0.6)
      { "type": "dim", "atCue": 5, "offset": -0.2, "at": 38.1, "duration": 2.4, "color": "#0b1024" }
    ]
  },
  "subtitles": [                          // the cards, in order
    { "start": 0.8, "end": 8.5, "text": { "en": "The path climbs …", "de": "Der Pfad steigt …" } },
    { "start": 32.8, "end": 37.9, "text": { "en": "**A steady mind …**", "de": "**Ein ruhiger Geist …**" } },
    { "start": 38.3, "end": 42.4, "kind": "title",
      "text": { "en": "Act II: The Long Country · Levels 11–20", "de": "Akt II: Das weite Land · Level 11–20" } }
  ]
}
```

Motion keyframes accept `x`, `y`, `scale`, `rotate`, `opacity` and are eased
with smoothstep. Layers scale around 50% / 60% of the stage.

A character can change pose mid-scene: add the second pose as its own layer
with `"poseOf": "<base layer id>"`, the same role and motion, and crossfade the
two with `opacity` keyframes (ideally under a `flash`). Poses share their base
layer's depth plane, so they don't count towards the 3-4 planes. The finish
uses the same trick for whole planes: act VI's hall and steps crossfade into
act I's village and meadow under a flash.

A layer `src` may point into another scene's folder (`../act-6/midground.webp`).
The finish is built that way from the art of act I, act VI and the prologue;
its only own image is the dawn backdrop (`scenes/finish/dawn.webp`).

A layer taken out of a scene goes out of the scene folder too, so the bundle
ships only what plays: the fiend groups of acts I–VI were removed that way,
and their packet entries moved to `"removed"` in `sources/<id>/layers.json`
(the images stay in git history).

## Cards and pacing

The cards are the story. Each card is one paragraph of the story text; a long
paragraph is split at a sentence boundary so a card holds two or three short
sentences at most (the tests cap a card at 150 English / 170 German
characters and three sentences). Text between `**…**` is a spellbook line and
is set in bold italics; a `\n` breaks the line. The player builds the card from
text nodes and `<strong>`, never from HTML.

Every scene has exactly one heading card (`"kind": "title"`), shown slightly
heavier. An act's heading is its last card and names the act's real levels,
which the tests derive from `index.json` (`fromLevel` up to the next act's
first level): act I is levels 1–10, act II (*The Long Country*) 11–20, act III
(*The Whispering Woods*) 21–30, and so on to act VI, 51–60. The prologue ends
on *The Stolen Dawn*; the finish opens on *A World in Balance*.

Without a voice-over the reader sets the pace, so the timing comes from the
text. `tools/card-timing.mjs` gives every card

```
seconds = max(4, 1.5 + visible characters / 15)
```

in each locale and uses the slower one (German runs about a fifth longer, so
it usually sets the window). Cards follow each other with 0.4 s of blank paper,
the first waits 0.8 s for the scene to fade in, and the scene ends 0.6 s after
the last card. When a scene's length changes, the tool stretches its keyframes
and glow windows by the same factor; a lighting event with `"atCue"` (and an
optional `"offset"`) is pinned to its card instead. Skip stays on screen for
the whole scene, and Esc skips too.

After editing any card:

```sh
node sites/ffm/static/story/tools/card-timing.mjs      # retime every scene.json
node sites/ffm/static/story/tools/build-subtitles.mjs  # regenerate the .vtt copies
node --test sites/ffm/static/story/tests/*.test.mjs
python3 sites/ffm/static/story/tools/measure-cards.py sites/ffm/static   # needs Playwright
```

`measure-cards.py` renders every card of every scene, in both languages, with
the real player CSS in Chrome at 320×568 and 390×844 (portrait phones, turned),
568×320 and 844×390 (landscape phones) and in the web's 390×844 desktop phone
frame (letterboxed), and fails when a line runs past the card, the card leaves
the screen or reaches Skip, or a card covers more than 42 % of the scene. Run it
against `sites/ffm/mobile/www` too after `npm run copy-assets`. The tests keep a
pessimistic text-only model of the same limits in CI. The card type follows
the landscape box it is read in (`--diorama-text-box`), not the screen, so a
turned portrait phone gets the same size as a landscape one.

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
- **Finish** — "Finish game" on the level-clear card of Campaign I's level 60
  plays the finish (`playFinish()`) over the card, then the victory screen
  follows. It plays the first time an install gets there (device-wide flag
  `arithmoslayer:story-finish-shown`), after the level is already saved, and a
  scene that never ends is given up after `SCENE_WAIT_MAX_MS`. Campaign II
  (Genius), practice and shapes mode never play it. There is no replay button
  for it yet.

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

A scene makes no sound of its own: the title playlist (started by
`beforeScene`) runs on under it at its normal level, and the player creates no
audio element.

The stylesheet (`story/player/diorama-player.css`) is linked from
`index.html`. Scenes stay optional and skippable: a missing or broken scene
logs and continues into the level.

### Why the scene is a canvas

The player paints the whole theatre into a single `<canvas>`: layers with their
contact shadows, the ambient tint, glows, motes, the flash/dim events and the
paper sheet all go through the 2D context, whose `multiply`/`screen` blend
modes match the CSS ones. Subtitles and the skip control stay DOM.

The earlier version built the scene as a stack of DOM layers with
`mix-blend-mode` overlays. That needs a compositor surface per layer, and on a
1440p phone the player held roughly 100 MP of RGBA — hundreds of megabytes —
even after trimming filters and idle overlays. Android WebView then started
dropping raster tiles, which showed as **black rectangles over the artwork**
(iOS was unaffected, and it reproduced locally only when Chrome's GPU memory was
capped, e.g. `--force-gpu-mem-available-mb=64`). The canvas costs one texture
the size of the screen: the same frames paint at 13 % dark pixels with a 40 MB
budget, where the DOM version renders 86 % of the frame as missing content.

Two details worth keeping:

* **The paper grain is an image tile** (`player/paper-grain.webp`, regenerate
  with `python3 tools/paper-grain.py`), never an inline `<feTurbulence>`: Blink
  re-runs an SVG filter whenever the scaled, rotated scene is re-rastered, and
  that path also painted black tiles.
* **Paint at device resolution, no higher** (`MAX_CANVAS_PIXELS`). The artwork
  is upscaled anyway; rasterising the canvas above the screen size only buys
  memory pressure.

Still to come: an act opening when an act's first level is reached through
the level-clear "Next level" button (today the openings play when the level is
started from the title screen), a replay for the finish, and pausing the player
with `pause()` and `resume()` from the app lifecycle hooks.
