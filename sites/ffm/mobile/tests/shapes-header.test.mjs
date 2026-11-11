// shapes-header.test.mjs — the app-only two-row Shapes question header.
//
// shapes-header.js ships through the overlay as www/game/shapes-header.js and
// is imported by main.js only behind platform.isApp. These tests pin the
// exactly-two-rows layout for counts 1-10 in DE and EN at the 320px portrait
// and landscape header widths, the unbroken shape row, the scale-down that
// replaces wrapping/clipping, the widget's DOM structure and teardown, the
// overlay-only CSS, and the 44px answer-target budget. The web build keeps the
// single-line prompt and never ships this module.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createShapesHeader,
  layoutShapesHeader,
  normalizeShapeCount,
  shapeSymbol,
  SHAPES_HEADER_ATTRIBUTE,
  SHAPES_HEADER_ATTRIBUTE_VALUE,
  SHAPES_HEADER_BASE_FONT_SIZE,
  SHAPES_HEADER_MAX_COUNT,
  SHAPES_HEADER_MIN_COUNT,
  SHAPES_HEADER_MIN_FONT_SIZE,
  SHAPES_HEADER_ROW_COUNT,
  SHAPES_HEADER_WIDTHS,
  SHAPES_INSTRUCTION_CLASS,
  SHAPES_ROW_CLASS,
} from '../game/shapes-header.js';
import { _resetForTests, setLocale, t } from '../../static/game/i18n.js';
import { calculateSceneLayout } from '../../static/game/viewport-layout.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(root, '..', 'static');

const SYMBOLS = { square: '■', circle: '●', triangle: '▲' };

function makeElement(tagName) {
  const element = {
    tagName: tagName.toUpperCase(),
    className: '',
    parentNode: null,
    children: [],
    attributes: {},
    style: {},
    clientWidth: 0,
    text: '',
    get textContent() {
      return element.text;
    },
    set textContent(value) {
      element.text = String(value);
      for (const child of element.children) child.parentNode = null;
      element.children.length = 0;
    },
    setAttribute(name, value) {
      element.attributes[name] = String(value);
    },
    getAttribute(name) {
      return element.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete element.attributes[name];
    },
    appendChild(child) {
      child.parentNode = element;
      element.children.push(child);
      return child;
    },
    remove() {
      const siblings = element.parentNode?.children;
      const index = siblings?.indexOf(element) ?? -1;
      if (index >= 0) siblings.splice(index, 1);
      element.parentNode = null;
    },
  };
  return element;
}

function fakeDocument(width = SHAPES_HEADER_WIDTHS.portrait) {
  const target = makeElement('div');
  target.id = 'active-question';
  target.clientWidth = width;
  return {
    target,
    doc: {
      getElementById: (id) => (id === 'active-question' ? target : null),
      createElement: (tagName) => makeElement(tagName),
    },
  };
}

describe('two-row Shapes header layout', () => {
  test('enumerates counts 1-10 x {de,en} x {portrait,landscape} as exactly two rows', () => {
    try {
      for (const locale of ['de', 'en']) {
        setLocale(locale, { persist: false });
        const instruction = t('hud.countShapes');
        assert.ok(instruction.length > 0, `${locale}: instruction is localized`);
        for (const orientation of Object.keys(SHAPES_HEADER_WIDTHS)) {
          for (let count = SHAPES_HEADER_MIN_COUNT; count <= SHAPES_HEADER_MAX_COUNT; count += 1) {
            const label = `${locale}/${orientation}/${count}`;
            const layout = layoutShapesHeader({
              count,
              shapeType: 'square',
              instruction,
              maxWidth: SHAPES_HEADER_WIDTHS[orientation],
            });
            assert.equal(layout.rowCount, SHAPES_HEADER_ROW_COUNT, label);
            assert.equal(layout.rows.length, SHAPES_HEADER_ROW_COUNT, label);
            assert.equal(layout.rows[0].kind, 'instruction', label);
            assert.equal(layout.rows[1].kind, 'shapes', label);
            assert.equal(layout.shapeRows, 1, label);
            assert.equal(layout.shapeCount, count, label);
            assert.equal(layout.rows[1].count, count, label);
            assert.equal(layout.rows[1].whiteSpace, 'nowrap', label);
            assert.equal(layout.rows[1].wrap, false, label);
            assert.equal(layout.rows[0].text, `${instruction}:`, label);
            assert.equal(layout.instruction, `${instruction}:`, label);
            assert.ok(!layout.shapeText.includes('\n'), label);
            const glyphs = layout.shapeText.split(' ');
            assert.equal(glyphs.length, count, `${label}: one glyph per shape`);
            assert.ok(glyphs.every((glyph) => glyph === SYMBOLS.square), label);
            assert.equal(layout.fits, true, label);
            assert.ok(layout.rows[0].fontSize <= SHAPES_HEADER_BASE_FONT_SIZE + 1e-9, label);
            assert.ok(layout.rows[1].fontSize <= SHAPES_HEADER_BASE_FONT_SIZE + 1e-9, label);
            const height = layout.rows.reduce((sum, row) => sum + row.lineHeight, 0);
            assert.ok(height <= 2 * 28 + 1e-9, `${label}: two rows stay in the 56px wrap budget (${height})`);
          }
        }
      }
    } finally {
      _resetForTests();
    }
  });

  test('scales the shape row down instead of wrapping at the narrowest landscape header', () => {
    const base = layoutShapesHeader({
      count: 10,
      instruction: 'Count the shapes',
      maxWidth: SHAPES_HEADER_WIDTHS.portrait,
    });
    const narrow = layoutShapesHeader({
      count: 10,
      instruction: 'Count the shapes',
      maxWidth: 228,
    });
    assert.equal(narrow.rowCount, 2);
    assert.equal(narrow.shapeCount, 10);
    assert.ok(narrow.rows[1].fontSize < base.rows[1].fontSize, 'the shape row shrinks to fit');
    assert.ok(narrow.rows[1].fontSize >= SHAPES_HEADER_MIN_FONT_SIZE);
    assert.equal(narrow.fits, true);
    assert.ok(narrow.rows[1].fontSize * 19 * 0.65 <= 228 + 0.5, 'the scaled row fits the width');
    assert.equal(narrow.shapeText.split(' ').length, 10, 'scaling never drops a shape');
  });

  test('represents every shape type with its own glyph and keeps unknown types square', () => {
    for (const [shapeType, symbol] of Object.entries(SYMBOLS)) {
      assert.equal(shapeSymbol(shapeType), symbol);
      const layout = layoutShapesHeader({ count: 3, shapeType, instruction: 'Count the shapes', maxWidth: 304 });
      assert.deepEqual(layout.shapeText.split(' '), [symbol, symbol, symbol]);
    }
    assert.equal(shapeSymbol('hexagon'), SYMBOLS.square);
  });

  test('clamps counts defensively without changing the published problem count', () => {
    assert.equal(normalizeShapeCount(1), 1);
    assert.equal(normalizeShapeCount(10), 10);
    assert.equal(normalizeShapeCount('7'), 7);
    assert.equal(normalizeShapeCount(7.9), 7);
    assert.equal(normalizeShapeCount(0), 0);
    assert.equal(normalizeShapeCount(-3), 0);
    assert.equal(normalizeShapeCount(99), 10);
    assert.equal(normalizeShapeCount(Number.NaN), 0);
    assert.equal(normalizeShapeCount(undefined), 0);
  });
});

describe('Shapes header widget', () => {
  test('renders exactly two rows and replaces the stale single-line prompt', () => {
    const { target, doc } = fakeDocument();
    const widget = createShapesHeader({ doc });
    target.textContent = 'Count the shapes: ▲ ▲';
    const layout = widget.render({
      problem: { displayMode: 'shapes', shapeType: 'triangle', count: 10 },
      instruction: 'Count the shapes',
    });

    assert.equal(target.children.length, 2, 'exactly two rows');
    assert.equal(target.children[0].className, SHAPES_INSTRUCTION_CLASS);
    assert.equal(target.children[1].className, SHAPES_ROW_CLASS);
    assert.equal(target.getAttribute(SHAPES_HEADER_ATTRIBUTE), SHAPES_HEADER_ATTRIBUTE_VALUE);
    assert.equal(target.children[0].textContent, 'Count the shapes:');
    assert.equal(target.children[1].textContent, '▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲');
    assert.equal(layout.shapeCount, 10);

    widget.render({
      problem: { displayMode: 'shapes', shapeType: 'triangle', count: 10 },
      instruction: 'Count the shapes',
    });
    assert.equal(target.children.length, 2, 'repeated frames never add a third row');
  });

  test('writes the scaled font size and line height onto the rows', () => {
    const { target, doc } = fakeDocument(228);
    const widget = createShapesHeader({ doc });
    const layout = widget.render({
      problem: { displayMode: 'shapes', shapeType: 'circle', count: 10 },
      instruction: 'Zähle die Formen',
    });
    assert.equal(target.children[1].style.fontSize, `${layout.rows[1].fontSize}px`);
    assert.equal(target.children[1].style.lineHeight, `${layout.rows[1].lineHeight}px`);
    assert.ok(layout.rows[1].fontSize < SHAPES_HEADER_BASE_FONT_SIZE);
    assert.equal(target.children[1].textContent.split(' ').length, 10);
  });

  test('clear removes both rows and the two-row marker', () => {
    const { target, doc } = fakeDocument();
    const widget = createShapesHeader({ doc });
    widget.render({
      problem: { displayMode: 'shapes', shapeType: 'square', count: 4 },
      instruction: 'Count the shapes',
    });
    widget.clear();
    assert.equal(target.children.length, 0);
    assert.equal(target.getAttribute(SHAPES_HEADER_ATTRIBUTE), null);
  });

  test('is a no-op without the active-question element', () => {
    const widget = createShapesHeader({
      doc: { getElementById: () => null, createElement: (tag) => makeElement(tag) },
    });
    assert.equal(widget.element, null);
    assert.equal(widget.render({ problem: { count: 3 }, instruction: 'Count the shapes' }), null);
    widget.clear();
    widget.destroy();
  });
});

describe('app-only delivery', () => {
  test('the module ships only through the app overlay, never the web build', async () => {
    await assert.rejects(
      stat(join(staticDir, 'game', 'shapes-header.js')),
      { code: 'ENOENT' },
      'the module must not exist in the web deploy',
    );
    const webCss = await readFile(join(staticDir, 'styles.css'), 'utf8');
    assert.doesNotMatch(webCss, /app-shapes-header|data-shapes-header/,
      'the web stylesheet carries no shapes-header rules');
    const index = await readFile(join(staticDir, 'index.html'), 'utf8');
    assert.doesNotMatch(index, /app-shapes-header|data-shapes-header/,
      'the web page carries no shapes-header markup');
  });

  test('main.js wires the two-row header only behind the app guard', async () => {
    const source = await readFile(join(staticDir, 'game', 'main.js'), 'utf8');
    assert.equal((source.match(/import\('\.\/shapes-header\.js'\)/g) ?? []).length, 1);
    assert.match(source, /gameplayChrome\.setShapesHeader\(createShapesHeader\(\{ doc: document \}\)\)/);
    const appStart = source.indexOf('if (platform.isApp) {');
    const appEnd = source.indexOf('\n}\n', appStart);
    assert.ok(source.slice(appStart, appEnd).includes("import('./shapes-header.js')"),
      'the app branch imports the header dynamically');
    assert.ok(!source.slice(0, appStart).includes('shapes-header'),
      'no module code references the shapes header before the app guard');
  });

  test('the overlay stylesheet pins two nowrap rows without clipping', async () => {
    const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');
    assert.match(css, /#active-question\[data-shapes-header="two-rows"\]\s*\{[^}]*display:\s*grid/);
    assert.match(css, /#active-question\[data-shapes-header="two-rows"\]\s*\{[^}]*grid-template-rows:\s*auto auto/);
    assert.match(css, /\.app-shapes-header-instruction[^{]*\{[^}]*white-space:\s*nowrap/);
    assert.match(css, /\.app-shapes-header-shapes[^{]*\{[^}]*white-space:\s*nowrap/);
    assert.doesNotMatch(css, /text-overflow\s*:\s*ellipsis/, 'the header never ellipsizes');
    assert.doesNotMatch(css, /\.app-shapes-header[^{]*\{[^}]*overflow\s*:\s*hidden/,
      'the header never clips a shape row');
    assert.doesNotMatch(css, /\.mc-btn\s*\{/, 'the answer buttons keep their web geometry');
    assert.doesNotMatch(css, /#input-zone\s*\{/, 'the answer area is untouched');
    assert.doesNotMatch(css, /https?:\/\//, 'the overlay stylesheet must stay offline');
  });
});

// --- 44px answer-target budget -----------------------------------------
// The header keeps one height for the whole level: the two reserved question
// rows (2 x 26px), the reserved reveal line (20px), the readouts row with the
// 44px pause/help buttons and the app timer bar. Measured on the built app
// bundle at 390x844 (150px) and 568x320 (140px); the values below are the
// rounded-up budgets the answer grid has to fit under, so a later header change
// that eats into the targets fails here first.
// Below the header, #input-zone keeps its web padding/flex gap and the answer
// grid keeps its 44px minimum row height.
const INPUT_PADDING = 16;
const FLEX_GAP = 6;
const BUBBLE_ROW = 22;
const SHAPES_HEADER_BUDGET_PORTRAIT = 150;
const SHAPES_HEADER_BUDGET_LANDSCAPE = 140;

test('the two-row header keeps 44px answer targets at 320px portrait', () => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 320, height: 480 },
  ]) {
    const availableHeight = viewport.height - SHAPES_HEADER_BUDGET_PORTRAIT;
    const layout = calculateSceneLayout(viewport.width, availableHeight, 4, false);
    assert.equal(layout.columns * layout.rows, 4, 'four buttons stay in one visible grid');
    const inputZone = availableHeight - layout.sceneHeight - FLEX_GAP;
    const available = inputZone - INPUT_PADDING - FLEX_GAP - BUBBLE_ROW;
    const grid = Math.min(available, layout.rows * 70 - 6);
    const buttonHeight = (grid - (layout.rows - 1) * FLEX_GAP) / layout.rows;
    assert.ok(buttonHeight >= 44,
      `${viewport.width}x${viewport.height}: buttons must stay >=44px (${buttonHeight}px)`);
  }
});

test('the two-row header keeps 44px answer targets at 320px landscape', () => {
  const availableHeight = 320 - SHAPES_HEADER_BUDGET_LANDSCAPE;
  const layout = calculateSceneLayout(568, availableHeight, 4, true);
  assert.equal(layout.landscape, true);
  assert.equal(layout.columns * layout.rows, 4);
  const required = layout.rows * 44 + (layout.rows - 1) * FLEX_GAP;
  assert.ok(required <= availableHeight - INPUT_PADDING,
    `four answer rows fit the landscape column (${required}px of ${availableHeight - INPUT_PADDING}px)`);
});
