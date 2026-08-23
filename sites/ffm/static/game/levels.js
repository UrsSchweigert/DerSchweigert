// Math Fiend Slayer - Levels Configuration and Problem Generator

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
  if (level <= 15) return 1;
  if (level <= 22) {
    const rng = lcg(rngSeed + level);
    return rng.next() % 2 === 0 ? 1 : 2;
  }
  if (level <= 30) return 2;
  if (level <= 35) {
    const rng = lcg(rngSeed + level);
    return rng.next() % 2 === 0 ? 2 : 3;
  }
  // levels 36-40
  const rng = lcg(rngSeed + level);
  return rng.next() % 2 === 0 ? 3 : 4;
}

/**
 * Get fiend type based on level
 * @param {number} level - 1-based level number
 * @returns {string} Fiend type name
 */
function getFiendType(level) {
  if (level <= 10) return "slimeling";
  if (level <= 20) return "bonehead";
  if (level <= 30) return "toadlord";
  return "magelitch";
}

/**
 * Configuration for all 40 levels
 */
export const LevelConfig = [
  // Chapter 1: Addition (Levels 1-10)  — 5–6 waves
  { level: 1, chapter: 1, chapterName: "Addition", operations: ['+'], operandRange: { a: [1, 5], b: [1, 5] }, maxResult: 10, fiendType: "slimeling", fiendHP: 1, waveSize: 5, inputMode: "multiple-choice" },
  { level: 2, chapter: 1, chapterName: "Addition", operations: ['+'], operandRange: { a: [1, 5], b: [1, 5] }, maxResult: 10, fiendType: "slimeling", fiendHP: 1, waveSize: 5, inputMode: "multiple-choice" },
  { level: 3, chapter: 1, chapterName: "Addition", operations: ['+'], operandRange: { a: [1, 10], b: [1, 10] }, maxResult: 20, fiendType: "slimeling", fiendHP: 1, waveSize: 5, inputMode: "multiple-choice" },
  { level: 4, chapter: 1, chapterName: "Addition", operations: ['+'], operandRange: { a: [1, 10], b: [1, 10] }, maxResult: 20, fiendType: "slimeling", fiendHP: 1, waveSize: 5, inputMode: "multiple-choice" },
  { level: 5, chapter: 1, chapterName: "Addition", operations: ['+'], operandRange: { a: [1, 20], b: [1, 10] }, maxResult: 30, fiendType: "slimeling", fiendHP: 1, waveSize: 5, inputMode: "multiple-choice" },
  { level: 6, chapter: 1, chapterName: "Addition", operations: ['+'], operandRange: { a: [1, 20], b: [1, 10] }, maxResult: 30, fiendType: "slimeling", fiendHP: 1, waveSize: 6, inputMode: "free-text" },
  { level: 7, chapter: 1, chapterName: "Addition", operations: ['+'], operandRange: { a: [1, 20], b: [1, 20] }, maxResult: 40, fiendType: "slimeling", fiendHP: 1, waveSize: 6, inputMode: "free-text" },
  { level: 8, chapter: 1, chapterName: "Addition", operations: ['+'], operandRange: { a: [1, 20], b: [1, 20] }, maxResult: 40, fiendType: "slimeling", fiendHP: 1, waveSize: 6, inputMode: "free-text" },
  { level: 9, chapter: 1, chapterName: "Addition", operations: ['+'], operandRange: { a: [1, 50], b: [1, 50] }, maxResult: 100, fiendType: "slimeling", fiendHP: 1, waveSize: 6, inputMode: "free-text" },
  { level: 10, chapter: 1, chapterName: "Addition", operations: ['+'], operandRange: { a: [1, 50], b: [1, 50] }, maxResult: 100, fiendType: "slimeling", fiendHP: 1, waveSize: 6, inputMode: "free-text" },

  // Chapter 2: Addition & Subtraction (Levels 11-20)  — 6–7 waves
  { level: 11, chapter: 2, chapterName: "Addition & Subtraction", operations: ['+', '-'], operandRange: { a: [5, 20], b: [1, 20] }, maxResult: 20, fiendType: "bonehead", fiendHP: 1, waveSize: 6, inputMode: "free-text" },
  { level: 12, chapter: 2, chapterName: "Addition & Subtraction", operations: ['+', '-'], operandRange: { a: [5, 20], b: [1, 20] }, maxResult: 20, fiendType: "bonehead", fiendHP: 1, waveSize: 6, inputMode: "free-text" },
  { level: 13, chapter: 2, chapterName: "Addition & Subtraction", operations: ['+', '-'], operandRange: { a: [5, 20], b: [1, 20] }, maxResult: 20, fiendType: "bonehead", fiendHP: 1, waveSize: 6, inputMode: "free-text" },
  { level: 14, chapter: 2, chapterName: "Addition & Subtraction", operations: ['+', '-'], operandRange: { a: [1, 30], b: [1, 30] }, maxResult: 30, fiendType: "bonehead", fiendHP: 1, waveSize: 6, inputMode: "free-text" },
  { level: 15, chapter: 2, chapterName: "Addition & Subtraction", operations: ['+', '-'], operandRange: { a: [1, 30], b: [1, 30] }, maxResult: 30, fiendType: "bonehead", fiendHP: 1, waveSize: 6, inputMode: "free-text" },
  { level: 16, chapter: 2, chapterName: "Addition & Subtraction", operations: ['+', '-'], operandRange: { a: [1, 30], b: [1, 30] }, maxResult: 30, fiendType: "bonehead", fiendHP: calculateFiendHP(16, 16), waveSize: 7, inputMode: "free-text" },
  { level: 17, chapter: 2, chapterName: "Addition & Subtraction", operations: ['+', '-'], operandRange: { a: [1, 100], b: [1, 100] }, maxResult: 100, fiendType: "bonehead", fiendHP: calculateFiendHP(17, 17), waveSize: 7, inputMode: "free-text" },
  { level: 18, chapter: 2, chapterName: "Addition & Subtraction", operations: ['+', '-'], operandRange: { a: [1, 100], b: [1, 100] }, maxResult: 100, fiendType: "bonehead", fiendHP: calculateFiendHP(18, 18), waveSize: 7, inputMode: "free-text" },
  { level: 19, chapter: 2, chapterName: "Addition & Subtraction", operations: ['+', '-'], operandRange: { a: [1, 100], b: [1, 100] }, maxResult: 100, fiendType: "bonehead", fiendHP: calculateFiendHP(19, 19), waveSize: 7, inputMode: "free-text" },
  { level: 20, chapter: 2, chapterName: "Addition & Subtraction", operations: ['+', '-'], operandRange: { a: [1, 100], b: [1, 100] }, maxResult: 100, fiendType: "bonehead", fiendHP: calculateFiendHP(20, 20), waveSize: 7, inputMode: "free-text" },

  // Chapter 3: Multiplication (Levels 21-30)  — 7–8 waves
  { level: 21, chapter: 3, chapterName: "Multiplication", operations: ['*'], operandRange: { a: [1, 10], b: [2, 3] }, maxResult: 30, fiendType: "toadlord", fiendHP: calculateFiendHP(21, 21), waveSize: 7, inputMode: "free-text" },
  { level: 22, chapter: 3, chapterName: "Multiplication", operations: ['*'], operandRange: { a: [1, 10], b: [2, 3] }, maxResult: 30, fiendType: "toadlord", fiendHP: calculateFiendHP(22, 22), waveSize: 7, inputMode: "free-text" },
  { level: 23, chapter: 3, chapterName: "Multiplication", operations: ['*'], operandRange: { a: [1, 10], b: [2, 4] }, maxResult: 40, fiendType: "toadlord", fiendHP: 2, waveSize: 7, inputMode: "free-text" },
  { level: 24, chapter: 3, chapterName: "Multiplication", operations: ['*'], operandRange: { a: [1, 10], b: [2, 4] }, maxResult: 40, fiendType: "toadlord", fiendHP: 2, waveSize: 7, inputMode: "free-text" },
  { level: 25, chapter: 3, chapterName: "Multiplication", operations: ['*'], operandRange: { a: [1, 10], b: [2, 6] }, maxResult: 60, fiendType: "toadlord", fiendHP: 2, waveSize: 7, inputMode: "free-text" },
  { level: 26, chapter: 3, chapterName: "Multiplication", operations: ['*'], operandRange: { a: [1, 10], b: [2, 6] }, maxResult: 60, fiendType: "toadlord", fiendHP: 2, waveSize: 8, inputMode: "free-text" },
  { level: 27, chapter: 3, chapterName: "Multiplication", operations: ['*'], operandRange: { a: [1, 10], b: [2, 9] }, maxResult: 90, fiendType: "toadlord", fiendHP: 2, waveSize: 8, inputMode: "free-text" },
  { level: 28, chapter: 3, chapterName: "Multiplication", operations: ['*'], operandRange: { a: [1, 10], b: [2, 9] }, maxResult: 90, fiendType: "toadlord", fiendHP: 2, waveSize: 8, inputMode: "free-text" },
  { level: 29, chapter: 3, chapterName: "Multiplication", operations: ['*'], operandRange: { a: [2, 25], b: [2, 12] }, maxResult: 300, fiendType: "toadlord", fiendHP: 2, waveSize: 8, inputMode: "free-text" },
  { level: 30, chapter: 3, chapterName: "Multiplication", operations: ['*'], operandRange: { a: [2, 25], b: [2, 12] }, maxResult: 300, fiendType: "toadlord", fiendHP: 2, waveSize: 8, inputMode: "free-text" },

  // Chapter 4: All Operations (Levels 31-40)  — 8 waves
  { level: 31, chapter: 4, chapterName: "All Operations", operations: ['+', '-', '*', '/'], operandRange: { a: [1, 100], b: [2, 9] }, maxResult: 200, fiendType: "magelitch", fiendHP: calculateFiendHP(31, 31), waveSize: 8, inputMode: "free-text" },
  { level: 32, chapter: 4, chapterName: "All Operations", operations: ['+', '-', '*', '/'], operandRange: { a: [1, 100], b: [2, 9] }, maxResult: 200, fiendType: "magelitch", fiendHP: calculateFiendHP(32, 32), waveSize: 8, inputMode: "free-text" },
  { level: 33, chapter: 4, chapterName: "All Operations", operations: ['+', '-', '*', '/'], operandRange: { a: [1, 100], b: [2, 9] }, maxResult: 200, fiendType: "magelitch", fiendHP: calculateFiendHP(33, 33), waveSize: 8, inputMode: "free-text" },
  { level: 34, chapter: 4, chapterName: "All Operations", operations: ['+', '-', '*', '/'], operandRange: { a: [1, 200], b: [2, 12] }, maxResult: 500, fiendType: "magelitch", fiendHP: calculateFiendHP(34, 34), waveSize: 8, inputMode: "free-text" },
  { level: 35, chapter: 4, chapterName: "All Operations", operations: ['+', '-', '*', '/'], operandRange: { a: [1, 200], b: [2, 12] }, maxResult: 500, fiendType: "magelitch", fiendHP: calculateFiendHP(35, 35), waveSize: 8, inputMode: "free-text" },
  { level: 36, chapter: 4, chapterName: "All Operations", operations: ['+', '-', '*', '/'], operandRange: { a: [1, 200], b: [2, 12] }, maxResult: 500, fiendType: "magelitch", fiendHP: calculateFiendHP(36, 36), waveSize: 8, inputMode: "free-text" },
  { level: 37, chapter: 4, chapterName: "All Operations", operations: ['+', '-', '*', '/'], operandRange: { a: [1, 500], b: [2, 20] }, maxResult: 1000, fiendType: "magelitch", fiendHP: calculateFiendHP(37, 37), waveSize: 8, inputMode: "free-text" },
  { level: 38, chapter: 4, chapterName: "All Operations", operations: ['+', '-', '*', '/'], operandRange: { a: [1, 500], b: [2, 20] }, maxResult: 1000, fiendType: "magelitch", fiendHP: calculateFiendHP(38, 38), waveSize: 8, inputMode: "free-text" },
  { level: 39, chapter: 4, chapterName: "All Operations", operations: ['+', '-', '*', '/'], operandRange: { a: [1, 500], b: [2, 20] }, maxResult: 1000, fiendType: "magelitch", fiendHP: calculateFiendHP(39, 39), waveSize: 8, inputMode: "free-text" },
  { level: 40, chapter: 4, chapterName: "All Operations", operations: ['+', '-', '*', '/'], operandRange: { a: [1, 500], b: [2, 20] }, maxResult: 1000, fiendType: "magelitch", fiendHP: calculateFiendHP(40, 40), waveSize: 8, inputMode: "free-text" },
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
 * @param {number} levelIndex - 0-based level index (0-39)
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
    b = rng.nextInt(1, a); // b is always <= a
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

  // Generate distractors for multiple-choice levels
  let distractors = [];
  if (cfg.inputMode === "multiple-choice") {
    distractors = generateDistractors(answer, rng, cfg);
  }

  return {
    question,
    answer,
    distractors,
    operation
  };
}
