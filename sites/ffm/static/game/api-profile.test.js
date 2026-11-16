// api-profile.test.js — api.updateProfile body shapes, with a fake window and fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { location: { origin: 'http://x' } };
const bodies = [];
globalThis.fetch = async (_url, opts) => {
  bodies.push(JSON.parse(opts.body));
  return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } };
};

const { api } = await import('./api.js');

async function sent(arg) {
  bodies.length = 0;
  await api.updateProfile(arg);
  assert.equal(bodies.length, 1);
  return bodies[0];
}

test('legacy year argument sends only first_grade_year', async () => {
  assert.deepEqual(await sent(2012), { first_grade_year: 2012 });
  assert.deepEqual(await sent(null), { first_grade_year: null });
});

test('object argument sends only the keys present', async () => {
  assert.deepEqual(await sent({ hero: 'monk' }), { hero: 'monk' });
  assert.deepEqual(await sent({ hero: null }), { hero: null });
  assert.deepEqual(await sent({ firstGradeYear: 2012 }), { first_grade_year: 2012 });
  assert.deepEqual(await sent({ firstGradeYear: 2012, hero: 'monk' }), { first_grade_year: 2012, hero: 'monk' });
});
