// Three-slot ability bar (wind, storm, earth) for the gameplay HUD. The slots
// render as three centred circles under the portrait sword row.
//
// The widget is deliberately clock-free: callers pass the current level,
// cooldown progress and the earned bonus runtime through update(), so the HUD
// never owns a timer. Cooldowns tick in the pure model (cooldown-abilities.js)
// only while the encounter is running; this module only renders what it is
// given. The second line of each slot spells out the bonus-aware readout
// (remaining seconds or "Ready", storm removals, earth slow strength and
// remaining targets) so a player can see what a level bonus changed.

import {
  ABILITY_ROSTER,
  FIEND_SPEED_FLOOR,
  FIEND_SPEED_STEP,
  SPIKE_SLOW_CAPS,
  SPIKE_SLOW_DEFAULTS,
} from './cooldown-abilities.js';
import { BONUS_CAPS } from './bonus-ladder.js';
import { abilityIconUrl } from './asset-preload.js';

export const ABILITY_BAR_ID = 'ability-bar';
export const ABILITY_SLOT_CLASS = 'ability-slot';
export const ABILITY_READOUT_CLASS = 'ability-slot-readout';

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

const READY_FALLBACK = 'Ready';

const READOUT_FALLBACKS = Object.freeze({
  storm: 'Removes {count}',
  earth: 'Slow {percent}% · ×{targets}',
});

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function wholeCount(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function interpolate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (match, name) => (
    Object.hasOwn(vars, name) ? String(vars[name]) : match
  ));
}

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

// Each cooldown bonus names the ability it shortens, so the displayed total is
// the base cooldown minus that ability's own reduction, floored at the
// documented cap (180 s - 90 s = 90 s) and never above the base cooldown.
function effectiveCooldownSeconds(slot, cooldowns) {
  const reduction = clampNumber(cooldowns?.[slot.id], 0, BONUS_CAPS.cooldownSeconds, 0);
  const floor = slot.baseCooldownSeconds - BONUS_CAPS.cooldownSeconds;
  return Math.max(floor, slot.baseCooldownSeconds - reduction);
}

/**
 * Derive the bonus-aware readouts for the storm and earth slots.
 *
 * Everything comes from the pure models: the ability runtime carries the storm
 * rank and the live spike state, the bonus runtime carries the earned ladder
 * bonuses, and `spikeTargetsLeft` reports how many spawns the active spike can
 * still slow. Each value is clamped to the documented caps and falls back to
 * the level-1 default for missing or non-finite input, so the bar can never
 * render `NaN`, `Infinity` or a negative count.
 *
 * @param {object} [state]
 * @param {object} [state.runtime] ability runtime from cooldown-abilities.js
 * @param {object} [state.bonus] bonus runtime from bonus-ladder.js
 * @param {number} [state.spikeTargetsLeft] spawns the active spike can still slow
 * @returns {{ stormCount: number, stormRank: number, slowPercent: number, targets: number, totalTargets: number }}
 */
export function deriveAbilityReadouts({ runtime, bonus, spikeTargetsLeft } = {}) {
  const spike = runtime?.spikeState;
  const spikeActive = Boolean(spike?.active);
  const spikeFactor = clampNumber(
    spikeActive ? spike.factor : SPIKE_SLOW_DEFAULTS.factor,
    SPIKE_SLOW_CAPS.factorFloor,
    1,
    SPIKE_SLOW_DEFAULTS.factor,
  );
  const ladderSlowBonuses = wholeCount(bonus?.slowBonuses, 0, Number.MAX_SAFE_INTEGER, 0);
  const ladderMultiplier = Math.min(1, Math.max(FIEND_SPEED_FLOOR, 1 - FIEND_SPEED_STEP * ladderSlowBonuses));
  const passiveMultiplier = Math.min(clampNumber(runtime?.fiendSpeedMultiplier, FIEND_SPEED_FLOOR, 1, 1), ladderMultiplier);
  // The earth readout reports the slow the earth bonuses add up to: the spike
  // factor while a spike runs (the level-1 default otherwise, so the line never
  // flickers between casts) plus the passive slow each slowSpeed bonus bought.
  const slowPercent = wholeCount(
    Math.round((1 - spikeFactor) * 100 + (1 - passiveMultiplier) * 100),
    0,
    100,
    0,
  );

  const stormRank = Math.max(
    wholeCount(runtime?.rank, 0, BONUS_CAPS.stormRank, 0),
    wholeCount(bonus?.stormRank, 0, BONUS_CAPS.stormRank, 0),
  );
  const stormCount = 1 + stormRank;

  const spikeTargets = spikeActive ? wholeCount(spike.targets, 0, SPIKE_SLOW_CAPS.targets, 0) : 0;
  const ladderTargets = wholeCount(bonus?.spikeTargets, 0, SPIKE_SLOW_CAPS.targets, 0);
  const totalTargets = wholeCount(
    Math.max(spikeTargets, SPIKE_SLOW_DEFAULTS.targets + ladderTargets),
    1,
    SPIKE_SLOW_CAPS.targets,
    SPIKE_SLOW_DEFAULTS.targets,
  );
  const targets = spikeActive
    ? wholeCount(spikeTargetsLeft, 0, SPIKE_SLOW_CAPS.targets, totalTargets)
    : totalTargets;

  return Object.freeze({ stormCount, stormRank, slowPercent, targets, totalTargets });
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
 * @returns {{ element: HTMLElement, update: (state?: { level?: number, progress?: number | Record<string, number> | number[] | ((id: string) => number), runtime?: object | null, bonus?: object | null, cooldowns?: Record<string, number> | null, spikeTargetsLeft?: number }) => void, destroy: () => void }}
 */
export function createAbilityBar({ doc = globalThis.document, translate, onActivate } = {}) {
  const create = doc?.createElement?.bind(doc);
  if (!create) throw new TypeError('createAbilityBar requires a document');

  const label = (key, fallback, vars) => {
    const value = translate?.(key, vars);
    return typeof value === 'string' && value ? value : fallback;
  };

  // Unlike label(), a readout must not fall back to the raw key when the
  // dictionary misses an entry: t() returns the key itself in that case.
  const message = (key, fallback, vars) => {
    const value = translate?.(key, vars);
    if (typeof value === 'string' && value && value !== key) return value;
    return interpolate(fallback, vars);
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

    // Decorative artwork: the slot's label already names the ability, so the
    // image stays out of the accessibility tree (alt="") and is only requested
    // once the slot unlocks. A failed load leaves the visible name in place.
    const iconEl = create('img');
    iconEl.className = 'ability-slot-icon';
    iconEl.setAttribute('alt', '');
    iconEl.setAttribute('decoding', 'async');
    iconEl.hidden = true;

    const nameEl = create('span');
    nameEl.className = 'ability-slot-name';
    const descriptionEl = create('span');
    descriptionEl.className = 'ability-slot-description';
    descriptionEl.id = `${ABILITY_BAR_ID}-${ability.id}-description`;
    const cooldownEl = create('span');
    cooldownEl.className = 'ability-slot-cooldown';
    cooldownEl.setAttribute('aria-hidden', 'true');
    const readoutEl = create('span');
    readoutEl.className = ABILITY_READOUT_CLASS;
    readoutEl.setAttribute('aria-hidden', 'true');

    button.appendChild(iconEl);
    button.appendChild(nameEl);
    button.appendChild(descriptionEl);
    button.appendChild(cooldownEl);
    button.appendChild(readoutEl);
    button.setAttribute('aria-describedby', descriptionEl.id);

    const slot = {
      id: ability.id,
      index,
      unlockLevel: ability.unlockLevel,
      baseCooldownSeconds: ability.baseCooldownSeconds,
      button,
      iconEl,
      nameEl,
      descriptionEl,
      cooldownEl,
      readoutEl,
      state: 'locked',
      iconState: 'idle',
      iconRequested: false,
      name: '',
      description: '',
      cooldownText: null,
      readoutText: null,
      ariaLabel: '',
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

    iconEl.addEventListener?.('load', () => {
      slot.iconState = 'loaded';
      iconEl.hidden = slot.state === 'locked';
      if (slot.state !== 'locked') button.dataset.icon = 'loaded';
    });
    iconEl.addEventListener?.('error', () => {
      slot.iconState = 'error';
      iconEl.hidden = true;
      if (slot.state !== 'locked') button.dataset.icon = 'error';
    });
    return slot;
  });

  for (const slot of slots) element.appendChild(slot.button);

  // The circles belong to the answer zone, directly under the portrait sword
  // row, so the gameplay header keeps its size. The `order` values in the
  // stylesheet fix the visual sequence no matter which module mounts first.
  const answerZone = doc.getElementById?.('input-zone');
  const anchor = answerZone ? doc.getElementById?.('mc-buttons') : null;
  if (anchor && answerZone.insertBefore) answerZone.insertBefore(element, anchor);
  else if (answerZone?.appendChild) answerZone.appendChild(element);
  else {
    const chrome = doc.getElementById?.('gameplay-chrome');
    if (chrome?.appendChild) chrome.appendChild(element);
  }

  function applySlot(slot, level, progress, readouts, cooldowns) {
    const unlocked = level >= slot.unlockLevel;
    const state = !unlocked ? 'locked' : progress >= 1 ? 'ready' : 'cooling';
    const fallback = FALLBACKS[slot.id];
    const name = label(`ability.${slot.id}.name`, fallback.name);
    const description = label(`ability.${slot.id}.description`, fallback.description);
    const seconds = state === 'cooling'
      ? Math.ceil((1 - progress) * effectiveCooldownSeconds(slot, cooldowns))
      : 0;

    if (slot.name !== name) {
      slot.name = name;
      slot.nameEl.textContent = name;
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

    // Locked slots stay a dimmed silhouette: no artwork and no icon state, so
    // the CSS keeps the localized name visible. The URL is requested on the
    // first unlock only; the cached result survives a later relock.
    if (state === 'locked') {
      slot.iconEl.hidden = true;
      delete slot.button.dataset.icon;
    } else {
      if (!slot.iconRequested) {
        slot.iconRequested = true;
        slot.iconEl.src = abilityIconUrl(slot.id);
      }
      slot.iconEl.hidden = slot.iconState !== 'loaded';
      if (slot.iconState !== 'idle') slot.button.dataset.icon = slot.iconState;
    }

    const cooldownText = state === 'locked'
      ? ''
      : state === 'cooling'
        ? String(seconds)
        : message('ability.slot.ready', READY_FALLBACK);
    if (slot.cooldownText !== cooldownText) {
      slot.cooldownText = cooldownText;
      slot.cooldownEl.textContent = cooldownText;
    }

    // The readout spells out what the earned bonuses changed for this slot.
    // Locked slots stay blank; the numbers are already clamped by
    // deriveAbilityReadouts(), so this only picks the localized template.
    let readoutText = '';
    if (state !== 'locked' && slot.id === 'storm') {
      readoutText = message('ability.storm.readout', READOUT_FALLBACKS.storm, { count: readouts.stormCount });
    } else if (state !== 'locked' && slot.id === 'earth') {
      readoutText = message('ability.earth.readout', READOUT_FALLBACKS.earth, {
        percent: readouts.slowPercent,
        targets: readouts.targets,
      });
    }
    if (slot.readoutText !== readoutText) {
      slot.readoutText = readoutText;
      slot.readoutEl.textContent = readoutText;
    }

    // The readout line is aria-hidden so it never announces every cooldown
    // second, but its bonus facts belong in the slot's name: it only changes at
    // a level start, so the accessible name stays stable while playing.
    const ariaLabel = readoutText ? `${name}, ${readoutText}` : name;
    if (slot.ariaLabel !== ariaLabel) {
      slot.ariaLabel = ariaLabel;
      slot.button.setAttribute('aria-label', ariaLabel);
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
   * treated as ready (1). `runtime`, `bonus`, `cooldowns` and
   * `spikeTargetsLeft` are the optional pure-model inputs behind the
   * bonus-aware readouts; omitting them renders the level-1 defaults.
   */
  function update({
    level = 1,
    progress = 1,
    runtime = null,
    bonus = null,
    cooldowns = null,
    spikeTargetsLeft,
  } = {}) {
    const currentLevel = Number(level);
    const safeLevel = Number.isFinite(currentLevel) ? currentLevel : 1;
    const readouts = deriveAbilityReadouts({ runtime, bonus, spikeTargetsLeft });
    for (const slot of slots) {
      applySlot(slot, safeLevel, progressFor(progress, slot.id, slot.index), readouts, cooldowns);
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
