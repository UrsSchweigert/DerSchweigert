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
      });
    }
  }
  return classes;
}

export const FIEND_CLASSES = buildFiendClasses();

export function getFiendClass(id) {
  return FIEND_CLASSES.find((c) => c.id === id) ?? FIEND_CLASSES[0];
}
