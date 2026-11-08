import { generateProblem } from './levels.js';

const SKILL_INTROS = {
  5: {
    operation: '-',
    operands: { a: 8, b: 3 },
    answer: 5,
    ranges: { a: [8, 8], b: [3, 3] },
    slug: 'subtraction',
  },
  25: {
    operation: '*',
    operands: { a: 5, b: 3 },
    answer: 15,
    ranges: { a: [5, 5], b: [3, 3] },
    slug: 'multiplication',
  },
  34: {
    operation: '/',
    operands: { a: 5, b: 4 },
    answer: 5,
    ranges: { a: [5, 5], b: [4, 4] },
    slug: 'division',
  },
};

export function getSkillIntro(level) {
  if (!Number.isInteger(level) || level < 1 || level > 60) {
    throw new RangeError('Level must be between 1 and 60');
  }
  const intro = SKILL_INTROS[level];
  if (!intro) return null;

  const { a, b } = intro.operands;
  const values = {
    a,
    b,
    answer: intro.answer,
  };
  const localizationKey = `skillIntro.${intro.slug}`;
  const exampleProblem = generateProblem(level - 1, 2025, {
    level,
    operations: [intro.operation],
    operandRange: intro.ranges,
    maxResult: intro.answer,
  });

  return {
    level,
    operation: intro.operation,
    localizationKey,
    stages: [
      {
        type: 'explanation',
        localizationKey: `${localizationKey}.explanation`,
        values,
      },
      {
        type: 'worked-example',
        localizationKey: `${localizationKey}.workedExample`,
        values,
      },
    ],
    exampleProblem,
    timed: false,
    untimed: true,
  };
}
