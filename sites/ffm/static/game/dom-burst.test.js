import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BURST_SHARD_CLASS,
  BURST_TONES,
  createDomBurst,
} from './dom-burst.js';

function fakeHost() {
  const listeners = new Map();
  const host = {
    children: [],
    appendChild(child) { host.children.push(child); child.parentNode = host; return child; },
  };
  return host;
}

function fakeElement() {
  const listeners = new Map();
  const properties = new Map();
  const attributes = {};
  const node = {
    tagName: 'SPAN',
    className: '',
    dataset: {},
    parentNode: null,
    style: {
      setProperty(name, value) { properties.set(name, String(value)); },
      getPropertyValue(name) { return properties.get(name) ?? ''; },
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name] ?? null; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
    listenerCount(type) { return listeners.has(type) ? 1 : 0; },
    fire(type) { listeners.get(type)?.(); },
    remove() {
      if (!node.parentNode) return;
      node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
      node.parentNode = null;
    },
  };
  return node;
}

const fakeDoc = () => ({ createElement: () => fakeElement() });
const fixedRandom = () => 0.5;

describe('HUD bursts', () => {
  it('appends one shard per count, all decorative and on their own offsets', () => {
    const burst = createDomBurst({ doc: fakeDoc(), random: fixedRandom });
    const host = fakeHost();
    assert.equal(burst.burst(host, 'glass', 8), 8);
    assert.equal(host.children.length, 8);
    assert.equal(burst.activeCount(), 8);
    for (const shard of host.children) {
      assert.equal(shard.className, BURST_SHARD_CLASS);
      assert.equal(shard.getAttribute('aria-hidden'), 'true');
      assert.match(shard.style.getPropertyValue('--burst-x'), /^-?\d+(\.\d)?px$/);
      assert.match(shard.style.getPropertyValue('--burst-y'), /^-?\d+(\.\d)?px$/);
      assert.match(shard.style.getPropertyValue('--burst-rot'), /^-?\d+deg$/);
      assert.equal(shard.listenerCount('animationend'), 1, 'cleanup rides the animation, not a timer');
    }
    // Evenly spread, so the shards do not pile up on one side.
    const xs = host.children.map((shard) => parseFloat(shard.style.getPropertyValue('--burst-x')));
    assert.ok(Math.max(...xs) - Math.min(...xs) > 20);
  });

  it('removes a shard when its animation ends and keeps the rest', () => {
    const burst = createDomBurst({ doc: fakeDoc(), random: fixedRandom });
    const host = fakeHost();
    burst.burst(host, 'glass', 3);
    const [first] = host.children;
    first.fire('animationend');
    assert.equal(host.children.length, 2);
    assert.equal(burst.activeCount(), 2);
    assert.equal(first.listenerCount('animationend'), 0, 'the listener is dropped with the shard');
  });

  it('gives the score tone an upward throw and the glass tone a full circle', () => {
    assert.equal(BURST_TONES.glass.spread, 360);
    assert.ok(BURST_TONES.score.spread < 360);
    const burst = createDomBurst({ doc: fakeDoc(), random: fixedRandom });
    const host = fakeHost();
    burst.burst(host, 'score', 6);
    const ys = host.children.map((shard) => parseFloat(shard.style.getPropertyValue('--burst-y')));
    assert.ok(ys.every((y) => y < 0), 'score sparks rise');
    const glassHost = fakeHost();
    burst.burst(glassHost, 'glass', 8);
    const glassYs = glassHost.children.map((shard) => parseFloat(shard.style.getPropertyValue('--burst-y')));
    assert.ok(glassYs.some((y) => y > 0) && glassYs.some((y) => y < 0), 'glass shards fly both ways');
  });

  it('keeps reduced motion visible but flagged, and clamps silly counts', () => {
    const burst = createDomBurst({ doc: fakeDoc(), random: fixedRandom, reducedMotion: true });
    const host = fakeHost();
    burst.burst(host, 'glass', 2);
    assert.ok(host.children.every((shard) => shard.dataset.reduced === 'true'));
    assert.equal(burst.animates, false);

    const wide = createDomBurst({ doc: fakeDoc(), random: fixedRandom });
    assert.equal(wide.burst(fakeHost(), 'glass', 9999), 40, 'capped');
    assert.equal(wide.burst(fakeHost(), 'glass', 0), 0);
    assert.equal(wide.burst(fakeHost(), 'glass', -3), 0);
    assert.equal(wide.burst(fakeHost(), 'nonsense', 4), 4, 'unknown tones fall back to glass');
  });

  it('is a no-op without a document or a host', () => {
    assert.equal(createDomBurst({ doc: null }).burst(fakeHost(), 'glass', 4), 0);
    assert.equal(createDomBurst({ doc: fakeDoc() }).burst(null, 'glass', 4), 0);
  });
});
