// renderer-background.test.js — background resolution and preload behaviour
// with a fake Image. No image file is read from disk; load and error are
// driven by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeImage {
  static instances = [];

  constructor() {
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.decoding = 'auto';
    this._src = '';
    this._listeners = new Map();
    this.srcSets = [];
    FakeImage.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this._listeners.get(type) ?? [];
    listeners.push(listener);
    this._listeners.set(type, listeners);
  }

  set src(value) {
    this._src = value;
    this.srcSets.push(value);
    this.complete = false;
    this.naturalWidth = 0;
  }

  get src() {
    return this._src;
  }

  emit(type) {
    if (type === 'load') {
      this.complete = true;
      this.naturalWidth = 1536;
      this.naturalHeight = 1024;
    }
    for (const listener of [...(this._listeners.get(type) ?? [])]) listener();
  }
}

globalThis.Image = FakeImage;
const { Renderer, GROUND_Y } = await import('./renderer.js');

function makeRenderer(manifest = { levels: {} }) {
  FakeImage.instances = [];
  const canvas = { getContext: () => ({}), parentElement: null };
  const renderer = new Renderer(canvas, manifest);
  const [background, fallback] = FakeImage.instances;
  return { renderer, background, fallback };
}

const manifestFor = (...levels) => ({
  levels: Object.fromEntries(levels.map((n) => [String(n), { file: `level-${String(n).padStart(2, '0')}.webp` }])),
});

test('the constructor requests no image until a level is set', () => {
  const { background, fallback } = makeRenderer();
  assert.equal(background.src, '');
  assert.equal(fallback.src, '');
  assert.deepEqual(background.srcSets, []);
});

test('setBackgroundByLevel uses the level image when the manifest has it', () => {
  const { renderer, background, fallback } = makeRenderer(manifestFor(3));
  renderer.setBackgroundByLevel(3);
  assert.match(background.src, /\/levels\/level-03\.webp$/);
  assert.equal(fallback.src, '', 'the legacy background is not requested up front');
});

test('setBackgroundByLevel falls back to the chapter stage when the level is missing', () => {
  const { renderer, background } = makeRenderer(manifestFor(3));
  renderer.setBackgroundByLevel(4);
  assert.match(background.src, /\/stage-1\.webp$/);
  renderer.setBackgroundByLevel(12);
  assert.match(background.src, /\/stage-2\.webp$/);
  renderer.setBackgroundByLevel(60);
  assert.match(background.src, /\/stage-6\.webp$/);
});

test('a failed level image falls back to background.webp without throwing', async () => {
  const { renderer, background, fallback } = makeRenderer(manifestFor(3));
  renderer.setBackgroundByLevel(3);
  assert.doesNotThrow(() => background.emit('error'));
  assert.match(fallback.src, /\/background\.webp$/);
  await renderer.waitForBackgroundLoad();
});

test('a failed stage image also falls back to background.webp', () => {
  const { renderer, background, fallback } = makeRenderer();
  renderer.setBackgroundByLevel(12);
  background.emit('error');
  assert.match(fallback.src, /\/background\.webp$/);
});

test('waitForBackgroundLoad resolves on load and on error', async () => {
  const { renderer, background } = makeRenderer(manifestFor(2));
  renderer.setBackgroundByLevel(2);
  const loaded = renderer.waitForBackgroundLoad();
  background.emit('load');
  await loaded;

  const { renderer: failing, background: failingBackground } = makeRenderer(manifestFor(2));
  failing.setBackgroundByLevel(2);
  const errored = failing.waitForBackgroundLoad();
  failingBackground.emit('error');
  await errored;
});

test('preloadLevelArt requests only the current and next level', () => {
  const { renderer } = makeRenderer(manifestFor(5, 6, 7));
  renderer.preloadLevelArt([5, 6]);
  const preloaded = FakeImage.instances.slice(2);
  assert.deepEqual(
    preloaded.map((image) => image.src.match(/level-\d+\.webp$/)?.[0]),
    ['level-05.webp', 'level-06.webp'],
  );
  assert.ok(preloaded.every((image) => image.decoding === 'async'));
  assert.ok(preloaded.every((image) => !/level-07\.webp$/.test(image.src)), 'level N+2 is never requested');
});

test('preloadLevelArt skips levels without a manifest entry', () => {
  const { renderer } = makeRenderer(manifestFor(5));
  renderer.preloadLevelArt([5, 6]);
  const preloaded = FakeImage.instances.slice(2);
  assert.equal(preloaded.length, 1);
  assert.match(preloaded[0].src, /level-05\.webp$/);

  renderer.preloadLevelArt([5, 6]);
  assert.equal(FakeImage.instances.slice(2).length, 1, 'repeat preloads are deduplicated');
});

test('the background cache keys on the resolved URL, not the stage index', () => {
  const staged = makeRenderer(manifestFor(11, 12));
  staged.renderer.setBackgroundByLevel(11);
  staged.renderer.setBackgroundByLevel(12);
  assert.match(staged.background.src, /level-12\.webp$/);
  assert.equal(staged.background.srcSets.length, 2, 'a new level image replaces the previous one');

  const sameStage = makeRenderer(manifestFor(11, 12));
  sameStage.renderer.setBackgroundByLevel(11);
  sameStage.renderer.setBackgroundByLevel(11);
  assert.equal(sameStage.background.srcSets.length, 1, 'the same resolved URL is not re-requested');
});

// --- per-level ground line ---------------------------------------------------

test('groundY starts at the shipped default', () => {
  const { renderer } = makeRenderer();
  assert.equal(renderer.groundY, GROUND_Y);
});

test('groundY takes the level override from the manifest', () => {
  const { renderer } = makeRenderer({ ...manifestFor(31), groundY: { 31: 336 } });
  renderer.setBackgroundByLevel(31);
  assert.equal(renderer.groundY, 336);
  renderer.setBackgroundByLevel(1);
  assert.equal(renderer.groundY, GROUND_Y, 'a level without an override falls back to the default');
});

test('groundY follows the level even when the image URL does not change', () => {
  // 1 and 2 fall back to the same chapter stage, so the image short-circuit fires.
  const { renderer, background } = makeRenderer({ levels: {}, groundY: { 2: 344 } });
  renderer.setBackgroundByLevel(1);
  const urlBefore = background.src;
  renderer.setBackgroundByLevel(2);
  assert.equal(background.src, urlBefore, 'the shared stage image is not re-requested');
  assert.equal(renderer.groundY, 344, 'but the ground line still follows the level');
});

test('groundY ignores overrides outside the drawable band', () => {
  const { renderer } = makeRenderer({ ...manifestFor(5, 6, 7), groundY: { 5: 10, 6: 5000, 7: 320 } });
  renderer.setBackgroundByLevel(5);
  assert.equal(renderer.groundY, GROUND_Y);
  renderer.setBackgroundByLevel(6);
  assert.equal(renderer.groundY, GROUND_Y);
  renderer.setBackgroundByLevel(7);
  assert.equal(renderer.groundY, 320);
});
