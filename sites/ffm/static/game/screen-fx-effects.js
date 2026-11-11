// screen-fx-effects.js — the Arithmo Slayer effect recipes.
//
// Every recipe receives the screen-fx api plus an optional payload and spawns
// particles, washes, vignettes and shakes through the public helpers only.
// Nothing here touches the DOM or throws on a missing payload field.

import { WORLD_HEIGHT } from './screen-fx.js';

const TAU = Math.PI * 2;
// The answer effects are anchored to the answer row on purpose: the burst is
// feedback for the button the player just hit, which lives below the 800x450
// playfield. Only thin strokes and small particles are placed down there — no
// filled shape may cover the answer text.
const DEFAULT_ORIGIN = { x: 400, y: 505 };

export const EFFECT_NAMES = [
  'correctAnswer',
  'wrongAnswer',
  'heroStrike',
  'fiendHurt',
  'heroHurt',
  'fireball',
  'lightning',
  'levelWon',
  'gameOver',
  'dragonFinisher',
  'heal',
  'healCharge',
  'swordGain',
];

// The sword's own ramp (#1460c0 / #40a0f0 / #88d0ff / #c8f0ff in
// entities.js _drawSwing), so melee effects match the animation that caused
// them instead of reading as a different colour.
const BLADE = ['#ffffff', '#c8f0ff', '#88d0ff', '#40a0f0', '#1460c0'];

export const PALETTES = {
  gold: ['#ffe27a', '#ffd54a', '#fff6c8', '#ffb52e', '#fff0b0'],
  red: ['#ff3b2f', '#ff6a4d', '#ff2418', '#ff8a6b', '#ff1a1a'],
  blue: ['#cdeeff', '#7fd4ff', '#a8e6ff', '#8fd8ff', '#6a4bff'],
  ice: ['#cfefff', '#e8f9ff', '#aee8ff', '#ffffff', '#7fd4ff'],
  green: ['#d8ffcf', '#a5f3a0', '#7dff8a', '#b9f6ca', '#8fff8a'],
  blade: BLADE,
  violet: ['#cbb4ff', '#a98bff', '#d9c8ff', '#8a6bff', '#e8dfff'],
};

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(list) {
  return list[(Math.random() * list.length) | 0];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Scale a recipe's particle count by the engine's countScale(). */
function count(api, n) {
  return Math.max(1, Math.round(n * api.countScale()));
}

function originOf(payload) {
  return (payload && payload.origin) || DEFAULT_ORIGIN;
}

function correctAnswer(api, payload) {
  const origin = originOf(payload);
  api.ring(origin.x, origin.y, '#ffe27a', 6, 110, 0.55, 2.5);
  api.ring(origin.x, origin.y, '#fff6c8', 3, 62, 0.38, 1.5);
  for (let i = 0; i < count(api, 14); i++) {
    const angle = -Math.PI / 2 + rand(-1.15, 1.15);
    api.spark(origin.x, origin.y, angle, rand(70, 230), pick(PALETTES.gold), rand(0.4, 0.85));
  }
  for (let i = 0; i < count(api, 8); i++) {
    api.ember(origin.x, origin.y, rand(-30, 30), rand(-180, -80), pick(PALETTES.gold), rand(0.5, 0.9));
  }
  api.addWash('#ffcf6a', 0.07, 0.32);
}

function wrongAnswer(api, payload) {
  const origin = originOf(payload);
  for (let i = 0; i < count(api, 12); i++) {
    const angle = rand(0, TAU);
    const speed = rand(60, 220);
    api.shard(origin.x, origin.y, Math.cos(angle) * speed, Math.sin(angle) * speed + rand(60, 160), pick(PALETTES.red), rand(3, 6));
  }
  for (let i = 0; i < count(api, 10); i++) {
    api.spark(origin.x, origin.y, rand(0, TAU), rand(50, 200), pick(PALETTES.red), rand(0.3, 0.7));
  }
  api.addWash('#ff2418', 0.11, 0.13);
  api.addVignette('#ff1a1a', 0, 0.45, 0.48);
  api.shake(3, 0.15);
}

function heroStrike(api, payload) {
  const x = payload && payload.x !== undefined ? payload.x : 400;
  const y = payload && payload.y !== undefined ? payload.y : 282;
  // Centred on the impact itself: centring on the hero's shoulder and sweeping
  // upwards drew the crescent over the fiend's head instead of across it.
  const cx = x;
  const cy = y;
  api.arc(cx, cy, '#40a0f0', 46, -2.3, 1.0, 0.24, 10, 0.6);
  api.arc(cx, cy, '#88d0ff', 40, -2.3, 1.0, 0.19, 6, 0.85);
  api.arc(cx, cy, '#eafaff', 34, -2.3, 1.0, 0.14, 3, 1);
  for (let i = 0; i < count(api, 18); i++) {
    const a = rand(-2.3, 1.0);
    const px = cx + Math.cos(a) * 40;
    const py = cy + Math.sin(a) * 40;
    api.spark(px, py, a + Math.PI / 2, rand(90, 260), pick(BLADE), rand(0.28, 0.55));
  }
  api.flash(x, y, '#c8f0ff', 34, 0.12, 0.8);
  api.ring(x, y, '#88d0ff', 5, 64, 0.3, 3);
  api.shake(1.8, 0.09);
}

function fiendHurt(api, payload) {
  const x = payload && payload.x !== undefined ? payload.x : 520;
  const y = payload && payload.y !== undefined ? payload.y : 282;
  const palette = (payload && payload.palette) || BLADE;
  api.flash(x, y, '#eafaff', 52, 0.11, 1);
  api.ring(x, y, '#c8f0ff', 6, 66, 0.3, 2);
  for (let i = 0; i < count(api, 12); i++) {
    const angle = rand(0, TAU);
    const speed = rand(40, 180);
    api.shard(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, pick(palette), rand(3, 6));
  }
  for (let i = 0; i < count(api, 8); i++) {
    api.smoke(x + rand(-14, 14), y + rand(-10, 10), rand(8, 16), rand(0.6, 1.2), '#aaaaaa');
  }
  for (let i = 0; i < count(api, 10); i++) {
    api.spark(x, y, rand(0, TAU), rand(50, 200), pick(BLADE), rand(0.3, 0.6));
  }
  api.shake(1.4, 0.08);
}

function heroHurt(api, payload) {
  const x = payload && payload.x !== undefined ? payload.x : 110;
  const y = payload && payload.y !== undefined ? payload.y : 282;
  api.flash(x, y, '#ff3b2f', 52, 0.17, 0.95);
  for (let i = 0; i < count(api, 12); i++) {
    const angle = rand(0, TAU);
    const speed = rand(60, 220);
    api.shard(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, pick(PALETTES.red), rand(3, 6));
  }
  for (let i = 0; i < count(api, 12); i++) {
    api.spark(x, y, rand(0, TAU), rand(50, 200), pick(PALETTES.red), rand(0.3, 0.7));
  }
  api.addVignette('#c01018', 0.05, 0.6, 0.56);
  api.addWash('#ff2a1e', 0.08, 0.14);
  api.shake(4, 0.19);
}

function fireTrail(api, payload) {
  const x = payload && payload.x !== undefined ? payload.x : 206;
  const y = payload && payload.y !== undefined ? payload.y : 262;
  api.ember(x, y, rand(-20, 20), rand(-40, 10), pick(PALETTES.gold), rand(0.2, 0.45));
  api.ember(x, y, rand(-20, 20), rand(-40, 10), pick(PALETTES.gold), rand(0.2, 0.45));
  if (Math.random() < 0.35) api.smoke(x, y, rand(4, 8), rand(0.25, 0.5), '#666666');
}

function fireImpact(api, payload) {
  const x = payload && payload.x !== undefined ? payload.x : 512;
  const y = payload && payload.y !== undefined ? payload.y : 274;
  api.flash(x, y, '#ffffff', 48, 0.12, 0.8);
  api.flash(x, y, '#ff8a1e', 92, 0.3, 0.5);
  api.ring(x, y, '#ffd54a', 8, 150, 0.46, 4);
  api.ring(x, y, '#ffffff', 4, 74, 0.3, 2);
  for (let i = 0; i < count(api, 22); i++) {
    const angle = rand(0, TAU);
    const speed = rand(60, 260);
    api.ember(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, pick(PALETTES.gold), rand(0.3, 0.8));
  }
  for (let i = 0; i < count(api, 8); i++) {
    api.smoke(x + rand(-12, 12), y + rand(-12, 12), rand(8, 16), rand(0.5, 1), '#aaaaaa');
  }
  for (let i = 0; i < count(api, 7); i++) {
    api.spark(x, y, rand(0, TAU), rand(60, 240), pick(PALETTES.gold), rand(0.25, 0.5));
  }
  api.shake(3, 0.16);
  api.addWash('#ff9a3c', 0.10, 0.26);
}

function fireball(api, payload) {
  const from = (payload && payload.from) || { x: 206, y: 262 };
  const to = (payload && payload.to) || { x: 512, y: 274 };
  const duration = payload && payload.duration !== undefined ? payload.duration : 0.62;
  fireTrail(api, { x: from.x, y: from.y });
  api.emitter(duration, 55, (progress) => {
    const x = lerp(from.x, to.x, progress);
    const y = lerp(from.y, to.y, progress);
    for (let i = 0; i < count(api, 2); i++) {
      api.ember(x, y, rand(-30, 30), rand(-30, 30), pick(PALETTES.gold), rand(0.2, 0.5));
    }
    if (Math.random() < 0.35 * api.countScale()) api.smoke(x, y, rand(4, 9), rand(0.3, 0.7), '#555555');
  });
  // The game drives the blast from the real collision (resolveFireballHit), so
  // it asks for the trail only and plays fireImpact itself.
  if (!payload || payload.impact !== false) {
    api.schedule(duration, () => fireImpact(api, { x: to.x, y: to.y }));
  }
}

function boltTrail(api, payload) {
  const x = payload && payload.x !== undefined ? payload.x : 206;
  const y = payload && payload.y !== undefined ? payload.y : 262;
  api.flash(x, y, '#cdeeff', 26, 0.08, 0.5);
  api.spark(x, y, rand(0, TAU), rand(40, 160), '#cdeeff', rand(0.15, 0.35));
  api.spark(x, y, rand(0, TAU), rand(40, 160), '#7fd4ff', rand(0.15, 0.35));
}

function boltImpact(api, payload) {
  const x = payload && payload.x !== undefined ? payload.x : 512;
  const y = payload && payload.y !== undefined ? payload.y : 270;
  api.flash(x, y, '#ffffff', 44, 0.11, 0.85);
  api.flash(x, y, '#7fd4ff', 88, 0.28, 0.45);
  api.ring(x, y, '#a8e6ff', 6, 132, 0.42, 3);
  const rayCount = count(api, 8);
  for (let i = 0; i < rayCount; i++) {
    api.ray(x, y, (i / rayCount) * TAU, rand(90, 200), '#a8e6ff', 0.8);
  }
  for (let i = 0; i < count(api, 18); i++) {
    api.spark(x, y, rand(0, TAU), rand(50, 220), pick(PALETTES.blue), rand(0.15, 0.4));
  }
  for (let i = 0; i < count(api, 4); i++) {
    api.ring(x, y, '#7fd4ff', 4, rand(20, 50), rand(0.2, 0.4), 2);
  }
  api.shake(3, 0.14);
  api.addWash('#8fd8ff', 0.09, 0.09);
  api.addVignette('#6a4bff', 0.04, 0.34, 0.42);
}

function lightning(api, payload) {
  const from = (payload && payload.from) || { x: 206, y: 262 };
  const to = (payload && payload.to) || { x: 512, y: 270 };
  const duration = payload && payload.duration !== undefined ? payload.duration : 0.46;
  let tick = 0;
  api.emitter(duration, 60, (progress) => {
    const x = lerp(from.x, to.x, progress);
    const y = lerp(from.y, to.y, progress);
    // The head glow is throttled: at the tick rate it would read as a strobe.
    if (tick++ % 4 === 0) api.flash(x, y, '#cdeeff', 26, 0.08, 0.5);
    api.spark(x, y, rand(0, TAU), rand(40, 160), '#cdeeff', rand(0.15, 0.35));
    api.spark(x, y, rand(0, TAU), rand(40, 160), '#7fd4ff', rand(0.15, 0.35));
  });
  if (!payload || payload.impact !== false) {
    api.schedule(duration, () => boltImpact(api, { x: to.x, y: to.y }));
  }
}

// Small, growing charge cue that tracks the hero while the hold-to-heal
// accumulates. Deliberately quiet: it must not compete with a strike that may
// be happening at the same moment.
function healCharge(api, payload) {
  const x = payload && payload.x !== undefined ? payload.x : 110;
  const y = payload && payload.y !== undefined ? payload.y : 282;
  const raw = payload && payload.progress !== undefined ? payload.progress : 0.5;
  const p = Math.max(0, Math.min(1, raw));
  const radius = 18 + 46 * p;
  const motes = Math.max(1, Math.round(count(api, 2 + 4 * p)));
  for (let i = 0; i < motes; i++) {
    const angle = rand(0, TAU);
    const r = rand(0.55, 1) * radius;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r * 0.55;
    api.mote(px, py, (x - px) * 1.6, (y - py) * 1.6 - 12, pick(PALETTES.green), rand(1.2, 1.8 + 1.4 * p));
  }
  api.ring(x, y, '#b6f08a', 4, 10 + 30 * p, 0.3, 1 + p);
}

function heal(api, payload) {
  const x = payload && payload.x !== undefined ? payload.x : 110;
  const y = payload && payload.y !== undefined ? payload.y : 282;
  // A column of light from above the viewport down onto the hero. Three beams
  // of different widths give it texture; embers and motes keep it moving.
  // Start above the viewport, not above the playfield: converting CSS y=0 into
  // world space lets the column run from the very top of the screen down to the
  // hero, crossing the HUD and the question row on the way.
  const map = api.mapping ? api.mapping() : null;
  const top = map && map.scale ? (-map.offsetY / map.scale) - 60 : -200;
  const span = y - top + 40;
  api.beam(x, top, 100, span, '#7cf08a', 1.05, 1);
  api.beam(x - 26, top, 30, span, '#eaffe0', 0.9, 0.8);
  api.beam(x + 20, top, 18, span, '#b6f08a', 0.95, 0.65);
  api.beam(x, top, 10, span, '#ffffff', 0.8, 0.55);
  api.flash(x, y - 6, '#b6f08a', 52, 0.34, 0.85);
  api.ring(x, y, '#b6f08a', 8, 120, 0.65, 4);
  for (let i = 0; i < count(api, 18); i++) {
    api.mote(x + rand(-44, 44), rand(top + 60, y), rand(-10, 10), rand(30, 90), pick(PALETTES.green), rand(1.8, 3.6));
  }
  for (let i = 0; i < count(api, 10); i++) {
    api.ember(x + rand(-26, 26), rand(y - 80, y), rand(-10, 10), rand(-70, -20), pick(PALETTES.green), rand(0.5, 1.1));
  }
  api.addVignette('#2f8f2a', 0, 0.22, 0.6);
  api.shake(3.5, 0.3);
}

function swordGain(api, payload) {
  const x = payload && payload.x !== undefined ? payload.x : 400;
  const y = payload && payload.y !== undefined ? payload.y : 500;
  api.flash(x, y, '#ffffff', 26, 0.14, 0.85);
  api.ring(x, y, '#eafaff', 3, 46, 0.38, 2);
  for (let i = 0; i < count(api, 10); i++) {
    api.spark(x, y, rand(0, TAU), rand(60, 200), pick(BLADE), rand(0.25, 0.5));
  }
  for (let i = 0; i < count(api, 3); i++) {
    api.ray(x, y, rand(0, TAU), rand(28, 60), '#eafaff', 0.5);
  }
}

function levelWon(api) {
  const firework = (x, y, colors) => {
    api.flash(x, y, '#ffffff', 30, 0.25, 0.8);
    api.ring(x, y, pick(colors), 6, 90, 0.5, 2);
    for (let i = 0; i < count(api, 20); i++) {
      api.spark(x, y, rand(0, TAU), rand(60, 260), pick(colors), rand(0.4, 0.9));
    }
  };
  api.schedule(0.06, () => firework(250, 130, PALETTES.gold));
  api.schedule(0.32, () => firework(610, 100, ['#ffffff', '#fff6c8', '#ffe27a']));
  api.schedule(0.56, () => firework(420, 190, PALETTES.green));
  api.schedule(0.12, () => {
    const confettiColors = PALETTES.gold.concat(PALETTES.green, ['#ffffff']);
    for (let i = 0; i < count(api, 50); i++) {
      api.confetti(rand(-380, 1180), rand(-220, -10), 0, rand(40, 120), pick(confettiColors), rand(3, 7));
    }
  });
  const rayCount = count(api, 14);
  for (let i = 0; i < rayCount; i++) {
    api.ray(400, 210, (i / rayCount) * TAU, rand(150, 330), '#fff3c4', 0.10);
  }
  api.ring(400, 210, '#fff3c4', 20, 460, 0.9, 1.5);
  api.addWash('#ffd77a', 0.05, 0.8);
}

function gameOver(api) {
  const greys = ['#3a3a3a', '#555555', '#777777', '#999999', '#bbbbbb'];
  for (let i = 0; i < count(api, 45); i++) {
    api.mote(rand(-420, 1220), rand(-340, -20), rand(-15, 15), rand(26, 70), pick(greys), rand(2, 4));
  }
  for (let i = 0; i < count(api, 10); i++) {
    api.ember(rand(-100, 900), rand(-200, -20), rand(-10, 10), rand(-30, -10), '#c0402a', rand(0.6, 1.2));
  }
  api.addVignette('#7a0d12', 0, 0.72, 1.4);
  api.schedule(0.2, () => api.addWash('#3a0a10', 0.10, 0.7));
  api.schedule(0.9, () => api.addVignette('#000000', 0.2, 0.45, 1.6));
}

function dragonFinisher(api, payload) {
  const origin = (payload && payload.origin) || { x: 206, y: 262 };
  api.schedule(0, () => {
    for (let i = 0; i < count(api, 20); i++) {
      const angle = rand(0, TAU);
      const radius = rand(120, 380);
      const px = origin.x + Math.cos(angle) * radius;
      const py = origin.y + Math.sin(angle) * radius;
      const dx = origin.x - px;
      const dy = origin.y - py;
      const distance = Math.hypot(dx, dy) || 1;
      const speed = radius * rand(2, 4);
      api.mote(px, py, (dx / distance) * speed, (dy / distance) * speed, pick(PALETTES.ice), rand(1.5, 3));
    }
  });
  api.schedule(0.3, () => {
    // Widen into a cone and push its front across the playfield, so the breath
    // fills the arena instead of reading as a short burst at the mouth.
    api.emitter(1.2, 60, (progress) => {
      const spread = 70 + 210 * progress;
      const front = origin.x + 560 * progress;
      const inField = (y) => Math.max(8, Math.min(WORLD_HEIGHT - 8, y));
      for (let i = 0; i < count(api, 6); i++) {
        api.streak(rand(origin.x, front), inField(origin.y + rand(-spread, spread)), rand(1300, 2300), rand(-80, 80), pick(PALETTES.ice), rand(120, 340), rand(3, 8));
      }
      for (let i = 0; i < count(api, 5); i++) {
        api.mote(rand(origin.x, front + 120), inField(origin.y + rand(-spread, spread)), rand(-60, 120), rand(-80, 40), pick(PALETTES.ice), rand(1.8, 3.6));
      }
      for (let i = 0; i < count(api, 3); i++) {
        api.shard(rand(origin.x, front), inField(origin.y + rand(-spread, spread)), rand(200, 700), rand(-100, 100), pick(PALETTES.ice), rand(2, 5));
      }
    });
    api.addWash('#cfefff', 0.08, 0.9);
    api.shake(4, 0.85);
  });
  api.schedule(1.2, () => {
    api.ring(origin.x, origin.y, '#cfefff', 20, 900, 0.8, 7);
    api.ring(origin.x, origin.y, '#7fd4ff', 10, 620, 0.6, 3);
    api.flash(origin.x, origin.y, '#ffffff', 60, 0.2, 0.55);
    api.shake(8, 0.45);
    for (let i = 0; i < count(api, 16); i++) {
      api.spark(origin.x, origin.y, rand(0, TAU), rand(60, 280), pick(PALETTES.ice), rand(0.3, 0.7));
    }
  });
  api.schedule(1.5, () => {
    api.addVignette('#7fd4ff', 0.05, 0.4, 1.1);
    for (let i = 0; i < count(api, 20); i++) {
      api.mote(origin.x + rand(-300, 300), origin.y + rand(-200, 100), rand(-30, 30), rand(-20, 10), pick(PALETTES.ice), rand(1.5, 3));
    }
  });
}

export function createEffectTable() {
  return {
    correctAnswer,
    wrongAnswer,
    heroStrike,
    fiendHurt,
    heroHurt,
    fireball,
    lightning,
    levelWon,
    gameOver,
    dragonFinisher,
    heal,
    healCharge,
    swordGain,
    // Granular pieces: the game drives these per frame / per hit so the trail
    // and the blast stay locked to the real projectile rather than a guess.
    fireTrail,
    fireImpact,
    boltTrail,
    boltImpact,
  };
}
