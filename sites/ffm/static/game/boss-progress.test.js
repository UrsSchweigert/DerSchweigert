import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOSS_RESULTS_KEY,
  crownCount,
  defeatedBossIds,
  readBossResults,
  recordBossResult,
  writeBossResults,
} from './boss-progress.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    dump: () => Object.fromEntries(map),
  };
}

describe('recordBossResult', () => {
  it('keeps the best crowns and score, and counts attempts', () => {
    let results = recordBossResult({}, { bossId: 'warden-dawn', crowns: 2, score: 1000, accuracy: 0.8 });
    results = recordBossResult(results, { bossId: 'warden-dawn', crowns: 1, score: 500, accuracy: 0.6 });
    assert.deepEqual(results['warden-dawn'], {
      cleared: true,
      crowns: 2,
      bestScore: 1000,
      bestAccuracy: 0.8,
      attempts: 2,
    });
    results = recordBossResult(results, { bossId: 'warden-dawn', crowns: 3, score: 2000, accuracy: 0.95 });
    assert.equal(results['warden-dawn'].crowns, 3);
    assert.equal(results['warden-dawn'].bestScore, 2000);
    assert.equal(results['warden-dawn'].attempts, 3);
  });

  it('leaves other bosses alone', () => {
    const results = {
      'warden-dawn': { cleared: true, crowns: 3, bestScore: 10, bestAccuracy: 1, attempts: 1 },
    };
    const next = recordBossResult(results, { bossId: 'warden-harvest', crowns: 1, score: 5, accuracy: 0.6 });
    assert.deepEqual(next['warden-dawn'], results['warden-dawn']);
    assert.deepEqual(defeatedBossIds(next), ['warden-dawn', 'warden-harvest']);
  });

  it('rejects a result without a boss', () => {
    assert.throws(() => recordBossResult({}, { crowns: 3 }), TypeError);
    assert.throws(() => recordBossResult({}, { bossId: '' }), TypeError);
  });
});

describe('storage', () => {
  it('round-trips through a store', () => {
    const storage = fakeStorage();
    const results = recordBossResult({}, { bossId: 'warden-dawn', crowns: 3, score: 42, accuracy: 1 });
    assert.equal(writeBossResults(results, storage), true);
    assert.ok(BOSS_RESULTS_KEY in storage.dump());
    assert.deepEqual(readBossResults(storage), results);
  });

  it('survives missing, corrupt or hostile stored values', () => {
    assert.deepEqual(readBossResults(fakeStorage()), {});
    assert.deepEqual(readBossResults(fakeStorage({ [BOSS_RESULTS_KEY]: '{not json' })), {});
    assert.deepEqual(readBossResults(fakeStorage({ [BOSS_RESULTS_KEY]: '[1,2,3]' })), {});
    assert.deepEqual(readBossResults(fakeStorage({ [BOSS_RESULTS_KEY]: 'null' })), {});
    const throwing = { getItem() { throw new Error('denied'); } };
    assert.deepEqual(readBossResults(throwing), {});
  });

  it('reports a write it could not make instead of claiming success', () => {
    const throwing = { setItem() { throw new Error('quota'); } };
    assert.equal(writeBossResults({}, throwing), false);
  });

  it('counts only cleared bosses', () => {
    assert.equal(crownCount({}), 0);
    assert.equal(
      crownCount({ a: { cleared: true, crowns: 3 }, b: { cleared: false, crowns: 2 }, c: { cleared: true, crowns: 1 } }),
      4,
    );
    assert.deepEqual(defeatedBossIds({ a: { cleared: false }, b: { cleared: true } }), ['b']);
  });
});
