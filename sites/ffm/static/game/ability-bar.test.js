import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ABILITY_BAR_ID,
  ABILITY_SLOT_CLASS,
  createAbilityBar,
} from './ability-bar.js';
import { ABILITY_ROSTER } from './cooldown-abilities.js';
import { calculateSceneLayout } from './viewport-layout.js';
import { _resetForTests, setLocale, t } from './i18n.js';

afterEach(() => {
  _resetForTests();
});

function fakeElement(tagName) {
  const listeners = new Map();
  const attributes = {};
  const styleValues = new Map();
  const node = {
    tagName: String(tagName).toUpperCase(),
    id: '',
    className: '',
    type: '',
    title: '',
    textContent: '',
    disabled: false,
    tabIndex: -1,
    dataset: {},
    children: [],
    parentNode: null,
    style: {
      setProperty(name, value) { styleValues.set(name, String(value)); },
      getPropertyValue(name) { return styleValues.get(name) ?? ''; },
    },
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
    listenerCount(type) { return (listeners.get(type) ?? []).length; },
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

const slotOf = (bar, id) => bar.element.children.find((slot) => slot.dataset.ability === id);
const childByClass = (slot, className) => slot.children.find((child) => child.className === className);

function keydown(key, extra = {}) {
  const event = {
    type: 'keydown',
    key,
    repeat: false,
    defaultPrevented: false,
    preventDefault() { event.defaultPrevented = true; },
    ...extra,
  };
  return event;
}

describe('ability bar structure', () => {
  it('creates exactly three native buttons in wind, storm, earth order inside #gameplay-chrome', () => {
    const { chrome, doc } = fakeDocument();
    const bar = createAbilityBar({ doc, translate: (key) => key });

    assert.equal(bar.element.id, ABILITY_BAR_ID);
    assert.equal(bar.element.getAttribute('role'), 'group');
    assert.equal(bar.element.getAttribute('aria-label'), 'ability.barLabel');
    assert.deepEqual(chrome.children, [bar.element]);
    assert.equal(bar.element.children.length, 3);
    assert.deepEqual(
      bar.element.children.map((slot) => slot.dataset.ability),
      ['wind', 'storm', 'earth'],
    );
    for (const slot of bar.element.children) {
      assert.equal(slot.tagName, 'BUTTON');
      assert.equal(slot.type, 'button');
      assert.equal(slot.className, ABILITY_SLOT_CLASS);
    }
  });

  it('takes names and descriptions from ability.<id>.name and ability.<id>.description', () => {
    const { doc } = fakeDocument();
    const bar = createAbilityBar({ doc, translate: (key) => key });
    for (const { id } of ABILITY_ROSTER) {
      const slot = slotOf(bar, id);
      assert.equal(childByClass(slot, 'ability-slot-name').textContent, `ability.${id}.name`);
      assert.equal(
        childByClass(slot, 'ability-slot-description').textContent,
        `ability.${id}.description`,
      );
    }
  });

  it('unlocks wind, storm and earth at levels 1, 6 and 11 and keeps locked slots out of the tab order', () => {
    const { doc } = fakeDocument();
    const bar = createAbilityBar({ doc, translate: (key) => key });

    const expected = new Map([
      [1, ['ready', 'locked', 'locked']],
      [5, ['ready', 'locked', 'locked']],
      [6, ['ready', 'ready', 'locked']],
      [10, ['ready', 'ready', 'locked']],
      [11, ['ready', 'ready', 'ready']],
      [20, ['ready', 'ready', 'ready']],
    ]);
    for (const [level, states] of expected) {
      bar.update({ level, progress: 1 });
      const slots = bar.element.children;
      assert.deepEqual(slots.map((slot) => slot.dataset.state), states, `level ${level}`);
      slots.forEach((slot, index) => {
        const locked = states[index] === 'locked';
        assert.equal(slot.disabled, locked, `level ${level} ${slot.dataset.ability} disabled`);
        assert.equal(slot.tabIndex, locked ? -1 : 0, `level ${level} ${slot.dataset.ability} tabIndex`);
        assert.equal(slot.getAttribute('aria-disabled'), String(locked));
      });
    }
  });

  it('destroy removes the element and its listeners', () => {
    const { chrome, doc } = fakeDocument();
    const activated = [];
    const bar = createAbilityBar({ doc, onActivate: (id) => activated.push(id) });
    const wind = slotOf(bar, 'wind');
    assert.equal(wind.listenerCount('click'), 1);
    assert.equal(wind.listenerCount('keydown'), 1);

    bar.destroy();
    assert.equal(chrome.children.length, 0);
    assert.equal(wind.listenerCount('click'), 0);
    assert.equal(wind.listenerCount('keydown'), 0);
    wind.dispatchEvent({ type: 'click' });
    assert.deepEqual(activated, []);
  });
});

describe('activation', () => {
  it('activates a ready slot once on click, Enter and Space', () => {
    const { doc } = fakeDocument();
    const activated = [];
    const bar = createAbilityBar({ doc, onActivate: (id) => activated.push(id) });
    bar.update({ level: 11, progress: 1 });

    slotOf(bar, 'wind').dispatchEvent({ type: 'click' });
    const enter = keydown('Enter');
    slotOf(bar, 'storm').dispatchEvent(enter);
    const space = keydown(' ');
    slotOf(bar, 'earth').dispatchEvent(space);

    assert.deepEqual(activated, ['wind', 'storm', 'earth']);
    assert.equal(enter.defaultPrevented, true);
    assert.equal(space.defaultPrevented, true);
  });

  it('ignores key repeats, cooling slots and locked slots', () => {
    const { doc } = fakeDocument();
    const activated = [];
    const bar = createAbilityBar({ doc, onActivate: (id) => activated.push(id) });
    bar.update({ level: 1, progress: 1 });

    slotOf(bar, 'wind').dispatchEvent(keydown('Enter', { repeat: true }));
    slotOf(bar, 'storm').dispatchEvent(keydown('Enter'));
    slotOf(bar, 'earth').dispatchEvent({ type: 'click' });
    assert.deepEqual(activated, []);

    bar.update({ level: 11, progress: { wind: 0.5, storm: 0.5, earth: 0.5 } });
    slotOf(bar, 'wind').dispatchEvent({ type: 'click' });
    slotOf(bar, 'storm').dispatchEvent(keydown(' '));
    assert.deepEqual(activated, []);
  });
});

describe('cooling state', () => {
  it('shows remaining whole seconds and a clamped 0-1 sweep', () => {
    const { doc } = fakeDocument();
    const bar = createAbilityBar({ doc, translate: (key) => key });
    bar.update({ level: 11, progress: { wind: 0.5, storm: 0, earth: 1 } });

    const wind = slotOf(bar, 'wind');
    assert.equal(wind.dataset.state, 'cooling');
    assert.equal(childByClass(wind, 'ability-slot-cooldown').textContent, '90');
    assert.equal(wind.style.getPropertyValue('--ability-progress'), '0.5');

    const storm = slotOf(bar, 'storm');
    assert.equal(storm.dataset.state, 'cooling');
    assert.equal(childByClass(storm, 'ability-slot-cooldown').textContent, '180');
    assert.equal(storm.style.getPropertyValue('--ability-progress'), '0');

    const earth = slotOf(bar, 'earth');
    assert.equal(earth.dataset.state, 'ready');
    assert.equal(childByClass(earth, 'ability-slot-cooldown').textContent, '');
    assert.equal(earth.style.getPropertyValue('--ability-progress'), '1');
  });

  it('clamps progress below 0 and above 1', () => {
    const { doc } = fakeDocument();
    const bar = createAbilityBar({ doc });
    bar.update({ level: 11, progress: -5 });
    for (const slot of bar.element.children) {
      assert.equal(slot.dataset.state, 'cooling');
      assert.equal(childByClass(slot, 'ability-slot-cooldown').textContent, '180');
      assert.equal(slot.style.getPropertyValue('--ability-progress'), '0');
    }

    bar.update({ level: 11, progress: 5 });
    for (const slot of bar.element.children) {
      assert.equal(slot.dataset.state, 'ready');
      assert.equal(slot.style.getPropertyValue('--ability-progress'), '1');
    }
  });

  it('rounds the remaining seconds up so a cooling slot never reads 0', () => {
    const { doc } = fakeDocument();
    const bar = createAbilityBar({ doc });
    bar.update({ level: 1, progress: 179.5 / 180 });
    const wind = slotOf(bar, 'wind');
    assert.equal(wind.dataset.state, 'cooling');
    assert.equal(childByClass(wind, 'ability-slot-cooldown').textContent, '1');
  });
});

describe('localization', () => {
  it('has complete English and German names and descriptions', () => {
    for (const locale of ['en', 'de']) {
      setLocale(locale);
      assert.ok(t('ability.barLabel'));
      for (const { id } of ABILITY_ROSTER) {
        const name = t(`ability.${id}.name`);
        const description = t(`ability.${id}.description`);
        assert.ok(name && !name.startsWith('ability.'), `${locale} ${id} name`);
        assert.ok(description && !description.startsWith('ability.'), `${locale} ${id} description`);
      }
    }
  });

  it('renders the active locale and refreshes when the locale changes', () => {
    const { doc } = fakeDocument();
    setLocale('en');
    const bar = createAbilityBar({ doc, translate: t });
    assert.equal(childByClass(slotOf(bar, 'wind'), 'ability-slot-name').textContent, 'Wind');

    setLocale('de');
    bar.update({ level: 11, progress: 1 });
    assert.equal(childByClass(slotOf(bar, 'wind'), 'ability-slot-name').textContent, 'Wind');
    assert.equal(childByClass(slotOf(bar, 'storm'), 'ability-slot-name').textContent, 'Sturm');
    assert.equal(childByClass(slotOf(bar, 'earth'), 'ability-slot-name').textContent, 'Erde');
  });
});

describe('purity and layout', () => {
  it('never reads a clock or schedules its own work', async () => {
    const source = await readFile(new URL('./ability-bar.js', import.meta.url), 'utf8');
    for (const forbidden of [
      /\bDate\b/,
      /\bperformance\b/,
      /\bsetInterval\b/,
      /\bsetTimeout\b/,
      /\brequestAnimationFrame\b/,
      /\bMath\.random\b/,
    ]) {
      assert.doesNotMatch(source, forbidden);
    }
  });

  it('styles the bar as a normal-flow row with 44px targets and a conic sweep', async () => {
    const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
    const barRule = css.match(/#ability-bar\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(barRule, /grid-column:\s*1\s*\/\s*-1/);
    assert.match(barRule, /width:\s*100%/);
    assert.doesNotMatch(barRule, /position:\s*(fixed|absolute)/);

    const slotRule = css.match(/\.ability-slot\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(slotRule, /min-width:\s*44px/);
    assert.match(slotRule, /min-height:\s*44px/);

    const coolingRule = css.match(/\.ability-slot\[data-state="cooling"\]::after\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(coolingRule, /conic-gradient/);
    assert.match(coolingRule, /--ability-progress/);
  });

  it('the extra bar row still leaves the answers and portrait sword row visible', () => {
    // 320x568 portrait with the app's four answers and the 22px sword row.
    const portraitChrome = 140;
    const portrait = calculateSceneLayout(320, 568 - portraitChrome - 6, 4, false);
    assert.ok(portrait.sceneWidth > 0 && portrait.sceneHeight > 0);
    const portraitInput = 568 - portraitChrome - 6 - portrait.sceneHeight;
    assert.ok(portraitInput >= 16 + 22 + 6 + 44, `portrait input zone ${portraitInput}`);

    // 800x450 landscape with ten five-digit answers.
    const landscapeChrome = 100;
    const landscape = calculateSceneLayout(800, 450 - landscapeChrome - 6, 10, true);
    assert.ok(landscape.sceneWidth > 0 && landscape.sceneHeight > 0);
    assert.ok((landscape.answerWidth - 16 - (landscape.columns - 1) * 6) / landscape.columns >= 44);
    assert.ok((landscape.answerHeight - 16 - (landscape.rows - 1) * 6) / landscape.rows >= 44);
  });
});
