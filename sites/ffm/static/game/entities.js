// entities.js — pixel-art Hero + fiends for Arithmo Slayer

import { LOGICAL_PX, GROUND_Y, HERO_X, CANVAS_W, CANVAS_H } from './renderer.js';
import { FIEND_COMBAT_X } from './difficulty.js';
import { FIEND_CLASSES, getFiendClass } from './difficulty-classes.js';
import { HERO_ATLAS, HERO_FRAMES } from './hero/hero-frames.js';
import { HeroAnimator } from './hero-anim.js';

const P = LOGICAL_PX; // shorthand

// The atlas is built at the game's own pixel density (scripts/hero_frames.py),
// so drawing 1:1 with smoothing off is pixel-exact. Every frame carries its own
// foot contact point, which replaces the single hand-tuned ground offset the
// fixed-grid sheet needed.
const HERO_SCALE = 1;

// Vertical nudge applied when drawing the hero, on top of each frame's own foot
// pivot. Kept as a mutable value (with getter/setter) rather than an inline
// literal so calibrate.html can tune it live with perfect parity with the real
// game. Default is 0 now that the pivot does the grounding.
let _heroGroundOffsetPx = 0;
export function getHeroGroundOffsetPx() { return _heroGroundOffsetPx; }
export function setHeroGroundOffsetPx(px) { _heroGroundOffsetPx = px; }

// Additive radial glow shared by the cast hand, the strike impact and the
// spell projectiles, so every magic effect in the game reads as the same light.
function _radialGlow(ctx, x, y, radius, alpha, core, mid) {
  if (alpha <= 0 || radius <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, alpha);
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, core);
  gradient.addColorStop(0.45, mid);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const _heroAtlas = new Image();
_heroAtlas.src = HERO_ATLAS;
const _dragonSprite = new Image();
_dragonSprite.src = new URL('./dragon.webp', import.meta.url).href;
const _fireballSprite = new Image();
_fireballSprite.src = new URL('./fireball.png', import.meta.url).href;

// Fiend class sprite cache: one Image per class, created lazily, checked via
// .complete/.naturalWidth before use (same pattern as the hero atlas above).
const _fiendClassSpriteCache = new Map();

function getFiendClassSprite(fiendClassId) {
  if (!fiendClassId) return null;
  let img = _fiendClassSpriteCache.get(fiendClassId);
  if (!img) {
    const cls = FIEND_CLASSES.find((c) => c.id === fiendClassId);
    if (!cls) return null;
    img = new Image();
    img.src = new URL(cls.spritePath, import.meta.url).href;
    _fiendClassSpriteCache.set(fiendClassId, img);
  }
  return img;
}

// ─── Base Entity ─────────────────────────────────────────────────────────────
export class Entity {
  constructor(x, y) {
    this.x = x; this.y = y;
    this._state = 'idle'; this._frame = 0; this._tick = 0; this._dur = 10;
  }
  update(dt) {
    this._tick += dt * 60;
    if (this._tick >= this._dur) { this._tick = 0; this._onFrameAdvance(); }
  }
  _onFrameAdvance() { this._frame++; }
  get state()  { return this._state; }
  setState(s)  { this._state = s; this._frame = 0; this._tick = 0; }
  draw(_ctx)   {}
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
// Fixed angle offsets for the aura's radiating energy spikes — precomputed
// once at module load so drawing never allocates a new array per frame.
const AURA_SPIKE_COUNT = 8;
const AURA_SPIKE_ANGLES = Array.from({ length: AURA_SPIKE_COUNT }, (_, i) => (i / AURA_SPIKE_COUNT) * Math.PI * 2);

// Game state → clip. `swing` doubles as the melee strike and the dragon
// summon; the combo spells get their own cast clip (see cast()).
const STATE_CLIPS = {
  idle: 'idle', walk: 'walk', swing: 'swing',
  hurt: 'hurt', dead: 'dead', victory: 'victory',
};
const CLIP_STATES = {
  idle: 'idle', walk: 'walk', swing: 'swing',
  hurt: 'hurt', dead: 'dead', victory: 'victory', cast: 'cast',
};

export class Hero extends Entity {
  constructor() {
    super(HERO_X, GROUND_Y);
    this._healAura = 0;       // countdown (seconds) — post-level-clear heal flash
    this._holdHealActive = false; // continuous flag — hold-to-heal in progress
    this._holdHealRatio = 0;  // 0..1 progress toward the next healed heart, for intensity
    this.anim = new HeroAnimator();
    this.anim.play('idle');
    this._castFx = null;      // 'fire' | 'bolt' — drives the cast glow palette
  }

  update(dt) {
    this.anim.update(dt);
    // Free-running counter for the heal aura's pulse; the pose timeline no
    // longer uses it.
    this._tick += dt * 60;
    if (this._healAura > 0) this._healAura = Math.max(0, this._healAura - dt);
    // One-shot clips park on their last pose; move on to the clip the game
    // expects to see afterwards (usually idle) instead of holding the pose.
    if (this.anim.finished) {
      const next = this.anim.clips[this.anim.clip]?.next;
      if (next && next !== this.anim.clip) this._applyClip(next);
    }
  }

  // Renders the pulsating green healing aura behind/in front of the hero
  // sprite. Shared by both the post-level-clear heal flash (`_healAura`
  // countdown) and the continuous hold-to-heal effect (`_holdHealActive`),
  // so both draw the same enriched visual instead of duplicating it.
  //
  // `layer` is 'back' (drawn under the sprite) or 'front' (drawn over it) —
  // matching the original two-pass ellipse effect, now with extra layers:
  // a soft glow core, jagged radiating energy spikes (Broly-style tendrils),
  // and a bright flickering highlight, all pulsing at slightly different
  // phase offsets so the effect reads as "alive" rather than a static blob.
  _drawHealAura(ctx, layer) {
    const timerFade = this._healAura > 0 ? Math.min(1, this._healAura * 2) : 0;
    const holdFade = this._holdHealActive ? Math.max(0.35, this._holdHealRatio) : 0;
    const intensity = Math.max(timerFade, holdFade);
    if (intensity <= 0) return;

    // The hero's feet are centred on x now (the atlas pivots on the foot
    // contact point), so the chest is directly above it.
    const cx = this.x;
    const cy = this.y - 73 + 6 * P;
    const t = this._tick * 0.25;
    const front = layer === 'front';

    ctx.save();

    // Layer 1 — soft outer glow core (back only), broad and slow-pulsing.
    if (!front) {
      const scale = 1 + 0.1 * Math.sin(t);
      ctx.globalAlpha = intensity * (0.45 + 0.3 * Math.sin(t)) * 0.55;
      ctx.fillStyle = '#30f060';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 100 * scale, 92 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Layer 2 — radiating jagged energy spikes, rotating slowly, each
    // flickering independently via a per-spike phase offset. This is what
    // gives the aura a "flame/energy tendril" read instead of a plain blob.
    const spikeBaseLen = front ? 34 : 46;
    const rotation = t * (front ? -0.6 : 0.5);
    for (let i = 0; i < AURA_SPIKE_COUNT; i++) {
      const angle = AURA_SPIKE_ANGLES[i] + rotation;
      const flicker = 0.6 + 0.4 * Math.sin(t * 3 + i * 1.7);
      const len = (spikeBaseLen + 14 * Math.sin(t * 2 + i)) * flicker;
      const innerR = front ? 46 : 58;
      const x0 = cx + Math.cos(angle) * innerR;
      const y0 = cy + Math.sin(angle) * innerR * 0.7;
      const x1 = cx + Math.cos(angle) * (innerR + len);
      const y1 = cy + Math.sin(angle) * (innerR + len) * 0.7;
      const perpAngle = angle + Math.PI / 2;
      const spread = front ? 5 : 7;
      ctx.globalAlpha = intensity * flicker * (front ? 0.5 : 0.4);
      ctx.fillStyle = i % 2 === 0 ? '#20f850' : '#7cff90';
      ctx.beginPath();
      ctx.moveTo(x0 + Math.cos(perpAngle) * spread, y0 + Math.sin(perpAngle) * spread);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x0 - Math.cos(perpAngle) * spread, y0 - Math.sin(perpAngle) * spread);
      ctx.closePath();
      ctx.fill();
    }

    // Layer 3 — bright inner highlight, fast pulse, mixes in a lighter
    // yellow-green so the core doesn't read as flat/uniform green.
    const t2 = t * 1.6 + 1;
    const scale2 = 1 + 0.08 * Math.sin(t2);
    ctx.globalAlpha = intensity * (0.3 + 0.25 * Math.sin(t2)) * (front ? 0.4 : 0.45);
    ctx.fillStyle = front ? '#20f850' : '#c8ffb0';
    ctx.beginPath();
    ctx.ellipse(cx, cy, (front ? 78 : 50) * scale2, (front ? 70 : 44) * scale2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  setState(s) {
    const clip = STATE_CLIPS[s];
    if (!clip) return;
    this._state = s;
    this._castFx = null;
    // One-shot clips replay from the top when re-triggered (a second correct
    // answer must swing again); looping clips keep their phase so repeated
    // setState('idle') calls do not restart the breathing cycle.
    this.anim.play(clip, { restart: !this.anim.clips[clip].loop });
  }

  /** Start the spell-casting clip; `fx` picks the cast glow palette. */
  cast(fx) {
    this._castFx = fx ?? null;
    this.anim.play('cast', { restart: true });
    this._state = 'cast';
  }

  _applyClip(name) {
    if (!this.anim.play(name)) return;
    this._state = CLIP_STATES[name] ?? this._state;
    if (name !== 'cast') this._castFx = null;
  }

  draw(ctx) {
    const bx = ~~(this.x - 12*P);
    const by = ~~(this.y - 36*P);
    const Q  = 2;              // sprite pixel = 2×2 real pixels → finer detail
    const br = this._state === 'hurt';
    const bob = 0;
    const fr = 0;

    if (_heroAtlas.complete && _heroAtlas.naturalWidth) {
      this._drawAtlasFrame(ctx);
      return;
    }

    if (this._state === 'dead') { this._drawDead(ctx, bx, by, fr, Q); return; }

    // walk: legs swing horizontally
    let lH = 0, rH = 0;
    if (this._state === 'walk') {
      lH = fr === 1 ? -3*Q : fr === 3 ?  3*Q : 0;
      rH = fr === 1 ?  3*Q : fr === 3 ? -3*Q : 0;
    }

    // sword behind torso (not during swing or victory — those draw their own)
    if (this._state !== 'swing' && this._state !== 'victory') {
      this._drawSword(ctx, bx, by, bob, Q);
    }

    // ── BOOTS ────────────────────────────────────────────────────────────────
    ctx.fillStyle = '#101450';
    ctx.fillRect(bx+10*Q+lH, by+64*Q, 12*Q, 8*Q);
    ctx.fillRect(bx+26*Q+rH, by+64*Q, 12*Q, 8*Q);
    ctx.fillStyle = '#1c2480';
    ctx.fillRect(bx+10*Q+lH, by+64*Q,  2*Q, 7*Q);
    ctx.fillRect(bx+26*Q+rH, by+64*Q,  2*Q, 7*Q);
    ctx.fillStyle = '#c89020';
    ctx.fillRect(bx+10*Q+lH, by+70*Q, 12*Q, 2*Q);
    ctx.fillRect(bx+26*Q+rH, by+70*Q, 12*Q, 2*Q);
    ctx.fillStyle = '#0a0c34';
    ctx.fillRect(bx+19*Q+lH, by+64*Q,  3*Q, 8*Q);   // toe cap L
    ctx.fillRect(bx+35*Q+rH, by+64*Q,  3*Q, 8*Q);   // toe cap R

    // ── PANTS ────────────────────────────────────────────────────────────────
    ctx.fillStyle = '#1a2888';
    ctx.fillRect(bx+10*Q+lH, by+52*Q, 12*Q, 12*Q);
    ctx.fillRect(bx+26*Q+rH, by+52*Q, 12*Q, 12*Q);
    ctx.fillStyle = '#2838a8';
    ctx.fillRect(bx+10*Q+lH, by+52*Q,  2*Q, 11*Q);
    ctx.fillRect(bx+26*Q+rH, by+52*Q,  2*Q, 11*Q);
    ctx.fillStyle = '#0e1660';
    ctx.fillRect(bx+20*Q+lH, by+52*Q,  Q,   12*Q);
    ctx.fillRect(bx+36*Q+rH, by+52*Q,  Q,   12*Q);

    // ── BELT ─────────────────────────────────────────────────────────────────
    ctx.fillStyle = '#c89020';
    ctx.fillRect(bx+10*Q, by+48*Q+bob, 28*Q, 4*Q);
    ctx.fillStyle = '#f0c030';
    ctx.fillRect(bx+10*Q, by+48*Q+bob, 28*Q, Q);
    ctx.fillStyle = '#f8d840';
    ctx.fillRect(bx+21*Q, by+48*Q+bob,  6*Q, 4*Q);
    ctx.fillStyle = '#fff088';
    ctx.fillRect(bx+22*Q, by+49*Q+bob,  4*Q, 2*Q);

    // ── CHEST ARMOR ──────────────────────────────────────────────────────────
    const ac = br ? '#b82818' : '#2848c8';
    const ah = br ? '#e04838' : '#4870e8';
    const ad = br ? '#781010' : '#1428a0';
    const al = br ? '#e04838' : '#90b8f0';
    ctx.fillStyle = ac;
    ctx.fillRect(bx+12*Q, by+28*Q+bob, 24*Q, 20*Q);
    ctx.fillStyle = ah;
    ctx.fillRect(bx+12*Q, by+28*Q+bob,  3*Q, 20*Q);  // left edge highlight
    ctx.fillRect(bx+12*Q, by+28*Q+bob, 24*Q,  Q);     // top edge
    ctx.fillStyle = ad;
    ctx.fillRect(bx+33*Q, by+28*Q+bob,  3*Q, 20*Q);  // right shadow
    ctx.fillRect(bx+12*Q, by+47*Q+bob, 24*Q,  Q);     // bottom edge
    ctx.fillStyle = al;
    ctx.fillRect(bx+20*Q, by+28*Q+bob,  8*Q, 20*Q);  // centre accent strip
    ctx.fillStyle = ac;
    ctx.fillRect(bx+22*Q, by+29*Q+bob,  4*Q, 18*Q);  // re-darken centre

    // ── SHOULDER PADS ────────────────────────────────────────────────────────
    ctx.fillStyle = ad;
    ctx.fillRect(bx+5*Q,  by+26*Q+bob, 10*Q, 6*Q);
    ctx.fillRect(bx+33*Q, by+26*Q+bob, 10*Q, 6*Q);
    ctx.fillStyle = ah;
    ctx.fillRect(bx+5*Q,  by+26*Q+bob, 10*Q, Q);
    ctx.fillRect(bx+33*Q, by+26*Q+bob, 10*Q, Q);
    ctx.fillRect(bx+5*Q,  by+26*Q+bob,  Q,   6*Q);
    ctx.fillRect(bx+42*Q, by+26*Q+bob,  Q,   6*Q);

    // ── ARMS (swing draws its own; victory replaces right arm) ───────────────
    if (this._state !== 'swing') {
      ctx.fillStyle = '#f0c090';
      ctx.fillRect(bx+5*Q,  by+30*Q+bob,  8*Q, 18*Q);          // left
      if (this._state !== 'victory') {
        ctx.fillRect(bx+35*Q, by+30*Q+bob,  8*Q, 18*Q);         // right
      }
      ctx.fillStyle = ad;
      ctx.fillRect(bx+5*Q,  by+42*Q+bob,  8*Q,  6*Q);           // gauntlets
      if (this._state !== 'victory') {
        ctx.fillRect(bx+35*Q, by+42*Q+bob,  8*Q,  6*Q);
      }
      ctx.fillStyle = ah;
      ctx.fillRect(bx+5*Q,  by+42*Q+bob,  Q,    6*Q);
      ctx.fillRect(bx+5*Q,  by+42*Q+bob,  8*Q,  Q);
      if (this._state !== 'victory') {
        ctx.fillRect(bx+42*Q, by+42*Q+bob,  Q,    6*Q);
        ctx.fillRect(bx+35*Q, by+42*Q+bob,  8*Q,  Q);
      }
    }

    // ── NECK ─────────────────────────────────────────────────────────────────
    ctx.fillStyle = '#f0c090';
    ctx.fillRect(bx+20*Q, by+26*Q+bob, 8*Q, 4*Q);
    ctx.fillStyle = '#dab080';
    ctx.fillRect(bx+20*Q, by+29*Q+bob, 8*Q, Q);

    // ── HEAD (face) ──────────────────────────────────────────────────────────
    ctx.fillStyle = '#f0c090';
    ctx.fillRect(bx+12*Q, by+8*Q+bob, 24*Q, 20*Q);
    ctx.fillRect(bx+10*Q, by+12*Q+bob,  3*Q,  8*Q); // L ear
    ctx.fillRect(bx+35*Q, by+12*Q+bob,  3*Q,  8*Q); // R ear
    ctx.fillStyle = '#e0a078';
    ctx.fillRect(bx+11*Q, by+14*Q+bob,  Q,    4*Q);
    ctx.fillRect(bx+36*Q, by+14*Q+bob,  Q,    4*Q);
    ctx.fillStyle = '#dab080';
    ctx.fillRect(bx+13*Q, by+26*Q+bob, 22*Q,  Q);   // jaw shadow
    ctx.fillStyle = '#f8a898';                        // cheek blush
    ctx.fillRect(bx+13*Q, by+19*Q+bob,  4*Q,  3*Q);
    ctx.fillRect(bx+31*Q, by+19*Q+bob,  4*Q,  3*Q);

    // ── EYES (white sclera + iris + pupil + catchlight) ──────────────────────
    this._drawEye(ctx, bx+14*Q, by+12*Q+bob, Q, br);
    this._drawEye(ctx, bx+24*Q, by+12*Q+bob, Q, br);

    // ── EYEBROWS (gentle arch = friendly expression) ──────────────────────────
    ctx.fillStyle = '#c07810';
    ctx.fillRect(bx+14*Q, by+11*Q+bob, 2*Q, Q);
    ctx.fillRect(bx+16*Q, by+10*Q+bob, 4*Q, Q);
    ctx.fillRect(bx+20*Q, by+11*Q+bob, 2*Q, Q);
    ctx.fillRect(bx+24*Q, by+11*Q+bob, 2*Q, Q);
    ctx.fillRect(bx+26*Q, by+10*Q+bob, 4*Q, Q);
    ctx.fillRect(bx+30*Q, by+11*Q+bob, 2*Q, Q);

    // ── NOSE (two tiny shadow dots) ───────────────────────────────────────────
    ctx.fillStyle = '#dab080';
    ctx.fillRect(bx+21*Q, by+20*Q+bob, Q, Q);
    ctx.fillRect(bx+26*Q, by+20*Q+bob, Q, Q);

    // ── MOUTH (gentle smile) ──────────────────────────────────────────────────
    ctx.fillStyle = '#b05040';
    ctx.fillRect(bx+17*Q, by+22*Q+bob, Q,    2*Q); // L corner
    ctx.fillRect(bx+30*Q, by+22*Q+bob, Q,    2*Q); // R corner
    ctx.fillStyle = '#d07868';
    ctx.fillRect(bx+18*Q, by+23*Q+bob, 12*Q, Q);
    ctx.fillStyle = '#f8e0d8';
    ctx.fillRect(bx+19*Q, by+23*Q+bob, 10*Q, Q);   // teeth gleam

    // ── HAIR (golden, big dramatic spikes) ────────────────────────────────────
    ctx.fillStyle = '#e8a020';
    ctx.fillRect(bx+10*Q, by+4*Q+bob, 28*Q,  6*Q); // forehead band
    ctx.fillRect(bx+7*Q,  by+6*Q+bob,  5*Q,  6*Q); // L side puff
    ctx.fillRect(bx+36*Q, by+6*Q+bob,  5*Q,  6*Q); // R side puff
    ctx.fillRect(bx+6*Q,  by+8*Q+bob,  3*Q,  5*Q); // L lower
    ctx.fillRect(bx+39*Q, by+8*Q+bob,  3*Q,  5*Q); // R lower
    ctx.fillRect(bx+10*Q, by+2*Q+bob,  5*Q,  3*Q); // far-L spike
    ctx.fillRect(bx+14*Q, by+0*Q+bob,  5*Q,  5*Q); // L-centre spike
    ctx.fillRect(bx+19*Q, by-2*Q+bob,  6*Q,  7*Q); // centre spike (tallest)
    ctx.fillRect(bx+25*Q, by+0*Q+bob,  5*Q,  5*Q); // R-centre spike
    ctx.fillRect(bx+30*Q, by+2*Q+bob,  5*Q,  3*Q); // far-R spike
    ctx.fillStyle = '#f8d040';                       // spike highlights
    ctx.fillRect(bx+11*Q, by+2*Q+bob,  2*Q,  2*Q);
    ctx.fillRect(bx+15*Q, by+0*Q+bob,  2*Q,  3*Q);
    ctx.fillRect(bx+20*Q, by-2*Q+bob,  3*Q,  5*Q);
    ctx.fillRect(bx+26*Q, by+0*Q+bob,  2*Q,  3*Q);
    ctx.fillRect(bx+31*Q, by+2*Q+bob,  2*Q,  2*Q);
    ctx.fillRect(bx+7*Q,  by+6*Q+bob,  2*Q,  4*Q);
    ctx.fillRect(bx+39*Q, by+6*Q+bob,  2*Q,  4*Q);
    ctx.fillStyle = '#c07810';
    ctx.fillRect(bx+9*Q,  by+9*Q+bob, 30*Q,  2*Q); // base shadow band

    // ── SWING (overlays arms + draws sword arc + speed lines) ─────────────────
    if (this._state === 'swing') this._drawSwing(ctx, bx, by, fr, Q, bob);

    // ── VICTORY ───────────────────────────────────────────────────────────────
    if (this._state === 'victory') {
      const lift = fr * 6*Q;
      // right arm raised
      ctx.fillStyle = '#f0c090';
      ctx.fillRect(bx+35*Q, by+18*Q+bob-lift, 8*Q, 14*Q);
      ctx.fillRect(bx+36*Q, by+14*Q+bob-lift, 6*Q,  6*Q);
      ctx.fillStyle = ad;
      ctx.fillRect(bx+35*Q, by+28*Q+bob-lift, 8*Q,  5*Q);
      ctx.fillStyle = ah;
      ctx.fillRect(bx+35*Q, by+28*Q+bob-lift, Q,    5*Q);
      ctx.fillRect(bx+35*Q, by+28*Q+bob-lift, 8*Q,  Q);
      // sword pointing skyward in raised fist
      ctx.fillStyle = '#1460c0';
      ctx.fillRect(bx+38*Q, by+2*Q+bob-lift+Q, 4*Q, 14*Q);
      ctx.fillStyle = '#40a0f0';
      ctx.fillRect(bx+38*Q, by+2*Q+bob-lift,   4*Q, 14*Q);
      ctx.fillStyle = '#88d0ff';
      ctx.fillRect(bx+38*Q, by+2*Q+bob-lift,   3*Q, 14*Q);
      ctx.fillStyle = '#c8f0ff';
      ctx.fillRect(bx+38*Q, by+2*Q+bob-lift,   Q,   7*Q);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx+39*Q, by+2*Q+bob-lift,   Q,   2*Q); // tip glow
      ctx.fillStyle = '#c89020';
      ctx.fillRect(bx+35*Q, by+14*Q+bob-lift, 10*Q, 3*Q);
      ctx.fillStyle = '#f0c030';
      ctx.fillRect(bx+35*Q, by+14*Q+bob-lift, 10*Q, Q);
    }
  }

  _drawEye(ctx, ex, ey, Q, hurt) {
    // rim / lashes
    ctx.fillStyle = '#2a1808';
    ctx.fillRect(ex,      ey,       8*Q,  Q);   // top lash
    ctx.fillRect(ex-Q,    ey+Q,     Q,    4*Q); // L rim
    ctx.fillRect(ex+8*Q,  ey+Q,     Q,    4*Q); // R rim
    ctx.fillRect(ex,      ey+5*Q,   8*Q,  Q);   // bottom lash
    // sclera (white)
    ctx.fillStyle = '#f8f8f0';
    ctx.fillRect(ex,      ey+Q,     8*Q,  4*Q);
    if (hurt) {
      // pained X pupils
      ctx.fillStyle = '#080810';
      ctx.fillRect(ex+Q,   ey+Q,    Q, Q); ctx.fillRect(ex+4*Q, ey+Q,   Q, Q);
      ctx.fillRect(ex+2*Q, ey+2*Q,  2*Q, Q);
      ctx.fillRect(ex+Q,   ey+3*Q,  Q, Q); ctx.fillRect(ex+4*Q, ey+3*Q, Q, Q);
      return;
    }
    // iris (blue)
    ctx.fillStyle = '#1858c8';
    ctx.fillRect(ex+2*Q,  ey+Q,     4*Q,  4*Q);
    // pupil (black)
    ctx.fillStyle = '#080810';
    ctx.fillRect(ex+3*Q,  ey+2*Q,   2*Q,  2*Q);
    // iris highlight ring
    ctx.fillStyle = '#4888f8';
    ctx.fillRect(ex+2*Q,  ey+Q,     4*Q,  Q);
    ctx.fillRect(ex+2*Q,  ey+4*Q,   4*Q,  Q);
    ctx.fillRect(ex+2*Q,  ey+Q,     Q,    4*Q);
    // catchlights
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ex+2*Q,  ey+Q,     Q,    Q);   // main top-left spark
    ctx.fillRect(ex+5*Q,  ey+3*Q,   Q,    Q);   // secondary bottom-right
  }

  _drawAtlasFrame(ctx) {
    const frame = HERO_FRAMES[this.anim.frameId];
    if (!frame) return;
    const tf = this.anim.transform;
    const w = frame.w * HERO_SCALE;
    const h = frame.h * HERO_SCALE;
    const footX = this.x + tf.dx * HERO_SCALE;
    const footY = this.y + _heroGroundOffsetPx + tf.dy * HERO_SCALE;
    const left = Math.round(footX - frame.px * HERO_SCALE);
    const top = Math.round(footY - frame.py * HERO_SCALE);

    const aura = this._healAura > 0 || this._holdHealActive;
    if (aura) this._drawHealAura(ctx, 'back');

    ctx.save();
    // Pixel art: never let the canvas resample the sprite.
    ctx.imageSmoothingEnabled = false;
    if (tf.rot !== 0) {
      // The lean pivots at the feet, so the hero never floats off the ground.
      ctx.translate(left + frame.px * HERO_SCALE, top + frame.py * HERO_SCALE);
      ctx.rotate(tf.rot);
      ctx.drawImage(_heroAtlas, frame.x, frame.y, frame.w, frame.h,
        -frame.px * HERO_SCALE, -frame.py * HERO_SCALE, w, h);
    } else {
      ctx.drawImage(_heroAtlas, frame.x, frame.y, frame.w, frame.h, left, top, w, h);
    }
    ctx.restore();

    if (this.anim.clip === 'swing') this._drawSwingFx(ctx, left, top, frame);
    if (this._castFx && this.anim.clip === 'cast') this._drawCastFx(ctx, left, top, frame);
    if (aura) this._drawHealAura(ctx, 'front');
  }

  // Arc + sparks for the strike, timed off the clip rather than baked into the
  // sprite: the sheet's arc frames only exist at a smaller character scale, and
  // a drawn arc can fade, so the blade reads as moving through the swing
  // instead of the art cutting from one pose to the next.
  _drawSwingFx(ctx, left, top, frame) {
    const clip = this.anim.clips.swing;
    const total = clip.frames.reduce((sum, f) => sum + f.ms, 0);
    let before = 0;
    for (const f of clip.frames) {
      if (f.at === 'hit') break;
      before += f.ms;
    }
    const t = this._clipProgress();
    const hitStart = before / total;
    if (t < hitStart - 0.06) return;
    const fade = Math.max(0, 1 - (t - hitStart) / 0.55);
    if (fade <= 0) return;

    // The arc is centred on the hands and sweeps along the path the blade
    // travelled, from up-right to down-right, so it reads as a trail rather
    // than a decoration floating next to the hero.
    const anchor = this.anim.frame.fxAt ?? [-19, -40];
    const cx = left + (frame.px + anchor[0]) * HERO_SCALE;
    const cy = top + (frame.py + anchor[1]) * HERO_SCALE;
    // Fatter than the blade it trails: an ellipse wide in x and shorter in y,
    // stroked in four layers (soft outer haze, body, bright edge, white core)
    // so the slash has structure instead of being one uniform line.
    const radiusX = 146, radiusY = 98;
    const a0 = -1.35, a1 = 0.92, a1x = a1;
    const layers = [
      [26, '#1b4f8c', 0.26],
      [16, '#2f8fd8', 0.42],
      [9, '#7fd4ff', 0.68],
      [3.5, '#ffffff', 0.95],
    ];
    for (const [width, colour, alpha] of layers) {
      ctx.globalAlpha = fade * alpha;
      ctx.lineWidth = width;
      ctx.strokeStyle = colour;
      ctx.beginPath();
      ctx.ellipse(cx, cy, radiusX, radiusY, -0.38, a0, a1x);
      ctx.stroke();
    }
    // Structured glow: the leading edge of the sweep burns brighter, and the
    // tail feathers out, so the eye reads direction of travel.
    for (let i = 0; i < 5; i++) {
      const from = a0 + (a1x - a0) * (i / 5);
      const to = a0 + (a1x - a0) * ((i + 1) / 5) + 0.03;
      ctx.globalAlpha = fade * (0.1 + 0.22 * i);
      ctx.lineWidth = 18 + i * 4;
      ctx.strokeStyle = i >= 3 ? '#bfeaff' : '#3d8fd0';
      ctx.beginPath();
      ctx.ellipse(cx, cy, radiusX, radiusY, -0.38, from, to);
      ctx.stroke();
    }

    // A single burst at the impact, same light as the cast: the swing is the
    // moment the hit lands, so it gets one flash rather than a steady glow.
    const burst = Math.max(0, 1 - (t - hitStart) / 0.3);
    _radialGlow(ctx, cx + Math.cos(a1x) * radiusX, cy + Math.sin(a1x) * radiusY,
      64 * (0.7 + 0.5 * burst), 0.8 * burst, '#ffffff', '#8fd8ff');

    // Sparks fly off the blade end, where the arc is brightest.
    ctx.globalAlpha = fade;
    ctx.strokeStyle = '#cfeeff';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = a1x - 0.18 + i * 0.14;
      const r0 = 1.0, r1 = 1.0 + (0.1 + (i % 2) * 0.08);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * radiusX * r0, cy + Math.sin(a) * radiusY * r0);
      ctx.lineTo(cx + Math.cos(a) * radiusX * r1, cy + Math.sin(a) * radiusY * r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Glow in the raised palm while the cast clip plays. The hand sits at the
  // same offset in the `cast` pose every time, so the anchor is part of the
  // clip data instead of being measured at runtime.
  _drawCastFx(ctx, left, top, frame) {
    const anchor = this.anim.frame.fxAt;
    if (!anchor) return;
    const t = this._clipProgress();
    const intensity = t < 0.45 ? t / 0.45 : Math.max(0, 1 - (t - 0.45) / 0.55);
    if (intensity <= 0) return;
    const fire = this._castFx === 'fire';
    const core = fire ? '#fff0b0' : '#dff4ff';
    const mid = fire ? '#ffb03a' : '#7fd4ff';
    const hx = left + (frame.px + anchor[0]) * HERO_SCALE;
    const hy = top + (frame.py + anchor[1]) * HERO_SCALE;
    const r = (20 + 12 * Math.abs(Math.sin(this._tick * 0.02))) * intensity;
    _radialGlow(ctx, hx, hy, r * 3.2, 0.85 * intensity, core, mid);
    ctx.save();
    ctx.globalAlpha = 0.9 * intensity;
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(hx, hy, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _clipProgress() {
    const clip = this.anim.clips[this.anim.clip];
    if (!clip) return 0;
    const total = clip.frames.reduce((sum, f) => sum + f.ms, 0);
    if (total <= 0) return 0;
    return Math.min(1, (total - this.anim.remaining) / total);
  }

  _drawSword(ctx, bx, by, bob, Q) {
    // held horizontally — combat-ready stance
    // pommel
    ctx.fillStyle = '#c89020';
    ctx.fillRect(bx+33*Q, by+33*Q+bob, 5*Q, 6*Q);
    ctx.fillStyle = '#f0c030';
    ctx.fillRect(bx+33*Q, by+33*Q+bob, 5*Q, Q);
    ctx.fillRect(bx+33*Q, by+33*Q+bob, Q,   6*Q);
    // handle
    ctx.fillStyle = '#6a3c10';
    ctx.fillRect(bx+38*Q, by+34*Q+bob, 8*Q, 4*Q);
    ctx.fillStyle = '#9a5c20';
    ctx.fillRect(bx+38*Q, by+34*Q+bob, 8*Q, Q);
    ctx.fillStyle = '#c89020';                    // handle wrapping
    ctx.fillRect(bx+39*Q, by+34*Q+bob, Q, 4*Q);
    ctx.fillRect(bx+41*Q, by+34*Q+bob, Q, 4*Q);
    ctx.fillRect(bx+43*Q, by+34*Q+bob, Q, 4*Q);
    ctx.fillRect(bx+45*Q, by+34*Q+bob, Q, 4*Q);
    // cross-guard
    ctx.fillStyle = '#c89020';
    ctx.fillRect(bx+46*Q, by+29*Q+bob,  4*Q, 14*Q);
    ctx.fillStyle = '#f0c030';
    ctx.fillRect(bx+46*Q, by+29*Q+bob,  Q,   14*Q);
    ctx.fillRect(bx+46*Q, by+29*Q+bob,  4*Q,  Q);
    // blade (crystal blue)
    ctx.fillStyle = '#1460c0';
    ctx.fillRect(bx+50*Q, by+34*Q+bob, 22*Q,  4*Q); // shadow layer
    ctx.fillStyle = '#40a0f0';
    ctx.fillRect(bx+50*Q, by+33*Q+bob, 22*Q,  4*Q);
    ctx.fillStyle = '#88d0ff';
    ctx.fillRect(bx+50*Q, by+33*Q+bob, 22*Q,  2*Q);
    ctx.fillStyle = '#c8f0ff';
    ctx.fillRect(bx+50*Q, by+33*Q+bob, 10*Q,  Q);
    // angled tip
    ctx.fillStyle = '#40a0f0';
    ctx.fillRect(bx+72*Q, by+34*Q+bob,  2*Q,  2*Q);
    ctx.fillRect(bx+74*Q, by+35*Q+bob,  2*Q,  Q);
    ctx.fillStyle = '#c8f0ff';
    ctx.fillRect(bx+72*Q, by+33*Q+bob,  2*Q,  Q);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx+72*Q, by+33*Q+bob,  Q,    Q);   // tip shine
  }

  _drawSwing(ctx, bx, by, fr, Q, bob) {
    const ah = '#4870e8', ad = '#1428a0';

    if (fr === 0) {
      // WIND-UP: sword held high overhead with both hands, anticipation sparkles
      ctx.fillStyle = '#f0c090';
      ctx.fillRect(bx+5*Q,  by+10*Q+bob, 8*Q, 22*Q); // L arm raised
      ctx.fillRect(bx+35*Q, by+10*Q+bob, 8*Q, 22*Q); // R arm raised
      ctx.fillStyle = ad;
      ctx.fillRect(bx+5*Q,  by+10*Q+bob, 8*Q,  6*Q); // gauntlets
      ctx.fillRect(bx+35*Q, by+10*Q+bob, 8*Q,  6*Q);
      ctx.fillStyle = ah;
      ctx.fillRect(bx+5*Q,  by+10*Q+bob, Q,    6*Q);
      ctx.fillRect(bx+42*Q, by+10*Q+bob, Q,    6*Q);
      ctx.fillRect(bx+5*Q,  by+10*Q+bob, 8*Q,  Q);
      ctx.fillRect(bx+35*Q, by+10*Q+bob, 8*Q,  Q);
      ctx.fillStyle = '#f0c090';
      ctx.fillRect(bx+6*Q,  by+6*Q+bob,  6*Q,  6*Q); // fists
      ctx.fillRect(bx+36*Q, by+6*Q+bob,  6*Q,  6*Q);
      // blade horizontal overhead (wide two-handed grip)
      ctx.fillStyle = '#1460c0';
      ctx.fillRect(bx-4*Q,  by+2*Q+bob,  58*Q, 5*Q); // shadow
      ctx.fillStyle = '#40a0f0';
      ctx.fillRect(bx-4*Q,  by+P+bob,    58*Q, 5*Q);  // blade (P=4)
      ctx.fillStyle = '#88d0ff';
      ctx.fillRect(bx-4*Q,  by+P+bob,    58*Q, 3*Q);
      ctx.fillStyle = '#c8f0ff';
      ctx.fillRect(bx-4*Q,  by+P+bob,    18*Q, Q);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx-4*Q,  by+P+bob,     Q,   3*Q);  // L tip
      ctx.fillRect(bx+53*Q, by+P+bob,     Q,   3*Q);  // R tip
      ctx.fillStyle = '#c89020';                        // guard
      ctx.fillRect(bx+20*Q, by+4*Q+bob,   8*Q, 4*Q);
      ctx.fillStyle = '#f0c030';
      ctx.fillRect(bx+20*Q, by+4*Q+bob,   8*Q, Q);
      ctx.fillStyle = '#6a3c10';                        // handle sections
      ctx.fillRect(bx+7*Q,  by+5*Q+bob,  14*Q, 4*Q);
      ctx.fillRect(bx+27*Q, by+5*Q+bob,  12*Q, 4*Q);
      // anticipation energy sparkles
      ctx.fillStyle = '#f8f040';
      ctx.fillRect(bx+10*Q, by-2*Q+bob,   2*Q, 2*Q);
      ctx.fillRect(bx+34*Q, by-2*Q+bob,   2*Q, 2*Q);
      ctx.fillRect(bx+22*Q, by-4*Q+bob,   2*Q, 2*Q);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx+22*Q, by-4*Q+bob,   Q,   Q);    // brightest spark

    } else if (fr === 1) {
      // MID-SWING: diagonal slash — DRAMATIC SPEED LINES
      ctx.fillStyle = '#f0c090';
      ctx.fillRect(bx+6*Q,  by+26*Q+bob, 8*Q, 16*Q); // arms extended
      ctx.fillRect(bx+34*Q, by+26*Q+bob, 8*Q, 16*Q);
      ctx.fillStyle = ad;
      ctx.fillRect(bx+6*Q,  by+36*Q+bob, 8*Q,  6*Q);
      ctx.fillRect(bx+34*Q, by+36*Q+bob, 8*Q,  6*Q);
      ctx.fillStyle = ah;
      ctx.fillRect(bx+6*Q,  by+36*Q+bob, Q,    6*Q);
      ctx.fillRect(bx+41*Q, by+36*Q+bob, Q,    6*Q);
      ctx.fillRect(bx+6*Q,  by+36*Q+bob, 8*Q,  Q);
      ctx.fillRect(bx+34*Q, by+36*Q+bob, 8*Q,  Q);
      // diagonal blade (steep arc from top-L to bottom-R)
      for (let i = 0; i < 22; i++) {
        const ox = ~~(i * 1.1) * Q, oy = i * Q;
        ctx.fillStyle = '#1460c0';
        ctx.fillRect(bx+12*Q+ox, by+8*Q+bob+oy+Q, 2*Q, 5*Q);
        ctx.fillStyle = '#40a0f0';
        ctx.fillRect(bx+12*Q+ox, by+8*Q+bob+oy,   2*Q, 5*Q);
        ctx.fillStyle = '#88d0ff';
        ctx.fillRect(bx+12*Q+ox, by+8*Q+bob+oy,   2*Q, 2*Q);
      }
      ctx.fillStyle = '#c8f0ff';
      ctx.fillRect(bx+54*Q, by+28*Q+bob, 2*Q, 5*Q);  // tip glow
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx+54*Q, by+28*Q+bob, Q,   3*Q);
      ctx.fillStyle = '#c89020';                        // guard
      ctx.fillRect(bx+9*Q,  by+26*Q+bob, 6*Q, 6*Q);
      ctx.fillStyle = '#f0c030';
      ctx.fillRect(bx+9*Q,  by+26*Q+bob, 6*Q, Q);
      ctx.fillRect(bx+9*Q,  by+26*Q+bob, Q,   6*Q);
      ctx.fillStyle = '#6a3c10';
      ctx.fillRect(bx+13*Q, by+28*Q+bob, 4*Q, 4*Q);   // handle

      // ── SPEED LINES (fan in upper arc, where sword just swept from) ────────
      ctx.save();
      const speedLines = [
        [bx+38*Q, by+2*Q,  32*Q, -0.20, 0.90],
        [bx+36*Q, by+0*Q,  30*Q, -0.38, 0.85],
        [bx+34*Q, by-2*Q,  28*Q, -0.55, 0.90],
        [bx+32*Q, by-2*Q,  26*Q, -0.72, 0.75],
        [bx+30*Q, by+0*Q,  24*Q, -0.90, 0.80],
        [bx+28*Q, by+2*Q,  22*Q, -1.08, 0.65],
        [bx+42*Q, by+4*Q,  28*Q, -0.04, 0.70],
      ];
      for (const [lx, ly, len, ang, alpha] of speedLines) {
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(ang);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, -Q, len, Q);        // white line
        ctx.fillStyle = '#f8f040';
        ctx.fillRect(Q,  0, len-2*Q, Q);   // yellow echo
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // impact burst at blade tip
      ctx.save();
      ctx.globalAlpha = 0.50;
      ctx.fillStyle = '#fff080';
      ctx.fillRect(bx+46*Q, by+24*Q, 16*Q, 16*Q);
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx+48*Q, by+26*Q, 12*Q, 12*Q);
      ctx.globalAlpha = 1;
      ctx.restore();

    } else {
      // FOLLOW-THROUGH: sword horizontal forward, trailing lines
      ctx.fillStyle = '#f0c090';
      ctx.fillRect(bx+8*Q,  by+30*Q+bob, 8*Q, 14*Q);
      ctx.fillRect(bx+32*Q, by+30*Q+bob, 8*Q, 14*Q);
      ctx.fillStyle = ad;
      ctx.fillRect(bx+8*Q,  by+40*Q+bob, 8*Q,  5*Q);
      ctx.fillRect(bx+32*Q, by+40*Q+bob, 8*Q,  5*Q);
      ctx.fillStyle = ah;
      ctx.fillRect(bx+8*Q,  by+40*Q+bob, Q,    5*Q);
      ctx.fillRect(bx+39*Q, by+40*Q+bob, Q,    5*Q);
      ctx.fillRect(bx+8*Q,  by+40*Q+bob, 8*Q,  Q);
      ctx.fillRect(bx+32*Q, by+40*Q+bob, 8*Q,  Q);
      // horizontal blade
      ctx.fillStyle = '#1460c0';
      ctx.fillRect(bx+22*Q, by+33*Q+bob, 26*Q, 5*Q);
      ctx.fillStyle = '#40a0f0';
      ctx.fillRect(bx+22*Q, by+32*Q+bob, 26*Q, 5*Q);
      ctx.fillStyle = '#88d0ff';
      ctx.fillRect(bx+22*Q, by+32*Q+bob, 26*Q, 2*Q);
      ctx.fillStyle = '#c8f0ff';
      ctx.fillRect(bx+22*Q, by+32*Q+bob,  8*Q, Q);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx+47*Q, by+32*Q+bob,  Q,   5*Q); // tip shine
      ctx.fillStyle = '#c89020';                        // guard
      ctx.fillRect(bx+17*Q, by+28*Q+bob,  6*Q, 12*Q);
      ctx.fillStyle = '#f0c030';
      ctx.fillRect(bx+17*Q, by+28*Q+bob,  Q,   12*Q);
      ctx.fillRect(bx+17*Q, by+28*Q+bob,  6*Q, Q);
      ctx.fillStyle = '#6a3c10';
      ctx.fillRect(bx+10*Q, by+32*Q+bob,  8*Q, 4*Q);  // handle
      ctx.fillStyle = '#9a5c20';
      ctx.fillRect(bx+10*Q, by+32*Q+bob,  8*Q, Q);

      // trailing speed lines (fading)
      ctx.save();
      const trail = [
        [bx+22*Q, by+22*Q, 22*Q, -0.70, 0.45],
        [bx+20*Q, by+26*Q, 20*Q, -0.85, 0.38],
        [bx+18*Q, by+30*Q, 18*Q, -1.00, 0.30],
        [bx+16*Q, by+34*Q, 16*Q, -1.15, 0.22],
      ];
      for (const [lx, ly, len, ang, alpha] of trail) {
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(ang);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, len, Q);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  _drawDead(ctx, bx, by, fr, Q) {
    if (fr < 2) {
      // fr 0 = stumbling, fr 1 = on knees
      const tilt = fr * 4*Q;
      ctx.fillStyle = '#e8a020';
      ctx.fillRect(bx+10*Q, by+4*Q+tilt, 28*Q,  6*Q);
      ctx.fillRect(bx+18*Q, by+0*Q+tilt,  6*Q,  5*Q);
      ctx.fillStyle = '#f8d040';
      ctx.fillRect(bx+19*Q, by+0*Q+tilt,  3*Q,  4*Q);
      ctx.fillStyle = '#c07810';
      ctx.fillRect(bx+9*Q,  by+9*Q+tilt, 30*Q,  2*Q);
      ctx.fillStyle = '#f0c090';
      ctx.fillRect(bx+12*Q, by+8*Q+tilt, 24*Q, 18*Q);
      ctx.fillStyle = '#2848c8';
      ctx.fillRect(bx+12*Q, by+26*Q+tilt, 24*Q, 16*Q);
      ctx.fillStyle = '#4870e8';
      ctx.fillRect(bx+12*Q, by+26*Q+tilt, 24*Q,  Q);
      ctx.fillStyle = '#c89020';
      ctx.fillRect(bx+12*Q, by+41*Q+tilt, 24*Q,  3*Q);
      ctx.fillStyle = '#1a2888';
      ctx.fillRect(bx+12*Q, by+44*Q+tilt, 10*Q,  8*Q);
      ctx.fillRect(bx+26*Q, by+44*Q+tilt, 10*Q,  8*Q);
      ctx.fillStyle = '#101450';
      ctx.fillRect(bx+10*Q, by+51*Q+tilt, 12*Q,  5*Q);
      ctx.fillRect(bx+26*Q, by+51*Q+tilt, 12*Q,  5*Q);
      return;
    }

    // fr 2: lying flat (freezes here)
    const y = by + 36*Q;
    ctx.fillStyle = '#e8a020';                          // hair splayed
    ctx.fillRect(bx,      y-10*Q, 18*Q,  5*Q);
    ctx.fillRect(bx,      y-14*Q, 12*Q,  5*Q);
    ctx.fillStyle = '#f8d040';
    ctx.fillRect(bx+Q,    y-13*Q,  4*Q,  3*Q);
    ctx.fillRect(bx+5*Q,  y-15*Q,  3*Q,  4*Q);
    ctx.fillStyle = '#c07810';
    ctx.fillRect(bx,      y-6*Q,  18*Q,  Q);
    ctx.fillStyle = '#f0c090';                          // head profile
    ctx.fillRect(bx+Q,    y-6*Q,  14*Q, 10*Q);
    ctx.fillStyle = '#dab080';
    ctx.fillRect(bx+Q,    y+3*Q,  14*Q,  Q);
    ctx.fillStyle = '#f8a898';
    ctx.fillRect(bx+9*Q,  y-Q,     4*Q,  3*Q);
    // X eyes
    ctx.fillStyle = '#000000';
    const ex = bx+3*Q, ey = y-3*Q;
    ctx.fillRect(ex,      ey,       Q, Q); ctx.fillRect(ex+2*Q, ey,      Q, Q);
    ctx.fillRect(ex+Q,    ey+Q,     Q, Q);
    ctx.fillRect(ex,      ey+2*Q,   Q, Q); ctx.fillRect(ex+2*Q, ey+2*Q,  Q, Q);
    const ex2 = bx+8*Q;
    ctx.fillRect(ex2,     ey,       Q, Q); ctx.fillRect(ex2+2*Q, ey,     Q, Q);
    ctx.fillRect(ex2+Q,   ey+Q,     Q, Q);
    ctx.fillRect(ex2,     ey+2*Q,   Q, Q); ctx.fillRect(ex2+2*Q, ey+2*Q, Q, Q);
    ctx.fillStyle = '#2848c8';                          // body
    ctx.fillRect(bx+12*Q, y-5*Q,  28*Q, 10*Q);
    ctx.fillStyle = '#4870e8';
    ctx.fillRect(bx+12*Q, y-5*Q,  28*Q,  Q);
    ctx.fillStyle = '#1428a0';
    ctx.fillRect(bx+12*Q, y+4*Q,  28*Q,  Q);
    ctx.fillStyle = '#c89020';
    ctx.fillRect(bx+12*Q, y+2*Q,  28*Q,  2*Q);
    ctx.fillStyle = '#1a2888';
    ctx.fillRect(bx+30*Q, y+2*Q,  18*Q,  6*Q);
    ctx.fillStyle = '#101450';
    ctx.fillRect(bx+38*Q, y+2*Q,   8*Q,  6*Q);
    ctx.fillStyle = '#c89020';
    ctx.fillRect(bx+38*Q, y+7*Q,   8*Q,  Q);
    ctx.fillStyle = '#1460c0';                          // fallen sword
    ctx.fillRect(bx+22*Q, y+5*Q,  22*Q,  4*Q);
    ctx.fillStyle = '#40a0f0';
    ctx.fillRect(bx+22*Q, y+5*Q,  22*Q,  3*Q);
    ctx.fillStyle = '#88d0ff';
    ctx.fillRect(bx+22*Q, y+5*Q,  22*Q,  Q);
    ctx.fillStyle = '#c89020';
    ctx.fillRect(bx+17*Q, y+3*Q,   6*Q,  8*Q);
    ctx.fillStyle = '#6a3c10';
    ctx.fillRect(bx+14*Q, y+5*Q,   4*Q,  5*Q);
    ctx.fillStyle = '#f0c090';                          // arm dangling
    ctx.fillRect(bx+22*Q, y-8*Q,   6*Q,  8*Q);
    ctx.fillStyle = '#1428a0';
    ctx.fillRect(bx+22*Q, y-4*Q,   6*Q,  4*Q);
  }
}

// ─── Fiend base ───────────────────────────────────────────────────────────────
const F_FRM = { walk:4, idle:2, attack:3, hit:2, death:5, reveal:1, retreat:4 };
const FIEND_EXIT_X = CANVAS_W + 100;
// Retreating fiends (after hitting the hero / a wrong answer) must always
// clear the screen within this many seconds, no matter how slow the level's
// walk-in speed was — otherwise a fiend on an easy (long-timer) level can
// crawl off-screen for close to 10s.
const RETREAT_MAX_SECONDS = 3;

export class Fiend extends Entity {
  constructor(x, y, cfg) {
    super(x, y);
    this.hp = cfg.hp;
    this._pal = cfg.palette;
    this.walkSpeed = 50;
    this._retreatSpeed = this.walkSpeed * 2;
    this.problem = null;
    this.wasRequeued = false;
    this._redFlash = 0;
    this._particlesSpawned = false;
    this._particles = [];
    this._events = new EventTarget();
    this._dur = 8;
    this.isElite = false;
    this.fiendClassId = cfg.fiendClassId ?? null;
    this.setState('walk');
  }

  get isDead() { return this.hp <= 0; }
  // Fixed once retreat begins (see setState), so the pace stays constant for
  // the whole flight off-screen instead of drifting with the fiend's walk speed.
  get retreatSpeed() { return this._retreatSpeed; }
  hit() { this.hp-- > 1 ? this.setState('hit') : this.setState('death'); }
  attack() { this.setState('attack'); }
  on(ev, fn) { this._events.addEventListener(ev, fn); }
  _emit(ev) { this._events.dispatchEvent(new Event(ev)); }

  setState(s) {
    super.setState(s);
    if (s === 'retreat') {
      const distance = Math.max(1, FIEND_EXIT_X - this.x);
      // Never slower than the old 2x-walk-speed pace, but always fast enough
      // to finish within RETREAT_MAX_SECONDS.
      this._retreatSpeed = Math.max(this.walkSpeed * 2, distance / RETREAT_MAX_SECONDS);
    }
  }

  update(dt) {
    super.update(dt);
    if (this._state === 'walk') {
      this.x -= this.walkSpeed * dt;
      if (this.x < FIEND_COMBAT_X) this.setState('idle');
    }
    if (this._state === 'retreat') {
      this.x += this.retreatSpeed * dt;
      if (this.x > FIEND_EXIT_X) this._emit('retreated');
    }
    if (this._redFlash > 0) this._redFlash -= dt;
    this._particles = this._particles.filter(p => p.life > 0);
    this._particles.forEach(p => { p.x += p.vx*dt; p.y += p.vy*dt; p.life -= dt; });
  }

  _onFrameAdvance() {
    this._frame++;
    const max = F_FRM[this._state] || 2;
    if (this._frame >= max) {
      if (this._state === 'hit' || this._state === 'attack') {
        // resume walking if not yet at combat range
        this.setState(this.x > FIEND_COMBAT_X ? 'walk' : 'idle');
      }
      else if (this._state === 'death') {
        if (!this._particlesSpawned) {
          this._spawnParticles();
          this._particlesSpawned = true;
        } else if (this._particles.length === 0) {
          this._emit('dead');
        }
        this._frame = max - 1;
      } else this._frame = 0;
    }
  }

  _spawnParticles() {
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 140;
      this._particles.push({
        x: this.x, y: this.y - 8*P,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        life: 0.7 + Math.random() * 0.5,
        colour: [this._pal.body, this._pal.hi || '#ffffff', this._pal.dark][i % 3],
        size: 4 + (i % 3) * 4,
      });
    }
  }

  _drawParticles(ctx) {
    ctx.save();
    this._particles.forEach(p => {
      ctx.fillStyle = p.colour;
      ctx.globalAlpha = Math.max(0, p.life * 1.2);
      ctx.fillRect(~~(p.x - p.size/2), ~~(p.y - p.size/2), p.size, p.size);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _flashWhite(ctx, bx, by, w, h) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(bx, by, w, h);
  }

  _flashRed(ctx, bx, by, w, h) {
    if (this._redFlash <= 0) return;
    ctx.fillStyle = `rgba(255,50,20,${Math.min(0.65, this._redFlash * 2).toFixed(2)})`;
    ctx.fillRect(bx, by, w, h);
  }

  _drawEliteAura(ctx, bx, by, w, h) {
    const t = this._tick * 0.18;
    const scale = 1 + 0.12 * Math.sin(t);
    const cx = bx + w / 2;
    const cy = by + h / 2;
    const rx = (w / 2 + 5*P) * scale;
    const ry = (h / 2 + 5*P) * scale;
    ctx.save();
    ctx.globalAlpha = (0.45 + 0.25 * Math.sin(t)) * 0.8;
    ctx.fillStyle = '#ff2000';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Box the class sprite is (or would be) drawn into, in canvas coordinates.
  // Shared by drawing and projectile collision so a hit lands exactly on the
  // pixels the player sees instead of on a separate approximation.
  _spriteBox() {
    // Target box enlarged from 20*P to 38*P: fiend source art was being downscaled far
    // more aggressively than the hero spritesheet, making fiends look tiny/out of place
    // next to the hero. 38*P puts fiends at a comparable on-screen scale to the hero
    // (hero draws at a fixed 150-160px tall).
    const targetW = 38 * P, targetH = 38 * P;
    const img = this.fiendClassId ? getFiendClassSprite(this.fiendClassId) : null;
    const hasSprite = Boolean(img && img.complete && img.naturalWidth);
    const aspect = hasSprite ? img.naturalWidth / img.naturalHeight : 1;
    let drawW = targetW;
    let drawH = targetW / aspect;
    if (drawH > targetH) { drawH = targetH; drawW = targetH * aspect; }

    const bx = ~~(this.x - drawW / 2);
    // Fiend art has a few percent of transparent padding below the actual
    // artwork (varies per creature). Shift the draw position down by that
    // padding fraction of drawH so the creature's real visual base lands on
    // this.y — the same ground line the hero's feet stand on — instead of
    // the sprite's raw (padded) bounding-box bottom landing there. No
    // separate drawn shadow is needed once the base actually lines up.
    const bottomPadRatio = this.fiendClassId
      ? (getFiendClass(this.fiendClassId).bottomPadRatio ?? 0) : 0;
    const by = ~~(this.y - drawH + drawH * bottomPadRatio);
    return { img: hasSprite ? img : null, drawW, drawH, bx, by };
  }

  // Axis-aligned bounds of the visible sprite, used as the authoritative hit
  // target for hero projectiles.
  getHitBounds() {
    const { bx, by, drawW, drawH } = this._spriteBox();
    return { left: bx, right: bx + drawW, top: by, bottom: by + drawH };
  }

  // Draws the selected fiend-class sprite if its image has loaded. Returns true if
  // it drew (caller skips its procedural body), false to fall back to procedural art.
  _drawClassSprite(ctx) {
    if (!this.fiendClassId) return false;
    const { img, drawW, drawH, bx, by } = this._spriteBox();
    if (!img) return false;
    // Fiends' art faces left (their walk-in direction, toward the hero). When
    // retreating after a wrong answer they move right, so mirror the sprite
    // horizontally to face the direction of travel — same technique
    // DragonSummon.draw() uses below (translate to the right edge, then
    // scale(-1,1) so drawImage's local [0,w] maps back onto [bx, bx+w]).
    const faceRight = this._state === 'retreat';

    ctx.save();
    if (this.isElite) this._drawEliteAura(ctx, bx, by, drawW, drawH);
    if (faceRight) {
      ctx.translate(bx + drawW, by);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, drawW, drawH);
    } else {
      ctx.drawImage(img, bx, by, drawW, drawH);
    }
    ctx.restore();
    if (this._state === 'hit') this._flashWhite(ctx, bx, by, drawW, drawH);
    this._flashRed(ctx, bx, by, drawW, drawH);
    this._drawParticles(ctx);
    return true;
  }
}

// ─── Slimeling (blue-green blob, Chapter 1 — Addition) ────────────────────────
export class Slimeling extends Fiend {
  constructor(x, y, hp = 1, palette) {
    super(x, y, { hp, palette: palette ?? { body:'#f07030', dark:'#a04010', hi:'#ffb060' } });
  }

  draw(ctx) {
    if (this._drawClassSprite(ctx)) return;
    const bobY = (this._state === 'walk') ? ~~(Math.sin(this._frame * Math.PI) * 2 * P) : 0;
    const attX  = (this._state === 'attack') ? -this._frame * 2 * P : 0;
    const bx = ~~(this.x - 9*P) + attX;
    const by = ~~(this.y - 15*P) + bobY;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(bx+2*P, by+15*P, 14*P, 3*P);
    if (this.isElite) this._drawEliteAura(ctx, bx, by, 18*P, 15*P);

    // body — rounded blob
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+2*P, by+10*P, 14*P, 6*P);  // base dark
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+2*P, by+2*P, 14*P, 12*P);  // main
    ctx.fillRect(bx+4*P, by,     10*P, 4*P);    // top dome
    ctx.fillRect(bx,     by+6*P, 18*P, 6*P);    // wide equator
    ctx.fillRect(bx+P,   by+4*P, 16*P, 4*P);    // mid band
    // specular highlight
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+4*P, by+P,   4*P, 3*P);
    ctx.fillRect(bx+3*P, by+3*P, 2*P, 2*P);
    // underbelly
    ctx.fillStyle = '#ffe0c0';
    ctx.fillRect(bx+4*P, by+10*P, 10*P, 4*P);
    ctx.fillRect(bx+6*P, by+12*P, 6*P,  2*P);

    // feet / squish bottom
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+2*P, by+13*P, 4*P, 2*P);
    ctx.fillRect(bx+12*P, by+13*P, 4*P, 2*P);

    // eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx+4*P, by+4*P, 4*P, 4*P);
    ctx.fillRect(bx+10*P, by+4*P, 4*P, 4*P);
    ctx.fillStyle = '#000000';
    ctx.fillRect(bx+5*P, by+5*P, 2*P, 2*P);
    ctx.fillRect(bx+11*P, by+5*P, 2*P, 2*P);
    // eye shine
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx+5*P, by+5*P, P, P);
    ctx.fillRect(bx+11*P, by+5*P, P, P);

    // smile
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+5*P, by+10*P, P, P);
    ctx.fillRect(bx+6*P, by+11*P, 6*P, P);
    ctx.fillRect(bx+12*P, by+10*P, P, P);

    if (this._state === 'hit') this._flashWhite(ctx, bx, by, 18*P, 15*P);
    this._flashRed(ctx, bx, by, 18*P, 15*P);
    this._drawParticles(ctx);
  }
}

// ─── Bonehead (skeleton, Chapter 2 — Subtraction) ─────────────────────────────
export class Bonehead extends Fiend {
  constructor(x, y, hp = 1, palette) {
    super(x, y, { hp, palette: palette ?? { body:'#b8c0c8', dark:'#606870', hi:'#d8e4ec' } });
  }

  draw(ctx) {
    if (this._drawClassSprite(ctx)) return;
    const rattle = (this._state === 'walk' && this._frame % 2 === 0) ? P : 0;
    const attX   = (this._state === 'attack') ? -this._frame * 2 * P : 0;
    const bx = ~~(this.x - 8*P) + attX;
    const by = ~~(this.y - 28*P);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(bx+2*P, by+28*P, 14*P, 2*P);
    if (this.isElite) this._drawEliteAura(ctx, bx, by, 16*P, 30*P);

    // --- skull ---
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+3*P, by,       10*P, 10*P);  // cranium
    ctx.fillRect(bx+2*P, by+2*P,   12*P, 6*P);   // wider mid
    ctx.fillRect(bx+4*P, by+9*P,   8*P,  4*P);   // jaw
    // skull highlight
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+4*P, by+P,     4*P,  3*P);
    ctx.fillRect(bx+3*P, by+3*P,   2*P,  2*P);
    // skull shadow edge
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+12*P, by+2*P,  2*P,  6*P);
    ctx.fillRect(bx+3*P,  by+9*P,  2*P,  3*P);
    ctx.fillRect(bx+11*P, by+9*P,  2*P,  3*P);
    // eyes (dark hollow sockets)
    ctx.fillStyle = '#202010';
    ctx.fillRect(bx+4*P, by+3*P,   3*P, 3*P);
    ctx.fillRect(bx+9*P, by+3*P,   3*P, 3*P);
    ctx.fillStyle = '#404030';
    ctx.fillRect(bx+4*P, by+3*P,   P,   P);
    ctx.fillRect(bx+9*P, by+3*P,   P,   P);
    // nose
    ctx.fillStyle = '#404030';
    ctx.fillRect(bx+7*P, by+7*P,   2*P, 2*P);
    // teeth
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+4*P, by+10*P,  2*P, 2*P);
    ctx.fillRect(bx+7*P, by+10*P,  2*P, 2*P);
    ctx.fillRect(bx+10*P, by+10*P, 2*P, 2*P);
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+6*P, by+10*P,  P,   2*P);
    ctx.fillRect(bx+9*P, by+10*P,  P,   2*P);

    // --- neck ---
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+6*P, by+12*P,  4*P, 2*P);

    // --- ribcage ---
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+4*P, by+14*P,  8*P, 10*P);   // sternum
    // ribs (4 pairs)
    const ribC = this._pal.body;
    for (let ri = 0; ri < 4; ri++) {
      const ry = by+14*P+ri*2*P;
      ctx.fillStyle = ribC;
      ctx.fillRect(bx+2*P,  ry, 2*P, P);  // left rib
      ctx.fillRect(bx+12*P, ry, 2*P, P);  // right rib
    }
    // spine
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+7*P, by+14*P, 2*P, 10*P);
    // ribcage highlight
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+4*P, by+14*P, 2*P, 2*P);

    // --- arms ---
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+P,   by+14*P+rattle, 3*P, 10*P);  // left
    ctx.fillRect(bx+12*P, by+14*P-rattle, 3*P, 10*P); // right
    // elbow knobs
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+P,   by+18*P+rattle, 3*P, 2*P);
    ctx.fillRect(bx+12*P, by+18*P-rattle, 3*P, 2*P);
    // hand bones
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx,     by+22*P+rattle, 4*P, 4*P);
    ctx.fillRect(bx+12*P, by+22*P-rattle, 4*P, 4*P);

    // --- pelvis + legs ---
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+3*P, by+24*P, 10*P, 3*P);
    ctx.fillRect(bx+4*P, by+26*P, 3*P,  4*P);
    ctx.fillRect(bx+9*P, by+26*P, 3*P,  4*P);
    // knee
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+4*P, by+27*P, 3*P,  2*P);
    ctx.fillRect(bx+9*P, by+27*P, 3*P,  2*P);

    if (this._state === 'hit') this._flashWhite(ctx, bx, by, 16*P, 30*P);
    this._flashRed(ctx, bx, by, 16*P, 30*P);
    this._drawParticles(ctx);
  }
}

// ─── Toadlord (crowned green blob, Chapter 3 — Multiplication) ────────────────
export class Toadlord extends Fiend {
  constructor(x, y, hp = 2, palette) {
    super(x, y, { hp, palette: palette ?? { body:'#e02828', dark:'#901010', hi:'#ff6060' } });
  }

  draw(ctx) {
    if (this._drawClassSprite(ctx)) return;
    const stomp   = (this._state === 'walk') ? (this._frame % 2 === 0 ? P : -P) : 0;
    const attX    = (this._state === 'attack') ? -this._frame * 3 * P : 0;
    const bx = ~~(this.x - 11*P) + attX;
    const by = ~~(this.y - 22*P) + stomp;

    // shadow (grows on stomp)
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(bx+2*P, by+22*P-stomp, 20*P, 3*P);
    if (this.isElite) this._drawEliteAura(ctx, bx, by - 6*P, 22*P, 30*P);

    // body — wide rounded blob
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+P,   by+12*P, 20*P, 10*P);  // dark base
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+2*P, by+4*P,  18*P, 16*P);  // main body
    ctx.fillRect(bx,     by+8*P,  22*P, 8*P);   // wide equator
    ctx.fillRect(bx+4*P, by+2*P,  14*P, 4*P);   // head top
    // body highlight
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+3*P, by+4*P,  5*P, 6*P);
    ctx.fillRect(bx+4*P, by+3*P,  3*P, 3*P);
    // belly (lighter)
    ctx.fillStyle = '#ff9090';
    ctx.fillRect(bx+5*P, by+12*P, 12*P, 6*P);
    ctx.fillRect(bx+7*P, by+16*P, 8*P,  3*P);
    // belly dots
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+8*P, by+13*P, 2*P, 2*P);
    ctx.fillRect(bx+12*P, by+13*P, 2*P, 2*P);
    ctx.fillRect(bx+10*P, by+16*P, 2*P, 2*P);

    // feet / lumps at bottom
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+2*P, by+18*P, 5*P, 4*P);
    ctx.fillRect(bx+15*P, by+18*P, 5*P, 4*P);
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+3*P, by+18*P, 3*P, 3*P);
    ctx.fillRect(bx+16*P, by+18*P, 3*P, 3*P);

    // eyes (big, round, expressive)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx+4*P, by+5*P, 6*P, 5*P);
    ctx.fillRect(bx+12*P, by+5*P, 6*P, 5*P);
    ctx.fillStyle = '#204010';
    ctx.fillRect(bx+6*P, by+6*P, 3*P, 3*P);
    ctx.fillRect(bx+14*P, by+6*P, 3*P, 3*P);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx+6*P, by+6*P, P, P);
    ctx.fillRect(bx+14*P, by+6*P, P, P);
    // eye sockets outline
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+3*P, by+4*P, P, 6*P);
    ctx.fillRect(bx+11*P, by+4*P, P, 6*P);

    // smile / mouth
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+6*P, by+12*P, P, P);
    ctx.fillRect(bx+7*P, by+13*P, 8*P, P);
    ctx.fillRect(bx+15*P, by+12*P, P, P);
    // teeth
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx+8*P, by+12*P, 2*P, P);
    ctx.fillRect(bx+12*P, by+12*P, 2*P, P);

    // arms (stubby)
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx-2*P, by+8*P, 4*P, 8*P);
    ctx.fillRect(bx+20*P, by+8*P, 4*P, 8*P);
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx-P, by+9*P, 3*P, 6*P);
    ctx.fillRect(bx+20*P, by+9*P, 3*P, 6*P);

    // crown
    ctx.fillStyle = '#c8a020';
    ctx.fillRect(bx+4*P, by-2*P, 14*P, 5*P);  // crown band
    // crown spikes
    ctx.fillStyle = '#e8c030';
    ctx.fillRect(bx+4*P, by-6*P,  3*P, 5*P);
    ctx.fillRect(bx+9*P, by-8*P,  4*P, 7*P);  // centre spike (tallest)
    ctx.fillRect(bx+15*P, by-6*P, 3*P, 5*P);
    // crown gems
    ctx.fillStyle = '#e03030'; ctx.fillRect(bx+6*P, by-P, 2*P, 2*P);  // red
    ctx.fillStyle = '#3060e8'; ctx.fillRect(bx+10*P, by-P, 2*P, 2*P); // blue
    ctx.fillStyle = '#30c030'; ctx.fillRect(bx+14*P, by-P, 2*P, 2*P); // green
    // crown jewel (orb on top)
    ctx.fillStyle = '#f8e050';
    ctx.fillRect(bx+10*P, by-10*P, 2*P, 2*P);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx+10*P, by-10*P, P, P);
    // crown highlight
    ctx.fillStyle = '#f8e060';
    ctx.fillRect(bx+4*P, by-2*P, 14*P, 2*P);

    if (this._state === 'hit') this._flashWhite(ctx, bx, by-6*P, 22*P, 30*P);
    this._flashRed(ctx, bx, by-6*P, 22*P, 30*P);
    this._drawParticles(ctx);
  }
}

// ─── Magelitch (robed mage, Chapter 4 — All Operations) ───────────────────────
export class Magelitch extends Fiend {
  constructor(x, y, hp = 2, palette) {
    super(x, y, { hp, palette: palette ?? { body:'#1890a8', dark:'#0c5870', hi:'#30c0d8' } });
  }

  draw(ctx) {
    if (this._drawClassSprite(ctx)) return;
    // hover animation
    const hov = ~~(Math.sin(this._tick * 0.12) * 3 * P);
    const attX = (this._state === 'attack') ? -this._frame * 2 * P : 0;
    const bx = ~~(this.x - 8*P) + attX;
    const by = ~~(this.y - 30*P) + hov;

    // shadow (fades at hover peak)
    const shadowA = 0.22 - Math.abs(hov) * 0.008;
    ctx.fillStyle = `rgba(0,0,0,${shadowA.toFixed(2)})`;
    ctx.fillRect(bx+2*P, by+30*P-hov, 12*P, 3*P);
    if (this.isElite) this._drawEliteAura(ctx, bx, by - 10*P, 16*P, 42*P);

    // robe body
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+P,   by+10*P, 14*P, 20*P);  // dark base
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+2*P, by+10*P, 12*P, 18*P);  // robe main
    ctx.fillRect(bx+3*P, by+10*P, 10*P, 2*P);   // collar
    // robe highlight (left edge)
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+2*P, by+10*P, 3*P, 16*P);
    // robe shadow (right edge)
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+13*P, by+10*P, 2*P, 18*P);
    // robe hem (wave)
    ctx.fillStyle = '#28a8c0';
    ctx.fillRect(bx+2*P, by+26*P, 12*P, 2*P);
    ctx.fillRect(bx+3*P, by+27*P, 10*P, P);
    // robe trim (gold)
    ctx.fillStyle = '#c8a030';
    ctx.fillRect(bx+2*P, by+10*P, 12*P, P);
    ctx.fillRect(bx+2*P, by+26*P, 12*P, P);
    // rune symbols on robe
    ctx.fillStyle = '#40d0e8';
    ctx.fillRect(bx+7*P, by+16*P, 2*P, 4*P);
    ctx.fillRect(bx+6*P, by+17*P, 4*P, 2*P);

    // arms (sleeves)
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx,     by+12*P, 3*P, 8*P);
    ctx.fillRect(bx+13*P, by+12*P, 3*P, 8*P);
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx,     by+12*P, P, 8*P);
    // hands with sparkle
    ctx.fillStyle = '#f4c080';
    ctx.fillRect(bx-P, by+19*P, 3*P, 3*P);
    ctx.fillRect(bx+14*P, by+19*P, 3*P, 3*P);
    // sparkles on hands
    const spA = (this._tick % 4 < 2);
    ctx.fillStyle = spA ? '#f8e060' : '#a0c0ff';
    ctx.fillRect(bx-2*P, by+17*P, 2*P, 2*P);
    ctx.fillRect(bx+16*P, by+17*P, 2*P, 2*P);

    // neck/head
    ctx.fillStyle = '#f4c080';
    ctx.fillRect(bx+6*P, by+8*P, 4*P, 4*P);
    // face glow
    ctx.fillStyle = '#202040';
    ctx.fillRect(bx+5*P, by+6*P, 6*P, 6*P);
    // glowing eyes
    ctx.fillStyle = '#60f0f8';
    ctx.fillRect(bx+5*P, by+7*P, 2*P, 2*P);
    ctx.fillRect(bx+9*P, by+7*P, 2*P, 2*P);
    ctx.fillStyle = '#a0f8ff';
    ctx.fillRect(bx+5*P, by+7*P, P, P);
    ctx.fillRect(bx+9*P, by+7*P, P, P);
    // tiny pointy nose
    ctx.fillStyle = '#c0a0a0';
    ctx.fillRect(bx+7*P, by+9*P, P, P);
    // grinning mouth
    ctx.fillStyle = '#0c7080';
    ctx.fillRect(bx+6*P, by+10*P, P, P);
    ctx.fillRect(bx+7*P, by+11*P, 2*P, P);
    ctx.fillRect(bx+9*P, by+10*P, P, P);

    // pointed hat
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+4*P,  by+2*P, 8*P, 6*P);   // brim
    ctx.fillRect(bx+5*P,  by-2*P, 6*P, 5*P);   // lower cone
    ctx.fillRect(bx+6*P,  by-6*P, 4*P, 5*P);   // mid cone
    ctx.fillRect(bx+7*P,  by-10*P, 2*P, 5*P);  // tip
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+5*P,  by+2*P, 6*P, 5*P);
    ctx.fillRect(bx+6*P,  by-2*P, 4*P, 5*P);
    ctx.fillRect(bx+7*P,  by-6*P, 2*P, 4*P);
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+5*P,  by+2*P, P, 5*P);
    // hat band
    ctx.fillStyle = '#c8a030';
    ctx.fillRect(bx+4*P, by+2*P, 8*P, 2*P);
    // hat gem
    ctx.fillStyle = '#e830a0';
    ctx.fillRect(bx+7*P, by+2*P, 2*P, 2*P);
    ctx.fillStyle = '#ff70c8';
    ctx.fillRect(bx+7*P, by+2*P, P, P);
    // tip star
    ctx.fillStyle = '#f0f0a0';
    ctx.fillRect(bx+7*P, by-10*P, 2*P, 2*P);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx+7*P, by-10*P, P, P);

    if (this._state === 'hit') this._flashWhite(ctx, bx, by-10*P, 16*P, 42*P);
    this._flashRed(ctx, bx, by-10*P, 16*P, 42*P);
    this._drawParticles(ctx);
  }
}

// ─── BirdFoe (raven-type, Subtraction '−') ────────────────────────────────────
export class BirdFoe extends Fiend {
  constructor(x, y, hp = 1, palette) {
    super(x, y, { hp, palette: palette ?? { body:'#5048a8', dark:'#28205a', hi:'#8878d0' } });
  }

  draw(ctx) {
    if (this._drawClassSprite(ctx)) return;
    const wY   = (this._state === 'walk') ? (this._frame % 2 === 0 ? -P : P) : 0;
    const attX = (this._state === 'attack') ? -this._frame * 2 * P : 0;
    const bx = ~~(this.x - 11*P) + attX;
    const by = ~~(this.y - 22*P);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(bx+3*P, by+21*P, 16*P, 2*P);
    if (this.isElite) this._drawEliteAura(ctx, bx, by, 22*P, 22*P);

    // tail feathers
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+16*P, by+13*P, 6*P, P);
    ctx.fillRect(bx+17*P, by+14*P, 5*P, P);
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+18*P, by+12*P, 3*P, P);

    // body
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+4*P, by+11*P, 12*P, 9*P);
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+5*P, by+10*P, 10*P, 8*P);
    ctx.fillRect(bx+4*P, by+12*P, 12*P, 5*P);
    // breast
    ctx.fillStyle = '#b0a0e0';
    ctx.fillRect(bx+7*P, by+12*P, 6*P, 5*P);

    // wings (flap alternates up/down)
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx,      by+9*P+wY,  6*P, 8*P);
    ctx.fillRect(bx+16*P, by+9*P-wY,  6*P, 8*P);
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+P,    by+9*P+wY,  4*P, 7*P);
    ctx.fillRect(bx+16*P, by+9*P-wY,  4*P, 7*P);
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+P,    by+14*P+wY, 3*P, P);
    ctx.fillRect(bx+16*P, by+14*P-wY, 3*P, P);

    // neck
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+7*P, by+7*P, 4*P, 4*P);

    // head
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+5*P, by+2*P, 10*P, 8*P);
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+6*P, by+2*P, 8*P,  7*P);
    ctx.fillRect(bx+5*P, by+4*P, 2*P,  3*P);  // crown feather
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+6*P, by+2*P, 2*P,  3*P);  // head highlight

    // beak (pointing left = attack direction)
    ctx.fillStyle = '#d8a020';
    ctx.fillRect(bx+2*P, by+5*P, 5*P, 2*P);
    ctx.fillRect(bx+P,   by+6*P, 4*P, P);
    ctx.fillStyle = '#f8c840';
    ctx.fillRect(bx+2*P, by+5*P, 3*P, P);

    // eyes (yellow)
    ctx.fillStyle = '#f8e040';
    ctx.fillRect(bx+8*P,  by+4*P, 3*P, 3*P);
    ctx.fillRect(bx+12*P, by+4*P, 3*P, 3*P);
    ctx.fillStyle = '#000000';
    ctx.fillRect(bx+9*P,  by+5*P, P, P);
    ctx.fillRect(bx+13*P, by+5*P, P, P);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx+9*P,  by+4*P, P, P);  // catchlight

    // legs / talons
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+6*P,  by+17*P, 2*P, 4*P);
    ctx.fillRect(bx+12*P, by+17*P, 2*P, 4*P);
    ctx.fillStyle = '#c89040';
    ctx.fillRect(bx+4*P,  by+20*P, 5*P, P);
    ctx.fillRect(bx+11*P, by+20*P, 5*P, P);
    ctx.fillRect(bx+6*P,  by+21*P, P,   P);
    ctx.fillRect(bx+12*P, by+21*P, P,   P);

    if (this._state === 'hit') this._flashWhite(ctx, bx, by, 22*P, 22*P);
    this._flashRed(ctx, bx, by, 22*P, 22*P);
    this._drawParticles(ctx);
  }
}

// ─── WolfFoe (wolf-type, Multiplication '×') ──────────────────────────────────
export class WolfFoe extends Fiend {
  constructor(x, y, hp = 1, palette) {
    super(x, y, { hp, palette: palette ?? { body:'#808090', dark:'#404050', hi:'#b0b0c0' } });
  }

  draw(ctx) {
    if (this._drawClassSprite(ctx)) return;
    const prowl = (this._state === 'walk') ? (this._frame % 2 === 0 ? P : 0) : 0;
    const attX  = (this._state === 'attack') ? -this._frame * 3 * P : 0;
    const bx = ~~(this.x - 10*P) + attX;
    const by = ~~(this.y - 26*P) + prowl;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(bx+2*P, by+25*P-prowl, 18*P, 2*P);
    if (this.isElite) this._drawEliteAura(ctx, bx, by, 24*P, 26*P);

    // tail
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+20*P, by+10*P, 4*P, 3*P);
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+18*P, by+12*P, 4*P, 3*P);
    ctx.fillStyle = '#e0e0d8';
    ctx.fillRect(bx+22*P, by+9*P,  3*P, 4*P);  // white tail tip

    // hind legs
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+3*P,  by+20*P, 4*P, 6*P);
    ctx.fillRect(bx+13*P, by+20*P, 4*P, 6*P);
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+4*P,  by+20*P, 3*P, 5*P);
    ctx.fillRect(bx+14*P, by+20*P, 3*P, 5*P);
    // paws
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+2*P,  by+24*P, 6*P, 2*P);
    ctx.fillRect(bx+12*P, by+24*P, 6*P, 2*P);

    // body
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+2*P, by+12*P, 16*P, 10*P);
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+3*P, by+11*P, 14*P, 10*P);
    ctx.fillRect(bx+2*P, by+13*P, 16*P,  7*P);
    // belly (lighter)
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+7*P,  by+14*P, 6*P, 6*P);

    // arms / claws
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx-P,    by+13*P, 4*P, 8*P);
    ctx.fillRect(bx+17*P, by+13*P, 4*P, 8*P);
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx,      by+14*P, 3*P, 6*P);
    ctx.fillRect(bx+17*P, by+14*P, 3*P, 6*P);
    ctx.fillStyle = '#d8d0b0';
    ctx.fillRect(bx-2*P,  by+20*P, P,   2*P);
    ctx.fillRect(bx,      by+20*P, P,   3*P);
    ctx.fillRect(bx+2*P,  by+20*P, P,   2*P);
    ctx.fillRect(bx+17*P, by+20*P, P,   2*P);
    ctx.fillRect(bx+19*P, by+20*P, P,   3*P);
    ctx.fillRect(bx+21*P, by+20*P, P,   2*P);

    // neck fur spikes
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+5*P,  by+9*P, 10*P, 4*P);
    ctx.fillStyle = this._pal.hi;
    for (let i = 0; i < 4; i++) ctx.fillRect(bx+5*P+i*2*P, by+8*P+i%2*P, P, 4*P);

    // head
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+4*P,  by+2*P, 12*P, 9*P);
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+5*P,  by+2*P, 10*P, 8*P);
    // ears (pointy)
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+4*P,  by+0,   P,    4*P);
    ctx.fillRect(bx+15*P, by+0,   P,    4*P);
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+5*P,  by+2*P, 3*P,  4*P);  // head highlight

    // snout
    ctx.fillStyle = '#b0a898';
    ctx.fillRect(bx+3*P,  by+6*P, 7*P,  4*P);
    ctx.fillRect(bx+2*P,  by+7*P, 8*P,  2*P);
    ctx.fillStyle = '#000000';
    ctx.fillRect(bx+6*P,  by+6*P, 3*P,  2*P);  // nose
    ctx.fillStyle = '#606060';
    ctx.fillRect(bx+6*P,  by+6*P, P,    P);
    // fangs
    ctx.fillStyle = '#f0f0e8';
    ctx.fillRect(bx+4*P,  by+9*P, P,    2*P);
    ctx.fillRect(bx+7*P,  by+9*P, P,    2*P);

    // eyes (amber)
    ctx.fillStyle = '#d8900c';
    ctx.fillRect(bx+8*P,  by+3*P, 3*P,  3*P);
    ctx.fillRect(bx+12*P, by+3*P, 3*P,  3*P);
    ctx.fillStyle = '#000000';
    ctx.fillRect(bx+9*P,  by+4*P, P,    P);
    ctx.fillRect(bx+13*P, by+4*P, P,    P);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx+9*P,  by+3*P, P,    P);
    ctx.fillRect(bx+13*P, by+3*P, P,    P);

    if (this._state === 'hit') this._flashWhite(ctx, bx, by, 22*P, 26*P);
    this._flashRed(ctx, bx, by, 22*P, 26*P);
    this._drawParticles(ctx);
  }
}

// ─── SnakeFoe (serpent-type, Division '÷') ────────────────────────────────────
export class SnakeFoe extends Fiend {
  constructor(x, y, hp = 1, palette) {
    super(x, y, { hp, palette: palette ?? { body:'#40a840', dark:'#205428', hi:'#70d870' } });
  }

  draw(ctx) {
    if (this._drawClassSprite(ctx)) return;
    const sway    = ~~(Math.sin(this._tick * 0.15) * 2 * P);
    const tongueOut = this._tick % 6 < 3;
    const attX    = (this._state === 'attack') ? -this._frame * 2 * P : 0;
    const bx = ~~(this.x - 8*P) + attX;
    const by = ~~(this.y - 28*P);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(bx+2*P, by+27*P, 12*P, 2*P);
    if (this.isElite) this._drawEliteAura(ctx, bx, by + 4*P, 16*P, 24*P);

    // bottom coil
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+P,   by+22*P, 14*P, 6*P);
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+2*P, by+22*P, 12*P, 5*P);
    ctx.fillRect(bx+3*P, by+21*P, 10*P, 2*P);
    ctx.fillStyle = this._pal.dark;
    for (let i = 0; i < 4; i++) ctx.fillRect(bx+2*P+i*3*P, by+23*P, 2*P, P);

    // mid coil
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+P,    by+16*P, 6*P, 7*P);
    ctx.fillRect(bx+9*P,  by+16*P, 6*P, 7*P);
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+2*P,  by+16*P, 4*P, 6*P);
    ctx.fillRect(bx+10*P, by+16*P, 4*P, 6*P);
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+2*P,  by+17*P, 2*P, P);
    ctx.fillRect(bx+10*P, by+17*P, 2*P, P);
    ctx.fillRect(bx+2*P,  by+19*P, 2*P, P);
    ctx.fillRect(bx+10*P, by+19*P, 2*P, P);

    // rearing neck
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+5*P+sway, by+10*P, 6*P, 8*P);
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+6*P+sway, by+10*P, 4*P, 7*P);
    ctx.fillStyle = '#a8e890';
    ctx.fillRect(bx+7*P+sway, by+11*P, 2*P, 5*P);  // belly strip
    ctx.fillStyle = this._pal.dark;
    for (let i = 0; i < 3; i++) ctx.fillRect(bx+6*P+sway, by+11*P+i*2*P, P, P);

    // head (hood flared)
    ctx.fillStyle = this._pal.dark;
    ctx.fillRect(bx+2*P+sway, by+4*P, 12*P, 7*P);
    ctx.fillStyle = this._pal.body;
    ctx.fillRect(bx+3*P+sway, by+4*P, 10*P, 6*P);
    ctx.fillStyle = this._pal.hi;
    ctx.fillRect(bx+3*P+sway, by+4*P, 2*P,  5*P);
    ctx.fillRect(bx+11*P+sway, by+4*P, 2*P, 5*P);
    // face
    ctx.fillStyle = '#508050';
    ctx.fillRect(bx+5*P+sway, by+5*P, 6*P, 4*P);
    // slit eyes (red)
    ctx.fillStyle = '#f03030';
    ctx.fillRect(bx+4*P+sway,  by+6*P, 2*P, 2*P);
    ctx.fillRect(bx+10*P+sway, by+6*P, 2*P, 2*P);
    ctx.fillStyle = '#000000';
    ctx.fillRect(bx+5*P+sway,  by+6*P, P,   2*P);
    ctx.fillRect(bx+11*P+sway, by+6*P, P,   2*P);
    // tongue (flicks in/out)
    if (tongueOut) {
      ctx.fillStyle = '#e82040';
      ctx.fillRect(bx+6*P+sway,  by+9*P, 4*P, P);
      ctx.fillRect(bx+5*P+sway,  by+10*P, P,  P);
      ctx.fillRect(bx+10*P+sway, by+10*P, P,  P);
    }

    if (this._state === 'hit') this._flashWhite(ctx, bx, by+4*P, 16*P, 24*P);
    this._flashRed(ctx, bx, by+4*P, 16*P, 24*P);
    this._drawParticles(ctx);
  }
}

// ─── SpellProjectile (shared base for hero-launched bolt/fireball fx) ─────────
// Both the fireball and lightning strike are the same uploaded fireball sprite
// launched from just right of the hero toward the fiend; lightning reuses the
// art hue-shifted into blue with extra speed-trail streaks so it still reads
// as "electric" rather than "fire". The tint is pre-baked once (per hue
// value) into an offscreen canvas via pixel-level matrix math rather than a
// live `ctx.filter`, so it renders identically everywhere `ctx.filter` isn't
// reliably supported/applied (older WebViews, some mobile browsers) instead
// of silently falling back to the plain (un-shifted) fireball art.
const SPELL_SPRITE_DRAW_W = 14 * P;

// Cache of hue-rotated (+ saturated/brightened) offscreen canvases, keyed by
// hueRotateDeg, built lazily the first time each hue is requested after the
// source sprite has finished loading.
const _tintedSpriteCache = new Map();

// Standard hue-rotate matrix (same coefficients browsers use for the CSS
// `hue-rotate()` filter / SVG feColorMatrix type="hueRotate"), composed with
// a saturate(1.6) + brightness(1.15) pass so the tint reads as vivid electric
// blue rather than a washed-out grey-blue.
function _hueRotateMatrix(deg) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const hue = [
    [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
    [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283],
    [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
  ];
  const sat = 1.6;
  const satM = [
    [0.213 + 0.787 * sat, 0.715 - 0.715 * sat, 0.072 - 0.072 * sat],
    [0.213 - 0.213 * sat, 0.715 + 0.285 * sat, 0.072 - 0.072 * sat],
    [0.213 - 0.213 * sat, 0.715 - 0.715 * sat, 0.072 + 0.928 * sat],
  ];
  const brightness = 1.15;
  // Compose satM * hue, then scale the result by brightness.
  const m = [];
  for (let row = 0; row < 3; row++) {
    m.push([]);
    for (let col = 0; col < 3; col++) {
      let v = 0;
      for (let k = 0; k < 3; k++) v += satM[row][k] * hue[k][col];
      m[row].push(v * brightness);
    }
  }
  return m;
}

function _getTintedSprite(hueRotateDeg) {
  if (!hueRotateDeg) return _fireballSprite;
  if (!_fireballSprite.complete || !_fireballSprite.naturalWidth) return null;
  const cached = _tintedSpriteCache.get(hueRotateDeg);
  if (cached) return cached;

  const w = _fireballSprite.naturalWidth, h = _fireballSprite.naturalHeight;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  octx.drawImage(_fireballSprite, 0, 0, w, h);

  const imgData = octx.getImageData(0, 0, w, h);
  const px = imgData.data;
  const m = _hueRotateMatrix(hueRotateDeg);
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    px[i]     = Math.max(0, Math.min(255, m[0][0] * r + m[0][1] * g + m[0][2] * b));
    px[i + 1] = Math.max(0, Math.min(255, m[1][0] * r + m[1][1] * g + m[1][2] * b));
    px[i + 2] = Math.max(0, Math.min(255, m[2][0] * r + m[2][1] * g + m[2][2] * b));
  }
  octx.putImageData(imgData, 0, 0);
  _tintedSpriteCache.set(hueRotateDeg, off);
  return off;
}

// Slab test for a line segment against an axis-aligned box. Returns true when
// any part of the segment (including both endpoints) touches the box, so a
// projectile that jumps from one side to the other within a single large frame
// step still registers the hit instead of tunnelling through.
function _segmentIntersectsBox(x0, y0, x1, y1, box) {
  const dx = x1 - x0, dy = y1 - y0;
  let tMin = 0, tMax = 1;
  for (const [origin, delta, low, high] of [
    [x0, dx, box.left, box.right],
    [y0, dy, box.top, box.bottom],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < low || origin > high) return false;
      continue;
    }
    let t1 = (low - origin) / delta;
    let t2 = (high - origin) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}

// Smallest box covering both inputs. Fiends update before projectiles each
// frame, so the union of the previous and current bounds covers everything the
// fiend swept through since the last projectile step — a fast fiend cannot
// cross the projectile without registering.
function _unionBoxes(a, b) {
  return {
    left: Math.min(a.left, b.left),
    right: Math.max(a.right, b.right),
    top: Math.min(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

class SpellProjectile {
  constructor(startX, startY, targetX, targetY,
    { life, hueRotateDeg = 0, trailColor, streaks = 2, spriteScale = 1, target = null, onHit = null }) {
    this.startX = startX;
    this.startY = startY;
    this.targetX = targetX;
    this.targetY = targetY;
    this._life    = life;
    this._maxLife = life;
    this._hue     = hueRotateDeg;
    this._trailColor = trailColor;
    this._streaks = streaks;
    this._scale   = spriteScale;
    // When a live target is supplied (app build), collision decides the hit.
    // Without one (web build) the caller keeps its timer-driven resolution.
    this.target   = target;
    this.onHit    = onHit;
    this._hit     = false;
    this._lastTargetBounds = target?.getHitBounds?.() ?? null;
    // Fixed heading computed once at launch so the projectile travels in a
    // straight line directly at the fiend's position, rather than curving.
    this._angle = Math.atan2(targetY - startY, targetX - startX);
  }

  get isDone() { return this._life <= 0; }

  update(dt) {
    if (this._hit) return;
    const from = this._posAt(1 - this._life / this._maxLife);
    this._life -= dt;
    if (!this.target) return;

    const target = this.target;
    // A target that died or left the fight before the projectile arrived ends
    // it silently: no damage, no hit sound, no reaction.
    if (target.isDead || target.state === 'death' || target.state === 'retreat' || target.removed) {
      this._life = 0;
      this.target = null;
      return;
    }

    const to = this._posAt(1 - this._life / this._maxLife);
    const current = target.getHitBounds?.();
    if (!current) return;
    const bounds = this._lastTargetBounds ? _unionBoxes(this._lastTargetBounds, current) : current;
    this._lastTargetBounds = current;
    if (!_segmentIntersectsBox(from.x, from.y, to.x, to.y, bounds)) return;

    // Resolve at most once, then stop drawing and drop the target reference so
    // no later frame (or callback) can apply a second hit.
    this._hit = true;
    this._life = 0;
    this.hitX = to.x;
    this.hitY = to.y;
    this.target = null;
    this.onHit?.();
  }

  _posAt(t) {
    const ct = Math.max(0, Math.min(1, t));
    return {
      x: this.startX + (this.targetX - this.startX) * ct,
      y: this.startY + (this.targetY - this.startY) * ct,
    };
  }

  _drawSprite(ctx, x, y, alpha) {
    if (alpha <= 0) return;
    const sprite = _getTintedSprite(this._hue);
    if (!sprite || !sprite.width) return;
    const sw = sprite.width, sh = sprite.height;
    const drawW = SPELL_SPRITE_DRAW_W * this._scale, drawH = drawW * (sh / sw);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(this._angle);
    ctx.drawImage(sprite, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }

  draw(ctx) {
    if (this.isDone) return;
    const t = 1 - (this._life / this._maxLife);
    const alpha = Math.max(0, Math.min(1, this._life / (this._maxLife * 0.3)));
    const { x, y } = this._posAt(t);

    // The same additive glow the hero's palm carries while casting, so the
    // fireball and the bolt look like that light leaving his hand.
    _radialGlow(ctx, x, y, SPELL_SPRITE_DRAW_W * this._scale * 0.72, alpha * 0.7,
      '#ffffff', this._trailColor);

    ctx.save();

    // Speed-trail streaks: thin tapered blocks stretched back along the
    // flight path, fading out with distance from the projectile.
    for (let i = 0; i < this._streaks; i++) {
      const backT = t - 0.05 - i * 0.03;
      if (backT <= 0) continue;
      const { x: sx, y: sy } = this._posAt(backT);
      const streakAlpha = alpha * (0.4 - i * 0.12);
      if (streakAlpha <= 0) continue;
      const segLen = (10 + i * 6) * P * this._scale;
      ctx.save();
      ctx.globalAlpha = streakAlpha;
      ctx.fillStyle = this._trailColor;
      ctx.translate(sx, sy);
      ctx.rotate(this._angle);
      ctx.fillRect(-segLen, -P * this._scale, segLen, 2 * P * this._scale);
      ctx.restore();
    }

    // Ghost after-images of the sprite, fading toward the tail.
    for (let i = 3; i >= 1; i--) {
      const ghostT = t - i * 0.045;
      if (ghostT <= 0) continue;
      const { x: gx, y: gy } = this._posAt(ghostT);
      this._drawSprite(ctx, gx, gy, alpha * (0.5 - i * 0.12));
    }

    // The projectile itself, drawn last so it sits on top of its own trail.
    this._drawSprite(ctx, x, y, alpha);

    ctx.restore();
  }
}

export class LightningBolt extends SpellProjectile {
  constructor(startX, startY, targetX, targetY, opts = {}) {
    super(startX, startY, targetX, targetY, {
      life: 0.35,
      hueRotateDeg: 190,
      trailColor: '#8fd8ff',
      streaks: 3,
      spriteScale: 4,
      ...opts,
    });
  }
}

export class Fireball extends SpellProjectile {
  constructor(startX, startY, targetX, targetY, opts = {}) {
    super(startX, startY, targetX, targetY, {
      life: 1.35, // 1/3rd the travel speed of a plain projectile (3x the flight time)
      hueRotateDeg: 0,
      trailColor: '#ffcf40',
      streaks: 2,
      spriteScale: 3,
      ...opts,
    });
  }
}

const DRAGON_SPRITE_W = 1536, DRAGON_SPRITE_H = 1024;
// 4x the original 260px draw width so the summon looms large enough to fill
// the whole canvas (see dragonX/dragonY below for how it's positioned).
const DRAGON_DRAW_W = 260 * 4;
const DRAGON_DRAW_H = DRAGON_DRAW_W * (DRAGON_SPRITE_H / DRAGON_SPRITE_W);
const DRAGON_BREATH_SLICES = 14;
const DRAGON_BREATH_MAX_HALF_H = 20 * P; // capped cone half-height at the leading edge

export class DragonSummon {
 constructor(canvasW, groundY) {
   this.canvasW = canvasW;
   this.groundY = groundY;
   this._life = 2.0;
   this._maxLife = 2.0;
   this._lastDt = 0;
   this._appearEnd = 0.3;
   this._breathEnd = 1.5;
   // Anchor the (now much larger) sprite so its right edge lines up with the
   // canvas's right edge and it's vertically centered - at DRAGON_DRAW_W/H's
   // size that means the box spills off all four sides of the canvas, so the
   // dragon fills the entire screen instead of sitting in a corner.
   this.dragonX = canvasW - DRAGON_DRAW_W;
   this.dragonY = (CANVAS_H - DRAGON_DRAW_H) / 2;
 }

 get isDone() { return this._life <= 0; }
 get elapsed() { return this._maxLife - this._life; }
 get breathJustCompleted() {
   const prevElapsed = this.elapsed - this._lastDt;
   return prevElapsed < this._breathEnd && this.elapsed >= this._breathEnd;
 }

 update(dt) {
   this._lastDt = dt;
   this._life -= dt;
 }

 draw(ctx) {
   if (this._life <= 0 || !_dragonSprite.complete || _dragonSprite.naturalWidth === 0) return;
   const e = this.elapsed;
   const w = DRAGON_DRAW_W, h = DRAGON_DRAW_H;
   const appearT = Math.min(1, e / this._appearEnd);
   const fadeT = e > this._breathEnd
     ? Math.max(0, this._life / (this._maxLife - this._breathEnd))
     : 1;

   ctx.save();
   ctx.globalAlpha = Math.min(appearT, fadeT);
   // The source dragon faces and breathes LEFT. Mirror it horizontally so it
   // faces and breathes RIGHT in-game, toward the fiends entering from the
   // right. Translating to the right edge of the box before scale(-1,1) maps
   // drawImage's local [0,w] back onto screen [dragonX, dragonX + w], so the
   // dragon occupies x in [20, 280], y in [40, 213] and its mouth ends up on
   // the RIGHT side of that box.
   ctx.translate(this.dragonX + w, this.dragonY);
   ctx.scale(-1, 1);
   ctx.drawImage(_dragonSprite, 0, 0, DRAGON_SPRITE_W, DRAGON_SPRITE_H, 0, 0, w, h);
   ctx.restore();

   const mouthX = this.dragonX + w * 0.88;
   const mouthY = this.dragonY + h * 0.5;

   if (e >= this._appearEnd && e <= this._breathEnd) {
     const breathT = (e - this._appearEnd) / (this._breathEnd - this._appearEnd);
     // Sweep RIGHTWARD from the mouth toward the far right edge of the canvas.
     const sweepEndX = mouthX + breathT * (this.canvasW - mouthX);
     const coneW = sweepEndX - mouthX;
     if (coneW > 0) {
       ctx.save();
       const slices = DRAGON_BREATH_SLICES;
       for (let i = 0; i < slices; i++) {
         const frac = i / (slices - 1);
         // Half-height grows from a narrow throat at the mouth to a capped
         // width at the leading edge - this is the tapered cone silhouette.
         const halfH = 2 * P + frac * (DRAGON_BREATH_MAX_HALF_H - 2 * P);
         const x0 = mouthX + (i / slices) * coneW;
         const x1 = mouthX + ((i + 1) / slices) * coneW;
         const sliceW = Math.ceil(x1 - x0) + 1;
         // The breath front reads brightest; the wake fades back toward the mouth.
         const edgeBoost = 0.35 + 0.65 * frac;

         // Three nested bands per slice fake a soft vertical falloff using flat
         // fills, so the cone has no hard top/bottom edge.
         ctx.fillStyle = '#bfe9ff';
         ctx.globalAlpha = 0.10 * edgeBoost;
         ctx.fillRect(x0, mouthY - halfH, sliceW, halfH * 2);

         ctx.fillStyle = '#ffffff';
         ctx.globalAlpha = 0.14 * edgeBoost;
         ctx.fillRect(x0, mouthY - halfH * 0.6, sliceW, halfH * 1.2);

         ctx.fillStyle = '#ffffff';
         ctx.globalAlpha = 0.18 * edgeBoost;
         ctx.fillRect(x0, mouthY - halfH * 0.28, sliceW, halfH * 0.56);

         // Deterministic (index-keyed, not random) ice-shard glints so frames
         // don't strobe.
         if (i % 3 === 2) {
           const shardX = x0 + sliceW * 0.5;
           const shardY = mouthY + (i % 2 === 0 ? 1 : -1) * halfH * 0.5;
           ctx.fillStyle = '#eaffff';
           ctx.globalAlpha = 0.5 * edgeBoost;
           ctx.fillRect(shardX, shardY - P, 2 * P, 2 * P);
         }
       }
       ctx.globalAlpha = 1;
       ctx.restore();
     }
   }
 }
}
