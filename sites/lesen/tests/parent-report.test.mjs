import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

import {
  buildReport,
  toCsv,
  REPORT_FILENAME,
  MAX_CARD_PRACTICE_MS,
  PRACTICE_TIME_KEY,
} from '../static/parent-report.mjs';
import * as platform from '../static/platform.mjs';

const goldenUrl = new URL('./fixtures/parent-report.golden.csv', import.meta.url);

test('parent report: empty progress produces an empty summary and a total-only CSV', () => {
  const report = buildReport({}, 0);

  assert.deepEqual(report.cards, []);
  assert.deepEqual(report.totals, {
    cards: 0,
    correct: 0,
    incorrect: 0,
    attempts: 0,
    accuracy: 0,
    practiceMs: 0,
    practiceSeconds: 0,
  });
  assert.equal(
    toCsv(report),
    'card,correct,incorrect,attempts,accuracy_percent,practice_seconds\n"Total",0,0,0,0.0,0\n',
  );
});

test('parent report: cards are sorted and accuracy is computed per card and in total', () => {
  const report = buildReport(
    {
      Papa: { correct_count: 2, incorrect_count: 0 },
      Mama: { correct_count: 3, incorrect_count: 1 },
      Oma: { correct_count: 0, incorrect_count: 2 },
    },
    125000,
  );

  assert.deepEqual(report.cards.map((row) => row.card), ['Mama', 'Oma', 'Papa']);
  assert.deepEqual(report.cards[0], {
    card: 'Mama',
    correct: 3,
    incorrect: 1,
    attempts: 4,
    accuracy: 75,
  });
  assert.equal(report.cards[1].accuracy, 0);
  assert.equal(report.cards[2].accuracy, 100);
  assert.deepEqual(report.totals, {
    cards: 3,
    correct: 5,
    incorrect: 3,
    attempts: 8,
    accuracy: 62.5,
    practiceMs: 125000,
    practiceSeconds: 125,
  });
});

test('parent report: accuracy never divides by zero', () => {
  const report = buildReport({ Leer: { correct_count: 0, incorrect_count: 0 } }, 0);

  assert.deepEqual(report.cards, []);
  assert.equal(report.totals.accuracy, 0);
  assert.equal(report.totals.attempts, 0);
});

test('parent report: malformed counters and documents are ignored safely', () => {
  const report = buildReport(
    {
      Mama: { correct_count: '3', incorrect_count: '1' },
      Kaputt: { correct_count: -5, incorrect_count: Number.NaN },
      Text: { correct_count: 'viele', incorrect_count: null },
      Liste: [1, 2, 3],
      Nichts: null,
      '': { correct_count: 1, incorrect_count: 0 },
    },
    'not-a-duration',
  );

  assert.deepEqual(report.cards, [
    { card: 'Mama', correct: 3, incorrect: 1, attempts: 4, accuracy: 75 },
  ]);
  assert.equal(report.totals.attempts, 4);
  assert.equal(report.totals.practiceMs, 0);
  assert.equal(report.totals.practiceSeconds, 0);
});

test('parent report: non-object documents read as an empty report', () => {
  for (const value of [null, undefined, [], 'cards', 42]) {
    const report = buildReport(value, 0);
    assert.deepEqual(report.cards, []);
    assert.equal(report.totals.attempts, 0);
  }
});

test('parent report: CSV quotes delimiters, quotes and newlines in card texts', () => {
  const csv = toCsv(
    buildReport(
      {
        'Mama, "die" Ärztin\nliest': { correct_count: 1, incorrect_count: 0 },
        'Papa;Oma': { correct_count: 0, incorrect_count: 1 },
      },
      2000,
    ),
  );

  assert.ok(
    csv.includes('"Mama, ""die"" Ärztin\nliest",1,0,1,100.0,'),
    `expected a quoted, escaped card row in:\n${csv}`,
  );
  assert.ok(csv.includes('"Papa;Oma",0,1,1,0.0,'), csv);
  assert.equal(csv.trimEnd().split('\n').at(-1), '"Total",1,1,2,50.0,2');
});

test('parent report: CSV bytes match the golden fixture', async () => {
  const report = buildReport(
    {
      Mama: { correct_count: 3, incorrect_count: 1 },
      Oma: { correct_count: 0, incorrect_count: 2 },
      Papa: { correct_count: 2, incorrect_count: 0 },
    },
    125000,
  );

  const golden = await readFile(goldenUrl, 'utf8');
  assert.equal(toCsv(report), golden);
});

test('parent report: repeated builds and exports are deterministic', () => {
  const cards = {
    Zebra: { correct_count: 1, incorrect_count: 2 },
    Affe: { correct_count: 4, incorrect_count: 0 },
  };

  const first = toCsv(buildReport(cards, 4200));
  const second = toCsv(buildReport(cards, 4200));

  assert.equal(first, second);
  assert.equal(first.indexOf('"Affe"') < first.indexOf('"Zebra"'), true);
});

test('parent report: building and formatting never opens a network connection', () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    throw new Error('the report must not use the network');
  };
  try {
    const csv = toCsv(buildReport({ Mama: { correct_count: 1, incorrect_count: 0 } }, 1000));
    assert.ok(csv.startsWith('card,correct,incorrect,attempts,accuracy_percent,practice_seconds\n'));
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = previous;
    }
  }
});

test('parent report: index.html wires the footer export button to the report helpers', async () => {
  const html = await readFile(new URL('../static/index.html', import.meta.url), 'utf8');

  assert.match(html, /id="export-report"/);
  assert.match(html, /id="report-status"/);
  assert.match(html, /from '\.\/platform\.mjs'/);
  assert.match(html, /window\.__platform\.export\.save\(/);
  assert.match(html, /report\.export_failed/);
});

test('parent report: index.html shows an in-app report card with CSV export from the card', async () => {
  const html = await readFile(new URL('../static/index.html', import.meta.url), 'utf8');

  assert.match(html, /<dialog id="report-dialog"/);
  assert.match(html, /id="report-summary"/);
  assert.match(html, /id="report-cards"/);
  assert.match(html, /id="report-accuracy"/);
  assert.match(html, /id="report-time"/);
  assert.match(html, /id="report-table"/);
  assert.match(html, /id="report-rows"/);
  assert.match(html, /id="report-export"/);
  assert.match(html, /byId\('export-report'\)[\s\S]*?report-dialog/);
  assert.match(html, /byId\('report-export'\)[\s\S]*?window\.__platform\.export\.save\(/);
  assert.match(html, /id="footer-report-label"/);
  assert.match(html, /id="toggle-haptics"/);
});

test('parent report: entry point re-exports the platform contract', () => {
  assert.equal(buildReport, platform.buildReport);
  assert.equal(toCsv, platform.toCsv);
  assert.equal(REPORT_FILENAME, platform.REPORT_FILENAME);
  assert.equal(MAX_CARD_PRACTICE_MS, platform.MAX_CARD_PRACTICE_MS);
  assert.equal(PRACTICE_TIME_KEY, platform.PRACTICE_TIME_KEY);
  assert.match(REPORT_FILENAME, /\.csv$/);
  assert.ok(MAX_CARD_PRACTICE_MS > 0);
});
