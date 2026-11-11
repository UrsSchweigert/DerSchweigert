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
// the hero's feet line (GROUND_Y). Tuned by hand via the live visual
// calibration tool (calibrate.html), which renders the real Hero/Fiend classes
// against a ground-line reference so what is tuned there is pixel-identical to
// what the game renders.
//
// One entry per class, in id order: 18 young (set 1), 18 old (set 2), 18
// ancient (set 3), then the six dragon variants (ids 55-60). The ancient set
// starts from the old set's values because those sprites were fitted to the
// same heights, and the dragon variants start from their stage's dragon - all
// of it needs a calibration pass after any sprite art changes.
const BOTTOM_PAD_RATIO = [
  // young (set 1)
  0.04, 0.035, 0.045, 0.0, 0.02, 0.03, 0.1, 0.095, 0.06, 0.0, 0.06, 0.05, 0.045, 0.02, 0.055, 0.0, 0.015, 0.01,
  // old (set 2)
  0.05, 0.04, 0.035, 0.015, 0.06, 0.02, 0.06, 0.05, 0.02, 0.0, 0.04, 0.11, 0.0, 0.06, 0.06, 0.015, 0.04, 0.04,
  // ancient (set 3)
  0.05, 0.04, 0.035, 0.035, 0.04, 0.04, 0.08, 0.09, 0.06, 0.08, 0.04, 0.15, 0.08, 0.08, 0.04, 0.055, 0.02, 0.04,
  // dragon variants: young, young, old, old, ancient, ancient
  0.02, 0.02, 0.06, 0.06, 0.06, 0.06,
];

// Three art stages per creature: the same grid position in sprite sets 1-3.
const STAGES = [
  { set: 1, stage: 'young' },
  { set: 2, stage: 'old' },
  { set: 3, stage: 'ancient' },
];

// Levels 55-60 get the dragon line: three stages, each in two colour shifts.
// dragon-1/3/5 rotate the blue dragon to a molten red, dragon-2/4/6 to a
// verdant green, so the names follow the sprite rather than the download order.
const DRAGON_VARIANTS = [
  { name: 'Young Dragon (Ember)', sprite: 'dragon-1' },
  { name: 'Young Dragon (Verdant)', sprite: 'dragon-2' },
  { name: 'Old Dragon (Ember)', sprite: 'dragon-3' },
  { name: 'Old Dragon (Verdant)', sprite: 'dragon-4' },
  { name: 'Ancient Dragon (Ember)', sprite: 'dragon-5' },
  { name: 'Ancient Dragon (Verdant)', sprite: 'dragon-6' },
];

const STAGE_CLASS_COUNT = STAGES.length * CREATURE_NAMES.length;   // 54
export const FIEND_CLASS_COUNT = STAGE_CLASS_COUNT + DRAGON_VARIANTS.length;   // 60

function buildFiendClasses() {
  const classes = [];
  for (const { set, stage } of STAGES) {
    for (let gridIndex = 1; gridIndex <= CREATURE_NAMES.length; gridIndex++) {
      const id = (set - 1) * CREATURE_NAMES.length + gridIndex;
      classes.push({
        id,
        name: CREATURE_NAMES[gridIndex - 1],
        stage,
        spriteSet: set,
        gridIndex,
        spritePath: `./fiend-sprites/set${set}-${String(gridIndex).padStart(2, '0')}.png`,
        scoreValue: SCORE_STEP * id,
        bottomPadRatio: BOTTOM_PAD_RATIO[id - 1],
      });
    }
  }
  DRAGON_VARIANTS.forEach((variant, index) => {
    const id = STAGE_CLASS_COUNT + index + 1;
    classes.push({
      id,
      name: variant.name,
      stage: 'dragon',
      spriteSet: STAGES.length + 1,
      gridIndex: 5,          // the dragon slot the variant derives from
      spritePath: `./fiend-sprites/${variant.sprite}.png`,
      scoreValue: SCORE_STEP * id,
      bottomPadRatio: BOTTOM_PAD_RATIO[id - 1],
    });
  });
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

// One class per level: the ladder is 60 classes deep and the campaign is 60
// levels, so level N fields class N. The wave at a level still mixes in the two
// classes below it (see getFiendClassWeights), which is what makes the art
// change feel gradual rather than switching sets at a chapter boundary.
export const LEVEL_FIEND_CLASS_ID = Object.fromEntries(
  Array.from({ length: FIEND_CLASS_COUNT }, (_, i) => [i + 1, i + 1]),
);

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
