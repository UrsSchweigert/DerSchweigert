import { it } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from './audio.js';

const SINGLE = [{ file: 'background-music.mp3', title: 'Arithmo Slayer theme', stage: null }];

function fakeAudio(state) {
  return {
    src: '', currentTime: 0, volume: 1, muted: false, loop: false, preload: '',
    plays: 0, pauses: 0, onended: null,
    play() {
      this.plays++;
      state.plays++;
      return Promise.resolve();
    },
    pause() { this.pauses++; },
    addEventListener(type, handler) {
      if (type === 'ended') this.onended = handler;
    },
    removeEventListener(type, handler) {
      if (type === 'ended' && this.onended === handler) this.onended = null;
    },
    fireEnded() {
      if (this.onended) this.onended();
    },
  };
}

function engine(tracks = SINGLE) {
  const state = { plays: 0, audios: [] };
  const audio = new AudioEngine({
    tracks,
    baseUrl: null,
    makeAudio(file) {
      const element = fakeAudio(state);
      element.file = file;
      state.audios.push(element);
      return element;
    },
  });
  audio._ensureCtx = () => {};
  return { audio, state };
}

it('toggling sound on the title never starts music', () => {
  const { audio, state } = engine();
  audio.toggleMute();
  audio.toggleMute();
  assert.equal(audio.muted, false);
  assert.equal(state.plays, 0);
});

it('unmuting resumes only active gameplay music, preserving its position', () => {
  const { audio, state } = engine();
  audio.startBGM(1);
  const current = audio._rotation.currentAudio;
  current.currentTime = 12;
  audio.toggleMute();
  audio.toggleMute();
  assert.equal(state.plays, 2);
  assert.equal(current.currentTime, 12);
  audio.pauseBGM();
  audio.toggleMute();
  audio.toggleMute();
  assert.equal(state.plays, 2);
  audio.resumeBGM();
  assert.equal(state.plays, 3);
  audio.stopBGM();
  audio.toggleMute();
  audio.toggleMute();
  assert.equal(state.plays, 3);
});

it('a game started muted can play music when unmuted', () => {
  const { audio, state } = engine();
  audio.toggleMute();
  audio.startBGM(1);
  assert.equal(state.plays, 0);
  audio.toggleMute();
  assert.equal(state.plays, 1);
});

it('keeps the bundled volume and mute state on every rotated track', () => {
  const { audio, state } = engine([
    { file: 'a.mp3', stage: 1 },
    { file: 'b.mp3', stage: 2 },
  ]);
  audio.startBGM(1);
  audio.toggleMute();
  for (const element of state.audios) {
    assert.equal(element.volume, 0.35);
    assert.equal(element.loop, false);
    assert.equal(element.muted, true);
  }
});

it('advances to a different track when the current one ends', () => {
  const { audio, state } = engine([
    { file: 'a.mp3', stage: null },
    { file: 'b.mp3', stage: null },
  ]);
  audio.startBGM(null);
  const first = audio._rotation.currentAudio;
  first.fireEnded();
  const second = audio._rotation.currentAudio;
  assert.notEqual(second, first);
  assert.notEqual(second.src, first.src);
  assert.equal(second.plays, 1);
  assert.equal(state.plays, 2);
});

it('replays the single web track when it ends', () => {
  const { audio, state } = engine();
  audio.startBGM(1);
  const first = audio._rotation.currentAudio;
  first.fireEnded();
  assert.equal(audio._rotation.currentTrack.file, 'background-music.mp3');
  assert.equal(audio._rotation.currentAudio.src, 'background-music.mp3');
  assert.equal(state.plays, 2);
});

it('loads tracks.json into the rotation', async () => {
  const state = { plays: 0, audios: [] };
  let requested = null;
  const audio = new AudioEngine({
    manifestUrl: 'tracks.json',
    baseUrl: null,
    fetchManifest: async (url) => {
      requested = url;
      return { tracks: [{ file: 'a.mp3' }, { file: 'b.mp3' }] };
    },
    makeAudio(file) {
      const element = fakeAudio(state);
      element.file = file;
      state.audios.push(element);
      return element;
    },
  });
  audio._ensureCtx = () => {};
  await audio._manifestReady;
  assert.equal(requested, 'tracks.json');
  assert.deepEqual(audio._rotation.tracks.map((track) => track.file), ['a.mp3', 'b.mp3']);
  audio.startBGM(1);
  assert.equal(state.plays, 1);
});

it('keeps the bundled fallback track when the manifest cannot load', async () => {
  const state = { plays: 0, audios: [] };
  const audio = new AudioEngine({
    baseUrl: null,
    fetchManifest: async () => { throw new Error('offline'); },
    makeAudio(file) {
      const element = fakeAudio(state);
      element.file = file;
      state.audios.push(element);
      return element;
    },
  });
  audio._ensureCtx = () => {};
  await audio._manifestReady;
  audio.startBGM(1);
  assert.equal(state.audios[0].file, 'background-music.mp3');
  assert.equal(state.plays, 1);
});
