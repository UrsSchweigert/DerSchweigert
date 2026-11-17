import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_HERO_ID,
  HERO_ID_PATTERN,
  HERO_STRIKE_FAMILIES,
  HEROES,
  resolveHero,
} from './heroes.js';

const ROSTER_IDS = [
  'adventurer',
  'adventuress',
  'princess',
  'princess-armed',
  'rogue',
  'rogue-f',
  'soldier',
  'soldier-f',
  'monk',
  'priestess',
];

describe('roster', () => {
  it('lists the ten heroes in roster order', () => {
    assert.deepEqual(
      HEROES.map((entry) => entry.id),
      ROSTER_IDS,
    );
  });

  it('gives each hero its i18n name key', () => {
    for (const entry of HEROES) {
      assert.equal(entry.nameKey, `heroes.name.${entry.id}`);
    }
  });

  it('assigns the strike family of each hero', () => {
    const strikes = Object.fromEntries(HEROES.map((entry) => [entry.id, entry.strike]));
    assert.deepEqual(strikes, {
      adventurer: 'sword',
      adventuress: 'sword',
      princess: 'sword',
      'princess-armed': 'sword',
      rogue: 'bow',
      'rogue-f': 'bow',
      soldier: 'buckler',
      'soldier-f': 'buckler',
      monk: 'fist',
      priestess: 'fist',
    });
  });

  it('marks exactly one hero as free, and it is the default', () => {
    const free = HEROES.filter((entry) => entry.free);
    assert.deepEqual(free.map((entry) => entry.id), ['adventurer']);
    assert.equal(DEFAULT_HERO_ID, 'adventurer');
  });

  it('gives every hero ids that match the id pattern', () => {
    for (const entry of HEROES) {
      assert.match(entry.id, HERO_ID_PATTERN);
    }
  });

  it('uses heroes/<id> paths for every hero except the adventurer', () => {
    for (const entry of HEROES.slice(1)) {
      assert.equal(entry.portrait, `heroes/${entry.id}/portrait.webp`);
      assert.equal(entry.atlas, `heroes/${entry.id}/hero-atlas.webp`);
      assert.equal(entry.frames, `heroes/${entry.id}/hero-frames.js`);
    }
  });

  it('keeps the adventurer on the original hero/ atlas and frames until cut-over', () => {
    const adventurer = HEROES[0];
    assert.equal(adventurer.portrait, 'heroes/adventurer/portrait.webp');
    assert.equal(adventurer.atlas, 'hero/hero-atlas.webp');
    assert.equal(adventurer.frames, 'hero/hero-frames.js');
  });

  it('freezes the roster, each entry and the strike family list', () => {
    assert.ok(Object.isFrozen(HEROES));
    assert.ok(Object.isFrozen(HERO_STRIKE_FAMILIES));
    for (const entry of HEROES) {
      assert.ok(Object.isFrozen(entry));
    }
    assert.throws(() => HEROES.push({}), TypeError);
  });
});

describe('strike families', () => {
  it('lists sword, bow, buckler, staff and fist in that order', () => {
    assert.deepEqual([...HERO_STRIKE_FAMILIES], ['sword', 'bow', 'buckler', 'staff', 'fist']);
  });

  it('keeps staff although no roster hero strikes with it', () => {
    assert.ok(HERO_STRIKE_FAMILIES.includes('staff'));
    assert.ok(!HEROES.some((entry) => entry.strike === 'staff'));
  });
});

describe('resolveHero', () => {
  it('returns the default for undefined and null', () => {
    assert.equal(resolveHero(undefined).id, 'adventurer');
    assert.equal(resolveHero(null).id, 'adventurer');
  });

  it('returns the default for numbers, objects and symbols without throwing', () => {
    assert.equal(resolveHero(0).id, 'adventurer');
    assert.equal(resolveHero(42).id, 'adventurer');
    assert.equal(resolveHero({ id: 'rogue' }).id, 'adventurer');
    assert.equal(resolveHero(['rogue']).id, 'adventurer');
    assert.equal(resolveHero(Symbol('rogue')).id, 'adventurer');
  });

  it('returns the default for ids that fail the pattern', () => {
    assert.equal(resolveHero('').id, 'adventurer');
    assert.equal(resolveHero('Rogue').id, 'adventurer');
    assert.equal(resolveHero('1rogue').id, 'adventurer');
    assert.equal(resolveHero('rogue_f').id, 'adventurer');
    assert.equal(resolveHero(`a${'b'.repeat(32)}`).id, 'adventurer');
  });

  it('returns the default for unknown ids that pass the pattern', () => {
    assert.equal(resolveHero('wizard', { entitled: true }).id, 'adventurer');
  });

  it('returns the default for a pack hero that is not entitled', () => {
    assert.equal(resolveHero('rogue').id, 'adventurer');
    assert.equal(resolveHero('rogue', {}).id, 'adventurer');
    assert.equal(resolveHero('rogue', { entitled: false }).id, 'adventurer');
    assert.equal(resolveHero('rogue', { entitled: 'true' }).id, 'adventurer');
    assert.equal(resolveHero('rogue', { entitled: 1 }).id, 'adventurer');
    assert.equal(resolveHero('rogue', null).id, 'adventurer');
  });

  it('returns the chosen pack hero when entitled is true', () => {
    assert.equal(resolveHero('rogue', { entitled: true }).id, 'rogue');
    assert.equal(resolveHero('priestess', { entitled: true }).id, 'priestess');
  });

  it('returns the free hero regardless of entitlement', () => {
    assert.equal(resolveHero('adventurer').id, 'adventurer');
    assert.equal(resolveHero('adventurer', { entitled: false }).id, 'adventurer');
    assert.equal(resolveHero('adventurer', { entitled: true }).id, 'adventurer');
  });

  it('returns the same frozen roster entry objects', () => {
    assert.equal(resolveHero('monk', { entitled: true }), HEROES[8]);
    assert.ok(Object.isFrozen(resolveHero('monk', { entitled: true })));
  });
});

describe('heroes.js source', () => {
  it('imports nothing and touches no window, document or fetch', async () => {
    const source = await readFile(new URL('./heroes.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /^\s*import\b/m);
    assert.doesNotMatch(source, /\bwindow\b/);
    assert.doesNotMatch(source, /\bdocument\b/);
    assert.doesNotMatch(source, /\bfetch\b/);
  });
});

it('heroAssetUrl resolves a roster path against the game folder, not the page', async () => {
  const { heroAssetUrl } = await import('./heroes.js');
  const url = heroAssetUrl('heroes/rogue/portrait.webp');
  assert.match(url, /^file:|^https?:/);
  assert.ok(url.endsWith('/game/heroes/rogue/portrait.webp'), url);
});
