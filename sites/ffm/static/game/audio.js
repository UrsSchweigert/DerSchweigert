// audio.js — Web Audio API chiptune engine for Arithmo Slayer

import { DEFAULT_VOLUME, TrackRotation } from './track-rotation.js';

// Used until tracks.json loads (and when it cannot be fetched), so the game
// always has the one bundled track. The manifest holds the credited metadata.
const FALLBACK_TRACKS = Object.freeze([Object.freeze({ file: 'background-music.mp3' })]);
const EFFECTS_HEADROOM = 0.4;

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
    onMusicVolumeUnavailable = null } = {}) {
    this._ctx = null;
    this._makeContext = makeContext ?? (() => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)());
    this._effectsVolume = 1;
    this._musicVolume = DEFAULT_VOLUME;
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
    this._rotation = new TrackRotation({
      tracks: this._tracks,
      makeAudio: this._makeAudio,
      volume: DEFAULT_VOLUME,
      baseUrl: this._musicBaseUrl,
      onError: element => this._handleTrackError(element),
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
    }
    if (this._ctx.state === 'suspended') {
      const resumed = this._ctx.resume();
      resumed?.catch?.(error => console.warn('Unable to resume audio context:', error));
    }
  }

  _updateBusGains() {
    if (!this._ctx) return;
    this._effectsBus.gain.setValueAtTime(this._muted ? 0 : this._effectsVolume * EFFECTS_HEADROOM, this._ctx.currentTime);
    this._musicBus.gain.setValueAtTime(this._muted ? 0 : this._musicVolume, this._ctx.currentTime);
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
  }

  _playTone(freq, type, duration, startTime, gain = 0.3) {
    this._ensureCtx();
    if (this._muted) return;
    
    const osc = this._ctx.createOscillator();
    const gainNode = this._ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    gainNode.gain.setValueAtTime(gain, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    
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

  playSwordSwing() {
    this._ensureCtx();
    if (this._muted) return;
    
    this._playNoiseBurst(0.06, this._ctx.currentTime, 0.2, 2400, 'bandpass', 900, 2);
    
    this._playTone(1200, 'square', 0.05, this._ctx.currentTime + 0.05);
  }

  _playSweep(freqStart, freqEnd, type, duration, startTime, gain = 0.3) {
    this._ensureCtx();
    if (this._muted) return;

    const osc = this._ctx.createOscillator();
    const gainNode = this._ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), startTime + duration);
    gainNode.gain.setValueAtTime(gain, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

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
    gainNode.gain.setValueAtTime(gain, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

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

  playFireballCast() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
    // A fast, narrow bandpass sweep reads as a real air-splitting "swish"
    // rather than plain hiss; a rising pitched sawtooth underneath gives the
    // flame body its whooshing launch energy.
    this._playNoiseBurst(0.24, t, 0.35, 700, 'bandpass', 3200, 6);
    this._playSweep(250, 720, 'sawtooth', 0.2, t, 0.16);
  }

  playFireballHit() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
    // Layered impact: an instant crack transient for the "smack", a fast
    // pitch-drop thump for punch, and a rumbling boom tail for weight.
    this._playImpactCrack(t, 0.4, 3500);
    this._playSweep(260, 45, 'sine', 0.22, t, 0.6);
    this._playNoiseBurst(0.4, t, 0.35, 1000, 'lowpass');
  }

  playLightningCast() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
    // Bright, fast bandpass sweep for the "zzzt" swish, plus a jittery
    // descending buzz to sell the electric crackle.
    this._playNoiseBurst(0.14, t, 0.3, 5500, 'bandpass', 1800, 10);
    this._playSweep(2800, 500, 'square', 0.14, t, 0.15);
  }

  playLightningHit() {
    this._ensureCtx();
    if (this._muted) return;
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

  playEnemyDeath() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
    [660, 550, 440, 330].forEach((f, i) => this._playTone(f, 'square', 0.05, t + i * 0.06));
  }

  playHeroHurt() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
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

  playGameOver() {
    this._ensureCtx();
    if (this._muted) return;
    const notes = [440, 392, 349, 330, 294, 261];
    const t = this._ctx.currentTime;
    notes.forEach((f, i) => this._playTone(f, 'sawtooth', 0.12, t + i * 0.15));
  }

  startBGM(chapter) {
    this._ensureCtx();
    this._rotation.stop();
    this._musicSession = { level: null, chapter: chapter ?? null, paused: false };
    this._refreshMusic();
    this._rotation.start(chapter ?? null);
  }

  /**
   * Start the title/menu playlist. Idempotent on purpose: navigating between
   * title pages must not restart or interrupt whatever is already playing, so
   * only the first call of a menu session creates playback.
   */
  startMenuBGM() {
    this._ensureCtx();
    if (this._musicSession?.menu) {
      if (!this._rotation.active) this.resumeBGM();
      return;
    }
    const begin = () => {
      this._rotation.stop();
      this._musicSession = { level: null, menu: true, chapter: null, paused: false };
      this._refreshMusic();
      this._rotation.start(null);
    };
    // Waiting for level-music.json keeps the first menu track from being
    // swapped (and restarted) a moment after it starts.
    if (this._levelMusicReady) begin();
    else this._levelMusicReady = this._loadLevelMusic().then(begin, begin);
  }

  startLevelBGM(level, chapter) {
    this._ensureCtx();
    this._rotation.stop();
    this._musicSession = { level, chapter: chapter ?? null, paused: false };
    this._refreshMusic();
    this._rotation.start(chapter ?? null);
    if (!this._levelMusicReady) this._levelMusicReady = this._loadLevelMusic();
  }

  stopBGM() {
    this._musicSession = null;
    this._musicRefreshPending = false;
    this._rotation.stop();
  }

  pauseBGM() {
    if (this._musicSession) this._musicSession.paused = true;
    this._rotation.pause();
  }

  resumeBGM() {
    if (!this._musicSession) return;
    this._musicSession.paused = false;
    if (this._musicRefreshPending) {
      this._refreshMusic();
      this._rotation.start(this._musicSession.chapter);
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
    }
    this._rotation.setMuted(muted);
    return this._muted;
  }

  toggleMute() {
    return this.setMuted(!this._muted);
  }
}
