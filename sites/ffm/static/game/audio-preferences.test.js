// audio-preferences.test.js — persisted mute/volume across a simulated restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from './audio.js';
import {
  AUDIO_PREFERENCES_KEY,
  applyAudioPreferences,
  applyDeferredMusicVolume,
  parseAudioPreferences,
  readAudioPreferences,
  writeAudioPreferences,
} from './audio-preferences.js';

function memoryStorage(seed) {
  const values = new Map(seed === undefined
    ? [] : [[AUDIO_PREFERENCES_KEY, JSON.stringify(seed)]]);
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function fakeAudio(state) {
  return {
    src: '', currentTime: 0, volume: 1, muted: false, loop: false, preload: '',
    plays: 0, pauses: 0, onended: null, onerror: null,
    play() { this.plays++; state.plays++; return Promise.resolve(); },
    pause() { this.pauses++; },
    addEventListener(type, handler) {
      if (type === 'ended') this.onended = handler;
      if (type === 'error') this.onerror = handler;
    },
    removeEventListener(type, handler) {
      if (type === 'ended' && this.onended === handler) this.onended = null;
      if (type === 'error' && this.onerror === handler) this.onerror = null;
    },
  };
}

function fakeContext() {
  const param = () => ({
    value: 0,
    setValueAtTime(value) { this.value = value; },
    exponentialRampToValueAtTime() {},
  });
  const node = () => ({
    connections: [],
    connect(target) { this.connections.push(target); },
    disconnect() { this.connections = []; },
    gain: param(),
    frequency: param(),
    Q: param(),
  });
  return {
    currentTime: 0, sampleRate: 1000, state: 'running',
    resume() { this.state = 'running'; return Promise.resolve(); },
    destination: node(),
    createGain: () => node(),
    createDynamicsCompressor: () => Object.assign(node(),
      Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, param()]))),
    createMediaElementSource: () => node(),
    createOscillator: () => Object.assign(node(), { start() {}, stop() {} }),
    createBufferSource: () => Object.assign(node(), { start() {} }),
    createBuffer: (_, length) => ({ getChannelData: () => new Float32Array(length) }),
    createBiquadFilter: () => node(),
  };
}

function routedEngine(start = true) {
  const state = { plays: 0 };
  const audio = new AudioEngine({
    tracks: [{ file: 'a.mp3' }],
    baseUrl: 'https://localhost/game/',
    musicGainRouting: true,
    makeContext: fakeContext,
    makeAudio: () => fakeAudio(state),
  });
  if (start) audio.startBGM();
  return { audio, state };
}

test('mute and gains survive a simulated restart through the preferences seam', () => {
  const storage = memoryStorage();
  const first = routedEngine().audio;
  first.setEffectsVolume(0.6);
  first.setMusicVolume(0.2);
  first.setMuted(true);
  assert.equal(writeAudioPreferences(storage, first), true);
  assert.deepEqual(JSON.parse(storage.getItem(AUDIO_PREFERENCES_KEY)),
    { effects: 0.6, music: 0.2, muted: true });

  const second = routedEngine(false).audio;
  const saved = readAudioPreferences(storage);
  let deferred = applyAudioPreferences(second, saved);
  assert.equal(second.muted, true);
  assert.equal(second.getEffectsVolume(), 0.6);
  assert.equal(second.getMusicVolume(), 0.2, 'music gain is restored before the first playback');
  assert.equal(deferred, null);

  second.startBGM();
  assert.equal(second.musicVolumeCapability.supported, true);
  deferred = applyDeferredMusicVolume(second, deferred);
  assert.equal(deferred, null);
  assert.equal(second.getMusicVolume(), 0.2);
  assert.equal(second._musicBus.gain.value, 0, 'restored mute still zeroes the bus');
  second.setMuted(false);
  assert.equal(second._musicBus.gain.value, 0.2);
});

test('a saved music gain applies before playback when routing is configured', () => {
  const audio = new AudioEngine({
    tracks: [{ file: 'a.mp3' }],
    baseUrl: 'https://localhost/game/',
    musicGainRouting: true,
    makeContext: fakeContext,
    makeAudio: () => fakeAudio({ plays: 0 }),
  });
  const deferred = applyAudioPreferences(audio, {
    effects: null, music: 0.5, muted: false,
  });
  assert.equal(deferred, null, 'the configured gain path accepts preferences before playback');
  assert.equal(audio.getMusicVolume(), 0.5);
  audio.startBGM();
  assert.equal(applyDeferredMusicVolume(audio, deferred), null);
  assert.equal(audio.getMusicVolume(), 0.5);
  assert.equal(audio._musicBus.gain.value, 0.5);
});

test('malformed or out-of-range preferences are ignored safely', () => {
  assert.equal(parseAudioPreferences('{not json'), null);
  assert.equal(parseAudioPreferences('null'), null);
  assert.equal(parseAudioPreferences('[]'), null);
  assert.deepEqual(parseAudioPreferences('{"effects":2,"music":-1,"muted":"yes"}'),
    { effects: 1, music: 0, muted: null });
  assert.equal(readAudioPreferences({ getItem() { throw new Error('denied'); } }), null);
  assert.equal(writeAudioPreferences({ setItem() { throw new Error('denied'); } }, {
    getEffectsVolume: () => 1, getMusicVolume: () => 0.35, muted: false,
  }), false);
});
