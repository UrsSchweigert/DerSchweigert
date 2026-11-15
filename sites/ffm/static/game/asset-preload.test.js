import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import { abilityOrnamentUrl, buildAssetManifest, buildAbilityIconUrls, buildCriticalAssetManifest, buildDeferredAssetManifest } from './asset-preload.js';

describe('buildAssetManifest', () => {
  it('returns 3 core sprites + 6 stage backgrounds + 60 fiend class sprites', () => {
    const urls = buildAssetManifest();
    assert.strictEqual(urls.length, 3 + 6 + 60);
  });

  it('has no duplicate URLs', () => {
    const urls = buildAssetManifest();
    assert.strictEqual(new Set(urls).size, urls.length);
  });

  it('includes the hero, dragon, and fireball sprites', () => {
    const urls = buildAssetManifest();
    assert.ok(urls.some((u) => u.endsWith('hero/hero-atlas.webp')));
    assert.ok(urls.some((u) => u.endsWith('dragon.webp')));
    assert.ok(urls.some((u) => u.endsWith('fireball.png')));
  });

  it('includes all 6 stage backgrounds', () => {
    const urls = buildAssetManifest();
    for (let i = 1; i <= 6; i++) {
      assert.ok(urls.some((u) => u.endsWith(`stage-${i}.webp`)), `missing stage-${i}.webp`);
    }
  });

  it('includes both fiend sprite sets (set1-01..18, set2-01..18)', () => {
    const urls = buildAssetManifest();
    for (let set = 1; set <= 2; set++) {
      for (let i = 1; i <= 18; i++) {
        const suffix = `set${set}-${String(i).padStart(2, '0')}.webp`;
        assert.ok(urls.some((u) => u.endsWith(suffix)), `missing ${suffix}`);
      }
    }
  });

  it('every URL resolves to a file that actually exists on disk', () => {
    const urls = buildAssetManifest();
    for (const url of urls) {
      const filePath = fileURLToPath(url);
      assert.ok(fs.existsSync(filePath), `missing file: ${filePath}`);
    }
  });
});

describe('critical / deferred split', () => {
  it('gates first paint on the hero and fireball only', () => {
    const critical = buildCriticalAssetManifest();
    assert.deepEqual(
      critical.map((url) => url.split('/').slice(-1)[0]).sort(),
      ['fireball.png', 'hero-atlas.webp'],
    );
  });

  it('keeps the deferred list free of anything the first paint needs', () => {
    const critical = new Set(buildCriticalAssetManifest());
    for (const url of buildDeferredAssetManifest()) {
      assert.ok(!critical.has(url), `${url} is preloaded twice`);
    }
  });

  it('is the exact union of both lists, so no art is dropped', () => {
    const full = buildAssetManifest();
    const split = [...buildCriticalAssetManifest(), ...buildDeferredAssetManifest()];
    assert.equal(split.length, full.length);
    assert.deepEqual(new Set(split), new Set(full));
  });

  it('keeps the 11 MB of per-level art out of the first paint', () => {
    // The title screen is the only thing between the player and the menu, so
    // the wait must not scale with the number of fiend classes.
    assert.ok(buildDeferredAssetManifest().length >= 60);
    assert.ok(buildCriticalAssetManifest().length <= 2);
  });
});

describe('buildAbilityIconUrls', () => {
  it('lists the wind, storm and earth icons under game/assets', () => {
    const urls = buildAbilityIconUrls();
    assert.deepEqual(urls.map((url) => url.split('/').pop()), [
      'ability-wind.webp',
      'ability-storm.webp',
      'ability-earth.webp',
    ]);
    assert.equal(new Set(urls).size, urls.length);
    for (const url of urls) assert.match(url, /\/game\/assets\/ability-(wind|storm|earth)\.webp$/);
  });

  it('resolves the one dragon ornament the bar mirrors for both sides', () => {
    assert.match(abilityOrnamentUrl(), /\/game\/assets\/ability-ornament\.webp$/);
    // Not part of the icon list: the bar shows it next to the buttons, not in one.
    assert.ok(!buildAbilityIconUrls().includes(abilityOrnamentUrl()));
  });
});
