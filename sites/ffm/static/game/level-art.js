// level-art.js — resolves the per-level background art from the committed
// levels/manifest.json. The renderer prefers a level image, falls back to the
// chapter stage art (stage-<ceil(level/10)>.webp) and finally to the legacy
// background.webp, so a missing or failed level image never throws or blocks
// the level from starting.
import manifestSource from './levels/manifest.json' with { type: 'json' };

const LEVEL_DIR_URL = new URL('./levels/', import.meta.url);
const LEVEL_FILE_RE = /\.webp$/i;
const STAGE_COUNT = 6;

const assetUrl = (name) => new URL(name, import.meta.url).href;

export const FALLBACK_BACKGROUND_URL = assetUrl('./background.webp');
const STAGE_URLS = Array.from({ length: STAGE_COUNT }, (_, index) => assetUrl(`./stage-${index + 1}.webp`));

function toLevelNumber(level) {
  const number = Number.parseInt(level, 10);
  return Number.isInteger(number) && number >= 1 ? number : null;
}

// Canonical URL of a level image. `file` comes from the manifest entry; when it
// is absent the level-NN.webp naming convention is used.
export function levelArtUrl(level, file) {
  const number = toLevelNumber(level);
  if (number === null) return null;
  const name = file ? String(file).split(/[\\/]/).pop() : `level-${String(number).padStart(2, '0')}.webp`;
  if (!name || !LEVEL_FILE_RE.test(name)) return null;
  return new URL(name, LEVEL_DIR_URL).href;
}

// Chapter stage art for a level, clamped to the six committed stages.
export function stageArtUrl(level) {
  const number = toLevelNumber(level);
  const index = number === null ? 0 : Math.min(STAGE_COUNT - 1, Math.ceil(number / 10) - 1);
  return STAGE_URLS[Math.max(0, index)];
}

// Ground-line overrides are bounded to the part of the canvas a standing sprite
// can actually occupy; a value outside that band is dropped, never clamped.
const GROUND_Y_FLOOR = 240;
const GROUND_Y_CEILING = 436;

// Accepts the manifest as raw JSON text or as an already parsed object and
// returns `{ levels: { "<n>": "<file>.webp" }, groundY: { "<n>": <y> } }`.
// Anything malformed yields an empty map so a broken manifest simply falls
// through to the stage art.
export function parseLevelArtManifest(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  const usable = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  const source = usable
    ? (usable.levels && typeof usable.levels === 'object' ? usable.levels : usable)
    : null;
  const levels = {};
  if (source) {
    for (const [key, entry] of Object.entries(source)) {
      const number = toLevelNumber(key);
      if (number === null || String(number) !== String(key).trim()) continue;
      const file = typeof entry === 'string'
        ? entry
        : entry && typeof entry.file === 'string' ? entry.file : null;
      if (!file || !LEVEL_FILE_RE.test(file)) continue;
      levels[String(number)] = String(file).split(/[\\/]/).pop();
    }
  }
  return { levels, groundY: parseGroundYMap(usable?.groundY) };
}

// Per-level ground-line overrides. The 60 backgrounds paint their walkable floor
// at different heights, so one GROUND_Y can only be a compromise; a level that
// needs its own line says so here and the hero and fiends are moved onto it.
// Values outside the frame band are dropped rather than clamped, so a typo keeps
// the shipped default instead of parking the characters off-screen.
function parseGroundYMap(raw) {
  const overrides = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return overrides;
  for (const [key, value] of Object.entries(raw)) {
    const number = toLevelNumber(key);
    if (number === null || String(number) !== String(key).trim()) continue;
    if (!Number.isFinite(value)) continue;
    const y = Math.round(value);
    if (y < GROUND_Y_FLOOR || y > GROUND_Y_CEILING) continue;
    overrides[String(number)] = y;
  }
  return overrides;
}

// The ground line a level ships with, or null when it uses the default.
export function resolveLevelGroundY(level, manifest) {
  const parsed = parseLevelArtManifest(manifest ?? LEVEL_ART_MANIFEST);
  const number = toLevelNumber(level);
  if (number === null) return null;
  return parsed.groundY[String(number)] ?? null;
}

export const LEVEL_ART_MANIFEST = parseLevelArtManifest(manifestSource);

// The background to use for a level: its committed level art when the manifest
// has an entry, otherwise the chapter stage art. The renderer swaps in the
// legacy background only if the returned image fails to load.
export function resolveLevelBackground(level, manifest) {
  const parsed = parseLevelArtManifest(manifest);
  const number = toLevelNumber(level);
  const file = number === null ? null : parsed.levels[String(number)];
  return (file ? levelArtUrl(number, file) : null) ?? stageArtUrl(number ?? 1);
}
