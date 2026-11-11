// screen-fx-effects.js — the Arithmo Slayer effect recipes.
//
// Every recipe receives the screen-fx api plus an optional payload and spawns
// particles, washes, vignettes and shakes through the public helpers only.
// Nothing here touches the DOM or throws on a missing payload field.

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
];

export const PALETTES = {
  gold: ['#ffe27a', '#ffd54a', '#fff6c8', '#ffb52e', '#fff0b0'],
  red: ['#ff3b2f', '#ff6a4d', '#ff2418', '#ff8a6b', '#ff1a1a'],
  blue: ['#cdeeff', '#7fd4ff', '#a8e6ff', '#8fd8ff', '#6a4bff'],
  ice: ['#cfefff', '#e8f9ff', '#aee8ff', '#ffffff', '#7fd4ff'],
  green: ['#d8ffcf', '#a5f3a0', '#7dff8a', '#b9f6ca', '#8fff8a'],
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
  const cx = x - 62;
  const cy = y + 22;
  api.arc(cx, cy, '#ffe8a0', 74, -2.35, 0.55, 0.22, 9, 0.55);
  api.arc(cx, cy, '#fff6d8', 66, -2.35, 0.55, 0.17, 5, 0.8);
  api.arc(cx, cy, '#ffffff', 58, -2.35, 0.55, 0.13, 2, 1);
  for (let i = 0; i < count(api, 14); i++) {
    const a = rand(-2.35, 0.55);
    const px = cx + Math.cos(a) * 74;
    const py = cy + Math.sin(a) * 74;
    api.spark(px, py, a + Math.PI / 2, rand(80, 240), pick(PALETTES.gold), rand(0.25, 0.5));
  }
  api.flash(x, y, '#fff4c0', 24, 0.11, 0.7);
  api.ring(x, y, '#fff0b0', 4, 44, 0.28, 2);
  api.shake(1.6, 0.09);
}

function fiendHurt(api, payload) {
  const x = payload && payload.x !== undefined ? payload.x : 520;
  const y = payload && payload.y !== undefined ? payload.y : 282;
  const palette = (payload && payload.palette) || PALETTES.green;
  api.flash(x, y, '#ffffff', 46, 0.11, 1);
  api.ring(x, y, '#d8ffcf', 6, 58, 0.3, 2);
  for (let i = 0; i < count(api, 12); i++) {
    const angle = rand(0, TAU);
    const speed = rand(40, 180);
    api.shard(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, pick(palette), rand(3, 6));
  }
  for (let i = 0; i < count(api, 8); i++) {
    api.smoke(x + rand(-14, 14), y + rand(-10, 10), rand(8, 16), rand(0.6, 1.2), '#aaaaaa');
  }
  for (let i = 0; i < count(api, 10); i++) {
    api.spark(x, y, rand(0, TAU), rand(50, 200), pick(PALETTES.gold), rand(0.3, 0.6));
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
  api.schedule(duration, () => fireImpact(api, { x: to.x, y: to.y }));
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
  api.schedule(duration, () => boltImpact(api, { x: to.x, y: to.y }));
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
    api.emitter(1.2, 60, () => {
      for (let i = 0; i < count(api, 3); i++) {
        api.streak(origin.x + rand(0, 50), origin.y + rand(-46, 46), rand(900, 1700), rand(-40, 40), pick(PALETTES.ice), rand(60, 170), rand(2, 5));
      }
      for (let i = 0; i < count(api, 3); i++) {
        api.mote(origin.x, origin.y + rand(-46, 46), rand(-60, 60), rand(-60, 20), pick(PALETTES.ice), rand(1.5, 3));
      }
      for (let i = 0; i < count(api, 2); i++) {
        api.shard(origin.x, origin.y + rand(-46, 46), rand(120, 500), rand(-60, 60), pick(PALETTES.ice), rand(2, 4));
      }
    });
    api.addWash('#cfefff', 0.08, 0.9);
    api.shake(2, 0.9);
  });
  api.schedule(1.2, () => {
    api.ring(origin.x, origin.y, '#cfefff', 20, 900, 0.8, 7);
    api.ring(origin.x, origin.y, '#7fd4ff', 10, 620, 0.6, 3);
    api.flash(origin.x, origin.y, '#ffffff', 60, 0.2, 0.55);
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
  };
}
