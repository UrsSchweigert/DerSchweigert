# Math Fiend Slayer — Full Implementation Specification

## Overview

Implement a browser-based educational math game called **"Math Fiend Slayer"** served at
`ffm.derschweigert.de`. The game is a SNES-era 2-D side-scroller where a sword-wielding hero
stands on the left side of the screen and monsters (fiends, inspired by Final Fantasy enemies)
march in from the right. Each fiend carries a speech bubble displaying a math problem. The player
must solve the problem to let the hero swing the sword and defeat the fiend. Incorrect answers or
timeouts cause the fiend to hit the hero and drain his life pool. After every enemy in a wave is
defeated the hero marches right and the next wave begins. The game spans **40 levels** covering
arithmetic from "1+1" to "7 × 143".

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Single static `index.html` + vanilla JavaScript (ES2022 modules, no build step) |
| Art | All sprites drawn procedurally with the Canvas 2D API (no image files) |
| Audio | Web Audio API (procedural chiptune SFX + looping BGM) |
| Backend | Python 3.12 + Flask — **pure JSON REST API only** (no Jinja2 templates) |
| Auth | JWT (short-lived access token in memory + httpOnly refresh cookie) + bcrypt |
| Storage | SQLite via SQLAlchemy (local dev); DynamoDB-backed Lambda in production |
| Deployment | Static assets → dedicated S3 bucket → dedicated CloudFront distribution; API → API Gateway + Lambda; all in a new `infra/terraform/sites/ffm/` Terraform stack |

> **Why static HTML?** The game canvas is 100 % JavaScript — there is nothing to server-render.
> Serving `index.html` from CloudFront/S3 has zero latency overhead and costs nothing at scale.
> Flask handles only `/api/*` endpoints (auth + score); all UI state lives in the browser.

Follow the existing repo layout exactly:

```
sites/ffm/
  app/
    __init__.py      # Flask app factory
    config.py        # BaseConfig / ProductionConfig (mirrors derschweigert pattern)
    main.py          # /api/* blueprints (scores, profile, leaderboard)
    models.py        # User, LevelScore (SQLAlchemy models)
    auth.py          # /api/auth/* routes (register, login, refresh, logout)
  lambda/
    handler.py       # Mangum ASGI adapter (same pattern as derschweigert)
  static/
    index.html       # single-page shell — loads the game scripts; served from S3
    game/
      main.js        # entry point: init canvas, game-loop, scene manager
      renderer.js    # all canvas drawing (sprites, background, UI)
      entities.js    # Hero, Fiend base class + per-type fiend subclasses
      levels.js      # level definitions, math problem generator
      input.js       # keyboard listener, multiple-choice UI, timer bar
      audio.js       # Web Audio API chiptune engine
      hud.js         # hearts, score display, level indicator
      api.js         # fetch wrappers for /api/* (auth + scores)
    styles.css
  tests/
    test_app.py
    test_levels.py
  Dockerfile
  requirements.txt
```

---

## Math Curriculum — 40 Levels

Levels are grouped into four chapters. Problem difficulty increases within each chapter.

### Chapter 1 — Addition (Levels 1–10)

| Levels | Operand range | Example |
|---|---|---|
| 1–2 | a, b ∈ [1, 5] | 3 + 2 = ? |
| 3–4 | a, b ∈ [1, 10] | 7 + 6 = ? |
| 5–6 | a ∈ [1, 20], b ∈ [1, 10] | 17 + 8 = ? |
| 7–8 | a, b ∈ [1, 20] | 18 + 15 = ? |
| 9–10 | a, b ∈ [1, 50] | 43 + 37 = ? |

### Chapter 2 — Addition & Subtraction (Levels 11–20)

Subtraction is always non-negative (a ≥ b).

| Levels | Operand range | Operations |
|---|---|---|
| 11–13 | a ∈ [5, 20], b ∈ [1, a] | +, − |
| 14–16 | a, b ∈ [1, 30] | +, − |
| 17–20 | a, b ∈ [1, 100] | +, − |

### Chapter 3 — Multiplication (Levels 21–30)

| Levels | Table range | Max product |
|---|---|---|
| 21–22 | × 2, × 3 | ~30 |
| 23–24 | × 2–4 | ~40 |
| 25–26 | × 2–6 | ~60 |
| 27–28 | × 2–9 | ~90 |
| 29–30 | × 2–12, larger a | ~300 |

### Chapter 4 — All Four Operations (Levels 31–40)

Division always divides evenly (no remainders).

| Levels | Operations | Max result |
|---|---|---|
| 31–33 | +, −, ×, ÷ | ~200 |
| 34–36 | +, −, ×, ÷ | ~500 |
| 37–40 | +, −, ×, ÷ | ~1000 |

**Problem generator rules:**
- Never generate a problem whose answer equals the answer of any of the three distractor options
  by accident (distractors must be distinct from the correct answer and from each other).
- For multiple-choice (levels 1–5) generate three plausible distractors: one off-by-one, one
  off-by-a-small-multiple, one random within a similar range.
- Seed RNG with `level_number + timestamp_millis` so different sessions produce different problems
  within the same level.

---

## Input System

### Levels 1–5 — Multiple Choice

- Four large pixel-art buttons arranged in a 2 × 2 grid below the canvas (or overlaid at bottom).
- Buttons show the four candidate answers.
- Player clicks or presses `1`–`4` to select.
- No free-text field shown.

### Levels 6–40 — Free-Text

- A single `<input type="number">` field, auto-focused when the fiend appears.
- Player types the answer and presses `Enter` or clicks the **Strike!** button.
- On mobile the `inputmode="numeric"` attribute triggers a numeric keypad.
- The multiple-choice buttons are hidden.

---

## Timer

The countdown is configurable at the start of each game session:

| Difficulty | Seconds per question |
|---|---|
| Easy | 30 |
| Medium | 20 |
| Hard | 10 |

- The timer is drawn as a horizontal **bar above the enemy** that drains left-to-right.
- The bar is green > 50 %, yellow 25–50 %, red < 25 %.
- When the bar reaches zero it is treated identically to a wrong answer (see below).

---

## Wave & Progression System

### Wrong answer / timeout — re-queue mechanic (learning by repetition)

When the player submits a wrong answer **or** the timer expires:

1. The fiend plays its `attack` animation; the hero plays `hurt` and loses one heart.
2. The input field is cleared and disabled.
3. The fiend transitions to `reveal` state: the speech bubble switches from showing the
   question ("7 + 5 = ?") to showing the **full equation with the correct answer**
   ("7 + 5 = 12") for **2 seconds**. The fiend stands still during this window.
4. After the reveal, the fiend plays a `retreat` animation and walks back off the **right
   edge** of the canvas.
5. The fiend is appended to the end of the **current level's re-queue** with its HP and
   problem preserved. It will be spawned again after all originally-queued fiends have
   appeared.
6. **A level cannot end until every fiend — including all re-queued ones — has been
   defeated.** The wave-clear condition is: `spawnQueue.length === 0 &&
   requeuedFiends.length === 0 && fiends.every(f => f.isDead)`.
7. Combo resets to 0. No score is awarded for the re-queued encounter when it is finally
   defeated (base score only, no speed or combo bonus for that attempt).



**Pace adapts to player speed:**
- Track a rolling average of the player's answer speed over the last five questions
  (`avg_speed = total_time_taken / 5`).
- If `avg_speed < timer_duration × 0.4` (player is fast): reduce spawn interval by 10 %
  (enemies appear faster, more overlap possible).
- If `avg_speed > timer_duration × 0.8` (player is slow): increase spawn interval by 10 %.
- Clamp spawn interval between `1.5 s` (minimum, maximum pressure) and `6 s` (relaxed).
- A wave ends when `wave_size` fiends have been defeated. `wave_size = 3 + floor(level / 5)`.

### Between waves

1. All remaining on-screen fiends fade out with a "retreat" animation.
2. The hero plays a victory pose (sword raised).
3. The hero walks to the right; the background parallax-scrolls to reveal the next scene.
4. A brief "Wave N / M" banner appears over the canvas.
5. New fiends begin spawning after a 2-second delay.

### Between levels

After all waves are cleared:
1. Full-screen "LEVEL CLEAR!" pixel-art banner.
2. Score tally with speed-bonus breakdown.
3. Hero poses, confetti pixels fall.
4. Auto-advance to the next level after 4 seconds, or immediately on button press.

---

## Enemy (Fiend) System

### Fiend types (one per chapter)

| Chapter | Fiend name | Palette | Description |
|---|---|---|---|
| Addition | Slimeling | Green tones | Blob with round eyes, bouncing walk cycle |
| Subtraction | Bonehead | Off-white, grey | Skeleton, rattling walk |
| Multiplication | Toadlord | Brown, purple | Stocky toad-orc, heavy step |
| Division | Magelitch | Blue, violet | Robed mage, hovering |

Within each chapter additional colour variants appear (palette swap, same sprite) to signal HP
level (see below).

### Hit points

| Level range | Base HP |
|---|---|
| 1–15 | 1 |
| 16–22 | 1 or 2 (50/50 random) |
| 23–30 | 2 |
| 31–35 | 2 or 3 (50/50 random) |
| 36–40 | 3–4 |

Each successful answer deals 1 damage. A fiend with > 1 HP shows a crack/damage overlay after
each hit and re-displays the **next** math problem from the current level's pool. The same fiend
stays on screen until its HP reaches 0.

### Fiend behaviour (canvas animation states)

1. **Walking** — cycles a 4-frame walk animation, moves left at constant speed.
2. **Attacking** — wrong answer or timeout: lunge-forward frame → hero flash red → retreat one step.
3. **Reveal** — after attacking: speech bubble switches to show the correct equation ("A op B = answer")
   for 2 seconds; fiend stands still; input is disabled.
4. **Retreat** — after reveal: fiend turns around and walks right off the canvas edge, then re-queues.
5. **Hit** — correct answer: flash white 1 frame → stagger back → (if HP > 0) resume walking.
6. **Death** — HP reaches 0: sprite explodes into 8–12 coloured pixel-particles that fade out.
7. **Idle** (speech bubble) — fiend stops walking when close to the hero and shows the speech
   bubble with the current problem; no problem shown while fiend is mid-attack or revealing.

---

## Hero System

### Appearance

- Big pixel-art warrior (approx. 24 × 32 logical pixels, drawn at 3× scale).
- Holds a large two-handed sword (sword is wider than the hero body).
- Fixed position at x = 15 % of canvas width; y anchored to the ground line.

### Animation states

| State | Trigger | Description |
|---|---|---|
| `idle` | waiting for input | Breathing cycle (torso moves ±1 px every 40 frames) |
| `swing` | correct answer | 3-frame sword arc toward the right |
| `hurt` | wrong answer / timeout | Full-body red flash, step-back 4 px |
| `victory` | wave cleared | Sword raised overhead, 2-frame loop |
| `walk` | between waves | 4-frame walk rightward |
| `dead` | HP = 0 | Fall animation, fade to grey |

### Life pool

| Difficulty | Starting hearts |
|---|---|
| Easy | 7 |
| Medium | 5 |
| Hard | 3 |

Each wrong answer or timeout costs 1 heart. Hearts are drawn as pixel-art heart icons in the HUD
top-left corner. When hearts reach 0: trigger `dead` state → game over screen.

---

## Scoring

```
base_score     = 100
speed_bonus    = round((remaining_time / max_time) * 50)   # 0–50
combo_bonus    = combo_streak * 10                          # combo resets on wrong answer
points_earned  = (base_score + speed_bonus + combo_bonus)
```

- Combo streak: number of consecutive correct answers without a mistake.
- Combo counter shown in HUD top-right, turns gold at streak ≥ 5.
- A wrong answer or timeout resets the combo to 0.
- Score is always > 0 for correct answers even with no speed bonus.

---

## Visual / Art Direction

All art is drawn entirely with the Canvas 2D API. No image files or external assets.

### Scale model

- Logical pixel = 4 × 4 canvas pixels (gives SNES-era blockiness at a comfortable size).
- Canvas resolution: 800 × 450 (16:9). Scale with CSS `max-width: 100%` for responsiveness.

### Background (parallax, 3 layers)

| Layer | Scroll speed | Contents |
|---|---|---|
| Sky | 0 (static) | Gradient from deep blue (top) to light violet (horizon); 2–3 pixel-art clouds |
| Mid-ground | 0.3× hero speed | Rolling hills, silhouette trees, a distant castle |
| Foreground | 1× hero speed | Ground tiles, grass tufts, small rocks |

Background palette: 16 fixed colours per layer (SNES-accurate constraint for authenticity).

### Colour palettes (suggested base)

- **Hero**: `#f4c584` (skin), `#5a3e28` (hair), `#c8c8d4` (armour), `#e8d44d` (sword)
- **Slimeling**: `#52b84d`, `#2e7a2b`, `#c8f0a0`
- **Bonehead**: `#ddd5c0`, `#a09070`, `#f0f0e8`
- **Toadlord**: `#7a5230`, `#4a3018`, `#c4a050`
- **Magelitch**: `#4040c0`, `#2020a0`, `#a0a0ff`

### Speech bubble

- White rounded rectangle (8 px corner radius in logical pixels) with a 2-px black border.
- Tail pointing down-left toward the fiend's mouth area.
- Problem text rendered in a blocky pixel font (draw each digit using `fillRect` strokes rather
  than `ctx.font` — this guarantees the retro look without font loading).

### HUD

- Top-left: row of heart icons (filled = red, empty = grey outline).
- Top-centre: level name e.g. `LEVEL 12` in pixel font.
- Top-right: score counter + combo streak.
- Below canvas: timer bar (full width of canvas), difficulty badge, input field or MC buttons.

---

## Audio (Web Audio API)

Implement a minimal chiptune engine in `audio.js`.

### SFX

| Event | Sound description |
|---|---|
| Correct answer | Short ascending two-note arp (square wave, 80 ms each) |
| Wrong answer | Low descending buzz (sawtooth, 200 ms) |
| Sword swing | Brief noise burst + high blip |
| Enemy death | Descending arp, 4 notes, 50 ms each |
| Hero hurt | Low thud + wobble tone |
| Level clear | 8-note fanfare (square wave) |
| Game over | Descending minor scale |

### BGM

- A 4-bar looping melody per chapter (16 notes per bar, square/triangle oscillators).
- BGM tempo scales slightly with pace adapter: faster enemy spawn → +5 BPM.
- Each chapter has its own key/motif to signal progression.
- Volume kept at 30 % by default; mute toggle button in HUD.

---

## Backend — Flask REST API (`sites/ffm/app/`)

The Flask app is a **JSON-only API**. It serves no HTML. All UI is in `static/index.html`.

### Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | anon | Create user; returns access JWT |
| POST | `/api/auth/login` | anon | Validate credentials; returns access JWT + sets httpOnly refresh cookie |
| POST | `/api/auth/refresh` | refresh cookie | Issue new access JWT |
| POST | `/api/auth/logout` | access JWT | Revoke refresh cookie |
| GET | `/api/profile` | access JWT | Current user's progress + best scores JSON |
| POST | `/api/score` | access JWT | Upsert personal best for a level (body: `{level, score, difficulty}`) |
| GET | `/api/leaderboard` | optional | Top-10 per level (query param `?level=N`) |

### Models (`models.py`)

```python
class User:
    id, username (unique, 3–20 chars), email (unique), password_hash, created_at

class LevelScore:
    id, user_id (FK), level (int 1–40), score (int ≥ 0), difficulty (easy|medium|hard), achieved_at
    # unique constraint: (user_id, level, difficulty) — upsert keeps personal best only
```

### Security requirements

- Passwords hashed with `bcrypt` (cost factor 12).
- Access JWT: short-lived (15 min), signed with `SECRET_KEY`, payload `{sub: user_id, exp}`.
- Refresh token: httpOnly, Secure, SameSite=Strict cookie; 30-day expiry; rotated on each use.
- CORS: allow `https://ffm.derschweigert.de` only (add `http://localhost:*` in dev config).
- Rate-limit `/api/auth/login` and `/api/auth/register` to 10 req/min per IP.
- `/api/score` validates `level ∈ [1,40]` and `score ≥ 0`.
- No session cookies — the Flask app is stateless; state lives in the JWT and DB.

---

## Lambda Handler (`sites/ffm/lambda/handler.py`)

Mirror the pattern from `sites/derschweigert/lambda/handler.py`. Use `Mangum` to wrap the Flask
WSGI app for the API Gateway proxy integration.

---

## Deployment Notes

A **dedicated** `infra/terraform/sites/ffm/` Terraform stack is required from day one. It must
provision:

| Resource | Notes |
|---|---|
| S3 bucket | `ffm-site-<account_id>` — static hosting, versioned, private (OAC only) |
| ACM certificate | `ffm.derschweigert.de` in `us-east-1` (provider alias `aws.us_east_1`) |
| CloudFront distribution | OAC → S3 for static assets; `/api/*` behaviour → API Gateway |
| API Gateway + Lambda | `ffm-api` function; same Mangum pattern as derschweigert |
| Route53 A/AAAA alias | In shared zone `Z02407051JK3BF2C58UEQ` — do **not** recreate the zone |
| DynamoDB table | `ffm-users` and `ffm-scores` (or single-table design) |

Use the existing `infra/terraform/modules/{static_site,api_backend}` modules where possible.
Do **not** touch `infra/terraform/sites/derschweigert/`.

---

## Game Loop Architecture (`main.js`)

```
GameManager
  ├── SceneManager          (title, difficulty-select, game, level-clear, game-over, leaderboard)
  ├── LevelManager          (current level, wave counter, problem generator)
  ├── EntityManager         (hero entity, array of active fiend entities)
  ├── InputManager          (keyboard events, MC button clicks, input field)
  ├── Renderer              (clears canvas each frame, draws layers in z-order)
  ├── AudioEngine           (SFX queue, BGM oscillator graph)
  ├── HUD                   (draws hearts, score, combo, timer bar)
  └── APIClient             (fetch wrappers for /api/score, /api/profile)
```

Main loop: `requestAnimationFrame` at 60 fps. Delta-time capped at 100 ms to prevent spiral of
death after tab-backgrounding.

---

## Implementation Checklist (suggested order)

1. Flask app scaffold (`__init__.py`, `config.py`, `models.py`, `auth.py`) + working `/login`,
   `/register`, `/logout`.
2. `index.html` / `game.html` templates with canvas element and script loading.
3. `renderer.js` — static background with parallax, hero idle sprite.
4. `entities.js` — Hero class with all animation states; single Slimeling fiend walking left.
5. `levels.js` — problem generator for Chapter 1; speech-bubble rendering.
6. `input.js` — MC buttons (levels 1–5) and text input (levels 6+); timer bar.
7. `hud.js` — hearts, score, combo, level label.
8. Full game-loop wiring: correct/wrong answer logic, hero swing, fiend HP, death particles.
9. `audio.js` — SFX for all events; looping BGM for Chapter 1.
10. Remaining fiend types (Chapters 2–4) with palette variants.
11. Wave pace adapter; between-wave hero walk + level-clear banner.
12. All 40 levels wired up with correct math ranges.
13. Game over and level-clear screens; score persistence via `/api/score`.
14. Leaderboard page.
15. Tests (`test_app.py`, `test_levels.py`).
16. `Dockerfile` + `lambda/handler.py`; deployment notes for S3/Lambda wiring.

---

## Non-Goals (out of scope for this implementation)

- Sound font / real audio files (use Web Audio API only).
- Multiplayer or real-time competitive modes.
- Mobile-native packaging (PWA manifest is optional stretch goal).
- Internationalisation beyond German/English problem text.
- Server-rendered HTML — the Flask app is API-only; all UI is in `static/index.html`.
