// Story diorama checks: scene manifests, layer assets, subtitles, and the
// player's pure helpers. Run: node --test sites/ffm/static/story/tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMPACT_BOX_HEIGHT, STAGE_W, STAGE_H, STAGE_SAFE, cueAt, gradientStops, landscapeBox,
  createDioramaPlayer, narrationLocale, parseCssColor, sampleMotion, stageTransform, pickText, voicedCues,
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

    it('ships voice-over that matches its subtitles in every narrated locale', () => {
      const narrationDir = join(scenesDir, id, 'narration');
      const voicedLocales = existsSync(narrationDir)
        ? readdirSync(narrationDir, { withFileTypes: true }).filter(entry => entry.isDirectory())
          .map(entry => entry.name).sort()
        : [];
      // English carries every scene; a locale that is not voiced on purpose
      // simply has no folder and plays on its authored cue times.
      assert.ok(voicedLocales.includes('en'), `${id}: English voice-over missing`);
      for (const locale of voicedLocales) assert.ok(LOCALES.includes(locale), `${id}: ${locale} is not a scene locale`);

      for (const locale of voicedLocales) {
        const dir = join(narrationDir, locale);
        const timingFile = join(dir, 'timing.json');
        assert.ok(existsSync(timingFile), `${id}/${locale}: narration/timing.json missing`);
        const timing = JSON.parse(readFileSync(timingFile, 'utf8'));
        assert.equal(timing.duration, scene.duration, `${id}/${locale}: scene duration`);
        assert.ok(existsSync(join(dir, timing.audio)), `${id}/${locale}: ${timing.audio} missing`);

        // One recorded line per spoken cue; act title cards stay unvoiced.
        const spoken = scene.subtitles
          .map((cue, index) => ({ cue, index }))
          .filter(({ cue }) => !/^(Act|Akt)\b/.test(cue.text[locale].trim()));
        assert.deepEqual(timing.lines.map(line => line.cue), spoken.map(entry => entry.index),
          `${id}/${locale}: recorded cues`);

        let previousEnd = 0;
        for (const line of timing.lines) {
          assert.ok(existsSync(join(dir, line.stem)), `${id}/${locale}: ${line.stem} missing`);
          assert.ok(line.start >= previousEnd - 0.001,
            `${id}/${locale}: ${line.stem} starts before the line before it ends`);
          assert.ok(line.start + line.duration <= scene.duration + 0.01,
            `${id}/${locale}: ${line.stem} runs past the scene`);
          previousEnd = line.start + line.duration;
        }

        // Folded into the cues, the voice-over must stay ordered and must not
        // collide, and no line may lose its text while it is still speaking.
        const voiced = voicedCues(scene.subtitles, timing);
        for (const [index, cue] of voiced.entries()) {
          assert.ok(cue.end > cue.start, `${id}/${locale}: cue ${index} has no window`);
          if (index) assert.ok(cue.start >= voiced[index - 1].end - 0.001,
            `${id}/${locale}: cue ${index} overlaps the one before it`);
        }
        for (const line of timing.lines) {
          const cue = voiced[line.cue];
          assert.equal(cue.start, line.start, `${id}/${locale}: ${line.stem} is not synced to its cue`);
          assert.ok(cue.end >= line.start + line.duration - 0.001,
            `${id}/${locale}: ${line.stem} loses its subtitle before the line ends`);
        }
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
    assert.deepEqual(landscapeBox(390, 844), { turned: true, width: 844, height: 390 });
    assert.deepEqual(landscapeBox(844, 390), { turned: false, width: 844, height: 390 });
    assert.deepEqual(landscapeBox(1024, 1024), { turned: false, width: 1024, height: 1024 });
    assert.deepEqual(landscapeBox(0, 0), { turned: false, width: 0, height: 0 });

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
    assert.match(player, /root\.classList\.toggle\('is-compact', box\.height < COMPACT_BOX_HEIGHT\)/);
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

  it('moves cue timing onto the recorded lines without letting them collide', () => {
    const subtitles = [
      { start: 1, end: 3, text: 'first' },
      { start: 4, end: 6, text: 'second' },
      { start: 8, end: 10, text: 'title card' },
    ];
    // A slow take: the first line runs past its authored window.
    const timing = {
      lines: [
        { cue: 0, start: 1.4, duration: 3.2 }, // ends 4.6 — later than the second line starts
        { cue: 1, start: 4.9, duration: 1.1 },
      ],
    };
    const voiced = voicedCues(subtitles, timing);
    assert.deepEqual(voiced[0], { start: 1.4, end: 4.6, text: 'first' });
    assert.deepEqual(voiced[1], { start: 4.9, end: 6, text: 'second' });
    // The unvoiced title card keeps its authored time even though line 2 runs late.
    assert.deepEqual(voiced[2], subtitles[2]);
  });

  it('keeps a cue readable when the take is shorter than its window', () => {
    const subtitles = [{ start: 1, end: 5, text: 'short take' }];
    const voiced = voicedCues(subtitles, { lines: [{ cue: 0, start: 1.2, duration: 1.5 }] });
    assert.deepEqual(voiced[0], { start: 1.2, end: 5, text: 'short take' });
  });

  it('leaves the cues alone without a usable voice-over manifest', () => {
    const subtitles = [{ start: 1, end: 2, text: 'x' }];
    assert.equal(voicedCues(subtitles, null), subtitles);
    assert.equal(voicedCues(subtitles, { lines: [] }), subtitles);
    // Unknown cue indices and unreadable starts are ignored, not thrown at.
    const junk = { lines: [{ cue: 9, start: 0, duration: 1 }, { cue: 0, start: 'x', duration: 1 }] };
    assert.equal(voicedCues(subtitles, junk), subtitles);
  });

  it('reads the voice-over folder for a supported locale', () => {
    assert.equal(narrationLocale('de'), 'de');
    assert.equal(narrationLocale('en'), 'en');
    assert.equal(narrationLocale('fr'), 'en');
    assert.equal(narrationLocale(undefined), 'en');
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

describe('narration factory seam', () => {
  const noop = () => {};
  function setup(factory) {
    const made = [];
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
      fetch: async () => ({ ok: true, json: async () => ({ lines: [{ cue: 0, start: 0, duration: 1 }] }) }),
      Audio: class { constructor(src) { made.push(src); this.src = src; } addEventListener() {} play() { return Promise.resolve(); } pause() {} load() {} removeAttribute() {} },
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
    return { made, restore, make: () => createDioramaPlayer({
      container: node(), scene, baseUrl: 'https://localhost/scene/', locale: 'en', createNarration: factory,
    }) };
  }

  async function run(factory) {
    const env = setup(factory);
    try {
      const player = env.make();
      const playing = player.play();
      await new Promise(resolve => setTimeout(resolve, 5));
      player.skip();
      assert.equal(await playing, 'skipped');
      return env.made;
    } finally {
      env.restore();
    }
  }

  it('replaces the <audio> element with the factory voice', async () => {
    const calls = [];
    const voice = {
      paused: true, ended: false, readyState: 4, duration: 5, currentTime: 0,
      addEventListener: noop, pause() { calls.push('pause'); }, removeAttribute: noop,
      load() { calls.push('load'); }, play() { calls.push('play'); return Promise.resolve(); },
    };
    const made = await run((url, timing) => { calls.push(url, timing.lines.length); return voice; });
    assert.deepEqual(made, [], 'no Audio object constructed');
    assert.deepEqual(calls.slice(0, 3), ['https://localhost/scene/narration/en/narration.mp3', 1, 'play']);
    assert.ok(calls.includes('load'));
  });

  it('runs silently on the timer when the factory returns nothing, throws, or play rejects', async () => {
    assert.deepEqual(await run(() => null), []);
    assert.deepEqual(await run(() => { throw new Error('no context'); }), []);
    const rejecting = {
      paused: true, readyState: 0, addEventListener: noop, pause: noop, removeAttribute: noop, load: noop,
      play: () => Promise.reject(new Error('blocked')),
    };
    assert.deepEqual(await run(() => rejecting), []);
    const throwing = { ...rejecting, play() { throw new Error('sync'); } };
    assert.deepEqual(await run(() => throwing), []);
  });

  it('keeps the <audio> element when no factory is given', async () => {
    assert.deepEqual(await run(undefined), ['https://localhost/scene/narration/en/narration.mp3']);
  });
});
