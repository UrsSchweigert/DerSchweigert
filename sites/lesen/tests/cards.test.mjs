import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getSoundsForLanguage } from '../static/sounds.mjs';
import { classifySentence } from '../static/coverage.mjs';
import {
  isSentenceReadable,
  readableSentenceCards,
  readableSentenceTexts,
  buildSentenceDeck,
  createSentenceSelection,
} from '../static/sentences/cards.mjs';

const poolOf = (lang) =>
  JSON.parse(readFileSync(new URL(`../static/sentences/${lang}.json`, import.meta.url), 'utf8')).sentences;

const selection = (consonants = [], vowels = [], specials = []) => ({ consonants, vowels, specials });

const fullSelection = (lang) => {
  const sounds = getSoundsForLanguage(lang);
  return selection(sounds.consonants, sounds.vowels, sounds.specials);
};

test('a sentence is offered only when every unit of every word is selected', () => {
  assert.equal(isSentenceReadable('Mama malt.', selection(['m', 'l', 't'], ['a']), 'de'), true);
  assert.equal(isSentenceReadable('Mama malt.', selection(['m', 'l'], ['a']), 'de'), false);
  assert.equal(isSentenceReadable('Mama malt.', selection(), 'de'), false);
});

test('a missing sound unit blocks the whole sentence', () => {
  const withoutSh = selection(['s', 'l'], ['e']);
  const withSh = selection(['s', 'l'], ['e'], ['sh']);
  assert.equal(isSentenceReadable('She sells shells.', withoutSh, 'en'), false);
  assert.equal(isSentenceReadable('She sells shells.', withSh, 'en'), true);
});

test('blank and empty texts are never readable', () => {
  const full = fullSelection('de');
  for (const entry of ['', '   ', '\n\t', null, undefined, {}, { text: '' }]) {
    assert.equal(isSentenceReadable(entry, full, 'de'), false);
  }
});

test('readableSentenceCards keeps pool order and drops the rest', () => {
  const pool = [
    { id: 'a', text: 'Mama malt.' },
    { id: 'b', text: 'Das Brot ist frisch.' },
    'A man naps.',
    { id: 'd', text: 'Oma mag Mama.' },
  ];
  const offered = readableSentenceCards(pool, selection(['m', 'l', 't', 'o', 'g'], ['a']), 'de');
  assert.deepEqual(offered.map((entry) => entry.text ?? entry), ['Mama malt.', 'Oma mag Mama.']);
  assert.deepEqual(readableSentenceTexts(pool, selection(['m', 'l', 't', 'o', 'g'], ['a']), 'de'), [
    'Mama malt.',
    'Oma mag Mama.',
  ]);
});

test('readableSentenceCards tolerates a missing pool', () => {
  for (const pool of [null, undefined, {}, 'Mama malt.', 42]) {
    assert.deepEqual(readableSentenceCards(pool, fullSelection('de'), 'de'), []);
  }
});

for (const lang of ['de', 'en']) {
  test(`${lang}: the whole pool is offered once every unit is selected`, () => {
    const pool = poolOf(lang);
    const offered = readableSentenceCards(pool, fullSelection(lang), lang);
    assert.ok(pool.length > 0, `${lang} pool should not be empty`);
    assert.equal(offered.length, pool.length);
    assert.deepEqual(
      offered.map((entry) => entry.text),
      pool.map((entry) => entry.text),
    );
  });

  test(`${lang}: offered sentences are exactly the readable ones`, () => {
    const pool = poolOf(lang);
    const sounds = getSoundsForLanguage(lang);
    const partial = selection(sounds.consonants.slice(0, 6), sounds.vowels.slice(0, 2), sounds.specials.slice(0, 2));
    const offered = readableSentenceTexts(pool, partial, lang);
    const expected = pool.filter((entry) => classifySentence(entry.text, partial, lang).readable);
    assert.deepEqual(offered, expected.map((entry) => entry.text));
    assert.ok(offered.length < pool.length, `${lang} selection offers everything`);
    for (const text of offered) {
      assert.equal(classifySentence(text, partial, lang).readable, true, text + ' is offered but not readable');
    }
  });

  test(`${lang}: nothing is offered without a single selected unit`, () => {
    assert.deepEqual(readableSentenceCards(poolOf(lang), selection(), lang), []);
  });
}

test('buildSentenceDeck keeps only the chosen, still readable sentences', () => {
  const pool = poolOf('de');
  const full = fullSelection('de');
  const chosen = readableSentenceTexts(pool, full, 'de').slice(0, 4);
  const deck = buildSentenceDeck(pool, full, 'de', chosen, () => 0.5);
  assert.equal(deck.length, chosen.length);
  assert.deepEqual(deck.map((card) => card.text).sort(), [...chosen].sort());
  for (const card of deck) {
    assert.equal(card.kind, 'sentence');
    assert.equal(card.misses, 0);
  }
});

test('buildSentenceDeck drops a chosen card whose units were removed', () => {
  const pool = [{ id: 'a', text: 'Mama malt.' }];
  assert.deepEqual(buildSentenceDeck(pool, selection(['m', 'l', 't'], ['a']), 'de', ['Mama malt.']), [
    { text: 'Mama malt.', kind: 'sentence', misses: 0 },
  ]);
  assert.deepEqual(buildSentenceDeck(pool, selection(['m', 'l'], ['a']), 'de', ['Mama malt.']), []);
});

test('buildSentenceDeck ignores unknown and duplicate choices', () => {
  const pool = [{ id: 'a', text: 'Mama malt.' }];
  const full = selection(['m', 'l', 't'], ['a']);
  const deck = buildSentenceDeck(pool, full, 'de', ['Mama malt.', 'Mama malt.', 'Nicht im Pool.'], () => 0);
  assert.equal(deck.length, 1);
  assert.equal(deck[0].text, 'Mama malt.');
  assert.deepEqual(buildSentenceDeck(pool, full, 'de', []), []);
  assert.deepEqual(buildSentenceDeck(pool, full, 'de', undefined), []);
});

test('buildSentenceDeck shuffles but never invents cards', () => {
  const pool = [
    { id: 'a', text: 'Mama malt.' },
    { id: 'b', text: 'Oma mag Mama.' },
    { id: 'c', text: 'Das Brot ist frisch.' },
  ];
  const full = fullSelection('de');
  const chosen = pool.map((entry) => entry.text);
  const deck = buildSentenceDeck(pool, full, 'de', chosen);
  assert.deepEqual(deck.map((card) => card.text).sort(), [...chosen].sort());
});

test('the selection adds, removes and counts sentence cards', () => {
  const cards = createSentenceSelection();
  assert.equal(cards.count(), 0);
  assert.deepEqual(cards.texts(), []);

  assert.equal(cards.add('Mama malt.'), true);
  assert.equal(cards.add('Mama malt.'), false);
  assert.equal(cards.add('Oma mag Mama.'), true);
  assert.equal(cards.count(), 2);
  assert.deepEqual(cards.texts(), ['Mama malt.', 'Oma mag Mama.']);
  assert.equal(cards.has('Mama malt.'), true);
  assert.equal(cards.has('Das Brot ist frisch.'), false);

  assert.equal(cards.remove('Mama malt.'), true);
  assert.equal(cards.remove('Mama malt.'), false);
  assert.equal(cards.count(), 1);

  assert.equal(cards.toggle('Oma mag Mama.'), false);
  assert.equal(cards.count(), 0);
  assert.equal(cards.toggle('Mama malt.'), true);
  assert.equal(cards.has('Mama malt.'), true);

  cards.clear();
  assert.equal(cards.count(), 0);
});

test('the selection ignores empty texts', () => {
  const cards = createSentenceSelection();
  for (const text of ['', null, undefined, 7]) {
    assert.equal(cards.add(text), false);
    assert.equal(cards.toggle(text), false);
  }
  assert.equal(cards.count(), 0);
});

test('the selection drops cards the new letter selection cannot read', () => {
  const cards = createSentenceSelection();
  cards.add('Mama malt.');
  cards.add('Oma mag Mama.');
  const dropped = cards.retain(['Oma mag Mama.']);
  assert.deepEqual(dropped, ['Mama malt.']);
  assert.deepEqual(cards.texts(), ['Oma mag Mama.']);
  assert.deepEqual(cards.retain(['Oma mag Mama.']), []);
  assert.deepEqual(cards.retain(), ['Oma mag Mama.']);
  assert.equal(cards.count(), 0);
});

const setupHtml = readFileSync(new URL('../static/index.html', import.meta.url), 'utf8');

test('the Karten tab offers a sentence mode with a live count', () => {
  assert.match(setupHtml, /input type="radio" name="mode" value="SENTENCES"/);
  assert.match(setupHtml, /id="sentences-match-count"/);
  assert.match(setupHtml, /id="mode-sentences-title"/);
  assert.doesNotMatch(setupHtml, /class="letter-group sentence-group"/);
});

test('the setup screen offers and practises the filtered sentence pool', () => {
  assert.match(setupHtml, /from '\.\/sentences\/cards\.mjs'/);
  assert.match(setupHtml, /readableSentenceCards\(pool, currentSelection\(\), lang\)/);
  assert.match(setupHtml, /\.\/sentences\/\$\{lang\}\.json/);
  assert.match(setupHtml, /window\.__scoring\.buildSentenceOnlyDeck\(/);
  assert.match(setupHtml, /byId\('sentences-match-count'\)\.textContent = cards\.length/);
});
