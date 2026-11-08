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
    makeContext = null, musicGainRouting = false } = {}) {
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
    this._makeAudio = makeAudio ?? (() => new Audio());
    this._musicBaseUrl = baseUrl === undefined ? new URL('./', import.meta.url).href : baseUrl;
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
    const files = this._levelMusic?.levels?.[level];
    if (files === undefined || (Array.isArray(files) && files.length === 0)) return this._tracks;
    if (!Array.isArray(files) || files.some(file => typeof file !== 'string' ||
      !/^[a-zA-Z0-9._/-]+$/.test(file) || file.startsWith('/') || file.split('/').includes('..'))) {
      console.warn(`Invalid bundled music list for level ${level}; using normal rotation`);
      return this._tracks;
    }
    const tracks = [...new Set(files)].map(file => this._tracks.find(track => track.file === file));
    if (tracks.some(track => !track)) {
      console.warn(`Unknown bundled music track for level ${level}; using normal rotation`);
      return this._tracks;
    }
    // Per-level lists override chapter tags, including for the preload.
    return tracks.map(track => ({ ...track, stage: null }));
  }

  _refreshMusic() {
    const session = this._musicSession;
    const tracks = session?.failed ? FALLBACK_TRACKS
      : session?.level != null ? this._tracksForLevel(session.level) : this._tracks;
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
    return { supported: this._musicVolumeStatus === 'available', status: this._musicVolumeStatus };
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
    let source;
    try {
      // A media source can produce silence for cross-origin/custom-scheme media.
      // Never attach one without a same-origin HTTP(S) URL and explicit opt-in.
      const url = new URL(element.src);
      const base = new URL(this._musicBaseUrl);
      if (!/^https?:$/.test(url.protocol) || url.origin !== base.origin) {
        throw new Error('Media gain routing requires same-origin HTTP(S) assets');
      }
      if (typeof this._ctx?.createMediaElementSource !== 'function') {
        throw new Error('Media element sources unavailable');
      }
      source = this._ctx.createMediaElementSource(element);
      source.connect(this._musicBus);
      element.volume = 1;
      this._mediaSources.set(element, source);
      this._musicVolumeStatus = 'available';
      return element;
    } catch (error) {
      source?.disconnect();
      this._musicGainRouting = false;
      this._musicVolumeStatus = 'unsupported-media-routing';
      this._musicVolume = DEFAULT_VOLUME;
      this._updateBusGains();
      console.warn('Music volume control unavailable; preserving default playback:', error);
      if (!source) return element;
      // Once captured, an element cannot reliably return to direct playback.
      const replacement = this._makeAudio(file);
      for (const key of ['src', 'loop', 'preload', 'muted']) replacement[key] = element[key];
      replacement.volume = DEFAULT_VOLUME;
      element.pause();
      return replacement;
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

  toggleMute() {
    this._muted = !this._muted;
    this._updateBusGains();
    if (this._muted) {
      for (const voice of this._voices) {
        voice.source.stop();
        voice.nodes.forEach(node => node.disconnect());
      }
      this._voices.clear();
    }
    this._rotation.setMuted(this._muted);
  }
}
