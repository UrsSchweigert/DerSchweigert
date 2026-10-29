import test from 'node:test';
import assert from 'node:assert/strict';

import { load, validate, stageOf, unitsOf, MAX_WORDS } from '../tools/validate_sentences.mjs';

for (const lang of ['de', 'en']) {
  test(lang + ': the committed sentence pool is consistent', () => {
    const data = load(lang);
    assert.deepEqual(validate(lang, data), []);
    assert.equal(data.sentences.length, 1000);
  });

  test(lang + ': every sentence is readable in some selection and short enough', () => {
    const data = load(lang);
    for (const entry of data.sentences) {
      assert.ok(stageOf(entry.text, lang), entry.id + ' is readable in no selection');
      assert.ok(entry.text.trim().split(/\s+/).length <= MAX_WORDS, entry.id + ' is too long');
      assert.ok(unitsOf(entry.text, lang).length > 0, entry.id + ' has no units');
    }
  });

  test(lang + ': both languages cover the whole ladder', () => {
    const data = load(lang);
    const stages = new Set(data.sentences.map((entry) => entry.stage));
    for (const stage of ['S0', 'S1', 'S2', 'S3']) assert.ok(stages.has(stage), lang + ' has no ' + stage + ' sentence');
  });
}

test('the tokenizer decides the stage, not the punctuation or the case', () => {
  assert.equal(stageOf('Mama malt.', 'de'), 'S0');
  assert.equal(stageOf('mama malt', 'de'), 'S0');
  assert.equal(stageOf('Das Kind antwortet.', 'de'), 'S1');
  assert.equal(stageOf('Das Brot ist frisch.', 'de'), 'S2');
  assert.equal(stageOf('Das Eichhörnchen sammelt Nüsse.', 'de'), 'S3');
  assert.equal(stageOf('A man naps.', 'en'), 'S0');
  assert.equal(stageOf('The moon is bright.', 'en'), 'S2');
});
