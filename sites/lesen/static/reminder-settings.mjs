export function mountReminderSettings({ document, reminders, translate, random = Math.random }) {
  const byId = id => document.getElementById(id);
  const opener = byId('open-reminders');
  if (!reminders.isSupported()) {
    return { render() {}, ready: Promise.resolve() };
  }

  const dialog = byId('reminders-dialog');
  const gate = byId('reminders-gate');
  const settings = byId('reminders-settings');
  const answer = byId('reminders-answer');
  const enabled = byId('reminders-enabled');
  const time = byId('reminders-time');
  const save = byId('reminders-save');
  let unlocked = false;
  let expected = 0;
  let question = [0, 0];
  let status = reminders.status();
  let busy = true;
  let gateError = false;

  function render() {
    for (const [id, key] of [
      ['open-reminders-label', 'reminders.title'],
      ['reminders-title', 'reminders.title'],
      ['reminders-explanation', 'reminders.explanation'],
      ['reminders-answer-label', 'reminders.answer'],
      ['reminders-unlock', 'reminders.unlock'],
      ['reminders-enabled-label', 'reminders.enabled'],
      ['reminders-time-label', 'reminders.time'],
      ['reminders-save', 'reminders.save'],
      ['reminders-close', 'dialog.about.close'],
    ]) {
      byId(id).textContent = translate(key);
    }
    byId('reminders-question').textContent = translate('reminders.question')
      .replace('{a}', question[0]).replace('{b}', question[1]);
    byId('reminders-gate-error').textContent = gateError ? translate('reminders.gate_error') : '';
    byId('reminders-status').textContent = translate(`reminders.status.${status}`);
  }

  function showStatus(result) {
    status = ['off', 'scheduled', 'denied', 'failed', 'unsupported'].includes(result) ? result : 'failed';
    render();
  }

  function lock() {
    unlocked = false;
    gateError = false;
    answer.value = '';
    gate.hidden = false;
    settings.hidden = true;
    settings.querySelector('fieldset').disabled = true;
  }

  opener.hidden = false;
  opener.disabled = true;
  opener.addEventListener('click', () => {
    lock();
    question = [11 + Math.floor(random() * 9), 3 + Math.floor(random() * 7)];
    expected = question[0] * question[1];
    enabled.checked = reminders.isEnabled();
    const stored = reminders.settings();
    time.value = `${String(stored.hour).padStart(2, '0')}:${String(stored.minute).padStart(2, '0')}`;
    status = reminders.status();
    render();
    dialog.showModal();
    answer.focus();
  });
  gate.addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    if (answer.value.trim() === '' || Number(answer.value) !== expected) {
      gateError = true;
      render();
      answer.focus();
      return;
    }
    unlocked = true;
    gateError = false;
    gate.hidden = true;
    settings.hidden = false;
    settings.querySelector('fieldset').disabled = false;
    enabled.focus();
  });
  settings.addEventListener('submit', async event => {
    event.preventDefault();
    if (!unlocked || busy || !settings.reportValidity()) return;
    busy = true;
    save.disabled = true;
    try {
      await reminders.setEnabled(enabled.checked);
      if (enabled.checked) {
        const [hour, minute] = time.value.split(':').map(Number);
        showStatus(await reminders.schedule({
          hour, minute,
          title: translate('app.title'),
          body: translate('reminders.notification'),
        }));
      } else {
        showStatus('off');
      }
    } catch {
      enabled.checked = reminders.isEnabled();
      showStatus('failed');
    } finally {
      busy = false;
      save.disabled = false;
    }
  });
  byId('reminders-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', lock);
  document.addEventListener('visibilitychange', () => {
    // Keep the dialog open while a save is in flight: the native permission
    // prompt backgrounds the app (document.hidden) without closing our dialog.
    if (document.hidden && dialog.open && !busy) dialog.close();
  });
  render();
  const ready = reminders.restore()
    .then(showStatus, () => showStatus('failed'))
    .finally(() => { busy = false; opener.disabled = false; });
  return { render, ready };
}
