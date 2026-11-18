// difficulty-classes.js - WS4: 36 fiend classes (art tier + score value), layered
// on top of the existing 60-level progression.
//
// Naming note: state.difficulty already means pacing (easy/medium/hard). This is a
// separate axis, referred to in code as "fiend class" to avoid a name collision.
//
// Mapping is fixed by design: class N (1-18) = grid position N in sprite set 1,
// class N+18 (19-36) = the same grid position in set 2, N+36 in set 3, and 55-60
// are the dragons. Score is assigned purely by class index - a positional ladder,
// not a curated one; each later set is always the higher band. Every class has its
// own creature (see CLASS_NAMES); the grid position only fixes the file name and
// the score rung.

// One name per class, in id order: 18 young (set 1), 18 old (set 2), 18 ancient
// (set 3). The art is redrawn per stage - a slot holds a different creature in
// each set (the old "same creature, three ages" ladder is gone), so the names
// follow the sprite, like the dragon variants below.
const CLASS_NAMES = [
  // young (set 1)
  'Pitchfork Imp', 'Necromancer', 'Sandstone Golem', 'Winged Evil Eye', 'Amethyst Wyvern',
  'Fire Elemental', 'Tarantula', 'King Slime', 'Goblin Archer', 'Banshee',
  'Werewolf', 'Giant Vampire Bat', 'Skeleton Pirate', 'Armored Crab', 'Orc Warlord',
  'Thunderbird', 'Frost Knight', 'Grim Reaper',
  // old (set 2)
  'Brimstone Demon', 'Mummy Sorcerer', 'Treant', 'Jellyfish Horror', 'Desert Dragon',
  'Obsidian Knight', 'Frost Spider', 'Acid Slime', 'Goblin Shaman', 'Pirate Ghost',
  'War Boar', 'Harpy', 'Samurai Skeleton', 'Anglerfish', 'Swamp Troll',
  'Carrion Vulture', 'Stone Tortoise', 'Plague Doctor',
  // ancient (set 3)
  'Jester Demon', 'Frost Witch', 'Steam Golem', 'Flaming Skull', 'Sea Dragon',
  'Storm Elemental', 'Black Scorpion', 'Poison Slime', 'Goblin Bomber', 'Ghost Knight',
  'Yeti', 'Gargoyle', 'Skeleton Gladiator', 'Black Octopus', 'Cyclops',
  'Ice Owl', 'Mushroom Brute', 'Witch Doctor',
];

const SCORE_STEP = 50;

// Frames in every walk strip (fiend-walk/*.webp): the strip is that many equally
// wide frames side by side, in playing order.
export const WALK_FRAMES = 8;

// Fraction of each fiend sprite's drawn height to shift the sprite DOWN by, so
// its true ground-contact point (not just its lowest opaque pixel) lands on
// the hero's feet line (GROUND_Y). Tuned by hand via the live visual
// calibration tool (calibrate.html), which renders the real Hero/Fiend classes
// against a ground-line reference so what is tuned there is pixel-identical to
// what the game renders.
//
// One entry per class, in id order: 18 young (set 1), 18 old (set 2), 18
// ancient (set 3), then the six dragons (ids 55-60). The redrawn sprites are
// cropped tight to the creature (build_fiend_walks.py), so there is no padding
// to compensate for and every entry starts at 0 - lowest opaque pixel on the
// ground line. The old per-creature values belonged to the old, padded art and
// would now sink the fiends below the floor; a calibration pass can still add a
// small positive value for a creature whose feet sit above its lowest pixel.
const BOTTOM_PAD_RATIO = new Array(60).fill(0);

// Three art stages per creature: the same grid position in sprite sets 1-3.
const STAGES = [
  { set: 1, stage: 'young' },
  { set: 2, stage: 'old' },
  { set: 3, stage: 'ancient' },
];

// Levels 55-60 get the dragon line: six different dragons, one per sprite file.
// The names follow the sprite rather than the download order.
const DRAGON_VARIANTS = [
  { name: 'Ember Dragon', sprite: 'dragon-1' },
  { name: 'Venom Dragon', sprite: 'dragon-2' },
  { name: 'Thunder Dragon', sprite: 'dragon-3' },
  { name: 'Shadow Dragon', sprite: 'dragon-4' },
  { name: 'Golden Dragon', sprite: 'dragon-5' },
  { name: 'Bone Dragon', sprite: 'dragon-6' },
];

const STAGE_CLASS_COUNT = STAGES.length * 18;   // 54
export const FIEND_CLASS_COUNT = STAGE_CLASS_COUNT + DRAGON_VARIANTS.length;   // 60

function buildFiendClasses() {
  const classes = [];
  for (const { set, stage } of STAGES) {
    for (let gridIndex = 1; gridIndex <= 18; gridIndex++) {
      const id = (set - 1) * 18 + gridIndex;
      const file = `set${set}-${String(gridIndex).padStart(2, '0')}`;
      classes.push({
        id,
        name: CLASS_NAMES[id - 1],
        stage,
        spriteSet: set,
        gridIndex,
        spritePath: `./fiend-sprites/${file}.webp`,
        walkPath: `./fiend-walk/${file}.webp`,
        walkFrames: WALK_FRAMES,
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
      gridIndex: 5,          // the dragon slot (the grid position the dragon line fills)
      spritePath: `./fiend-sprites/${variant.sprite}.webp`,
      walkPath: `./fiend-walk/${variant.sprite}.webp`,
      walkFrames: WALK_FRAMES,
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
