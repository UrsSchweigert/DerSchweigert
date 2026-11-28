import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASICS_RESULTS_LIMIT,
  formatBasicsCountdown,
  formatBasicsResult,
  formatBasicsResultTime,
  readBasicsDuration,
  readBasicsResults,
  readBasicsTables,
  recordBasicsResult,
  writeBasicsDuration,
  writeBasicsTables,
} from './basics-results.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    data,
  };
}

const run = (overrides = {}) => ({
  setId: 'tables-1-10',
  solved: 23,
  minutes: 15,
  completed: true,
  tables: [],
  finishedAt: '2026-11-28T10:07:31.000Z',
  ...overrides,
});

test('a finished run keeps its set, solved count, length and finish time', () => {
  const storage = memoryStorage();
  const list = recordBasicsResult(storage, 'player-1', run());
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(),
    ['completed', 'finishedAt', 'minutes', 'setId', 'solved', 'tables']);
  assert.deepEqual(readBasicsResults(storage, 'player-1'), list);
});

test('runs are listed newest first and histories stay separate per player', () => {
  const storage = memoryStorage();
  recordBasicsResult(storage, 'mia', run({ finishedAt: '2026-11-01T08:00:00.000Z', solved: 5 }));
  recordBasicsResult(storage, 'mia', run({ finishedAt: '2026-11-20T08:00:00.000Z', solved: 8 }));
  recordBasicsResult(storage, 'noah', run({ finishedAt: '2026-11-10T08:00:00.000Z', solved: 30 }));

  assert.deepEqual(readBasicsResults(storage, 'mia').map((entry) => entry.solved), [8, 5]);
  assert.deepEqual(readBasicsResults(storage, 'noah').map((entry) => entry.solved), [30]);
  assert.deepEqual(readBasicsResults(storage, 'guest'), []);
});

test('the history is capped and drops entries that are not runs', () => {
  const storage = memoryStorage();
  for (let index = 0; index < BASICS_RESULTS_LIMIT + 5; index++) {
    recordBasicsResult(storage, 'mia', run({ finishedAt: new Date(2026, 0, 1, 0, index).toISOString() }));
  }
  assert.equal(readBasicsResults(storage, 'mia').length, BASICS_RESULTS_LIMIT);

  storage.setItem('arithmoslayer:basics-results:mia', JSON.stringify([
    { nope: true }, null, run({ setId: 'tables-1-15', finishedAt: 'not a date' }), run(),
  ]));
  const kept = readBasicsResults(storage, 'mia');
  assert.equal(kept.length, 1);
  assert.equal(kept[0].setId, 'tables-1-10');
});

test('a broken or missing store degrades to no history instead of throwing', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(readBasicsResults(broken, 'mia'), []);
  assert.equal(readBasicsDuration(broken, 'mia'), null);
  assert.doesNotThrow(() => recordBasicsResult(broken, 'mia', run()));
  assert.doesNotThrow(() => writeBasicsDuration(broken, 'mia', 20));
  assert.deepEqual(readBasicsResults(null, 'mia'), []);
  const corrupt = memoryStorage();
  corrupt.setItem('arithmoslayer:basics-results:mia', '{not json');
  assert.deepEqual(readBasicsResults(corrupt, 'mia'), []);
});

test('an incomplete record is rejected before it is stored', () => {
  const storage = memoryStorage();
  for (const bad of [
    run({ setId: '' }), run({ solved: -1 }), run({ minutes: 0 }),
    run({ completed: 'yes' }), run({ finishedAt: 'yesterday' }), null,
  ]) {
    assert.throws(() => recordBasicsResult(storage, 'mia', bad), TypeError);
  }
  assert.deepEqual(readBasicsResults(storage, 'mia'), []);
});

test('a mixed run keeps the chosen tables and older records still read', () => {
  const storage = memoryStorage();
  recordBasicsResult(storage, 'mia', run({ tables: [3, 7, 9] }));
  assert.deepEqual(readBasicsResults(storage, 'mia')[0].tables, [3, 7, 9]);
  assert.throws(() => recordBasicsResult(storage, 'mia', run({ tables: [0] })), TypeError);
  assert.throws(() => recordBasicsResult(storage, 'mia', run({ tables: '3,7' })), TypeError);

  const legacy = run();
  delete legacy.tables;
  storage.setItem('arithmoslayer:basics-results:mia', JSON.stringify([legacy]));
  assert.equal(readBasicsResults(storage, 'mia').length, 1, 'a record without tables still counts');
});

test('the chosen mix is remembered per player and set, never invented', () => {
  const storage = memoryStorage();
  assert.equal(readBasicsTables(storage, 'mia', 'tables-1-10'), null);
  writeBasicsTables(storage, 'mia', 'tables-1-10', [3, 7, 3]);
  assert.deepEqual(readBasicsTables(storage, 'mia', 'tables-1-10'), [3, 7]);
  assert.equal(readBasicsTables(storage, 'mia', 'tables-1-15'), null, 'each set keeps its own mix');
  assert.equal(readBasicsTables(storage, 'noah', 'tables-1-10'), null);
  assert.throws(() => writeBasicsTables(storage, 'mia', 'tables-1-10', [0]), TypeError);
});

test('the chosen run length is remembered per player, never invented', () => {
  const storage = memoryStorage();
  assert.equal(readBasicsDuration(storage, 'mia'), null);
  writeBasicsDuration(storage, 'mia', 20);
  assert.equal(readBasicsDuration(storage, 'mia'), 20);
  assert.equal(readBasicsDuration(storage, 'noah'), null);
  assert.throws(() => writeBasicsDuration(storage, 'mia', 0), TypeError);
});

test('the recorded time is local day.month hour:minute', () => {
  const stamp = new Date(2026, 10, 8, 9, 5, 59).toISOString();
  assert.equal(formatBasicsResultTime(stamp), '08.11. 09:05');
  assert.equal(formatBasicsResultTime('nope'), '');
  assert.doesNotMatch(formatBasicsResultTime(stamp), /\d{2}:\d{2}:\d{2}/, 'seconds are not needed');
});

test('the run clock counts down as m:ss', () => {
  assert.equal(formatBasicsCountdown(15 * 60 * 1000), '15:00');
  assert.equal(formatBasicsCountdown(14 * 60 * 1000 + 32000), '14:32');
  assert.equal(formatBasicsCountdown(999), '0:01');
  assert.equal(formatBasicsCountdown(0), '0:00');
  assert.equal(formatBasicsCountdown(-5000), '0:00');
});

test('one history line names the set, the solved count, the length and the time', () => {
  const translate = (key, values) =>
    `${key}|${values.when}|${values.set}|${values.solved}|${values.minutes}`;
  const nameForSet = (id) => `set:${id}`;
  // Local wall-clock time, so the line reads the same in every CI time zone.
  const localRun = (overrides = {}) =>
    run({ finishedAt: new Date(2026, 10, 28, 11, 7).toISOString(), ...overrides });
  assert.equal(formatBasicsResult(localRun(), { translate, nameForSet }),
    'practice.resultLine|28.11. 11:07|set:tables-1-10|23|15');
  assert.equal(formatBasicsResult(localRun({ completed: false, minutes: 3 }), { translate, nameForSet }),
    'practice.resultLineStopped|28.11. 11:07|set:tables-1-10|23|3');
  const withTables = (key, values) => key === 'practice.resultTables'
    ? `tables:${values.tables}`
    : `${key}|${values.when}|${values.set}|${values.solved}|${values.minutes}`;
  assert.equal(formatBasicsResult(localRun({ tables: [3, 7] }), { translate: withTables, nameForSet }),
    'practice.resultLine|28.11. 11:07|set:tables-1-10|23|15 · tables:3, 7');
});
