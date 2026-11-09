// level-numerals.test.mjs — the app-only decorative title level numerals.
//
// level-numerals.js ships through the overlay as www/game/level-numerals.js
// and is imported by main.js only behind platform.isApp. These tests pin the
// pure selection resolver, the role="img" numeral the widget adds, the
// localized accessible description, the app-only wiring in main.js, and a
// deterministic layout fixture proving the numerals clear the logo and the
// intro/login/button rows at small phone, ordinary phone and tablet sizes
// before and after rotation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEVEL_NUMERALS_CLASS,
  LEVEL_NUMERALS_MODE_ATTRIBUTE,
  createLevelNumerals,
  resolveLevelSelection,
} from '../game/level-numerals.js';
import { TOTAL_LEVELS } from '../../static/game/levels.js';
import { setLocale, t } from '../../static/game/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(root, '..', 'static');

function makeElement(tagName) {
  const element = {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    hidden: false,
    attributes: {},
    children: [],
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
      element.children.push(child);
      return child;
    },
  };
  return element;
}

function fakeDocument() {
  const container = makeElement('div');
  container.id = 'difficulty-select';
  return {
    container,
    doc: {
      getElementById: (id) => (id === 'difficulty-select' ? container : null),
      createElement: (tagName) => makeElement(tagName),
    },
  };
}

test('resolveLevelSelection accepts only usable curriculum levels', () => {
  assert.deepEqual(resolveLevelSelection({ level: 1, mode: 'continuation' }),
    { level: 1, mode: 'continuation' });
  assert.deepEqual(resolveLevelSelection({ level: 60, mode: 'replay' }),
    { level: 60, mode: 'replay' });
  assert.deepEqual(resolveLevelSelection({ level: '7' }), { level: 7, mode: 'continuation' },
    'numeric strings resolve and a missing mode is a continuation');
  assert.deepEqual(resolveLevelSelection({ level: 3, mode: 'unknown' }),
    { level: 3, mode: 'continuation' }, 'an unknown mode never becomes a replay');

  for (const invalid of [null, undefined, {}, { level: 0 }, { level: -2 }, { level: 2.5 },
    { level: 'x' }, { level: Number.NaN }, 'level']) {
    assert.equal(resolveLevelSelection(invalid), null, `${JSON.stringify(invalid)} must not draw`);
  }
});

test('the widget appends one decorative role="img" numeral and updates it', () => {
  const { doc, container } = fakeDocument();
  const widget = createLevelNumerals({ doc, translate: t });

  assert.equal(container.children.length, 1, 'one numeral element is appended to the title');
  const element = container.children[0];
  assert.equal(element, widget.element);
  assert.equal(element.className, LEVEL_NUMERALS_CLASS);
  assert.equal(element.getAttribute('role'), 'img');
  assert.equal(element.hidden, true, 'nothing is drawn before a selection arrives');

  setLocale('en');
  assert.deepEqual(widget.updateLevelSelection({ level: 5, mode: 'continuation' }),
    { level: 5, mode: 'continuation' });
  assert.equal(element.textContent, '5');
  assert.equal(element.getAttribute('aria-label'), 'Starting level 5');
  assert.equal(element.getAttribute(LEVEL_NUMERALS_MODE_ATTRIBUTE), 'continuation');
  assert.equal(element.hidden, false);

  setLocale('de');
  widget.updateLevelSelection({ level: 12, mode: 'replay' });
  assert.equal(element.textContent, '12');
  assert.equal(element.getAttribute('aria-label'), 'Startlevel 12',
    'a locale switch re-localizes the accessible description');
  assert.equal(element.getAttribute(LEVEL_NUMERALS_MODE_ATTRIBUTE), 'replay');

  widget.updateLevelSelection(null);
  assert.equal(element.hidden, true, 'an empty selection hides the numerals');
  assert.equal(element.textContent, '');
  assert.equal(element.getAttribute('aria-label'), null);
});

test('the widget is a no-op without a title container', () => {
  const widget = createLevelNumerals({ doc: { getElementById: () => null }, translate: t });
  assert.equal(widget.element, null);
  assert.deepEqual(widget.updateLevelSelection({ level: 4 }), { level: 4, mode: 'continuation' });
  assert.equal(widget.selection.level, 4);
});

test('main.js publishes exactly one selection from renderLocalCampaign and only in the app', async () => {
  const source = await readFile(join(staticDir, 'game', 'main.js'), 'utf8');

  assert.equal((source.match(/\.updateLevelSelection\(/g) ?? []).length, 1,
    'the level selection is published exactly once');
  const renderStart = source.indexOf('function renderLocalCampaign(');
  assert.ok(renderStart >= 0, 'main.js keeps renderLocalCampaign');
  const renderEnd = source.indexOf('\n}\n', renderStart);
  const publish = source.indexOf('mobileUi?.updateLevelSelection(', renderStart);
  assert.ok(publish > renderStart && publish < renderEnd,
    'the publication lives inside renderLocalCampaign');

  const guarded = source.slice(renderStart, publish);
  assert.match(guarded, /if \(platform\.isApp\) \{/, 'the publication is app-only');
  assert.match(source.slice(publish), /level: Number\(levelJumpSelect\.value\), mode: 'replay'/);
  assert.match(source.slice(publish), /level: progress\.nextLevel \?\? 1, mode: 'continuation'/);

  // The app branch registers the widget; the web build never imports it.
  assert.match(source, /mobileUi\?\.registerWidget\('level-numerals', createLevelNumerals\(\{/);
  assert.equal((source.match(/import\('\.\/level-numerals\.js'\)/g) ?? []).length, 1);
  const appStart = source.indexOf('if (platform.isApp) {');
  const appEnd = source.indexOf('\n}\n', appStart);
  assert.ok(source.slice(appStart, appEnd).includes("import('./level-numerals.js')"),
    'the app branch imports the numeral module dynamically');
  assert.ok(!source.slice(0, appStart).includes('level-numerals'),
    'no module code references the numerals before the app guard');
  assert.ok(!source.slice(appEnd).includes("import('./level-numerals.js')"),
    'the web build never imports the numeral module');
});

test('the web title screen and web source stay untouched', async () => {
  await assert.rejects(
    stat(join(staticDir, 'game', 'level-numerals.js')),
    { code: 'ENOENT' },
    'the module ships only through the app overlay',
  );
  const index = await readFile(join(staticDir, 'index.html'), 'utf8');
  const css = await readFile(join(staticDir, 'styles.css'), 'utf8');
  assert.doesNotMatch(index, /level-numerals|title-level-numerals/,
    'the web page carries no numeral markup');
  assert.doesNotMatch(css, /title-level-numerals/,
    'the web stylesheet carries no numeral rules');
});

// --- Deterministic title layout fixture ---------------------------------
// The CSS media queries in static/styles.css set the title row and logo size;
// mobile-ui.css positions the numerals at the safe-area top-left with a vw
// clamp. These helpers mirror those declarations so the non-overlap proof is
// explicit and runs without a browser.
const LOGO_ASPECT = 1408 / 680;
const TITLE_GAP = 6;

function isLandscape({ width, height }) {
  return width > height;
}

function titleRowHeight({ width, height }) {
  const landscape = isLandscape({ width, height });
  let rows = landscape ? 88 : 112;
  if (!landscape && width >= 380 && height >= 700) rows = 184;
  if (landscape && height >= 500) rows = 232;
  if (!landscape && width >= 700) rows = 232;
  if (landscape && height <= 400) rows = 44;
  return rows;
}

function logoHeight({ width, height }) {
  const landscape = isLandscape({ width, height });
  let heightPx = 44;
  if (!landscape) heightPx = 64;
  if (!landscape && width >= 380 && height >= 700) heightPx = 136;
  if (landscape && height >= 500) heightPx = 184;
  if (!landscape && width >= 700) heightPx = 184;
  return heightPx;
}

function numeralFontSize({ width, height }) {
  const preferred = isLandscape({ width, height }) ? 4.5 * width / 100 : 7 * width / 100;
  const minimum = isLandscape({ width, height }) ? 16 : 18;
  const maximum = isLandscape({ width, height }) ? 44 : 56;
  return Math.min(maximum, Math.max(minimum, preferred));
}

function titleGeometry({ width, height, safeTop = 0, safeLeft = 0, safeRight = 0, digits = 2 }) {
  const contentTop = safeTop + 8;
  const contentLeft = safeLeft + 8;
  const contentWidth = width - safeLeft - safeRight - 16;
  const rowHeight = titleRowHeight({ width, height });
  const logoPx = logoHeight({ width, height });
  const logoWidth = Math.min(logoPx * LOGO_ASPECT, contentWidth);
  const logoCenter = contentLeft + contentWidth / 2;
  const centered = isLandscape({ width, height }) && height <= 400;
  const logoTop = centered
    ? contentTop + (rowHeight - logoPx) / 2
    : contentTop + rowHeight - logoPx;
  const font = numeralFontSize({ width, height });
  const numeralWidth = Math.min(digits * 0.6 * font, width * 0.24);
  return {
    numerals: {
      left: safeLeft + 10,
      right: safeLeft + 10 + numeralWidth,
      top: safeTop + 10,
      bottom: safeTop + 10 + font,
    },
    logo: {
      left: logoCenter - logoWidth / 2,
      right: logoCenter + logoWidth / 2,
      top: logoTop,
      bottom: logoTop + logoPx,
    },
    introTop: contentTop + rowHeight + TITLE_GAP,
    rowBottom: contentTop + rowHeight,
  };
}

function overlaps(a, b) {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
}

const VIEWPORTS = [
  // 320px portrait and other small/ordinary phones.
  { name: '320px portrait', width: 320, height: 568 },
  { name: '320px short portrait', width: 320, height: 480 },
  { name: '360px portrait', width: 360, height: 640 },
  { name: '390px notched portrait', width: 390, height: 844, safeTop: 47 },
  { name: '414px notched portrait', width: 414, height: 896, safeTop: 44 },
  // Rotation of the same phone: landscape keeps the notch insets.
  { name: '568px landscape', width: 568, height: 320 },
  { name: '640px landscape', width: 640, height: 360 },
  { name: '844px notched landscape', width: 844, height: 390, safeLeft: 47, safeRight: 47 },
  { name: '896px notched landscape', width: 896, height: 414, safeLeft: 44, safeRight: 44 },
  { name: '932px landscape', width: 932, height: 430 },
  // Tablets, both orientations.
  { name: '768px tablet portrait', width: 768, height: 1024 },
  { name: '1024px tablet landscape', width: 1024, height: 768 },
  { name: '1024×400 short tablet landscape', width: 1024, height: 400 },
];

test('the numerals clear the logo and the intro/login/button rows at every fixture', () => {
  const digits = String(TOTAL_LEVELS).length;
  assert.equal(digits, 2, 'the fixture uses the widest possible level number');

  for (const viewport of VIEWPORTS) {
    const geometry = titleGeometry({ ...viewport, digits });
    const { numerals, logo, introTop } = geometry;

    assert.ok(numerals.left >= 0 && numerals.top >= 0, `${viewport.name}: numerals stay on screen`);
    assert.ok(numerals.right <= viewport.width && numerals.bottom <= viewport.height,
      `${viewport.name}: numerals stay inside the viewport`);
    assert.equal(overlaps(numerals, logo), false,
      `${viewport.name}: numerals must not overlap the title logo ` +
      `(numerals ${JSON.stringify(numerals)}, logo ${JSON.stringify(logo)})`);
    assert.ok(numerals.bottom <= introTop,
      `${viewport.name}: numerals must end above the intro/login/button rows ` +
      `(${numerals.bottom} <= ${introTop})`);
    assert.ok(numerals.bottom <= viewport.height - 44,
      `${viewport.name}: numerals never reach the navigation row`);
  }
});

test('the overlay stylesheet positions the numerals with the measured values', async () => {
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');

  assert.match(css, /\.title-level-numerals\s*\{[^}]*position:\s*absolute/);
  assert.match(css, /\.title-level-numerals\s*\{[^}]*top:\s*calc\(var\(--safe-area-top[^}]*\+\s*10px\)/);
  assert.match(css, /\.title-level-numerals\s*\{[^}]*left:\s*calc\(var\(--safe-area-left[^}]*\+\s*10px\)/);
  assert.match(css, /\.title-level-numerals\s*\{[^}]*font-family:\s*monospace/);
  assert.match(css, /\.title-level-numerals\s*\{[^}]*font-size:\s*clamp\(18px,\s*7vw,\s*56px\)/);
  assert.match(css, /\.title-level-numerals\s*\{[^}]*max-width:\s*24vw/);
  assert.match(css, /\.title-level-numerals\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /\.title-level-numerals\s*\{[^}]*font-variant-numeric:\s*oldstyle-nums/);
  assert.match(css, /\.title-level-numerals\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(orientation: landscape\)\s*\{\s*\.title-level-numerals\s*\{[^}]*clamp\(16px,\s*4\.5vw,\s*44px\)/);

  assert.doesNotMatch(css, /https?:\/\//, 'the overlay stylesheet must stay offline');
  assert.doesNotMatch(css, /@font-face|@import/, 'no external font service or import');
  assert.doesNotMatch(css, /url\(/, 'the numerals use CSS glyphs only, never an image asset');
});
