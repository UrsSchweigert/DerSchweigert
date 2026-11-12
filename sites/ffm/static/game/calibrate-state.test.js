// calibrate-state.test.js — the pure logic behind calibrate.html: validation,
// persistence and the merge the copy button emits. No DOM, no canvas, no file
// access; the module is imported directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  GROUND_Y_CEILING,
  GROUND_Y_FLOOR,
  clampGroundY,
  effectiveGroundOverrides,
  groundSnippet,
  groundStats,
  levelMarker,
  nextUntunedLevel,
  parseStoredOverrides,
  serializeOverrides,
} = await import('./calibrate-state.js');

const LEVELS = [1, 2, 3, 4];

test('clampGroundY rounds into the band the game accepts and rejects junk', () => {
  assert.equal(clampGroundY(360), 360);
  assert.equal(clampGroundY('348.6'), 349);
  assert.equal(clampGroundY(GROUND_Y_FLOOR - 50), GROUND_Y_FLOOR);
  assert.equal(clampGroundY(GROUND_Y_CEILING + 50), GROUND_Y_CEILING);
  assert.equal(clampGroundY(Number.NaN), null);
  assert.equal(clampGroundY('abc'), null);
  assert.equal(clampGroundY(undefined), null);
});

test('parseStoredOverrides keeps usable tuning and drops everything else', () => {
  assert.deepEqual(parseStoredOverrides('{"1":340,"2":349.4,"3":10,"9":300,"x":320}', LEVELS), { 1: 340, 2: 349 });
  assert.deepEqual(parseStoredOverrides('{"01":340}', LEVELS), {}, 'padded keys are not level numbers');
  assert.deepEqual(parseStoredOverrides('', LEVELS), {});
  assert.deepEqual(parseStoredOverrides('not json', LEVELS), {});
  assert.deepEqual(parseStoredOverrides('[1,2]', LEVELS), {});
  assert.deepEqual(parseStoredOverrides('null', LEVELS), {});
});

test('serializeOverrides round-trips in level order and clears to empty', () => {
  assert.equal(serializeOverrides({ 4: 350, 1: 340 }), '{"1":340,"4":350}');
  assert.equal(serializeOverrides({}), '');
  assert.deepEqual(parseStoredOverrides(serializeOverrides({ 2: 344 }), LEVELS), { 2: 344 });
});

test('effectiveGroundOverrides merges session over committed and hides the default', () => {
  const merged = effectiveGroundOverrides({
    levels: LEVELS,
    tuned: { 1: 350 },
    committed: { 1: 344, 3: 340 },
    defaultY: 360,
  });
  assert.deepEqual(merged, [
    { level: 1, y: 350 },
    { level: 3, y: 340 },
  ], 'the session value wins, the committed one survives, defaults are omitted');
});

test('a level tuned back to the default disappears from the emitted block', () => {
  const merged = effectiveGroundOverrides({ levels: LEVELS, tuned: { 3: 360 }, committed: { 3: 340 }, defaultY: 360 });
  assert.deepEqual(merged, [], 'setting a committed override to the default removes it');
});

test('groundSnippet formats the manifest block and its empty case', () => {
  assert.equal(groundSnippet([{ level: 31, y: 348 }, { level: 48, y: 372 }]), '"groundY": {\n    "31": 348,\n    "48": 372\n  }');
  assert.equal(groundSnippet([]), '"groundY": {}');
});

test('nextUntunedLevel skips tuned and committed levels and wraps once', () => {
  assert.equal(nextUntunedLevel(LEVELS, 1, {}, {}), 2);
  assert.equal(nextUntunedLevel(LEVELS, 1, { 2: 340 }, {}), 3);
  assert.equal(nextUntunedLevel(LEVELS, 1, { 2: 340 }, { 3: 340 }), 4);
  assert.equal(nextUntunedLevel(LEVELS, 4, {}, {}), 1, 'wraps around');
  assert.equal(nextUntunedLevel(LEVELS, 1, { 1: 340, 2: 340, 3: 340 }, { 4: 340 }), null, 'nothing left');
  assert.equal(nextUntunedLevel([], 1, {}, {}), null);
});

test('groundStats separates local tuning from committed values', () => {
  assert.deepEqual(groundStats(LEVELS, { 1: 350 }, { 1: 344, 2: 340 }), { total: 4, tuned: 1, committed: 2, remaining: 2 });
  assert.deepEqual(groundStats([], {}, {}), { total: 0, tuned: 0, committed: 0, remaining: 0 });
});

test('levelMarker distinguishes a session edit from a committed override', () => {
  assert.equal(levelMarker(1, { 1: 350 }, { 1: 344 }), '✎');
  assert.equal(levelMarker(2, {}, { 2: 344 }), '●');
  assert.equal(levelMarker(3, {}, {}), '');
});
