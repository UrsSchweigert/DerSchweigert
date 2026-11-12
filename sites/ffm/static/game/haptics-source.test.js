// haptics-source.test.js — driver resolution across web, plugin and no-op.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noopVibration, resolveVibrationSource } from './haptics-source.js';

function pluginRecorder() {
  const calls = [];
  return {
    calls,
    plugin: {
      vibrate(options) {
        calls.push(options);
        return Promise.resolve();
      },
    },
  };
}

test('navigator.vibrate is preferred on the web', async () => {
  const calls = [];
  const scope = {
    navigator: {
      vibrate(pattern) {
        calls.push(pattern);
        return true;
      },
    },
  };
  const resolved = await resolveVibrationSource({ scope, importModule: () => { throw new Error('unused'); } });
  assert.equal(resolved.source, 'web');
  resolved.vibrate([20]);
  assert.deepEqual(calls, [[20]]);
});

test('a throwing or rejecting navigator.vibrate is swallowed', async () => {
  const throwing = await resolveVibrationSource({
    scope: { navigator: { vibrate() { throw new Error('denied'); } } },
  });
  assert.equal(throwing.source, 'web');
  assert.equal(throwing.vibrate([20]), undefined);

  const rejecting = await resolveVibrationSource({
    scope: { navigator: { vibrate: () => Promise.reject(new Error('denied')) } },
  });
  assert.equal(rejecting.source, 'web');
  assert.equal(rejecting.vibrate([20]), undefined);
  await Promise.resolve();
  await Promise.resolve();
});

test('a bundled @capacitor/haptics module supplies the plugin driver', async () => {
  const { calls, plugin } = pluginRecorder();
  const resolved = await resolveVibrationSource({
    scope: {},
    importModule: () => Promise.resolve({ Haptics: plugin }),
  });
  assert.equal(resolved.source, 'plugin');
  resolved.vibrate([15, 50, 15]);
  assert.deepEqual(calls, [{ duration: 80 }]);
});

test('a module default export is accepted as the plugin', async () => {
  const { calls, plugin } = pluginRecorder();
  const resolved = await resolveVibrationSource({
    scope: {},
    importModule: async () => ({ default: { Haptics: plugin } }),
  });
  assert.equal(resolved.source, 'plugin');
  resolved.vibrate([12]);
  assert.deepEqual(calls, [{ duration: 12 }]);
});

test('the injected Capacitor plugin bridge is used when the import is absent', async () => {
  const { calls, plugin } = pluginRecorder();
  const resolved = await resolveVibrationSource({
    scope: { Capacitor: { Plugins: { Haptics: plugin } } },
    importModule: () => Promise.reject(new Error('not bundled')),
  });
  assert.equal(resolved.source, 'plugin');
  resolved.vibrate([20]);
  assert.deepEqual(calls, [{ duration: 20 }]);
});

test('an impact-only plugin still produces one call', async () => {
  const calls = [];
  const resolved = await resolveVibrationSource({
    scope: { Capacitor: { Plugins: { Haptics: { impact: options => calls.push(options) } } } },
  });
  assert.equal(resolved.source, 'plugin');
  resolved.vibrate([20]);
  assert.deepEqual(calls, [{ style: 'MEDIUM' }]);
});

test('a rejected import falls through to the no-op without throwing', async () => {
  const resolved = await resolveVibrationSource({
    scope: {},
    importModule: () => Promise.reject(new Error('not bundled')),
  });
  assert.equal(resolved.source, 'none');
  assert.equal(resolved.vibrate, noopVibration);
  assert.equal(resolved.vibrate([20]), undefined);
});

test('a synchronously throwing import falls through to the no-op', async () => {
  const resolved = await resolveVibrationSource({
    scope: {},
    importModule: () => {
      throw new Error('module missing');
    },
  });
  assert.equal(resolved.source, 'none');
  assert.equal(resolved.vibrate([20]), undefined);
});

test('a throwing plugin getter resolves to the no-op', async () => {
  const plugins = {};
  Object.defineProperty(plugins, 'Haptics', {
    get() {
      throw new Error('bridge exploded');
    },
  });
  const resolved = await resolveVibrationSource({
    scope: { Capacitor: { Plugins: plugins } },
    importModule: () => Promise.reject(new Error('not bundled')),
  });
  assert.equal(resolved.source, 'none');
  assert.equal(resolved.vibrate([20]), undefined);
});

test('a plugin that throws when called never reaches the caller', async () => {
  const resolved = await resolveVibrationSource({
    scope: {},
    importModule: () => Promise.resolve({
      Haptics: {
        vibrate() {
          throw new Error('native failure');
        },
      },
    }),
  });
  assert.equal(resolved.source, 'plugin');
  assert.equal(resolved.vibrate([20]), undefined);
});

test('an unsupported environment resolves to a silent no-op', async () => {
  const resolved = await resolveVibrationSource({
    scope: {},
    importModule: () => Promise.reject(new Error('not bundled')),
  });
  assert.deepEqual(Object.keys(resolved).sort(), ['source', 'vibrate']);
  assert.equal(resolved.source, 'none');
  assert.equal(noopVibration(), undefined);
});

test('a plugin without a usable method counts as missing', async () => {
  const resolved = await resolveVibrationSource({
    scope: { Capacitor: { Plugins: { Haptics: { nothing: true } } } },
    importModule: () => Promise.resolve({}),
  });
  assert.equal(resolved.source, 'none');
});
