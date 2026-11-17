import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { featureOn, FEATURE_PLAYER_NAMES } from './feature-flags.js';

test('the hero pack shows only for a player named TOGGLE', () => {
  assert.equal(FEATURE_PLAYER_NAMES.heroPack, 'TOGGLE');
  assert.equal(featureOn('heroPack', 'TOGGLE'), true);
  assert.equal(featureOn('heroPack', '  TOGGLE '), true);
  for (const name of ['toggle', 'Toggle', 'TOGGLE2', 'Mia', '', null, undefined, 42]) {
    assert.equal(featureOn('heroPack', name), false, String(name));
  }
});

test('an unknown feature is off for every name', () => {
  assert.equal(featureOn('nope', 'TOGGLE'), false);
  assert.equal(featureOn('constructor', 'TOGGLE'), false);
});

test('main.js gates the skin, identity portrait, app picker and web picker on the toggle', async () => {
  const source = await readFile(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ featureOn \} from '\.\/feature-flags\.js'/);
  assert.match(source, /function heroPackOn\(/);
  assert.match(source, /async function resolveActiveHeroId\(\) \{\s*try \{\s*if \(!heroPackOn\(\)\) return resolveHero\(null\)\.id;/);
  assert.match(source, /TEST UNLOCK[\s\S]*platform\.isApp\) return resolveHero\(platform\.localProfiles/);
  assert.match(source, /!heroPackOwned && !heroPackOn\(\)/);
  assert.match(source, /heroFeature: \(\) => heroPackOn\(\)/);
  assert.match(source, /if \(!platform\.isLoggedIn \|\| !heroPackOn\(\)\) \{\s*accountHeroPicker\.hidden = true;/);
  assert.match(source, /heroPackOn\(\) && platform\.isLoggedIn && splashGreeting\.textContent/);
});
