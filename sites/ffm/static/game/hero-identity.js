// Renders the active hero's portrait next to a player name. The renderer owns
// exactly one element inside the target (marked data-hero-identity) and never
// touches the target's other children. A hero without a portrait, or a portrait
// that fails to load, shows a neutral placeholder; the placeholder has no src,
// so swapping to it makes no request and cannot loop.

export const HERO_IDENTITY_ATTR = 'data-hero-identity';
export const HERO_IDENTITY_CLASS = 'hero-identity-portrait';

function ownedElement(target) {
  for (const child of Array.from(target.children ?? [])) {
    if (child.hasAttribute?.(HERO_IDENTITY_ATTR)) return child;
  }
  return null;
}

function buildPlaceholder(doc, t) {
  const el = doc.createElement('span');
  el.className = `${HERO_IDENTITY_CLASS} ${HERO_IDENTITY_CLASS}-placeholder`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', t('heroes.placeholderAlt'));
  return el;
}

function buildPortrait(doc, hero, t, showPlaceholder) {
  const img = doc.createElement('img');
  img.className = HERO_IDENTITY_CLASS;
  img.setAttribute('alt', t('heroes.portraitAlt', { name: t(hero.nameKey) }));
  img.setAttribute('src', hero.portrait);
  img.setAttribute('decoding', 'async');
  img.addEventListener('error', showPlaceholder);
  return img;
}

// Inserts, updates or removes the portrait inside `target`. `hero` is a roster
// entry (see heroes.js) or null/undefined to remove it. Safe to call repeatedly.
export function renderHeroIdentity(target, hero, { t } = {}) {
  if (!target) return null;
  const existing = ownedElement(target);
  if (!hero) {
    existing?.remove();
    return null;
  }
  const doc = target.ownerDocument ?? globalThis.document;
  const key = `${hero.id}|${hero.portrait ?? ''}`;
  if (existing?.getAttribute(HERO_IDENTITY_ATTR) === key) return existing;

  let element;
  if (!hero.portrait) {
    element = buildPlaceholder(doc, t);
  } else {
    element = buildPortrait(doc, hero, t, () => {
      if (element.parentNode) {
        const placeholder = buildPlaceholder(doc, t);
        placeholder.setAttribute(HERO_IDENTITY_ATTR, key);
        element.replaceWith(placeholder);
        element = placeholder;
      }
    });
  }
  element.setAttribute(HERO_IDENTITY_ATTR, key);
  if (existing) existing.replaceWith(element);
  else target.prepend(element);
  return element;
}
