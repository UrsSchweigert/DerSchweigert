// Three-slot ability bar (wind, storm, earth) for the gameplay HUD.
//
// The widget is deliberately clock-free: callers pass the current level and
// cooldown progress through update(), so the HUD never owns a timer. Cooldowns
// tick in the pure model (cooldown-abilities.js) only while the encounter is
// running; this module only renders what it is given.

import { ABILITY_ROSTER } from './cooldown-abilities.js';

export const ABILITY_BAR_ID = 'ability-bar';
export const ABILITY_SLOT_CLASS = 'ability-slot';

// English fallbacks keep the bar readable when a caller passes no translator
// (for example a lightweight test double). The i18n dictionary is the real
// source for every shipped string.
const FALLBACKS = Object.freeze({
  wind: Object.freeze({
    name: 'Wind',
    description: 'Removes the active enemy from the encounter.',
  }),
  storm: Object.freeze({
    name: 'Storm',
    description: 'Clears a capped slice of the enemy wave.',
  }),
  earth: Object.freeze({
    name: 'Earth',
    description: 'Spikes slow the active fiend and the next spawns.',
  }),
});

function clampProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(1, Math.max(0, number));
}

function progressFor(progress, id, index) {
  if (typeof progress === 'function') return clampProgress(progress(id));
  if (Array.isArray(progress)) return clampProgress(progress[index]);
  if (progress && typeof progress === 'object') return clampProgress(progress[id]);
  return clampProgress(progress);
}

/**
 * Build the ability bar inside `#gameplay-chrome`.
 *
 * Each slot is a native button: locked slots are disabled and leave the tab
 * order (`aria-disabled="true"`, `tabIndex = -1`), unlocked slots are focusable
 * and activate on click, Enter or Space. A slot is ready at progress 1 and
 * cooling below it; cooling slots show the remaining whole seconds and publish
 * their 0-1 progress as the `--ability-progress` custom property.
 *
 * @param {object} [options]
 * @param {Document} [options.doc]
 * @param {(key: string, vars?: object) => string} [options.translate]
 * @param {(id: 'wind' | 'storm' | 'earth') => void} [options.onActivate]
 * @returns {{ element: HTMLElement, update: (state?: { level?: number, progress?: number | Record<string, number> | number[] | ((id: string) => number) }) => void, destroy: () => void }}
 */
export function createAbilityBar({ doc = globalThis.document, translate, onActivate } = {}) {
  const create = doc?.createElement?.bind(doc);
  if (!create) throw new TypeError('createAbilityBar requires a document');

  const label = (key, fallback, vars) => {
    const value = translate?.(key, vars);
    return typeof value === 'string' && value ? value : fallback;
  };

  const element = create('div');
  element.id = ABILITY_BAR_ID;
  element.className = 'ability-bar';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', label('ability.barLabel', 'Abilities'));

  const slots = ABILITY_ROSTER.map((ability, index) => {
    const fallback = FALLBACKS[ability.id];
    const button = create('button');
    button.type = 'button';
    button.className = ABILITY_SLOT_CLASS;
    button.dataset.ability = ability.id;
    button.dataset.state = 'locked';
    button.disabled = true;
    button.tabIndex = -1;
    button.setAttribute('aria-disabled', 'true');

    const nameEl = create('span');
    nameEl.className = 'ability-slot-name';
    const descriptionEl = create('span');
    descriptionEl.className = 'ability-slot-description';
    descriptionEl.id = `${ABILITY_BAR_ID}-${ability.id}-description`;
    const cooldownEl = create('span');
    cooldownEl.className = 'ability-slot-cooldown';
    cooldownEl.setAttribute('aria-hidden', 'true');

    button.appendChild(nameEl);
    button.appendChild(descriptionEl);
    button.appendChild(cooldownEl);
    button.setAttribute('aria-describedby', descriptionEl.id);

    const slot = {
      id: ability.id,
      index,
      unlockLevel: ability.unlockLevel,
      baseCooldownSeconds: ability.baseCooldownSeconds,
      button,
      nameEl,
      descriptionEl,
      cooldownEl,
      state: 'locked',
      name: '',
      description: '',
      cooldownText: null,
      sweep: null,
      onClick: null,
      onKeyDown: null,
    };

    const activate = () => {
      if (slot.state !== 'ready') return;
      if (typeof onActivate === 'function') onActivate(slot.id);
    };
    slot.onClick = () => activate();
    slot.onKeyDown = (event) => {
      const key = event?.key;
      if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar' && key !== 'Space') return;
      if (event.repeat) return;
      event.preventDefault?.();
      activate();
    };
    button.addEventListener?.('click', slot.onClick);
    button.addEventListener?.('keydown', slot.onKeyDown);
    return slot;
  });

  for (const slot of slots) element.appendChild(slot.button);

  const chrome = doc.getElementById?.('gameplay-chrome');
  if (chrome?.appendChild) chrome.appendChild(element);

  function applySlot(slot, level, progress) {
    const unlocked = level >= slot.unlockLevel;
    const state = !unlocked ? 'locked' : progress >= 1 ? 'ready' : 'cooling';
    const fallback = FALLBACKS[slot.id];
    const name = label(`ability.${slot.id}.name`, fallback.name);
    const description = label(`ability.${slot.id}.description`, fallback.description);
    const seconds = state === 'cooling'
      ? Math.ceil((1 - progress) * slot.baseCooldownSeconds)
      : 0;

    if (slot.name !== name) {
      slot.name = name;
      slot.nameEl.textContent = name;
      slot.button.setAttribute('aria-label', name);
    }
    if (slot.description !== description) {
      slot.description = description;
      slot.descriptionEl.textContent = description;
      slot.button.title = description;
    }
    if (slot.state !== state) {
      slot.state = state;
      slot.button.dataset.state = state;
      slot.button.disabled = state === 'locked';
      slot.button.tabIndex = state === 'locked' ? -1 : 0;
      slot.button.setAttribute('aria-disabled', String(state === 'locked'));
    }

    const cooldownText = state === 'cooling' ? String(seconds) : '';
    if (slot.cooldownText !== cooldownText) {
      slot.cooldownText = cooldownText;
      slot.cooldownEl.textContent = cooldownText;
    }

    const sweep = String(state === 'locked' ? 0 : progress);
    if (slot.sweep !== sweep) {
      slot.sweep = sweep;
      if (slot.button.style?.setProperty) {
        slot.button.style.setProperty('--ability-progress', sweep);
      } else if (slot.button.style) {
        slot.button.style['--ability-progress'] = sweep;
      }
    }
  }

  /**
   * Render the current level and cooldown progress. `progress` may be one
   * number for every slot, a map/array keyed by ability, or a function
   * `id => progress`; every value is clamped to 0-1 and missing values are
   * treated as ready (1).
   */
  function update({ level = 1, progress = 1 } = {}) {
    const currentLevel = Number(level);
    const safeLevel = Number.isFinite(currentLevel) ? currentLevel : 1;
    for (const slot of slots) {
      applySlot(slot, safeLevel, progressFor(progress, slot.id, slot.index));
    }
  }

  function destroy() {
    for (const slot of slots) {
      slot.button.removeEventListener?.('click', slot.onClick);
      slot.button.removeEventListener?.('keydown', slot.onKeyDown);
    }
    slots.length = 0;
    if (element.parentNode?.removeChild) element.parentNode.removeChild(element);
    else element.remove?.();
  }

  update({ level: 1, progress: 1 });
  return { element, update, destroy };
}
