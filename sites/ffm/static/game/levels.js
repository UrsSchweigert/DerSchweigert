// Public level data contains only the two free levels.
export const TOTAL_LEVELS = 60;
export const LevelConfig = [
  { level: 1, chapter: 1, chapterName: 'Grade 1 Foundations', operations: ['+'],
    operandRange: { a: [1, 5], b: [1, 5] }, maxResult: 10,
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

function generateOptions(answer, operation, a, b, rng, count) {
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

  shuffle(getErrorCandidates(operation, a, b, answer).filter(isInWindow), rng).forEach(add);
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

export function generateProblem(levelIndex, rngSeed, config) {
  // For levels 0-1 (free levels 1-2), allow default fallback to LevelConfig
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
  const rangeA = getOperandRange(cfg, 'a');
  const rangeB = getOperandRange(cfg, 'b');
  const answerCeiling = getAnswerCeiling(cfg);
  for (const operation of new Set(cfg.operations)) {
    validateOperationConfig(cfg, operation, rangeA, rangeB, answerCeiling);
  }
  const operation = cfg.operations[rng.next() % cfg.operations.length];
  let a, b, answer, question;
  if (operation === '+') {
    const maxA = Math.min(rangeA[1], answerCeiling - rangeB[0], MAX_SAFE_ANSWER - rangeB[0]);
    a = rng.nextInt(rangeA[0], maxA);
    const maxB = Math.min(rangeB[1], answerCeiling - a, MAX_SAFE_ANSWER - a);
    b = rng.nextInt(rangeB[0], maxB);
    answer = a + b;
    question = `${a} + ${b} = ?`;
  } else if (operation === '-') {
    const minA = Math.max(rangeA[0], rangeB[0]);
    const maxA = Math.min(
      rangeA[1],
      answerCeiling > MAX_SAFE_ANSWER - rangeB[1] ? MAX_SAFE_ANSWER : answerCeiling + rangeB[1],
    );
    a = rng.nextInt(minA, maxA);
    const minB = Math.max(rangeB[0], a - answerCeiling);
    b = rng.nextInt(minB, Math.min(rangeB[1], a));
    answer = a - b;
    question = `${a} - ${b} = ?`;
  } else if (operation === '*') {
    const productCeiling = getOptionalAnswerCeiling(cfg, 'maxProduct');
    const maxA = rangeB[0] === 0
      ? rangeA[1]
      : Math.min(
        rangeA[1],
        Math.floor(MAX_SAFE_ANSWER / rangeB[0]),
        Math.floor(productCeiling / rangeB[0]),
      );
    a = rng.nextInt(rangeA[0], maxA);
    const maxB = a === 0
      ? rangeB[1]
      : Math.min(
        rangeB[1],
        Math.floor(MAX_SAFE_ANSWER / a),
        Math.floor(productCeiling / a),
      );
    b = rng.nextInt(rangeB[0], maxB);
    answer = a * b;
    question = `${a} × ${b} = ?`;
  } else if (operation === '/') {
    const minDivisor = Math.max(1, rangeB[0]);
    const dividendCeiling = getOptionalAnswerCeiling(cfg, 'maxDividend');
    const maxAnswer = Math.min(
      rangeA[1],
      Math.floor(MAX_SAFE_ANSWER / minDivisor),
      Math.floor(dividendCeiling / minDivisor),
    );
    answer = rng.nextInt(rangeA[0], maxAnswer);
    b = answer === 0
      ? rangeB[1]
      : rng.nextInt(
        minDivisor,
        Math.min(
          rangeB[1],
          Math.floor(MAX_SAFE_ANSWER / answer),
          Math.floor(dividendCeiling / answer),
        ),
      );
    a = answer * b;
    question = `${a} ÷ ${b} = ?`;
  }
  const { distractors, options } = generateOptions(
    answer, operation, a, b, rng, getArithmeticOptionCount(cfg.level),
  );
  return { question, answer, operation, distractors, options, a, b };
}
