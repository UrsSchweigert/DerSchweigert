// hero-skin.js — loads a roster hero's atlas and frames module into the skin
// Hero.setSkin takes: {id, atlas, frames, anchors, strike}. Fallback chain:
// the selected hero, then the adventurer, then a skin without an atlas, which
// Hero.draw renders with the procedural canvas hero. Nothing here throws.

import { DEFAULT_HERO_ID, resolveHero } from './heroes.js';

const defaultCreateImage = () => new Image();
const defaultImportFrames = (url) => import(url);

function loadAtlas(createImage, url) {
  return new Promise((resolve, reject) => {
    const img = createImage();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', () => reject(new Error(`hero atlas failed: ${url}`)));
    img.src = url;
  });
}

async function loadOne(entry, { createImage, importFrames }) {
  const base = import.meta.url;
  const atlasUrl = new URL(entry.atlas, base).href;
  const framesUrl = new URL(entry.frames, base).href;
  const [atlas, mod] = await Promise.all([
    loadAtlas(createImage, atlasUrl),
    importFrames(framesUrl),
  ]);
  const frames = mod?.HERO_FRAMES;
  if (!frames || typeof frames !== 'object') {
    release(atlas);
    throw new Error(`hero frames missing: ${framesUrl}`);
  }
  return { id: entry.id, atlas, frames, anchors: mod.HERO_ANCHORS, strike: entry.strike };
}

function release(img) {
  try { if (img) img.src = ''; } catch { /* nothing to release */ }
}

/**
 * Loads the skin for an already entitlement-checked hero id.
 * @returns {Promise<object>} a skin; never rejects. atlas is null when even the
 *   adventurer failed.
 */
export async function loadHeroSkin({ heroId, createImage = defaultCreateImage, importFrames = defaultImportFrames } = {}) {
  const io = { createImage, importFrames };
  const chosen = resolveHero(heroId, { entitled: true });
  const chain = chosen.id === DEFAULT_HERO_ID ? [chosen] : [chosen, resolveHero(DEFAULT_HERO_ID)];
  for (const entry of chain) {
    try {
      return await loadOne(entry, io);
    } catch { /* try the next entry */ }
  }
  return { id: DEFAULT_HERO_ID, atlas: null, frames: null, anchors: undefined, strike: 'sword' };
}

/**
 * Keeps at most one hero atlas. apply() loads the wanted hero, hands the skin to
 * hero.setSkin, and only then releases the previous image. Asking for the hero
 * already worn costs nothing; a fallback or atlas-less result is retried next time.
 */
export function createHeroSkinManager(options = {}) {
  let current = null;
  let wanted = null;
  let generation = 0;
  return {
    get current() { return current; },
    async apply(hero, heroId) {
      const id = resolveHero(heroId, { entitled: true }).id;
      if (current && wanted === id && current.id === id && current.atlas) return current;
      const mine = ++generation;
      const skin = await loadHeroSkin({ ...options, heroId: id });
      if (mine !== generation) { release(skin.atlas); return current; }
      hero.setSkin(skin);
      const previous = current;
      current = skin;
      wanted = id;
      if (previous && previous.atlas !== skin.atlas) release(previous.atlas);
      return skin;
    },
  };
}
