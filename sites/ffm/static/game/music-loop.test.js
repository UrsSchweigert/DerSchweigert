// music-loop.test.js — the background music must wrap without losing audio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicLoop } from './music-loop.js';

function fakeContext({ duration = 30 } = {}) {
  const sources = [];
  return {
    currentTime: 0,
    sources,
    decodeAudioData: async () => ({ duration }),
    createBufferSource() {
      const source = {
        buffer: null, loop: false, loopStart: 0, loopEnd: 0,
        connected: null, started: null, stopped: false, disconnected: false,
        connect(node) { this.connected = node; },
        disconnect() { this.disconnected = true; },
        start(when, offset) { this.started = { when, offset }; },
        stop() { this.stopped = true; },
      };
      sources.push(source);
      return source;
    },
  };
}

function setup({ duration = 30, bytes = 'audio' } = {}) {
  const ctx = fakeContext({ duration });
  const destination = { connect() {} };
  const loaded = [];
  const loop = new MusicLoop({
    ctx,
    destination,
    load: async (file) => { loaded.push(file); return bytes; },
  });
  return { ctx, loop, destination, loaded };
}

test('plays the track as a seamless loop on the music bus', async () => {
  const { ctx, loop, destination } = setup({ duration: 44.65 });
  await loop.play('menu.mp3');
  const [source] = ctx.sources;
  assert.equal(source.buffer.duration, 44.65);
  assert.equal(source.loop, true, 'the source must loop itself');
  assert.equal(source.loopStart, 0);
  assert.equal(source.loopEnd, 44.65);
  assert.equal(source.connected, destination, 'plays straight into the music bus');
  assert.deepEqual(source.started, { when: 0, offset: 0 });
  assert.equal(loop.file, 'menu.mp3');
  assert.equal(loop.playing, true);
});

test('never restarts a track that is already loaded', async () => {
  const { ctx, loop, loaded } = setup();
  await loop.play('menu.mp3');
  loop.stop();
  await loop.play('menu.mp3');
  assert.deepEqual(loaded, ['menu.mp3'], 'the decoded track is reused');
});

test('pause remembers the position and resume continues from it', async () => {
  const { ctx, loop } = setup({ duration: 20 });
  await loop.play('menu.mp3');
  ctx.currentTime = 3.5;
  loop.pause();
  assert.equal(loop.playing, false);
  assert.equal(ctx.sources[0].stopped, true);

  ctx.currentTime = 9;            // time passes while paused
  loop.resume();
  const resumed = ctx.sources[1];
  assert.equal(resumed.loop, true);
  assert.deepEqual(resumed.started, { when: 0, offset: 3.5 }, 'resumes where it stopped');
});

test('the position wraps around the loop instead of running past the end', async () => {
  const { ctx, loop } = setup({ duration: 10 });
  await loop.play('menu.mp3');
  ctx.currentTime = 12;           // 12 s into a 10 s loop
  loop.pause();
  loop.resume();
  assert.deepEqual(ctx.sources[1].started, { when: 0, offset: 2 });
});

test('a different track replaces the decoded one', async () => {
  const { ctx, loop, loaded } = setup();
  await loop.play('menu.mp3');
  await loop.play('level.mp3');
  assert.deepEqual(loaded, ['menu.mp3', 'level.mp3']);
  assert.equal(loop.file, 'level.mp3');
  assert.equal(ctx.sources[0].stopped, true, 'the previous source is released');
});

test('rejects a track that decodes to nothing', async () => {
  const { ctx } = setup();
  const loop = new MusicLoop({ ctx: { ...ctx, decodeAudioData: async () => ({ duration: 0 }) }, destination: { connect() {} }, load: async () => 'x' });
  await assert.rejects(() => loop.play('broken.mp3'), /no audio/);
});

test('stop rewinds but keeps the decoded track cached', async () => {
  const { ctx, loop, loaded } = setup({ duration: 15 });
  await loop.play('menu.mp3');
  ctx.currentTime = 5;
  loop.stop();
  assert.equal(loop.playing, false);
  await loop.play('menu.mp3');
  assert.deepEqual(loaded, ['menu.mp3']);
  assert.deepEqual(ctx.sources[1].started, { when: 0, offset: 0 }, 'starts from the beginning again');
});
