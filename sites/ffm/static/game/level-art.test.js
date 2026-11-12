// level-art.test.js — unit tests for the level-art resolver. They read only
// the manifest JSON; no level or stage image file is opened from disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  FALLBACK_BACKGROUND_URL,
  LEVEL_ART_MANIFEST,
  levelArtUrl,
  parseLevelArtManifest,
  resolveLevelBackground,
  resolveLevelGroundY,
  stageArtUrl,
} = await import('./level-art.js');

test('levelArtUrl builds the committed level-NN.webp path', () => {
  assert.match(levelArtUrl(1), /\/levels\/level-01\.webp$/);
  assert.match(levelArtUrl(60), /\/levels\/level-60\.webp$/);
  assert.match(levelArtUrl('7'), /\/levels\/level-07\.webp$/);
  assert.match(levelArtUrl(3, 'chapter-special.webp'), /\/levels\/chapter-special\.webp$/);
});

test('levelArtUrl rejects unusable levels and non-webp files', () => {
  assert.equal(levelArtUrl(0), null);
  assert.equal(levelArtUrl(-2), null);
  assert.equal(levelArtUrl('not-a-level'), null);
  assert.equal(levelArtUrl(4, 'notes.txt'), null);
  assert.equal(levelArtUrl(4, '../../etc/passwd'), null);
});

test('stageArtUrl maps a level to its chapter stage and clamps at six', () => {
  assert.match(stageArtUrl(1), /\/stage-1\.webp$/);
  assert.match(stageArtUrl(10), /\/stage-1\.webp$/);
  assert.match(stageArtUrl(11), /\/stage-2\.webp$/);
  assert.match(stageArtUrl(35), /\/stage-4\.webp$/);
  assert.match(stageArtUrl(60), /\/stage-6\.webp$/);
  assert.match(stageArtUrl(999), /\/stage-6\.webp$/);
});

test('parseLevelArtManifest accepts raw JSON text', () => {
  const parsed = parseLevelArtManifest('{"levels":{"1":{"file":"level-01.webp"},"2":{"file":"level-02.webp"}}}');
  assert.deepEqual(parsed.levels, { 1: 'level-01.webp', 2: 'level-02.webp' });
});

test('parseLevelArtManifest tolerates malformed input', () => {
  assert.deepEqual(parseLevelArtManifest('not json').levels, {});
  assert.deepEqual(parseLevelArtManifest(null).levels, {});
  assert.deepEqual(parseLevelArtManifest('[]').levels, {});
  assert.deepEqual(parseLevelArtManifest('{"levels":null}').levels, {});
});

test('parseLevelArtManifest drops entries without a usable file', () => {
  const parsed = parseLevelArtManifest({
    levels: {
      1: { file: 'level-01.webp' },
      2: { file: '' },
      3: {},
      4: 'level-04.webp',
      5: { file: 'level-05.png' },
      '01': { file: 'level-01-copy.webp' },
    },
  });
  assert.deepEqual(parsed.levels, { 1: 'level-01.webp', 4: 'level-04.webp' });
});

test('resolveLevelBackground prefers level art, then the chapter stage', () => {
  const manifest = parseLevelArtManifest({ levels: { 12: { file: 'level-12.webp' } } });
  assert.match(resolveLevelBackground(12, manifest), /\/levels\/level-12\.webp$/);
  assert.match(resolveLevelBackground(13, manifest), /\/stage-2\.webp$/);
  assert.match(resolveLevelBackground(60, { levels: {} }), /\/stage-6\.webp$/);
});

test('resolveLevelBackground accepts the raw manifest text', () => {
  assert.match(resolveLevelBackground(3, '{"levels":{"3":{"file":"level-03.webp"}}}'), /\/levels\/level-03\.webp$/);
});

test('resolveLevelBackground falls back to the stage for unusable levels', () => {
  assert.match(resolveLevelBackground('nonsense', { levels: {} }), /\/stage-1\.webp$/);
  assert.equal(FALLBACK_BACKGROUND_URL.endsWith('/background.webp'), true);
});

test('the committed manifest exposes level art for all 60 levels', () => {
  assert.equal(Object.keys(LEVEL_ART_MANIFEST.levels).length, 60);
  assert.equal(LEVEL_ART_MANIFEST.levels['1'], 'level-01.webp');
  assert.equal(LEVEL_ART_MANIFEST.levels['60'], 'level-60.webp');
});

test('parseLevelArtManifest carries the per-level ground-line overrides', () => {
  const parsed = parseLevelArtManifest('{"levels":{"1":{"file":"level-01.webp"}},"groundY":{"1":348,"60":300}}');
  assert.deepEqual(parsed.groundY, { 1: 348, 60: 300 });
});

test('parseLevelArtManifest drops ground lines outside the drawable band', () => {
  const parsed = parseLevelArtManifest({
    levels: {},
    groundY: { 1: 239, 2: 437, 3: 240, 4: 436, 5: 'nope', 6: 320.4, '07': 300, 8: null },
  });
  assert.deepEqual(parsed.groundY, { 3: 240, 4: 436, 6: 320 });
});

test('parseLevelArtManifest tolerates a missing or broken groundY block', () => {
  assert.deepEqual(parseLevelArtManifest({ levels: {} }).groundY, {});
  assert.deepEqual(parseLevelArtManifest({ levels: {}, groundY: [] }).groundY, {});
  assert.deepEqual(parseLevelArtManifest({ levels: {}, groundY: null }).groundY, {});
  assert.deepEqual(parseLevelArtManifest({ levels: {}, groundY: 'later' }).groundY, {});
});

test('resolveLevelGroundY returns the override or null for the default', () => {
  const manifest = parseLevelArtManifest({ levels: {}, groundY: { 12: 352 } });
  assert.equal(resolveLevelGroundY(12, manifest), 352);
  assert.equal(resolveLevelGroundY('12', manifest), 352);
  assert.equal(resolveLevelGroundY(11, manifest), null);
  assert.equal(resolveLevelGroundY('nonsense', manifest), null);
  assert.equal(resolveLevelGroundY(1, '{"levels":{},"groundY":{"1":300}}'), 300);
});
