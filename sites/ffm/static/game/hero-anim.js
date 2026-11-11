// hero-anim.js — time-based animation for the hero.
//
// The hero used to advance frames on a 60 Hz tick counter (`this._frame++`
// every N ticks), which made playback depend on the display refresh rate and
// left every state change as a hard cut between two poses. This module drives
// the hero from wall-clock time instead: each clip is a list of poses with
// durations, optional hold, optional events, and a transform track that can
// move/lean/squash the pose while it is on screen. Motion therefore stays
// fluid even when a state only has one or two frames of art, and the pose
// changes are the only discrete steps.
//
// Everything here is pure and unit-tested (hero-anim.test.js); the drawing
// code lives in entities.js.

/** @typedef {{ f: string, ms: number, at?: string, fx?: string }} ClipFrame */
/** @typedef {{ dx?: number, dy?: number, rot?: number }} Pose */

const TAU = Math.PI * 2;

// `track(t)` receives the clip's normalized progress in [0, 1] and returns the
// transform applied to the drawn sprite. dx/dy are art pixels, rot is radians.
// They are deliberately small and translation-only where possible: scaling a
// pixel-art sprite by a few percent re-samples it and makes the blocks flicker,
// while a one-pixel bob at a slow sine rate reads as breathing.
export const HERO_CLIPS = {
  idle: {
    frames: [{ f: 'idle', ms: 2400 }],
    loop: true,
    track: (t) => ({ dy: -1.2 * Math.sin(TAU * t) }),
  },
  walk: {
    frames: [
      { f: 'walk-a', ms: 105 },
      { f: 'walk-b', ms: 105 },
      { f: 'walk-c', ms: 105 },
      { f: 'walk-b', ms: 105 },
    ],
    loop: true,
    track: (t) => ({ dy: -2.2 * Math.abs(Math.sin(TAU * t)), dx: 0.6 * Math.sin(TAU * t) }),
  },
  // Windup → impact → follow-through. The impact frame is the only one with an
  // event: the game resolves the hit there, so the number pops and the sound
  // lands on the frame where the blade is actually down.
  swing: {
    frames: [
      { f: 'swing-windup', ms: 70 },
      { f: 'swing-impact', ms: 55, at: 'hit', fx: 'slash', fxAt: [-19, -40] },
      { f: 'swing-follow', ms: 95 },
    ],
    next: 'idle',
    track: (t) => ({ dx: t < 0.28 ? -2 + 8 * (t / 0.28) : 6 - 6 * Math.min(1, (t - 0.28) / 0.72) }),
  },
  hurt: {
    frames: [{ f: 'hurt', ms: 240, at: 'hurt', fx: 'hurt' }],
    next: 'idle',
    track: (t) => {
      const kick = Math.sin(Math.min(1, t * 1.6) * Math.PI);
      return { dx: -9 * kick, rot: -0.035 * kick };
    },
  },
  // No knock-down pose at the native scale, so the fall is the hurt pose
  // tipping over rather than a second bitmap.
  dead: {
    frames: [{ f: 'dead', ms: 900, at: 'collapse' }],
    next: 'dead',
    track: (t) => ({ dy: 2 * (1 - Math.min(1, t * 4)) }),
  },
  victory: {
    frames: [
      { f: 'victory-raise', ms: 150, at: 'raise' },
      { f: 'victory-plant', ms: 400, at: 'plant' },
    ],
    next: 'victory',
    track: (t) => ({ dy: -1.5 * Math.sin(Math.min(1, t * 2.5) * Math.PI) }),
  },
  // Charge, then release. Both spells share the poses and differ only in the
  // FX colour, which the renderer already keys off the ability name.
  cast: {
    frames: [
      { f: 'swing-windup', ms: 90, at: 'charge' },
      { f: 'cast', ms: 170, at: 'release', fx: 'cast', fxAt: [-28, -88] },
    ],
    next: 'idle',
    track: (t) => ({ dx: t < 0.35 ? -2 + 4 * (t / 0.35) : 2 + 3 * Math.min(1, (t - 0.35) / 0.65) }),
  },
};

const IDENTITY = { dx: 0, dy: 0, rot: 0 };

/**
 * Plays one hero clip at a time on a wall-clock timeline.
 *
 * `update(dt)` returns nothing; read `frameId` and `transform` for drawing.
 * Events (`at:` on a frame, plus `done` when a non-looping clip ends) fire
 * from inside `update`, so callers that only tick the animator still get them.
 */
export class HeroAnimator {
  constructor(clips = HERO_CLIPS) {
    this.clips = clips;
    this._clipName = 'idle';
    this._index = 0;
    this._elapsed = 0;
    this._listeners = new Map();
    this._frozen = false;
    this._done = false;
  }

  get clip() { return this._clipName; }
  get frame() { return this._currentFrame(); }
  get frameId() { return this._currentFrame().f; }

  /** True once a non-looping clip has played to its end. */
  get finished() {
    const clip = this.clips[this._clipName];
    if (!clip || clip.loop) return false;
    const last = clip.frames.length - 1;
    return this._index === last && this._elapsed >= clip.frames[last].ms;
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event)?.delete(fn);
  }

  /**
   * Start a clip. Re-playing the clip that is already running keeps it going
   * unless `restart` is set, so holding a key or re-triggering on every answer
   * cannot freeze the hero on frame 0.
   */
  play(name, { restart = false } = {}) {
    const clip = this.clips[name];
    if (!clip) return false;
    if (name === this._clipName && !restart) return false;
    this._clipName = name;
    this._index = 0;
    this._elapsed = 0;
    this._done = false;
    const first = clip.frames[0];
    // Frame 0's `at` fires on entry rather than after its duration: a hurt
    // flash has to be visible on the frame the hit lands.
    if (first.at) this._emit(first.at);
    return true;
  }

  /** Time until the current clip would finish, for callers that need it. */
  get remaining() {
    const clip = this.clips[this._clipName];
    if (!clip) return 0;
    let left = -this._elapsed;
    for (let i = this._index; i < clip.frames.length; i++) left += clip.frames[i].ms;
    return Math.max(0, left);
  }

  update(dt) {
    if (this._frozen || !(dt > 0)) return;
    const clip = this.clips[this._clipName];
    if (!clip) return;
    this._elapsed += dt * 1000;
    let guard = 0;
    while (this._elapsed >= clip.frames[this._index].ms && guard++ < 64) {
      this._elapsed -= clip.frames[this._index].ms;
      const last = this._index === clip.frames.length - 1;
      if (last && !clip.loop) {
        // Park on the final pose; `finished` stays true until play() moves on.
        this._elapsed = Math.min(this._elapsed, clip.frames[this._index].ms);
        if (!this._done) {
          this._done = true;
          this._emit('done');
        }
        return;
      }
      this._index = last ? 0 : this._index + 1;
      const frame = clip.frames[this._index];
      if (frame.at) this._emit(frame.at);
    }
  }

  get transform() {
    const clip = this.clips[this._clipName];
    if (!clip) return { ...IDENTITY };
    const total = clip.frames.reduce((sum, f) => sum + f.ms, 0);
    let before = 0;
    for (let i = 0; i < this._index; i++) before += clip.frames[i].ms;
    const t = total > 0 ? (before + Math.min(this._elapsed, clip.frames[this._index].ms)) / total : 0;
    const raw = clip.track ? clip.track(t) : null;
    if (!raw) return { ...IDENTITY };
    return { ...IDENTITY, ...raw };
  }

  _currentFrame() {
    const clip = this.clips[this._clipName];
    const frames = clip?.frames ?? this.clips.idle.frames;
    return frames[Math.min(this._index, frames.length - 1)];
  }

  _emit(event) {
    const listeners = this._listeners.get(event);
    if (!listeners) return;
    for (const fn of [...listeners]) fn(event);
  }
}
