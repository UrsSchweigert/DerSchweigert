import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountProfileUI } from '../game/profile-ui.js';
import { createLocalProfileAdapter } from '../game/local-profile-adapter.js';

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
const rows = (root) => root.querySelectorAll('.profile-row');
const status = (root) => root.querySelector('.profile-status').textContent;

async function fixture({ count = 1, height = 800, translate } = {}) {
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
  const view = {
    innerHeight: height,
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
    onSelected: (profile) => { selected.push(profile); },
    onError: (error) => { errors.push(error); },
    onBusyChange: (busy) => { busyChanges.push(busy); },
  });
  await ui.refresh();
  return { root, adapter, backend, ui, selected, errors, busyChanges, view, listeners, block: () => { allowed = false; } };
}

test('profile choices are paginated without scrolling and adapt to tiny landscape', async () => {
  const { root, ui, view, listeners } = await fixture({ count: 7 });
  assert.equal(rows(root).length, 3);
  assert.equal(findButton(root, 'Previous').disabled, true);
  findButton(root, 'Next').click();
  assert.deepEqual(rows(root).map((row) => row.querySelector('.profile-select').textContent), ['Player 4', 'Player 5', 'Player 6']);
  findButton(root, 'Next').click();
  assert.equal(rows(root).length, 1);
  assert.equal(findButton(root, 'Next').disabled, true);
  view.innerHeight = 320;
  listeners.get('resize')();
  assert.ok(rows(root).length <= 2);
  ui.destroy();
  assert.equal(root.children.length, 0);
  assert.equal(listeners.size, 0);
});

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
  findButton(row, 'Rename').click();
  const renamed = root.querySelector('input');
  renamed.value = 'Renamed';
  renamed.dispatch('input');
  root.querySelector('form').dispatch('submit');
  await tick();
  assert.deepEqual(adapter.getActiveProfile(), { id: active.id, name: 'Renamed' });
});

test('deletion has a separate confirmation stage and cancel never deletes', async () => {
  const { root, adapter, selected } = await fixture({ count: 2 });
  findButton(rows(root)[1], 'Delete').click();
  assert.equal(rows(root).length, 0);
  assert.match(root.querySelector('.profile-confirmation').textContent, /Delete Player 2 and all their progress/);
  findButton(root, 'Cancel').click();
  assert.equal((await adapter.listProfiles()).length, 2);
  findButton(rows(root)[1], 'Delete').click();
  findButton(root, 'Delete player').click();
  await tick();
  assert.deepEqual(await adapter.listProfiles(), [{ id: 'id-1', name: 'First' }]);
  assert.deepEqual(selected, [adapter.getActiveProfile()]);
  assert.equal(findButton(root, 'Delete').disabled, true);
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
  for (const label of ['First', 'Player 2', 'New player', 'Rename', 'Delete']) {
    assert.equal(findButton(root, label).disabled, true);
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
