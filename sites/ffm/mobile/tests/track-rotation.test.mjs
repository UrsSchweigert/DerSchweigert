// track-rotation.test.mjs — manifest-driven BGM rotation, driven by fake audio.
//
// These tests live in the app test directory because the app manifest is the
// one that will grow at M4; the rotation module itself is shared web code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrackRotation, selectTrackIndex } from '../../static/game/track-rotation.js';
import { MUSIC_TRACKS } from '../game/music-manifest.js';
import { isExcluded } from '../scripts/copy-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(root, '..', 'static', 'game');

function fakeAudio(state) {
  return (file) => {
    const element = {
      file, src: '', currentTime: 0, volume: 1, muted: false, loop: false, preload: '',
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
    state.audios.push(element);
    return element;
  };
}

function rotationFor(tracks, { rng = Math.random, volume } = {}) {
  const state = { plays: 0, audios: [] };
  const rotation = new TrackRotation({
    tracks,
    makeAudio: fakeAudio(state),
    rng,
    baseUrl: null,
    volume,
  });
  return { rotation, state };
}

const THREE = [
  { file: 'a.mp3', stage: 1 },
  { file: 'b.mp3', stage: 2 },
  { file: 'c.mp3', stage: 1 },
];

test('selectTrackIndex prefers stage-tagged tracks but falls back to any', () => {
  assert.equal(selectTrackIndex(THREE, { stage: 2, rng: () => 0 }), 1);
  assert.equal(selectTrackIndex(THREE, { stage: 9, rng: () => 0 }), 0);
  assert.equal(selectTrackIndex([], { rng: () => 0 }), -1);
});

test('selectTrackIndex avoids the current track when another candidate exists', () => {
  assert.equal(selectTrackIndex(THREE, { avoidIndex: 0, rng: () => 0 }), 1);
  assert.equal(selectTrackIndex(THREE, { avoidIndex: 1, rng: () => 0 }), 0);
  assert.equal(
    selectTrackIndex([{ file: 'only.mp3' }], { avoidIndex: 0, rng: () => 0 }),
    0,
    'a single-track manifest keeps looping that track',
  );
});

test('starting plays the current track and preloads only the next one', () => {
  const { rotation, state } = rotationFor(THREE);
  rotation.start();

  assert.equal(state.audios.length, 2, 'current plus one preload');
  assert.equal(rotation.currentAudio.plays, 1);
  assert.equal(rotation.nextAudio.plays, 0, 'the preloaded track stays silent');
  assert.equal(rotation.nextAudio.src, rotation.nextTrack.file);
  assert.notEqual(rotation.nextTrack.file, rotation.currentTrack.file);
});

test('ending a track advances to the preloaded one and preloads its successor', () => {
  const { rotation, state } = rotationFor(THREE);
  rotation.start();
  const preloaded = rotation.nextAudio;

  rotation.currentAudio.fireEnded();

  assert.equal(rotation.currentAudio, preloaded);
  assert.equal(rotation.currentAudio.plays, 1);
  assert.equal(state.audios.length, 3);
  assert.equal(state.audios.filter((element) => element.plays === 0).length, 1);
});

test('a session never repeats the same track immediately', () => {
  const { rotation } = rotationFor(THREE);
  rotation.start();
  let previous = rotation.currentTrack.file;
  for (let i = 0; i < 30; i++) {
    rotation.currentAudio.fireEnded();
    assert.notEqual(rotation.currentTrack.file, previous);
    previous = rotation.currentTrack.file;
  }
});

test('stage tags steer both the current and the preloaded track', () => {
  const { rotation } = rotationFor(THREE, { rng: () => 0 });
  rotation.start(1);
  assert.equal(rotation.currentTrack.file, 'a.mp3');
  assert.equal(rotation.nextTrack.file, 'c.mp3');

  rotation.currentAudio.fireEnded();
  assert.equal(rotation.currentTrack.file, 'c.mp3');
  assert.equal(rotation.nextTrack.file, 'a.mp3');
});

test('volume and mute survive rotation and the preload', () => {
  const { rotation, state } = rotationFor(THREE);
  rotation.start();
  for (const element of state.audios) assert.equal(element.volume, 0.35);
  assert.equal(rotation.currentAudio.loop, false);

  rotation.setMuted(true);
  assert.equal(rotation.currentAudio.muted, true);
  assert.equal(rotation.nextAudio.muted, true);
  const pausedAt = rotation.currentAudio.pauses;
  assert.ok(pausedAt > 0);

  rotation.setMuted(false);
  assert.equal(rotation.currentAudio.muted, false);
  assert.equal(rotation.nextAudio.muted, false);
  assert.equal(rotation.currentAudio.plays, 2);
});

test('pause stops advancing until resume, and stop releases the elements', () => {
  const { rotation } = rotationFor(THREE);
  rotation.start();
  const current = rotation.currentAudio;

  rotation.pause();
  assert.equal(rotation.active, false);
  current.fireEnded();
  assert.equal(rotation.currentAudio, current, 'an inactive session ignores ended');

  rotation.resume();
  assert.equal(rotation.active, true);
  assert.equal(current.plays, 2);

  rotation.stop();
  assert.equal(rotation.currentAudio, null);
  assert.equal(current.currentTime, 0);
  assert.equal(rotation.resume(), null);
});

test('both bundled manifests list the existing track and credit every file', async () => {
  const manifests = await Promise.all([
    readFile(join(staticDir, 'tracks.json'), 'utf8'),
    readFile(join(root, 'game', 'tracks.json'), 'utf8'),
  ]);
  for (const json of manifests) {
    const { tracks } = JSON.parse(json);
    assert.ok(tracks.some((track) => track.file === 'background-music.mp3'));
    for (const track of tracks) {
      assert.ok(
        MUSIC_TRACKS.some((credit) => credit.file === track.file),
        `${track.file} needs a licence credit`,
      );
    }
  }
});

test('level music config ships in the app and refers to credited bundled tracks', async () => {
  const config = JSON.parse(await readFile(join(staticDir, 'level-music.json'), 'utf8'));
  const web = JSON.parse(await readFile(join(staticDir, 'tracks.json'), 'utf8')).tracks;
  const mobile = JSON.parse(await readFile(join(root, 'game', 'tracks.json'), 'utf8')).tracks;
  assert.equal(isExcluded('game/level-music.json'), false);
  for (const [level, files] of Object.entries(config.levels)) {
    assert.ok(Number.isInteger(Number(level)) && Number(level) >= 1 && Number(level) <= 60);
    assert.ok(Array.isArray(files));
    for (const file of files) {
      assert.match(file, /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9._/-]+$/);
      assert.ok(web.some(track => track.file === file), `${file} missing from web manifest`);
      assert.ok(mobile.some(track => track.file === file), `${file} missing from mobile manifest`);
      assert.ok(MUSIC_TRACKS.some(track => track.file === file), `${file} missing a credit`);
      await readFile(join(staticDir, file));
    }
  }
});

test('prepares both elements before playback and releases graph hooks on rotation and stop', () => {
  const state = { plays: 0, audios: [] };
  const prepared = [], released = [];
  const rotation = new TrackRotation({
    tracks: THREE, makeAudio: fakeAudio(state), baseUrl: 'https://localhost/game/',
    prepareAudio(element, file) {
      assert.equal(element.src, `https://localhost/game/${file}`);
      assert.equal(element.plays, 0);
      prepared.push(element);
      return element;
    },
    releaseAudio: element => released.push(element),
  });
  rotation.start();
  assert.equal(prepared.length, 2);
  const first = rotation.currentAudio, preload = rotation.nextAudio;
  first.fireEnded();
  assert.deepEqual(released, [first]);
  assert.equal(rotation.currentAudio, preload);
  assert.equal(prepared.length, 3);
  rotation.pause();
  rotation.resume();
  assert.equal(prepared.length, 3, 'resume never captures an element twice');
  rotation.stop();
  assert.equal(released.length, 3);
});

test('a preparation hook may replace a captured element before listeners and playback bind', () => {
  const state = { plays: 0, audios: [] };
  const rotation = new TrackRotation({
    tracks: THREE, makeAudio: fakeAudio(state),
    prepareAudio: element => ({ ...element, src: element.src, replacement: true }),
  });
  rotation.start();
  assert.equal(rotation.currentAudio.replacement, true);
  assert.equal(rotation.currentAudio.plays, 1);
  assert.equal(state.audios[0].plays, 0);
  assert.equal(state.audios[0].onended, null);
  rotation.currentAudio.fireEnded();
  assert.equal(state.plays, 2);
});
