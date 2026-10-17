import { it } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from './audio.js';

function engine() {
  const audio = Object.create(AudioEngine.prototype);
  Object.assign(audio, {
    _muted: false, _bgmActive: false, _bgmNodes: [], _bgmTimer: null,
    _ensureCtx() {},
    _bgmAudio: {
      currentTime: 0, plays: 0, pauses: 0,
      play() { this.plays++; return Promise.resolve(); },
      pause() { this.pauses++; },
    },
  });
  return audio;
}

it('toggling sound on the title never starts music', () => {
  const audio = engine();
  audio.toggleMute();
  audio.toggleMute();
  assert.equal(audio.muted, false);
  assert.equal(audio._bgmAudio.plays, 0);
});

it('unmuting resumes only active gameplay music, preserving its position', () => {
  const audio = engine();
  audio.startBGM(1);
  audio._bgmAudio.currentTime = 12;
  audio.toggleMute();
  audio.toggleMute();
  assert.equal(audio._bgmAudio.plays, 2);
  assert.equal(audio._bgmAudio.currentTime, 12);
  audio.pauseBGM();
  audio.toggleMute();
  audio.toggleMute();
  assert.equal(audio._bgmAudio.plays, 2);
  audio.resumeBGM();
  assert.equal(audio._bgmAudio.plays, 3);
  audio.stopBGM();
  audio.toggleMute();
  audio.toggleMute();
  assert.equal(audio._bgmAudio.plays, 3);
});

it('a game started muted can play music when unmuted', () => {
  const audio = engine();
  audio.toggleMute();
  audio.startBGM(1);
  assert.equal(audio._bgmAudio.plays, 0);
  audio.toggleMute();
  assert.equal(audio._bgmAudio.plays, 1);
});
