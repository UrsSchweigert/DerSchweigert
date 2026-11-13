import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FIRST_RUN_LEVEL,
  SPEEDRUN_STORAGE_KEY,
  TOTAL_RUN_LEVELS,
  createSpeedrunRecords,
  createSpeedrunTimer,
  formatRunClock,
  formatRunTime,
} from './speedrun.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    get size() { return map.size; },
  };
}

describe('speedrun formatting', () => {
  it('reads the clock in tenths and the records in milliseconds', () => {
    assert.equal(formatRunClock(0), '0:00.0');
    assert.equal(formatRunClock(83_456), '1:23.4');
    assert.equal(formatRunClock(3_723_456), '1:02:03.4');
    assert.equal(formatRunTime(0), '0:00.000');
    assert.equal(formatRunTime(83_456), '1:23.456');
    assert.equal(formatRunTime(3_723_456), '1:02:03.456');
  });

  it('treats nonsense as zero rather than printing NaN', () => {
    for (const value of [null, undefined, Number.NaN, -1, Infinity, '12']) {
      assert.equal(formatRunClock(value), '0:00.0');
      assert.equal(formatRunTime(value), '0:00.000');
    }
  });
});

describe('the continuous run', () => {
  it('only begins at level 1 and follows the levels in order', () => {
    const timer = createSpeedrunTimer();
    assert.equal(timer.start(5), false, 'a jump into the middle is not a run');
    assert.equal(timer.active, false);

    assert.equal(timer.start(FIRST_RUN_LEVEL), true);
    timer.tick(10);
    const split = timer.completeLevel();
    assert.equal(split.level, 1);
    assert.equal(split.levelMs, 10_000);
    assert.equal(split.final, false);

    assert.equal(timer.start(2), true, 'the next level continues the same run');
    timer.tick(4);
    const second = timer.completeLevel();
    assert.equal(second.levelMs, 4_000, 'the level split restarts');
    assert.equal(second.runMs, 14_000, 'the run total keeps going');
  });

  it('ends on a replay, a jump or leaving, and never silently continues', () => {
    const timer = createSpeedrunTimer();
    timer.start(1);
    timer.tick(3);
    timer.completeLevel();
    assert.equal(timer.start(1), true, 'a replay of level 1 starts a fresh run');
    assert.equal(timer.snapshot().runMs, 0);

    timer.tick(2);
    timer.completeLevel();
    assert.equal(timer.start(7), false, 'skipping ahead is not the same run');
    assert.equal(timer.active, false);

    timer.start(1);
    timer.tick(1);
    assert.equal(timer.abandon(), true);
    assert.equal(timer.active, false);
    assert.equal(timer.abandon(), false, 'abandoning twice changes nothing');
  });

  it('freezes while the level-clear card is up', () => {
    const timer = createSpeedrunTimer();
    timer.start(1);
    timer.tick(2);
    timer.completeLevel();
    assert.equal(timer.tick(5), false, 'time only runs inside a level');
    assert.equal(timer.snapshot().runMs, 2_000);

    timer.start(2);
    timer.tick(1);
    assert.equal(timer.snapshot().runMs, 3_000, 'the frozen run picks up where it left off');
  });

  it('stops at level 60 and calls that run final', () => {
    const timer = createSpeedrunTimer();
    timer.start(1);
    for (let level = 1; level < TOTAL_RUN_LEVELS; level++) {
      timer.tick(1);
      const split = timer.completeLevel();
      assert.equal(split.final, false, `level ${level} is not the end`);
      assert.equal(timer.start(level + 1), true);
    }
    timer.tick(2);
    const last = timer.completeLevel();
    assert.equal(last.level, TOTAL_RUN_LEVELS);
    assert.equal(last.final, true);
    assert.equal(last.runMs, 61_000, 'every level counted once');
    assert.equal(timer.active, false, 'the run is over');
    assert.equal(timer.start(1), true, 'and a new one may begin');
  });

  it('ignores time that is not time', () => {
    const timer = createSpeedrunTimer();
    timer.start(1);
    for (const value of [0, -1, Number.NaN, Infinity, '4', null, undefined]) {
      assert.equal(timer.tick(value), false);
    }
    assert.equal(timer.snapshot().runMs, 0);
    assert.equal(timer.tick(2.5), true);
    assert.equal(timer.snapshot().runMs, 2_500);
  });

  it('refuses a level that is not a whole number', () => {
    const timer = createSpeedrunTimer();
    assert.throws(() => timer.start(1.5), TypeError);
    assert.throws(() => timer.start('1'), TypeError);
  });
});

describe('speedrun records', () => {
  it('keeps the fastest time per level and the fastest finished run', () => {
    const storage = fakeStorage();
    const records = createSpeedrunRecords({ storage, now: () => Date.parse('2026-11-13T10:00:00Z') });

    assert.equal(records.bestForLevel(3), null);
    assert.equal(records.recordLevel(3, 42_000), true);
    assert.equal(records.recordLevel(3, 45_000), false, 'a slower time does not replace it');
    assert.equal(records.bestForLevel(3), 42_000);
    assert.equal(records.recordLevel(3, 40_000), true);
    assert.equal(records.bestForLevel(3), 40_000);
    assert.equal(records.recordLevel(1, 1000), true);
    assert.deepEqual(records.levelBests(), [{ level: 1, ms: 1000 }, { level: 3, ms: 40_000 }]);

    assert.equal(records.bestRun, null);
    assert.equal(records.recordRun(900_000), true);
    assert.deepEqual(records.bestRun, { totalMs: 900_000, at: '2026-11-13T10:00:00.000Z' });
    assert.equal(records.recordRun(950_000), false);
    assert.equal(records.bestRun.totalMs, 900_000);
  });

  it('survives a reload', () => {
    const storage = fakeStorage();
    const first = createSpeedrunRecords({ storage });
    first.recordLevel(7, 12_345);
    first.recordRun(777_777);
    first.setEnabled(true);

    const second = createSpeedrunRecords({ storage });
    assert.equal(second.enabled, true);
    assert.equal(second.bestForLevel(7), 12_345);
    assert.equal(second.bestRun.totalMs, 777_777);
  });

  it('starts empty from a corrupt or blocked store instead of throwing', () => {
    const broken = fakeStorage({ [SPEEDRUN_STORAGE_KEY]: '{not json' });
    const fromBroken = createSpeedrunRecords({ storage: broken });
    assert.equal(fromBroken.bestRun, null);
    assert.deepEqual(fromBroken.levelBests(), []);

    const hostile = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    };
    const blocked = createSpeedrunRecords({ storage: hostile });
    assert.equal(blocked.recordLevel(1, 1000), true, 'a blocked store still works in memory');
    assert.equal(blocked.bestForLevel(1), 1000);
    assert.equal(blocked.setEnabled(true), true);

    const none = createSpeedrunRecords({ storage: null });
    assert.equal(none.bestRun, null);
  });

  it('ignores levels and times that could never be real', () => {
    const storage = fakeStorage({
      [SPEEDRUN_STORAGE_KEY]: JSON.stringify({
        levels: { 0: 1000, 61: 1000, 4: -3, 5: 'fast', 6: 5000 },
        bestRun: { totalMs: Number.NaN },
      }),
    });
    const records = createSpeedrunRecords({ storage });
    assert.deepEqual(records.levelBests(), [{ level: 6, ms: 5000 }]);
    assert.equal(records.bestRun, null);
    assert.equal(records.recordLevel(0, 1000), false);
    assert.equal(records.recordLevel(2, Number.NaN), false);
  });
});
