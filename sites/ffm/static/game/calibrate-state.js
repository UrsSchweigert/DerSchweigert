// calibrate-state.js — the pure part of the ground calibrator (calibrate.html).
// Validation, persistence and the merge that the "copy" button emits live here so
// the session logic is testable without a browser: a calibration run spans 60
// levels and a lost value means redoing it by eye.
//
// Maps are plain objects keyed by level number ("31") with integer canvas-y
// values, which is also the shape of the manifest's "groundY" block.

// The band a standing sprite can occupy on the 800x450 canvas. level-art.js drops
// anything outside it rather than clamping, so the calibrator refuses the same
// values instead of offering something the game would ignore.
export const GROUND_Y_FLOOR = 240;
export const GROUND_Y_CEILING = 436;

export const STORAGE_KEY = 'ffm-calibrator-ground';

// Interactive stepping stops at the band edges (clamp); stored or committed data
// outside it is refused instead, because 240 is a legal line a user may not have
// chosen and silently snapping junk onto it would hide the mistake.
export function clampGroundY(value) {
  const number = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(GROUND_Y_CEILING, Math.max(GROUND_Y_FLOOR, Math.round(number)));
}

function storedGroundY(value) {
  const number = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(number)) return null;
  const y = Math.round(number);
  return y < GROUND_Y_FLOOR || y > GROUND_Y_CEILING ? null : y;
}

const isLevelKey = (key, levels) => levels.includes(Number(key)) && String(Number(key)) === String(key);

// Reads the tuning saved by a previous session. Anything unusable is dropped
// silently: a corrupt entry must not stop the calibrator from opening.
export function parseStoredOverrides(text, levels) {
  const overrides = {};
  if (typeof text !== 'string' || text.trim() === '') return overrides;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return overrides;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return overrides;
  for (const [key, value] of Object.entries(data)) {
    if (!isLevelKey(key, levels)) continue;
    const y = storedGroundY(value);
    if (y !== null) overrides[key] = y;
  }
  return overrides;
}

export function serializeOverrides(overrides) {
  const sorted = {};
  for (const key of Object.keys(overrides).sort((a, b) => Number(a) - Number(b))) {
    sorted[key] = overrides[key];
  }
  return Object.keys(sorted).length === 0 ? '' : JSON.stringify(sorted);
}

// What the manifest should contain once the tuning is pasted: the committed
// values, overridden by this session's, with levels at the default left out so
// pasting never drops an earlier override and never spells out a no-op.
export function effectiveGroundOverrides({ levels, tuned, committed, defaultY }) {
  return levels
    .map((level) => {
      const key = String(level);
      const y = tuned[key] ?? committed[key] ?? defaultY;
      return { level, y };
    })
    .filter((entry) => entry.y !== defaultY);
}

export function groundSnippet(entries) {
  if (entries.length === 0) return '"groundY": {}';
  const rows = entries.map(({ level, y }) => `    "${level}": ${y}`);
  return `"groundY": {\n${rows.join(',\n')}\n  }`;
}

// The next level still worth a look, or null when every level has a value:
// levels with neither a local nor a committed override, searched from `from`
// onwards and wrapping around once.
export function nextUntunedLevel(levels, from, tuned, committed) {
  const count = levels.length;
  if (count === 0) return null;
  const start = Math.max(0, levels.indexOf(Number(from)));
  for (let step = 1; step <= count; step++) {
    const level = levels[(start + step) % count];
    const key = String(level);
    if (tuned[key] === undefined && committed[key] === undefined) return level;
  }
  return null;
}

// `tuned` and `committed` are counted independently: re-tuning a level that
// already has a manifest value is still "in the manifest" until it is pasted.
export function groundStats(levels, tuned, committed) {
  let tunedCount = 0;
  let committedCount = 0;
  let remaining = 0;
  for (const level of levels) {
    const key = String(level);
    const isTuned = tuned[key] !== undefined;
    const isCommitted = committed[key] !== undefined;
    if (isTuned) tunedCount++;
    if (isCommitted) committedCount++;
    if (!isTuned && !isCommitted) remaining++;
  }
  return { total: levels.length, tuned: tunedCount, committed: committedCount, remaining };
}

// A marker shown in the level list so a long session keeps its bearings.
export function levelMarker(level, tuned, committed) {
  const key = String(level);
  if (tuned[key] !== undefined) return '✎';
  if (committed[key] !== undefined) return '●';
  return '';
}
