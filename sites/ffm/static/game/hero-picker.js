// The shared hero grid for the app picker and the web account picker. The
// markup builder is pure string work and the mount function only touches the
// root it is given, so the same file runs in the browser, the native webview
// and node tests. Atlas loading, entitlements and profile writes stay with the
// caller, which passes them in as callbacks.

import { HEROES, heroAssetUrl } from './heroes.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function label(t, hero, locked, selected) {
  const name = t(hero.nameKey);
  if (locked) return `${name}, ${t('heroes.locked')}`;
  if (selected) return `${name}, ${t('heroes.selected')}`;
  return name;
}

function placeholderMarkup(t) {
  return `<span class="hero-picker-placeholder" role="img" aria-label="${esc(t('heroes.placeholderAlt'))}"></span>`;
}

// The frame classes of one grid button. `current` is the hero the player wears
// now and `selected` the one highlighted in the picker: the worn hero keeps the
// thick gold frame, and a different highlighted hero (the one "Change hero"
// would put on) gets the thin gold frame, so both stay visible at once.
export function heroItemClasses({ locked = false, selected = false, current = false } = {}) {
  return `hero-picker-item${locked ? ' is-locked' : ''}${selected ? ' is-selected' : ''}`
    + `${current ? ' is-current' : ''}${selected && !current ? ' is-prospective' : ''}`;
}

// Returns the grid as an HTML string: one native button per hero in roster
// order, then the preview area and the status line for the blocked message.
export function buildHeroGridMarkup(options) {
  const {
    heroes = HEROES,
    selectedId,
    currentId = selectedId,
    isLocked = () => false,
    t,
    portraitUrl = (hero) => heroAssetUrl(hero.portrait),
  } = options;
  const items = heroes.map((hero) => {
    const locked = Boolean(isLocked(hero));
    const selected = hero.id === selectedId;
    const name = t(hero.nameKey);
    const classes = heroItemClasses({ locked, selected, current: hero.id === currentId });
    const badge = locked
      ? `<span class="hero-picker-lock" role="img" aria-label="${esc(t('heroes.locked'))}">&#128274;</span>`
      : '';
    return (
      `<button type="button" class="${classes}" data-hero-id="${esc(hero.id)}"` +
      ` aria-pressed="${selected ? 'true' : 'false'}"` +
      ` aria-label="${esc(label(t, hero, locked, selected))}">` +
      `<img class="hero-picker-portrait" data-hero-portrait alt="" src="${esc(portraitUrl(hero))}">` +
      `${badge}<span class="hero-picker-name">${esc(name)}</span></button>`
    );
  });
  return (
    `<div class="hero-picker-grid">${items.join('')}</div>` +
    '<div class="hero-picker-preview" data-hero-preview></div>' +
    '<p class="hero-picker-status" role="status" data-hero-status></p>'
  );
}

// Renders the grid into root and wires selection through the callbacks.
// Returns { update(), destroy() }. Adds no timer, key listener or focus trap.
export function mountHeroPicker(root, options) {
  const {
    heroes = HEROES,
    getSelectedId = () => undefined,
    // The saved hero, when it differs from the highlighted one (the app picker
    // saves only on "Change hero"); the web picker saves on tap, so both match.
    getCurrentId = getSelectedId,
    canChange = () => true,
    isLocked = () => false,
    onSelect = () => {},
    onLocked = () => {},
    renderPreview = () => {},
    t,
    portraitUrl,
  } = options;
  let cleanups = [];
  let highlighted = null;

  function find(id) {
    return heroes.find((hero) => hero.id === id);
  }

  function preview(hero) {
    highlighted = hero;
    const area = root.querySelector('[data-hero-preview]');
    if (hero && area) renderPreview(hero, area);
  }

  function setStatus(text) {
    const status = root.querySelector('[data-hero-status]');
    if (status) status.textContent = text;
  }

  function bind() {
    cleanups.forEach((fn) => fn());
    cleanups = [];
    root.innerHTML = buildHeroGridMarkup({
      heroes,
      selectedId: getSelectedId(),
      currentId: getCurrentId(),
      isLocked,
      t,
      portraitUrl,
    });
    for (const button of root.querySelectorAll('button[data-hero-id]')) {
      const hero = find(button.getAttribute('data-hero-id'));
      if (!hero) continue;
      const onClick = () => {
        preview(hero);
        if (isLocked(hero)) {
          onLocked(hero);
          return;
        }
        if (!canChange()) {
          setStatus(t('heroes.blockedWhilePlaying'));
          return;
        }
        setStatus('');
        onSelect(hero);
        refresh();
      };
      const onFocus = () => preview(hero);
      button.addEventListener('click', onClick);
      button.addEventListener('focus', onFocus);
      cleanups.push(() => {
        button.removeEventListener('click', onClick);
        button.removeEventListener('focus', onFocus);
      });
      const img = button.querySelector('img[data-hero-portrait]');
      if (img) {
        const onError = () => {
          const holder = root.ownerDocument.createElement('span');
          holder.innerHTML = placeholderMarkup(t);
          img.replaceWith(holder.firstChild ?? holder);
        };
        img.addEventListener('error', onError);
        cleanups.push(() => img.removeEventListener('error', onError));
      }
    }
  }

  // Keeps the pressed state and the frames in step with the caller's selection
  // without rebuilding the buttons, so focus stays where it is.
  function refresh() {
    const selectedId = getSelectedId();
    const currentId = getCurrentId();
    for (const button of root.querySelectorAll('button[data-hero-id]')) {
      const hero = find(button.getAttribute('data-hero-id'));
      if (!hero) continue;
      const selected = hero.id === selectedId;
      button.setAttribute('class', heroItemClasses({
        locked: Boolean(isLocked(hero)), selected, current: hero.id === currentId,
      }));
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.setAttribute('aria-label', label(t, hero, Boolean(isLocked(hero)), selected));
    }
  }

  bind();
  preview(find(getSelectedId()) ?? heroes[0]);

  return {
    update() {
      bind();
      preview(highlighted ?? find(getSelectedId()) ?? heroes[0]);
    },
    destroy() {
      cleanups.forEach((fn) => fn());
      cleanups = [];
    },
  };
}
