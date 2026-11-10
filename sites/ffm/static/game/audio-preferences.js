// audio-preferences.js — Device-wide audio settings persistence.
//
// The shell owns storage access; this module only parses, applies and writes
// the small {effects, music, muted} record. Music gain is deferred while the
// engine still reports it unavailable (for example before a bundled blob is
// captured), then applied by the caller once the capability becomes
// `available`.

export const AUDIO_PREFERENCES_KEY = 'arithmo-audio-preferences-v1';

function volume(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}

export function parseAudioPreferences(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
    return {
      effects: volume(saved.effects),
      music: volume(saved.music),
      muted: typeof saved.muted === 'boolean' ? saved.muted : null,
    };
  } catch {
    return null;
  }
}

export function readAudioPreferences(storage) {
  try {
    return parseAudioPreferences(storage?.getItem(AUDIO_PREFERENCES_KEY));
  } catch {
    return null;
  }
}

export function writeAudioPreferences(storage, audio) {
  try {
    storage.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify({
      effects: audio.getEffectsVolume(),
      music: audio.getMusicVolume(),
      muted: audio.muted,
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply a saved record. Returns the saved music gain when the engine cannot
 * apply it yet, so the caller can retry after routing becomes available.
 */
export function applyAudioPreferences(audio, saved) {
  if (!saved) return null;
  if (saved.effects !== null) audio.setEffectsVolume(saved.effects);
  if (typeof saved.muted === 'boolean') audio.setMuted(saved.muted);
  if (saved.music === null) return null;
  if (audio.musicVolumeCapability.supported) {
    audio.setMusicVolume(saved.music);
    return null;
  }
  return saved.music;
}

/** Apply a deferred music gain once, returning null when it is consumed. */
export function applyDeferredMusicVolume(audio, value) {
  if (value === null || value === undefined) return null;
  if (!audio.musicVolumeCapability.supported) return value;
  audio.setMusicVolume(value);
  return null;
}
