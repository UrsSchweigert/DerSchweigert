import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { createWebReminders, REMINDERS_SCHEDULE_KEY } from '../static/platform.mjs';
import { mountReminderSettings } from '../static/reminder-settings.mjs';
import { t } from '../static/i18n.mjs';

function element() {
  const handlers = new Map();
  return {
    hidden: true, disabled: false, value: '', checked: false, open: false, textContent: '',
    addEventListener(name, handler) { handlers.set(name, handler); },
    async emit(name) { await handlers.get(name)?.({ preventDefault() {} }); },
    showModal() { this.open = true; },
    close() { this.open = false; handlers.get('close')?.(); },
    focus() {},
    reportValidity() { return true; },
    querySelector() { return this.fieldset ??= { disabled: true }; },
  };
}

async function setup({ permission = 'granted', requestResult = 'granted', supported = true,
  store = new Map(), lang = 'de', failSchedule = false, failCancel = false, deferPermission = false } = {}) {
  const nodes = new Map();
  const doc = element();
  doc.hidden = false;
  doc.getElementById = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const calls = { request: 0, schedule: [], cancel: 0 };
  let resolvePermission = null;
  const permissionGate = deferPermission ? new Promise(resolve => { resolvePermission = resolve; }) : null;
  const plugin = {
    async checkPermissions() { return { display: permission }; },
    async requestPermissions() {
      calls.request++;
      if (permissionGate) await permissionGate;
      permission = requestResult;
      return { display: permission };
    },
    async schedule(payload) {
      if (failSchedule) throw Error('schedule unavailable');
      calls.schedule.push(payload);
    },
    async cancel() {
      calls.cancel++;
      if (failCancel) throw Error('cancel unavailable');
    },
  };
  const storage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key),
  };
  const reminders = createWebReminders({
    window: supported ? { Capacitor: { Plugins: { LocalNotifications: plugin } } } : {},
    store: storage,
  });
  const ui = mountReminderSettings({ document: doc, reminders, translate: key => t(lang, key), random: () => 0 });
  await ui.ready;
  const get = doc.getElementById;
  async function unlock() {
    await get('open-reminders').emit('click');
    get('reminders-answer').value = '33';
    await get('reminders-gate').emit('submit');
  }
  return { calls, reminders, store, doc, get, unlock, resolvePermission: () => resolvePermission?.() };
}

test('reminder settings: web build stays hidden and never prompts', async () => {
  const { get, calls } = await setup({ supported: false });
  assert.equal(get('open-reminders').hidden, true);
  assert.deepEqual(calls, { request: 0, schedule: [], cancel: 0 });
});

test('reminder settings: reachable native entry defaults off without prompting', async () => {
  const { get, calls } = await setup({ permission: 'prompt' });
  assert.equal(get('open-reminders').hidden, false);
  assert.equal(get('open-reminders').disabled, false);
  await get('open-reminders').emit('click');
  assert.equal(get('reminders-dialog').open, true);
  assert.equal(get('reminders-enabled').checked, false);
  assert.equal(get('reminders-time').value, '17:00');
  assert.equal(get('reminders-settings').hidden, true);
  assert.deepEqual(calls, { request: 0, schedule: [], cancel: 0 });
});

test('reminder settings: wrong or bypassed gate cannot enable notifications', async () => {
  const { get, calls, reminders } = await setup();
  await get('open-reminders').emit('click');
  get('reminders-enabled').checked = true;
  get('reminders-time').value = '08:15';
  await get('reminders-settings').emit('submit');
  get('reminders-answer').value = '1';
  await get('reminders-gate').emit('submit');
  await get('reminders-settings').emit('submit');
  assert.equal(get('reminders-settings').hidden, true);
  assert.match(get('reminders-gate-error').textContent, /nicht/);
  assert.equal(reminders.isEnabled(), false);
  assert.equal(calls.schedule.length, 0);
  assert.equal(calls.request, 0);
});

test('reminder settings: adult enables a localized daily reminder at the selected time', async () => {
  const { get, calls, unlock, reminders } = await setup({ permission: 'prompt', lang: 'en' });
  await unlock();
  get('reminders-enabled').checked = true;
  get('reminders-time').value = '08:15';
  await get('reminders-settings').emit('submit');
  assert.equal(reminders.isEnabled(), true);
  assert.equal(calls.request, 1);
  const notification = calls.schedule[0].notifications[0];
  assert.deepEqual(notification.schedule.on, { hour: 8, minute: 15 });
  assert.equal(notification.schedule.isExactNotification, false);
  assert.equal(notification.title, 'Letter time');
  assert.equal(notification.body, 'Time for a little reading practice.');
  assert.equal(get('reminders-status').textContent, t('en', 'reminders.status.scheduled'));
});

test('reminder settings: closing or backgrounding locks the gate again', async () => {
  const { get, unlock, doc, calls } = await setup();
  await unlock();
  get('reminders-dialog').close();
  await get('open-reminders').emit('click');
  assert.equal(get('reminders-answer').value, '');
  assert.equal(get('reminders-settings').hidden, true);
  await unlock();
  doc.hidden = true;
  await doc.emit('visibilitychange');
  assert.equal(get('reminders-dialog').open, false);
  get('reminders-enabled').checked = true;
  await get('reminders-settings').emit('submit');
  assert.equal(calls.schedule.length, 0);
});

test('reminder settings: the OS permission prompt does not close the dialog mid-save', async () => {
  const { get, unlock, doc, calls, resolvePermission } = await setup({ permission: 'prompt', deferPermission: true });
  await unlock();
  get('reminders-enabled').checked = true;
  get('reminders-time').value = '08:15';
  const saving = get('reminders-settings').emit('submit');
  // The native permission prompt backgrounds the app while the save is in flight.
  doc.hidden = true;
  await doc.emit('visibilitychange');
  assert.equal(get('reminders-dialog').open, true, 'the dialog must stay open while saving');
  resolvePermission();
  await saving;
  assert.equal(calls.schedule.length, 1);
  assert.equal(get('reminders-status').textContent, t('de', 'reminders.status.scheduled'));
});

test('reminder settings: denial is visible and repeated saves never reprompt', async () => {
  const { get, calls, unlock } = await setup({ permission: 'prompt', requestResult: 'denied' });
  await unlock();
  get('reminders-enabled').checked = true;
  get('reminders-time').value = '17:00';
  await get('reminders-settings').emit('submit');
  await get('reminders-settings').emit('submit');
  assert.equal(calls.request, 1);
  assert.equal(calls.schedule.length, 0);
  assert.equal(get('reminders-status').textContent, t('de', 'reminders.status.denied'));
});

test('reminder settings: cold start restores the chosen time without a permission prompt', async () => {
  const first = await setup();
  await first.unlock();
  first.get('reminders-enabled').checked = true;
  first.get('reminders-time').value = '07:45';
  await first.get('reminders-settings').emit('submit');
  const second = await setup({ store: first.store });
  assert.equal(second.calls.request, 0);
  assert.deepEqual(second.calls.schedule[0].notifications[0].schedule.on, { hour: 7, minute: 45 });
  await second.get('open-reminders').emit('click');
  assert.equal(second.get('reminders-time').value, '07:45');
  assert.equal(second.get('reminders-enabled').checked, true);
});

test('reminder settings: disabling cancels and clears the daily schedule', async () => {
  const { get, unlock, reminders, calls, store } = await setup();
  await unlock();
  get('reminders-enabled').checked = true;
  get('reminders-time').value = '17:00';
  await get('reminders-settings').emit('submit');
  get('reminders-enabled').checked = false;
  await get('reminders-settings').emit('submit');
  assert.equal(calls.cancel, 1);
  assert.equal(reminders.isEnabled(), false);
  assert.equal(store.has(REMINDERS_SCHEDULE_KEY), false);
  assert.equal(get('reminders-status').textContent, t('de', 'reminders.status.off'));
});

test('reminder settings: cancellation failure is not displayed as disabled success', async () => {
  const first = await setup();
  await first.unlock();
  first.get('reminders-enabled').checked = true;
  first.get('reminders-time').value = '17:00';
  await first.get('reminders-settings').emit('submit');
  const second = await setup({ store: first.store, failCancel: true });
  await second.unlock();
  second.get('reminders-enabled').checked = false;
  await second.get('reminders-settings').emit('submit');
  assert.equal(second.reminders.isEnabled(), true);
  assert.equal(second.store.has(REMINDERS_SCHEDULE_KEY), true);
  assert.equal(second.get('reminders-enabled').checked, true);
  assert.equal(second.get('reminders-status').textContent, t('de', 'reminders.status.failed'));
});

test('reminder settings: scheduling errors are visible, not successful', async () => {
  const { get, unlock, store } = await setup({ failSchedule: true });
  await unlock();
  get('reminders-enabled').checked = true;
  get('reminders-time').value = '17:00';
  await get('reminders-settings').emit('submit');
  assert.equal(store.has(REMINDERS_SCHEDULE_KEY), false);
  assert.equal(get('reminders-status').textContent, t('de', 'reminders.status.failed'));
});

test('reminder settings: the actual app imports and mounts the native-only controls', async () => {
  const html = await readFile(new URL('../static/index.html', import.meta.url), 'utf8');
  assert.match(html, /import \{ mountReminderSettings \} from '\.\/reminder-settings\.mjs'/);
  assert.match(html, /mountReminderSettings\(\{[\s\S]*?reminders: window\.__platform\.reminders/);
  assert.match(html, /id="reminders-settings" hidden/);
  assert.match(html, /id="open-reminders"[^>]+hidden/);
});
