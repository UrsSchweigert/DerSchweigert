// The public bundle carries only levels 1-2; levels 3-FREE_LEVELS are free too but come from
// the API (no login needed), so the bundle stays small and the later configs stay server-side.
export const TOTAL_LEVELS = 60;
// Campaign I levels playable without an entitlement. Keep equal to FREE_LEVELS in
// app/entitlements.py and mobile/game/platform-adapter.js (tests check all three).
export const FREE_LEVELS = 6;
// Campaign II (Genius) levels playable without the subscription or purchase.
export const FREE_LEVELS_2 = 3;
export const LevelConfig = [
  { level: 1, chapter: 1, chapterName: 'Grade 1 Foundations', operations: ['+'],
    operandRange: { a: [1, 3], b: [1, 3] }, maxResult: 6,
    fiendType: 'slimeling', fiendHP: 1, waveSize: 30, inputMode: 'multiple-choice' },
  { level: 2, chapter: 1, chapterName: 'Grade 1 Foundations', operations: ['+'],
    operandRange: { a: [1, 6], b: [1, 6] }, maxResult: 12,
    fiendType: 'bonehead', fiendHP: 1, waveSize: 30, inputMode: 'multiple-choice' },
];

export function lcg(seed) {
  let s = seed >>> 0;
  return {
    next() {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s;
    },
    nextInt(min, max) {
      return min + (this.next() % (max - min + 1));
    },
  };
}

const FIEND_PATTERNS = {
  1: ['slimeling', 'bonehead', 'slimeling', 'toadlord', 'bonehead', 'magelitch', 'slimeling', 'bonehead'],
  2: ['bonehead', 'birdfoe', 'toadlord', 'slimeling', 'wolffoe', 'bonehead', 'magelitch', 'slimeling'],
  3: ['toadlord', 'magelitch', 'wolffoe', 'snakefoe', 'toadlord', 'birdfoe', 'magelitch', 'bonehead'],
  4: ['magelitch', 'snakefoe', 'wolffoe', 'toadlord', 'birdfoe', 'magelitch', 'snakefoe', 'wolffoe'],
};

export function chapterForLevel(level) {
  if (level < 1) return null;
  if (level <= 15) return 1;
  if (level <= 30) return 2;
  if (level <= 45) return 3;
  return 4;
}

function getFiendType(level) {
  const pattern = FIEND_PATTERNS[chapterForLevel(level)];
  return pattern[(level - 1) % pattern.length];
}

export function getFiendWeights(level) {
  const raw = [{ type: getFiendType(level), weight: 0.5 }];
  if (level > 1) raw.push({ type: getFiendType(level - 1), weight: 0.3 });
  if (level > 2) raw.push({ type: getFiendType(level - 2), weight: 0.2 });
  const total = raw.reduce((sum, entry) => sum + entry.weight, 0);
  const merged = [];
  for (const entry of raw) {
    const existing = merged.find(other => other.type === entry.type);
    if (existing) existing.weight += entry.weight / total;
    else merged.push({ type: entry.type, weight: entry.weight / total });
  }
  return merged;
}

export function sampleFiendType(level, spawnIndex) {
  const weights = getFiendWeights(level);
  const rng = lcg(((level * 100003) ^ (spawnIndex * 7919)) >>> 0);
  const draw = rng.next() / 4294967296;
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i].weight;
    if (draw < cumulative || i === weights.length - 1) return weights[i].type;
  }
  return weights[weights.length - 1].type;
}

export function getArithmeticOptionCount(level) {
  if (!Number.isInteger(level) || level < 1 || level > TOTAL_LEVELS) {
    throw new RangeError('Level must be between 1 and 60');
  }
  return level <= 10 ? 5 : 10;
}

function shuffle(values, rng) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

const MAX_SAFE_ANSWER = Number.MAX_SAFE_INTEGER;

function getOperandRange(cfg, key) {
  const range = cfg.operandRange?.[key];
  if (!Array.isArray(range) || range.length !== 2 ||
      !range.every(Number.isSafeInteger) || range[0] < 0 || range[1] < range[0]) {
    throw new Error(`Level ${cfg.level} has an invalid operandRange.${key}; expected [min, max] non-negative safe integers`);
  }
  return range;
}

function getAnswerCeiling(cfg) {
  const ceiling = cfg.maxResult === undefined ? MAX_SAFE_ANSWER : cfg.maxResult;
  if (!Number.isSafeInteger(ceiling) || ceiling < 0) {
    throw new Error(`Level ${cfg.level} has an invalid maxResult; expected a non-negative safe integer`);
  }
  return ceiling;
}

function getOptionalAnswerCeiling(cfg, key) {
  const ceiling = cfg[key] === undefined ? MAX_SAFE_ANSWER : cfg[key];
  if (!Number.isSafeInteger(ceiling) || ceiling < 0) {
    throw new Error(`Level ${cfg.level} has an invalid ${key}; expected a non-negative safe integer`);
  }
  return ceiling;
}

function operationConfigError(cfg, operation) {
  const guidance = {
    '+': 'the minimum operand sum fits maxResult and the safe-integer limit',
    '-': 'the ranges allow b <= a and a - b <= maxResult',
    '*': 'the ranges contain at least one product within maxProduct and the safe-integer limit',
    '/': 'operandRange.a contains a quotient and operandRange.b includes a positive divisor within maxDividend and the safe-integer limit',
  }[operation];
  return new Error(
    `Level ${cfg.level} cannot generate a safe ${operation} problem; adjust the configured ranges so ${guidance}`,
  );
}

function validateOperationConfig(cfg, operation, rangeA, rangeB, answerCeiling) {
  const [minA, maxA] = rangeA;
  const [minB, maxB] = rangeB;
  if (operation === '+') {
    if (minA > answerCeiling - minB || minA > MAX_SAFE_ANSWER - minB) {
      throw operationConfigError(cfg, operation);
    }
  } else if (operation === '-') {
    const firstA = Math.max(minA, minB);
    const firstB = Math.max(minB, firstA - answerCeiling);
    if (firstA > maxA || firstB > Math.min(maxB, firstA)) {
      throw operationConfigError(cfg, operation);
    }
  } else if (operation === '*') {
    const productCeiling = getOptionalAnswerCeiling(cfg, 'maxProduct');
    if (minB > 0 && (
      minA > Math.floor(MAX_SAFE_ANSWER / minB) ||
      minA > Math.floor(productCeiling / minB)
    )) {
      throw operationConfigError(cfg, operation);
    }
  } else if (operation === '/') {
    const minDivisor = Math.max(1, minB);
    const dividendCeiling = getOptionalAnswerCeiling(cfg, 'maxDividend');
    if (minDivisor > maxB ||
        (minA > 0 && (
          minA > Math.floor(MAX_SAFE_ANSWER / minDivisor) ||
          minA > Math.floor(dividendCeiling / minDivisor)
        ))) {
      throw operationConfigError(cfg, operation);
    }
  } else {
    throw new Error(`Level ${cfg.level} has unknown operation "${operation}"`);
  }
}

function getErrorCandidates(operation, a, b, answer) {
  if (operation === '+') return [answer - 1, answer + 1, a, b, a - b];
  if (operation === '-') return [answer - 1, answer + 1, a + b, b];
  if (operation === '*') return [answer - 1, answer + 1, a + b, answer - a, answer - b];
  return [answer - 1, answer + 1, a * b, a - b, a];
}

// Missing-operand questions ("6 + ? = 10") start here: one question in four
// hides an operand at level 10, rising evenly to one in two at level 60.
export const MISSING_OPERAND_FROM_LEVEL = 10;
export function missingOperandShare(level) {
  if (level < MISSING_OPERAND_FROM_LEVEL) return 0;
  return 0.25 + (0.25 * (level - MISSING_OPERAND_FROM_LEVEL)) / (TOTAL_LEVELS - MISSING_OPERAND_FROM_LEVEL);
}

function generateOptions(answer, operation, a, b, rng, count, errorCandidates) {
  if (!Number.isSafeInteger(answer) || answer < 0) {
    throw new Error(`Cannot generate answer choices for invalid answer ${answer}`);
  }
  const radius = Math.max(count - 1, Math.ceil(Math.abs(answer) * 0.1));
  const lower = Math.max(0, answer - radius);
  const upper = Math.min(MAX_SAFE_ANSWER, answer + radius);
  const isInWindow = value =>
    Number.isSafeInteger(value) && value >= lower && value <= upper &&
    Math.abs(value - answer) <= radius && value !== answer;
  const distractors = [];
  const add = value => {
    if (isInWindow(value) && !distractors.includes(value) && distractors.length < count - 1) {
      distractors.push(value);
      return true;
    }
    return false;
  };

  shuffle((errorCandidates ?? getErrorCandidates(operation, a, b, answer)).filter(isInWindow), rng).forEach(add);
  for (let attempts = 0; distractors.length < count - 1 && attempts < count * 32; attempts++) {
    const offset = rng.nextInt(1, radius);
    const side = rng.next() & 1 ? 1 : -1;
    if (!add(answer + side * offset)) add(answer - side * offset);
  }

  if (distractors.length < count - 1) {
    const offsets = Array.from({ length: count * 3 + distractors.length }, (_, index) => index + 1);
    shuffle(offsets, rng);
    for (const offset of offsets) {
      const sides = rng.next() & 1 ? [1, -1] : [-1, 1];
      for (const side of sides) add(answer + side * offset);
      if (distractors.length === count - 1) break;
    }
  }
  if (distractors.length !== count - 1) {
    throw new Error(`Could not generate ${count} unique safe choices for answer ${answer}`);
  }
  return { distractors, options: shuffle([answer, ...distractors], rng) };
}

// Zero joins the operands at level 5 (see scripts/linear-curriculum.mjs). From
// then on half of the operand draws come from the top third of the range so a
// level feels like its number instead of mostly easy questions.
export const TOP_WEIGHT_FROM_LEVEL = 5;
// From here ordinary questions skip the dull ones: x 0, x 1, / 1, 0 / n, n - n, 0 + 0.
export const TRIVIAL_FILTER_FROM_LEVEL = 10;
// Levels 1-2 show some additions as counted runestones instead of digits
// (`visual: { a, b }`, drawn by the renderer and the header; see runestone.js),
// but only when both operands together make at most six stones.
export const OBJECT_VISUAL_MAX_LEVEL = 2;
export const OBJECT_VISUAL_MAX_SUM = 6;
// Bonus points for answering a missing-operand question (it is the harder form).
export const MISSING_OPERAND_BONUS = 25;
// The last fiend of these levels is a boss round: three hits, three question types.
export const BOSS_ROUND_LEVELS = Object.freeze([20, 30, 40, 50, 60]);
export const BOSS_ROUND_HITS = 3;

export function isBossRoundLevel(level) {
  return BOSS_ROUND_LEVELS.includes(level);
}

/** The three question types of a boss round, easiest first. */
export function bossRoundKinds(level) {
  const newest = level >= 40 ? ['*', '/'] : level >= 30 ? ['/'] : ['*'];
  return [{ missing: false }, { operations: newest, missing: false }, { missing: true }];
}

function weightedInt(rng, min, max, level) {
  if (level >= TOP_WEIGHT_FROM_LEVEL && max - min >= 5 && rng.nextInt(0, 1) === 0) {
    return rng.nextInt(min + Math.ceil(((max - min) * 2) / 3), max);
  }
  return rng.nextInt(min, max);
}

function isTrivial(operation, a, b, answer, level) {
  if (level < TRIVIAL_FILTER_FROM_LEVEL) return false;
  if (operation === '+') return a === 0 && b === 0;
  if (operation === '-') return a === b;
  if (operation === '*') return a <= 1 || b <= 1;
  return b === 1 || answer === 0;
}

function rangesFor(cfg, operation) {
  const override = cfg.operandRangeByOp?.[operation];
  if (!override) return [getOperandRange(cfg, 'a'), getOperandRange(cfg, 'b')];
  return [getOperandRange({ ...cfg, operandRange: override }, 'a'), getOperandRange({ ...cfg, operandRange: override }, 'b')];
}

function drawEquation(cfg, operation, rangeA, rangeB, answerCeiling, rng) {
  const level = cfg.level;
  let a, b, answer;
  if (operation === '+') {
    const maxA = Math.min(rangeA[1], answerCeiling - rangeB[0], MAX_SAFE_ANSWER - rangeB[0]);
    a = weightedInt(rng, rangeA[0], maxA, level);
    const maxB = Math.min(rangeB[1], answerCeiling - a, MAX_SAFE_ANSWER - a);
    b = weightedInt(rng, rangeB[0], maxB, level);
    answer = a + b;
  } else if (operation === '-') {
    const minA = Math.max(rangeA[0], rangeB[0]);
    const maxA = Math.min(
      rangeA[1],
      answerCeiling > MAX_SAFE_ANSWER - rangeB[1] ? MAX_SAFE_ANSWER : answerCeiling + rangeB[1],
    );
    a = weightedInt(rng, minA, maxA, level);
    const minB = Math.max(rangeB[0], a - answerCeiling);
    b = rng.nextInt(minB, Math.min(rangeB[1], a));
    answer = a - b;
  } else if (operation === '*') {
    const productCeiling = getOptionalAnswerCeiling(cfg, 'maxProduct');
    const maxA = rangeB[0] === 0
      ? rangeA[1]
      : Math.min(
        rangeA[1],
        Math.floor(MAX_SAFE_ANSWER / rangeB[0]),
        Math.floor(productCeiling / rangeB[0]),
      );
    a = weightedInt(rng, rangeA[0], maxA, level);
    const maxB = a === 0
      ? rangeB[1]
      : Math.min(
        rangeB[1],
        Math.floor(MAX_SAFE_ANSWER / a),
        Math.floor(productCeiling / a),
      );
    b = weightedInt(rng, rangeB[0], maxB, level);
    answer = a * b;
  } else {
    const minDivisor = Math.max(1, rangeB[0]);
    const dividendCeiling = getOptionalAnswerCeiling(cfg, 'maxDividend');
    const maxAnswer = Math.min(
      rangeA[1],
      Math.floor(MAX_SAFE_ANSWER / minDivisor),
      Math.floor(dividendCeiling / minDivisor),
    );
    answer = weightedInt(rng, rangeA[0], maxAnswer, level);
    b = answer === 0
      ? rangeB[1]
      : weightedInt(
        rng,
        minDivisor,
        Math.min(
          rangeB[1],
          Math.floor(MAX_SAFE_ANSWER / answer),
          Math.floor(dividendCeiling / answer),
        ),
        level,
      );
    a = answer * b;
  }
  return { a, b, answer };
}

/**
 * @param {number} levelIndex - 0-based level index.
 * @param {number} rngSeed
 * @param {object} [config] - the level's config (required from level 3).
 * @param {{operations?: string[], missing?: boolean}} [options] - forces the
 *   question type: `operations` restricts the operation, `missing: true` hides
 *   an operand, `missing: false` never does (boss rounds use these).
 */
export function generateProblem(levelIndex, rngSeed, config, options = {}) {
  // For levels 0-1 (bundled free levels 1-2), allow default fallback to LevelConfig
  // For levels 2+ (premium levels 3+), require explicit config parameter
  let cfg = config;
  if (!cfg) {
    if (levelIndex <= 1) {
      cfg = LevelConfig[levelIndex];
    } else {
      throw new Error('Premium level config is required (cannot use public LevelConfig)');
    }
  }

  if (!cfg || cfg.level !== levelIndex + 1) {
    throw new Error('Level configuration mismatch');
  }
  if (!Array.isArray(cfg.operations) || cfg.operations.length === 0) {
    throw new Error(`Level ${cfg.level} must define at least one operation`);
  }

  const rng = lcg(rngSeed);
  const answerCeiling = getAnswerCeiling(cfg);
  for (const operation of new Set(cfg.operations)) {
    const [rangeA, rangeB] = rangesFor(cfg, operation);
    validateOperationConfig(cfg, operation, rangeA, rangeB, answerCeiling);
  }
  const pool = options.operations?.length
    ? cfg.operations.filter(op => options.operations.includes(op))
    : cfg.operations;
  const operations = pool.length ? pool : cfg.operations;
  const forceMissing = options.missing === true;
  const allowMissing = options.missing !== false && cfg.missingOperand !== false;
  const share = forceMissing ? 1 : allowMissing ? missingOperandShare(cfg.level) : 0;
  const count = getArithmeticOptionCount(cfg.level);

  let drawn = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const operation = operations[rng.next() % operations.length];
    const [rangeA, rangeB] = rangesFor(cfg, operation);
    const { a, b, answer } = drawEquation(cfg, operation, rangeA, rangeB, answerCeiling, rng);
    const result = answer;
    let hidden = null;
    if (rng.nextInt(0, 99) < Math.round(share * 100)) {
      hidden = rng.next() & 1 ? 'a' : 'b';
      // A hidden operand must be the only solution: 0 x ? and ? x 0 equal 0 for
      // every value, and 0 / ? = 0 likewise, so those stay ordinary questions.
      // (A divisor is never 0, so division by 0 cannot appear in any form.)
      if (operation === '*' && (hidden === 'a' ? b : a) === 0) hidden = null;
      if (operation === '/' && result === 0) hidden = hidden === 'b' ? 'a' : null;
    }
    if (forceMissing && !hidden) continue;
    drawn = { operation, a, b, result, hidden };
    if (hidden || !isTrivial(operation, a, b, result, cfg.level)) break;
  }
  const { operation, a, b, result, hidden } = drawn;
  const sign = { '+': '+', '-': '-', '*': '×', '/': '÷' }[operation];

  if (hidden) {
    const shown = hidden === 'a' ? b : a;
    const hiddenValue = hidden === 'a' ? a : b;
    const question = hidden === 'a' ? `? ${sign} ${b} = ${result}` : `${a} ${sign} ? = ${result}`;
    const slips = [hiddenValue - 1, hiddenValue + 1, result, shown, result + shown, Math.abs(result - shown)];
    const { distractors, options: choices } = generateOptions(hiddenValue, operation, a, b, rng, count, slips);
    return { question, visual: null, answer: hiddenValue, operation, distractors, options: choices, a, b, result, hidden };
  }
  const question = `${a} ${sign} ${b} = ?`;
  const visual = cfg.level <= OBJECT_VISUAL_MAX_LEVEL && operation === '+' && a + b <= OBJECT_VISUAL_MAX_SUM
    && rng.nextInt(0, 1) === 0
    ? { a, b } : null;
  const { distractors, options: choices } = generateOptions(result, operation, a, b, rng, count);
  return { question, visual, answer: result, operation, distractors, options: choices, a, b, result, hidden };
}

/** The question with its blank filled in, for the reveal after a miss or timeout. */
export function revealQuestion(problem) {
  if (!problem?.question) return '';
  if (problem.revealText) return problem.revealText;   // Campaign 2 builds its own (stacked-maths text)
  return problem.hidden
    ? problem.question.replace('?', String(problem.answer))
    : problem.question.replace(' = ?', ` = ${problem.answer}`);
}
