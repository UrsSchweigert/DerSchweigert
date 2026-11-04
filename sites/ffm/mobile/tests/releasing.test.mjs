// releasing.test.mjs — asserts the release handover (requirement 5.3).
//
// RELEASING.md is the only handover from this repository to a store release.
// It must stay concrete (asset sync, tests, versioning, signing-secret names,
// product id, store checklist, sandbox and install procedures, App Review
// notes) and it must never present an unproven gate as done: the Linux checker
// cannot sign, upload, install or observe a device, so every manual gate keeps
// a revision placeholder and the state `open`, and M1-M4 stay open owner
// actions until their evidence exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASING = 'RELEASING.md';
const doc = await readFile(join(root, RELEASING), 'utf8');

// Rows of the first markdown table that follows `heading`, as trimmed cells.
function tableAfter(heading) {
  const start = doc.indexOf(heading);
  assert.notEqual(start, -1, `RELEASING.md must contain "${heading}"`);
  const rows = [];
  let inTable = false;
  for (const line of doc.slice(start + heading.length).split('\n')) {
    if (!line.trim().startsWith('|')) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    rows.push(cells);
  }
  assert.ok(rows.length > 1, `RELEASING.md must contain the "${heading}" table`);
  return rows;
}

test('the handover documents asset sync, tests and versioning', () => {
  for (const heading of [
    '## Asset sync',
    '## Tests',
    '## Versioning',
    '## Signing secrets',
    '## Product and store setup checklist',
    '## Sandbox procedure',
    '## Internal track install',
    '## TestFlight install',
    '## App Review notes',
    '## Manual gate checklist',
    '## Open owner actions',
  ]) {
    assert.ok(doc.includes(heading), `RELEASING.md must keep the "${heading}" section`);
  }

  for (const command of [
    'npm ci',
    'npm run copy-assets',
    'node scripts/bundle-check.mjs',
    'npm test',
    'npm run build:release',
  ]) {
    assert.ok(doc.includes(command), `RELEASING.md must document \`${command}\``);
  }

  for (const version of [
    'versionCode',
    'versionName',
    'MARKETING_VERSION',
    'CURRENT_PROJECT_VERSION',
  ]) {
    assert.ok(doc.includes(version), `RELEASING.md must document ${version}`);
  }
  // A version must strictly increase for every upload, including re-uploads.
  assert.match(doc, /strictly increase/i);
});

test('the handover keeps the signing secrets, product id and store checklist concrete', () => {
  for (const secret of [
    'FFM_KEYSTORE_FILE',
    'FFM_KEYSTORE_PASSWORD',
    'FFM_KEY_ALIAS',
    'FFM_KEY_PASSWORD',
  ]) {
    assert.ok(doc.includes(secret), `RELEASING.md must name the ${secret} secret`);
  }
  // Secrets stay out of the repository; only names are recorded.
  assert.doesNotMatch(doc, /BEGIN (RSA |EC )?PRIVATE KEY/);

  assert.ok(doc.includes('arithmoslayer_full_unlock'), 'the product id must be recorded');
  assert.match(doc, /non-consumable/i);
  assert.match(doc, /Play Console/);
  assert.match(doc, /App Store Connect/);
  assert.match(doc, /In-App Purchase capability/);
  assert.match(doc, /licen[cs]e testers/i);
  assert.match(doc, /Data safety/i);
});

test('every required manual gate stays open with a revision placeholder', () => {
  const [header, ...rows] = tableAfter('## Manual gate checklist');
  assert.deepEqual(header, ['Gate', 'Where', 'Evidence', 'Revision', 'State']);

  const gates = [
    ['sandbox purchase', /^sandbox purchase through the parental gate$/i],
    ['restore on a fresh install', /restore purchase on a fresh install/i],
    ['Ask-to-Buy / pending purchase', /ask-to-buy/i],
    ['cancelled purchase', /cancelled purchase/i],
    ['refund / revocation', /refund \/ revocation/i],
    ['offline launch after purchase', /offline launch/i],
    ['Android Back behaviour', /android back/i],
    ['iOS silent switch', /silent switch/i],
    ['Android interruption', /interruption \(call\/background\)/i],
    ['iOS audio interruption', /audio interruption/i],
    ['safe areas on notched devices', /notch/i],
    ['upgrade install keeps progress and unlock', /upgrade install/i],
  ];

  for (const [name, pattern] of gates) {
    const matches = rows.filter((row) => pattern.test(row[0]));
    assert.equal(matches.length, 1, `the manual gate checklist must have one "${name}" row`);
    const [, , , revision, state] = matches[0];
    assert.equal(revision, '`<revision>`', `the "${name}" gate must keep a revision placeholder`);
    assert.equal(state, 'open', `the "${name}" gate must stay open until evidenced`);
  }

  // No gate may be recorded as passed from this repository.
  for (const row of rows) {
    assert.equal(row[4], 'open', `the "${row[0]}" gate must stay open`);
  }
});

test('M1-M4 and the owner store actions stay open until evidenced', () => {
  const start = doc.indexOf('## Open owner actions');
  assert.notEqual(start, -1, 'RELEASING.md must keep the open owner actions section');
  const ownerActions = doc.slice(start);

  for (const milestone of ['M1', 'M2', 'M3', 'M4']) {
    assert.match(ownerActions, new RegExp(`^- \\*\\*${milestone}\\b`, 'm'), `${milestone} must be listed`);
  }
  for (const action of [
    'smoke.json',
    'ffm-native.yml',
    'signingConfigs',
    'In-App Purchase capability',
    'Play Console',
    'App Store Connect',
    'review submission',
  ]) {
    assert.ok(ownerActions.includes(action), `the owner actions must cover ${action}`);
  }

  // Nothing in the handover may claim a signed build, install or submission.
  assert.doesNotMatch(doc, /\|\s*(done|passed|signed|uploaded)\s*\|\s*$/i);
  assert.match(doc, /owner action/i);
});
