// audio.js — Web Audio API chiptune engine for Arithmo Slayer

export class AudioEngine {
  constructor() {
    this._ctx = null;
    this._muted = false;
    this._bgmNodes = [];
    this._bgmTimer = null;
    this._bgmAudio = new Audio(new URL('./background-music.mp3', import.meta.url).href);
    this._bgmAudio.loop = true;
    this._bgmAudio.volume = 0.35;
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

  _playNoiseBurst(duration, startTime, gain = 0.3, filterFreq = null, filterType = 'lowpass') {
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
      tail.connect(filter);
      tail = filter;
    }
    tail.connect(gainNode);
    gainNode.connect(this._ctx.destination);
    src.start(startTime);
  }

  playFireballCast() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
    // Rising ignition whoosh as the flame launches, plus a hiss of sparks.
    this._playSweep(180, 900, 'sawtooth', 0.22, t, 0.22);
    this._playNoiseBurst(0.18, t, 0.18, 3000, 'highpass');
  }

  playFireballHit() {
    this._ensureCtx();
    if (this._muted) return;
    const t = this._ctx.currentTime;
    // Low boom on impact plus a crackling explosion of noise.
    this._playTone(90, 'sine', 0.35, t, 0.5);
    this._playTone(50, 'triangle', 0.3, t + 0.03, 0.35);
    this._playNoiseBurst(0.3, t, 0.35, 1200, 'lowpass');
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
    this.stopBGM();
    if (this._muted) return;

    this._bgmAudio.currentTime = 0;
    this._bgmAudio.play().catch(() => {});
  }

  stopBGM() {
    if (this._bgmTimer) {
      clearTimeout(this._bgmTimer);
      this._bgmTimer = null;
    }
    this._bgmNodes.forEach(n => {
      try {
        n.stop();
      } catch (e) {}
    });
    this._bgmNodes = [];
    this._bgmAudio.pause();
    this._bgmAudio.currentTime = 0;
  }

  get muted() {
    return this._muted;
  }

  toggleMute() {
    this._muted = !this._muted;
    if (this._muted) {
      this.stopBGM();
    } else {
      this._bgmAudio.play().catch(() => {});
    }
  }
}
