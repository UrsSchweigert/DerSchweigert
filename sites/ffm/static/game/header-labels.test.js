import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  COMPACT_HEADER_MAX_WIDTH,
  formatEncounterLabel,
  formatRewardLabel,
  useCompactHeaderLabels,
} from './header-labels.js';

const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const i18nSource = readFileSync(new URL('./i18n.js', import.meta.url), 'utf8');

// Mirrors the real strings, so a label change has to be a deliberate change here.
const translate = (key, vars = {}) => ({
  'reward.fireball': 'Fireball',
  'reward.lightning': 'Lightning',
  'reward.dragon': 'Dragon',
  'reward.upcoming': '{ability} in {count}',
  'reward.upcomingChance': '{ability} {chance}% in {count}',
  'reward.upcomingCompact': '{ability} {count}',
  'reward.active': '{ability}',
  'reward.activeChance': '{ability}: {chance}% per hit',
  'gameplay.encounters': 'Defeated: {defeated}/{total}',
  'gameplay.encountersCompact': 'Defeated: {defeated}',
}[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));

describe('the compact header applies to narrow app screens only', () => {
  it('is on for an app phone at and under the breakpoint', () => {
    assert.equal(COMPACT_HEADER_MAX_WIDTH, 420);
    for (const width of [320, 375, 390, 393, 412, 420]) {
      assert.equal(useCompactHeaderLabels({ isApp: true, width }), true, `app ${width}px`);
    }
  });

  it('is off above the breakpoint, on the website, and without a measurable width', () => {
    assert.equal(useCompactHeaderLabels({ isApp: true, width: 421 }), false);
    assert.equal(useCompactHeaderLabels({ isApp: true, width: 667 }), false, 'landscape');
    assert.equal(useCompactHeaderLabels({ isApp: false, width: 375 }), false, 'the website keeps its room');
    assert.equal(useCompactHeaderLabels({ isApp: true, width: 0 }), false);
    assert.equal(useCompactHeaderLabels({ isApp: true, width: NaN }), false);
    assert.equal(useCompactHeaderLabels(), false);
  });
});

describe('the defeated readout', () => {
  const progress = { defeated: 13, total: 17 };

  it('keeps the total on the website', () => {
    assert.equal(formatEncounterLabel(progress, { compact: false, translate }), 'Defeated: 13/17');
  });

  it('drops the total in the narrow app header', () => {
    assert.equal(formatEncounterLabel(progress, { compact: true, translate }), 'Defeated: 13');
  });
});

describe('the dragon readout', () => {
  it('counts down while the band is ahead', () => {
    const reward = { ability: 'dragon', remaining: 3, chance: 1 };
    assert.equal(formatRewardLabel(reward, { compact: false, translate }), 'Dragon in 3');
    assert.equal(formatRewardLabel(reward, { compact: true, translate }), 'Dragon 3');
  });

  it('names the ability alone once the band is reached', () => {
    const reward = { ability: 'dragon', remaining: 0, chance: 1 };
    assert.equal(formatRewardLabel(reward, { compact: false, translate }), 'Dragon');
    assert.equal(formatRewardLabel(reward, { compact: true, translate }), 'Dragon');
  });

  it('still states an uncertain chance, should a rule ever be less than certain', () => {
    const reward = { ability: 'dragon', remaining: 4, chance: 0.8 };
    assert.equal(formatRewardLabel(reward, { compact: false, translate }), 'Dragon 80% in 4');
    assert.equal(
      formatRewardLabel({ ...reward, remaining: 0 }, { compact: false, translate }),
      'Dragon: 80% per hit',
    );
  });
});

describe('main.js uses the formatters', () => {
  it('imports them and feeds the header with them', () => {
    assert.match(main, /from '\.\/header-labels\.js'/);
    assert.match(main, /useCompactHeaderLabels\(\{[\s\S]*?isApp: platform\.isApp,[\s\S]*?width: globalThis\.innerWidth/);
    assert.match(main, /progressLabel:[\s\S]*?formatEncounterLabel\(encounterProgress, \{ compact: compactHeader, translate: t \}\)/);
    assert.match(main, /rewardLabel = formatRewardLabel\(reward, \{ compact: compactHeader, translate: t \}\)/);
  });
});

describe('the compact strings exist in both languages', () => {
  for (const [key, en, de] of [
    ['gameplay.encountersCompact', 'Defeated: {defeated}', 'Besiegt: {defeated}'],
    ['reward.upcomingCompact', '{ability} {count}', '{ability} {count}'],
    ['reward.active', '{ability}', '{ability}'],
  ]) {
    it(key, () => {
      const entry = new RegExp(`'${key.replace('.', '\\.')}': \\{ en: '([^']*)', de: '([^']*)' \\}`).exec(i18nSource);
      assert.ok(entry, `${key} is missing from i18n.js`);
      assert.equal(entry[1], en);
      assert.equal(entry[2], de);
    });
  }
});
