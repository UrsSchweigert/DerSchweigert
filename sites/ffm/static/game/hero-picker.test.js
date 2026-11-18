import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HEROES } from './heroes.js';
import { buildHeroGridMarkup, mountHeroPicker } from './hero-picker.js';

const t = (key) => `[${key}]`;
const SOURCE = readFileSync(new URL('./hero-picker.js', import.meta.url), 'utf8');

// Minimal fake DOM: parses the picker's own markup into elements.
class El {
  constructor(tag, attrs = {}) {
    this.tag = tag;
    this.attrs = attrs;
    this.listeners = {};
    this.textContent = '';
    this.parent = null;
    this.children = [];
  }
  getAttribute(n) { return this.attrs[n] ?? null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  fire(type) { (this.listeners[type] ?? []).slice().forEach((fn) => fn({ type })); }
  replaceWith(node) {
    const i = this.parent.children.indexOf(this);
    this.parent.children[i] = node;
    node.parent = this.parent;
  }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) { return this.all().filter((e) => matches(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  set innerHTML(html) {
    this.children = [];
    let cur = this;
    const re = /<(\/?)([a-z0-9]+)([^>]*)>/g;
    for (const m of html.matchAll(re)) {
      if (m[1]) {
        if (cur !== this && cur.tag === m[2]) cur = cur.parent;
        continue;
      }
      const attrs = {};
      for (const a of m[3].matchAll(/([a-z-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
      const el = new El(m[2], attrs);
      el.parent = cur;
      cur.children.push(el);
      if (m[2] !== 'img') cur = el;
    }
    this.html = html;
  }
  get firstChild() { return this.children[0]; }
  get ownerDocument() { return { createElement: (tag) => new El(tag) }; }
}
function matches(e, sel) {
  if (sel === 'button[data-hero-id]') return e.tag === 'button' && 'data-hero-id' in e.attrs;
  if (sel === 'img[data-hero-portrait]') return e.tag === 'img' && 'data-hero-portrait' in e.attrs;
  const m = /^\[([a-z-]+)\]$/.exec(sel);
  return Boolean(m) && m[1] in e.attrs;
}

function setup(over = {}) {
  const root = new El('div');
  const calls = { select: [], locked: [], preview: [] };
  let selected = 'adventurer';
  const picker = mountHeroPicker(root, {
    t,
    getSelectedId: () => selected,
    isLocked: (h) => !h.free,
    canChange: () => true,
    onSelect: (h) => { calls.select.push(h.id); selected = h.id; },
    onLocked: (h) => calls.locked.push(h.id),
    renderPreview: (h, el) => calls.preview.push([h.id, el]),
    ...over,
  });
  return { root, calls, picker };
}

test('markup: one button per hero in roster order with names and aria-pressed', () => {
  const html = buildHeroGridMarkup({ selectedId: 'adventurer', isLocked: (h) => !h.free, t });
  const ids = [...html.matchAll(/data-hero-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, HEROES.map((h) => h.id));
  assert.equal((html.match(/<button type="button"/g) ?? []).length, HEROES.length);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.match(html, /<span class="hero-picker-name">\[heroes\.name\.wood\]<\/span>/);
  assert.match(html, /role="status"/);
});

test('markup: locked hero has badge with text alternative and locked name', () => {
  const html = buildHeroGridMarkup({ selectedId: 'adventurer', isLocked: (h) => !h.free, t });
  assert.equal((html.match(/hero-picker-lock/g) ?? []).length, HEROES.length - 1);
  assert.match(html, /role="img" aria-label="\[heroes\.locked\]"/);
  assert.match(html, /aria-label="\[heroes\.name\.quirl\], \[heroes\.locked\]"/);
  assert.match(html, /class="hero-picker-item is-locked"/);
  assert.match(html, /aria-label="\[heroes\.name\.adventurer\], \[heroes\.selected\]"/);
});

test('markup escapes names and urls', () => {
  const html = buildHeroGridMarkup({
    heroes: [{ id: 'x', nameKey: 'n', portrait: 'p' }],
    t: () => '<b>"',
    portraitUrl: () => 'a"b',
  });
  assert.ok(!html.includes('<b>'));
  assert.match(html, /src="a&quot;b"/);
});

test('locked hero calls onLocked only', () => {
  const { root, calls } = setup();
  const button = root.querySelectorAll('button[data-hero-id]')[5];
  button.fire('click');
  assert.deepEqual(calls.locked, ['quirl']);
  assert.deepEqual(calls.select, []);
});

test('available hero calls onSelect once and updates aria-pressed', () => {
  const { root, calls } = setup({ isLocked: () => false });
  const buttons = root.querySelectorAll('button[data-hero-id]');
  buttons[1].fire('click');
  assert.deepEqual(calls.select, ['wood']);
  assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'false');
});

test('a different highlighted hero gets the thin frame while the worn hero keeps the thick one', () => {
  let selected = 'adventurer';
  const root = new El('div');
  mountHeroPicker(root, {
    t,
    getSelectedId: () => selected,
    getCurrentId: () => 'adventurer',
    isLocked: () => false,
    onSelect: (h) => { selected = h.id; },
  });
  const buttons = root.querySelectorAll('button[data-hero-id]');
  assert.match(buttons[0].attrs.class, /\bis-current\b/);
  assert.doesNotMatch(buttons[0].attrs.class, /is-prospective/, 'the worn hero is not a new choice');
  buttons[2].fire('click');
  assert.match(buttons[0].attrs.class, /\bis-current\b/, 'the worn hero keeps its frame');
  assert.doesNotMatch(buttons[0].attrs.class, /is-selected/);
  assert.match(buttons[2].attrs.class, /\bis-selected\b/);
  assert.match(buttons[2].attrs.class, /\bis-prospective\b/, 'the next choice is framed too');
  buttons[0].fire('click');
  assert.equal(root.all().filter((e) => /is-prospective/.test(e.attrs.class ?? '')).length, 0);
});

test('the frames are the shared gold: thick for the worn hero, hairline for the next choice', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.hero-picker-item\.is-current \{ border-color: var\(--brass-light\); \}/);
  assert.match(css, /\.hero-picker-item\.is-prospective \{[^}]*box-shadow: inset 0 0 0 1px var\(--brass-light\)/);
  assert.doesNotMatch(css, /\.hero-picker-item\.is-selected \{/, 'no separate (green) selection frame is left');
});

test('canChange false selects nothing and shows blocked message in status', () => {
  const { root, calls } = setup({ isLocked: () => false, canChange: () => false });
  root.querySelectorAll('button[data-hero-id]')[1].fire('click');
  assert.deepEqual(calls.select, []);
  assert.equal(root.querySelector('[data-hero-status]').textContent, '[heroes.blockedWhilePlaying]');
});

test('portrait error swaps in a placeholder and keeps the name', () => {
  const { root } = setup();
  const button = root.querySelectorAll('button[data-hero-id]')[0];
  button.querySelector('img[data-hero-portrait]').fire('error');
  assert.equal(button.querySelector('img[data-hero-portrait]'), null);
  const holder = button.children[0];
  assert.equal(holder.attrs.class, 'hero-picker-placeholder');
  assert.equal(holder.attrs['aria-label'], '[heroes.placeholderAlt]');
  assert.ok(button.children.some((c) => c.attrs.class === 'hero-picker-name'));
});

test('preview shows the selected hero first, then the focused one', () => {
  const { root, calls } = setup();
  assert.equal(calls.preview[0][0], 'adventurer');
  assert.ok('data-hero-preview' in calls.preview[0][1].attrs);
  root.querySelectorAll('button[data-hero-id]')[4].fire('focus');
  assert.equal(calls.preview.at(-1)[0], 'ori');
});

test('destroy removes listeners', () => {
  const { root, calls, picker } = setup({ isLocked: () => false });
  const button = root.querySelectorAll('button[data-hero-id]')[1];
  picker.destroy();
  button.fire('click');
  assert.deepEqual(calls.select, []);
});

test('source: imports only heroes.js, no focus trap, key listener, timer or platform API', () => {
  const imports = [...SOURCE.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./heroes.js']);
  const code = SOURCE.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/setTimeout|setInterval|requestAnimationFrame|keydown|keyup|keypress|tabindex|\bdocument\.|\bwindow\.|fetch\(|localStorage/i.test(code));
});

test('source: main.js previews on select and saves only through the Change hero button', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const start = main.indexOf('async function openHeroPicker');
  const body = main.slice(start, main.indexOf('const ensureLocalProfiles', start));
  const onSelect = body.slice(body.indexOf('onSelect:'), body.indexOf('onLocked:'));
  assert.ok(!/setHero|updateProfile/.test(onSelect), 'selecting must not write');
  assert.match(body, /confirmBtn\.addEventListener\('click'/);
  assert.match(body, /diff-btn action-primary hero-picker-confirm/);
  assert.match(body, /t\('heroes\.confirm'\)/);
  assert.match(body, /t\('heroes\.cancel'\)/);
  assert.match(body, /selectedId === committedId \|\| locked \|\| !canSwitchProfiles\(\)/);
  assert.match(body, /onLocaleChange\(/);
});
