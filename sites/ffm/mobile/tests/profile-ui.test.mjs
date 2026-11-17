import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountProfileUI } from '../game/profile-ui.js';
import { createLocalProfileAdapter } from '../game/local-profile-adapter.js';
import { readFile } from 'node:fs/promises';

test('profile editing is a non-shrinking opaque stage without purchase or notice content', async () => {
  const css = await readFile(new URL('../game/mobile-ui.css', import.meta.url), 'utf8');
  assert.match(css, /#local-profiles #profile-root\s*\{\s*flex:\s*0 0 auto/);
  assert.match(css, /#local-profiles:has\(\.profile-form, \.profile-confirmation\) > :not\(#profile-root\)\s*\{\s*display:\s*none/);
  assert.match(css, /#local-profiles \.profile-confirmation\s*\{[^}]*background:\s*var\(--ink-900\)/s);
  assert.match(css, /#local-profiles \.profile-name-input\s*\{\s*box-sizing:\s*border-box/);
});

// A small DOM fixture exercises actual listeners without installing a DOM dependency.
class Element {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
    this.className = '';
    this.disabled = false;
    this.value = '';
    this._text = '';
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }
  dispatch(name, event = { preventDefault() {} }) {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const matches = (node) => selector.startsWith('.')
      ? node.className.split(' ').includes(selector.slice(1))
      : node.tagName.toLowerCase() === selector;
    return this.children.flatMap((child) => [
      ...(matches(child) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const findButton = (root, text) => root.querySelectorAll('button').find((button) => button.textContent === text);
const findLabelled = (root, label) => root.querySelectorAll('button').find((button) => button.attributes['aria-label'] === label);
const rows = (root) => root.querySelectorAll('.profile-row');
const status = (root) => root.querySelector('.profile-status').textContent;

async function fixture({ count = 1, height = 800, translate, extra = {} } = {}) {
  const data = new Map();
  const backend = {
    fail: false,
    async get(key) { return data.get(key) ?? null; },
    async set(key, value) {
      if (this.fail) throw new Error('storage failure');
      data.set(key, value);
    },
  };
  let nextId = 0;
  const adapter = createLocalProfileAdapter({ backend, makeId: () => `id-${++nextId}` });
  await adapter.initialize({ defaultName: 'First' });
  for (let index = 1; index < count; index++) await adapter.createProfile(`Player ${index + 1}`);
  const listeners = new Map();
  const viewportListeners = new Map();
  const view = {
    innerHeight: height,
    visualViewport: {
      height,
      addEventListener(name, listener) { viewportListeners.set(name, listener); },
      removeEventListener(name, listener) { if (viewportListeners.get(name) === listener) viewportListeners.delete(name); },
    },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
  };
  const doc = { defaultView: view, createElement: (tag) => new Element(tag, doc) };
  const root = new Element('section', doc);
  let allowed = true;
  const selected = [];
  const errors = [];
  const busyChanges = [];
  const ui = mountProfileUI({
    root, adapter, translate,
    canSwitch: () => allowed,
    ...extra,
    onSelected: (profile) => { selected.push(profile); },
    onError: (error) => { errors.push(error); },
    onBusyChange: (busy) => { busyChanges.push(busy); },
  });
  await ui.refresh();
  return { root, adapter, backend, ui, selected, errors, busyChanges, view, listeners, viewportListeners, block: () => { allowed = false; } };
}

test('profile choices are paginated without scrolling and adapt to tiny landscape', async () => {
  const { root, ui, view, listeners } = await fixture({ count: 7 });
  assert.equal(rows(root).length, 3);
  for (const label of ['Previous', 'Next']) {
    const arrow = findLabelled(root, label);
    assert.equal(arrow.textContent, '', 'no visible text beside the arrow');
    assert.equal(arrow.attributes.title, label);
  }
  assert.equal(findLabelled(root, 'Previous').disabled, true);
  findLabelled(root, 'Next').click();
  assert.deepEqual(rows(root).map((row) => row.querySelector('.profile-select').textContent), ['Player 4', 'Player 5', 'Player 6']);
  findLabelled(root, 'Next').click();
  assert.equal(rows(root).length, 1);
  assert.equal(findLabelled(root, 'Next').disabled, true);
  view.innerHeight = 320;
  view.visualViewport.height = 320;
  listeners.get('resize')();
  assert.ok(rows(root).length <= 2);
  ui.destroy();
  assert.equal(root.children.length, 0);
  assert.equal(listeners.size, 0);
});

for (const label of ['New player', 'Rename']) {
  test(`${label} keeps the focused input and draft intact across keyboard and rotation resizes`, async () => {
    const { root, adapter, ui, view, listeners, viewportListeners } = await fixture();
    const opener = label === 'Rename' ? rows(root)[0].querySelector('.profile-rename') : findButton(root, label);
    opener.click();
    const input = root.querySelector('input');
    input.value = 'Draft name';
    input.dispatch('input');
    view.visualViewport.height = 280;
    viewportListeners.get('resize')();
    view.innerHeight = 375;
    listeners.get('resize')();
    assert.equal(root.querySelector('input'), input);
    assert.equal(root.ownerDocument.activeElement, input);
    assert.equal(input.disabled, false);
    assert.equal(input.value, 'Draft name');
    assert.ok(findButton(root, 'Cancel'));
    root.querySelector('form').dispatch('submit');
    await ui.whenIdle();
    assert.equal(adapter.getActiveProfile().name, 'Draft name');
    ui.destroy();
    assert.equal(viewportListeners.size, 0);
  });
}

test('selection persists and reports the committed profile', async () => {
  const { root, adapter, selected } = await fixture({ count: 2 });
  findButton(root, 'First').click();
  await tick();
  assert.equal(adapter.getActiveProfile().name, 'First');
  assert.deepEqual(selected, [adapter.getActiveProfile()]);
  assert.equal(findButton(root, 'First').attributes['aria-pressed'], 'true');
});

test('create and rename forms replace the list, support safe names and retain stable IDs', async () => {
  const { root, adapter, selected } = await fixture();
  findButton(root, 'New player').click();
  assert.equal(rows(root).length, 0);
  const input = root.querySelector('input');
  assert.equal(input.maxLength, 40);
  assert.equal(root.ownerDocument.activeElement, input);
  input.value = '<img src=x onerror=bad>';
  input.dispatch('input');
  root.querySelector('form').dispatch('submit');
  await tick();
  const active = adapter.getActiveProfile();
  assert.equal(active.name, input.value);
  assert.equal(root.querySelectorAll('img').length, 0);
  assert.equal(findButton(root, input.value).textContent, input.value);
  assert.deepEqual(selected, [active]);
  const row = rows(root).find((item) => item.querySelector('.profile-select').textContent === active.name);
  row.querySelector('.profile-rename').click();
  const renamed = root.querySelector('input');
  renamed.value = 'Renamed';
  renamed.dispatch('input');
  root.querySelector('form').dispatch('submit');
  await tick();
  assert.deepEqual(adapter.getActiveProfile(), { id: active.id, name: 'Renamed' });
});

test('deletion has a separate confirmation stage and cancel never deletes', async () => {
  const { root, adapter, selected } = await fixture({ count: 2, extra: { random: () => 0, locale: 'en' } });
  rows(root)[1].querySelector('.profile-delete').click();
  assert.equal(rows(root).length, 0);
  assert.match(root.querySelector('.profile-confirmation').textContent, /Delete Player 2 and all their progress/);
  findButton(root, 'Cancel').click();
  assert.equal((await adapter.listProfiles()).length, 2);
  rows(root)[1].querySelector('.profile-delete').click();
  assert.match(root.querySelector('.profile-gate').textContent, /six times six/);
  findButton(root, 'Delete player').click();
  await tick();
  assert.equal((await adapter.listProfiles()).length, 2, 'unsolved gate does not delete');
  root.querySelector('.profile-gate-input').value = '12';
  root.querySelector('.profile-gate-input').dispatch('input');
  findButton(root, 'Delete player').click();
  await tick();
  assert.equal((await adapter.listProfiles()).length, 2, 'wrong answer does not delete');
  assert.match(status(root), /not right/);
  root.querySelector('.profile-gate-input').value = '36';
  root.querySelector('.profile-gate-input').dispatch('input');
  findButton(root, 'Delete player').click();
  await tick();
  assert.deepEqual(await adapter.listProfiles(), [{ id: 'id-1', name: 'First' }]);
  assert.deepEqual(selected, [adapter.getActiveProfile()]);
  assert.equal(root.querySelector('.profile-delete').disabled, true);
});

test('midrun changes are disabled after refresh and stale controls recheck the guard', async () => {
  const { root, adapter, block, errors, selected, ui } = await fixture({ count: 2 });
  const staleSelect = findButton(root, 'First');
  block();
  staleSelect.click();
  await tick();
  assert.equal(adapter.getActiveProfile().name, 'Player 2');
  assert.equal(errors[0].code, 'profile_switch_blocked');
  assert.deepEqual(selected, []);
  assert.match(status(root), /Finish the current game/);
  await ui.refresh();
  for (const label of ['First', 'Player 2', 'New player']) {
    assert.equal(findButton(root, label).disabled, true);
  }
  for (const row of rows(root)) {
    assert.equal(row.querySelector('.profile-rename').disabled, true);
    assert.equal(row.querySelector('.profile-delete').disabled, true);
  }
});

test('a form opened before the game starts cannot submit a profile change midrun', async () => {
  const { root, adapter, block, errors } = await fixture();
  findButton(root, 'New player').click();
  root.querySelector('input').value = 'Blocked';
  block();
  root.querySelector('form').dispatch('submit');
  await tick();
  assert.equal((await adapter.listProfiles()).length, 1);
  assert.equal(errors[0].code, 'profile_switch_blocked');
});

test('storage failures remain visible without successful selection callbacks; retry works', async () => {
  const { root, adapter, backend, errors, selected } = await fixture({ count: 2 });
  backend.fail = true;
  findButton(root, 'First').click();
  await tick();
  assert.equal(adapter.getActiveProfile().name, 'Player 2');
  assert.deepEqual(selected, []);
  assert.equal(errors[0].code, 'storage_unavailable');
  assert.match(status(root), /could not be saved/);
  backend.fail = false;
  findButton(root, 'First').click();
  await tick();
  assert.equal(selected.length, 1);
  assert.equal(status(root), '');
});

test('translation values and profile names are text, never HTML', async () => {
  const { root } = await fixture({ translate: (key) => key === 'profiles.create' ? '<b>New</b>' : key });
  assert.equal(findButton(root, '<b>New</b>').textContent, '<b>New</b>');
  assert.equal(root.querySelectorAll('b').length, 0);
});

test('destroy removes the panel and late refresh results cannot remount it', async () => {
  const { root, adapter, ui } = await fixture();
  let resolve;
  adapter.listProfiles = () => new Promise((done) => { resolve = done; });
  const pending = ui.refresh();
  ui.destroy();
  resolve([{ id: 'id-1', name: 'First' }]);
  await pending;
  assert.equal(root.children.length, 0);
});

test('busy callback blocks play synchronously until a delayed mutation commits and selection finishes', async () => {
  const { root, adapter, ui, busyChanges } = await fixture({ count: 2 });
  busyChanges.length = 0;
  let commit;
  const select = adapter.selectProfile;
  adapter.selectProfile = async (id) => {
    assert.equal(ui.isBusy(), true);
    await new Promise((resolve) => { commit = resolve; });
    return select(id);
  };
  findButton(root, 'First').click();
  assert.deepEqual(busyChanges, [true]);
  assert.equal(ui.isBusy(), true);
  assert.equal(adapter.getActiveProfile().name, 'Player 2');
  for (const control of root.querySelectorAll('button')) assert.equal(control.disabled, true);
  let playStarted = false;
  const waiting = ui.whenIdle().then(() => { playStarted = true; });
  await tick();
  assert.equal(playStarted, false);
  commit();
  await waiting;
  assert.equal(adapter.getActiveProfile().name, 'First');
  assert.equal(ui.isBusy(), false);
  assert.deepEqual(busyChanges, [true, false]);
});

test('a failed delayed mutation releases busy and idle waiters without reporting selection', async () => {
  const { root, adapter, ui, busyChanges, selected, errors } = await fixture({ count: 2 });
  busyChanges.length = 0;
  let reject;
  adapter.selectProfile = () => new Promise((resolve, fail) => { reject = fail; });
  findButton(root, 'First').click();
  assert.equal(ui.isBusy(), true);
  const waiting = ui.whenIdle();
  reject(Object.assign(new Error('write failed'), { code: 'storage_unavailable' }));
  await waiting;
  assert.equal(ui.isBusy(), false);
  assert.deepEqual(busyChanges, [true, false]);
  assert.deepEqual(selected, []);
  assert.equal(errors[0].code, 'storage_unavailable');
  assert.equal(adapter.getActiveProfile().name, 'Player 2');
});

test('overlapping refreshes stay busy until all pending reads settle, including failed reads', async () => {
  const { adapter, ui, busyChanges } = await fixture();
  busyChanges.length = 0;
  const reads = [];
  adapter.listProfiles = () => new Promise((resolve, reject) => { reads.push({ resolve, reject }); });
  const first = ui.refresh();
  const second = ui.refresh();
  assert.deepEqual(busyChanges, [true]);
  reads[1].resolve([{ id: 'id-1', name: 'First' }]);
  await second;
  assert.equal(ui.isBusy(), true);
  const waiting = ui.whenIdle();
  reads[0].reject(new Error('stale read failed'));
  await Promise.all([first, waiting]);
  assert.equal(ui.isBusy(), false);
  assert.deepEqual(busyChanges, [true, false]);
});

test('busy create form disables its input and all navigation controls', async () => {
  const { root, adapter, ui } = await fixture();
  findButton(root, 'New player').click();
  let resolve;
  const create = adapter.createProfile;
  adapter.createProfile = async (name) => {
    await new Promise((done) => { resolve = done; });
    return create(name);
  };
  root.querySelector('input').value = 'New';
  root.querySelector('form').dispatch('submit');
  assert.equal(root.querySelector('input').disabled, true);
  for (const control of root.querySelectorAll('button')) assert.equal(control.disabled, true);
  resolve();
  await ui.whenIdle();
  assert.equal(adapter.getActiveProfile().name, 'New');
});

test('portrait and Change hero are opt-in, and the action is on the active row only', async () => {
  const plain = await fixture({ count: 2 });
  assert.equal(plain.root.querySelectorAll('.profile-portrait').length, 0);
  assert.equal(plain.root.querySelectorAll('.profile-change-hero').length, 0);

  const asked = [];
  const changed = [];
  const { root, adapter, ui, block } = await fixture({
    count: 2,
    extra: {
      portraitFor: (profile) => { asked.push(profile.name); return profile.name === 'First' ? 'heroes/x/portrait.webp' : null; },
      onChangeHero: (profile) => { changed.push(profile.id); },
    },
  });
  const portraits = root.querySelectorAll('.profile-portrait');
  assert.equal(portraits.length, 2, 'the active row portrait sits inside the button');
  assert.equal(portraits[0].tagName, 'IMG');
  assert.equal(portraits[0].attributes.src, 'heroes/x/portrait.webp');
  assert.equal(portraits[0].attributes.alt, '');
  assert.match(portraits[1].className, /profile-portrait-placeholder/);
  const actions = root.querySelectorAll('.profile-change-hero');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].textContent, '', 'the button is the portrait, not text');
  assert.match(actions[0].className, /profile-change-hero-portrait/);
  assert.equal(actions[0].attributes['aria-label'], `Change hero: ${adapter.getActiveProfile().name}`);
  actions[0].click();
  assert.deepEqual(changed, [adapter.getActiveProfile().id]);
  block();
  await ui.refresh();
  assert.equal(root.querySelector('.profile-change-hero').disabled, true);
});

test('heroFeature false hides the portrait and the Change hero action', async () => {
  const { root } = await fixture({
    count: 2,
    extra: { portraitFor: () => 'heroes/x/portrait.webp', onChangeHero: () => {}, heroFeature: () => false },
  });
  assert.equal(root.querySelectorAll('.profile-portrait').length, 0);
  assert.equal(root.querySelectorAll('.profile-change-hero').length, 0);
});

test('without a portrait source the Change hero action stays a text button', async () => {
  const { root } = await fixture({ count: 2, extra: { onChangeHero: () => {} } });
  const actions = root.querySelectorAll('.profile-change-hero');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].textContent, 'Change hero');
});

test('row rename and delete buttons are compact glyphs that keep their spoken names', async () => {
  const { root } = await fixture({ count: 2 });
  const [first] = rows(root);
  const rename = first.querySelector('.profile-rename');
  const remove = first.querySelector('.profile-delete');
  assert.equal(rename.textContent, 'ABC');
  assert.equal(rename.attributes['aria-label'], 'Rename: First');
  assert.equal(remove.textContent, 'X');
  assert.equal(remove.attributes['aria-label'], 'Delete: First');
  assert.equal(remove.disabled, false);
});

test('the only player cannot be deleted through the X button', async () => {
  const { root } = await fixture();
  const remove = rows(root)[0].querySelector('.profile-delete');
  assert.equal(remove.textContent, 'X');
  assert.equal(remove.disabled, true);
});

test('CSS sizes the row glyph buttons to 44px and keeps delete red', async () => {
  const css = await readFile(new URL('../game/mobile-ui.css', import.meta.url), 'utf8');
  assert.match(css, /#local-profiles \.profile-rename,\s*#local-profiles \.profile-delete[^{]*\{[^}]*min-width:\s*44px/s);
  assert.match(css, /#local-profiles \.profile-rename,\s*#local-profiles \.profile-delete[^{]*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /#local-profiles \.profile-delete\s*\{[^}]*color:\s*#ff6b6b/s);
});
