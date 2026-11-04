// parental-gate.test.mjs — unit tests for the bilingual adult check.
//
// The gate must not be solvable with the game's own level arithmetic: the
// free levels add up to 12, while the gate multiplies operands of 6-12 and
// spells them out in words. These tests also pin the accessible markup and
// the injectable async gate() contract used by purchase, restore and
// external-link callers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LevelConfig } from '../../static/game/levels.js';
import {
  DEFAULT_LOCALE,
  GATED_ACTIONS,
  MAX_OPERAND,
  MIN_OPERAND,
  NUMBER_WORDS,
  STRINGS,
  SUPPORTED_LOCALES,
  buildGateMarkup,
  checkAnswer,
  gate,
  generateChallenge,
  questionText,
  resolveLocale,
} from '../game/parental-gate.js';

/** UI fake that records each request and answers with a fixed value. */
function createFakeUi(answer) {
  const calls = [];
  return {
    calls,
    async ask(request) {
      calls.push(request);
      return typeof answer === 'function' ? answer(request) : answer;
    },
  };
}

/** Random source that yields a fixed sequence, then repeats the last value. */
function sequenceRandom(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

test('gate copy is complete in English and German', () => {
  assert.deepEqual([...SUPPORTED_LOCALES].sort(), ['de', 'en']);
  assert.equal(DEFAULT_LOCALE, 'en');

  for (const key of Object.keys(STRINGS)) {
    for (const locale of SUPPORTED_LOCALES) {
      const value = STRINGS[key][locale];
      assert.equal(typeof value, 'string', `${key}.${locale} is a string`);
      assert.ok(value.trim().length > 0, `${key}.${locale} is not empty`);
    }
  }
  assert.match(STRINGS['gate.question'].en, /\{a\}.*\{b\}/);
  assert.match(STRINGS['gate.question'].de, /\{a\}.*\{b\}/);
});

test('number words cover the whole operand range in both locales', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const words = NUMBER_WORDS[locale];
    assert.equal(words.length, 13);
    for (let value = 0; value <= MAX_OPERAND; value += 1) {
      assert.match(words[value], /^[a-zäöüß]+$/, `${locale} word for ${value}`);
    }
    for (let value = MIN_OPERAND; value <= MAX_OPERAND; value += 1) {
      assert.doesNotMatch(words[value], /\d/);
    }
  }
});

test('resolveLocale falls back to English for unknown locales', () => {
  assert.equal(resolveLocale('de'), 'de');
  assert.equal(resolveLocale('en'), 'en');
  assert.equal(resolveLocale('fr'), 'en');
  assert.equal(resolveLocale(undefined), 'en');
});

test('challenges multiply operands inside the 6-12 range', () => {
  for (const random of [() => 0, () => 0.5, () => 0.999999, Math.random]) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const challenge = generateChallenge(random);
      assert.ok(Number.isInteger(challenge.a));
      assert.ok(Number.isInteger(challenge.b));
      assert.ok(challenge.a >= MIN_OPERAND && challenge.a <= MAX_OPERAND);
      assert.ok(challenge.b >= MIN_OPERAND && challenge.b <= MAX_OPERAND);
    }
  }

  assert.deepEqual(generateChallenge(sequenceRandom([0, 1])), { a: 6, b: 12 });
  assert.deepEqual(generateChallenge(sequenceRandom([0.999999])), { a: 12, b: 12 });
  assert.deepEqual(generateChallenge(sequenceRandom([-1, 2])), { a: 6, b: 12 });
  assert.throws(() => generateChallenge('nope'), TypeError);
});

test('the challenge is distinct from the free levels arithmetic', () => {
  const freeLevels = LevelConfig.filter((level) => level.level <= 2);
  assert.ok(freeLevels.length > 0);
  const maxFreeResult = Math.max(...freeLevels.map((level) => level.maxResult));
  const freeOperations = new Set(freeLevels.flatMap((level) => level.operations));
  assert.deepEqual([...freeOperations], ['+']);
  assert.ok(maxFreeResult <= 12);

  // Multiplication of two operands >= 6 always exceeds the free levels.
  assert.ok(MIN_OPERAND * MIN_OPERAND > maxFreeResult);

  const challenge = { a: MIN_OPERAND, b: MIN_OPERAND };
  assert.equal(checkAnswer(challenge, challenge.a + challenge.b), false);
  assert.equal(checkAnswer(challenge, challenge.a * challenge.b), true);
});

test('questionText spells the operands out and never shows digits', () => {
  const challenge = { a: 6, b: 12 };

  assert.equal(questionText(challenge, 'en'), 'six times twelve');
  assert.equal(questionText(challenge, 'de'), 'sechs mal zwölf');
  assert.equal(questionText(challenge), 'six times twelve');
  assert.equal(questionText(challenge, 'fr'), 'six times twelve');

  for (const locale of SUPPORTED_LOCALES) {
    const text = questionText(challenge, locale);
    assert.doesNotMatch(text, /\d/);
    assert.doesNotMatch(text, /[+*×]/);
  }

  assert.throws(() => questionText({ a: 1, b: 12 }, 'en'), RangeError);
  assert.throws(() => questionText({ a: 6, b: 13 }, 'en'), RangeError);
});

test('checkAnswer accepts only the exact integer product', () => {
  const challenge = { a: 7, b: 8 };
  const product = 56;

  for (const answer of [product, String(product), `  ${product}  `]) {
    assert.equal(checkAnswer(challenge, answer), true);
  }
  for (const answer of [
    challenge.a + challenge.b,
    product - 1,
    product + 1,
    -product,
    `${product}.0`,
    `${product}abc`,
    '',
    '   ',
    'fifty-six',
    null,
    undefined,
    true,
    {},
    [],
  ]) {
    assert.equal(checkAnswer(challenge, answer), false, `rejects ${String(answer)}`);
  }
  assert.equal(checkAnswer(challenge, product + 0.5), false);
  assert.throws(() => checkAnswer({ a: 5, b: 8 }, product), RangeError);
});

test('buildGateMarkup is an accessible dialog without the answer', () => {
  const challenge = { a: 6, b: 12 };
  const markup = buildGateMarkup({ locale: 'en', challenge });
  const product = String(challenge.a * challenge.b);

  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-labelledby="parental-gate-title"/);
  assert.match(markup, /aria-describedby="parental-gate-description"/);
  assert.match(markup, /id="parental-gate-title"/);
  assert.match(markup, /id="parental-gate-description"/);
  assert.match(markup, /<label for="parental-gate-answer">/);
  assert.match(markup, /id="parental-gate-answer"/);
  assert.match(markup, /inputmode="numeric"/);
  assert.match(markup, /autocomplete="off"/);
  assert.match(markup, /type="submit"/);
  assert.match(markup, /type="button"/);
  assert.match(markup, /six times twelve/);
  assert.match(markup, /Parental gate/);
  assert.match(markup, /Ask an adult to solve this multiplication/);

  // The answer must not be rendered anywhere in the dialog.
  assert.ok(!markup.includes(product), 'markup does not contain the product');
  assert.ok(!markup.includes('value='), 'input starts empty');
  const questionParagraph = markup.match(/id="parental-gate-question"[^>]*>([^<]*)</)[1];
  assert.doesNotMatch(questionParagraph, /\d/);

  const german = buildGateMarkup({ locale: 'de', challenge });
  assert.match(german, /Elternkontrolle/);
  assert.match(german, /sechs mal zwölf/);
  assert.match(german, /Ergebnis eingeben/);
  assert.match(german, /Abbrechen/);

  assert.throws(() => buildGateMarkup({ locale: 'en', challenge: { a: 5, b: 6 } }), RangeError);
});

test('gate resolves true only for the exact product', async () => {
  const challenge = generateChallenge(sequenceRandom([0, 1])); // 6 x 12 = 72
  assert.deepEqual(challenge, { a: 6, b: 12 });

  const accepted = createFakeUi('72');
  assert.equal(await gate({ ui: accepted, random: sequenceRandom([0, 1]), locale: 'en', action: 'purchase' }), true);
  assert.equal(accepted.calls.length, 1);
  assert.equal(accepted.calls[0].action, 'purchase');
  assert.equal(accepted.calls[0].locale, 'en');
  assert.equal(accepted.calls[0].question, 'six times twelve');
  assert.deepEqual(accepted.calls[0].challenge, challenge);
  assert.ok(!accepted.calls[0].markup.includes('72'));

  const rejected = createFakeUi('18');
  assert.equal(await gate({ ui: rejected, random: sequenceRandom([0, 1]), action: 'restore' }), false);
  assert.equal(rejected.calls[0].action, 'restore');

  const german = createFakeUi('72');
  assert.equal(await gate({ ui: german, random: sequenceRandom([0, 1]), locale: 'de', action: 'external-link' }), true);
  assert.equal(german.calls[0].question, 'sechs mal zwölf');
  assert.match(german.calls[0].markup, /Elternkontrolle/);
});

test('gate treats dismissal as a failed check', async () => {
  const random = sequenceRandom([0]);
  assert.equal(await gate({ ui: createFakeUi(null), random }), false);
  assert.equal(await gate({ ui: createFakeUi(undefined), random }), false);

  const aborting = {
    async ask() {
      throw Object.assign(new Error('dismissed'), { name: 'AbortError' });
    },
  };
  assert.equal(await gate({ ui: aborting, random }), false);

  const cancelling = {
    async ask() {
      throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    },
  };
  assert.equal(await gate({ ui: cancelling, random }), false);
});

test('gate surfaces unexpected UI errors and validates its inputs', async () => {
  const failing = {
    async ask() {
      throw new Error('renderer exploded');
    },
  };
  await assert.rejects(gate({ ui: failing, random: sequenceRandom([0]) }), /renderer exploded/);

  await assert.rejects(gate({}), TypeError);
  await assert.rejects(gate({ ui: {} }), TypeError);
  await assert.rejects(gate({ ui: createFakeUi('36'), action: 'checkout' }), RangeError);

  assert.deepEqual([...GATED_ACTIONS], ['purchase', 'restore', 'external-link']);
});
