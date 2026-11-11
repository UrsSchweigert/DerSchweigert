import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACT_COUNT,
  BOSSES,
  DIFFICULTY_RULES,
  HOLLOW_KING,
  LEVELS_PER_ACT,
  WARDENS,
  availableBosses,
  bossForAct,
  bossForLevel,
  getBoss,
  hollowKingUnlocked,
  levelUnlocked,
  totalCrowns,
  wardenUnlocked,
} from './boss-data.js';

const allLevels = Array.from({ length: ACT_COUNT * LEVELS_PER_ACT }, (_, index) => index + 1);
const actLevels = act => allLevels.slice((act - 1) * LEVELS_PER_ACT, act * LEVELS_PER_ACT);
const levelsThrough = act => allLevels.filter(level => level <= act * LEVELS_PER_ACT);

describe('boss data', () => {
  it('gives every act a Warden that sits at the end of its ten levels', () => {
    assert.equal(WARDENS.length, ACT_COUNT);
    WARDENS.forEach((warden, index) => {
      assert.equal(warden.act, index + 1);
      assert.equal(warden.afterLevel, (index + 1) * LEVELS_PER_ACT);
      assert.equal(bossForAct(warden.act).id, warden.id);
      assert.equal(bossForLevel(warden.afterLevel).id, warden.id);
      assert.equal(bossForLevel(warden.afterLevel - 1).id, warden.id, 'the node belongs to every level of its act');
    });
  });

  it('gives each Warden three seals per phase and one phase per promised rule', () => {
    for (const warden of WARDENS) {
      assert.equal(warden.phases.length, 3);
      for (const phase of warden.phases) {
        assert.ok(Number.isInteger(phase.seals) && phase.seals >= 3, `${phase.id} needs at least three seals`);
        assert.ok(phase.nameKey && phase.id, `${phase.id} needs a name and an i18n key`);
        if (phase.kind === 'sequence') {
          assert.ok(Array.isArray(phase.rules) && phase.rules.length > 0, `${phase.id} declares no rules`);
        }
      }
    }
  });

  it('keeps the Hollow King out of the campaign and ends on the mastery round', () => {
    assert.equal(HOLLOW_KING.final, true);
    assert.equal(HOLLOW_KING.act, ACT_COUNT);
    const last = HOLLOW_KING.phases.at(-1);
    assert.equal(last.kind, 'mastery');
    assert.equal(last.masteryRound, true);
    assert.equal(last.seals, 8);
    assert.ok(HOLLOW_KING.phases.length >= 4);
    assert.ok(BOSSES.includes(HOLLOW_KING));
    assert.equal(BOSSES.length, ACT_COUNT + 1);
  });

  it('publishes only complete difficulty bands', () => {
    assert.deepEqual(Object.keys(DIFFICULTY_RULES), ['easy', 'medium', 'hard']);
    for (const rules of Object.values(DIFFICULTY_RULES)) {
      assert.ok(rules.wardClock > 0);
      assert.ok(Number.isInteger(rules.missHeartEvery) && rules.missHeartEvery >= 0);
    }
    assert.ok(DIFFICULTY_RULES.easy.wardClock > DIFFICULTY_RULES.hard.wardClock);
  });

  it('refuses an unknown boss id', () => {
    assert.throws(() => getBoss('warden-sigil'), TypeError);
    assert.equal(getBoss('warden-dawn').id, 'warden-dawn');
  });
});

describe('boss gating', () => {
  it('opens a Warden only when all ten of its levels are cleared', () => {
    const dawn = WARDENS[0];
    const nine = actLevels(1).slice(0, 9);
    assert.equal(wardenUnlocked(dawn, { clearedLevels: nine }), false);
    assert.equal(wardenUnlocked(dawn, { clearedLevels: actLevels(1) }), true);
    // Clearing a later act must not open an earlier Warden.
    assert.equal(wardenUnlocked(WARDENS[1], { clearedLevels: actLevels(2) }), true);
    assert.equal(wardenUnlocked(WARDENS[1], { clearedLevels: actLevels(3) }), false);
  });

  it('does not offer a Warden twice or before its act is done', () => {
    assert.deepEqual(availableBosses({ clearedLevels: [] }), []);
    assert.deepEqual(availableBosses({ clearedLevels: actLevels(1) }), ['warden-dawn']);
    assert.deepEqual(
      availableBosses({ clearedLevels: levelsThrough(2), defeatedBosses: ['warden-dawn'] }),
      ['warden-dawn', 'warden-harvest'],
      'a fallen Warden stays open for a crown replay',
    );
  });

  it('holds the next act shut until its gatekeeper falls', () => {
    assert.equal(levelUnlocked(1, {}), true);
    assert.equal(levelUnlocked(10, {}), true);
    for (const level of [11, 15, 20]) {
      assert.equal(levelUnlocked(level, { defeatedBosses: [] }), false);
      assert.equal(levelUnlocked(level, { defeatedBosses: ['warden-dawn'] }), true);
    }
    assert.equal(levelUnlocked(31, { defeatedBosses: ['warden-dawn', 'warden-harvest'] }), false);
    assert.equal(levelUnlocked(31, { defeatedBosses: ['warden-dawn', 'warden-harvest', 'warden-memory'] }), true);
    assert.equal(levelUnlocked(0, {}), false);
    assert.equal(levelUnlocked(1.5, {}), false);
  });

  it('unlocks the Hollow King only after sixty levels and six Wardens', () => {
    const allWardens = WARDENS.map(warden => warden.id);
    assert.equal(hollowKingUnlocked({ clearedLevels: allLevels, defeatedBosses: allWardens }), true);
    assert.equal(hollowKingUnlocked({ clearedLevels: allLevels, defeatedBosses: allWardens.slice(0, 5) }), false);
    assert.equal(hollowKingUnlocked({ clearedLevels: allLevels.slice(0, 59), defeatedBosses: allWardens }), false);
    // A defeated Warden stays listed so its crown can be improved.
    assert.deepEqual(
      availableBosses({ clearedLevels: allLevels, defeatedBosses: allWardens }),
      [...allWardens, 'hollow-king'],
    );
    assert.deepEqual(
      availableBosses({ clearedLevels: allLevels, defeatedBosses: allWardens.slice(0, 5) }),
      [...allWardens],
    );
  });

  it('adds up crowns across every fight', () => {
    assert.equal(totalCrowns({}), 0);
    assert.equal(totalCrowns({ 'warden-dawn': { crowns: 3 }, 'warden-harvest': { crowns: 2 } }), 5);
    assert.equal(totalCrowns({ 'warden-dawn': null }), 0);
  });
});

describe('boss art', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  it('gives every boss an arena and a portrait that exist on disk', () => {
    for (const boss of BOSSES) {
      assert.ok(boss.art?.arena, `${boss.id} has no arena`);
      assert.ok(boss.art?.figure, `${boss.id} has no portrait`);
      assert.ok(boss.dragon?.sheet, `${boss.id} has no dragon sheet`);
      for (const relative of [boss.art.arena, boss.art.figure, boss.dragon.sheet]) {
        const full = join(here, relative);
        assert.ok(existsSync(full), `${boss.id} art is missing: ${relative}`);
        assert.equal(full.endsWith('.webp'), true, `${boss.id} art should ship as webp`);
      }
    }
  });

  it('gives each boss a dragon with one more head, then resets to one', () => {
    const heads = BOSSES.map(boss => boss.dragon.heads);
    assert.deepEqual(heads, [1, 2, 3, 4, 5, 6, 1]);
    const sheets = BOSSES.map(boss => boss.dragon.sheet);
    assert.equal(new Set(sheets).size, BOSSES.length, 'every dragon needs its own sheet');
    assert.notEqual(HOLLOW_KING.dragon.sheet, WARDENS[0].dragon.sheet,
      'the last dragon is one head again, but not the same creature');
  });

  it('gives each act its own arena, with the final fight in the throne room', () => {
    const arenas = WARDENS.map(warden => warden.art.arena);
    assert.equal(new Set(arenas).size, ACT_COUNT, 'each act needs a distinct arena');
    // One arena per act: the Hollow King fights in the sixth act's ruined hall
    // rather than shipping a seventh background.
    assert.equal(HOLLOW_KING.art.arena, WARDENS.at(-1).art.arena);
    const figures = BOSSES.map(boss => boss.art.figure);
    assert.equal(new Set(figures).size, BOSSES.length, 'every boss needs its own portrait');
  });
});
