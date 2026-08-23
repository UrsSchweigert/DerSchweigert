// Arithmo Slayer - Levels Configuration and Problem Generator

/**
 * LCG (Linear Congruential Generator) for deterministic random numbers
 * @param {number} seed - Initial seed value
 * @returns {object} RNG object with next() and nextInt() methods
 */
function lcg(seed) {
  let s = seed >>> 0;
  return {
    next() {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s;
    },
    nextInt(min, max) {
      return min + (this.next() % (max - min + 1));
    }
  };
}

/**
 * Calculate fiendHP based on level
 * @param {number} level - 1-based level number
 * @param {number} rngSeed - Seed for randomization
 * @returns {number} HP value
 */
function calculateFiendHP(level, rngSeed) {
  const rng = lcg(rngSeed + level * 31);
  if (level <= 12) return 1;
  if (level <= 24) return rng.next() % 3 === 0 ? 2 : 1;
  if (level <= 40) return rng.next() % 2 === 0 ? 2 : 3;
  if (level <= 50) return [2, 3, 3, 4][rng.next() % 4];
  return [3, 3, 4, 4][rng.next() % 4];
}

const CHAPTER_NAMES = {
  1: 'Grade 1 Foundations',
  2: 'Grade 1-2 Expansion',
  3: 'Grade 3-4 Core Arithmetic',
  4: 'Elementary Mastery Mix'
};

const FIEND_PATTERNS = {
  1: ['slimeling', 'bonehead', 'slimeling', 'bonehead', 'slimeling'],
  2: ['bonehead', 'slimeling', 'toadlord', 'bonehead', 'slimeling'],
  3: ['toadlord', 'magelitch', 'bonehead', 'toadlord', 'snakefoe'],
  4: ['magelitch', 'toadlord', 'snakefoe', 'bonehead', 'slimeling']
};

function getFiendType(level, chapter) {
  const pattern = FIEND_PATTERNS[chapter] || FIEND_PATTERNS[4];
  return pattern[(level - 1) % pattern.length];
}

function buildLevel(overrides) {
  const level = overrides.level;
  const chapter = overrides.chapter;
  return {
    level,
    chapter,
    chapterName: CHAPTER_NAMES[chapter],
    operations: overrides.operations,
    operandRange: overrides.operandRange,
    maxResult: overrides.maxResult,
    fiendType: overrides.fiendType || getFiendType(level, chapter),
    fiendHP: overrides.fiendHP ?? calculateFiendHP(level, level),
    waveSize: overrides.waveSize,
    inputMode: overrides.inputMode
  };
}

/**
 * Configuration for all 60 levels
 */
export const LevelConfig = [
  // Block 1: Grade 1 (Levels 1-15)
  buildLevel({ level: 1, chapter: 1, operations: ['+'], operandRange: { a: [1, 5], b: [1, 5] }, maxResult: 10, fiendHP: 1, waveSize: 5, inputMode: 'multiple-choice' }),
  buildLevel({ level: 2, chapter: 1, operations: ['+'], operandRange: { a: [1, 6], b: [1, 6] }, maxResult: 12, fiendHP: 1, waveSize: 5, inputMode: 'multiple-choice' }),
  buildLevel({ level: 3, chapter: 1, operations: ['+'], operandRange: { a: [1, 8], b: [1, 8] }, maxResult: 16, fiendHP: 1, waveSize: 5, inputMode: 'multiple-choice' }),
  buildLevel({ level: 4, chapter: 1, operations: ['+'], operandRange: { a: [1, 10], b: [1, 10] }, maxResult: 20, fiendHP: 1, waveSize: 5, inputMode: 'multiple-choice' }),
  buildLevel({ level: 5, chapter: 1, operations: ['+'], operandRange: { a: [1, 12], b: [1, 8] }, maxResult: 20, fiendHP: 1, waveSize: 5, inputMode: 'multiple-choice' }),
  buildLevel({ level: 6, chapter: 1, operations: ['+'], operandRange: { a: [1, 15], b: [1, 5] }, maxResult: 20, fiendHP: 1, waveSize: 5, inputMode: 'multiple-choice' }),
  buildLevel({ level: 7, chapter: 1, operations: ['+'], operandRange: { a: [1, 20], b: [1, 10] }, maxResult: 20, fiendHP: 1, waveSize: 6, inputMode: 'free-text' }),
  buildLevel({ level: 8, chapter: 1, operations: ['-'], operandRange: { a: [5, 20], b: [1, 10] }, maxResult: 20, fiendHP: 1, waveSize: 6, inputMode: 'free-text' }),
  buildLevel({ level: 9, chapter: 1, operations: ['+', '-'], operandRange: { a: [1, 20], b: [1, 10] }, maxResult: 20, fiendHP: 1, waveSize: 6, inputMode: 'free-text' }),
  buildLevel({ level: 10, chapter: 1, operations: ['+', '-'], operandRange: { a: [1, 20], b: [1, 12] }, maxResult: 20, fiendHP: 1, waveSize: 6, inputMode: 'free-text' }),
  buildLevel({ level: 11, chapter: 1, operations: ['+', '-'], operandRange: { a: [1, 20], b: [1, 15] }, maxResult: 20, fiendHP: 1, waveSize: 6, inputMode: 'free-text' }),
  buildLevel({ level: 12, chapter: 1, operations: ['+', '-'], operandRange: { a: [1, 20], b: [1, 20] }, maxResult: 20, fiendHP: 1, waveSize: 6, inputMode: 'free-text' }),
  buildLevel({ level: 13, chapter: 1, operations: ['+', '-'], operandRange: { a: [1, 20], b: [1, 20] }, maxResult: 20, waveSize: 6, inputMode: 'free-text' }),
  buildLevel({ level: 14, chapter: 1, operations: ['+', '-'], operandRange: { a: [1, 20], b: [1, 20] }, maxResult: 20, waveSize: 6, inputMode: 'free-text' }),
  buildLevel({ level: 15, chapter: 1, operations: ['+', '-'], operandRange: { a: [1, 20], b: [1, 20] }, maxResult: 20, waveSize: 6, inputMode: 'free-text' }),

  // Block 2: Grade 1-2 (Levels 16-30)
  buildLevel({ level: 16, chapter: 2, operations: ['+'], operandRange: { a: [10, 40], b: [10, 40] }, maxResult: 80, waveSize: 6, inputMode: 'free-text' }),
  buildLevel({ level: 17, chapter: 2, operations: ['+'], operandRange: { a: [20, 60], b: [10, 40] }, maxResult: 100, waveSize: 6, inputMode: 'free-text' }),
  buildLevel({ level: 18, chapter: 2, operations: ['-'], operandRange: { a: [20, 80], b: [1, 40] }, maxResult: 80, waveSize: 6, inputMode: 'free-text' }),
  buildLevel({ level: 19, chapter: 2, operations: ['-'], operandRange: { a: [30, 100], b: [1, 60] }, maxResult: 100, waveSize: 6, inputMode: 'free-text' }),
  buildLevel({ level: 20, chapter: 2, operations: ['+', '-'], operandRange: { a: [10, 100], b: [1, 50] }, maxResult: 100, waveSize: 6, inputMode: 'free-text' }),
  buildLevel({ level: 21, chapter: 2, operations: ['+', '-'], operandRange: { a: [10, 100], b: [1, 70] }, maxResult: 100, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 22, chapter: 2, operations: ['+', '-'], operandRange: { a: [1, 100], b: [1, 100] }, maxResult: 100, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 23, chapter: 2, operations: ['+', '-'], operandRange: { a: [1, 100], b: [1, 100] }, maxResult: 100, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 24, chapter: 2, operations: ['+', '-'], operandRange: { a: [1, 100], b: [1, 100] }, maxResult: 100, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 25, chapter: 2, operations: ['*'], operandRange: { a: [1, 10], b: [2, 3] }, maxResult: 30, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 26, chapter: 2, operations: ['*'], operandRange: { a: [1, 10], b: [2, 5] }, maxResult: 50, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 27, chapter: 2, operations: ['*'], operandRange: { a: [1, 12], b: [2, 6] }, maxResult: 72, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 28, chapter: 2, operations: ['+', '-', '*'], operandRange: { a: [1, 100], b: [2, 8] }, maxResult: 120, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 29, chapter: 2, operations: ['+', '-', '*'], operandRange: { a: [1, 100], b: [2, 9] }, maxResult: 150, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 30, chapter: 2, operations: ['+', '-', '*'], operandRange: { a: [1, 100], b: [2, 10] }, maxResult: 200, waveSize: 7, inputMode: 'free-text' }),

  // Block 3: Grade 3-4 Arithmetic Core (Levels 31-45)
  buildLevel({ level: 31, chapter: 3, operations: ['*'], operandRange: { a: [2, 12], b: [2, 10] }, maxResult: 120, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 32, chapter: 3, operations: ['*'], operandRange: { a: [2, 15], b: [2, 10] }, maxResult: 150, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 33, chapter: 3, operations: ['*'], operandRange: { a: [2, 20], b: [2, 12] }, maxResult: 240, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 34, chapter: 3, operations: ['/'], operandRange: { a: [2, 10], b: [2, 10] }, maxResult: 10, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 35, chapter: 3, operations: ['/'], operandRange: { a: [2, 12], b: [2, 12] }, maxResult: 12, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 36, chapter: 3, operations: ['*', '/'], operandRange: { a: [2, 12], b: [2, 12] }, maxResult: 144, waveSize: 7, inputMode: 'free-text' }),
  buildLevel({ level: 37, chapter: 3, operations: ['+', '-'], operandRange: { a: [100, 500], b: [10, 200] }, maxResult: 700, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 38, chapter: 3, operations: ['+', '-'], operandRange: { a: [200, 800], b: [20, 300] }, maxResult: 1000, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 39, chapter: 3, operations: ['*'], operandRange: { a: [10, 50], b: [2, 12] }, maxResult: 600, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 40, chapter: 3, operations: ['*', '/'], operandRange: { a: [5, 25], b: [2, 12] }, maxResult: 300, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 41, chapter: 3, operations: ['+', '-', '*'], operandRange: { a: [50, 400], b: [2, 12] }, maxResult: 800, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 42, chapter: 3, operations: ['+', '-', '*'], operandRange: { a: [100, 600], b: [2, 12] }, maxResult: 1000, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 43, chapter: 3, operations: ['+', '-', '*', '/'], operandRange: { a: [10, 80], b: [2, 12] }, maxResult: 960, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 44, chapter: 3, operations: ['+', '-', '*', '/'], operandRange: { a: [20, 100], b: [2, 12] }, maxResult: 1200, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 45, chapter: 3, operations: ['+', '-', '*', '/'], operandRange: { a: [20, 120], b: [2, 12] }, maxResult: 1440, waveSize: 8, inputMode: 'free-text' }),

  // Block 4: Mastery and transfer (Levels 46-60)
  buildLevel({ level: 46, chapter: 4, operations: ['+', '-'], operandRange: { a: [100, 900], b: [20, 400] }, maxResult: 1300, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 47, chapter: 4, operations: ['*', '/'], operandRange: { a: [5, 40], b: [2, 12] }, maxResult: 480, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 48, chapter: 4, operations: ['+', '-', '*'], operandRange: { a: [50, 500], b: [2, 15] }, maxResult: 2000, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 49, chapter: 4, operations: ['+', '-', '*', '/'], operandRange: { a: [10, 100], b: [2, 12] }, maxResult: 1200, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 50, chapter: 4, operations: ['+', '-', '*', '/'], operandRange: { a: [20, 120], b: [2, 15] }, maxResult: 1800, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 51, chapter: 4, operations: ['+', '-', '*', '/'], operandRange: { a: [30, 150], b: [2, 15] }, maxResult: 2250, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 52, chapter: 4, operations: ['+', '-', '*', '/'], operandRange: { a: [40, 180], b: [2, 15] }, maxResult: 2700, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 53, chapter: 4, operations: ['+', '-', '*', '/'], operandRange: { a: [50, 200], b: [2, 18] }, maxResult: 3600, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 54, chapter: 4, operations: ['+', '-', '*', '/'], operandRange: { a: [60, 220], b: [2, 18] }, maxResult: 3960, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 55, chapter: 4, operations: ['+', '-', '*', '/'], operandRange: { a: [70, 240], b: [2, 20] }, maxResult: 4800, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 56, chapter: 4, operations: ['+', '-', '*', '/'], operandRange: { a: [80, 260], b: [2, 20] }, maxResult: 5200, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 57, chapter: 4, operations: ['+', '-', '*', '/'], operandRange: { a: [90, 280], b: [2, 20] }, maxResult: 5600, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 58, chapter: 4, operations: ['+', '-', '*', '/'], operandRange: { a: [100, 300], b: [2, 20] }, maxResult: 6000, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 59, chapter: 4, operations: ['+', '-', '*', '/'], operandRange: { a: [120, 320], b: [2, 20] }, maxResult: 6400, waveSize: 8, inputMode: 'free-text' }),
  buildLevel({ level: 60, chapter: 4, operations: ['+', '-', '*', '/'], operandRange: { a: [150, 350], b: [2, 20] }, maxResult: 7000, waveSize: 8, inputMode: 'free-text' }),
];

/**
 * Generate distractors for multiple-choice problems
 * @param {number} answer - Correct answer
 * @param {object} rng - RNG instance
 * @param {object} cfg - Level configuration
 * @returns {number[]} Array of 3 distractor values
 */
function generateDistractors(answer, rng, cfg) {
  const range = Math.max(3, Math.floor(cfg.maxResult * 0.3));
  const plausMin = Math.max(0, answer - range);
  const plausMax = answer + range;
  const candidates = new Set();

  // 1. off-by-one
  candidates.add(answer + (rng.next() % 2 === 0 ? 1 : -1));

  // 2. off-by-small-multiple
  const mult = 2 + (rng.next() % 4); // 2-5
  candidates.add(answer + (rng.next() % 2 === 0 ? mult : -mult));

  // 3. random in plausible range
  candidates.add(rng.nextInt(plausMin, plausMax));

  // Remove answer from candidates
  candidates.delete(answer);

  // Ensure 3 distinct distractors (retry loop max 50 attempts)
  let attempts = 0;
  while (candidates.size < 3 && attempts < 50) {
    const v = rng.nextInt(plausMin, plausMax);
    if (v !== answer) candidates.add(v);
    attempts++;
  }

  // Fallback: add offset 1..50 until we have 3
  for (let off = 1; candidates.size < 3; off++) {
    if (answer + off !== answer) candidates.add(answer + off);
  }

  return [...candidates].slice(0, 3);
}

/**
 * Generate a math problem for a given level
 * @param {number} levelIndex - 0-based level index (0-59)
 * @param {number} rngSeed - Seed for RNG
 * @returns {object} Problem object with question, answer, distractors, operation
 */
export function generateProblem(levelIndex, rngSeed) {
  const cfg = LevelConfig[levelIndex];
  const rng = lcg(rngSeed);

  // Pick operation
  const operation = cfg.operations[rng.next() % cfg.operations.length];

  let a, b, answer, question;

  if (operation === '+') {
    // Addition
    const [aMin, aMax] = cfg.operandRange.a;
    const [bMin, bMax] = cfg.operandRange.b;
    a = rng.nextInt(aMin, aMax);
    b = rng.nextInt(bMin, bMax);
    answer = a + b;
    question = `${a} + ${b} = ?`;
  } else if (operation === '-') {
    // Subtraction - ensure a >= b
    const [aMin, aMax] = cfg.operandRange.a;
    a = rng.nextInt(aMin, aMax);
    b = rng.nextInt(1, a);
    answer = a - b;
    question = `${a} − ${b} = ?`;
  } else if (operation === '*') {
    // Multiplication
    const [aMin, aMax] = cfg.operandRange.a;
    const [bMin, bMax] = cfg.operandRange.b;
    a = rng.nextInt(aMin, aMax);
    b = rng.nextInt(bMin, bMax);
    answer = a * b;
    question = `${a} × ${b} = ?`;
  } else if (operation === '/') {
    // Division - generate answer first, then compute a = answer * b
    const [answerMin, answerMax] = cfg.operandRange.a;
    const [bMin, bMax] = cfg.operandRange.b;
    answer = rng.nextInt(answerMin, answerMax);
    b = rng.nextInt(bMin, bMax);
    a = answer * b;
    question = `${a} ÷ ${b} = ?`;
  }

  let distractors = [];
  if (cfg.inputMode === 'multiple-choice') {
    distractors = generateDistractors(answer, rng, cfg);
  }

  return {
    question,
    answer,
    distractors,
    operation
  };
}
