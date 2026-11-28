// Basics Math practice: the times tables and the square/root facts behind one
// training mode. Pure logic like shapes.js, so the generator can be tested
// without the DOM, and the problems keep levels.js's shape (question, answer,
// options, distractors) so the ordinary multiple-choice answer flow runs
// unchanged.
//
// The three sets sit behind the two unlocks: the small tables (kleines 1×1)
// come with the Campaign I full unlock, the big tables (großes 1×1) and the
// squares/roots with Campaign II. The unlock check stays here so the panel and
// the start button cannot disagree about it.

// A local LCG read from its high bits. levels.js's lcg hands out `state % span`,
// and an LCG's low bits repeat on a short cycle: seeded with neighbouring
// millisecond stamps, `% 10` would only ever yield two factors. Reading bits
// 16-31 keeps every draw from a small range independent while staying seeded
// and replayable.
function createRng(seed) {
  let state = seed >>> 0;
  const next = () => (state = (Math.imul(1664525, state) + 1013904223) >>> 0);
  return {
    nextInt: (min, max) => min + ((next() >>> 16) % (max - min + 1)),
    nextBit: () => next() >>> 31,
  };
}

export const BASICS_OPTION_COUNT = 4;
// How long a Basics Math run lasts, in minutes. Problems keep coming for the
// whole stretch and the run ends when the clock does; the panel offers exactly
// these lengths, so the stored choice always stays valid.
export const BASICS_DURATIONS = Object.freeze([5, 10, 15, 20, 30]);
export const BASICS_DEFAULT_DURATION = 15;
// n of the squares and roots. 2..15 keeps the answers inside the big tables'
// range (225) instead of asking for 20² = 400.
export const SQUARE_ROOT_MIN = 2;
export const SQUARE_ROOT_MAX = 15;

export const BASICS_SETS = Object.freeze([
  Object.freeze({ id: 'tables-1-10', gate: 'campaign1', min: 1, max: 10 }),
  Object.freeze({ id: 'tables-1-15', gate: 'campaign2', min: 1, max: 15 }),
  Object.freeze({ id: 'squares-roots', gate: 'campaign2' }),
]);

const SET_BY_ID = new Map(BASICS_SETS.map((set) => [set.id, set]));

/** The run length a session plays: a listed preset, or the default for a missing or stale one. */
export function normaliseBasicsDuration(value) {
  const minutes = Number(value);
  return BASICS_DURATIONS.includes(minutes) ? minutes : BASICS_DEFAULT_DURATION;
}

export function basicsSetFor(id) {
  const set = SET_BY_ID.get(id);
  if (!set) throw new TypeError('Unknown Basics Math exercise set');
  return set;
}

/**
 * Whether a set is open. `campaign1` is the full unlock (the subscription on
 * the web, the full-unlock product in the apps); `campaign2` is Campaign II,
 * which the web subscription also covers and the apps sell separately.
 */
export function basicsSetUnlocked(id, { campaign1 = false, campaign2 = false } = {}) {
  const { gate } = basicsSetFor(id);
  return gate === 'campaign1' ? campaign1 === true : campaign2 === true;
}

/** The tables a set can practise, in order; a squares/roots set has none. */
export function basicsFactorRange(setId) {
  const set = basicsSetFor(setId);
  if (!Number.isSafeInteger(set.min) || !Number.isSafeInteger(set.max)) return [];
  return Array.from({ length: set.max - set.min + 1 }, (_, index) => set.min + index);
}

/**
 * The tables a run mixes: unique, sorted and limited to the set. An empty or
 * unusable choice means the whole set, so a stale stored value can never leave
 * a run with no questions.
 */
export function normaliseBasicsFactors(setId, values) {
  const range = basicsFactorRange(setId);
  if (!Array.isArray(values)) return range;
  const allowed = new Set(range);
  const chosen = [...new Set(values.map(Number))]
    .filter((value) => Number.isSafeInteger(value) && allowed.has(value))
    .sort((a, b) => a - b);
  return chosen.length ? chosen : range;
}

/** Badge ids name the set that was practised, like the operation badges do. */
export function basicsBadgeIds(id) {
  return [`practice-basics-${basicsSetFor(id).id}`];
}

/**
 * The synthetic level config a Basics Math session runs on. It is level 1 for
 * art and abilities (a basics session never grants campaign abilities), marks
 * its set with `basicsSetId` so the problem factory routes here, and asks ten
 * encounters like every other finite practice.
 */
export function basicsLevelConfig(id) {
  const set = basicsSetFor(id);
  return {
    level: 1,
    chapter: 1,
    chapterName: 'Basics Math',
    operations: ['*'],
    operandRange: { a: [1, 10], b: [1, 10] },
    maxResult: 100,
    fiendType: 'slimeling',
    fiendHP: 1,
    waveSize: 10,
    inputMode: 'multiple-choice',
    missingOperand: false,
    artLevel: 1,
    basicsSetId: set.id,
  };
}

function shuffle(values, rng) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

/**
 * `answer` plus three distinct, non-negative choices. The slips come first so
 * a wrong button is a real mistake (the neighbouring factor, the doubled
 * square), and the fill loop only runs when they collide at the edges.
 */
function pickChoices(answer, slips, rng) {
  const chosen = new Set([answer]);
  for (const value of slips) {
    if (chosen.size >= BASICS_OPTION_COUNT) break;
    if (Number.isSafeInteger(value) && value >= 0) chosen.add(value);
  }
  for (let offset = 1; chosen.size < BASICS_OPTION_COUNT && offset <= 100; offset++) {
    chosen.add(answer + offset);
    if (chosen.size < BASICS_OPTION_COUNT && answer - offset >= 0) chosen.add(answer - offset);
  }
  const options = shuffle([...chosen], rng);
  return { options, distractors: options.filter((value) => value !== answer) };
}

// One factor comes from the chosen tables and the other from the set's whole
// range, either way round: practising "3, 7 and 9" must ask 3 × 8 and 8 × 3.
function tablesProblem(set, rows, rng) {
  const row = rows[rng.nextInt(0, rows.length - 1)];
  const other = rng.nextInt(set.min, set.max);
  const [a, b] = rng.nextBit() ? [row, other] : [other, row];
  const answer = a * b;
  const { options, distractors } = pickChoices(answer, [
    (a + 1) * b, (a - 1) * b, a * (b + 1), a * (b - 1), answer + 1, answer - 1,
  ], rng);
  return { question: `${a} × ${b} = ?`, answer, operation: '*', distractors, options, a, b };
}

function squaresRootsProblem(rng) {
  const n = rng.nextInt(SQUARE_ROOT_MIN, SQUARE_ROOT_MAX);
  const square = n * n;
  if (rng.nextBit()) {
    // √225 = ? — the root form; the classic slip is reading the square, not
    // the root, beside the neighbouring roots.
    const { options, distractors } = pickChoices(n, [
      n - 1, n + 1, 2 * n, square, n * (n + 1), n * (n - 1),
    ], rng);
    return { question: `√${square} = ?`, answer: n, distractors, options };
  }
  // 12² = ? — the square form; the classic n²-read-as-2n slip comes first.
  const { options, distractors } = pickChoices(square, [
    2 * n, (n + 1) ** 2, (n - 1) ** 2, square + n, square - n, square + 1,
  ], rng);
  return { question: `${n}² = ?`, answer: square, operation: '*', distractors, options, a: n, b: n };
}

export function generateBasicsProblem(setId, rngSeed, { factors } = {}) {
  const set = basicsSetFor(setId);
  const rng = createRng(rngSeed);
  return set.id === 'squares-roots'
    ? squaresRootsProblem(rng)
    : tablesProblem(set, normaliseBasicsFactors(setId, factors), rng);
}
