import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadHeroSkin, createHeroSkinManager } from './hero-skin.js';

function fakeImages(failing = []) {
  const made = [];
  const createImage = () => {
    const listeners = {};
    const img = {
      addEventListener(type, fn) { listeners[type] = fn; },
      set src(value) {
        this._src = value;
        if (!value) return;
        const bad = failing.some((part) => value.includes(part));
        queueMicrotask(() => listeners[bad ? 'error' : 'load']?.());
      },
      get src() { return this._src; },
    };
    made.push(img);
    return img;
  };
  return { createImage, made };
}

const frames = { 'idle-1': { x: 0, y: 0, w: 1, h: 1, px: 0, py: 0 } };
const importer = (failing = []) => async (url) => {
  if (failing.some((part) => url.includes(part))) throw new Error('no module');
  return { HERO_FRAMES: frames, HERO_ANCHORS: { strike: [1, 2], cast: [[3, 4], [5, 6]] } };
};

describe('loadHeroSkin', () => {
  it('loads the selected hero atlas, frames, anchors and strike family', async () => {
    const { createImage } = fakeImages();
    const skin = await loadHeroSkin({ heroId: 'rogue', createImage, importFrames: importer() });
    assert.equal(skin.id, 'rogue');
    assert.equal(skin.strike, 'bow');
    assert.equal(skin.frames, frames);
    assert.deepEqual(skin.anchors.strike, [1, 2]);
    assert.match(skin.atlas.src, /heroes\/rogue\/hero-atlas\.webp$/);
  });

  it('falls back to the adventurer when the atlas or frames fail', async () => {
    for (const [imgFail, modFail] of [[['heroes/rogue/'], []], [[], ['heroes/rogue/']]]) {
      const { createImage } = fakeImages(imgFail);
      const skin = await loadHeroSkin({ heroId: 'rogue', createImage, importFrames: importer(modFail) });
      assert.equal(skin.id, 'adventurer');
      assert.ok(skin.atlas);
    }
  });

  it('yields an atlas-less skin when the adventurer fails too, and never throws', async () => {
    const { createImage } = fakeImages(['.webp']);
    const skin = await loadHeroSkin({ heroId: 'rogue', createImage, importFrames: importer() });
    assert.equal(skin.atlas, null);
    const bad = await loadHeroSkin({ heroId: 42, createImage, importFrames: async () => ({}) });
    assert.equal(bad.atlas, null);
  });
});

describe('createHeroSkinManager', () => {
  const hero = () => ({ skins: [], setSkin(s) { this.skins.push(s); } });

  it('does not reload the same hero and releases the previous atlas after the swap', async () => {
    const { createImage, made } = fakeImages();
    const manager = createHeroSkinManager({ createImage, importFrames: importer() });
    const h = hero();
    await manager.apply(h, 'adventurer');
    await manager.apply(h, 'adventurer');
    assert.equal(made.length, 1);
    const first = made[0];
    await manager.apply(h, 'rogue');
    assert.equal(made.length, 2);
    assert.equal(h.skins.length, 2);
    assert.equal(first.src, '');
    assert.ok(made[1].src);
  });

  it('keeps the old atlas until the new one is ready', async () => {
    const { createImage, made } = fakeImages();
    const manager = createHeroSkinManager({ createImage, importFrames: importer() });
    const h = hero();
    await manager.apply(h, 'adventurer');
    const pending = manager.apply(h, 'rogue');
    assert.ok(made[0].src);
    await pending;
  });

  it('applies an atlas-less skin when everything fails', async () => {
    const { createImage } = fakeImages(['.webp']);
    const manager = createHeroSkinManager({ createImage, importFrames: importer() });
    const h = hero();
    await manager.apply(h, 'rogue');
    assert.equal(h.skins[0].atlas, null);
  });
});
