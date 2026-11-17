import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isIosApp } from '../game/ios-platform.js';

describe('isIosApp', () => {
  it('is true only for the ios platform', () => {
    assert.equal(isIosApp({ Capacitor: { getPlatform: () => 'ios' } }), true);
    assert.equal(isIosApp({ Capacitor: { getPlatform: () => 'android' } }), false);
    assert.equal(isIosApp({ Capacitor: { getPlatform: () => 'web' } }), false);
  });

  it('is false without Capacitor or getPlatform', () => {
    assert.equal(isIosApp({}), false);
    assert.equal(isIosApp({ Capacitor: {} }), false);
    assert.equal(isIosApp(null), false);
  });

  it('is false when getPlatform throws', () => {
    assert.equal(isIosApp({ Capacitor: { getPlatform() { throw new Error('boom'); } } }), false);
  });
});
