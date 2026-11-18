import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDragonBreath, createAnswerClock, countDragonRemainingEncounters, isResolvedFiend } from './encounter-flow.js';

test('a fiend blown at the camera is resolved, so it stops holding the wave open', () => {
  // Wind and storm leave the fiend alive in state 'idle' for the length of its
  // flight to the viewer. Treating that as "still on the field" is what made a
  // level whose last encounter was blown away run on with no fiend and no way
  // to conclude.
  const flying = { hp: 1, state: 'idle', isDead: false, isLeaving: true };
  assert.equal(isResolvedFiend(flying), true);
  assert.equal(countDragonRemainingEncounters({ fiends: [flying] }), 0,
    'a blown fiend is not a remaining encounter the dragon still has to clear');

  const walking = { hp: 1, state: 'walk', isDead: false };
  assert.equal(isResolvedFiend(walking), false);
  assert.equal(isResolvedFiend({ hp: 0, state: 'death' }), true, 'dead is resolved');
  assert.equal(isResolvedFiend({ hp: 1, state: 'retreat' }), true, 'walking off is resolved');
  assert.equal(isResolvedFiend(null), true);
});

test('dragon counts only present live combat enemies, retaining retreating corrections and queues', () => {
  const enemy = (state = 'idle') => ({ hp: 4, state, setState(value) { this.state = value; } });
  const current = enemy();
  const retreating = enemy('retreat');
  const dead = enemy('death');
  const queue = [1, 2];
  const requeued = [retreating];
  assert.equal(resolveDragonBreath([current, retreating, dead]), 1);
  assert.equal(current.hp, 0);
  assert.equal(resolveDragonBreath([current, retreating, dead]), 0);
  assert.equal(retreating.hp, 4);
  assert.deepEqual(queue, [1, 2]);
  assert.deepEqual(requeued, [retreating]);
});

test('answer latency excludes pauses, animation and inactive periods and resets per question', () => {
  const clock = createAnswerClock();
  clock.advance(2, true);
  clock.advance(60, false);
  assert.equal(clock.read(), 2);
  clock.reset();
  assert.equal(clock.read(), 0);
  assert.throws(() => clock.advance(-1, true), TypeError);
});
