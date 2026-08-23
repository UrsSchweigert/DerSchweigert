---
description: >
  Phase 4 LEAD — Canvas renderer and all game entity sprites.
  You are the LEAD agent. Decompose into per-file worker tasks. After each worker, read the
  output file and verify: correct scale model, all animation states present, no hardcoded
  canvas sizes, pixel-font covers all required characters. Spawn fix workers if needed.
tools:
  - read_file
  - run_in_terminal
  - get_errors
  - replace_string_in_file
  - runSubagent
---

# Phase 4 Lead — Renderer + Entities

## Your responsibilities

1. Read `sites/ffm/static/game/levels.js` to know fiend type names.
2. Read `ffm-math-game.prompt.md` art direction, hero, and fiend sections in full.
3. Dispatch the worker tasks below. After each, read the file and run `get_errors`.
4. Verify the review criteria yourself. Issue fix briefs as needed (max 2 rounds).
5. The `demo.html` file does not need testing — it's a visual review tool.
6. Report `SUCCESS` or `FAILED:<reason>`.

---

## Worker task decomposition

### Worker 1 — Constants + background renderer
**File:** `sites/ffm/static/game/renderer.js` (initial, background only)

Micro-brief must specify:
- Constants block: `LOGICAL_PX=4`, `CANVAS_W=800`, `CANVAS_H=450`, `GROUND_Y=340`, `HERO_X=120`
- `Renderer` class constructor + `clear()` + `drawBackground(scrollX)`
- Layer 0 sky: gradient `#1a1a3e` → `#4a3060`, 3 clouds at fixed x positions
- Layer 1 midground: `scrollX * 0.3 % CANVAS_W` offset, 4 hills + 1 castle silhouette
- Layer 2 ground: `scrollX % CANVAS_W` offset, ground strip `#3a2a1a`, grass tufts, tile seams
- All wrapping must tile seamlessly (draw layer twice if needed to cover canvas width)

### Worker 2 — Speech bubble + pixel font
**File:** `sites/ffm/static/game/renderer.js` (append to class)

Micro-brief must specify:
- `drawSpeechBubble(x, y, text)` method
- Rounded rect: 8-logical-px corners via `fillRect` approximation (no `arc`), white fill, 2-px black border
- Triangle tail: 3-point polygon pointing down-left toward `(x, y)`, white interior, black border
- `drawPixelText(ctx, text, x, y, colour)`: private method using `PIXEL_FONT` lookup
- `PIXEL_FONT`: 5×7 binary matrices for characters `0123456789+-×÷?= ` (provide all matrices)

### Worker 3 — HUD + timer bar
**File:** `sites/ffm/static/game/renderer.js` (append to class)

Micro-brief must specify:
- `drawHUD(hearts, maxHearts, score, combo, levelLabel)` — hearts top-left, score top-right, level centred
- Filled heart: diamond shape (two rects + top two squares) in red `#e02020`; empty: grey `#404040` outline
- `drawTimerBar(x, y, w, ratio)` — ratio 0–1; colour `#40c040` > 0.5, `#c0c040` 0.25–0.5, `#c04040` < 0.25
- `drawBanner(text)` — semi-transparent dark overlay + large pixel text centred

### Worker 4 — Entity base + Hero
**File:** `sites/ffm/static/game/entities.js` (initial)

Micro-brief must specify:
- `Entity` base class: constructor, `update(dt)` with frame counter, `setState(s)`, `get state()`
- `Hero` class: all 6 states (`idle`, `swing`, `hurt`, `victory`, `walk`, `dead`),
  exact frame counts from spec table, auto-return to `idle` after transient states
- Hero `draw(ctx)` using `LOGICAL_PX` scale: body rects in specified palette colours,
  sword as a wide rectangle in `#e8d44d`, pivot at `(HERO_X, GROUND_Y)`
- Sword arc in `swing` state: offset sword tip by `+8 * LOGICAL_PX` in x per frame

### Worker 5 — Slimeling + Bonehead
**File:** `sites/ffm/static/game/entities.js` (append)

Micro-brief must specify: `Fiend` base class (extends Entity) with `hp`, `hit()`, `attack()`,
`isDead` getter, `problem` property, `wasRequeued` boolean (default `false`). All seven
fiend states must be implemented:

| State | Behaviour |
|-------|-----------|
| `walk` | moves left at ~50 canvas px/s |
| `idle` | stopped, speech bubble shows question |
| `attack` | lunge forward then step back |
| `reveal` | stands still; bubble shows full answer string e.g. `"7 + 5 = 12"` |
| `retreat` | turns around, moves right off canvas; on exit canvas-right: emit `'retreated'` event |
| `hit` | white flash, stagger back |
| `death` | particle explosion, emits `'dead'` event when particles gone |

Then `Slimeling` and `Bonehead` with exact pixel sizes,
palettes, walk animations, attack/hit/death states from spec. Death state spawns particle array.

### Worker 6 — Toadlord + Magelitch + demo.html
**Files:** `sites/ffm/static/game/entities.js` (append), `sites/ffm/static/demo.html`

Micro-brief must specify: `Toadlord` and `Magelitch` with squash-stretch and hover walk
respectively. `demo.html`: canvas 800×450, loads `renderer.js` and `entities.js` as modules,
instantiates one of each entity, cycles states every 2s, shows state label in top-left.

---

## Review criteria (lead checks after each worker)

- `LOGICAL_PX`, `CANVAS_W`, `CANVAS_H` used throughout — no hardcoded `4`, `800`, `450`
- `PIXEL_FONT` covers all characters: `0123456789+-×÷?= `
- Every animation state in the spec table is implemented for Hero and all 4 fiends:
  `walk`, `idle`, `attack`, `reveal`, `retreat`, `hit`, `death`
- `reveal` state: speech bubble text is the full equation string, not just the answer
- Auto-transition to `idle` after `swing`, `hurt`, `victory` (not for `dead`)
- Fiend `hit()` decrements HP, triggers correct state based on remaining HP
- Background tiling is seamless (no gap at scroll wrap point)


  "Hero System"

## Scale model (must be exact)

```
LOGICAL_PX = 4          // each logical pixel = 4×4 canvas pixels
CANVAS_W = 800
CANVAS_H = 450
GROUND_Y = 340          // y-coordinate of the ground line in canvas pixels
HERO_X = 120            // hero anchor x (centre of sprite)
```

## File: `sites/ffm/static/game/renderer.js`

Export a `Renderer` class:

```js
class Renderer {
  constructor(canvas)       // stores ctx, initialises layer state
  clear()                   // clearRect full canvas
  drawBackground(scrollX)   // 3-layer parallax (see below)
  drawEntity(entity)        // delegates to entity.draw(ctx)
  drawSpeechBubble(x, y, text)  // white rounded rect + pixel-font text + tail
  drawTimerBar(x, y, w, ratio)  // green→yellow→red bar
  drawHUD(hearts, maxHearts, score, combo, levelLabel)
  drawBanner(text)          // full-screen level-clear / game-over overlay
}
```

### Background layers (parallax)

Use only `fillRect`, `fillStyle`, and linear gradient for the sky.

**Layer 0 — Sky (no scroll):**
- Top 60 % of canvas: linear gradient from `#1a1a3e` (top) to `#4a3060` (horizon)
- 2–3 pixel-art clouds (groups of 6–8 overlapping white `fillRect` blocks, each 4×4 px)
- Clouds drawn at fixed positions; no scroll (they are in the far background)

**Layer 1 — Midground (scroll at 0.3× speed):**
- Offset by `scrollX * 0.3 % CANVAS_W` (wrap with modulo)
- 3–4 hill silhouettes: each a series of `fillRect` blocks forming a rounded mound, colour `#2a4a2a`
- 1 distant castle silhouette at far right (battlements = stacked rectangles, colour `#1a2a3a`)

**Layer 2 — Ground (scroll at 1× speed):**
- Offset by `scrollX % CANVAS_W` (wrap with modulo)
- Ground strip from `GROUND_Y` to canvas bottom, colour `#3a2a1a`
- Grass tufts (groups of 2–3 tall thin rectangles in `#4a7a2a`) placed every ~80 logical px
- Tile seams (1 px wide dark lines) every 16 logical px

### Speech bubble

Rounded rectangle (radius 8 logical px) in white with 2-logical-px black border.
Triangle tail pointing down-left toward the speaking fiend.
Text drawn using `drawPixelText` (see below). Positioned above the fiend's head.

### Pixel font (`drawPixelText`)

Draw digits 0–9, +, −, ×, ÷, ?, = using `fillRect` blocks (5×7 logical pixel grid per char,
1 logical px spacing between chars). Define a `PIXEL_FONT` constant: an object mapping each
character to a 5×7 binary matrix (1 = filled, 0 = empty). Implement at minimum: `0123456789+-×÷?= `.

### HUD

- Hearts: filled red heart icon (diamond + two circles approximation) vs empty grey outline
- Score: `drawPixelText` in yellow, top-right
- Combo: small orange text below score, hidden when combo < 2
- Level label: centred top, white pixel text

## File: `sites/ffm/static/game/entities.js`

Export `Hero` and four fiend classes: `Slimeling`, `Bonehead`, `Toadlord`, `Magelitch`.
Each class extends a `Entity` base class.

### `Entity` base class

```js
class Entity {
  constructor(x, y)
  update(dt)        // advance animation frame timer
  draw(ctx)         // abstract — implemented by subclass
  get state()       // current animation state string
  setState(s)       // transition to new state, reset frame counter
}
```

### `Hero` class

- Fixed at `x = HERO_X`, `y = GROUND_Y`
- Sprite size: 24 × 32 logical px, drawn at `LOGICAL_PX` scale
- Colour palette: skin `#f4c584`, hair `#5a3e28`, armour `#c8c8d4`, sword `#e8d44d`
- Animation states and frame counts:

| State | Frames | Duration per frame |
|-------|--------|--------------------|
| `idle` | 2 | 20 game-ticks (breathing: torso offset ±1 logical px) |
| `swing` | 3 | 4 ticks each (sword arc right) |
| `hurt` | 2 | 6 ticks each (red flash + step left 4 px) |
| `victory` | 2 | 12 ticks (sword raised) |
| `walk` | 4 | 6 ticks each |
| `dead` | 3 | 10 ticks (fall + fade to grey) |

After `swing`, `hurt`, `victory` complete, auto-transition back to `idle`.
After `dead` completes, stay in `dead` (do not loop).

### Fiend base class

```js
class Fiend extends Entity {
  constructor(x, y, config)   // config: {hp, type, palette}
  get isDead()                // hp === 0
  hit()                       // hp--; setState('hit') if hp>0, setState('death') if hp===0
  attack()                    // setState('attack')
  get problem()               // current math problem string (set by game loop)
}
```

Fiends walk left at ~50 canvas px / second. They stop when `x < HERO_X + 100` and enter
`idle` state (speech bubble shows problem). Animation states:

| State | Frames | Notes |
|-------|--------|-------|
| `walk` | 4 | default state |
| `idle` | 2 | stopped, waiting for answer |
| `attack` | 3 | lunge forward, then retreat |
| `hit` | 2 | flash white, stagger back 8 px |
| `death` | 5 | explode into 8–12 coloured particles |

### Slimeling (Chapter 1 — Addition)

- Size: 16 × 16 logical px
- Palette: body `#52b84d`, dark `#2e7a2b`, highlight `#c8f0a0`
- Shape: rounded blob (large central rect + corner rects trimmed)
- Walk: bob up/down ±2 logical px
- Death particles: green squares

### Bonehead (Chapter 2 — Subtraction)

- Size: 16 × 24 logical px
- Palette: bone `#ddd5c0`, shadow `#a09070`, highlight `#f0f0e8`
- Shape: skull (circle-approximation) on ribcage (vertical lines)
- Walk: rattling step (offset arms ±1 logical px alternately)

### Toadlord (Chapter 3 — Multiplication)

- Size: 20 × 20 logical px
- Palette: body `#7a5230`, dark `#4a3018`, accent `#c4a050`
- Shape: wide stocky body, large hands
- Walk: heavy stomp (squash/stretch: scale height ±1 logical px)

### Magelitch (Chapter 4 — Division)

- Size: 16 × 28 logical px
- Palette: robe `#4040c0`, dark `#2020a0`, glow `#a0a0ff`
- Shape: tall robed figure, pointed hat
- Walk: hovering (oscillate y ±3 logical px, no leg movement)

## File: `sites/ffm/static/demo.html`

A standalone HTML page (not shipped) that:
1. Creates the canvas
2. Instantiates `Renderer`, `Hero`, one of each fiend type
3. Cycles through every animation state of every entity automatically (2 s per state)
4. Labels the current state in the HUD
5. Has a keyboard shortcut `[Space]` to pause/unpause

This file is only for development review — it is NOT linked from `index.html`.

## Done when

All files exist with no JS syntax errors. Open `demo.html` in a browser and confirm all
sprites and all animation states render visually (manual check).
