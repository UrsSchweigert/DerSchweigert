import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateSceneLayout, initViewportLayout } from './viewport-layout.js';

for (const [width, height] of [[304, 500], [552, 252], [359, 591], [796, 307], [752, 956], [1008, 700], [1348, 956], [2024, 1468], [304, 172]]) {
  for (const count of [4, 5, 10]) {
    test(`${width}×${height}: ${count} simultaneous targets and an uncropped maximizing scene`, () => {
      const result = calculateSceneLayout(width, height, count);
      const { columns, rows, sceneWidth, sceneHeight, answerWidth, answerHeight } = result;
      assert.ok(columns * rows >= count);
      assert.ok((answerWidth - 16 - (columns - 1) * 6) / columns >= 44);
      assert.ok((answerHeight - 16 - (rows - 1) * 6) / rows >= 44);
      assert.ok(sceneWidth > 0 && sceneHeight > 0);
      assert.ok(Math.abs(sceneWidth / sceneHeight - 800 / 450) < 1e-9);
      assert.ok(sceneWidth <= width && sceneHeight <= height);
      if (result.landscape) {
        const minimumAnswers = columns * 44 + (columns - 1) * 6 + 16;
        assert.ok(Math.abs(sceneWidth - Math.min(width - minimumAnswers - 6, height * 800 / 450)) < 1e-9);
      } else {
        const minimumAnswers = rows * 44 + (rows - 1) * 6 + 16;
        assert.ok(Math.abs(sceneHeight - Math.min(height - minimumAnswers - 6, width * 450 / 800)) < 1e-9);
      }
    });
  }
}

test('tablets are not restricted by an arbitrary scene size ceiling', () => {
  const result = calculateSceneLayout(3000, 1800, 10);
  assert.ok(result.sceneWidth > 1600);
  assert.ok(result.sceneHeight > 900);
});

test('surplus landscape tablet width does not stretch answer controls indefinitely', () => {
  const layout = calculateSceneLayout(2400, 1000, 10, true);
  assert.equal(layout.answerWidth, 320);
  assert.ok(Math.abs(layout.sceneWidth - 1000 * 800 / 450) < 1e-9);
});

for (const count of [5, 10]) {
  test(`compact chrome leaves a playable scene with ${count} five-digit answers`, () => {
    for (const [width, height, chromeHeight, minimumScene] of [[304, 552, 138, 180], [552, 304, 64, 250]]) {
      const result = calculateSceneLayout(width, height - chromeHeight - 6, count, width > height, 69);
      assert.ok(result.sceneWidth >= minimumScene);
      assert.ok(result.sceneHeight >= minimumScene * 450 / 800);
      assert.ok((result.answerWidth - 16 - (result.columns - 1) * 6) / result.columns >= 69);
      assert.ok((result.answerHeight - 16 - (result.rows - 1) * 6) / result.rows >= 44);
    }
  });
}
for (const [width, height, minimumWidth] of [[304, 500, 57], [552, 252, 66], [1008, 700, 87], [304, 500, 83]]) {
  test(`${width}×${height}: wide numeric labels fit every simultaneous answer`, () => {
    const layout = calculateSceneLayout(width, height, 10, width >= height, minimumWidth);
    const cellWidth = (layout.answerWidth - 16 - (layout.columns - 1) * 6) / layout.columns;
    const cellHeight = (layout.answerHeight - 16 - (layout.rows - 1) * 6) / layout.rows;
    assert.ok(cellWidth >= minimumWidth);
    assert.ok(cellHeight >= 44);
    assert.ok(layout.columns * layout.rows >= 10);
    assert.ok(layout.sceneWidth > 0);
    if (layout.landscape) assert.ok(layout.columns >= 2);
  });
}

test('option text is measured from its computed font, letter spacing, padding and borders', () => {
  const properties = new Map();
  const style = { setProperty: (key, value) => properties.set(key, value) };
  const button = { hidden: false, textContent: '99999' };
  const options = { dataset: { optionCount: '10' }, children: [button] };
  const wrap = { clientWidth: 1008, clientHeight: 700, dataset: {}, style };
  const win = {
    ...events(), innerWidth: 1024, innerHeight: 768,
    getComputedStyle: () => ({
      font: '18px monospace', fontSize: '18px', fontFamily: 'monospace',
      letterSpacing: '0.5px',
      paddingLeft: '4px', paddingRight: '4px', borderLeftWidth: '2px', borderRightWidth: '2px',
    }),
  };
  const doc = {
    documentElement: { style, dataset: {} },
    createElement: () => ({ getContext: () => ({ measureText: text => ({ width: text.length * 18 * 0.6 }) }) }),
    getElementById: (id) => id === 'game-wrap' ? wrap : id === 'mc-buttons' ? options : null,
  };
  const controller = initViewportLayout({ win, doc });
  assert.equal(properties.get('--answer-min-width'), '70px');
  assert.equal(properties.get('--answer-columns'), 2);
  assert.equal(properties.get('--answer-rows'), 5);
  button.textContent = '999999';
  controller.refresh();
  assert.equal(properties.get('--answer-min-width'), '82px');
  controller.destroy();
});

test('five and ten five-digit choices fit safe-area phone and tablet content boxes', () => {
  const minimumWidth = 70;
  for (const [width, height] of [[272, 516], [512, 256], [374, 828], [752, 1008], [1008, 752]]) {
    for (const count of [5, 10]) {
      const layout = calculateSceneLayout(width, height, count, width >= height, minimumWidth);
      const cellWidth = (layout.answerWidth - 16 - (layout.columns - 1) * 6) / layout.columns;
      const cellHeight = (layout.answerHeight - 16 - (layout.rows - 1) * 6) / layout.rows;
      assert.ok(cellWidth >= minimumWidth, `${width}×${height} ${count} choices`);
      assert.ok(cellHeight >= 44, `${width}×${height} ${count} choices`);
      assert.ok(layout.sceneWidth > 0 && layout.sceneHeight > 0);
    }
  }
});

function events() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
  };
}

test('visual viewport keyboard, offsets, option changes and cleanup are layout-only', () => {
  const properties = new Map();
  const style = { setProperty: (key, value) => properties.set(key, value) };
  const wrap = { clientWidth: 552, clientHeight: 252, dataset: {}, style };
  const options = { dataset: { optionCount: '10' } };
  const viewport = { ...events(), width: 568, height: 320, offsetLeft: 0, offsetTop: 0 };
  let callback;
  let disconnected = 0;
  class Observer {
    constructor(fn) { callback = fn; }
    observe() {}
    disconnect() { disconnected++; }
  }
  const win = {
    ...events(), visualViewport: viewport, innerWidth: 568, innerHeight: 320,
    requestAnimationFrame(fn) { this.pending = fn; return 1; },
    cancelAnimationFrame() { this.pending = null; },
    ResizeObserver: Observer, MutationObserver: Observer,
  };
  const doc = {
    documentElement: { style, dataset: {} },
    getElementById: (id) => id === 'game-wrap' ? wrap : id === 'mc-buttons' ? options : null,
  };
  const layout = initViewportLayout({ win, doc });
  assert.equal(wrap.dataset.layout, 'landscape');
  assert.equal(properties.get('--answer-columns'), 3);
  viewport.width = 320;
  viewport.height = 240;
  win.innerWidth = 320;
  win.innerHeight = 568;
  viewport.offsetTop = 12;
  viewport.offsetLeft = 3;
  wrap.clientWidth = 304;
  wrap.clientHeight = 172;
  viewport.listeners.get('resize')();
  win.pending();
  assert.equal(wrap.dataset.layout, 'portrait');
  assert.equal(properties.get('--viewport-height'), '240px');
  assert.equal(properties.get('--viewport-left'), '3px');
  assert.equal(properties.get('--viewport-top'), '12px');
  options.dataset.optionCount = '5';
  callback();
  win.pending();
  assert.equal(properties.get('--answer-rows'), 1);
  layout.destroy();
  assert.equal(disconnected, 2);
  assert.equal(win.listeners.size, 0);
  assert.equal(viewport.listeners.size, 0);
});

test('missing DOM is a harmless no-op', () => {
  const controller = initViewportLayout({ win: null, doc: null });
  assert.doesNotThrow(controller.refresh);
  assert.doesNotThrow(controller.destroy);
});

for (const [width, height] of [[304, 406], [552, 158], [752, 862], [1008, 606]]) {
  for (const [count, minimumWidth] of [[5, 58], [10, 58], [5, 86], [10, 86]]) {
    test(`${width}×${height} after readable HUD: ${count} four/five-digit choices fit`, () => {
      const result = calculateSceneLayout(width, height, count, width >= height, minimumWidth);
      assert.ok(result.sceneWidth > 0 && result.sceneHeight > 0);
      assert.ok((result.answerWidth - 16 - (result.columns - 1) * 6) / result.columns >= minimumWidth);
      assert.ok((result.answerHeight - 16 - (result.rows - 1) * 6) / result.rows >= 44);
      if (count === 10) assert.ok([2, 3, 4, 5].includes(result.columns));
    });
  }
}

test('visible chrome reserves real height without scaling the logical canvas', () => {
  const properties = new Map();
  const style = { setProperty: (key, value) => properties.set(key, value) };
  const wrap = { clientWidth: 552, clientHeight: 252, dataset: {}, style };
  const chrome = { hidden: false, offsetHeight: 88 };
  const options = { dataset: { optionCount: '10' }, children: [] };
  const win = { ...events(), innerWidth: 568, innerHeight: 320 };
  const doc = {
    documentElement: { style, dataset: {} },
    getElementById: id => ({ 'game-wrap': wrap, 'gameplay-chrome': chrome, 'mc-buttons': options })[id],
  };
  const controller = initViewportLayout({ win, doc });
  const expected = calculateSceneLayout(552, 158, 10);
  assert.equal(properties.get('--scene-height'), `${expected.sceneHeight}px`);
  chrome.hidden = true;
  controller.refresh();
  assert.equal(properties.get('--scene-height'), `${calculateSceneLayout(552, 252, 10).sceneHeight}px`);
  controller.destroy();
});

test('the ability circle row is reserved out of the answer grid, never out of the scene', () => {
  // Landscape: the right-hand answer column loses the circle row, so the grid
  // re-flows into fewer, taller rows instead of overflowing the answer zone.
  const tall = calculateSceneLayout(844, 288, 5, true);
  const withCircles = calculateSceneLayout(844, 288, 5, true, 44, 71);
  assert.ok(withCircles.rows <= tall.rows);
  assert.ok(withCircles.columns >= tall.columns);
  assert.ok((withCircles.answerHeight - 16 - (withCircles.rows - 1) * 6) / withCircles.rows >= 44);
  assert.equal(withCircles.answerHeight, 288 - 71);
  // The scene keeps the same height in landscape: the circles live beside it.
  assert.equal(withCircles.sceneHeight, tall.sceneHeight);

  // Portrait: the scene keeps its width-limited height when there is slack and
  // gives up height only once the budget is tight.
  const portrait = calculateSceneLayout(390, 660, 5, false);
  const portraitWithCircles = calculateSceneLayout(390, 660, 5, false, 44, 71);
  assert.ok(portraitWithCircles.sceneHeight <= portrait.sceneHeight);
  const tight = calculateSceneLayout(320, 300, 5, false);
  const tightWithCircles = calculateSceneLayout(320, 300, 5, false, 44, 71);
  assert.ok(tightWithCircles.sceneHeight <= tight.sceneHeight);
  assert.ok(tightWithCircles.answerHeight >= 16 + 44);

  // A nonsense reservation can never produce a negative scene.
  const clamped = calculateSceneLayout(390, 260, 5, false, 44, 5000);
  assert.ok(clamped.sceneHeight >= 0 && clamped.answerHeight >= 0);
  assert.ok(calculateSceneLayout(390, 260, 5, false, 44, NaN).sceneHeight
    === calculateSceneLayout(390, 260, 5, false, 44, 0).sceneHeight);
});

test('the mounted ability bar feeds its measured height into the layout', () => {
  const properties = new Map();
  const style = { setProperty: (key, value) => properties.set(key, value) };
  const wrap = { clientWidth: 844, clientHeight: 390, dataset: {}, style };
  const options = { dataset: { optionCount: '5' }, children: [] };
  const abilityBar = { offsetHeight: 71 };
  const win = { ...events(), innerWidth: 844, innerHeight: 390 };
  const doc = {
    documentElement: { style, dataset: {} },
    getElementById: id => ({ 'game-wrap': wrap, 'mc-buttons': options, 'ability-bar': abilityBar })[id],
  };
  const controller = initViewportLayout({ win, doc });
  const expected = calculateSceneLayout(844, 390, 5, true, 44, 77);
  assert.equal(String(properties.get('--answer-rows')), String(expected.rows));
  assert.equal(String(properties.get('--answer-columns')), String(expected.columns));
  controller.destroy();
});

test('screen IDs, pagination, playfield ownership and legal scrolling stay explicit', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['playfield', 'game', 'combo-frame', 'input-zone', 'local-profiles', 'profile-root',
    'personal-development-error', 'personal-best-prev', 'personal-best-next', 'personal-best-page']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.match(html, /id="playfield"[\s\S]*id="game"[\s\S]*id="combo-frame"[\s\S]*<\/div><!-- #playfield -->/);
  assert.match(html, /id="local-profiles"[^>]*hidden/);
  assert.equal((html.match(/app-omit:start/g) ?? []).length, (html.match(/app-omit:end/g) ?? []).length);
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /\.title-legal\s*\{\s*overflow-y:\s*auto/);
  const renderer = await readFile(new URL('./renderer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(renderer, /querySelector\('#input-zone'\)|offsetHeight|ResizeObserver/);
});
