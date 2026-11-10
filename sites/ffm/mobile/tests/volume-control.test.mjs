// volume-control.test.mjs — the app-only top-bar gain control.
//
// volume-control.js ships through the app overlay as www/game/volume-control.js
// and is imported by main.js only behind platform.isApp. These tests drive the
// real AudioEngine with a fake Web Audio context: they prove applied music and
// effects gain at 0, 0.2 and 1, preference persistence, the omitted music
// slider plus DE/EN explanation when routing is unavailable, and the app-only
// wiring/accessibility contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioEngine } from '../../static/game/audio.js';
import {
  AUDIO_PREFERENCES_KEY,
  readAudioPreferences,
  writeAudioPreferences,
} from '../../static/game/audio-preferences.js';
import { setLocale, t } from '../../static/game/i18n.js';
import {
  EFFECTS_VOLUME_INPUT_ID,
  MUSIC_VOLUME_INPUT_ID,
  VOLUME_CONTROL_STATUS_ID,
  createVolumeControl,
} from '../game/volume-control.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(root, '..', 'static');

function makeElement(tagName) {
  const element = {
    tagName: String(tagName).toUpperCase(),
    className: '',
    id: '',
    textContent: '',
    value: '',
    children: [],
    attributes: {},
    listeners: new Map(),
    parentNode: null,
    get nextSibling() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.children;
      const index = siblings.indexOf(this);
      return index >= 0 ? siblings[index + 1] ?? null : null;
    },
    setAttribute(name, value) {
      element.attributes[name] = String(value);
      if (name === 'id') element.id = String(value);
    },
    getAttribute(name) {
      return element.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete element.attributes[name];
    },
    appendChild(child) {
      child.parentNode?.removeChild(child);
      child.parentNode = element;
      element.children.push(child);
      return child;
    },
    insertBefore(child, reference) {
      child.parentNode?.removeChild(child);
      child.parentNode = element;
      const index = reference ? element.children.indexOf(reference) : -1;
      if (index >= 0) element.children.splice(index, 0, child);
      else element.children.push(child);
      return child;
    },
    removeChild(child) {
      const index = element.children.indexOf(child);
      if (index >= 0) element.children.splice(index, 1);
      child.parentNode = null;
    },
    remove() {
      element.parentNode?.removeChild(element);
    },
    addEventListener(type, handler) {
      const handlers = element.listeners.get(type) ?? [];
      handlers.push(handler);
      element.listeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      const handlers = element.listeners.get(type) ?? [];
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    },
    dispatch(type) {
      for (const handler of [...(element.listeners.get(type) ?? [])]) {
        handler({ target: element, type });
      }
    },
  };
  return element;
}

function findById(node, id) {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function findAll(node, tagName, found = []) {
  if (node.tagName === tagName) found.push(node);
  for (const child of node.children ?? []) findAll(child, tagName, found);
  return found;
}

function fakeDocument() {
  const topBar = makeElement('div');
  topBar.id = 'top-bar';
  const muteBtn = makeElement('button');
  muteBtn.id = 'mute-btn';
  topBar.appendChild(muteBtn);
  return {
    topBar,
    muteBtn,
    doc: {
      createElement: tagName => makeElement(tagName),
      getElementById: id => findById(topBar, id),
    },
  };
}

function fakeContext() {
  const param = () => ({
    value: 0,
    setValueAtTime(value) { this.value = value; },
    exponentialRampToValueAtTime() {},
  });
  const node = () => ({
    connections: [],
    connect(target) { this.connections.push(target); },
    disconnect() { this.connections = []; },
    gain: param(),
    frequency: param(),
    Q: param(),
  });
  return {
    currentTime: 0,
    sampleRate: 1000,
    state: 'suspended',
    destination: node(),
    resume() { this.state = 'running'; return Promise.resolve(); },
    createGain: () => node(),
    createDynamicsCompressor: () => Object.assign(node(),
      Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release']
        .map(key => [key, param()]))),
    createMediaElementSource: () => node(),
    createOscillator: () => Object.assign(node(), { start() {}, stop() {} }),
    createBufferSource: () => Object.assign(node(), { start() {} }),
    createBuffer: (_, length) => ({ getChannelData: () => new Float32Array(length) }),
    createBiquadFilter: () => node(),
  };
}

function fakeAudioElement(state) {
  return {
    src: '', currentTime: 0, volume: 1, muted: false, loop: false, preload: '',
    play() { state.plays++; return Promise.resolve(); },
    pause() {},
    addEventListener() {},
    removeEventListener() {},
  };
}

function routedEngine({ start = true } = {}) {
  const state = { plays: 0 };
  const audio = new AudioEngine({
    tracks: [{ file: 'a.mp3' }],
    baseUrl: 'https://localhost/game/',
    musicGainRouting: true,
    makeContext: fakeContext,
    makeAudio: () => fakeAudioElement(state),
  });
  if (start) audio.startBGM();
  return { audio, state };
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('the control applies real music and effects gain at 0, 0.2 and 1 and persists it', () => {
  const { doc, topBar, muteBtn } = fakeDocument();
  const { audio } = routedEngine();
  assert.deepEqual(audio.musicVolumeCapability, { supported: true, status: 'available' });

  const storage = memoryStorage();
  const control = createVolumeControl({
    doc,
    audio,
    translate: key => key,
    persist: () => writeAudioPreferences(storage, audio),
  });

  assert.deepEqual(topBar.children, [control.element], 'only one speaker remains in the top bar');
  assert.ok(control.element.children[1].children.includes(muteBtn), 'mute moves into the speaker menu');
  assert.ok(control.musicInput, 'a supported route offers the music slider');
  assert.ok(control.effectsInput);

  for (const value of [0, 0.2, 1]) {
    control.musicInput.value = String(value);
    control.musicInput.dispatch('input');
    assert.equal(audio._musicBus.gain.value, value, `music bus gain at ${value}`);
    assert.equal(JSON.parse(storage.getItem(AUDIO_PREFERENCES_KEY)).music, value,
      `persisted music gain at ${value}`);
  }

  for (const value of [0, 0.2, 1]) {
    control.effectsInput.value = String(value);
    control.effectsInput.dispatch('input');
    assert.equal(audio._effectsBus.gain.value, value * 0.4,
      `effects bus keeps its 0.4 headroom at ${value}`);
  }
  assert.equal(JSON.parse(storage.getItem(AUDIO_PREFERENCES_KEY)).effects, 1);

  const saved = readAudioPreferences(storage);
  assert.deepEqual(saved, { effects: 1, music: 1, muted: false },
    'the chosen values round-trip through the preferences seam');
});

test('an unavailable gain path omits the music slider and explains it in DE and EN', () => {
  const { doc } = fakeDocument();
  const audio = new AudioEngine({
    tracks: [{ file: 'a.mp3' }],
    baseUrl: null,
    makeAudio: () => fakeAudioElement({ plays: 0 }),
  });
  audio._ensureCtx = () => {};
  assert.equal(audio.musicVolumeCapability.supported, false);

  setLocale('en', { persist: false });
  const control = createVolumeControl({ doc, audio, translate: t });

  assert.equal(control.musicAvailable, false);
  assert.equal(control.musicInput, null, 'no interactive music slider');
  assert.equal(doc.getElementById(MUSIC_VOLUME_INPUT_ID), null);
  assert.equal(control.status.textContent, t('audio.musicVolumeUnavailable'));
  assert.match(control.status.textContent, /disabled|not available/i);
  assert.ok(control.effectsInput, 'effects remain controllable');

  setLocale('de', { persist: false });
  control.refresh();
  assert.equal(control.status.textContent, t('audio.musicVolumeUnavailable'));
  assert.match(control.status.textContent, /nicht einstellbar/i);
  assert.equal(control.musicInput, null, 'refresh keeps the dead slider out');
  setLocale('en', { persist: false });
});

test('the music slider accepts a saved gain before the first track is played', () => {
  const { doc } = fakeDocument();
  const { audio } = routedEngine({ start: false });
  const control = createVolumeControl({ doc, audio, translate: key => key });

  assert.ok(control.musicInput);
  control.musicInput.value = '0.2';
  control.musicInput.dispatch('input');
  assert.equal(audio.getMusicVolume(), 0.2);
  assert.equal(control.element.getAttribute('data-music-available'), 'true');

  audio.startBGM();
  assert.equal(audio.musicVolumeCapability.supported, true);
  assert.equal(audio._musicBus.gain.value, 0.2);
  control.refresh();
  assert.ok(control.musicInput);
  assert.equal(control.element.getAttribute('data-music-available'), 'true');
});

test('destroy restores the original mute button without losing its handlers', () => {
  const { doc, topBar, muteBtn } = fakeDocument();
  let muted = false;
  muteBtn.addEventListener('click', () => { muted = !muted; });
  const control = createVolumeControl({ doc, audio: routedEngine().audio });
  muteBtn.dispatch('click');
  assert.equal(muted, true);
  control.destroy();
  assert.deepEqual(topBar.children, [muteBtn]);
  muteBtn.dispatch('click');
  assert.equal(muted, false);
});

test('mute zeroes the buses without losing the chosen slider gains', () => {
  const { doc } = fakeDocument();
  const { audio } = routedEngine();
  const control = createVolumeControl({ doc, audio, translate: key => key });

  control.musicInput.value = '0.2';
  control.musicInput.dispatch('input');
  control.effectsInput.value = '0.6';
  control.effectsInput.dispatch('input');

  audio.setMuted(true);
  assert.equal(audio._musicBus.gain.value, 0);
  assert.equal(audio._effectsBus.gain.value, 0);
  control.refresh();
  assert.equal(control.musicInput.value, '0.2', 'the chosen music gain survives mute');
  assert.equal(control.effectsInput.value, '0.6', 'the chosen effects gain survives mute');

  audio.setMuted(false);
  assert.equal(audio._musicBus.gain.value, 0.2);
  assert.equal(audio._effectsBus.gain.value, 0.6 * 0.4);
});

test('the control is keyboard and screen-reader accessible with 44px targets', async () => {
  const { doc } = fakeDocument();
  const { audio } = routedEngine();
  const control = createVolumeControl({ doc, audio, translate: t });

  assert.equal(control.summary.tagName, 'SUMMARY', 'native disclosure keyboard handling');
  assert.equal(control.summary.getAttribute('aria-label'), t('audio.settings'));
  assert.equal(control.status.id, VOLUME_CONTROL_STATUS_ID);
  assert.equal(control.status.getAttribute('role'), 'status');

  for (const input of [control.musicInput, control.effectsInput]) {
    assert.equal(input.getAttribute('type'), 'range');
    assert.equal(input.getAttribute('min'), '0');
    assert.equal(input.getAttribute('max'), '1');
    assert.equal(input.getAttribute('step'), '0.05');
    assert.equal(input.getAttribute('aria-describedby'), VOLUME_CONTROL_STATUS_ID);
    const label = findAll(control.element, 'LABEL').find(node => node.getAttribute('for') === input.id);
    assert.ok(label, `${input.id} has a programmatic label`);
    assert.ok(label.textContent.length > 0);
  }
  assert.equal(doc.getElementById(MUSIC_VOLUME_INPUT_ID).id, MUSIC_VOLUME_INPUT_ID);
  assert.equal(doc.getElementById(EFFECTS_VOLUME_INPUT_ID).id, EFFECTS_VOLUME_INPUT_ID);

  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');
  assert.match(css, /\.app-audio-control\s*>\s*summary\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.app-audio-control-row\s+input\[type="range"\]\s*\{[^}]*min-height:\s*44px/s);
});

test('the control ships only through the app overlay and main.js mounts it behind platform.isApp', async () => {
  const source = await readFile(join(staticDir, 'game', 'main.js'), 'utf8');
  const appStart = source.indexOf('if (platform.isApp) {');
  assert.ok(appStart >= 0);
  const appEnd = source.indexOf('\n}\n', appStart);
  assert.ok(appEnd > appStart);
  const appBlock = source.slice(appStart, appEnd + 2);

  assert.equal((source.match(/import\('\.\/volume-control\.js'\)/g) ?? []).length, 1);
  assert.match(appBlock, /import\('\.\/volume-control\.js'\)/,
    'only the app branch may import the control');
  assert.doesNotMatch(source.replace(appBlock, ''), /import\('\.\/volume-control\.js'\)/,
    'the web path never requests the overlay module');
  assert.doesNotMatch(source, /from '\.\/volume-control\.js'/,
    'the web build must not statically import it');
  assert.match(appBlock, /createVolumeControl\(\{[\s\S]*?audio,[\s\S]*?persist: persistAudioPreferences/,
    'the control is wired to the real engine and the existing preferences seam');

  await assert.rejects(
    stat(join(staticDir, 'game', 'volume-control.js')),
    { code: 'ENOENT' },
    'the module must ship only through the app overlay',
  );
  const html = await readFile(join(staticDir, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /volume-control|app-audio-control/,
    'the web top bar keeps no app-only control');
});

test('the mobile README records the physical-device gates and the revision to test', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  for (const gate of [
    /audible/i,
    /live gain at 0, 0\.2 and 1/i,
    /silent switch/i,
    /interruption/i,
    /background\/foreground/i,
  ]) {
    assert.match(readme, gate);
  }
  assert.match(readme, /Revision to test:\s*`<revision>`/);
});
