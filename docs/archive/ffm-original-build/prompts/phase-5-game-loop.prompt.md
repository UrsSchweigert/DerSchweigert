---
description: >
  Phase 5 LEAD — Full game loop wiring. Most complex phase.
  You are the LEAD agent (Opus). Read ALL prior phase output before decomposing.
  Workers write one module each. After every worker you review: correct imports,
  event wiring, no global state leaks, correct answer/wrong-answer paths, pace adapter
  logic. You personally verify api.js never stores JWT in localStorage.
tools:
  - read_file
  - list_dir
  - grep_search
  - run_in_terminal
  - get_errors
  - replace_string_in_file
  - runSubagent
---

# Phase 5 Lead — Game Loop + Mechanics

## Your responsibilities

1. Read every file produced by Phases 3 and 4 before issuing any worker briefs. You
   must know the exact exported API of `levels.js`, `renderer.js`, and `entities.js`.
2. Read `ffm-math-game.prompt.md` in full (all game loop, scoring, wave, audio sections).
3. Read `sites/ffm/app/main.py` to know the exact API endpoint paths and response shapes.
4. Decompose into the 9 worker tasks below. Workers write exactly one module each.
5. After each worker: read the file, run `get_errors`, verify the review criteria.
6. Personally verify: no JWT in localStorage, correct answer/wrong-answer event flow.
7. Test: `python3 -m http.server 8080 --directory sites/ffm/static` + open in browser
   and confirm the difficulty-select overlay appears without console errors.
8. Report `SUCCESS` or `FAILED:<reason>`.

---

## Worker task decomposition

### Worker 1 — HTML shell + CSS
**Files:** `sites/ffm/static/index.html`, `sites/ffm/static/styles.css`

Micro-brief must specify: exact element IDs (`game`, `input-zone`, `mc-buttons`,
`answer-input`, `strike-btn`, `timer-bar-container`, `auth-modal`, `difficulty-select`),
canvas `width=800 height=450`, all script tags as `type="module"` loading in correct order
(levels → renderer → entities → hud → audio → api → main), dark background `#0a0a1a`,
`image-rendering: pixelated` on canvas, no external CDN links.

### Worker 2 — API client (`api.js`)
**File:** `sites/ffm/static/game/api.js`

Micro-brief must specify: access token stored in a **module-level `let` variable** (never
`localStorage`, never `sessionStorage`), 401 auto-refresh then retry once, exact function
signatures and return types for all 7 methods, `isLoggedIn` getter, `username` decoded from
JWT payload `sub` field. Base URL: `window.location.origin` (works on both local and prod).

### Worker 3 — Audio engine (`audio.js`)
**File:** `sites/ffm/static/game/audio.js`

Micro-brief must specify: `AudioEngine` class, `AudioContext` created lazily on first user
interaction (browser autoplay policy), all 7 SFX methods with exact waveform types and
durations from spec, mute toggle that suspends/resumes context (not just sets volume to 0).

### Worker 4 — BGM loops (`audio.js` append)
**File:** `sites/ffm/static/game/audio.js` (append to class)

Micro-brief must specify: `startBGM(chapter)` and `stopBGM()`, 4 chapter motifs
(each 4 bars × 16 notes at 120 BPM using `OscillatorNode` scheduled via
`audioCtx.currentTime`), self-rescheduling loop pattern, distinct key per chapter
(e.g. C major / A minor / G major / D minor).

### Worker 5 — HUD module (`hud.js`)
**File:** `sites/ffm/static/game/hud.js`

Micro-brief must specify: `HUD` class wrapping `Renderer.drawHUD`, `update(state)` stores
latest state, `draw()` calls renderer. State shape: `{hearts, maxHearts, score, combo, level, difficulty}`.

### Worker 6 — SceneManager + GameState + difficulty select
**File:** `sites/ffm/static/game/main.js` (initial, scenes only)

Micro-brief must specify: `SceneManager` with `enter(scene, data)` and `update(dt)/draw()`,
`GameState` plain object shape (all fields from spec), difficulty-select scene showing the
`#difficulty-select` overlay with 3 buttons (Easy/Medium/Hard) and setting
`timerMax = 30|20|10` and `maxHearts = 7|5|3`. On confirm: transition to `'game'` scene.

### Worker 7 — EntityManager + spawning
**File:** `sites/ffm/static/game/main.js` (append EntityManager class)

Micro-brief must specify:
- `EntityManager` class with two queues:
  - `spawnQueue`: array of fiend configs waiting to walk on for the first time
  - `requeuedFiends`: array of fiend instances that retreated after a wrong answer
- `spawnFiend(levelIndex)`: pulls from `requeuedFiends` first (FIFO), then from
  `spawnQueue`. Creates the fiend at `x = CANVAS_W + 20`. Assigns `problem` via
  `generateProblem(levelIndex, Date.now())`.
- `requeueFiend(fiend)`: appends the fiend (with HP and problem preserved) to
  `requeuedFiends`. Resets fiend `x` to off-screen right when it actually spawns.
- `activeFiend` getter: first fiend whose `x < HERO_X + 100` and state is `'idle'`.
- `allDefeated` getter: `spawnQueue.length === 0 && requeuedFiends.length === 0 &&
  fiends.every(f => f.isDead || f.state === 'retreat')`.
- `update(dt)` removes only fiends whose `state === 'dead'` AND particle animation
  is complete. Fiends in `'retreat'` state are kept until they exit canvas right edge,
  then removed (after `requeueFiend` has already been called).

### Worker 8 — InputManager + answer handlers
**File:** `sites/ffm/static/game/main.js` (append InputManager + handlers)

Micro-brief must specify:
- `InputManager` class listening to Enter keydown on `#answer-input` and clicks on
  `#mc-buttons` children. Input is **disabled** while `activeFiend.state` is `'attack'`,
  `'reveal'`, or `'retreat'`.
- `handleCorrectAnswer()`:
  - If fiend was previously re-queued (`fiend.wasRequeued === true`): award base score
    only (100 pts, no speed or combo bonus). Otherwise use full formula:
    `base=100`, `speedBonus=Math.round((remaining/max)*50)`, `comboBonus=state.combo*10`.
  - `state.combo++`, hero swings, fiend hit.
- `handleWrongAnswer()`:
  1. `state.combo = 0`. Hearts--. Hero `hurt`. Fiend `attack`. Audio: wrong + hurt SFX.
  2. Disable input immediately.
  3. After attack animation ends: call `activeFiend.setState('reveal')`. Update speech
     bubble to show the full equation string (e.g. `"7 + 5 = 12"`).
  4. After 2000ms: call `activeFiend.setState('retreat')`. Call
     `entityManager.requeueFiend(activeFiend)`. Mark `activeFiend.wasRequeued = true`.
  5. Re-enable input only after the retreating fiend has exited the canvas.
  6. Game-over check after hearts decrement.

### Worker 9 — Main game loop + wave/level progression
**File:** `sites/ffm/static/game/main.js` (append game scene update + triggerWaveClear + triggerLevelClear + pace adapter)

Micro-brief must specify:
- `requestAnimationFrame` loop, delta-time cap 100ms.
- Pace adapter rolling 5-question average (clamp 1.5–6 s). **Do not count re-queued
  encounters in the pace average** — only track first-time correct answers.
- Wave-clear condition: poll `entityManager.allDefeated` each frame. When true, call
  `triggerWaveClear()`. Never call it while any fiend is in `'retreat'` or `'reveal'`
  state (the `allDefeated` getter already handles this).
- `triggerWaveClear()` sequence: victory pose → hero walks right → 2s delay → next wave.
  **Clear `requeuedFiends` only when moving to the next level, not between waves** —
  re-queued fiends must be defeated within the same level.
- `triggerLevelClear()`: clears both `spawnQueue` and `requeuedFiends`, posts score via
  `api.postScore` if logged in, transitions to `'level-clear'` scene.
- Auth modal: show on `.login-btn` / `.register-btn` clicks, call `api.login`/`api.register`,
  hide overlay on success.

---

## Review criteria (lead checks after each worker)

- `api.js`: no `localStorage` or `sessionStorage` calls anywhere in the file
- `api.js`: 401 triggers `api.refresh()` → retry exactly once (not infinite loop)
- `audio.js`: `AudioContext` not created at module load time (must be lazy)
- Game loop: `dt` capped at 100ms before use
- Pace adapter: `answerTimes` tracks only first-time encounters (not re-queued ones)
- `handleCorrectAnswer`: re-queued fiend (`wasRequeued === true`) awards base 100 only
- `handleWrongAnswer`: input disabled for the full reveal (2s) + retreat duration
- `allDefeated` getter: returns false while any fiend is in `'reveal'` or `'retreat'`
- `requeueFiend`: appends to `requeuedFiends`, does NOT reset HP
- Level-clear: clears both queues; score POST only when `api.isLoggedIn === true`
- No module imports an external URL or CDN library


- `sites/ffm/static/game/levels.js` — `LevelConfig`, `generateProblem`
- `sites/ffm/static/game/renderer.js` — `Renderer` class API
- `sites/ffm/static/game/entities.js` — `Hero`, fiend classes
- `ffm-math-game.prompt.md` — full game spec (all sections)
- `sites/ffm/app/main.py` — API endpoints to call from `api.js`

## Files to create

### `sites/ffm/static/index.html`

Single-page shell. Must include:
- `<canvas id="game" width="800" height="450"></canvas>`
- `<div id="input-zone">` below the canvas containing:
  - `<div id="mc-buttons">` with 4 `<button>` elements (for multiple-choice levels)
  - `<input id="answer-input" type="number" inputmode="numeric">` + `<button id="strike-btn">Strike!</button>`
  - `<div id="timer-bar-container">` (the timer bar is drawn on canvas, but this is the
    container for difficulty badge)
- A `<div id="auth-modal">` overlay (hidden by default) with login + register forms
- A `<div id="difficulty-select">` overlay (shown on first load before game starts)
- Script tags loading all game modules as ES modules: `main.js` last
- Link to `styles.css`
- No external CDN dependencies — everything is local

### `sites/ffm/static/styles.css`

- Dark background `#0a0a1a` (full page)
- Canvas centred, `max-width: 100%`, `image-rendering: pixelated`
- Input zone: flex row, centred, gap `8px`, below canvas
- `#answer-input`: monospace font, large text, dark bg, light text, no spinner arrows
- MC buttons: large (min 80px wide), pixel-art style (no border-radius, solid border)
- Auth modal: full-screen overlay, semi-transparent dark bg, centred card
- All interactive elements have visible focus rings (accessibility)

### `sites/ffm/static/game/api.js`

Thin fetch wrapper. Stores JWT access token in memory (never localStorage).
Handles 401 → auto-refresh → retry once.

```js
export const api = {
  async register(username, email, password) {},
  async login(username, password) {},
  async logout() {},
  async refresh() {},          // called automatically on 401
  async getProfile() {},
  async postScore(level, score, difficulty) {},
  async getLeaderboard(level) {},
  get isLoggedIn() {},         // true if access token exists in memory
  get username() {},           // decoded from JWT
}
```

### `sites/ffm/static/game/audio.js`

Web Audio API chiptune engine. No audio files.

```js
export class AudioEngine {
  constructor()
  playCorrect()        // ascending 2-note arp, square wave, 80ms each
  playWrong()          // descending buzz, sawtooth, 200ms
  playSwordSwing()     // noise burst + high blip
  playEnemyDeath()     // descending 4-note arp, 50ms each
  playHeroHurt()       // low thud + wobble tone
  playLevelClear()     // 8-note fanfare, square wave
  playGameOver()       // descending minor scale
  startBGM(chapter)    // start looping BGM for chapter 1–4 (different motif each)
  stopBGM()
  setVolume(0..1)
  get muted()
  toggleMute()
}
```

BGM: 4-bar loops, 120 BPM base. Each chapter has a distinct key/motif. Implement using
`OscillatorNode` scheduled with `AudioContext.currentTime`. The loop re-schedules itself
on end.

### `sites/ffm/static/game/hud.js`

```js
export class HUD {
  constructor(renderer)
  update(state)   // state: {hearts, maxHearts, score, combo, level, difficulty}
  draw()
}
```

### `sites/ffm/static/game/main.js`

Entry point. Implement these classes:

#### `SceneManager`

Scenes: `'title'`, `'difficulty-select'`, `'game'`, `'level-clear'`, `'game-over'`, `'leaderboard'`

Each scene has `enter(data)`, `update(dt)`, `draw()` methods.

**`difficulty-select` scene:** Show the `#difficulty-select` overlay. Player picks Easy/Medium/Hard
and optionally logs in. On confirm, transition to `'game'` with `{level: 1, difficulty, hearts}`.

**`game` scene:** The main game loop scene. See game loop below.

**`level-clear` scene:** Show score breakdown for 4 seconds (or on button press), then transition
to next level's `'game'` scene. POST score to API if logged in.

**`game-over` scene:** Show final score, best level reached, "Play Again" button.

#### `GameState` (plain object, passed between scenes)

```js
{
  level: 1..40,
  difficulty: 'easy'|'medium'|'hard',
  hearts: Number,
  maxHearts: Number,
  score: Number,
  combo: Number,
  scrollX: Number,       // total pixels scrolled (for parallax)
  waveNumber: Number,    // current wave within level
  enemiesDefeated: Number,
  timerMax: Number,      // 30|20|10 seconds based on difficulty
}
```

#### `EntityManager`

- Holds `hero` (one Hero instance) and `fiends` (array of active Fiend instances)
- `spawnFiend(levelIndex)`: creates a fiend from the right edge; picks type from `LevelConfig[levelIndex].fiendType`; assigns a new problem via `generateProblem`
- `update(dt)`: calls `update(dt)` on all entities; removes dead fiends from array
- `activeFiend`: the fiend that has reached the hero and is showing its problem (at most one)

#### Game loop (`'game'` scene `update(dt)`)

```
1. TIMER: if timerActive, decrement timerRemaining by dt (seconds).
   If timerRemaining ≤ 0: triggerWrongAnswer().

2. SPAWN: if no activeFiend and spawnTimer ≤ 0 and wave not complete:
   spawnFiend(); adapt spawnTimer via pace adapter.

3. UPDATE ENTITIES: entityManager.update(dt); renderer.drawBackground(state.scrollX).

4. ACTIVE FIEND: if a fiend has reached the hero stop position:
   start timer; show problem in speech bubble; show input UI.

5. INPUT (handled by InputManager via events, not polled here).
```

#### `InputManager`

Listens to `keydown` on the `<input>` field (Enter key) and clicks on MC buttons.
On answer submission:
- Compare to `activeFiend.answer`
- If correct: call `handleCorrectAnswer()`
- If wrong: call `handleWrongAnswer()`

#### `handleCorrectAnswer()`

```
1. Calculate points: base(100) + speedBonus + comboBonus (see spec)
2. hero.setState('swing')
3. activeFiend.hit()
4. audio.playCorrect() + (if fiend.isDead) audio.playEnemyDeath()
5. state.combo++; state.score += points
6. if fiend.isDead:
     enemiesDefeated++
     clearInput()
     if enemiesDefeated == waveSize: triggerWaveClear()
     else: spawnTimer = currentSpawnInterval
   else:
     // fiend still alive, new problem
     activeFiend.problem = generateProblem(levelIndex, Date.now())
     resetTimer()
```

#### `handleWrongAnswer()`

```
1. state.combo = 0
2. hero.setState('hurt')
3. activeFiend.setState('attack')
4. audio.playWrong() + audio.playHeroHurt()
5. state.hearts--
6. resetTimer()
7. if state.hearts === 0: triggerGameOver()
```

#### `triggerWaveClear()`

```
1. Fade out remaining on-screen fiends (retreat animation)
2. hero.setState('victory'); audio.playLevelClear()
3. state.waveNumber++
4. if waveNumber > totalWaves: triggerLevelClear()
5. else: setTimeout(2000, resumeWave)
```
(totalWaves = 3 for a simple implementation; adapt per level if desired)

#### Pace adapter

Track `answerTimes: []` (last 5 correct-answer durations in seconds).
```js
avgSpeed = answerTimes.reduce((a,b)=>a+b,0) / answerTimes.length
if avgSpeed < timerMax * 0.4: spawnInterval *= 0.9
if avgSpeed > timerMax * 0.8: spawnInterval *= 1.1
spawnInterval = clamp(spawnInterval, 1.5, 6.0)
```

#### Auth modal

The `#auth-modal` overlay has two tabs: Login and Register.
On successful login/register: `api.isLoggedIn` becomes true; show username in HUD; hide modal.
The game can be played without logging in — scores are only saved when logged in.

## Done when

- `sites/ffm/static/index.html` and `sites/ffm/static/game/main.js` exist
- Opening `index.html` via a local file server (`python3 -m http.server 8080 --directory sites/ffm/static`)
  shows the game canvas with the difficulty-select overlay
- The game is playable through at least Level 1 without JS errors in the console
