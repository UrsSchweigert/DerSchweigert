// track-rotation.js — Manifest-driven background-music rotation.
//
// Selection and the audio-element lifecycle live here, separate from the Web
// Audio chiptune engine, so node:test can drive rotation with a fake element.
// A track is any object with a `file`; `stage` is an optional tag used to
// prefer tracks that match the current chapter.

export const DEFAULT_VOLUME = 0.35;

/** Indexes of the usable (file-bearing) entries in a manifest. */
function usableIndexes(tracks) {
  const indexes = [];
  if (!Array.isArray(tracks)) return indexes;
  tracks.forEach((track, index) => {
    if (track && typeof track.file === 'string' && track.file.length > 0) indexes.push(index);
  });
  return indexes;
}

/**
 * Pick the next track index.
 *
 * Stage-tagged tracks are preferred when any exist, but a manifest without a
 * match still plays. The current track is only avoided when another candidate
 * remains, so a single-track manifest keeps looping that track.
 *
 * @param {Array<object>} tracks manifest entries
 * @param {{stage?: number|string|null, avoidIndex?: number, rng?: () => number}} [options]
 * @returns {number} manifest index, or -1 for an empty manifest
 */
export function selectTrackIndex(tracks, { stage = null, avoidIndex = -1, rng = Math.random } = {}) {
  const indexes = usableIndexes(tracks);
  if (indexes.length === 0) return -1;

  const tagged = stage === null || stage === undefined
    ? []
    : indexes.filter((index) => tracks[index].stage === stage);
  const pool = tagged.length > 0 ? tagged : indexes;
  const candidates = pool.length > 1 ? pool.filter((index) => index !== avoidIndex) : pool;

  const roll = Number(rng());
  const clamped = Number.isFinite(roll) ? Math.min(0.999999999, Math.max(0, roll)) : 0;
  return candidates[Math.floor(clamped * candidates.length)];
}

/**
 * Owns the current and preloaded audio elements for one playback session.
 * The `makeAudio(file)` factory is injectable so tests can use a fake element.
 */
export class TrackRotation {
  constructor({ tracks = [], makeAudio, volume = DEFAULT_VOLUME, rng = Math.random, baseUrl = null,
    onError = null, onPlayBlocked = null, prepareAudio = null, releaseAudio = null } = {}) {
    if (typeof makeAudio !== 'function') {
      throw new TypeError('TrackRotation needs a makeAudio(file) factory');
    }
    this._makeAudio = makeAudio;
    this._prepareAudio = prepareAudio;
    this._releaseAudio = releaseAudio;
    this._volume = volume;
    this._rng = rng;
    this._baseUrl = baseUrl;
    this._tracks = Array.isArray(tracks) ? tracks : [];
    this._stage = null;
    this._active = false;
    this._muted = false;
    this._current = null;
    this._currentIndex = -1;
    this._next = null;
    this._nextIndex = -1;
    this._onEnded = () => this.advance();
    this._onPlayBlocked = onPlayBlocked;
    this._onError = (event) => {
      console.warn('Unable to load bundled music track:', event?.target?.src ?? 'unknown track');
      if (typeof onError === 'function') onError(event?.target);
    };
  }

  get tracks() { return this._tracks; }
  get active() { return this._active; }
  get muted() { return this._muted; }
  get currentIndex() { return this._currentIndex; }
  get nextIndex() { return this._nextIndex; }
  get currentAudio() { return this._current; }
  get nextAudio() { return this._next; }
  get currentTrack() {
    return this._currentIndex >= 0 ? this._tracks[this._currentIndex] ?? null : null;
  }
  get nextTrack() {
    return this._nextIndex >= 0 ? this._tracks[this._nextIndex] ?? null : null;
  }

  /** Swap in a manifest (for example after tracks.json loads). */
  replaceTracks(tracks) {
    const wasActive = this._active;
    const stage = this._stage;
    this._release();
    this._tracks = Array.isArray(tracks) ? tracks : [];
    if (wasActive) this.start(stage);
  }

  /** Begin a new session with the first track for `stage`. */
  start(stage = null) {
    this._release();
    this._stage = stage ?? null;
    this._active = true;
    this._currentIndex = selectTrackIndex(this._tracks, { stage: this._stage, rng: this._rng });
    if (this._currentIndex < 0) {
      this._active = false;
      return null;
    }
    this._current = this._create(this._tracks[this._currentIndex]);
    this._current.currentTime = 0;
    if (!this._muted) this._play(this._current);
    this._preloadNext();
    return this.currentTrack;
  }

  /** Move to the preloaded track (or select one) when the current one ends. */
  advance() {
    if (!this._active) return null;
    const previous = this._current;
    this._current = null;
    if (previous) this._releaseElement(previous);

    if (this._next) {
      this._current = this._next;
      this._currentIndex = this._nextIndex;
    } else {
      this._currentIndex = selectTrackIndex(this._tracks, {
        stage: this._stage,
        avoidIndex: this._currentIndex,
        rng: this._rng,
      });
      this._current = this._currentIndex >= 0
        ? this._create(this._tracks[this._currentIndex])
        : null;
    }
    this._next = null;
    this._nextIndex = -1;

    if (this._current) {
      this._current.currentTime = 0;
      if (!this._muted) this._play(this._current);
    }
    this._preloadNext();
    return this.currentTrack;
  }

  pause() {
    this._active = false;
    if (this._current) this._current.pause();
  }

  resume() {
    if (!this._current) return null;
    this._active = true;
    if (!this._muted) this._play(this._current);
    return this.currentTrack;
  }

  stop() {
    this._active = false;
    this._release();
  }

  setMuted(muted) {
    this._muted = Boolean(muted);
    for (const audio of [this._current, this._next]) {
      if (audio) audio.muted = this._muted;
    }
    if (this._muted) {
      if (this._current) this._current.pause();
    } else if (this._active) {
      this._play(this._current);
    }
  }

  _resolve(file) {
    if (!this._baseUrl) return file;
    try {
      return new URL(file, this._baseUrl).href;
    } catch {
      return file;
    }
  }

  _create(track) {
    let audio = this._makeAudio(track.file);
    audio.src = this._resolve(track.file);
    audio.loop = false;
    audio.preload = 'auto';
    audio.volume = this._volume;
    audio.muted = this._muted;
    if (this._prepareAudio) audio = this._prepareAudio(audio, track.file);
    this._bindEnded(audio);
    return audio;
  }

  _preloadNext() {
    if (this._next) return;
    this._nextIndex = selectTrackIndex(this._tracks, {
      stage: this._stage,
      avoidIndex: this._currentIndex,
      rng: this._rng,
    });
    if (this._nextIndex < 0) return;
    // Only ever one preloaded element; it stays silent until it becomes current.
    this._next = this._create(this._tracks[this._nextIndex]);
  }

  _play(audio) {
    if (!audio) return;
    // NotAllowedError only means the browser wants a user gesture first; the
    // next startMenuBGM()/resume() during a gesture retries playback, so it is
    // not worth a warning on every first visit.
    const warn = (error) => {
      if (error?.name === 'NotAllowedError') {
        if (typeof this._onPlayBlocked === 'function') this._onPlayBlocked(error);
        return;
      }
      console.warn('Unable to play bundled music track:', error);
    };
    try {
      const result = audio.play();
      if (result && typeof result.catch === 'function') result.catch(warn);
    } catch (error) {
      warn(error);
    }
  }

  _bindEnded(audio) {
    if (typeof audio.addEventListener === 'function') {
      audio.addEventListener('ended', this._onEnded);
      audio.addEventListener('error', this._onError);
    } else {
      audio.onended = this._onEnded;
      audio.onerror = this._onError;
    }
  }

  _unbindEnded(audio) {
    if (typeof audio.removeEventListener === 'function') {
      audio.removeEventListener('ended', this._onEnded);
      audio.removeEventListener('error', this._onError);
    } else if (audio.onended === this._onEnded) {
      audio.onended = null;
      if (audio.onerror === this._onError) audio.onerror = null;
    }
  }

  _releaseElement(audio) {
    this._unbindEnded(audio);
    audio.pause();
    audio.currentTime = 0;
    if (this._releaseAudio) this._releaseAudio(audio);
  }

  _release() {
    if (this._current) this._releaseElement(this._current);
    if (this._next) this._releaseElement(this._next);
    this._current = null;
    this._currentIndex = -1;
    this._next = null;
    this._nextIndex = -1;
  }
}
