// volume-control.js — App-only music/effects gain control in the app top bar.
//
// main.js loads this module only behind `platform.isApp`, chained after the
// mobile-ui overlay, so the web build never imports it and keeps its existing
// pause-menu audio settings untouched. The control wraps #mute-btn in one
// <details> speaker menu, with labelled range inputs
// for the effects bus and — only when the engine reports a supported route —
// the music bus. Values go straight to AudioEngine.setEffectsVolume and
// AudioEngine.setMusicVolume, then the caller persists them through the
// existing audio-preferences seam.
//
// When music gain routing is unavailable the module omits the music slider and
// shows the localized audio.musicVolumeUnavailable explanation, so the app
// never offers a dead control.

export const VOLUME_CONTROL_ID = 'app-audio-control';
export const VOLUME_CONTROL_CLASS = 'app-audio-control';
export const VOLUME_CONTROL_PANEL_CLASS = 'app-audio-control-panel';
export const VOLUME_CONTROL_ROW_CLASS = 'app-audio-control-row';
export const VOLUME_CONTROL_STATUS_ID = 'app-audio-volume-status';
export const MUSIC_VOLUME_INPUT_ID = 'app-music-volume';
export const EFFECTS_VOLUME_INPUT_ID = 'app-effects-volume';
export const VOLUME_CONTROL_ANCHOR_ID = 'mute-btn';
export const VOLUME_STEP = '0.05';

function finiteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function setAttributes(element, attributes) {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function setValue(element, value) {
  const next = String(value);
  if (element.value !== next) element.value = next;
}

function inertControl() {
  return {
    element: null,
    summary: null,
    status: null,
    get musicInput() { return null; },
    get effectsInput() { return null; },
    get musicAvailable() { return false; },
    refresh: () => ({ music: false, status: '' }),
    destroy: () => {},
  };
}

/**
 * Insert the app-only gain control after the existing mute button.
 *
 * @param {object} [options]
 * @param {Document} [options.doc]
 * @param {object} [options.audio] AudioEngine-like engine
 * @param {(key: string, vars?: object) => string} [options.translate]
 * @param {() => void} [options.persist] device-wide preferences writer
 * @param {(message: string, error: unknown) => void} [options.warn] error sink
 * @param {string} [options.anchorId] existing button to insert after
 * @returns {object} handle with refresh()/destroy() and the rendered inputs
 */
export function createVolumeControl({
  doc = globalThis.document,
  audio = null,
  translate = key => key,
  persist = () => {},
  warn = () => {},
  anchorId = VOLUME_CONTROL_ANCHOR_ID,
} = {}) {
  const anchor = doc?.getElementById?.(anchorId) ?? null;
  const parent = anchor?.parentNode ?? null;
  if (!anchor || !parent || typeof doc?.createElement !== 'function') return inertControl();
  const originalMuteText = anchor.textContent;

  const text = (key) => {
    const value = translate(key);
    return typeof value === 'string' && value ? value : key;
  };

  const details = doc.createElement('details');
  details.id = VOLUME_CONTROL_ID;
  details.className = VOLUME_CONTROL_CLASS;

  const summary = doc.createElement('summary');
  setAttributes(summary, { 'aria-label': text('audio.settings') });
  summary.textContent = '🔉';
  details.appendChild(summary);

  const panel = doc.createElement('div');
  panel.className = VOLUME_CONTROL_PANEL_CLASS;
  details.appendChild(panel);

  const status = doc.createElement('p');
  status.id = VOLUME_CONTROL_STATUS_ID;
  status.className = 'screen-status';
  setAttributes(status, { role: 'status' });

  function makeRow(kind, id, labelKey, apply) {
    const row = doc.createElement('div');
    row.className = VOLUME_CONTROL_ROW_CLASS;
    const label = doc.createElement('label');
    setAttributes(label, { for: id });
    label.textContent = text(labelKey);
    const input = doc.createElement('input');
    setAttributes(input, {
      id,
      type: 'range',
      min: '0',
      max: '1',
      step: VOLUME_STEP,
      'aria-describedby': VOLUME_CONTROL_STATUS_ID,
    });
    input.value = String(kind === 'music'
      ? finiteNumber(audio?.getMusicVolume?.(), 0.35)
      : finiteNumber(audio?.getEffectsVolume?.(), 1));
    input.addEventListener('input', () => {
      try {
        apply(Number(input.value));
        persist();
      } catch (error) {
        warn(`volume-control ${kind} input failed`, error);
        refresh();
      }
    });
    row.appendChild(label);
    row.appendChild(input);
    return { row, label, input, kind };
  }

  const effects = makeRow('effects', EFFECTS_VOLUME_INPUT_ID, 'audio.effectsVolume',
    value => audio?.setEffectsVolume?.(value));
  let music = null;

  function setMusicRow(available) {
    if (available && !music) {
      music = makeRow('music', MUSIC_VOLUME_INPUT_ID, 'audio.musicVolume',
        value => audio?.setMusicVolume?.(value));
      panel.insertBefore(music.row, status);
    } else if (!available && music) {
      music.row.remove?.();
      music = null;
    }
  }

  panel.appendChild(status);
  panel.appendChild(effects.row);

  function refresh() {
    const available = Boolean(audio?.musicVolumeCapability?.supported);
    setMusicRow(available);
    if (music) {
      setText(music.label, text('audio.musicVolume'));
      setValue(music.input, finiteNumber(audio?.getMusicVolume?.(), 0));
    }
    setText(effects.label, text('audio.effectsVolume'));
    setValue(effects.input, finiteNumber(audio?.getEffectsVolume?.(), 1));
    summary.setAttribute('aria-label', text('audio.settings'));
    summary.textContent = audio?.muted ? '🔇' : '🔊';
    const muteLabel = text(audio?.muted ? 'topbar.unmuteAriaLabel' : 'topbar.muteAriaLabel');
    anchor.textContent = muteLabel;
    anchor.setAttribute('aria-label', muteLabel);
    const message = text(available ? 'audio.musicVolumeReady' : 'audio.musicVolumeUnavailable');
    setText(status, message);
    details.setAttribute('data-music-available', String(available));
    return { music: available, status: message };
  }

  parent.insertBefore(details, anchor.nextSibling ?? null);
  panel.appendChild(anchor);
  details.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    details.open = false;
    summary.focus?.();
    event.stopPropagation();
  });
  // Re-read the engine whenever the menu opens so it never shows options from
  // an earlier routing state.
  details.addEventListener('toggle', () => {
    if (details.open) refresh();
  });
  refresh();

  return {
    element: details,
    summary,
    status,
    get musicInput() { return music?.input ?? null; },
    get effectsInput() { return effects.input; },
    get musicAvailable() { return music !== null; },
    refresh,
    destroy() {
      parent.insertBefore(anchor, details);
      anchor.textContent = originalMuteText;
      details.remove?.();
    },
  };
}
