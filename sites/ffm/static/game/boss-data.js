// boss-data.js — the six Wardens and the Hollow King.
//
// Data only: names are i18n keys, the numbers a fight poses come from the level
// band its act ends on, and nothing here knows about rendering or scoring.
// A fight is three lock phases plus the mastery round that awards the crown.
//
// Act k covers levels 10k-9 .. 10k. Its Warden unlocks when those ten levels are
// cleared, and the next act does not open until the Warden falls.

export const LEVELS_PER_ACT = 10;
export const ACT_COUNT = 6;

// Difficulty only moves the Ward Clock and how often a miss costs a heart.
// Nothing here makes a problem different, so a fight is never easier by being
// asked a different question - only by having more time to think.
export const DIFFICULTY_RULES = Object.freeze({
  easy: Object.freeze({ wardClock: 90, missHeartEvery: 0, restateOnFirstMiss: true }),
  medium: Object.freeze({ wardClock: 60, missHeartEvery: 3, restateOnFirstMiss: false }),
  hard: Object.freeze({ wardClock: 45, missHeartEvery: 1, restateOnFirstMiss: false }),
});

export const WARDEN_BASE_HEARTS = 5;
export const HOLLOW_KING_HEARTS = 6;

const seals = count => Object.freeze({ seals: count, clockBonusPerSeal: 3 });

export const WARDENS = Object.freeze([
  Object.freeze({
    id: 'warden-dawn',
    art: Object.freeze({ arena: 'boss/arena-1.webp', figure: 'boss/figure-dawn.webp' }),
    act: 1,
    afterLevel: 10,
    bandLevel: 10,
    nameKey: 'boss.dawn.name',
    arena: 1,
    hearts: WARDEN_BASE_HEARTS,
    perSealValue: 25_000,
    phases: Object.freeze([
      Object.freeze({ id: 'hinges', nameKey: 'boss.dawn.hinges', kind: 'direct', ...seals(3) }),
      Object.freeze({ id: 'sunrise', nameKey: 'boss.dawn.sunrise', kind: 'sequence', rules: Object.freeze(['ascending', 'descending']), ...seals(3) }),
      Object.freeze({ id: 'keyhole', nameKey: 'boss.dawn.keyhole', kind: 'inverse', ...seals(3) }),
    ]),
  }),
  Object.freeze({
    id: 'warden-harvest',
    art: Object.freeze({ arena: 'boss/arena-2.webp', figure: 'boss/figure-harvest.webp' }),
    act: 2,
    afterLevel: 20,
    bandLevel: 20,
    nameKey: 'boss.harvest.name',
    arena: 2,
    hearts: WARDEN_BASE_HEARTS,
    perSealValue: 45_000,
    phases: Object.freeze([
      Object.freeze({ id: 'field', nameKey: 'boss.harvest.field', kind: 'direct', ...seals(3) }),
      Object.freeze({ id: 'scale', nameKey: 'boss.harvest.scale', kind: 'sequence', rules: Object.freeze(['pairSum']), ...seals(3) }),
      Object.freeze({ id: 'tithe', nameKey: 'boss.harvest.tithe', kind: 'inverse', ...seals(3) }),
    ]),
  }),
  Object.freeze({
    id: 'warden-memory',
    art: Object.freeze({ arena: 'boss/arena-3.webp', figure: 'boss/figure-memory.webp' }),
    act: 3,
    afterLevel: 30,
    bandLevel: 30,
    nameKey: 'boss.memory.name',
    arena: 3,
    hearts: WARDEN_BASE_HEARTS,
    perSealValue: 65_000,
    phases: Object.freeze([
      Object.freeze({ id: 'echo', nameKey: 'boss.memory.echo', kind: 'direct', ...seals(3) }),
      Object.freeze({ id: 'runes', nameKey: 'boss.memory.runes', kind: 'sequence', rules: Object.freeze(['factorChain']), ...seals(3) }),
      Object.freeze({ id: 'forgetful', nameKey: 'boss.memory.forgetful', kind: 'sequence', rules: Object.freeze(['oddOneOut']), ...seals(3) }),
    ]),
  }),
  Object.freeze({
    id: 'warden-keep',
    art: Object.freeze({ arena: 'boss/arena-4.webp', figure: 'boss/figure-keep.webp' }),
    act: 4,
    afterLevel: 40,
    bandLevel: 40,
    nameKey: 'boss.keep.name',
    arena: 4,
    hearts: WARDEN_BASE_HEARTS,
    perSealValue: 85_000,
    phases: Object.freeze([
      Object.freeze({ id: 'oath', nameKey: 'boss.keep.oath', kind: 'direct', ...seals(3) }),
      Object.freeze({ id: 'shares', nameKey: 'boss.keep.shares', kind: 'sequence', rules: Object.freeze(['equalShare']), ...seals(3) }),
      Object.freeze({ id: 'ledger', nameKey: 'boss.keep.ledger', kind: 'inverse', ...seals(3) }),
    ]),
  }),
  Object.freeze({
    id: 'warden-market',
    art: Object.freeze({ arena: 'boss/arena-5.webp', figure: 'boss/figure-market.webp' }),
    act: 5,
    afterLevel: 50,
    bandLevel: 50,
    nameKey: 'boss.market.name',
    arena: 5,
    hearts: WARDEN_BASE_HEARTS,
    perSealValue: 105_000,
    phases: Object.freeze([
      Object.freeze({ id: 'stalls', nameKey: 'boss.market.stalls', kind: 'direct', ...seals(3) }),
      Object.freeze({ id: 'change', nameKey: 'boss.market.change', kind: 'sequence', rules: Object.freeze(['pairSum']), ...seals(3) }),
      Object.freeze({ id: 'price', nameKey: 'boss.market.price', kind: 'sequence', rules: Object.freeze(['composeTarget']), ...seals(3) }),
    ]),
  }),
  Object.freeze({
    id: 'warden-throne',
    art: Object.freeze({ arena: 'boss/arena-6.webp', figure: 'boss/figure-throne.webp' }),
    act: 6,
    afterLevel: 60,
    bandLevel: 60,
    nameKey: 'boss.throne.name',
    arena: 6,
    hearts: WARDEN_BASE_HEARTS,
    perSealValue: 125_000,
    phases: Object.freeze([
      Object.freeze({ id: 'crown', nameKey: 'boss.throne.crown', kind: 'direct', ...seals(3) }),
      Object.freeze({ id: 'lock', nameKey: 'boss.throne.lock', kind: 'sequence', rules: Object.freeze(['ascending', 'pairSum', 'factorChain', 'oddOneOut', 'equalShare', 'composeTarget']), ...seals(3) }),
      // The last Warden stops restating its rule: it must be read once, then held.
      Object.freeze({ id: 'silence', nameKey: 'boss.throne.silence', kind: 'sequence', rules: Object.freeze(['pairSum', 'composeTarget']), hideRule: true, ...seals(3) }),
    ]),
  }),
]);

export const HOLLOW_KING = Object.freeze({
  id: 'hollow-king',
  act: 6,
  afterLevel: 60,
  bandLevel: 60,
  nameKey: 'boss.hollowKing.name',
  art: Object.freeze({ arena: 'boss/arena-6.webp', figure: 'boss/figure-hollow-king.webp' }),
  arena: 6,
  hearts: HOLLOW_KING_HEARTS,
  perSealValue: 200_000,
  final: true,
  phases: Object.freeze([
    // Recollection: the six Warden rules come back, one act after another.
    Object.freeze({ id: 'recollection', nameKey: 'boss.hollowKing.recollection', kind: 'sequence', rules: Object.freeze(['ascending', 'pairSum', 'factorChain', 'equalShare', 'composeTarget']), ...seals(4) }),
    // Silence: the rule is shown once per seal and then withheld.
    Object.freeze({ id: 'silence', nameKey: 'boss.hollowKing.silence', kind: 'sequence', rules: Object.freeze(['pairSum', 'composeTarget', 'oddOneOut']), hideRule: true, ...seals(4) }),
    // The Unmaking asks the player to choose the operation, not just the numbers.
    Object.freeze({ id: 'unmaking', nameKey: 'boss.hollowKing.unmaking', kind: 'sequence', rules: Object.freeze(['composeTarget']), ...seals(4) }),
    // Mastery: no interference, no clock, and the crown is decided here.
    Object.freeze({ id: 'mastery', nameKey: 'boss.hollowKing.mastery', kind: 'mastery', seals: 8, clockBonusPerSeal: 0, masteryRound: true }),
  ]),
});

export const BOSSES = Object.freeze([...WARDENS, HOLLOW_KING]);

export function getBoss(id) {
  const boss = BOSSES.find(candidate => candidate.id === id);
  if (!boss) throw new TypeError(`Unknown boss "${id}"`);
  return boss;
}

export function bossForAct(act) {
  return WARDENS.find(warden => warden.act === act) ?? null;
}

/** The boss node that sits at the end of the act a level belongs to. */
export function bossForLevel(level) {
  const warden = bossForAct(Math.ceil(level / LEVELS_PER_ACT));
  return warden ?? null;
}

function clearedSet(clearedLevels) {
  return new Set(clearedLevels);
}

function actLevels(act) {
  const first = (act - 1) * LEVELS_PER_ACT + 1;
  return Array.from({ length: LEVELS_PER_ACT }, (_, index) => first + index);
}

/** A Warden opens when every level of its own act is cleared. */
export function wardenUnlocked(warden, { clearedLevels = [] } = {}) {
  const cleared = clearedSet(clearedLevels);
  return actLevels(warden.act).every(level => cleared.has(level));
}

/** The Hollow King opens only after the campaign and all six Wardens. */
export function hollowKingUnlocked({ clearedLevels = [], defeatedBosses = [] } = {}) {
  const cleared = clearedSet(clearedLevels);
  return Array.from({ length: ACT_COUNT * LEVELS_PER_ACT }, (_, index) => index + 1)
    .every(level => cleared.has(level))
    && WARDENS.every(warden => defeatedBosses.includes(warden.id));
}

export function availableBosses({ clearedLevels = [], defeatedBosses = [] } = {}) {
  const open = WARDENS
    .filter(warden => wardenUnlocked(warden, { clearedLevels }))
    .map(warden => warden.id);
  if (hollowKingUnlocked({ clearedLevels, defeatedBosses })) open.push(HOLLOW_KING.id);
  return open;
}

/**
 * Whether a level may be started. Act I keeps its existing progression; every
 * later act waits for the Warden that guards its gate.
 */
export function levelUnlocked(level, { defeatedBosses = [] } = {}) {
  if (!Number.isInteger(level) || level < 1) return false;
  const act = Math.ceil(level / LEVELS_PER_ACT);
  if (act <= 1) return true;
  const gatekeeper = bossForAct(act - 1);
  return gatekeeper ? defeatedBosses.includes(gatekeeper.id) : true;
}

export function totalCrowns(results = {}) {
  return Object.values(results).reduce((sum, result) => sum + (result?.crowns ?? 0), 0);
}
