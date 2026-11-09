import { PROFILE_NAME_LIMIT } from './profile-store.js';

const LABELS = {
  'profiles.create': 'New player',
  'profiles.rename': 'Rename',
  'profiles.delete': 'Delete',
  'profiles.name': 'Player name',
  'profiles.save': 'Save',
  'profiles.cancel': 'Cancel',
  'profiles.previous': 'Previous',
  'profiles.next': 'Next',
  'profiles.page': 'Page {page} of {pages}',
  'profiles.confirmDelete': 'Delete {name} and all their progress?',
  'profiles.confirm': 'Delete player',
  'profiles.switchBlocked': 'Finish the current game before changing players.',
  'profiles.storageError': 'Player data could not be saved. Please try again.',
  'profiles.invalidName': 'Enter a name of 1-40 characters.',
  'profiles.lastProfile': 'Keep at least one player.',
};

export function mountProfileUI({
  root, adapter, translate = (key) => LABELS[key], canSwitch = () => true,
  onSelected = () => {}, onError = () => {}, onBusyChange = () => {},
}) {
  if (!root?.ownerDocument) throw new TypeError('A profile UI root is required');
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  let profiles = [];
  let activeId = null;
  let page = 0;
  let stage = null;
  let busy = false;
  let pendingOperations = 0;
  const idleWaiters = new Set();
  let destroyed = false;
  let refreshVersion = 0;
  let message = '';
  const beginBusy = () => {
    pendingOperations++;
    if (!busy) {
      busy = true;
      onBusyChange(true);
    }
  };
  const endBusy = () => {
    pendingOperations--;
    if (pendingOperations === 0) {
      busy = false;
      onBusyChange(false);
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
    }
  };
  const pageSize = () => (view?.visualViewport?.height ?? view?.innerHeight ?? 800) < 400 ? 2 : 3;
  const text = (key, values = {}) => {
    let result = translate(key, values);
    if (typeof result !== 'string' || result === key) result = LABELS[key] ?? key;
    return result.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
  };
  const node = (tag, className, content) => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  };
  const report = (failure) => {
    const key = failure.code === 'invalid_profile_name' ? 'profiles.invalidName'
      : failure.code === 'last_profile' ? 'profiles.lastProfile'
        : failure.code === 'profile_switch_blocked' ? 'profiles.switchBlocked'
          : 'profiles.storageError';
    message = text(key);
    onError(failure);
  };
  const checkSwitch = () => {
    if (!canSwitch()) {
      throw Object.assign(new Error('Profile changes are blocked during a game'), { code: 'profile_switch_blocked' });
    }
  };
  const button = (label, action, { blocked = false, className = '', ariaLabel } = {}) => {
    const element = node('button', className, label);
    element.type = 'button';
    element.disabled = busy || (blocked && !canSwitch());
    if (ariaLabel) element.setAttribute('aria-label', ariaLabel);
    element.addEventListener('click', () => { void action(); });
    return element;
  };
  const action = async (operation, selected = false) => {
    if (destroyed || busy) return;
    let started = false;
    try {
      checkSwitch();
      started = true;
      beginBusy();
      message = '';
      render();
      await operation();
      if (destroyed) return;
      stage = null;
      await refresh();
      if (!destroyed && selected) await onSelected(adapter.getActiveProfile());
    } catch (failure) {
      if (!destroyed) report(failure);
    } finally {
      if (started) endBusy();
      if (!destroyed) render();
    }
  };
  const openStage = (next) => {
    if (destroyed || busy) return;
    try {
      checkSwitch();
      stage = next;
      message = '';
    } catch (failure) {
      report(failure);
    }
    render();
    root.querySelector('input')?.focus();
  };

  function render() {
    if (destroyed) return;
    const panel = node('div', 'profile-ui');
    const status = node('p', 'profile-status', message);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    if (stage?.type === 'create' || stage?.type === 'rename') {
      const form = node('form', 'profile-form');
      const label = node('label', '', text('profiles.name'));
      const input = node('input', 'profile-name-input');
      input.type = 'text';
      input.maxLength = PROFILE_NAME_LIMIT;
      input.required = true;
      input.autocomplete = 'off';
      input.value = stage.name ?? '';
      input.disabled = busy || !canSwitch();
      input.addEventListener('input', () => { stage.name = input.value; });
      label.append(input);
      const controls = node('div', 'profile-actions');
      const save = node('button', '', text('profiles.save'));
      save.type = 'submit';
      save.disabled = busy || !canSwitch();
      controls.append(save, button(text('profiles.cancel'), () => {
        stage = null; message = ''; render();
      }));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const captured = { ...stage, name: input.value };
        void action(() => captured.type === 'create'
          ? adapter.createProfile(captured.name)
          : adapter.renameProfile(captured.id, captured.name), true);
      });
      form.append(label, controls);
      panel.append(form);
    } else if (stage?.type === 'delete') {
      const confirmation = node('div', 'profile-confirmation');
      confirmation.append(node('p', '', text('profiles.confirmDelete', { name: stage.name })));
      const controls = node('div', 'profile-actions');
      const id = stage.id;
      controls.append(
        button(text('profiles.confirm'), () => action(
          () => adapter.deleteProfile(id, { confirmed: true }), true,
        ), { blocked: true }),
        button(text('profiles.cancel'), () => { stage = null; message = ''; render(); }),
      );
      confirmation.append(controls);
      panel.append(confirmation);
    } else {
      const size = pageSize();
      const pages = Math.max(1, Math.ceil(profiles.length / size));
      page = Math.min(page, pages - 1);
      const list = node('div', 'profile-list');
      for (const profile of profiles.slice(page * size, (page + 1) * size)) {
        const row = node('div', 'profile-row');
        const select = button(profile.name, () => action(() => adapter.selectProfile(profile.id), true), {
          blocked: true, className: 'profile-select',
        });
        select.setAttribute('aria-pressed', String(profile.id === activeId));
        row.append(select);
        if (typeof adapter.renameProfile === 'function') {
          row.append(button(text('profiles.rename'), () => openStage({ type: 'rename', ...profile }), {
            blocked: true, ariaLabel: `${text('profiles.rename')}: ${profile.name}`,
          }));
        }
        if (typeof adapter.deleteProfile === 'function') {
          const remove = button(text('profiles.delete'), () => openStage({ type: 'delete', ...profile }), {
            blocked: true, ariaLabel: `${text('profiles.delete')}: ${profile.name}`,
          });
          remove.disabled ||= profiles.length <= 1;
          row.append(remove);
        }
        list.append(row);
      }
      const controls = node('div', 'profile-actions');
      controls.append(button(text('profiles.create'), () => openStage({ type: 'create', name: '' }), { blocked: true }));
      const pagination = node('div', 'profile-pagination');
      const previous = button(text('profiles.previous'), () => { page--; render(); });
      previous.disabled ||= page <= 0;
      const next = button(text('profiles.next'), () => { page++; render(); });
      next.disabled ||= page >= pages - 1;
      const indicator = node('span', '', text('profiles.page', { page: page + 1, pages }));
      pagination.append(previous, indicator, next);
      controls.append(pagination);
      panel.append(list, controls);
    }
    panel.append(status);
    root.replaceChildren(panel);
  }

  async function refresh() {
    if (destroyed) return;
    const version = ++refreshVersion;
    beginBusy();
    render();
    try {
      const [listed, active] = await Promise.all([adapter.listProfiles(), adapter.getActiveProfile()]);
      if (destroyed || version !== refreshVersion) return;
      profiles = listed;
      activeId = active.id;
      if (stage && stage.type !== 'create' && !profiles.some((profile) => profile.id === stage.id)) stage = null;
    } catch (failure) {
      if (destroyed || version !== refreshVersion) return;
      report(failure);
    } finally {
      endBusy();
      if (!destroyed) render();
    }
  }
  const resize = () => {
    // Replacing an editing input on keyboard resize dismisses the iOS keyboard.
    if (stage?.type === 'create' || stage?.type === 'rename') return;
    render();
  };
  view?.addEventListener('resize', resize);
  view?.visualViewport?.addEventListener('resize', resize);
  render();
  void refresh();
  return {
    refresh,
    isBusy: () => busy,
    whenIdle: () => busy ? new Promise((resolve) => { idleWaiters.add(resolve); }) : Promise.resolve(),
    destroy() {
      destroyed = true;
      refreshVersion++;
      view?.removeEventListener('resize', resize);
      view?.visualViewport?.removeEventListener('resize', resize);
      root.replaceChildren();
    },
  };
}
