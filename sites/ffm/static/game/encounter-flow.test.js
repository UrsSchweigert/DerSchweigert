import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDragonBreath, createAnswerClock } from './encounter-flow.js';

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
