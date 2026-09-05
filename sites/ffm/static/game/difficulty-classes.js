// difficulty-classes.js - WS4: 36 fiend classes (art tier + score value), layered
// on top of the existing 60-level progression.
//
// Naming note: state.difficulty already means pacing (easy/medium/hard). This is a
// separate axis, referred to in code as "fiend class" to avoid a name collision.
//
// Mapping is fixed by design: class N (1-18) = grid position N (row-major) in
// fiend_sprites_1.png ("set1"); class N+18 (19-36) = the SAME grid position in
// fiend_sprites_2.png ("set2"). Score is assigned purely by class index - this is a
// positional ladder, not a curated one; sheet 2 (19-36) is always the higher band.

const CREATURE_NAMES = [
  'Imp with Trident',
  'Blue-Flame Skeleton Mage',
  'Moss Golem',
  'Beholder',
  'Baby Dragon',
  'Lava Golem',
  'Spider',
  'Skull-Slime',
  'Goblin Swordsman',
  'Wraith',
  'Minotaur',
  'Flying Imp',
  'Skeleton Warrior',
  'Kraken',
  'Orc Warlord',
  'Phoenix',
  'Ice Golem',
  'Reaper',
];

const SCORE_STEP = 50;

// Fraction of each fiend sprite's drawn height to shift the sprite DOWN by, so
// its true ground-contact point (not just its lowest opaque pixel) lands on
// the hero's feet line (GROUND_Y). These values were tuned by hand via the
// live visual calibration tool (calibrate.html), which renders the real
// Hero/Fiend classes against a ground-line reference so what's tuned there is
// pixel-identical to what the game renders.
const BOTTOM_PAD_RATIO = {
  1: [0.055, 0.05, 0.05, 0.03, 0.02, 0.03, 0.1, 0.095, 0.06, 0.17, 0.06, 0.15, 0.085, 0.08, 0.095, 0.08, 0.075, 0.07],
  2: [0.09, 0.08, 0.095, 0.075, 0.06, 0.08, 0.14, 0.11, 0.08, 0.14, 0.08, 0.15, 0.08, 0.08, 0.1, 0.055, 0.06, 0.08],
};

function buildFiendClasses() {
  const classes = [];
  for (let set = 1; set <= 2; set++) {
    for (let gridIndex = 1; gridIndex <= 18; gridIndex++) {
      const id = (set - 1) * 18 + gridIndex;
      classes.push({
        id,
        name: CREATURE_NAMES[gridIndex - 1],
        spriteSet: set,
        gridIndex,
        spritePath: `./fiend-sprites/set${set}-${String(gridIndex).padStart(2, '0')}.png`,
        scoreValue: SCORE_STEP * id,
        bottomPadRatio: BOTTOM_PAD_RATIO[set][gridIndex - 1],
      });
    }
  }
  return classes;
}

export const FIEND_CLASSES = buildFiendClasses();

export function getFiendClass(id) {
  return FIEND_CLASSES.find((c) => c.id === id) ?? FIEND_CLASSES[0];
}

// Fiend class (art tier, 1-36) is tied to the level being played (i.e. the
// difficulty of the problems being posed), the same way levels.js's
// sampleFiendType ties fiend "type" (procedural body shape) to level: a wave
// at level x draws its fiends' classes 50% from level x's class, 30% from
// level (x-1)'s class, and 20% from level (x-2)'s class, deterministically
// per (level, spawnIndex) — NOT from the coarse easy/medium/hard picker, and
// NOT re-randomized on every game start.
//
// Which class each level maps to is a plain per-level lookup table (rather
// than a fixed formula), hand-curated with the level-fiend allocator tool
// (level-fiend-allocator.html). _formulaClassIdForLevel below is kept only as
// a defensive fallback in classIdForLevel (e.g. a level outside 1-60, or a
// key accidentally missing from this table) — it is NOT used to seed this
// table anymore.
function _formulaClassIdForLevel(level) {
  const clamped = Math.max(1, Math.min(60, level));
  return Math.max(1, Math.min(36, Math.ceil((clamped / 60) * 36)));
}

export const LEVEL_FIEND_CLASS_ID = {
  1: 8,
  2: 26,
  3: 1,
  4: 19,
  5: 2,
  6: 20,
  7: 3,
  8: 21,
  9: 4,
  10: 22,
  11: 6,
  12: 24,
  13: 7,
  14: 25,
  15: 8,
  16: 26,
  17: 9,
  18: 27,
  19: 10,
  20: 28,
  21: 11,
  22: 29,
  23: 12,
  24: 30,
  25: 13,
  26: 31,
  27: 14,
  28: 32,
  29: 15,
  30: 33,
  31: 16,
  32: 34,
  33: 17,
  34: 35,
  35: 18,
  36: 36,
  37: 23,
  38: 23,
  39: 24,
  40: 24,
  41: 25,
  42: 26,
  43: 26,
  44: 27,
  45: 27,
  46: 28,
  47: 29,
  48: 29,
  49: 30,
  50: 30,
  51: 31,
  52: 32,
  53: 32,
  54: 33,
  55: 33,
  56: 34,
  57: 35,
  58: 35,
  59: 36,
  60: 36,
};

function classIdForLevel(level) {
  const clamped = Math.max(1, Math.min(60, level));
  return LEVEL_FIEND_CLASS_ID[clamped] ?? _formulaClassIdForLevel(clamped);
}

export function getFiendClassWeights(level) {
  const raw = [{ id: classIdForLevel(level), weight: 0.5 }];
  if (level - 1 >= 1) raw.push({ id: classIdForLevel(level - 1), weight: 0.3 });
  if (level - 2 >= 1) raw.push({ id: classIdForLevel(level - 2), weight: 0.2 });

  const total = raw.reduce((s, e) => s + e.weight, 0);
  const normalized = raw.map((e) => ({ id: e.id, weight: e.weight / total }));

  const merged = [];
  for (const e of normalized) {
    const existing = merged.find((m) => m.id === e.id);
    if (existing) existing.weight += e.weight;
    else merged.push({ id: e.id, weight: e.weight });
  }
  return merged;
}

// Small local LCG (mirrors the one in levels.js — kept private/duplicated here
// rather than imported, to keep this module's level->class-id logic
// self-contained and free of a levels.js dependency).
function lcg(seed) {
  let s = seed >>> 0;
  return {
    next() {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s;
    },
  };
}

export function sampleFiendClassId(level, spawnIndex) {
  const weights = getFiendClassWeights(level);
  // XOR with a distinct constant so this draw doesn't mirror levels.js's
  // sampleFiendType draw for the same (level, spawnIndex) pair.
  const seed = ((level * 100003) ^ (spawnIndex * 7919) ^ 0x9e3779b1) >>> 0;
  const rng = lcg(seed);
  const draw = rng.next() / 4294967296;

  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i].weight;
    if (draw < cumulative || i === weights.length - 1) return weights[i].id;
  }
  return weights[weights.length - 1].id;
}
