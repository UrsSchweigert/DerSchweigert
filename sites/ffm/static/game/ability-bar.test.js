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
    insertBefore(child, reference) {
      child.parentNode = node;
      const index = reference ? node.children.indexOf(reference) : -1;
      if (index < 0) node.children.push(child);
      else node.children.splice(index, 0, child);
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

function fakeDocument({ withAnswerZone = true } = {}) {
  const chrome = fakeElement('section');
  chrome.id = 'gameplay-chrome';
  const byId = new Map([['gameplay-chrome', chrome]]);
  let answers = null;
  if (withAnswerZone) {
    const zone = fakeElement('div');
    zone.id = 'input-zone';
    answers = fakeElement('div');
    answers.id = 'mc-buttons';
    zone.appendChild(answers);
    byId.set('input-zone', zone);
    byId.set('mc-buttons', answers);
  }
  const doc = {
    getElementById(id) { return byId.get(id) ?? null; },
    createElement(tagName) { return fakeElement(tagName); },
  };
  return { chrome, byId, answers, doc };
}

const slotOf = (bar, id) => bar.buttons.find((slot) => slot.dataset.ability === id);
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
  it('creates exactly three native buttons in wind, storm, earth order under the sword row', () => {
    const { byId, doc } = fakeDocument();
    const bar = createAbilityBar({ doc, translate: (key) => key });

    assert.equal(bar.element.id, ABILITY_BAR_ID);
    assert.equal(bar.element.getAttribute('role'), 'group');
    assert.equal(bar.element.getAttribute('aria-label'), 'ability.barLabel');
    // The circles are the line between the portrait sword row and the answers.
    const zone = byId.get('input-zone');
    assert.deepEqual(zone.children.map((child) => child.id), [ABILITY_BAR_ID, 'mc-buttons']);
    assert.equal(byId.get('gameplay-chrome').children.length, 0);
    assert.equal(bar.buttons.length, 3);
    assert.deepEqual(
      bar.buttons.map((slot) => slot.dataset.ability),
      ['wind', 'storm', 'earth'],
    );
    for (const slot of bar.buttons) {
      assert.equal(slot.tagName, 'BUTTON');
      assert.equal(slot.type, 'button');
      assert.equal(slot.className, ABILITY_SLOT_CLASS);
    }
  });

  it('frames the row with two mirrored dragon brackets that take no layout space', () => {
    const { doc } = fakeDocument();
    const bar = createAbilityBar({ doc, translate: (key) => key });
    assert.equal(bar.ornaments.length, 2);
    assert.deepEqual(
      bar.ornaments.map((img) => img.className),
      ['ability-ornament ability-ornament--left', 'ability-ornament ability-ornament--right'],
    );
    for (const ornament of bar.ornaments) {
      assert.equal(ornament.tagName, 'IMG');
      // Decorative: no alt text and out of the accessibility tree.
      assert.equal(ornament.getAttribute('alt'), '');
      assert.equal(ornament.getAttribute('aria-hidden'), 'true');
      assert.match(ornament.src, /assets\/ability-ornament\.webp$/);
      assert.equal(ornament.parentNode, bar.element, 'the bar owns them, the slots do not');
    }
    // Both sides use the one sprite; the stylesheet mirrors the right one.
    assert.equal(bar.ornaments[0].src, bar.ornaments[1].src);
    // They render above and below the buttons in DOM order but not in between.
    assert.deepEqual(
      bar.element.children.map((child) => child.tagName),
      ['IMG', 'IMG', 'BUTTON', 'BUTTON', 'BUTTON'],
    );
  });

  it('gives every slot its own ready-light layer', () => {
    const { doc } = fakeDocument();
    const bar = createAbilityBar({ doc, translate: (key) => key });
    bar.update({ level: 1, progress: 1 });
    for (const slot of bar.buttons) {
      const glow = childByClass(slot, 'ability-slot-glow');
      assert.ok(glow, `${slot.dataset.ability} has a light layer`);
      assert.equal(glow.getAttribute('aria-hidden'), 'true');
    }
    // The layer is CSS-driven: the module never animates it.
    const [wind] = bar.buttons;
    assert.equal(wind.dataset.state, 'ready');
  });

  it('falls back to #gameplay-chrome when the answer zone is missing', () => {
    const { chrome, doc } = fakeDocument({ withAnswerZone: false });
    const bar = createAbilityBar({ doc, translate: (key) => key });
    assert.deepEqual(chrome.children, [bar.element]);
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
      const slots = bar.buttons;
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
    const { byId, doc } = fakeDocument();
    const activated = [];
    const bar = createAbilityBar({ doc, onActivate: (id) => activated.push(id) });
    const wind = slotOf(bar, 'wind');
    assert.equal(wind.listenerCount('click'), 1);
    assert.equal(wind.listenerCount('keydown'), 1);

    bar.destroy();
    assert.equal(byId.get('input-zone').children.length, 1);
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

  it('reports the press before the cast, only for a ready slot', () => {
    const { doc } = fakeDocument();
    const events = [];
    const bar = createAbilityBar({
      doc,
      onPress: (id, button) => events.push(['press', id, button.dataset.ability]),
      onActivate: (id) => events.push(['activate', id]),
    });

    bar.update({ level: 1, progress: 1 });
    slotOf(bar, 'wind').dispatchEvent({ type: 'click' });
    assert.deepEqual(events, [['press', 'wind', 'wind'], ['activate', 'wind']],
      'the orb cracks under the finger before the cast is attempted');

    events.length = 0;
    slotOf(bar, 'storm').dispatchEvent({ type: 'click' });
    slotOf(bar, 'earth').dispatchEvent({ type: 'click' });
    bar.update({ level: 11, progress: 0.5 });
    slotOf(bar, 'wind').dispatchEvent({ type: 'click' });
    assert.deepEqual(events, [], 'locked and cooling orbs stay silent');
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
    assert.equal(childByClass(earth, 'ability-slot-cooldown').textContent, 'Ready');
    assert.equal(earth.style.getPropertyValue('--ability-progress'), '1');
  });

  it('clamps progress below 0 and above 1', () => {
    const { doc } = fakeDocument();
    const bar = createAbilityBar({ doc });
    bar.update({ level: 11, progress: -5 });
    for (const slot of bar.buttons) {
      assert.equal(slot.dataset.state, 'cooling');
      assert.equal(childByClass(slot, 'ability-slot-cooldown').textContent, '180');
      assert.equal(slot.style.getPropertyValue('--ability-progress'), '0');
    }

    bar.update({ level: 11, progress: 5 });
    for (const slot of bar.buttons) {
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

  it('styles the bar as three centred circles with 44px+ targets and a conic sweep', async () => {
    const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
    const barRule = css.match(/#ability-bar\s*\{([^}]*)\}/)?.[1] ?? '';
    // A normal-flow line of the answer zone, placed under the sword row.
    assert.match(barRule, /order:\s*-1/);
    assert.match(barRule, /flex:\s*0 0 100%/);
    assert.match(barRule, /justify-content:\s*center/);
    assert.doesNotMatch(barRule, /position:\s*(fixed|absolute)/);
    const swordsRule = css.match(/\.app-encounter-swords\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(swordsRule, /order:\s*-2/);

    const slotRule = css.match(/\.ability-slot\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(slotRule, /border-radius:\s*50%/);
    const slotSize = Number(slotRule.match(/width:\s*(\d+)px/)?.[1]);
    assert.ok(slotSize >= 44, `slot width ${slotSize}`);
    assert.equal(Number(slotRule.match(/height:\s*(\d+)px/)?.[1]), slotSize);

    const readoutRule = css.match(/\.ability-slot-readout\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(readoutRule, /position:\s*absolute/);
    assert.match(readoutRule, /top:\s*calc\(100%/);

    const coolingRule = css.match(/\.ability-slot\[data-state="cooling"\]::after\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(coolingRule, /conic-gradient/);
    assert.match(coolingRule, /--ability-progress/);
  });

  it('lays the dragons flat in the free space beside the orb row', async () => {
    const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
    const ornRule = css.match(/^\.ability-ornament \{([^}]*)\}/m)?.[1] ?? '';
    assert.ok(ornRule, 'the ornament has a base rule');
    // Sized from the space the orbs leave, never a fixed width that could reach
    // into a ball on a narrow column.
    assert.match(ornRule, /width: var\(--ornament-size\)/);
    assert.match(ornRule, /aspect-ratio: 1/);
    // Centred on the row line with a margin, because a translate inside the same
    // transform list as the rotation would be rotated with it.
    assert.match(ornRule, /margin-top: calc\(var\(--ornament-size\) \/ -2\)/);
    assert.doesNotMatch(ornRule, /translate/);

    const barRule = css.match(/#ability-bar \{([^}]*)\}/)?.[1] ?? '';
    assert.match(barRule, /--ornament-size: clamp\(\s*34px/);
    // The row stays tight between the balls so the dragons get the outside.
    assert.match(barRule, /--ornament-size: clamp\([^;]*\), 84px\);/);
    assert.match(barRule, /--orb-size: 58px/);
    assert.match(barRule, /--orb-gap: clamp\(6px, 2\.6vw, 12px\)/);

    // Heads inward: a clockwise turn on the left, the same turn mirrored on the right.
    assert.match(css, /\.ability-ornament--left \{ left: 0; transform: rotate\(90deg\); \}/);
    assert.match(css, /\.ability-ornament--right \{ right: 0; transform: scaleX\(-1\) rotate\(90deg\); \}/);
  });

  it('stacks swords, orbs and answers in portrait and centres the answers row', async () => {
    const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
    // Several portrait rules exist; the stacking one is the one that names the
    // column direction.
    const portrait = css.match(/#game-wrap\[data-layout="portrait"\] #input-zone \{([^}]*flex-direction[^}]*)\}/)?.[1] ?? '';
    assert.match(portrait, /flex-direction: column/);
    assert.match(portrait, /justify-content: flex-start/);
    // The full-width lines must stop asking for 100% of the height in a column.
    assert.match(css, /#game-wrap\[data-layout="portrait"\] #input-zone > \.app-encounter-swords,/);
    assert.match(css, /#game-wrap\[data-layout="portrait"\] #input-zone > #ability-bar \{\s*flex: 0 0 auto;\s*\}/);
    // The answers take all the slack above and below them: centred, not pinned.
    assert.match(css, /#game-wrap\[data-layout="portrait"\] #input-zone > #mc-buttons \{\s*margin-block: auto;\s*\}/);
  });

  it('the circle row still leaves the answers and portrait sword row visible', () => {
    // 320x568 portrait with the app's four answers, the 22px sword row and the
    // 58px circles plus their 13px caption line: everything has to fit.
    const portraitChrome = 140;
    const portrait = calculateSceneLayout(320, 568 - portraitChrome - 6, 4, false);
    assert.ok(portrait.sceneWidth > 0 && portrait.sceneHeight > 0);
    const portraitInput = 568 - portraitChrome - 6 - portrait.sceneHeight;
    assert.ok(
      portraitInput >= 16 + 22 + 6 + 58 + 13 + 6 + 44,
      `portrait input zone ${portraitInput}`,
    );

    // 800x450 landscape with ten five-digit answers.
    const landscapeChrome = 100;
    const landscape = calculateSceneLayout(800, 450 - landscapeChrome - 6, 10, true);
    assert.ok(landscape.sceneWidth > 0 && landscape.sceneHeight > 0);
    assert.ok((landscape.answerWidth - 16 - (landscape.columns - 1) * 6) / landscape.columns >= 44);
    assert.ok((landscape.answerHeight - 16 - (landscape.rows - 1) * 6) / landscape.rows >= 44);
  });
});
