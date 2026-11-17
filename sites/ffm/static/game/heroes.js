// The shared hero roster: the six colour schemes of the one hero a family profile can choose from, in
// roster order, plus the one rule for turning a stored choice into the hero to
// use. The module is pure data and logic (no imports, no DOM, no network) so the
// web app and both native apps can load the same file.
//
// Paths are relative to static/game. The adventurer's atlas and frames still
// point at the original hero/ files until the cut-over moves them into heroes/.

export const HERO_STRIKE_FAMILIES = Object.freeze([
  'sword',
  'bow',
  'buckler',
  'staff',
  'fist',
]);

export const DEFAULT_HERO_ID = 'adventurer';

// Roster paths are relative to this file, not to the page that shows them: use this for an <img src>.
export function heroAssetUrl(path) {
  return new URL(path, import.meta.url).href;
}

export const HERO_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

function hero(id, strike, free = false) {
  const dir = `heroes/${id}`;
  return Object.freeze({
    id,
    nameKey: `heroes.name.${id}`,
    strike,
    portrait: `${dir}/portrait.webp`,
    atlas: `${dir}/hero-atlas.webp`,
    frames: `${dir}/hero-frames.js`,
    free,
  });
}

// One hero, six colour schemes (scripts/hero_recolor.py bakes them from static/game/hero/).
// Ari is the original colours and keeps the id 'adventurer', the stored default.
export const HEROES = Object.freeze([
  Object.freeze({
    ...hero('adventurer', 'sword', true),
    atlas: 'hero/hero-atlas.webp',
    frames: 'hero/hero-frames.js',
  }),
  hero('wood', 'sword'),
  hero('flint', 'sword'),
  hero('carl', 'sword'),
  hero('ori', 'sword'),
  hero('quirl', 'sword'),
]);

// Returns the hero to use for a stored choice. Anything that is not a known,
// well-formed id falls back to the default, and so does a pack hero unless the
// caller has confirmed the entitlement with entitled === true. The free hero is
// always returned. Never throws.
export function resolveHero(storedId, options) {
  const fallback = HEROES.find((entry) => entry.id === DEFAULT_HERO_ID);
  if (typeof storedId !== 'string' || !HERO_ID_PATTERN.test(storedId)) {
    return fallback;
  }
  const chosen = HEROES.find((entry) => entry.id === storedId);
  if (!chosen) return fallback;
  if (chosen.free || options?.entitled === true) return chosen;
  return fallback;
}
