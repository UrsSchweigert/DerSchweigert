// car-audio-doc.test.mjs — keeps the code facts quoted in CAR-AUDIO.md true.
// Reads source files only; no device or car behaviour is tested.
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');
const docUrl = new URL('../CAR-AUDIO.md', import.meta.url);

test('document exists with the not-verified statement and headings', () => {
  assert.ok(existsSync(docUrl));
  const doc = read('../CAR-AUDIO.md');
  assert.match(doc, /Nothing was\s+tested on a device or in a car/);
  assert.match(doc, /owner supplied no connection, device or symptom details/);
  for (const heading of ['Code facts', 'Hypotheses (ranked)', 'Device test procedure',
    'Candidate fixes (all not implemented)', 'Symptom questions for the owner']) {
    assert.ok(doc.includes(`## ${heading}`), heading);
  }
  assert.match(doc, /restart of the app while connected/);
  assert.match(doc, /phone call or Siri/);
});

test('audio.js creates the context with default options and ignores route events', () => {
  const audio = read('../../static/game/audio.js');
  assert.match(audio, /\(\)\s*=>\s*new \(globalThis\.AudioContext \?\? globalThis\.webkitAudioContext\)\(\)/);
  assert.ok(!audio.includes('latencyHint'));
  assert.ok(!/sampleRate\s*:/.test(audio));
  assert.ok(!audio.includes('statechange'));
  assert.ok(!audio.includes('devicechange'));
  assert.match(audio, /createDynamicsCompressor/);
  assert.match(audio, /createMediaElementSource/);
  assert.match(read('../../static/game/music-loop.js'), /source\.loop = true/);
});

test('capacitor.config.json keeps the web inspector disabled', () => {
  const config = JSON.parse(read('../capacitor.config.json'));
  assert.equal(config.ios.webContentsDebuggingEnabled, false);
  assert.equal(config.android.webContentsDebuggingEnabled, false);
});
