// shapes.js — Pure, unit-testable problem generator for the "Shapes" game
// mode: instead of a math question, the player counts 1-6 runestones and picks
// the matching count from the multiple-choice buttons. Six is the most that fits
// one unbroken row in every header and bubble without scaling or wrapping.
// Mirrors levels.js's generateProblem shape (answer + distractors) so it
// plugs into the same MC answer-checking flow in main.js, just with
// displayMode: 'shapes' instead of a text question.

import { lcg } from './levels.js';

// Every counting visual is a small runestone (see runestone.js); there is no
// other shape any more, so the type only names what is drawn.
export const SHAPE_TYPES = ['runestone'];
export const MIN_SHAPE_COUNT = 1;
export const MAX_SHAPE_COUNT = 6;

/**
 * Generate 3 distinct distractor counts in [MIN_SHAPE_COUNT, MAX_SHAPE_COUNT],
 * none equal to `answer`.
 * @param {number} answer
 * @param {{nextInt: (min:number,max:number)=>number}} rng
 * @returns {number[]} exactly 3 distinct values
 */
export function generateShapeCountDistractors(answer, rng) {
  const candidates = new Set();
  let attempts = 0;
  while (candidates.size < 3 && attempts < 100) {
    const v = rng.nextInt(MIN_SHAPE_COUNT, MAX_SHAPE_COUNT);
    if (v !== answer) candidates.add(v);
    attempts++;
  }
  // Fallback (only reachable if the count range were absurdly small):
  // fill in with the smallest untaken in-range values.
  for (let v = MIN_SHAPE_COUNT; candidates.size < 3 && v <= MAX_SHAPE_COUNT; v++) {
    if (v !== answer) candidates.add(v);
  }
  return [...candidates].slice(0, 3);
}

/**
 * Generate a "Shapes" mode "count the shapes" problem.
 * @param {number} rngSeed
 * @returns {{ displayMode: 'shapes', shapeType: string, count: number, answer: number, distractors: number[] }}
 */
export function generateShapesProblem(rngSeed) {
  const rng = lcg(rngSeed);
  const shapeType = SHAPE_TYPES[rng.next() % SHAPE_TYPES.length];
  const count = rng.nextInt(MIN_SHAPE_COUNT, MAX_SHAPE_COUNT);
  const distractors = generateShapeCountDistractors(count, rng);
  return {
    displayMode: 'shapes',
    shapeType,
    count,
    answer: count,
    distractors,
  };
}
