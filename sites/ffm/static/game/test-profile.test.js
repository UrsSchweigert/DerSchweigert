// test-profile.test.js — the "unlocked" level-test hatch.
//
// The rule it protects: every level is reachable for a profile named
// "unlocked", but only in the app and only on a device whose unlock is paid
// for. Everything else keeps the usual continuation-only Levels page.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isLevelTestProfile, levelAvailability, TEST_PROFILE_NAME } from './test-profile.js';
import { buildLevelGridEntries } from './level-grid.js';

describe('the level-test profile', () => {
  const paid = { isApp: true, premiumAccess: true };

  it('is the profile literally named "unlocked" on a paid app device', () => {
    assert.equal(TEST_PROFILE_NAME, 'unlocked');
    assert.equal(isLevelTestProfile({ ...paid, profileName: 'unlocked' }), true);
  });

  it('ignores the player\'s capitals and stray spaces', () => {
    assert.equal(isLevelTestProfile({ ...paid, profileName: 'Unlocked' }), true);
    assert.equal(isLevelTestProfile({ ...paid, profileName: '  UNLOCKED ' }), true);
  });

  it('leaves every other name alone', () => {
    for (const profileName of ['unlocked2', 'not unlocked', 'unlock', '', null, undefined, 42]) {
      assert.equal(isLevelTestProfile({ ...paid, profileName }), false, `${profileName} is not the test profile`);
    }
  });

  it('needs the paid unlock, so it is never a way around the store', () => {
    assert.equal(isLevelTestProfile({ isApp: true, premiumAccess: false, profileName: 'unlocked' }), false);
    assert.equal(isLevelTestProfile({ isApp: true, profileName: 'unlocked' }), false);
  });

  it('is app-only: the website has no local profiles and never gets it', () => {
    assert.equal(isLevelTestProfile({ isApp: false, premiumAccess: true, profileName: 'unlocked' }), false);
  });
});

describe('what the Levels page offers', () => {
  it('offers the cleared levels as usual when the hatch is off', () => {
    const cleared = [1, 2, 3];
    assert.equal(levelAvailability({ testProfile: false, cleared, total: 60 }), cleared);
  });

  it('offers every curriculum level when it is on', () => {
    const all = levelAvailability({ testProfile: true, cleared: [1, 2], total: 60 });
    assert.equal(all.length, 60);
    assert.equal(all[0], 1);
    assert.equal(all[59], 60);
  });

  it('gives the grid one default tile, 59 available tiles and no locked tiles', () => {
    const levels = levelAvailability({ testProfile: true, cleared: [], total: 60 });
    const entries = buildLevelGridEntries({ total: 60, defaultLevel: 7, available: levels });
    assert.equal(entries.length, 60);
    assert.equal(entries.filter((entry) => entry.state === 'default').length, 1);
    assert.equal(entries.filter((entry) => entry.state === 'available').length, 59);
    assert.equal(entries.filter((entry) => entry.state === 'locked').length, 0,
      'nothing is locked, so every level is one tap away');
  });

  it('still reports nothing for an empty curriculum instead of inventing levels', () => {
    assert.deepEqual(levelAvailability({ testProfile: true, cleared: [], total: 0 }), []);
  });
});
