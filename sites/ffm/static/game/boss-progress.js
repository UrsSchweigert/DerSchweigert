// boss-progress.js — Warden results that outlive a session.
//
// One record per boss: the best crown count and best score ever earned, and how
// many attempts it took. Keeping the best rather than the latest means a bad
// replay never erases a good fight. Reading and writing are guarded so the pure
// merge logic runs (and is tested) without a browser.

export const BOSS_RESULTS_KEY = 'ffm_boss_results';

function storageOf(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readBossResults(storage) {
  const store = storageOf(storage);
  if (!store) return {};
  try {
    const raw = store.getItem(BOSS_RESULTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function writeBossResults(results, storage) {
  const store = storageOf(storage);
  if (!store) return false;
  try {
    store.setItem(BOSS_RESULTS_KEY, JSON.stringify(results));
    return true;
  } catch {
    return false;
  }
}

/**
 * Fold one finished fight into the results. Crowns and score only ever move up;
 * `cleared` latches once it is true.
 */
export function recordBossResult(results = {}, { bossId, crowns = 0, score = 0, accuracy = 0 } = {}) {
  if (typeof bossId !== 'string' || bossId.length === 0) {
    throw new TypeError('A boss result needs a boss id');
  }
  const previous = results[bossId] ?? {};
  return {
    ...results,
    [bossId]: {
      cleared: true,
      crowns: Math.max(previous.crowns ?? 0, crowns),
      bestScore: Math.max(previous.bestScore ?? 0, score),
      bestAccuracy: Math.max(previous.bestAccuracy ?? 0, accuracy),
      attempts: (previous.attempts ?? 0) + 1,
    },
  };
}

/** Boss ids whose fight has already been won, in the order they are stored. */
export function defeatedBossIds(results = {}) {
  return Object.entries(results)
    .filter(([, result]) => result?.cleared === true)
    .map(([bossId]) => bossId);
}

export function crownCount(results = {}) {
  return Object.values(results)
    .filter(result => result?.cleared === true)
    .reduce((sum, result) => sum + (result.crowns ?? 0), 0);
}
