// audio.js — Web Audio API chiptune engine for Arithmo Slayer

import { DEFAULT_VOLUME, TrackRotation } from './track-rotation.js';
import { MusicLoop } from './music-loop.js';

// Used until tracks.json loads (and when it cannot be fetched), so the game
// always has the one bundled track. The manifest holds the credited metadata.
const FALLBACK_TRACKS = Object.freeze([Object.freeze({ file: 'background-music.mp3' })]);
const EFFECTS_HEADROOM = 0.4;

// Short attack and release ramps on the synth cues: an instant start or a hard
// cut at the end reads as a click. The victory hymn below is deliberately left
// out of this shaping because its attack is the point.
const EFFECT_ATTACK = 0.008;
const MUSIC_FADE = 0.15;
const VICTORY_HYMN = './victory-hymn.mp3';
const HYMN_MUSIC_DUCK = 0.3;
const HYMN_DUCK_REASON = 'victory-hymn';

// Bundled sound effects, relative to the bundle root (the game directory).
// Every cue is a set of variants; a cue plays a different variant than its
// previous turn, so the same hit answered twice never sounds machine-stamped.
const SFX_DIR = 'sfx/';
const CUE_VARIANTS = 3;
export const FIEND_SFX_TYPES = Object.freeze([
  'slimeling', 'bonehead', 'toadlord', 'magelitch', 'birdfoe', 'wolffoe', 'snakefoe',
]);

function cueFiles(base) {
  return Object.freeze(Array.from({ length: CUE_VARIANTS }, (_, i) => `${base}-${i + 1}.mp3`));
}

export const SFX_CUES = Object.freeze({
  'sword-slash': cueFiles('sword-slash'),
  'hero-hurt': cueFiles('hero-hurt'),
  'fire-cast': cueFiles('fire-cast'),
  'fire-impact': cueFiles('fire-impact'),
  'bolt-cast': cueFiles('bolt-cast'),
  'bolt-impact': cueFiles('bolt-impact'),
  'heal-charge': Object.freeze(['heal-charge-1.mp3']),
  'heal-bloom': cueFiles('heal-bloom'),
  'dragon-roar': cueFiles('dragon-roar'),
  'answer-sparkle': cueFiles('answer-sparkle'),
  'game-over': Object.freeze(['game-over-1.mp3']),
  'win-pop': Object.freeze(['win-pop-1.mp3']),
  'sword-gain': Object.freeze(['sword-gain-1.mp3']),
  ...Object.fromEntries(FIEND_SFX_TYPES.flatMap(type => [
    [`fiend-${type}-hit`, cueFiles(`fiend-${type}-hit`)],
    [`fiend-${type}-death`, cueFiles(`fiend-${type}-death`)],
  ])),
});

// Sample cues are mixed above their own level so they carry over the music and
// the synth cues around them; the effects bus keeps its 0.4 headroom, so the
// ceiling is the compressor, not the mixer.
const SWORD_SLASH_GAIN = 1.6;
const HERO_HURT_GAIN = 1.45;
const SPELL_CAST_GAIN = 1.4;
const SPELL_IMPACT_GAIN = 1.5;
const DRAGON_ROAR_GAIN = 1.5;
const HEAL_GAIN = 2.7;
// The charge bed is deliberately quiet: it runs under a strike that may be
// happening at the same moment. It grows with progress instead of starting loud.
const HEAL_CHARGE_GAIN = 1.1;
const HEAL_CHARGE_GAIN_RANGE = 0.9;
const HEAL_CHARGE_RATE_RANGE = 0.45;
// A glitter under the "yes" tones, not a cue of its own.
const ANSWER_SPARKLE_GAIN = 0.5;
const GAME_OVER_GAIN = 1.4;
const WIN_POP_GAIN = 1.1;
const SWORD_GAIN_GAIN = 1.2;
// A fiend's own hit and death sit under the sword and the spell blast, so they
// are mixed lower than the cues that carry the beat.
const FIEND_HIT_GAIN = 1.2;
const FIEND_DEATH_GAIN = 1.45;

function volumeValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Volume must be a finite number');
  }
  return Math.min(1, Math.max(0, value));
}

export class AudioEngine {
  constructor({ tracks = null, manifestUrl = null, makeAudio = null, fetchManifest = null,
    levelMusic = null, levelMusicUrl = null, fetchLevelMusic = null, baseUrl,
    makeContext = null, musicGainRouting = false, fetchTrack = null, onMusicVolumeReady = null,
    onMusicVolumeUnavailable = null, random = null } = {}) {
    this._ctx = null;
    this._random = random ?? Math.random;
    this._makeContext = makeContext ?? (() => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)());
    this._effectsVolume = 1;
    this._musicVolume = DEFAULT_VOLUME;
    this._musicDuck = 1;
    // Reasons that currently dip the music (the victory hymn, a narrated story
    // scene); the lowest factor wins, so none of them can un-duck another.
    this._musicDucks = new Map();
    this._victoryTask = null;
    this._victoryVoice = null;
    // Decoded sound-effect buffers and the variants already played, keyed by
    // file and by cue name respectively. A failed file is remembered so a
    // missing asset does not refetch on every single hit.
    this._cueBuffers = new Map();
    this._cueTasks = new Map();
    this._cueFailed = new Set();
    this._cueLast = new Map();
    this._fiendCueTypes = new Set();
    this._healChargeVoice = null;
    this._effectsBus = null;
    this._musicBus = null;
    this._voices = new Set();
    this._mediaSources = new Map();
    this._musicGainRouting = musicGainRouting;
    this._musicVolumeStatus = musicGainRouting ? 'awaiting-media-route' : 'unverified-media-routing';
    this._onMusicVolumeReady = onMusicVolumeReady;
    this._onMusicVolumeUnavailable = onMusicVolumeUnavailable;
    this._makeAudio = makeAudio ?? (() => new Audio());
    this._musicBaseUrl = baseUrl === undefined ? new URL('./', import.meta.url).href : baseUrl;
    this._fetchTrack = fetchTrack ?? (typeof globalThis.fetch === 'function'
      ? (url, init) => globalThis.fetch(url, init) : null);
    // Custom-scheme bundle assets (capacitor: on iOS) cannot be captured by
    // Web Audio directly. Fetch each one once and play it from a same-origin
    // blob URL so it can share the effects gain path.
    this._blobUrls = new Map();
    this._blobTasks = new Map();
    this._pendingBlobElements = new Map();
    this._bundledReady = Promise.resolve();
    this._muted = false;
    this._tracks = tracks ?? FALLBACK_TRACKS;
    this._levelMusic = levelMusic;
    this._levelMusicUrl = levelMusicUrl ?? new URL('./level-music.json', import.meta.url).href;
    this._fetchLevelMusic = fetchLevelMusic;
    this._levelMusicReady = levelMusic ? Promise.resolve() : null;
    this._musicSession = null;
    this._musicRefreshPending = false;
    this._menuRequest = 0;
    this._menuPlayBlocked = false;
    this._loop = null;
    this._loopOwnsMusic = false;
    this._rotation = new TrackRotation({
      tracks: this._tracks,
      makeAudio: this._makeAudio,
      volume: DEFAULT_VOLUME,
      baseUrl: this._musicBaseUrl,
      onError: element => this._handleTrackError(element),
      onPlayBlocked: () => { this._menuPlayBlocked = true; },
      prepareAudio: (element, file) => this._routeMusicAudio(element, file),
      releaseAudio: element => this._releaseMusicAudio(element),
    });
    if (!tracks) {
      this._manifestUrl = manifestUrl ?? new URL('./tracks.json', import.meta.url).href;
      this._manifestReady = this._loadManifest(fetchManifest);
    } else {
      this._manifestReady = Promise.resolve();
    }
    this._queueBundledTracks(this._tracks);
  }

  async _loadManifest(fetchManifest) {
    const load = fetchManifest ?? ((url) => fetch(url).then((response) => {
      if (!response.ok) throw new Error(`music manifest ${response.status}`);
      return response.json();
    }));
    try {
      const manifest = await load(this._manifestUrl);
      const tracks = Array.isArray(manifest) ? manifest : manifest?.tracks;
      if (!Array.isArray(tracks) || tracks.length === 0 || !tracks.every(t => t && typeof t.file === 'string' && t.file)) {
        throw new Error('invalid or empty tracks list');
      }
      this._tracks = tracks;
      this._refreshMusic();
      this._queueBundledTracks(this._tracks);
    } catch (error) {
      console.warn('Unable to load music manifest; using bundled fallback:', error);
    }
  }

  async _loadLevelMusic() {
    const load = this._fetchLevelMusic ?? (url => fetch(url).then(response => {
      if (!response.ok) throw new Error(`level music ${response.status}`);
      return response.json();
    }));
    try {
      const config = await load(this._levelMusicUrl);
      if (!config || !config.levels || typeof config.levels !== 'object' || Array.isArray(config.levels)) {
        throw new Error('expected a levels object');
      }
      await this._manifestReady;
      this._levelMusic = config;
      this._refreshMusic();
    } catch (error) {
      console.warn('Unable to load level music; using normal rotation:', error);
    }
  }

  _tracksForLevel(level) {
    return this._tracksFromConfig(this._levelMusic?.levels?.[level], `level ${level}`);
  }

  _tracksForMenu() {
    return this._tracksFromConfig(this._levelMusic?.menu, 'the menu');
  }

  _tracksFromConfig(files, label) {
    if (files === undefined || (Array.isArray(files) && files.length === 0)) return this._tracks;
    if (!Array.isArray(files) || files.some(file => typeof file !== 'string' ||
      !/^[a-zA-Z0-9._/-]+$/.test(file) || file.startsWith('/') || file.split('/').includes('..'))) {
      console.warn(`Invalid bundled music list for ${label}; using normal rotation`);
      return this._tracks;
    }
    const tracks = [...new Set(files)].map(file => this._tracks.find(track => track.file === file));
    if (tracks.some(track => !track)) {
      console.warn(`Unknown bundled music track for ${label}; using normal rotation`);
      return this._tracks;
    }
    // Configured lists override chapter tags, including for the preload.
    return tracks.map(track => ({ ...track, stage: null }));
  }

  _refreshMusic() {
    const session = this._musicSession;
    const tracks = session?.failed ? FALLBACK_TRACKS
      : session?.level != null ? this._tracksForLevel(session.level)
      : session?.menu ? this._tracksForMenu() : this._tracks;
    const unchanged = tracks.length === this._rotation.tracks.length &&
      tracks.every((track, i) => track.file === this._rotation.tracks[i].file &&
        track.stage === this._rotation.tracks[i].stage);
    if (unchanged) {
      this._musicRefreshPending = false;
      return;
    }
    if (session?.paused) {
      this._musicRefreshPending = true;
      return;
    }
    this._musicRefreshPending = false;
    this._rotation.replaceTracks(tracks);
  }

  _handleTrackError(element) {
    const session = this._musicSession;
    if (!session || (element !== this._rotation.currentAudio && element !== this._rotation.nextAudio)) return;
    const track = element === this._rotation.currentAudio
      ? this._rotation.currentTrack : this._rotation.nextTrack;
    if (session.failed || track?.file === FALLBACK_TRACKS[0].file) {
      session.failed = true;
      this._musicRefreshPending = false;
      this._rotation.stop();
      return;
    }
    session.failed = true;
    this._refreshMusic();
  }

  _ensureCtx() {
    if (!this._ctx) {
      this._ctx = this._makeContext();
      this._effectsBus = this._ctx.createGain();
      this._musicBus = this._ctx.createGain();
      this._output = this._ctx.destination;
      if (typeof this._ctx.createDynamicsCompressor === 'function') {
        this._output = this._ctx.createDynamicsCompressor();
        for (const [key, value] of Object.entries({ threshold: -6, knee: 12, ratio: 6, attack: 0.003, release: 0.15 })) {
          this._output[key].setValueAtTime(value, this._ctx.currentTime);
        }
        this._output.connect(this._ctx.destination);
      }
      this._effectsBus.connect(this._output);
      this._musicBus.connect(this._output);
      this._updateBusGains();
      this._preloadCue('sword-slash');
      this._preloadCue('hero-hurt');
      this._preloadCue('fire-cast');
      this._preloadCue('fire-impact');
      this._preloadCue('bolt-cast');
      this._preloadCue('bolt-impact');
      this._preloadCue('heal-charge');
      this._preloadCue('heal-bloom');
      this._preloadCue('dragon-roar');
      this._preloadCue('answer-sparkle');
      this._preloadCue('game-over');
      this._preloadCue('win-pop');
      this._preloadCue('sword-gain');
      this._fiendCueTypes.forEach(type => this._warmFiendCues(type));
    }
    // WebKit reports "interrupted" — not "suspended" — when iOS takes the
    // audio session away (backgrounding, a call, another app). Both states
    // need an explicit resume(), and a context that is already running must
    // not be prodded. A closed context cannot be revived; recreation is out
    // of scope here and every cue would throw, so leave it alone.
    if (this._ctx.state !== 'running' && this._ctx.state !== 'closed') {
      const resumed = this._ctx.resume();
      resumed?.catch?.(error => console.warn('Unable to resume audio context:', error));
    }
  }

  _updateBusGains() {
    if (!this._ctx) return;
    this._effectsBus.gain.setValueAtTime(this._muted ? 0 : this._effectsVolume * EFFECTS_HEADROOM, this._ctx.currentTime);
    this._musicBus.gain.setValueAtTime(this._muted ? 0 : this._musicVolume * this._musicDuck, this._ctx.currentTime);
  }

  // Background music dips for any number of reasons and comes back afterwards.
  _setMusicDuck(factor) {
    this._musicDuck = factor;
    if (!this._ctx || !this._musicBus) return;
    const gain = this._musicBus.gain;
    const now = this._ctx.currentTime;
    const target = this._muted ? 0 : this._musicVolume * factor;
    if (typeof gain.linearRampToValueAtTime !== 'function') {
      gain.setValueAtTime(target, now);
      return;
    }
    if (typeof gain.cancelScheduledValues === 'function') gain.cancelScheduledValues(now);
    gain.setValueAtTime(typeof gain.value === 'number' ? gain.value : target, now);
    gain.linearRampToValueAtTime(target, now + MUSIC_FADE);
  }

  /**
   * Dip the background music for one named reason, or release it again.
   *
   * More than one thing can need the music quieter at the same time (the
   * victory hymn, a narrated story scene). Every reason keeps its own level and
   * the lowest one wins, so releasing one never un-ducks another.
   *
   * @param {string} reason who wants the dip, e.g. 'victory-hymn'
   * @param {number|null} factor 1 is full level, 0 is silent; null releases
   * @returns {number} the duck now in force
   */
  setMusicDuck(reason, factor) {
    const key = String(reason);
    if (factor === null || factor === undefined) {
      this._musicDucks.delete(key);
    } else {
      const level = Number(factor);
      this._musicDucks.set(key, Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0);
    }
    this._setMusicDuck(this._musicDucks.size ? Math.min(...this._musicDucks.values()) : 1);
    return this._musicDuck;
  }

  get effectsVolume() { return this._effectsVolume; }
  get musicVolume() { return this._musicVolume; }
  getEffectsVolume() { return this.effectsVolume; }
  getMusicVolume() { return this.musicVolume; }
  get musicVolumeCapability() {
    // Choose gain before first playback creates the configured app media route.
    return {
      supported: this._musicVolumeStatus === 'available' || this._musicVolumeStatus === 'awaiting-media-route',
      status: this._musicVolumeStatus,
    };
  }

  setEffectsVolume(value) {
    this._effectsVolume = volumeValue(value);
    this._updateBusGains();
    return this._effectsVolume;
  }

  setMusicVolume(value) {
    const volume = volumeValue(value);
    if (!this.musicVolumeCapability.supported) {
      throw new Error(`Music volume unavailable: ${this._musicVolumeStatus}`);
    }
    this._musicVolume = volume;
    this._updateBusGains();
    return volume;
  }

  _routeMusicAudio(element, file) {
    if (!this._musicGainRouting) return element;
    try {
      if (!this._musicBaseUrl) throw new Error('Music gain routing needs a bundle base URL');
      if (typeof this._ctx?.createMediaElementSource !== 'function') {
        throw new Error('Media element sources unavailable');
      }
      const base = new URL(this._musicBaseUrl);
      const url = new URL(element.src, base);
      if (!this._isRoutableMusicUrl(url, base)) {
        throw new Error('Media gain routing requires same-origin bundled or HTTP(S) assets');
      }
      const blobUrl = this._blobUrls.get(file);
      if (blobUrl) {
        element.src = blobUrl;
        return this._captureMusicElement(element);
      }
      if (url.protocol === 'blob:' || /^https?:$/.test(url.protocol)) {
        return this._captureMusicElement(element);
      }
      // A custom-scheme bundle asset is swapped for its same-origin blob once
      // the one-time fetch resolves; capture happens in _applyBundledBlob.
      if (!this._fetchTrack) throw new Error('Bundled music fetch unavailable');
      const pending = this._pendingBlobElements.get(file) ?? new Set();
      pending.add(element);
      this._pendingBlobElements.set(file, pending);
      return element;
    } catch (error) {
      this._disableMusicRouting();
      console.warn('Music volume control unavailable; preserving default playback:', error);
      const captured = error?.mediaSource ?? null;
      if (!captured) return element;
      // Once captured, an element cannot reliably return to direct playback.
      const replacement = this._makeAudio(file);
      for (const key of ['src', 'loop', 'preload', 'muted']) replacement[key] = element[key];
      replacement.volume = DEFAULT_VOLUME;
      element.pause();
      return replacement;
    }
  }

  // Blob URLs inherit this document's origin, so they are always capturable.
  // HTTP(S) needs an exact origin match; a custom bundle scheme (capacitor:)
  // only needs to match the bundle's own scheme and host.
  _isRoutableMusicUrl(url, base) {
    if (url.protocol === 'blob:') return true;
    if (/^https?:$/.test(url.protocol)) {
      return /^https?:$/.test(base.protocol) && url.origin === base.origin;
    }
    return url.protocol === base.protocol && url.host === base.host;
  }

  _usesBundledBlobTracks() {
    if (!this._musicGainRouting || !this._musicBaseUrl || !this._fetchTrack) return false;
    try {
      return !/^https?:$/.test(new URL(this._musicBaseUrl).protocol);
    } catch {
      return false;
    }
  }

  _queueBundledTracks(tracks) {
    if (!this._usesBundledBlobTracks()) return;
    const files = [...new Set((Array.isArray(tracks) ? tracks : [])
      .map(track => track?.file)
      .filter(file => typeof file === 'string' && file))];
    this._bundledReady = this._bundledReady.then(() =>
      Promise.all(files.map(file => this._fetchBundledTrack(file))));
  }

  _fetchBundledTrack(file) {
    if (this._blobUrls.has(file)) return Promise.resolve(this._blobUrls.get(file));
    const existing = this._blobTasks.get(file);
    if (existing) return existing;
    const url = new URL(file, this._musicBaseUrl).href;
    // Capacitor iOS answers a plain media request with a non-HTTP response,
    // which WebKit's fetch reports as status 0 / ok === false. A full byte
    // range makes it answer with a real 206; status 0 stays accepted for older
    // shells because the non-empty blob check below still guards the data.
    const task = Promise.resolve()
      .then(() => this._fetchTrack(url, { headers: { Range: 'bytes=0-' } }))
      .then((response) => {
        if (!response || (response.ok === false && response.status !== 0)) {
          throw new Error(`bundled music ${response?.status ?? 'unavailable'}`);
        }
        return response.blob();
      })
      .then((blob) => {
        if (!blob || blob.size === 0) throw new Error('empty bundled music');
        const objectUrl = URL.createObjectURL(blob);
        this._blobUrls.set(file, objectUrl);
        this._applyBundledBlob(file, objectUrl);
        return objectUrl;
      })
      .catch((error) => {
        console.warn('Unable to prepare bundled music for gain routing:', error);
        this._disableMusicRouting();
        return null;
      });
    this._blobTasks.set(file, task);
    return task;
  }

  _applyBundledBlob(file, objectUrl) {
    const elements = this._pendingBlobElements.get(file);
    if (!elements) return;
    this._pendingBlobElements.delete(file);
    for (const element of elements) {
      const wasCurrent = this._rotation?.currentAudio === element;
      const shouldPlay = wasCurrent && this._rotation.active && !this._muted &&
        !this._musicSession?.paused;
      const directSrc = element.src;
      try {
        element.src = objectUrl;
        this._captureMusicElement(element);
        if (shouldPlay) this._playMedia(element);
      } catch (error) {
        element.src = directSrc;
        console.warn('Unable to route bundled music through the gain bus:', error);
        this._disableMusicRouting();
      }
    }
  }

  _captureMusicElement(element) {
    if (this._mediaSources.has(element)) return element;
    const source = this._ctx.createMediaElementSource(element);
    try {
      source.connect(this._musicBus);
    } catch (error) {
      source.disconnect?.();
      error.mediaSource = source;
      throw error;
    }
    element.volume = 1;
    this._mediaSources.set(element, source);
    this._markMusicRoutingAvailable();
    return element;
  }

  _markMusicRoutingAvailable() {
    if (this._musicVolumeStatus === 'available') return;
    this._musicVolumeStatus = 'available';
    try {
      this._onMusicVolumeReady?.();
    } catch (error) {
      console.warn('Music volume ready callback failed:', error);
    }
  }

  _playMedia(element) {
    try {
      const result = element.play();
      result?.catch?.(error => console.warn('Unable to play bundled music track:', error));
    } catch (error) {
      console.warn('Unable to play bundled music track:', error);
    }
  }

  _disableMusicRouting() {
    const wasUnsupported = this._musicVolumeStatus === 'unsupported-media-routing';
    this._musicGainRouting = false;
    this._musicVolumeStatus = 'unsupported-media-routing';
    this._musicVolume = DEFAULT_VOLUME;
    this._pendingBlobElements.clear();
    this._updateBusGains();
    if (wasUnsupported) return;
    try {
      this._onMusicVolumeUnavailable?.();
    } catch (error) {
      console.warn('Music volume unavailable callback failed:', error);
    }
  }

  _releaseMusicAudio(element) {
    this._mediaSources.get(element)?.disconnect();
    this._mediaSources.delete(element);
  }

  _trackVoice(source, nodes) {
    const voice = { source, nodes };
    this._voices.add(voice);
    source.onended = () => {
      nodes.forEach(node => node.disconnect());
      this._voices.delete(voice);
    };
    return voice;
  }

  // A short attack and an exponential release keep a cue from starting or
  // ending on a hard edge. Exponential ramps need a non-zero value, hence the
  // floor instead of a plain zero.
  _shapeEnvelope(param, peak, startTime, duration) {
    const level = Math.max(0.0001, peak);
    const attack = Math.min(EFFECT_ATTACK, duration / 3);
    param.setValueAtTime(0.0001, startTime);
    if (attack > 0) param.exponentialRampToValueAtTime(level, startTime + attack);
    else param.setValueAtTime(level, startTime);
    param.exponentialRampToValueAtTime(0.0001, startTime + duration);
  }

  _playTone(freq, type, duration, startTime, gain = 0.3) {
    this._ensureCtx();
    if (this._muted) return;
    
    const osc = this._ctx.createOscillator();
    const gainNode = this._ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    this._shapeEnvelope(gainNode.gain, gain, startTime, duration);
    
    osc.connect(gainNode);
    gainNode.connect(this._effectsBus);
    this._trackVoice(osc, [osc, gainNode]);
    
    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  playCorrect() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
    this._playTone(523, 'sine', 0.09, t, 0.12);
    this._playTone(659, 'triangle', 0.1, t + 0.07, 0.1);
    // Glitter on top of the tones rather than instead of them: the two rising
    // tones are the answer being right, the sparkle is the reward.
    this._playCue('answer-sparkle', { gain: ANSWER_SPARKLE_GAIN });
  }

  playWrong() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
    this._playTone(330, 'triangle', 0.09, t, 0.14);
    this._playTone(262, 'triangle', 0.12, t + 0.09, 0.12);
  }

  playTimeout() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
    this._playTone(220, 'sine', 0.12, t, 0.16);
    this._playTone(165, 'sine', 0.18, t + 0.2, 0.13);
  }

  playHeal() {
    this._ensureCtx();
    if (this._muted) return;

    if (this._playCue('heal-bloom', { gain: HEAL_GAIN })) return;

    const t = this._ctx.currentTime;
    [392, 494, 587].forEach((f, i) => this._playTone(f, 'sine', 0.16, t + i * 0.09, 0.14));
  }

  playCampaignVictory() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
    [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) =>
      this._playTone(f, 'triangle', i === 6 ? 0.45 : 0.16, t + i * 0.14, 0.16));
  }

  /**
   * Play the bundled victory hymn once and duck the background music under it.
   *
   * Resolves to false when the track cannot be decoded, so the caller can fall
   * back to the synth fanfare. The hymn keeps its own attack and release: it is
   * the one cue that is meant to hit hard.
   */
  async playVictoryHymn() {
    this._ensureCtx();
    if (this._muted) return true;
    if (!this._ctx || typeof this._ctx.decodeAudioData !== 'function' || !this._fetchTrack) return false;
    // One fanfare per level: a second call while it rings must not restart it.
    if (this._victoryVoice) return true;
    let buffer;
    try {
      buffer = await this._victoryBuffer();
    } catch (error) {
      console.warn('Victory hymn unavailable:', error);
      return false;
    }
    if (!buffer || this._muted || !this._ctx) return true;
    this._startVictoryHymn(buffer);
    return true;
  }

  // Decoded once per session; a failed load is forgotten so the next level can
  // retry instead of sticking the game on the fallback cue.
  _victoryBuffer() {
    if (!this._victoryTask) {
      const task = this._loadTrackBytes(VICTORY_HYMN)
        .then(bytes => this._ctx.decodeAudioData(bytes));
      this._victoryTask = task;
      task.catch(() => {
        if (this._victoryTask === task) this._victoryTask = null;
      });
    }
    return this._victoryTask;
  }

  _startVictoryHymn(buffer) {
    const now = this._ctx.currentTime;
    const source = this._ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = false;
    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(1, now);
    source.connect(gain);
    gain.connect(this._effectsBus);
    const voice = { source, nodes: [source, gain] };
    this._victoryVoice = voice;
    this._voices.add(voice);
    source.onended = () => {
      this._voices.delete(voice);
      if (this._victoryVoice === voice) this._victoryVoice = null;
      this.setMusicDuck(HYMN_DUCK_REASON, null);
      voice.nodes.forEach(node => {
        try {
          node.disconnect();
        } catch {
          // Already released.
        }
      });
    };
    this.setMusicDuck(HYMN_DUCK_REASON, HYMN_MUSIC_DUCK);
    source.start(now);
  }

  // Called when new background music starts: the fanfare must not outlive the
  // level-clear screen or keep the next level's music ducked.
  _stopVictoryHymn() {
    const voice = this._victoryVoice;
    if (!voice && !this._musicDucks.has(HYMN_DUCK_REASON)) return;
    this._victoryVoice = null;
    this.setMusicDuck(HYMN_DUCK_REASON, null);
    if (!voice) return;
    this._voices.delete(voice);
    try {
      voice.source.stop();
    } catch {
      // Already stopped.
    }
    voice.nodes.forEach(node => {
      try {
        node.disconnect();
      } catch {
        // Already released.
      }
    });
  }

  // A bundle file is fetched and decoded once. The cache is keyed per file, so
  // variants of one cue load independently and a cue that is not used stays
  // unfetched. Failures are remembered for the session: retrying a missing
  // asset on every hit would only flood the console and the network.
  _loadCueFile(file) {
    if (this._cueBuffers.has(file)) return Promise.resolve(this._cueBuffers.get(file));
    if (this._cueFailed.has(file)) return Promise.resolve(null);
    if (this._cueTasks.has(file)) return this._cueTasks.get(file);
    const ctx = this._ctx;
    if (!ctx || typeof ctx.decodeAudioData !== 'function' || !this._fetchTrack) {
      return Promise.resolve(null);
    }
    const task = this._loadTrackBytes(`${SFX_DIR}${file}`)
      .then(bytes => ctx.decodeAudioData(bytes))
      .then(
        buffer => {
          this._cueTasks.delete(file);
          this._cueBuffers.set(file, buffer);
          return buffer;
        },
        error => {
          this._cueTasks.delete(file);
          this._cueFailed.add(file);
          console.warn(`Sound effect ${file} unavailable; using the synth cue:`, error);
          return null;
        },
      );
    this._cueTasks.set(file, task);
    return task;
  }

  _preloadCue(cue) {
    (SFX_CUES[cue] ?? []).forEach(file => this._loadCueFile(file));
  }

  _warmFiendCues(type) {
    this._preloadCue(`fiend-${type}-hit`);
    this._preloadCue(`fiend-${type}-death`);
  }

  /**
   * Warm a fiend type's hit and death cues when it first walks in, so the first
   * kill of a type already carries its own sound instead of the synth cue.
   * Unknown types are ignored: they fall back to the generic cues.
   */
  prepareFiend(type) {
    if (!FIEND_SFX_TYPES.includes(type)) return;
    this._fiendCueTypes.add(type);
    if (this._ctx) this._warmFiendCues(type);
  }

  // Picks the next variant of a cue, never the one that just played, so a
  // three-variant cue cannot repeat itself back to back.
  _nextCueFile(cue) {
    const files = SFX_CUES[cue];
    if (!files || files.length === 0) return null;
    const last = this._cueLast.get(cue);
    let index = Math.floor(this._random() * files.length);
    if (files.length > 1 && index === last) index = (index + 1) % files.length;
    this._cueLast.set(cue, index);
    return files[index];
  }

  // Returns false when the chosen variant is not decoded yet (the load is
  // started) or cannot be loaded, which is the caller's cue to synthesize.
  _playCue(cue, { gain = 1, delay = 0 } = {}) {
    if (this._muted) return false;
    const file = this._nextCueFile(cue);
    if (!file) return false;
    const buffer = this._cueBuffers.get(file);
    if (!buffer) {
      this._loadCueFile(file);
      return false;
    }
    this._playSample(buffer, { gain, delay });
    return true;
  }

  _playSample(buffer, { gain = 1, delay = 0, loop = false } = {}) {
    const start = this._ctx.currentTime + Math.max(0, delay);
    const source = this._ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const gainNode = this._ctx.createGain();
    gainNode.gain.setValueAtTime(gain, start);
    source.connect(gainNode);
    gainNode.connect(this._effectsBus);
    const voice = this._trackVoice(source, [source, gainNode]);
    voice.gain = gainNode;
    source.start(start);
    return voice;
  }

  /**
   * The hit cue: one of the bundled slash variants, and the synth swish until
   * they are decoded (or for good when they cannot be loaded), so a hit is
   * never silent.
   */
  playSwordSwing() {
    this._ensureCtx();
    if (this._muted) return;

    if (this._playCue('sword-slash', { gain: SWORD_SLASH_GAIN })) return;

    this._playNoiseBurst(0.06, this._ctx.currentTime, 0.2, 2400, 'bandpass', 900, 2);

    this._playTone(1200, 'square', 0.05, this._ctx.currentTime + 0.05);
  }

  /**
   * A fiend's own impact when the blade lands but it survives. `type` is the
   * fiend type key from levels.js; an unknown type keeps the shared crack.
   */
  playFiendHit(type) {
    this._ensureCtx();
    if (this._muted) return;

    if (this._playCue(`fiend-${type}-hit`, { gain: FIEND_HIT_GAIN })) return;

    this._playImpactCrack(this._ctx.currentTime, 0.25, 3000, 'bandpass');
  }

  _playSweep(freqStart, freqEnd, type, duration, startTime, gain = 0.3) {
    this._ensureCtx();
    if (this._muted) return;

    const osc = this._ctx.createOscillator();
    const gainNode = this._ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), startTime + duration);
    this._shapeEnvelope(gainNode.gain, gain, startTime, duration);

    osc.connect(gainNode);
    gainNode.connect(this._effectsBus);
    this._trackVoice(osc, [osc, gainNode]);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  // filterFreqEnd sweeps the filter's cutoff/center frequency over the burst's
  // duration (e.g. a bandpass sweeping upward reads as a fast "whoosh"/"zap"
  // rather than static hiss), and Q narrows a bandpass filter for a more
  // focused, airy swish instead of broadband noise.
  _playNoiseBurst(duration, startTime, gain = 0.3, filterFreq = null, filterType = 'lowpass', filterFreqEnd = null, Q = null) {
    this._ensureCtx();
    if (this._muted) return;

    const buf = this._ctx.createBuffer(1, Math.max(1, Math.floor(this._ctx.sampleRate * duration)), this._ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    const gainNode = this._ctx.createGain();
    this._shapeEnvelope(gainNode.gain, gain, startTime, duration);

    const nodes = [src, gainNode];
    let tail = src;
    if (filterFreq) {
      const filter = this._ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(filterFreq, startTime);
      if (filterFreqEnd) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(1, filterFreqEnd), startTime + duration);
      }
      if (Q !== null) filter.Q.setValueAtTime(Q, startTime);
      tail.connect(filter);
      nodes.push(filter);
      tail = filter;
    }
    tail.connect(gainNode);
    gainNode.connect(this._effectsBus);
    this._trackVoice(src, nodes);
    src.start(startTime);
  }

  // Short, punchy noise transient with an almost-instant decay — the "smack"
  // of a hit landing, layered under a boomier tail for weight.
  _playImpactCrack(startTime, gain, filterFreq, filterType = 'highpass') {
    this._playNoiseBurst(0.035, startTime, gain, filterFreq, filterType);
  }

  /**
   * A fireball leaving the hero's hand. The sample runs as long as the
   * projectile is in the air (1.35 s of flight), so the launch covers the
   * travel instead of blipping once; the impact cue picks up where it ends.
   */
  playFireballCast() {
    this._ensureCtx();
    if (this._muted) return;
    if (this._playCue('fire-cast', { gain: SPELL_CAST_GAIN })) return;
    const t = this._ctx.currentTime;
    // A fast, narrow bandpass sweep reads as a real air-splitting "swish"
    // rather than plain hiss; a rising pitched sawtooth underneath gives the
    // flame body its whooshing launch energy.
    this._playNoiseBurst(0.24, t, 0.35, 700, 'bandpass', 3200, 6);
    this._playSweep(250, 720, 'sawtooth', 0.2, t, 0.16);
  }

  /**
   * A fireball landing: one of the three blast samples, with the layered synth
   * impact until they are decoded (or for good when they cannot be loaded).
   */
  playFireballHit() {
    this._ensureCtx();
    if (this._muted) return;
    if (this._playCue('fire-impact', { gain: SPELL_IMPACT_GAIN })) return;
    const t = this._ctx.currentTime;
    // Layered impact: an instant crack transient for the "smack", a fast
    // pitch-drop thump for punch, and a rumbling boom tail for weight.
    this._playImpactCrack(t, 0.4, 3500);
    this._playSweep(260, 45, 'sine', 0.22, t, 0.6);
    this._playNoiseBurst(0.4, t, 0.35, 1000, 'lowpass');
  }

  /**
   * A lightning bolt leaving the hero's hand, sized to its 0.46 s flight.
   */
  playLightningCast() {
    this._ensureCtx();
    if (this._muted) return;
    if (this._playCue('bolt-cast', { gain: SPELL_CAST_GAIN })) return;
    const t = this._ctx.currentTime;
    // Bright, fast bandpass sweep for the "zzzt" swish, plus a jittery
    // descending buzz to sell the electric crackle.
    this._playNoiseBurst(0.14, t, 0.3, 5500, 'bandpass', 1800, 10);
    this._playSweep(2800, 500, 'square', 0.14, t, 0.15);
  }

  /**
   * A lightning strike landing: one of the three crack samples, with the synth
   * snap and thunder until they are decoded (or for good when they cannot be).
   */
  playLightningHit() {
    this._ensureCtx();
    if (this._muted) return;
    if (this._playCue('bolt-impact', { gain: SPELL_IMPACT_GAIN })) return;
    const t = this._ctx.currentTime;
    // A sharp snap transient reads as the electric strike, backed by a
    // short thunderclap rumble for impact weight.
    this._playImpactCrack(t, 0.5, 6000);
    this._playSweep(200, 40, 'sawtooth', 0.28, t, 0.35);
    this._playNoiseBurst(0.3, t, 0.3, 500, 'lowpass');
  }

  playDragonRoar() {
    this._ensureCtx();
    if (this._muted) return;

    if (this._playCue('dragon-roar', { gain: DRAGON_ROAR_GAIN })) return;

    const t = this._ctx.currentTime;
    // Deep, descending guttural tones with a rumbling noise bed.
    this._playTone(140, 'sawtooth', 0.5, t, 0.3);
    this._playTone(100, 'sawtooth', 0.45, t + 0.08, 0.28);
    this._playTone(70, 'sawtooth', 0.4, t + 0.18, 0.25);
    this._playNoiseBurst(0.6, t, 0.3, 600, 'lowpass');
  }

  playDragonBreath() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
    // Falling fiery sweep with a hissing crackle as the breath washes over foes.
    this._playSweep(220, 60, 'sawtooth', 0.5, t, 0.25);
    this._playNoiseBurst(0.5, t, 0.3, 2500, 'highpass');
  }

  /**
   * The glass orb being struck: the click of a spell button, not the spell.
   *
   * A shatter is a noise crack plus a shower of inharmonic high partials, all
   * decaying much faster than a musical tone; the low body under it is the
   * knuckle-on-glass thud. The partials are deliberately unrelated to each other
   * (no fifth, no octave) because that is what makes glass read as glass and a
   * chime read as a chime.
   *
   * @returns {boolean} whether the cue played.
   */
  playAbilityPress() {
    this._ensureCtx();
    if (this._muted) return false;
    const t = this._ctx.currentTime;
    // The crack: a noise burst with body. The first version high-passed at
    // 5.2 kHz, which left only the hiss and read as a tick on a phone speaker;
    // 2.6 kHz keeps the glassy edge but leaves enough energy to hear over the
    // music.
    this._playNoiseBurst(0.13, t, 0.62, 2600, 'highpass');
    this._playNoiseBurst(0.26, t + 0.05, 0.34, 5200, 'bandpass', 3000, 2.5);
    // The shards: unrelated high partials, each shorter than the last.
    const shards = [
      [3120, 0.2, 0.16],
      [4460, 0.17, 0.13],
      [5870, 0.14, 0.11],
      [7340, 0.11, 0.09],
      [2610, 0.24, 0.1],
    ];
    shards.forEach(([freq, duration, gain], i) => {
      this._playTone(freq, 'triangle', duration, t + i * 0.014, gain);
    });
    // The body of the ball: a short dull thud so the burst has weight.
    this._playSweep(340, 110, 'sine', 0.16, t, 0.36);
    this._playTone(196, 'sine', 0.2, t + 0.01, 0.18);
    return true;
  }

  /**
   * The orb refusing: a spell that is still cooling. Not the shatter — nothing
   * broke — just a dull double tap that says "not yet", so a press on a cooling
   * orb never feels like a dead button.
   *
   * @returns {boolean} whether the cue played.
   */
  playAbilityRefused() {
    this._ensureCtx();
    if (this._muted) return false;
    const t = this._ctx.currentTime;
    this._playTone(150, 'sine', 0.1, t, 0.24);
    this._playTone(120, 'sine', 0.12, t + 0.08, 0.2);
    this._playNoiseBurst(0.05, t, 0.16, 900, 'lowpass');
    return true;
  }

  /**
   * One-shot cue for a successful ability cast. Each ability keeps its own
   * texture so the three buttons are tellable apart with the screen hidden:
   * wind is an airy rising whoosh, storm a crackling electric snap and earth a
   * low ground-shaking thud. Unknown ids stay silent, and a muted engine makes
   * no nodes at all.
   * @param {'wind' | 'storm' | 'earth'} id
   * @returns {boolean} whether a cue was played.
   */
  playAbilityCast(id) {
    this._ensureCtx();
    if (this._muted) return false;
    const t = this._ctx.currentTime;
    if (id === 'wind') {
      // Wide bandpass noise sweeping upward reads as air being pulled, and a
      // bright triangle sweep gives the gust a pitched body.
      this._playNoiseBurst(0.32, t, 0.3, 500, 'bandpass', 3600, 4);
      this._playSweep(320, 1180, 'triangle', 0.28, t, 0.18);
      this._playTone(880, 'sine', 0.16, t + 0.18, 0.07);
      return true;
    }
    if (id === 'storm') {
      // The zap: a narrow high bandpass snaps down into a thunderclap rumble.
      this._playNoiseBurst(0.18, t, 0.32, 6200, 'bandpass', 1400, 9);
      this._playSweep(2600, 420, 'square', 0.2, t, 0.14);
      this._playSweep(180, 40, 'sawtooth', 0.32, t + 0.06, 0.3);
      return true;
    }
    if (id === 'earth') {
      // The thud: a deep sine drop under a gravelly low-passed rumble.
      this._playTone(96, 'sine', 0.34, t, 0.34);
      this._playSweep(140, 42, 'sawtooth', 0.3, t + 0.02, 0.26);
      this._playNoiseBurst(0.36, t, 0.3, 520, 'lowpass');
      return true;
    }
    return false;
  }

  /**
   * Hold-to-heal charge: one looping bed that starts with the hold, climbs in
   * pitch and level as the charge grows, and stops on release. `progress` is
   * 0..1, or null/0 to stop. Safe to call every frame.
   */
  setHealCharge(progress) {
    if (progress === null || progress === undefined || !(progress > 0)) {
      this.stopHealCharge();
      return;
    }
    this._ensureCtx();
    if (this._muted) return;
    const amount = Math.min(1, progress);
    const existing = this._healChargeVoice;
    const voice = existing && this._voices.has(existing) ? existing : this._startHealCharge();
    if (!voice) return;
    this._setParam(voice.source.playbackRate, 1 + HEAL_CHARGE_RATE_RANGE * amount);
    this._setParam(voice.gain.gain, HEAL_CHARGE_GAIN + HEAL_CHARGE_GAIN_RANGE * amount);
  }

  // One bed at a time: the charge is a state, not an event, so repeated frames
  // must never stack a second loop on top of the first.
  _startHealCharge() {
    const buffer = this._cueBuffers.get('heal-charge-1.mp3');
    if (!buffer) {
      this._loadCueFile('heal-charge-1.mp3');
      return null;
    }
    const voice = this._playSample(buffer, { gain: HEAL_CHARGE_GAIN, loop: true });
    this._healChargeVoice = voice;
    return voice;
  }

  stopHealCharge() {
    const voice = this._healChargeVoice;
    this._healChargeVoice = null;
    if (!voice) return;
    this._voices.delete(voice);
    try {
      voice.source.stop();
    } catch {
      // Already stopped.
    }
    voice.nodes.forEach(node => {
      try {
        node.disconnect();
      } catch {
        // Already released.
      }
    });
  }

  _setParam(param, value) {
    if (!param) return;
    if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, this._ctx.currentTime);
    else param.value = value;
  }

  /**
   * The defeat cue for a fiend type, falling back to the generic synth descent
   * while the type's samples load (or when the type is unknown).
   */
  playEnemyDeath(type) {
    this._ensureCtx();
    if (this._muted) return;

    if (type && this._playCue(`fiend-${type}-death`, { gain: FIEND_DEATH_GAIN })) return;

    const t = this._ctx.currentTime;
    [660, 550, 440, 330].forEach((f, i) => this._playTone(f, 'square', 0.05, t + i * 0.06));
  }

  /**
   * The hero taking a hit. `delay` lets main.js land the cue with the strike
   * animation instead of on the answer beep itself.
   */
  playHeroHurt(delay = 0) {
    this._ensureCtx();
    if (this._muted) return;

    if (this._playCue('hero-hurt', { gain: HERO_HURT_GAIN, delay })) return;

    const t = this._ctx.currentTime + Math.max(0, delay);
    this._playTone(80, 'sine', 0.2, t, 0.4);
    this._playTone(220, 'triangle', 0.15, t + 0.05, 0.2);
  }

  playLevelClear() {
    this._ensureCtx();
    if (this._muted) return;
    const notes = [261, 294, 330, 392, 523, 392, 659, 523];
    const t = this._ctx.currentTime;
    notes.forEach((f, i) => this._playTone(f, 'square', 0.08, t + i * 0.1));
  }

  // The confetti pop that lands with the levelWon burst, under the hymn.
  playWinPop() {
    this._ensureCtx();
    if (this._muted) return;
    this._playCue('win-pop', { gain: WIN_POP_GAIN });
  }

  // The combo just reached a new ability band: the sword answers with a chime
  // before the spell that band unlocks.
  playSwordGain() {
    this._ensureCtx();
    if (this._muted) return;
    this._playCue('sword-gain', { gain: SWORD_GAIN_GAIN });
  }

  playGameOver() {
    this._ensureCtx();
    if (this._muted) return;

    if (this._playCue('game-over', { gain: GAME_OVER_GAIN })) return;

    const notes = [440, 392, 349, 330, 294, 261];
    const t = this._ctx.currentTime;
    notes.forEach((f, i) => this._playTone(f, 'sawtooth', 0.12, t + i * 0.15));
  }

  startBGM(chapter) {
    this._ensureCtx();
    this._stopVictoryHymn();
    this._menuRequest += 1;
    this._menuPlayBlocked = false;
    this._rotation.stop();
    this._musicSession = { level: null, chapter: chapter ?? null, paused: false };
    this._refreshMusic();
    this._startPlaylist(chapter ?? null);
  }

  /**
   * Start the title/menu playlist. Idempotent on purpose: navigating between
   * title pages must not restart or interrupt whatever is already playing.
   *
   * Safe to call without a user gesture. If the browser blocks the first
   * attempt under its autoplay rules the session stays resumable, so the next
   * call inside a real gesture retries playback instead of leaving the title
   * permanently silent.
   */
  startMenuBGM() {
    this._ensureCtx();
    this._stopVictoryHymn();
    if (this._musicSession?.menu) {
      // Only a paused session or a blocked first attempt needs a retry; while
      // the track is playing this stays a no-op so switching title pages
      // cannot restart it.
      if (this._menuPlayBlocked || this._musicSession.paused) {
        this._menuPlayBlocked = false;
        this.resumeBGM();
      }
      return;
    }
    const request = ++this._menuRequest;
    const begin = () => {
      // A level, a stop or a newer request took over while the playlist loaded.
      if (request !== this._menuRequest) return;
      this._rotation.stop();
      this._musicSession = { level: null, menu: true, chapter: null, paused: false };
      this._refreshMusic();
      this._startPlaylist(null);
    };
    // Waiting for level-music.json keeps the first menu track from being
    // swapped (and restarted) a moment after it starts.
    if (this._levelMusicReady) begin();
    else this._levelMusicReady = this._loadLevelMusic().then(begin, begin);
  }

  startLevelBGM(level, chapter) {
    this._ensureCtx();
    this._stopVictoryHymn();
    this._menuRequest += 1;
    this._menuPlayBlocked = false;
    this._rotation.stop();
    this._musicSession = { level, chapter: chapter ?? null, paused: false };
    this._refreshMusic();
    this._startPlaylist(chapter ?? null);
    if (!this._levelMusicReady) this._levelMusicReady = this._loadLevelMusic();
  }

  /**
   * Play the freshly refreshed playlist. A single-track playlist (the menu and
   * every level) loops through a decoded buffer, which wraps with no gap; longer
   * playlists, and any context without decode support, keep the media-element
   * rotation.
   */
  _startPlaylist(chapter) {
    const tracks = this._rotation.tracks;
    const canLoop = tracks.length === 1 && this._ctx &&
      typeof this._ctx.decodeAudioData === 'function' && typeof this._ctx.createBufferSource === 'function';
    if (canLoop) {
      const file = tracks[0].file;
      this._loopOwnsMusic = true;
      this._rotation.stop();
      this._startLoop(file);
      return;
    }
    this._loopOwnsMusic = false;
    this._loop?.stop();
    this._rotation.start(chapter ?? null);
  }

  _startLoop(file) {
    try {
      this._loop ??= new MusicLoop({
        ctx: this._ctx,
        destination: this._musicBus,
        load: name => this._loadTrackBytes(name),
      });
    } catch (error) {
      this._fallBackToRotation(error);
      return;
    }
    this._loop.play(file).catch(error => this._fallBackToRotation(error));
  }

  _fallBackToRotation(error) {
    // A playlist that cannot be decoded still plays through a media element.
    console.warn('Seamless music loop unavailable; using the media element path:', error);
    this._loopOwnsMusic = false;
    this._loop?.stop();
    if (!this._musicSession || this._musicSession.paused) return;
    this._rotation.start(this._musicSession.chapter ?? null);
  }

  // Fetches any bundled audio file (music track, hymn or sound effect) as
  // bytes; the caller decodes it.
  _loadTrackBytes(file) {
    const url = new URL(file, this._musicBaseUrl).href;
    if (!this._fetchTrack) return Promise.reject(new Error('No fetch available for bundled audio'));
    // A full byte range is what answers with a real body on the capacitor:
    // scheme; status 0 stays accepted for older shells.
    return Promise.resolve(this._fetchTrack(url, { headers: { Range: 'bytes=0-' } }))
      .then(response => {
        if (!response || (response.ok === false && response.status !== 0)) {
          throw new Error(`bundled audio ${response?.status ?? 'unavailable'}`);
        }
        return response.arrayBuffer();
      });
  }

  stopBGM() {
    this._menuRequest += 1;
    this._menuPlayBlocked = false;
    this._musicSession = null;
    this._musicRefreshPending = false;
    this._loopOwnsMusic = false;
    this._loop?.stop();
    this._rotation.stop();
  }

  pauseBGM() {
    if (this._musicSession) this._musicSession.paused = true;
    this._loop?.pause();
    this._rotation.pause();
  }

  resumeBGM() {
    if (!this._musicSession) return;
    // Returning to the app after an interruption leaves the context
    // interrupted; without this the resumed source is queued on a context
    // that never runs again (`_ensureCtx` also covers the gesture retry).
    this._ensureCtx();
    this._musicSession.paused = false;
    if (this._musicRefreshPending) {
      this._refreshMusic();
      this._startPlaylist(this._musicSession.chapter);
    } else if (this._loopOwnsMusic) {
      this._loop?.resume();
    } else {
      this._rotation.resume();
    }
  }

  get muted() {
    return this._muted;
  }

  // Idempotent so a restored preference can be applied without toggling.
  setMuted(value) {
    const muted = Boolean(value);
    if (this._muted === muted) return this._muted;
    this._muted = muted;
    this._updateBusGains();
    if (muted) {
      for (const voice of this._voices) {
        voice.source.stop();
        voice.nodes.forEach(node => node.disconnect());
      }
      this._voices.clear();
      this._victoryVoice = null;
    }
    this._rotation.setMuted(muted);
    return this._muted;
  }

  toggleMute() {
    return this.setMuted(!this._muted);
  }
}
