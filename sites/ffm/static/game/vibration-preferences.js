// vibration-preferences.js — Persisted on/off choice for haptics.
//
// The shell owns storage access; this module only parses, defaults and writes
// the small {enabled} record under its own key so it survives independently of
// the audio volumes. A corrupt or unreadable record falls back to enabled,
// which matches the default before the player ever touches the setting.

export const VIBRATION_PREFERENCES_KEY = 'arithmo-haptics-preference-v1';

export const DEFAULT_VIBRATION_ENABLED = true;

/**
 * Parse a stored record. Returns null for anything unusable so callers can
 * apply the safe default without guessing at a partial shape.
 */
export function parseVibrationPreferences(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
    if (typeof saved.enabled !== 'boolean') return null;
    return { enabled: saved.enabled };
  } catch {
    return null;
  }
}

/** Read the preference, defaulting to enabled when absent or corrupt. */
export function readVibrationPreferences(storage) {
  try {
    return parseVibrationPreferences(storage?.getItem(VIBRATION_PREFERENCES_KEY))
      ?? { enabled: DEFAULT_VIBRATION_ENABLED };
  } catch {
    return { enabled: DEFAULT_VIBRATION_ENABLED };
  }
}

/** Persist the choice; returns false when storage refuses the write. */
export function writeVibrationPreferences(storage, enabled) {
  try {
    storage.setItem(VIBRATION_PREFERENCES_KEY, JSON.stringify({ enabled: enabled !== false }));
    return true;
  } catch {
    return false;
  }
}

/** Apply a saved record to an existing haptics instance immediately. */
export function applyVibrationPreferences(haptics, saved) {
  const enabled = typeof saved?.enabled === 'boolean' ? saved.enabled : DEFAULT_VIBRATION_ENABLED;
  haptics.setEnabled(enabled);
  return enabled;
}
