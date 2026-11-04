// audio.js — Web Audio API chiptune engine for Arithmo Slayer

import { DEFAULT_VOLUME, TrackRotation } from './track-rotation.js';

// Used until tracks.json loads (and when it cannot be fetched), so the game
// always has the one bundled track. The manifest holds the credited metadata.
const FALLBACK_TRACKS = Object.freeze([Object.freeze({ file: 'background-music.mp3' })]);

export class AudioEngine {
  constructor({ tracks = null, manifestUrl = null, makeAudio = null, fetchManifest = null, baseUrl } = {}) {
    this._ctx = null;
    this._muted = false;
    this._rotation = new TrackRotation({
      tracks: tracks ?? FALLBACK_TRACKS,
      makeAudio: makeAudio ?? (() => new Audio()),
      volume: DEFAULT_VOLUME,
      baseUrl: baseUrl === undefined ? new URL('./', import.meta.url).href : baseUrl,
    });
    if (!tracks) {
      this._manifestUrl = manifestUrl ?? new URL('./tracks.json', import.meta.url).href;
      this._manifestReady = this._loadManifest(fetchManifest);
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
      if (Array.isArray(tracks) && tracks.length > 0) this._rotation.replaceTracks(tracks);
    } catch {
      // Offline or unsupported fetch: the bundled fallback track keeps playing.
    }
  }

  _ensureCtx() {
    if (!this._ctx) {
      this._ctx = new AudioContext();
    }
    if (this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
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
    gainNode.connect(this._ctx.destination);
    
    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  playCorrect() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
    this._playTone(440, 'square', 0.08, t);
    this._playTone(660, 'square', 0.08, t + 0.09);
  }

  playWrong() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
    this._playTone(300, 'sawtooth', 0.1, t);
    this._playTone(180, 'sawtooth', 0.15, t + 0.1);
  }

  playSwordSwing() {
    this._ensureCtx();
    if (this._muted) return;
    
    const buf = this._ctx.createBuffer(1, this._ctx.sampleRate * 0.06, this._ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(0.2, this._ctx.currentTime);
    src.connect(gain);
    gain.connect(this._ctx.destination);
    src.start();
    
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
    gainNode.connect(this._ctx.destination);

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
      tail = filter;
    }
    tail.connect(gainNode);
    gainNode.connect(this._ctx.destination);
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
    this._rotation.start(chapter ?? null);
  }

  stopBGM() {
    this._rotation.stop();
  }

  pauseBGM() {
    this._rotation.pause();
  }

  resumeBGM() {
    this._rotation.resume();
  }

  get muted() {
    return this._muted;
  }

  toggleMute() {
    this._muted = !this._muted;
    this._rotation.setMuted(this._muted);
  }
}
