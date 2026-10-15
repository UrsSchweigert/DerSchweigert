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

function generateDistractors(answer, rng, cfg) {
  const range = Math.max(3, Math.floor(cfg.maxResult * 0.3));
  const plausMin = Math.max(0, answer - range);
  const plausMax = answer + range;
  const candidates = new Set();
  candidates.add(answer + (rng.next() % 2 === 0 ? 1 : -1));
  const mult = 2 + (rng.next() % 4);
  candidates.add(answer + (rng.next() % 2 === 0 ? mult : -mult));
  candidates.add(rng.nextInt(plausMin, plausMax));
  candidates.delete(answer);
  let attempts = 0;
  while (candidates.size < 3 && attempts < 50) {
    const value = rng.nextInt(plausMin, plausMax);
    if (value !== answer) candidates.add(value);
    attempts++;
  }
  for (let off = 1; candidates.size < 3; off++) candidates.add(answer + off);
  return [...candidates].slice(0, 3);
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

  const rng = lcg(rngSeed);
  const operation = cfg.operations[rng.next() % cfg.operations.length];
  let a, b, answer, question;
  if (operation === '+') {
    a = rng.nextInt(...cfg.operandRange.a);
    b = rng.nextInt(...cfg.operandRange.b);
    answer = a + b;
    question = `${a} + ${b} = ?`;
  } else if (operation === '-') {
    a = rng.nextInt(...cfg.operandRange.a);
    b = rng.nextInt(1, a);
    answer = a - b;
    question = `${a} - ${b} = ?`;
  } else if (operation === '*') {
    a = rng.nextInt(...cfg.operandRange.a);
    b = rng.nextInt(...cfg.operandRange.b);
    answer = a * b;
    question = `${a} × ${b} = ?`;
  } else if (operation === '/') {
    answer = rng.nextInt(...cfg.operandRange.a);
    b = rng.nextInt(...cfg.operandRange.b);
    a = answer * b;
    question = `${a} ÷ ${b} = ?`;
  } else {
    throw new Error('Unknown operation');
  }
  return {
    question, answer, operation,
    distractors: cfg.inputMode === 'multiple-choice' ? generateDistractors(answer, rng, cfg) : [],
  };
}
