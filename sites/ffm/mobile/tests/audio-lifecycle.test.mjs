// audio-lifecycle.test.mjs — interruption pause/resume driven through lifecycle.js.
//
// The app maps OS background/interruption events to pauseGame()/resumeGame(),
// which own BGM pause/resume. These tests inject fakes: they prove the JS
// wiring stops and restores the engine once, not device audio behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../../static/game/audio.js';
import { createLifecycle } from '../game/lifecycle.js';

function fakeAppPlugin() {
  const listeners = new Map();
  return {
    addListener(eventName, callback) {
      listeners.set(eventName, callback);
      return Promise.resolve({
        remove() {
          if (listeners.get(eventName) === callback) listeners.delete(eventName);
        },
      });
    },
    emit(eventName, payload) { listeners.get(eventName)?.(payload); },
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
    removeEventListener() {},
  };
}

test('an app interruption pauses and resumes bundled music exactly once', async () => {
  const state = { plays: 0 };
  const audio = new AudioEngine({
    tracks: [{ file: 'background-music.mp3' }],
    baseUrl: null,
    makeAudio: () => fakeAudio(state),
  });
  audio._ensureCtx = () => {};
  audio.setEffectsVolume(0.4);
  const running = { playing: true, paused: false };
  const game = {
    isPlaying: () => running.playing && !running.paused,
    isPaused: () => running.paused,
    pause() {
      running.paused = true;
      audio.pauseBGM();
    },
    resume() {
      running.paused = false;
      audio.resumeBGM();
    },
    goBack: () => false,
  };
  const app = fakeAppPlugin();
  const lifecycle = createLifecycle({ app, game });
  await lifecycle.start();

  audio.startBGM(1);
  const current = audio._rotation.currentAudio;
  assert.equal(state.plays, 1);

  app.emit('appStateChange', { isActive: false });
  assert.equal(running.paused, true);
  assert.equal(current.pauses, 1);
  assert.equal(state.plays, 1, 'backgrounding does not start another track');

  app.emit('appStateChange', { isActive: true });
  assert.equal(running.paused, false);
  assert.equal(state.plays, 2, 'returning resumes the same track exactly once');
  assert.equal(current.currentTime, 0);

  app.emit('appStateChange', { isActive: true });
  assert.equal(state.plays, 2, 'a duplicate active event never replays music');
  assert.equal(audio.getEffectsVolume(), 0.4);
  assert.equal(audio.musicVolume, 0.35);
  assert.equal(audio.muted, false);
  lifecycle.stop();
});
