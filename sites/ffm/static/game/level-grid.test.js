import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLevelGridEntries, createLevelGrid, LEVEL_GRID_ID, LEVEL_TILE_CLASS } from './level-grid.js';

function fakeDocument() {
  const make = tag => {
    const listeners = {};
    const attributes = {};
    const node = {
      tagName: tag, children: [], dataset: {}, disabled: false, innerHTML: '', className: '',
      set textContent(value) { if (value === '') node.children.length = 0; },
      appendChild(child) { node.children.push(child); return child; },
      setAttribute(name, value) { attributes[name] = String(value); },
      getAttribute(name) { return attributes[name] ?? null; },
      addEventListener(type, callback) { listeners[type] = callback; },
      click() { if (!node.disabled) listeners.click?.(); },
      querySelectorAll(selector) {
        assert.equal(selector, `.${LEVEL_TILE_CLASS}`);
        return node.children;
      },
    };
    return node;
  };
  const grid = make('div');
  return { grid, doc: { getElementById: id => (id === LEVEL_GRID_ID ? grid : null), createElement: make } };
}

test('entries mark the default start, available levels and locked levels', () => {
  const entries = buildLevelGridEntries({ total: 6, defaultLevel: 3, available: [1, 2, 5] });
  assert.deepEqual(entries.map(entry => [entry.level, entry.value, entry.state]), [
    [1, '1', 'available'], [2, '2', 'available'], [3, '', 'default'],
    [4, null, 'locked'], [5, '5', 'available'], [6, null, 'locked'],
  ]);
});

test('the grid never drops an unlocked level beyond the curriculum size', () => {
  const entries = buildLevelGridEntries({ total: 2, defaultLevel: 1, available: [4] });
  assert.equal(entries.length, 4);
  assert.equal(entries[3].state, 'available');
});

test('tiles render illuminated numerals, select on tap and lock the rest', () => {
  const { grid, doc } = fakeDocument();
  const picked = [];
  const widget = createLevelGrid({ doc, onSelect: value => picked.push(value) });
  widget.render({ total: 4, defaultLevel: 2, available: [1], labelFor: ({ level, state }) => `${state}:${level}` });
  assert.equal(grid.children.length, 4);
  const [one, two, three] = grid.children;
  assert.match(one.innerHTML, /<svg/);
  assert.equal(one.getAttribute('aria-label'), 'available:1');
  assert.equal(two.getAttribute('aria-pressed'), 'true');
  assert.equal(three.disabled, true);
  assert.equal(three.getAttribute('aria-label'), 'locked:3');
  three.click();
  assert.deepEqual(picked, []);
  one.click();
  assert.deepEqual(picked, ['1']);
  assert.equal(widget.value, '1');
  assert.equal(one.getAttribute('aria-pressed'), 'true');
  assert.equal(two.getAttribute('aria-pressed'), 'false');
});

test('a refresh keeps a still-valid selection and resets one that became locked', () => {
  const { doc } = fakeDocument();
  const widget = createLevelGrid({ doc });
  widget.render({ total: 5, defaultLevel: 3, available: [1, 2] });
  widget.value = '2';
  widget.render({ total: 5, defaultLevel: 3, available: [1, 2] });
  assert.equal(widget.value, '2');
  widget.render({ total: 5, defaultLevel: 1, available: [] });
  assert.equal(widget.value, '');
});

test('the Levels page uses the grid instead of a dropdown and keeps it scrollable', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const levels = html.slice(html.indexOf('data-title-page="levels"'), html.indexOf('data-title-page="legal"'));
  assert.match(levels, /id="level-jump-grid"[^>]*role="group"[^>]*aria-labelledby="level-jump-label"/);
  assert.doesNotMatch(levels, /<select/);
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf('.level-jump-grid {'), css.indexOf('}', css.indexOf('.level-jump-grid {')));
  assert.match(rule, /overflow-y: auto/);
  assert.match(rule, /min-height: 0/);
  assert.match(css, /\.level-tile \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
});
