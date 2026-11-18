import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { renderHeroIdentity } from './hero-identity.js';
import { HEROES, resolveHero, heroAssetUrl } from './heroes.js';
import { t } from './i18n.js';

const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');

class FakeEl {
  constructor(tag) {
    this.tag = tag; this.attrs = {}; this.children = []; this.parentNode = null;
    this.listeners = {}; this.className = ''; this.ownerDocument = { createElement: (x) => new FakeEl(x) };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(n, f) { this.listeners[n] = f; }
  prepend(c) { c.parentNode = this; this.children.unshift(c); }
  remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  replaceWith(n) {
    const p = this.parentNode; p.children[p.children.indexOf(this)] = n;
    n.parentNode = p; this.parentNode = null;
  }
}

const adventurer = HEROES[0];
const quirl = HEROES.find((h) => h.id === 'quirl');
const owned = (row) => row.children.filter((c) => c.hasAttribute('data-hero-identity'));

test('inserts one portrait with localised alt text and keeps other children', () => {
  const row = new FakeEl('p');
  const name = new FakeEl('strong');
  row.children.push(name); name.parentNode = row;
  renderHeroIdentity(row, adventurer, { t });
  renderHeroIdentity(row, adventurer, { t });
  assert.equal(owned(row).length, 1);
  assert.equal(row.children[1], name);
  assert.equal(owned(row)[0].getAttribute('alt'), 'Portrait of Ari');
  assert.equal(owned(row)[0].getAttribute('src'), heroAssetUrl(adventurer.portrait));
});

test('updates in place for another hero and removes when there is none', () => {
  const row = new FakeEl('p');
  renderHeroIdentity(row, adventurer, { t });
  renderHeroIdentity(row, quirl, { t });
  assert.equal(owned(row).length, 1);
  assert.equal(owned(row)[0].getAttribute('src'), heroAssetUrl(quirl.portrait));
  renderHeroIdentity(row, null, { t });
  assert.equal(row.children.length, 0);
  assert.equal(renderHeroIdentity(null, quirl, { t }), null);
});

test('image error swaps to the placeholder once, without a src', () => {
  const row = new FakeEl('p');
  const img = renderHeroIdentity(row, adventurer, { t });
  img.listeners.error();
  img.listeners.error();
  const [placeholder] = owned(row);
  assert.equal(owned(row).length, 1);
  assert.equal(placeholder.getAttribute('aria-label'), 'Hero portrait placeholder');
  assert.equal(placeholder.hasAttribute('src'), false);
  renderHeroIdentity(row, adventurer, { t });
  assert.equal(owned(row)[0], placeholder);
});

test('a hero without a portrait shows the placeholder', () => {
  const row = new FakeEl('p');
  const el = renderHeroIdentity(row, { ...adventurer, portrait: undefined }, { t });
  assert.equal(el.tag, 'span');
  assert.ok(el.getAttribute('aria-label'));
});

function channel({ isApp, isLoggedIn = true, stored = 'quirl', name = 'Ann' }) {
  const rows = {};
  const elements = {};
  for (const id of ['playing-as', 'progress-player-name', 'pause-player-name']) {
    const row = new FakeEl('p'); rows[id] = row;
    elements[id] = { parentElement: row };
  }
  const splashGreeting = new FakeEl('p'); splashGreeting.textContent = isLoggedIn ? 'Hello' : '';
  const queried = [];
  const context = {
    platform: { isApp, isLoggedIn, getActiveHeroSkin: async () => stored },
    activeLocalPlayer: { name }, splashGreeting, t, renderHeroIdentity, resolveHero,
    document: { getElementById: (id) => { queried.push(id); return elements[id]; } },
    resolveActiveHeroId: async () => stored,
    heroPackOn: () => true,
    paintTitlePlayerBadge: () => {},
  };
  vm.createContext(context);
  vm.runInContext(source.match(/let heroIdentitySeq[\s\S]*?\n\}\n/)[0] + '\nthis.paint = paintHeroIdentity;', context);
  return { context, rows, splashGreeting, queried };
}

test('app channel paints the three identity rows and never the greeting', async () => {
  const { context, rows, splashGreeting } = channel({ isApp: true });
  await context.paint();
  for (const row of Object.values(rows)) assert.equal(owned(row).length, 1);
  assert.equal(splashGreeting.children.length, 0);
});

test('web channel paints the greeting only and does not query app rows', async () => {
  const { context, rows, splashGreeting, queried } = channel({ isApp: false });
  await context.paint();
  assert.equal(owned(splashGreeting).length, 1);
  assert.deepEqual(queried, []);
  for (const row of Object.values(rows)) assert.equal(row.children.length, 0);
});

test('logged-out web player gets no portrait', async () => {
  const { context, splashGreeting } = channel({ isApp: false, isLoggedIn: false });
  await context.paint();
  assert.equal(splashGreeting.children.length, 0);
});

test('a locked choice shows the adventurer', () => {
  assert.equal(resolveHero('quirl', { entitled: false }).id, 'adventurer');
});
