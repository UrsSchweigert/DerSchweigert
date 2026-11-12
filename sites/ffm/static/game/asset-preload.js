// asset-preload.js — preloads every image the game can show during a
// session, so a "Loading..." bar can be shown on black until they're all
// cached, instead of the previous behavior: procedural pixel-art fallback
// shapes (see entities.js's `.complete`/`.naturalWidth` checks) rendering
// first and then popping over to the real sprite whenever its PNG finished
// downloading — which looked like a series of "wrong"/placeholder artifacts
// briefly appearing before being replaced, especially on a slow connection.

import { FIEND_CLASSES } from './difficulty-classes.js';
import { ABILITY_ROSTER } from './cooldown-abilities.js';

const STAGE_COUNT = 6;

/** The three ability icons, in bar order (wind, storm, earth). */
export const ABILITY_ICON_IDS = Object.freeze(ABILITY_ROSTER.map((ability) => ability.id));

/**
 * Resolve one ability icon. The files live in game/assets and are
 * owner-delivered art, so a missing file is expected to be handled by the
 * caller (the bar falls back to the localized ability name).
 * @param {'wind' | 'storm' | 'earth'} id
 * @returns {string} absolute URL, resolved relative to this module.
 */
export function abilityIconUrl(id) {
  return new URL(`./assets/ability-${id}.webp`, import.meta.url).href;
}

/** @returns {string[]} absolute URLs of the three ability icons. */
export function buildAbilityIconUrls() {
  return ABILITY_ICON_IDS.map(abilityIconUrl);
}

/**
 * Pure (no DOM/network) list-builder, so it's unit-testable: every image URL
 * the game can ever display in a session — the hero atlas, the
 * dragon/fireball combo-ability sprites, all per-chapter stage backgrounds
 * (any of which can be reached immediately via the level-jump feature, not
 * just sequentially), and every fiend class sprite (fiend class assignment
 * is level-dependent and randomized, so any of the 36 can appear on any
 * level per the 50/30/20 weighting in difficulty-classes.js).
 * @returns {string[]} absolute URLs, resolved relative to this module.
 */
export function buildAssetManifest() {
  const urls = [
    new URL('./hero/hero-atlas.webp', import.meta.url).href,
    new URL('./dragon.webp', import.meta.url).href,
    new URL('./fireball.png', import.meta.url).href,
  ];
  for (let i = 1; i <= STAGE_COUNT; i++) {
    urls.push(new URL(`./stage-${i}.webp`, import.meta.url).href);
  }
  for (const cls of FIEND_CLASSES) {
    urls.push(new URL(cls.spritePath, import.meta.url).href);
  }
  return urls;
}

/**
 * Preload every image in buildAssetManifest(), reporting progress as each
 * one settles. A single missing/broken file resolves (doesn't reject) on
 * its `error` event too, so one bad asset can't hang the loading bar
 * forever — it just won't get the "no popping in" guarantee for that one.
 * @param {(loaded: number, total: number) => void} [onProgress]
 * @returns {Promise<void>} resolves once every asset has loaded or errored.
 */
export function preloadGameAssets(onProgress) {
  const urls = buildAssetManifest();
  const total = urls.length;
  let loaded = 0;

  const loadOne = (url) => new Promise((resolve) => {
    const img = new Image();
    const settle = () => {
      loaded++;
      if (onProgress) onProgress(loaded, total);
      resolve();
    };
    img.addEventListener('load', settle);
    img.addEventListener('error', settle);
    img.src = url;
  });

  return Promise.all(urls.map(loadOne)).then(() => {});
}

/**
 * Warm the three ability icons before the bar needs them, so the first unlock
 * shows artwork instead of flashing the text fallback. The icons are optional
 * owner-delivered art: like preloadGameAssets(), every URL resolves on both
 * `load` and `error`, so a missing file can never hang the loading path.
 * @param {object} [options]
 * @param {() => HTMLImageElement} [options.createImage] injectable for tests.
 * @param {(loaded: number, total: number) => void} [options.onProgress]
 * @returns {Promise<void>} resolves once every icon has loaded or errored.
 */
export function preloadAbilityIcons({ createImage = () => new Image(), onProgress } = {}) {
  const urls = buildAbilityIconUrls();
  const total = urls.length;
  let loaded = 0;

  const loadOne = (url) => new Promise((resolve) => {
    const img = createImage();
    const settle = () => {
      loaded++;
      if (onProgress) onProgress(loaded, total);
      resolve();
    };
    img.addEventListener('load', settle);
    img.addEventListener('error', settle);
    img.src = url;
  });

  return Promise.all(urls.map(loadOne)).then(() => {});
}
