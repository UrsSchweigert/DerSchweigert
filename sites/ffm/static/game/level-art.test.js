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
