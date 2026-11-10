// Story diorama checks: scene manifests, layer assets, subtitles, and the
// player's pure helpers. Run: node --test sites/ffm/static/story/tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STAGE_W, STAGE_H, STAGE_SAFE, cueAt, sampleMotion, stageTransform, pickText,
} from '../player/diorama-player.js';
import { LOCALES, toVtt } from '../tools/build-subtitles.mjs';

const storyDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const scenesDir = join(storyDir, 'scenes');
const index = JSON.parse(readFileSync(join(scenesDir, 'index.json'), 'utf8'));
const sceneDirs = readdirSync(scenesDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const ROLES = new Set(['backdrop', 'midground', 'character', 'foreground']);
// Comfortable reading speed for young readers (characters per second).
const MAX_CPS = 17;

function pngInfo(file) {
  const buf = readFileSync(file);
  assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', `${file} is not a PNG`);
  // Walk the chunks so a palette cutout's alpha table (tRNS) is visible too.
  const chunks = new Set();
  for (let at = 8; at + 8 <= buf.length;) {
    const length = buf.readUInt32BE(at);
    chunks.add(buf.subarray(at + 4, at + 8).toString('latin1'));
    at += 12 + length;
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    hasAlpha: buf[25] === 6 || (buf[25] === 3 && chunks.has('tRNS')),
  };
}

/** WebP: VP8X carries the canvas size, VP8 the frame size, VP8L a bitfield. */
function webpInfo(file) {
  const buf = readFileSync(file);
  assert.equal(buf.subarray(0, 4).toString('latin1'), 'RIFF', `${file} is not a RIFF file`);
  assert.equal(buf.subarray(8, 12).toString('latin1'), 'WEBP', `${file} is not a WebP`);
  const chunk = buf.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8X') {
    return {
      width: buf.readUIntLE(24, 3) + 1,
      height: buf.readUIntLE(27, 3) + 1,
      hasAlpha: (buf[20] & 0x10) !== 0,
    };
  }
  if (chunk === 'VP8 ') {
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
      hasAlpha: false,
    };
  }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, hasAlpha: true };
  }
  throw new Error(`${file}: unknown WebP chunk ${chunk}`);
}

/** Size and transparency of a shipped layer (PNG or WebP). */
function imageInfo(file) {
  return file.endsWith('.webp') ? webpInfo(file) : pngInfo(file);
}

function loadScene(id) {
  return JSON.parse(readFileSync(join(scenesDir, id, 'scene.json'), 'utf8'));
}

describe('scene index', () => {
  it('lists every scene folder exactly once', () => {
    assert.deepEqual(index.scenes.map(entry => entry.id).sort(), sceneDirs);
  });

  it('opens each act once, at that act\'s first level', () => {
    const acts = index.scenes.filter(entry => entry.slot.type === 'act');
    assert.deepEqual(acts.map(entry => entry.slot.act).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
    const starts = acts.map(entry => entry.slot.fromLevel).sort((a, b) => a - b);
    assert.deepEqual(starts, [1, 11, 21, 31, 41, 51]);
  });

  it('gives every scene a valid insertion slot', () => {
    for (const { id, slot } of index.scenes) {
      assert.ok(['intro', 'act', 'level', 'finish'].includes(slot.type), `${id}: slot.type`);
      if (slot.type === 'act') {
        assert.ok(Number.isInteger(slot.act) && slot.act >= 1 && slot.act <= 6, `${id}: slot.act`);
        assert.ok(Number.isInteger(slot.fromLevel) && slot.fromLevel >= 1 && slot.fromLevel <= 60,
          `${id}: slot.fromLevel`);
      }
      if (slot.type === 'level') {
        assert.ok(Number.isInteger(slot.level) && slot.level >= 1 && slot.level <= 60, `${id}: slot.level`);
        assert.ok(['before', 'after'].includes(slot.when), `${id}: slot.when`);
      }
      assert.deepEqual(loadScene(id).slot, slot, `${id}: index slot matches scene.json`);
    }
  });
});

for (const id of sceneDirs) {
  describe(`scene ${id}`, () => {
    const scene = loadScene(id);

    it('has 3 or 4 depth planes with known roles and existing PNGs', () => {
      // Alternate poses (poseOf) share their base layer's plane.
      const planes = scene.layers.filter(layer => !layer.poseOf);
      assert.ok(planes.length >= 3 && planes.length <= 4);
      assert.equal(scene.layers[0].role, 'backdrop');
      assert.equal(new Set(scene.layers.map(layer => layer.id)).size, scene.layers.length);
      for (const layer of scene.layers) {
        if (layer.poseOf) {
          const base = scene.layers.find(other => other.id === layer.poseOf);
          assert.ok(base && !base.poseOf, `${layer.id}: poseOf must name a base layer`);
          assert.equal(layer.role, base.role, `${layer.id}: pose must keep the base role`);
        }
        assert.ok(ROLES.has(layer.role), `${layer.id}: role ${layer.role}`);
        const file = join(scenesDir, id, layer.src);
        assert.ok(existsSync(file), `${layer.id}: ${layer.src} missing`);
        assert.match(layer.src, /\.(webp|png)$/, `${layer.id}: layers must be webp or png`);
        const info = imageInfo(file);
        assert.ok(info.width >= 400 && info.width <= 2400, `${layer.id}: width ${info.width}`);
        if (layer.role !== 'backdrop') {
          assert.ok(info.hasAlpha, `${layer.id}: cutout layers need an alpha channel`);
        }
      }
    });

    it('keeps the backdrop covering the whole stage throughout its motion', () => {
      const backdrop = scene.layers[0];
      const file = join(scenesDir, id, backdrop.src);
      const { width, height } = imageInfo(file);
      const drawnH = backdrop.width * height / width;
      // Layer wrappers scale about 50% / 60% of the stage (see .diorama__layer).
      const ox = STAGE_W * 0.5;
      const oy = STAGE_H * 0.6;
      for (const key of backdrop.motion ?? [{}]) {
        const m = { x: 0, y: 0, scale: 1, ...key };
        const left = ox + (backdrop.x - ox) * m.scale + m.x;
        const top = oy + (backdrop.y - oy) * m.scale + m.y;
        const right = left + backdrop.width * m.scale;
        const bottom = top + drawnH * m.scale;
        assert.ok(left <= 0 && top <= 0 && right >= STAGE_W && bottom >= STAGE_H,
          `backdrop exposes the stage edge at t=${key.t}`);
      }
    });

    it('has keyframes in time order inside the scene', () => {
      for (const layer of scene.layers) {
        const times = (layer.motion ?? []).map(key => key.t);
        assert.deepEqual(times, [...times].sort((a, b) => a - b), layer.id);
        assert.ok(times.every(t => t >= 0 && t <= scene.duration), layer.id);
      }
    });

    it('has ordered, readable subtitles in every locale', () => {
      let previousEnd = 0;
      for (const cue of scene.subtitles) {
        assert.ok(cue.start >= previousEnd && cue.end > cue.start && cue.end <= scene.duration,
          `cue at ${cue.start}`);
        previousEnd = cue.end;
        for (const locale of LOCALES) {
          const text = cue.text[locale];
          assert.ok(text?.trim(), `cue at ${cue.start}: missing ${locale}`);
          assert.ok(text.length / (cue.end - cue.start) <= MAX_CPS,
            `cue at ${cue.start} (${locale}) is too fast to read`);
        }
      }
      for (const locale of LOCALES) assert.ok(scene.title[locale]?.trim(), `title ${locale}`);
    });

    it('ships up-to-date WebVTT subtitles', () => {
      for (const locale of LOCALES) {
        const file = join(scenesDir, id, `subtitles.${locale}.vtt`);
        assert.equal(readFileSync(file, 'utf8'), toVtt(scene, locale),
          `${file} is stale: run node sites/ffm/static/story/tools/build-subtitles.mjs`);
      }
    });

    it('attaches glows only to existing layers', () => {
      const ids = new Set(scene.layers.map(layer => layer.id));
      for (const glow of scene.lighting?.glows ?? []) {
        if (glow.layer) assert.ok(ids.has(glow.layer), `glow layer ${glow.layer}`);
      }
    });
  });
}

describe('player helpers', () => {
  it('covers landscape phones and tablets while keeping the safe area visible', () => {
    for (const [w, h] of [[2340, 1080], [1920, 1080], [2732, 2048], [1024, 768], [844, 390]]) {
      const { scale, x, y } = stageTransform(w, h);
      assert.ok(STAGE_W * scale >= w - 0.5 && STAGE_H * scale >= h - 0.5, `${w}x${h} not covered`);
      const safeLeft = x + STAGE_SAFE.x * scale;
      const safeTop = y + STAGE_SAFE.y * scale;
      assert.ok(safeLeft >= -0.5 && safeTop >= -0.5, `${w}x${h} crops the safe area`);
      assert.ok(safeLeft + STAGE_SAFE.w * scale <= w + 0.5, `${w}x${h} crops the safe area`);
      assert.ok(safeTop + STAGE_SAFE.h * scale <= h + 0.5, `${w}x${h} crops the safe area`);
    }
  });

  it('fits the whole stage in portrait instead of cropping it', () => {
    const { scale } = stageTransform(390, 844);
    assert.ok(STAGE_W * scale <= 390.5);
  });

  it('interpolates motion between keyframes and holds the ends', () => {
    const keys = [{ t: 0, x: 0 }, { t: 10, x: -100, scale: 1.1 }];
    assert.equal(sampleMotion(keys, -1).x, 0);
    assert.equal(sampleMotion(keys, 5).x, -50);
    assert.equal(sampleMotion(keys, 20).x, -100);
    assert.ok(Math.abs(sampleMotion(keys, 5).scale - 1.05) < 1e-9);
    assert.deepEqual(sampleMotion(undefined, 3), { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 });
  });

  it('finds the active cue and falls back to English text', () => {
    const cues = [{ start: 1, end: 2, text: { en: 'a' } }];
    assert.equal(cueAt(cues, 0.5), null);
    assert.equal(cueAt(cues, 1.5), cues[0]);
    assert.equal(cueAt(cues, 2), null);
    assert.equal(pickText(cues[0].text, 'de'), 'a');
  });
});
