import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { frac, add, div, key } from './fractions.js';
import { parseVal, valKey, val, surd, vLog, vPow, vSqrt } from './exact.js';
import { equationHolds, evalTokens, I, F, POW, ROOT, LOG, OP } from './expr.js';
import {
  generateProblem2, levelKinds, missingOperandShare2, bossRoundKinds2, revealTokens2, actForLevel,
  IMPLEMENTED_LEVELS_2, OPTION_COUNT_2, TOTAL_LEVELS_2, KINDS, levelMix, isBossRoundLevel2, BOSS_ROUND_LEVELS_2,
} from './campaign2-levels.js';
import { expressionHtml, expressionText, answerHtml } from './math-render.js';
import { campaign2Access, geniusButtonVisible, CAMPAIGN2_PRODUCT_ID } from './access.js';
import { getSkillIntro2, INTRO_TEXT_2 } from './intro-text.js';

const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 13);

describe('fractions', () => {
  it('keeps lowest terms and positive denominators', () => {
    assert.deepEqual(frac(6, -8), { n: -3, d: 4 });
    assert.equal(key(frac(10, 5)), '2');
    assert.equal(key(add(frac(1, 3), frac(1, 4))), '7/12');
    assert.equal(key(div(frac(2, 3), frac(4, 9))), '3/2');
    assert.throws(() => div(frac(1, 2), frac(0, 1)));
  });
});

describe('generateProblem2, all 40 levels', () => {
  for (let level = 1; level <= IMPLEMENTED_LEVELS_2; level++) {
    it(`level ${level}: one correct, distinct options, equation holds`, () => {
      for (const seed of SEEDS) {
        const p = generateProblem2(level, seed);
        assert.equal(p.options.length, OPTION_COUNT_2);
        assert.equal(new Set(p.options).size, OPTION_COUNT_2, `duplicate options ${p.options}`);
        assert.ok(p.options.includes(p.answer));
        for (const o of p.options) parseVal(o);
        assert.ok(levelKinds(level).includes(p.kind));
        assert.ok(equationHolds(p.tokens, p.answer), `${expressionText(p.tokens)} with ${p.answer}`);
        assert.deepEqual(generateProblem2(level, seed), p, 'deterministic per seed');
      }
    });
  }

  it('wrong options never satisfy the equation', () => {
    for (let level = 1; level <= IMPLEMENTED_LEVELS_2; level++) {
      for (const seed of SEEDS.slice(0, 100)) {
        const p = generateProblem2(level, seed);
        for (const d of p.distractors) assert.ok(!equationHolds(p.tokens, d), `${expressionText(p.tokens)} accepts ${d}`);
      }
    }
  });

  it('hides operands only from level 5 and exactly when forced', () => {
    for (const seed of SEEDS) assert.equal(generateProblem2(4, seed).hidden, null);
    for (const seed of SEEDS) {
      const p = generateProblem2(9, seed, { missing: true });
      assert.ok(p.hidden && p.bonus === 25 && p.tokens.some(t => t.t === 'blank'));
      assert.equal(generateProblem2(9, seed, { missing: false }).hidden, null);
    }
    assert.equal(missingOperandShare2(4), 0);
    assert.equal(missingOperandShare2(5), 0.2);
    assert.ok(Math.abs(missingOperandShare2(40) - 0.6) < 1e-9);
  });

  it('boss rounds 10/20/30/40 cycle easy, newest and hidden', () => {
    for (const level of BOSS_ROUND_LEVELS_2) {
      const kinds = bossRoundKinds2(level);
      assert.equal(kinds.length, 3);
      for (const seed of SEEDS.slice(0, 60)) {
        assert.ok(kinds[1].kinds.includes(generateProblem2(level, seed, kinds[1]).kind), `level ${level}`);
        assert.ok(generateProblem2(level, seed, kinds[2]).hidden, `level ${level}`);
        assert.equal(generateProblem2(level, seed, kinds[0]).hidden, null);
      }
    }
    assert.throws(() => bossRoundKinds2(9));
    assert.equal(isBossRoundLevel2(40), true);
  });

  it('every kind in the table exists and every kind is used by some level', () => {
    const used = new Set();
    for (let level = 1; level <= TOTAL_LEVELS_2; level++) for (const k of Object.keys(levelMix(level))) { assert.ok(KINDS[k], k); used.add(k); }
    for (const k of Object.keys(KINDS)) assert.ok(used.has(k), `${k} is never used`);
  });

  it('each act opens on its own new kinds', () => {
    const own = { 11: 'pwSq', 16: 'rtSq', 21: 'lawMul', 26: 'surdSimplify', 31: 'logBasic', 36: 'synth' };
    for (const [level, kind] of Object.entries(own)) assert.ok(levelMix(Number(level))[kind] > 0.2, `${level} leans on ${kind}`);
  });

  it('review keeps earlier skills alive', () => {
    assert.ok(levelMix(18).pwSq > 0 && levelMix(18).addUnlike >= 0);
    assert.ok(levelMix(33).lawMul > 0 || levelMix(33).surdAdd > 0);
  });

  it('later acts reach higher-order content at level 40', () => {
    const kinds = new Set(SEEDS.map(s => generateProblem2(40, s).kind));
    assert.ok(kinds.has('synth3') && kinds.has('surdAdd'));
    const long = SEEDS.map(s => generateProblem2(40, s)).filter(p => p.kind === 'synth3');
    assert.ok(long.every(p => p.tokens.some(t => t.t === 'paren')));
  });

  it('refuses levels outside 1-40', () => {
    assert.throws(() => generateProblem2(0, 1), RangeError);
    assert.throws(() => generateProblem2(TOTAL_LEVELS_2 + 1, 1), RangeError);
  });

  it('reveals the answer in place of the blank', () => {
    const p = generateProblem2(3, 5);
    assert.ok(!revealTokens2(p).some(t => t.t === 'blank' || t.t === 'fracBlank'));
  });

  it('mixed numbers appear from level 7 only', () => {
    const has = level => SEEDS.some(s => generateProblem2(level, s).tokens.some(t => t.t === 'mixed'));
    assert.equal(has(6), false);
    assert.equal(has(8), true);
  });
});

describe('exact values', () => {
  const k = tokens => valKey(evalTokens(tokens));
  it('evaluates powers, roots, logs and radicals exactly', () => {
    assert.equal(k([ROOT(2, I(72))]), '6√2');
    assert.equal(k([POW(F(2, 3), I(-2))]), '9/4');
    assert.equal(k([POW(I(8), F(2, 3))]), '4');
    assert.equal(k([POW(I(9), F(-1, 2))]), '1/3');
    assert.equal(k([POW(I(-3), I(3))]), '-27');
    assert.equal(k([LOG(3, F(1, 9))]), '-2');
    assert.equal(k([LOG(4, I(2))]), '1/2');
    assert.equal(k([I(1), OP('÷'), ROOT(2, I(2))]), '√2/2');
    assert.equal(k([I(6), OP('÷'), ROOT(2, I(3))]), '2√3');
    assert.equal(k([ROOT(2, I(50)), OP('+'), ROOT(2, I(8))]), '7√2');
    assert.equal(k([ROOT(3, I(-125))]), '-5');
  });
  it('refuses what is not exact instead of guessing', () => {
    assert.throws(() => evalTokens([ROOT(3, I(9))]));
    assert.throws(() => evalTokens([LOG(2, I(6))]));
    assert.throws(() => evalTokens([ROOT(2, I(2)), OP('+'), ROOT(2, I(3))]));
    assert.throws(() => evalTokens([I(1), OP('÷'), I(0)]));
    assert.throws(() => evalTokens([POW(I(0), I(0))]));
  });
  it('keys round-trip', () => {
    for (const key of ['5', '-3', '7/12', '6√2', '√2/2', '-3√5/2']) assert.equal(valKey(parseVal(key)), key);
  });
  it('rejects wrong answers in equations', () => {
    assert.equal(equationHolds([POW(I(2), { t: 'blank' }), OP('='), I(64)], '6'), true);
    assert.equal(equationHolds([POW(I(2), { t: 'blank' }), OP('='), I(64)], '7'), false);
    assert.equal(equationHolds([ROOT(2, I(72)), OP('='), { t: 'surdBlank', r: 2 }], '6'), true);
  });
});

describe('acts, rendering, access and intros', () => {
  it('maps levels to acts', () => {
    assert.equal(actForLevel(5).act, 1);
    assert.equal(actForLevel(6).act, 2);
    assert.equal(actForLevel(40).act, 8);
  });

  it('renders stacked fractions without letting text through', () => {
    const html = expressionHtml([{ t: 'frac', n: 1, d: 3 }, { t: 'op', s: '+' }, { t: 'mixed', w: 2, n: 1, d: 4 }, { t: 'op', s: '=' }, { t: 'blank' }]);
    assert.match(html, /m2-frac/);
    assert.match(html, /m2-mixed/);
    const rich = expressionHtml([POW(F(2, 3), I(-2)), OP('−'), ROOT(3, I(8)), OP('+'), LOG(2, I(8)), OP('+'), { t: 'surd', q: { n: 6, d: 1 }, r: 2 }]);
    for (const cls of ['m2-pow', 'm2-sup', 'm2-root', 'm2-idx', 'm2-log', 'm2-surd', 'm2-paren']) assert.match(rich, new RegExp(cls));
    assert.equal(expressionText([POW(F(2, 3), I(-2)), OP('−'), ROOT(2, F(81, 16))]), '(2/3)^-2 − √(81/16)');
    assert.match(answerHtml('6√2'), /m2-surd/);
    assert.throws(() => expressionHtml([{ t: 'frac', n: '<b>', d: 2 }]), RangeError);
    assert.throws(() => expressionHtml([{ t: 'op', s: '<script>' }]));
    assert.match(answerHtml('-3/4'), /−/);
    assert.match(answerHtml('5'), /m2-int/);
    assert.throws(() => answerHtml('x'));
  });

  it('web is covered by the one subscription, the apps need the extra product', () => {
    assert.equal(campaign2Access({ platform: 'web', premiumAccess: true }).granted, true);
    assert.equal(campaign2Access({ platform: 'web', premiumAccess: false, ownedProductIds: [CAMPAIGN2_PRODUCT_ID] }).granted, false);
    assert.equal(campaign2Access({ platform: 'app', premiumAccess: true }).reason, 'app_purchase_required');
    assert.equal(campaign2Access({ platform: 'app', ownedProductIds: [CAMPAIGN2_PRODUCT_ID] }).granted, true);
    assert.throws(() => campaign2Access({ platform: 'tv' }));
  });

  it('every intro stage has English and German text', () => {
    for (const level of [1, 6, 11, 16, 21, 26, 31, 36]) {
      for (const stage of getSkillIntro2(level).stages) {
        const text = INTRO_TEXT_2[stage.localizationKey];
        assert.ok(text?.en && text?.de, stage.localizationKey);
      }
    }
    assert.equal(getSkillIntro2(2), null);
  });
});

import { getCampaign2LevelConfig, timerScale2, ART_LEVEL_OFFSET } from './config.js';
import { createCampaign2Progress } from './progress.js';
import { generateGameProblem2 } from './problem.js';
import { expressionUnicode } from './math-render.js';

describe('game glue: config, progress, problem adapter', () => {
  it('config reads like a Campaign 1 level and carries Campaign 2 markers', () => {
    const cfg = getCampaign2LevelConfig(12);
    assert.equal(cfg.campaign, 2);
    assert.equal(cfg.level, 12);
    assert.equal(cfg.inputMode, 'multiple-choice');
    assert.equal(cfg.artLevel, ART_LEVEL_OFFSET + 12);
    assert.equal(cfg.abilityLevel, 60);
    assert.ok(cfg.waveSize > 0 && cfg.fiendHP >= 1);
    assert.equal(timerScale2(1), 1.2);
    assert.equal(timerScale2(40), 2);
    assert.throws(() => getCampaign2LevelConfig(41), RangeError);
  });

  it('progress is per player, validated, and survives broken storage', () => {
    const data = new Map();
    const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
    const a = createCampaign2Progress({ storage, playerId: 'a' });
    const b = createCampaign2Progress({ storage, playerId: 'b' });
    assert.equal(a.next(), 1);
    a.markCleared(1); a.markCleared(2); a.markCleared(2);
    assert.deepEqual(a.cleared(), [1, 2]);
    assert.equal(a.next(), 3);
    assert.deepEqual(b.cleared(), []);
    assert.throws(() => a.markCleared(41), RangeError);
    data.set('arithmoslayer:campaign2:a', '{broken');
    assert.deepEqual(a.cleared(), []);
    const broken = createCampaign2Progress({ storage: { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } } });
    assert.deepEqual(broken.markCleared(3), [3]);
    for (let l = 1; l <= 40; l++) a.markCleared(l);
    assert.equal(a.next(), null);
  });

  it('adapts a question to the game problem shape', () => {
    for (const level of [1, 12, 22, 28, 33, 40]) {
      const p = generateGameProblem2(level, 99 + level);
      assert.equal(typeof p.question, 'string');
      assert.ok(p.question.includes('?'), p.question);
      assert.equal(p.optionsHtml.length, p.options.length);
      assert.ok(!p.revealText.includes('?'), p.revealText);
      assert.equal(p.operation, null);
    }
    assert.equal(expressionUnicode([POW(F(2, 3), I(-2)), OP('−'), ROOT(2, F(81, 16)), OP('='), { t: 'blank' }]), '(2/3)⁻² − √(81/16) = ?');
    assert.equal(expressionUnicode([LOG(2, I(32)), OP('='), { t: 'blank' }]), 'log₂ 32 = ?');
  });
});

import { geniusEarned, createGeniusReveal, GENIUS_REVEAL_LEVEL } from './genius.js';

describe('Genius Campaign reveal', () => {
  it('is earned by clearing level 40 or by playing beyond it, not before', () => {
    assert.equal(GENIUS_REVEAL_LEVEL, 40);
    assert.equal(geniusEarned({ cleared: [1, 2, 39] }), false);
    assert.equal(geniusEarned({ cleared: [39, 40] }), true);
    assert.equal(geniusEarned({ reachedLevels: [38, 40] }), false);
    assert.equal(geniusEarned({ reachedLevels: [41] }), true);
    assert.equal(geniusEarned(), false);
  });
  it('is remembered per player, once, and survives broken storage', () => {
    const data = new Map();
    const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
    const a = createGeniusReveal({ storage, playerId: 'a' });
    const b = createGeniusReveal({ storage, playerId: 'b' });
    assert.equal(a.isRevealed(), false);
    assert.equal(a.reveal(), true);
    assert.equal(a.reveal(), false, 'only the first reveal is news');
    assert.equal(a.isRevealed(), true);
    assert.equal(b.isRevealed(), false);
    const broken = createGeniusReveal({ storage: { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } } });
    assert.equal(broken.isRevealed(), false);
    assert.doesNotThrow(() => broken.reveal());
  });
});

describe('who sees the Genius Campaign button', () => {
  it('app owners always, everyone else only once level 40 is beaten', () => {
    assert.equal(geniusButtonVisible({ platform: 'app', ownsProduct: true, revealed: false }), true);
    assert.equal(geniusButtonVisible({ platform: 'app', ownsProduct: false, revealed: false }), false);
    assert.equal(geniusButtonVisible({ platform: 'app', ownsProduct: false, revealed: true }), true, 'not bought, level 40 beaten: it appears so they can buy');
    assert.equal(geniusButtonVisible({ platform: 'web', revealed: false }), false, 'a subscription alone does not show it early');
    assert.equal(geniusButtonVisible({ platform: 'web', ownsProduct: true, revealed: false }), false, 'the web has no product to own');
    assert.equal(geniusButtonVisible({ platform: 'web', revealed: true }), true);
    assert.throws(() => geniusButtonVisible({ platform: 'tv' }), RangeError);
  });
});
