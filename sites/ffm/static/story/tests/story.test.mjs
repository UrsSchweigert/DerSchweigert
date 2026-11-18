// Story diorama checks: scene manifests, layer assets, subtitles, and the
// player's pure helpers. Run: node --test sites/ffm/static/story/tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMPACT_BOX_HEIGHT, STAGE_W, STAGE_H, STAGE_SAFE, cardRuns, cueAt, gradientStops, inPhoneFrame, landscapeBox,
  createDioramaPlayer, parseCssColor, plainText, sampleMotion, stageTransform, pickText,
} from '../player/diorama-player.js';
import { LOCALES, toVtt, vttText } from '../tools/build-subtitles.mjs';
import { READING, cardSeconds, retimeScene } from '../tools/card-timing.mjs';
import { SCENE_WAIT_MAX_MS } from '../../game/story-intro.js';

const storyDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const scenesDir = join(storyDir, 'scenes');
const index = JSON.parse(readFileSync(join(scenesDir, 'index.json'), 'utf8'));
const sceneDirs = readdirSync(scenesDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const ROLES = new Set(['backdrop', 'midground', 'character', 'foreground']);
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
// A card is a few short sentences, never a wall of text (see the README).
const MAX_CARD_CHARS = { en: 150, de: 170 };
const MAX_CARD_SENTENCES = 3;
const LAST_LEVEL = 60;

/** Every file below a folder, as paths relative to it. */
function filesBelow(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory()
    ? filesBelow(join(dir, entry.name), `${prefix}${entry.name}/`)
    : [`${prefix}${entry.name}`]));
}

/** The level range an act covers: from its own first level to the next act's. */
function actLevels(act) {
  const starts = index.scenes.filter(entry => entry.slot.type === 'act')
    .map(entry => entry.slot.fromLevel).sort((a, b) => a - b);
  const at = starts.indexOf(act.slot.fromLevel);
  return [starts[at], at + 1 < starts.length ? starts[at + 1] - 1 : LAST_LEVEL];
}

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

  it('has one prologue and one finish', () => {
    assert.deepEqual(index.scenes.filter(entry => entry.slot.type === 'intro').map(entry => entry.id), ['intro']);
    assert.deepEqual(index.scenes.filter(entry => entry.slot.type === 'finish').map(entry => entry.id), ['finish']);
  });
});

describe('story without a voice-over', () => {
  it('ships no narration folder and no audio file in any scene', () => {
    for (const id of sceneDirs) {
      const files = filesBelow(join(scenesDir, id));
      assert.deepEqual(files.filter(file => /(^|\/)narration\//.test(file)), [], `${id}: narration folder`);
      assert.deepEqual(files.filter(file => /\.(mp3|m4a|aac|ogg|opus|wav)$/i.test(file)), [], `${id}: audio file`);
      assert.doesNotMatch(readFileSync(join(scenesDir, id, 'scene.json'), 'utf8'), /narrat|timing\.json|\.mp3/i,
        `${id}: scene.json still names a voice-over`);
    }
  });

  it('plays no sound: the player and its wiring have no voice-over path left', () => {
    const player = readFileSync(join(storyDir, 'player', 'diorama-player.js'), 'utf8');
    assert.doesNotMatch(player, /new Audio\b|AudioContext|narration\/|voicedCues|createNarration/);
    assert.doesNotMatch(player, /muted|narration\s*=/, 'no sound options remain on the player');
    const main = readFileSync(join(storyDir, '..', 'game', 'main.js'), 'utf8');
    assert.doesNotMatch(main, /createNarration|story-narration|STORY_NARRATION/);
    const readme = readFileSync(join(storyDir, 'README.md'), 'utf8');
    assert.doesNotMatch(readme, /^#+ Voice-over/m, 'the README must not document a voice-over');
    assert.doesNotMatch(readme, /narration\//);
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
        // Foreground strips are mirror-tiled wider than the 1920 stage so they
        // can cover its base through the whole parallax drift.
        assert.ok(info.width >= 400 && info.width <= 2600, `${layer.id}: width ${info.width}`);
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
      // Layers scale about 50% / 60% of the stage (see the player's motion).
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

    it('has ordered cards in every locale, each up long enough to be read', () => {
      let previousEnd = 0;
      for (const cue of scene.subtitles) {
        assert.ok(cue.start >= previousEnd && cue.end > cue.start && cue.end <= scene.duration,
          `cue at ${cue.start}`);
        previousEnd = cue.end;
        for (const locale of LOCALES) {
          const text = cue.text[locale];
          assert.ok(text?.trim(), `cue at ${cue.start}: missing ${locale}`);
          // Without a voice-over the reader sets the pace: never shorter than
          // the reading estimate of tools/card-timing.mjs.
          assert.ok(cue.end - cue.start >= cardSeconds(text) - 1e-9,
            `cue at ${cue.start} (${locale}) is up ${(cue.end - cue.start).toFixed(1)} s, needs ${cardSeconds(text).toFixed(1)} s`);
        }
      }
      for (const locale of LOCALES) assert.ok(scene.title[locale]?.trim(), `title ${locale}`);
      const reading = scene.subtitles.reduce((sum, cue) => sum
        + Math.max(...LOCALES.map(locale => cardSeconds(cue.text[locale]))), 0);
      assert.ok(scene.duration >= reading, `${id}: ${scene.duration} s is shorter than its ${reading.toFixed(1)} s of reading`);
    });

    it('is paced by tools/card-timing.mjs', () => {
      assert.deepEqual(retimeScene(scene), scene,
        `${id} is not paced to its cards: run node sites/ffm/static/story/tools/card-timing.mjs`);
      // The game gives up waiting for a scene after SCENE_WAIT_MAX_MS.
      assert.ok(scene.duration * 1000 < SCENE_WAIT_MAX_MS - 20000, `${id}: ${scene.duration} s is too long`);
    });

    it('keeps every card to a few short sentences', () => {
      for (const cue of scene.subtitles) {
        for (const locale of LOCALES) {
          const text = plainText(cue.text[locale]);
          assert.ok([...text].length <= MAX_CARD_CHARS[locale], `${id} (${locale}) card too long: ${text}`);
          const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean).length;
          assert.ok(sentences <= MAX_CARD_SENTENCES, `${id} (${locale}) card has ${sentences} sentences: ${text}`);
          assert.doesNotMatch(text, /\*/, `${id} (${locale}): unbalanced bold marker in ${cue.text[locale]}`);
          assert.doesNotMatch(text, /Hollow|Hohle/i, `${id} (${locale}): the old story's name`);
        }
        // German typography: „…“, never straight quotes.
        assert.doesNotMatch(cue.text.de, /["']/, `${id}: straight quote in ${cue.text.de}`);
        assert.equal((cue.text.de.match(/„/g) ?? []).length, (cue.text.de.match(/“/g) ?? []).length,
          `${id}: unpaired German quotes in ${cue.text.de}`);
        assert.doesNotMatch(cue.text.en, /["']/, `${id}: straight quote or apostrophe in ${cue.text.en}`);
      }
    });

    it('shows its heading on exactly one title card', () => {
      const titles = scene.subtitles.filter(cue => cue.kind === 'title');
      assert.equal(titles.length, 1, `${id}: one title card`);
      const [heading] = titles;
      const entry = index.scenes.find(candidate => candidate.id === id);
      if (entry.slot.type === 'act') {
        // The act heading closes the act's opening, with the act's real levels.
        assert.equal(scene.subtitles.at(-1), heading, `${id}: the heading is the last card`);
        const [from, to] = actLevels(entry);
        const numeral = ROMAN[entry.slot.act - 1];
        assert.equal(heading.text.en, `${scene.title.en} · Levels ${from}–${to}`);
        assert.equal(heading.text.de, `${scene.title.de} · Level ${from}–${to}`);
        assert.match(scene.title.en, new RegExp(`^Act ${numeral}: [A-Z]`));
        assert.match(scene.title.de, new RegExp(`^Akt ${numeral}: \\S`));
      } else {
        assert.deepEqual(heading.text, scene.title, `${id}: the title card is the scene's title`);
      }
    });

    it('ships up-to-date WebVTT subtitles', () => {
      for (const locale of LOCALES) {
        const file = join(scenesDir, id, `subtitles.${locale}.vtt`);
        assert.equal(readFileSync(file, 'utf8'), toVtt(scene, locale),
          `${file} is stale: run node sites/ffm/static/story/tools/build-subtitles.mjs`);
      }
    });

    it('keeps lighting events inside the scene', () => {
      for (const event of scene.lighting?.events ?? []) {
        assert.ok(event.at >= 0 && event.at + event.duration <= scene.duration + 1e-9,
          `${id}: ${event.type} at ${event.at} runs past the scene`);
        if (Number.isInteger(event.atCue)) assert.ok(scene.subtitles[event.atCue], `${id}: atCue ${event.atCue}`);
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

  it('turns a portrait screen into a landscape box instead of letterboxing', () => {
    assert.deepEqual(landscapeBox(390, 844), { turned: true, letterboxed: false, width: 844, height: 390 });
    assert.deepEqual(landscapeBox(844, 390), { turned: false, letterboxed: false, width: 844, height: 390 });
    assert.deepEqual(landscapeBox(1024, 1024), { turned: false, letterboxed: false, width: 1024, height: 1024 });
    assert.deepEqual(landscapeBox(0, 0), { turned: false, letterboxed: false, width: 0, height: 0 });

    // The turned box is always landscape, so the stage covers it edge to edge.
    for (const [w, h] of [[390, 844], [320, 700], [820, 1180]]) {
      const box = landscapeBox(w, h);
      const { scale, x, y } = stageTransform(box.width, box.height);
      assert.ok(STAGE_W * scale >= box.width - 0.5 && STAGE_H * scale >= box.height - 0.5,
        `${w}x${h} does not fill the turned box`);
      assert.ok(x <= 0.5 && y <= 0.5, `${w}x${h} leaves a gap at the top/left`);
    }
  });

  it('flags the short landscape boxes that need the slim subtitle strip', () => {
    for (const [w, h] of [[844, 390], [390, 844], [926, 428]]) {
      assert.ok(landscapeBox(w, h).height < COMPACT_BOX_HEIGHT, `${w}x${h} should be compact`);
    }
    for (const [w, h] of [[1180, 820], [1024, 768], [2732, 2048]]) {
      assert.ok(landscapeBox(w, h).height >= COMPACT_BOX_HEIGHT, `${w}x${h} should not be compact`);
    }
  });

  it('rotates the player for portrait screens and keeps the strip tied to the box', () => {
    const css = readFileSync(join(storyDir, 'player', 'diorama-player.css'), 'utf8');
    const turned = css.match(/\.diorama\.is-turned \{([^}]*)\}/)?.[1];
    assert.ok(turned, 'the turned player rule is missing');
    assert.match(turned, /width:\s*var\(--diorama-box-width/);
    assert.match(turned, /height:\s*var\(--diorama-box-height/);
    assert.match(turned, /translate\(-50%, -50%\) rotate\(90deg\)/);
    assert.match(css, /\.diorama\.is-compact \.diorama__subtitle \{/,
      'the slim strip follows the box, not the screen');
    assert.doesNotMatch(css, /@media \(max-height: 500px\)/,
      'screen-height media queries cannot see a turned box');
    const player = readFileSync(join(storyDir, 'player', 'diorama-player.js'), 'utf8');
    assert.match(player, /root\.classList\.toggle\('is-turned', box\.turned\)/);
    assert.match(player, /root\.classList\.toggle\('is-compact', !box\.letterboxed && box\.height < COMPACT_BOX_HEIGHT\)/);
  });

  // Production bug after #589: inside the web's desktop phone frame the intro was turned 90°
  // on a monitor nobody can turn. There the portrait screen letterboxes the scene instead;
  // a real portrait phone still turns (the intended phone behaviour above).
  it('letterboxes instead of turning inside the desktop phone frame', () => {
    assert.deepEqual(landscapeBox(390, 844, { turn: false }), { turned: false, letterboxed: true, width: 390, height: 219 });
    assert.deepEqual(landscapeBox(844, 390, { turn: false }), landscapeBox(844, 390), 'a landscape screen is unchanged');
    const band = landscapeBox(390, 844, { turn: false });
    const { scale, x, y } = stageTransform(band.width, band.height);
    assert.ok(Math.abs(STAGE_W * scale - 390) < 1 && Math.abs(y) < 1 && Math.abs(x) < 1, 'the 16:9 band shows the whole stage');
    assert.equal(inPhoneFrame({ getAttribute: (name) => (name === 'data-phone-frame' ? 'screen' : null) }), true);
    assert.equal(inPhoneFrame({ getAttribute: () => 'host' }), false);
    assert.equal(inPhoneFrame({ getAttribute: () => null }), false, 'a phone has no frame');
    assert.equal(inPhoneFrame(undefined), false);
    const player = readFileSync(join(storyDir, 'player', 'diorama-player.js'), 'utf8');
    assert.match(player, /\{ turn: !inPhoneFrame\(doc\) \}/);
    assert.match(player, /root\.classList\.toggle\('is-letterboxed', box\.letterboxed\)/);
    const css = readFileSync(join(storyDir, 'player', 'diorama-player.css'), 'utf8');
    const canvas = css.match(/\.diorama\.is-letterboxed \.diorama__canvas \{([^}]*)\}/)?.[1];
    assert.ok(canvas, 'the letterboxed band rule is missing');
    assert.match(canvas, /top: calc\(50% - var\(--diorama-band-height/);
    assert.doesNotMatch(canvas, /transform|rotate/, 'the band is never turned');
    assert.match(css, /\.diorama\.is-letterboxed \.diorama__subtitle \{[^}]*top: calc\(50% \+ var\(--diorama-band-height/);
    // The frame marks the page it holds with this attribute (game/phone-frame.js).
    const frame = readFileSync(join(storyDir, '..', 'game', 'phone-frame.js'), 'utf8');
    assert.match(frame, /setAttribute\('data-phone-frame', mode\)/);
    assert.match(frame, /return 'screen';/);
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

  it('splits a card into plain and bold runs', () => {
    assert.deepEqual(cardRuns('Beneath it:\n**A steady mind.**'), [
      { text: 'Beneath it:\n', bold: false }, { text: 'A steady mind.', bold: true },
    ]);
    assert.deepEqual(cardRuns('**Every answer opens another path.**'),
      [{ text: 'Every answer opens another path.', bold: true }]);
    assert.deepEqual(cardRuns('a **b** c'), [
      { text: 'a ', bold: false }, { text: 'b', bold: true }, { text: ' c', bold: false },
    ]);
    // An unclosed marker stays literal rather than swallowing the card.
    assert.deepEqual(cardRuns('**open'), [{ text: '**open', bold: false }]);
    assert.deepEqual(cardRuns(''), []);
    assert.equal(plainText('x **y** z'), 'x y z');
  });

  it('never builds a card from HTML', () => {
    const player = readFileSync(join(storyDir, 'player', 'diorama-player.js'), 'utf8');
    assert.doesNotMatch(player, /innerHTML|insertAdjacentHTML|outerHTML/);
    assert.match(player, /createElement\('strong'\)/);
    assert.match(player, /strong\.textContent = run\.text/);
    assert.equal(vttText('**A <b> & c**'), '<b>A &lt;b&gt; &amp; c</b>');
  });

  it('times a card by its length, with a floor', () => {
    assert.equal(cardSeconds('Hi.'), READING.minSeconds);
    const long = 'x'.repeat(150);
    assert.equal(cardSeconds(long), READING.leadSeconds + 150 / READING.charsPerSecond);
    // Bold markers are not read.
    assert.equal(cardSeconds(`**${long}**`), cardSeconds(long));
  });

  it('lays cards out at reading speed and stretches the rest of the scene with them', () => {
    const scene = {
      duration: 10,
      layers: [{ id: 'a', motion: [{ t: 0 }, { t: 5 }, { t: 10 }] }],
      lighting: {
        glows: [{ layer: 'a', from: 2 }],
        events: [{ type: 'flash', at: 4, duration: 1 }, { type: 'dim', atCue: 1, offset: -0.2, at: 0, duration: 1 }],
      },
      subtitles: [
        { start: 0, end: 1, text: { en: 'Hi.', de: 'Hallo.' } },
        { start: 1, end: 2, kind: 'title', text: { en: 'x'.repeat(60), de: 'y'.repeat(75) } },
      ],
    };
    const timed = retimeScene(scene);
    // 0.8 + 4 s floor, 0.4 s gap, then the German heading: 1.5 + 75 / 15 = 6.5 s; 0.6 s tail.
    assert.deepEqual(timed.subtitles.map(cue => [cue.start, cue.end]), [[0.8, 4.8], [5.2, 11.7]]);
    assert.equal(timed.subtitles[1].kind, 'title');
    assert.equal(timed.duration, 12.3);
    assert.deepEqual(timed.layers[0].motion.map(key => key.t), [0, 6.2, 12.3]);
    assert.equal(timed.lighting.glows[0].from, 2.5);
    assert.ok(!('to' in timed.lighting.glows[0]), 'an open glow stays open');
    assert.equal(timed.lighting.events[0].at, 4.9);
    assert.equal(timed.lighting.events[1].at, 5, 'a pinned event follows its card');
    assert.deepEqual(retimeScene(timed), timed, 'retiming a paced scene changes nothing');
    assert.equal(scene.duration, 10, 'the input is not modified');
  });
});

// The real check is tools/measure-cards.py, which renders every card with the
// player CSS in Chromium at 320x568, 390x844, 568x320, 844x390 and inside the
// 390x844 desktop phone frame (see the README). This keeps a cheap, deliberately
// pessimistic model of it in CI: Georgia averages ~0.5em per character, the
// model assumes 0.6em.
describe('cards fit the smallest screens', () => {
  const GLYPH_EM = 0.6;
  const boxes = [
    // [label, box width, box height, font px, card width share, padding x em, padding y em, line height]
    ['568x320 (and a turned 320x568)', 568, 320, 14, 0.88, 1, 0.8, 1.3],
    ['844x390 (and a turned 390x844)', 844, 390, 17.3, 0.88, 1, 0.8, 1.3],
  ];
  for (const [label, width, height, font, share, padX, padY, lineHeight] of boxes) {
    it(`keeps every card under 42% of a ${label} box`, () => {
      const perLine = Math.floor((width * share - 2 * padX * font) / (font * GLYPH_EM));
      for (const id of sceneDirs) {
        for (const cue of loadScene(id).subtitles) {
          for (const locale of LOCALES) {
            const lines = plainText(cue.text[locale]).split('\n')
              .reduce((sum, part) => sum + Math.max(1, Math.ceil([...part].length / perLine)), 0);
            const cardHeight = (lines * lineHeight + padY) * font;
            assert.ok(cardHeight <= 0.42 * height,
              `${id} (${locale}) needs ${lines} lines (${Math.round(cardHeight)} px) at ${label}`);
          }
        }
      }
    });
  }

  it('leaves room under the letterbox band in the desktop phone frame', () => {
    const font = 18;
    const perLine = Math.floor((390 * 0.9 - 2 * 1.1 * font) / (font * GLYPH_EM));
    const band = landscapeBox(390, 844, { turn: false }).height;
    const room = 844 / 2 - band / 2 - 20;
    for (const id of sceneDirs) {
      for (const cue of loadScene(id).subtitles) {
        for (const locale of LOCALES) {
          const lines = Math.ceil([...plainText(cue.text[locale])].length / perLine);
          assert.ok((lines * 1.35 + 1.2) * font <= room, `${id} (${locale}): ${lines} lines in the phone frame`);
        }
      }
    }
  });

  it('sizes the card type by the box it is read in, not the screen', () => {
    const css = readFileSync(join(storyDir, 'player', 'diorama-player.css'), 'utf8');
    assert.match(css, /\.diorama__subtitle \{[^}]*font-size: clamp\(16px, calc\(var\(--diorama-text-box, 100vw\) \* 0\.026\), 30px\);/);
    assert.match(css, /\.diorama\.is-compact \.diorama__subtitle \{[^}]*font-size: clamp\(14px, calc\(var\(--diorama-text-box, 100vw\) \* 0\.0205\), 20px\);/);
    assert.match(css, /\.diorama__subtitle \{[^}]*white-space: pre-line;/);
    const player = readFileSync(join(storyDir, 'player', 'diorama-player.js'), 'utf8');
    assert.match(player, /root\.style\.setProperty\('--diorama-text-box', `\$\{box\.width\}px`\)/);
  });
});

describe('the story', () => {
  it('is called The Stolen Dawn', () => {
    const intro = loadScene('intro');
    assert.deepEqual(intro.title, { en: 'The Stolen Dawn', de: 'Der gestohlene Morgen' });
    const readme = readFileSync(join(storyDir, 'README.md'), 'utf8');
    assert.match(readme, /\*The Stolen Dawn\*/);
    assert.doesNotMatch(readme, /Hollow Crown/);
  });

  it('ends with a finish built on its own dawn and art the other scenes already ship', () => {
    const finish = loadScene('finish');
    assert.deepEqual(finish.slot, { type: 'finish' });
    assert.deepEqual(finish.title, { en: 'A World in Balance', de: 'Eine Welt im Gleichgewicht' });
    assert.equal(finish.subtitles[0].kind, 'title', 'the finish opens on its title');
    assert.equal(finish.subtitles.at(-1).text.en, '**Every answer opens another path.**');
    // The dawn backdrop is the finish's only own image; every other layer
    // points into another scene's folder.
    assert.equal(finish.layers[0].id, 'dawn');
    assert.equal(finish.layers[0].src, 'dawn.webp');
    for (const layer of finish.layers.slice(1)) {
      assert.match(layer.src, /^\.\.\/(intro|act-[1-6])\/[\w-]+\.webp$/, `${layer.id}: ${layer.src}`);
    }
    // The owner dropped the throne-room backdrop from the finish (2026-11-18).
    assert.ok(!finish.layers.some(layer => layer.id === 'throne' || layer.src === '../act-6/backdrop.webp'));
    assert.deepEqual(readdirSync(join(scenesDir, 'finish')).sort(),
      ['dawn.webp', 'scene.json', 'subtitles.de.vtt', 'subtitles.en.vtt']);
  });

  it('shows no fiends and ships no fiends art', () => {
    // The owner took the fiend groups out of every story scene (2026-11-18): the
    // game shows the fiends, the dioramas tell the story around them.
    for (const id of sceneDirs) {
      const scene = loadScene(id);
      assert.ok(!scene.layers.some(layer => /fiend/.test(layer.id) || /fiend/.test(layer.src)), `${id} shows fiends`);
      assert.ok(!(scene.lighting.glows ?? []).some(glow => /fiend/.test(glow.layer ?? '')), `${id} lights fiends`);
      assert.ok(!readdirSync(join(scenesDir, id)).some(name => /fiend/.test(name)), `${id} still ships fiends art`);
    }
    for (const id of readdirSync(join(storyDir, 'sources'))) {
      assert.ok(!readdirSync(join(storyDir, 'sources', id)).some(name => /fiend/.test(name)), `sources/${id} keeps fiends art`);
      const packet = JSON.parse(readFileSync(join(storyDir, 'sources', id, 'layers.json'), 'utf8'));
      assert.ok(!packet.layers.some(layer => /fiend/.test(layer.id)), `sources/${id}/layers.json lists fiends`);
    }
  });

  it('shows the ancient dragon descending on its act V card', () => {
    const act5 = loadScene('act-5');
    const dragon = act5.layers.find(layer => layer.id === 'dragon');
    assert.ok(dragon, 'act V has a dragon layer');
    assert.equal(dragon.src, 'dragon.webp');
    assert.equal(dragon.role, 'character');
    const card = act5.subtitles.find(cue => /ancient dragon descends/.test(cue.text.en));
    assert.ok(card, 'the dragon card is still there');
    // Hidden until its card, on screen while the card is read.
    const shown = dragon.motion.find(key => key.opacity > 0);
    assert.ok(shown.t >= card.start - 1 && shown.t <= card.start + 1, `the dragon appears at ${shown.t}`);
    assert.ok(dragon.motion.filter(key => key.t < card.start - 0.5).every(key => key.opacity === 0));
    assert.ok(act5.lighting.glows.some(glow => glow.layer === 'dragon'), 'the dragon glows');
  });
});

describe('player chrome', () => {
  const css = readFileSync(join(storyDir, 'player', 'diorama-player.css'), 'utf8');
  const player = readFileSync(join(storyDir, 'player', 'diorama-player.js'), 'utf8');

  it('keeps the turn and the strip centring when the visitor asks for reduced motion', () => {
    // styles.css kills every transform under prefers-reduced-motion; without these
    // restated rules a portrait phone shows the scene as a hard-edged picture over
    // the lower right of the title menu with its Skip button off-screen.
    assert.match(css, /\.diorama\.is-turned \{\s*transform: translate\(-50%, -50%\) rotate\(90deg\) !important;/);
    assert.match(css, /\.diorama \.diorama__subtitle \{\s*transform: translate\(-50%, 8px\) !important;/);
    assert.match(css, /\.diorama \.diorama__subtitle\.is-visible \{\s*transform: translate\(-50%, 0\) !important;/);
    const site = readFileSync(join(storyDir, '..', 'styles.css'), 'utf8');
    assert.match(site, /prefers-reduced-motion: reduce\) \{[^}]*transform: none !important;/,
      'if the site-wide rule goes away, these restated rules can go too');
  });

  it('paints the scene into one canvas, not a stack of composited layers', () => {
    // Each DOM layer needs its own compositor surface; on a 1440p phone that
    // exhausted the Android WebView's raster memory and dropped tiles showed as
    // black rectangles (see the README's "Keeping the compositor happy").
    assert.match(css, /\.diorama__canvas \{[^}]*display: block;/);
    assert.doesNotMatch(css, /mix-blend-mode/, 'the lighting rig blends inside the canvas');
    assert.doesNotMatch(css, /drop-shadow/, 'contact shadows are painted into the canvas');
    assert.match(player, /getContext\('2d'\)/, 'the player paints through a 2D context');
  });

  it('tiles the paper grain from a shipped image', () => {
    const tile = join(storyDir, 'player', 'paper-grain.webp');
    assert.ok(existsSync(tile), 'player/paper-grain.webp is missing: run tools/paper-grain.py');
    assert.match(player, /paper-grain\.webp/, 'the player must load the paper tile');
    assert.doesNotMatch(css, /data:image\/svg/, 'no inline SVG filter may stand in for the tile');
    const info = webpInfo(tile);
    assert.equal(info.width, 320, 'the tile is designed to repeat every 320 px');
    assert.equal(info.height, 320);
    assert.ok(info.hasAlpha, 'the paper tile is an alpha-only grain');
  });

  it('reads the colours and gradients the scenes are authored in', () => {
    assert.deepEqual(parseCssColor('rgba(20, 10, 0, 0.45)'), { r: 20, g: 10, b: 0, a: 0.45 });
    assert.deepEqual(parseCssColor('#cfe6ff'), { r: 207, g: 230, b: 255, a: 1 });
    assert.deepEqual(parseCssColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
    assert.equal(parseCssColor('not a colour'), null);

    const linear = gradientStops(
      'linear-gradient(180deg, rgba(40,52,110,0.30) 0%, rgba(20,26,60,0.10) 55%, rgba(30,18,10,0.35) 100%)');
    assert.deepEqual(linear.map(stop => stop.at), [0, 0.55, 1]);
    assert.deepEqual(linear[2].color, { r: 30, g: 18, b: 10, a: 0.35 });

    const radial = gradientStops(
      'radial-gradient(ellipse at 20% 15%, rgba(255,236,200,0) 0%, rgba(140,95,40,0.25) 100%)');
    assert.deepEqual(radial.map(stop => stop.at), [0, 1]);
    assert.equal(radial[0].color.a, 0);
  });
});

describe('a silent player', () => {
  const noop = () => {};
  function setup() {
    const made = [];
    const fetched = [];
    const node = () => ({
      className: '', style: { setProperty: noop, removeProperty: noop }, classList: { add: noop, remove: noop, toggle: noop }, children: [],
      setAttribute: noop, appendChild(child) { this.children.push(child); }, remove: noop,
      addEventListener: noop, focus: noop, getContext: () => null, removeAttribute: noop,
    });
    const saved = {};
    const globals = {
      document: { createElement: node, activeElement: null, baseURI: 'https://localhost/', addEventListener: noop, removeEventListener: noop },
      window: { matchMedia: () => ({ matches: false }), addEventListener: noop, removeEventListener: noop },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: noop,
      fetch: async (url) => { fetched.push(String(url)); return { ok: false, json: async () => ({}) }; },
      Audio: class { constructor(src) { made.push(src); } },
      AudioContext: class { constructor() { made.push('AudioContext'); } },
    };
    for (const [key, value] of Object.entries(globals)) {
      saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    const restore = () => {
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    };
    const scene = { duration: 5, layers: [], subtitles: [{ start: 0, end: 1, text: 'hi' }], title: 'T' };
    return { made, fetched, restore, make: () => createDioramaPlayer({
      container: node(), scene, baseUrl: 'https://localhost/scene/', locale: 'de',
    }) };
  }

  it('plays and skips a scene without fetching or creating any audio', async () => {
    const env = setup();
    try {
      const player = env.make();
      const playing = player.play();
      await new Promise(resolve => setTimeout(resolve, 5));
      player.pause();
      player.resume();
      player.skip();
      assert.equal(await playing, 'skipped');
      assert.deepEqual(env.made, [], 'no audio element or context');
      assert.deepEqual(env.fetched, [], 'no voice-over manifest is fetched');
    } finally {
      env.restore();
    }
  });
});
