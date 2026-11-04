import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

const draft = await readFile(new URL('../docs/store-listing.md', import.meta.url), 'utf8');

function field(name) {
  const start = draft.indexOf(`### ${name}\n`);
  assert.ok(start >= 0, `missing concrete listing field: ${name}`);
  const text = draft.slice(start + `### ${name}\n`.length).split(/^#{2,3} /m)[0].trim();
  assert.ok(text, `empty listing field: ${name}`);
  return text;
}

test('store drafts contain concrete App Store German fields within actual limits', () => {
  for (const [name, maximum] of [['Name', 30], ['Subtitle', 30], ['Keywords', 100], ['Description', 4000]]) {
    const text = field(name);
    assert.ok([...text].length <= maximum, `${name}: ${[...text].length} > ${maximum}`);
  }
  const description = field('Description');
  assert.match(description, /kostenlos im Browser/);
  assert.match(description, /Nicht jedes Gerät/);
  assert.match(description, /Einmal kaufen/);
  assert.match(field('German review-note draft'), /TestFlight/);
});

test('store drafts contain usable Google Play title and short-description text', () => {
  for (const language of ['German', 'English']) {
    assert.ok([...field(`${language} title`)].length <= 30);
    assert.ok([...field(`${language} short description`)].length <= 80);
  }
  const description = field('English full description');
  assert.ok([...description].length <= 4000);
  assert.match(description, /free in the browser/);
  assert.match(description, /not available on every device/);
  assert.match(draft, /Nothing in this file has been published/);
});
