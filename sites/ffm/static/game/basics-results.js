// The local record of finished Basics Math runs. Practice is deliberately
// unscored and this module keeps it that way: nothing here talks to the API,
// it only remembers, per player, how many problems were solved and when.
//
// A record answers "how much did I do, when": the exercise set, the problems
// solved, how long the run lasted and the finish time (to the minute). Storage
// is whatever the caller passes (localStorage on the web and inside the app's
// web view); a missing or broken store degrades to "no history", never a crash.

export const BASICS_RESULTS_PREFIX = 'arithmoslayer:basics-results';
export const BASICS_DURATION_PREFIX = 'arithmoslayer:basics-duration';
export const BASICS_TABLES_PREFIX = 'arithmoslayer:basics-tables';
/** Enough to look back over a few weeks without growing without bound. */
export const BASICS_RESULTS_LIMIT = 50;

const ownerKey = (prefix, ownerId) => `${prefix}:${String(ownerId || 'guest')}`;

function isResult(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && typeof value.setId === 'string' && value.setId.length > 0
    && Number.isSafeInteger(value.solved) && value.solved >= 0
    && Number.isSafeInteger(value.minutes) && value.minutes > 0
    && typeof value.completed === 'boolean'
    && (value.tables === undefined || (Array.isArray(value.tables)
      && value.tables.every((table) => Number.isSafeInteger(table) && table > 0)))
    && typeof value.finishedAt === 'string'
    && !Number.isNaN(Date.parse(value.finishedAt));
}

function readRaw(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Finished runs, newest first; unreadable or foreign entries are dropped. */
export function readBasicsResults(storage, ownerId) {
  return readRaw(storage, ownerKey(BASICS_RESULTS_PREFIX, ownerId))
    .filter(isResult)
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
    .slice(0, BASICS_RESULTS_LIMIT);
}

/** Store one finished run and return the new list. A failed write still returns the list. */
export function recordBasicsResult(storage, ownerId, entry) {
  if (!isResult(entry)) throw new TypeError('A finished Basics Math run is required');
  const list = [{
    setId: entry.setId,
    solved: entry.solved,
    minutes: entry.minutes,
    completed: entry.completed,
    tables: [...(entry.tables ?? [])],
    finishedAt: new Date(entry.finishedAt).toISOString(),
  }, ...readBasicsResults(storage, ownerId)].slice(0, BASICS_RESULTS_LIMIT);
  try {
    storage?.setItem?.(ownerKey(BASICS_RESULTS_PREFIX, ownerId), JSON.stringify(list));
  } catch {
    // A full or blocked store loses this record, not the game.
  }
  return list;
}

/** The tables a player picked for one set, or null when they never picked any. */
export function readBasicsTables(storage, ownerId, setId) {
  try {
    const raw = storage?.getItem?.(ownerKey(`${BASICS_TABLES_PREFIX}:${setId}`, ownerId));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return null;
    const tables = parsed.filter((table) => Number.isSafeInteger(table) && table > 0);
    return tables.length ? tables : null;
  } catch {
    return null;
  }
}

export function writeBasicsTables(storage, ownerId, setId, tables) {
  if (!Array.isArray(tables) || !tables.every((table) => Number.isSafeInteger(table) && table > 0)) {
    throw new TypeError('A list of positive tables is required');
  }
  try {
    storage?.setItem?.(ownerKey(`${BASICS_TABLES_PREFIX}:${setId}`, ownerId), JSON.stringify([...new Set(tables)]));
  } catch {
    // The choice is a convenience; the run still uses it.
  }
}

export function readBasicsDuration(storage, ownerId) {
  try {
    const value = Number(storage?.getItem?.(ownerKey(BASICS_DURATION_PREFIX, ownerId)));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeBasicsDuration(storage, ownerId, minutes) {
  if (!Number.isSafeInteger(minutes) || minutes <= 0) throw new TypeError('A positive run length is required');
  try {
    storage?.setItem?.(ownerKey(BASICS_DURATION_PREFIX, ownerId), String(minutes));
  } catch {
    // Remembering the choice is a convenience; the run still uses it.
  }
}

/**
 * "28.11. 11:07" — day, month, hour and minute in local time. Minute accuracy
 * is all a practice record needs, and the numeric form reads the same in
 * German and English, so the line never needs a locale-specific format.
 */
export function formatBasicsResultTime(finishedAt) {
  const date = new Date(finishedAt);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}. ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "14:32" — the run clock, whole seconds. */
export function formatBasicsCountdown(remainingMs) {
  const total = Math.max(0, Math.ceil(Number(remainingMs) / 1000) || 0);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/** One history line; `nameForSet` names the set in the player's language. */
export function formatBasicsResult(entry, { translate, nameForSet }) {
  const line = translate(entry.completed ? 'practice.resultLine' : 'practice.resultLineStopped', {
    when: formatBasicsResultTime(entry.finishedAt),
    set: nameForSet(entry.setId),
    solved: entry.solved,
    minutes: entry.minutes,
  });
  const tables = Array.isArray(entry.tables) ? entry.tables : [];
  if (tables.length === 0) return line;
  return `${line} · ${translate('practice.resultTables', { tables: tables.join(', ') })}`;
}
