// Wiring tests for the ability artwork: how ability-bar.js resolves and
// reveals the three owner-delivered icons, how a failed load falls back to the
// localized name, and how asset-preload.js warms the URLs. The icon files are
// owner-delivered art that may not exist yet, so nothing here touches disk.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createAbilityBar } from './ability-bar.js';
import {
  ABILITY_ICON_IDS,
  buildAbilityIconUrls,
  preloadAbilityIcons,
} from './asset-preload.js';
import { _resetForTests, setLocale, t } from './i18n.js';

afterEach(() => {
  _resetForTests();
});

function fakeElement(tagName) {
  const listeners = new Map();
  const attributes = {};
  const node = {
    tagName: String(tagName).toUpperCase(),
    id: '',
    className: '',
    type: '',
    title: '',
    textContent: '',
    hidden: false,
    src: '',
    disabled: false,
    tabIndex: -1,
    dataset: {},
    children: [],
    parentNode: null,
    style: { setProperty() {} },
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(attributes, name) ? attributes[name] : null; },
    removeAttribute(name) { delete attributes[name]; },
    addEventListener(type, callback) {
      const list = listeners.get(type) ?? [];
      list.push(callback);
      listeners.set(type, list);
    },
    removeEventListener(type, callback) {
      const list = listeners.get(type) ?? [];
      listeners.set(type, list.filter((entry) => entry !== callback));
    },
    dispatchEvent(event) {
      for (const callback of listeners.get(event.type) ?? []) callback(event);
      return true;
    },
    remove() {
      if (!node.parentNode) return;
      node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
      node.parentNode = null;
    },
  };
  return node;
}

function fakeDocument() {
  const chrome = fakeElement('section');
  chrome.id = 'gameplay-chrome';
  const byId = new Map([['gameplay-chrome', chrome]]);
  const doc = {
    getElementById(id) { return byId.get(id) ?? null; },
    createElement(tagName) { return fakeElement(tagName); },
  };
  return { chrome, doc };
}

const slotOf = (bar, id) => bar.buttons.find((slot) => slot.dataset.ability === id);
const childByClass = (slot, className) => slot.children.find((child) => child.className === className);
const iconOf = (bar, id) => childByClass(slotOf(bar, id), 'ability-slot-icon');
const nameOf = (bar, id) => childByClass(slotOf(bar, id), 'ability-slot-name');

function fakeImageFactory() {
  const created = [];
  return {
    created,
    createImage() {
      const img = fakeElement('img');
      created.push(img);
      return img;
    },
  };
}

describe('ability icon rendering', () => {
  it('resolves ./assets/ability-<id>.webp for wind, storm and earth and marks the icons decorative', () => {
    const { doc } = fakeDocument();
    const bar = createAbilityBar({ doc });
    bar.update({ level: 11, progress: 1 });

    assert.deepEqual(ABILITY_ICON_IDS, ['wind', 'storm', 'earth']);
    for (const id of ABILITY_ICON_IDS) {
      const icon = iconOf(bar, id);
      assert.ok(icon, `${id} must render an icon element`);
      assert.equal(icon.tagName, 'IMG');
      assert.equal(icon.getAttribute('alt'), '', `${id} icon must be decorative`);
      assert.ok(icon.src.endsWith(`/assets/ability-${id}.webp`), icon.src);
      assert.equal(icon.hidden, true, 'the icon waits for its load event');
    }
  });

  it('reveals the artwork and hides the visible name only once the image loads', () => {
    const { doc } = fakeDocument();
    const bar = createAbilityBar({ doc });
    bar.update({ level: 11, progress: 1 });

    const slot = slotOf(bar, 'wind');
    const icon = iconOf(bar, 'wind');
    assert.equal(slot.dataset.icon, undefined);

    icon.dispatchEvent({ type: 'load' });
    assert.equal(slot.dataset.icon, 'loaded');
    assert.equal(icon.hidden, false);
  });

  it('shows no artwork on locked slots and requests it on the first unlock', () => {
    const { doc } = fakeDocument();
    const bar = createAbilityBar({ doc });
    bar.update({ level: 1, progress: 1 });

    const slot = slotOf(bar, 'earth');
    const icon = iconOf(bar, 'earth');
    assert.equal(slot.dataset.state, 'locked');
    assert.equal(slot.dataset.icon, undefined);
    assert.equal(icon.hidden, true);
    assert.ok(!icon.src, 'a locked slot must not request artwork');

    bar.update({ level: 11, progress: 1 });
    assert.ok(icon.src.endsWith('/assets/ability-earth.webp'));
  });

  it('hides a previously loaded icon again when the slot relocks', () => {
    const { doc } = fakeDocument();
    const bar = createAbilityBar({ doc });
    bar.update({ level: 11, progress: 1 });
    const slot = slotOf(bar, 'storm');
    const icon = iconOf(bar, 'storm');
    icon.dispatchEvent({ type: 'load' });
    assert.equal(slot.dataset.icon, 'loaded');

    bar.update({ level: 1, progress: 1 });
    assert.equal(slot.dataset.state, 'locked');
    assert.equal(slot.dataset.icon, undefined);
    assert.equal(icon.hidden, true);

    bar.update({ level: 11, progress: 1 });
    assert.equal(slot.dataset.icon, 'loaded');
    assert.equal(icon.hidden, false);
  });

  it('falls back to the localized ability name when the icon fails, with no reload', () => {
    setLocale('de');
    const { doc } = fakeDocument();
    const bar = createAbilityBar({ doc, translate: t });
    bar.update({ level: 11, progress: 1 });

    const slot = slotOf(bar, 'storm');
    const icon = iconOf(bar, 'storm');
    icon.dispatchEvent({ type: 'error' });

    assert.equal(slot.dataset.icon, 'error');
    assert.equal(icon.hidden, true, 'the broken image is hidden');
    assert.equal(nameOf(bar, 'storm').textContent, 'Sturm');
  });
});

describe('preloadAbilityIcons', () => {
  it('preloads the three icon URLs through the injected factory and resolves after every load', async () => {
    const factory = fakeImageFactory();
    const progress = [];
    const done = preloadAbilityIcons({
      createImage: factory.createImage,
      onProgress: (loaded, total) => progress.push([loaded, total]),
    });

    assert.deepEqual(factory.created.map((img) => img.src), buildAbilityIconUrls());
    for (const img of factory.created) img.dispatchEvent({ type: 'load' });
    await done;

    assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
  });

  it('resolves on error too, so a missing icon can never hang the loading path', async () => {
    const factory = fakeImageFactory();
    const done = preloadAbilityIcons({ createImage: factory.createImage });
    for (const img of factory.created) img.dispatchEvent({ type: 'error' });
    await assert.doesNotReject(done);
  });
});

describe('ability icon styles', () => {
  it('keeps locked slots artwork-free and swaps the visible name by icon state', async () => {
    const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
    assert.match(css, /\.ability-slot\[data-state="locked"\] \.ability-slot-icon\s*\{\s*display:\s*none/);
    assert.match(css, /\.ability-slot-icon\[hidden\]\s*\{\s*display:\s*none/);
    assert.match(css, /\.ability-slot\[data-icon="loaded"\] \.ability-slot-name\s*\{[^}]*clip:\s*rect/);
    assert.match(css, /\.ability-slot\[data-icon="error"\] \.ability-slot-name\s*\{[^}]*position:\s*static/);
  });

  it('breathes the ready light only when the player allows motion', async () => {
    const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
    // A media block nests rules, so it has to be cut by brace depth rather than
    // by the first closing brace it meets.
    const header = '@media (prefers-reduced-motion: no-preference)';
    const start = css.indexOf(header);
    assert.ok(start >= 0, 'the motion query exists');
    let depth = 0;
    let end = -1;
    for (let i = css.indexOf('{', start); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    assert.ok(end > start, 'the motion query closes');
    const motion = css.slice(start, end);
    // The pulse lives on the light layer, never on the button itself: animating
    // the button's box-shadow would wipe the glass rim on every frame.
    assert.match(motion, /\.ability-slot\[data-state="ready"\] \.ability-slot-glow\s*\{\s*animation:/);
    assert.doesNotMatch(css, /\.ability-slot\[data-state="ready"\]\s*\{[^}]*animation:/);

    const withoutMotion = css.slice(0, start) + css.slice(end);
    assert.doesNotMatch(withoutMotion, /animation: ability-orb/);
    // Reduced motion keeps the light itself, just still.
    assert.match(withoutMotion, /\.ability-slot\[data-state="ready"\] \.ability-slot-glow \{ opacity: 1; \}/);
  });

  it('never reads icon files from disk', async () => {
    for (const file of ['./ability-bar.js', './asset-preload.js']) {
      const source = await readFile(new URL(file, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /node:fs|existsSync|statSync/, `${file} must not check icon files`);
    }
  });
});
