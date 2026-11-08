import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSkillIntro } from './skill-intro.js';

describe('getSkillIntro', () => {
  it('provides two-stage subtraction practice at level 5 with five answer choices', () => {
    const intro = getSkillIntro(5);

    assert.equal(intro.operation, '-');
    assert.equal(intro.localizationKey, 'skillIntro.subtraction');
    assert.deepEqual(intro.stages.map(stage => stage.type), ['explanation', 'worked-example']);
    assert.equal(intro.stages[0].localizationKey, 'skillIntro.subtraction.explanation');
    assert.equal(intro.exampleProblem.question, '8 - 3 = ?');
    assert.equal(intro.exampleProblem.answer, 5);
    assert.equal(intro.exampleProblem.options.length, 5);
    assert.equal(intro.timed, false);
    assert.equal(intro.untimed, true);
  });

  it('provides a valid multiplication worked example at level 25 with ten choices', () => {
    const intro = getSkillIntro(25);

    assert.equal(intro.operation, '*');
    assert.equal(intro.exampleProblem.question, '5 × 3 = ?');
    assert.equal(intro.exampleProblem.answer, 15);
    assert.equal(intro.exampleProblem.options.length, 10);
    assert.equal(new Set(intro.exampleProblem.options).size, 10);
    assert.equal(intro.timed, false);
    assert.equal(intro.untimed, true);
  });

  it('provides exact division practice at level 34 with ten choices', () => {
    const intro = getSkillIntro(34);

    assert.equal(intro.operation, '/');
    assert.equal(intro.exampleProblem.question, '20 ÷ 4 = ?');
    assert.equal(intro.exampleProblem.answer, 5);
    assert.equal(intro.exampleProblem.a, intro.exampleProblem.answer * intro.exampleProblem.b);
    assert.equal(intro.exampleProblem.options.length, 10);
    assert.equal(intro.timed, false);
    assert.equal(intro.untimed, true);
  });

  it('returns no intro outside the planned skill milestones', () => {
    assert.equal(getSkillIntro(4), null);
    assert.equal(getSkillIntro(26), null);
  });

  it('rejects invalid level numbers', () => {
    for (const level of [0, 61, 1.5, '5', NaN]) {
      assert.throws(() => getSkillIntro(level), RangeError);
    }
  });
});
