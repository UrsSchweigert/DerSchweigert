import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { t, setLocale } from './i18n.js';
import { highScoreTrend, runningBestTrend } from './score-trend.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const renderers = source.slice(source.indexOf('function formatTrendDate('),
  source.indexOf('function renderLevelJumpOptions('));

function render(history, locale = 'en', response = { history }) {
  setLocale(locale);
  const container = { style: {}, innerHTML: '' };
  vm.runInNewContext(`${renderers}\nrenderScoreHistory(response, container);`, {
    response, container, t, runningBestTrend,
    escHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  });
  return container;
}

test('empty progress explains how to record a first result in either language', () => {
  for (const locale of ['en', 'de']) {
    const chart = render([], locale);
    assert.equal(chart.style.display, '');
    assert.ok(chart.innerHTML.includes(t('scoreHistory.empty')));
    assert.doesNotMatch(chart.innerHTML, /<svg/);
  }
});

test('one completed level has a visible marker, score scale and explicit score/count', () => {
  const chart = render([{ score: 1200 }]);
  assert.match(chart.innerHTML, /r="4"/);
  assert.match(chart.innerHTML, />1200<\/text>/);
  assert.match(chart.innerHTML, /High score: 1200/);
  assert.match(chart.innerHTML, /Saved results: 1/);
  assert.doesNotMatch(chart.innerHTML, /polyline|NaN|Infinity/);
});

test('zero, equal and changing scores retain finite plotted points and ordered history', () => {
  for (const scores of [[0], [0, 0], [1200, 1200], [0, 1200, 300]]) {
    const chart = render(scores.map(score => ({ score })), 'de');
    assert.equal((chart.innerHTML.match(/<circle /g) ?? []).length, scores.length);
    assert.equal(chart.innerHTML.includes('<polyline'), scores.length > 1);
    assert.match(chart.innerHTML, new RegExp(`Highscore: ${Math.max(...scores)}`));
    assert.doesNotMatch(chart.innerHTML, /NaN|Infinity/);
  }
});

test('unfinished attempts are labelled without presenting them as clears', () => {
  const cleared = render([{ score: 1200 }]);
  assert.ok(!cleared.innerHTML.includes(t('scoreHistory.unfinishedNote')));

  const mixed = render([{ score: 1200 }, { score: 400, unfinished: true }]);
  assert.ok(mixed.innerHTML.includes(t('scoreHistory.unfinishedNote')));
  assert.match(mixed.innerHTML, /High score: 1200/, 'a lower later result keeps the high score');
  assert.match(mixed.innerHTML, /Saved results: 2/);
  assert.equal((mixed.innerHTML.match(/<circle /g) ?? []).length, 2);
});

test('web history plots the best score so far, never a drop', () => {
  const chart = render([
    { score: 500, achieved_at: '2026-11-01T10:00:00Z' },
    { score: 200, achieved_at: '2026-11-02T10:00:00Z' },
    { score: 900, achieved_at: '2026-11-05T10:00:00Z' },
  ]);
  const ys = [...chart.innerHTML.matchAll(/<circle cx="[^"]+" cy="([^"]+)"/g)].map(match => Number(match[1]));
  assert.equal(ys.length, 3);
  assert.equal(ys[0], ys[1], 'a lower result keeps the line flat');
  assert.ok(ys[2] < ys[1], 'a new best raises the line');
  assert.match(chart.innerHTML, />900<\/text>/);
  assert.match(chart.innerHTML, /High score: 900/);
  assert.doesNotMatch(chart.innerHTML, />3<\/text>/, 'the x-axis shows dates, not result numbers');
});

function plottedPoints(chart) {
  return [...chart.innerHTML.matchAll(/<circle cx="([^"]+)" cy="([^"]+)"/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
}

test('each result is plotted on its day, so real gaps stay visible', () => {
  const chart = render([
    { score: 500, achieved_at: '2026-11-01T10:00:00Z' },
    { score: 600, achieved_at: '2026-11-02T10:00:00Z' },
    { score: 900, achieved_at: '2026-11-11T10:00:00Z' },
  ]);
  const [first, second, third] = plottedPoints(chart);
  // Plot area runs from x=54 to x=288; one day of ten is 23.4px, nine are 210.6px.
  assert.ok(Math.abs(first.x - 54) < 0.2, 'the oldest result sits on the left axis');
  assert.ok(Math.abs(second.x - 77.4) < 0.2, 'the next day is one tenth along the axis');
  assert.ok(Math.abs(third.x - 288) < 0.2, 'the newest result sits on the right axis');
  assert.ok(third.x - second.x > 5 * (second.x - first.x) + 50, 'nine days are wider than one');
});

test('results recorded on the same day stay on that day, not spread over the axis', () => {
  const chart = render([
    { score: 100, achieved_at: '2026-11-01T08:00:00Z' },
    { score: 200, achieved_at: '2026-11-01T16:00:00Z' },
    { score: 300, achieved_at: '2026-11-15T16:00:00Z' },
  ]);
  const [first, second, third] = plottedPoints(chart);
  assert.ok(second.x > first.x, 'a later result of the same day is not drawn before an earlier one');
  assert.ok(second.x - first.x < 15, 'same-day results stay within one day of the axis');
  assert.ok(third.x - second.x > 10 * (second.x - first.x), 'the two-week gap dominates');
});

test('histories without timestamps keep even spacing', () => {
  const points = plottedPoints(render([{ score: 10 }, { score: 20 }, { score: 30 }]));
  assert.deepEqual(points.map((point) => point.x), [54, 171, 288]);
});

test('the app chart shows the total high score trend with its own label', () => {
  const history = [
    { level: 1, score: 300, achieved_at: '2026-11-01T10:00:00Z' },
    { level: 2, score: 400, achieved_at: '2026-11-02T10:00:00Z' },
  ];
  for (const locale of ['en', 'de']) {
    const chart = render(null, locale, { trend: highScoreTrend(history, []) });
    assert.ok(chart.innerHTML.includes(t('scoreHistory.totalHighScore', { score: 700, count: 2 })));
    assert.match(chart.innerHTML, />700<\/text>/);
  }
});

test('main.js feeds the app progress chart the total high score trend', () => {
  assert.match(source, /renderScoreHistory\(\{ trend: highScoreTrend\(state\?\.history \|\| \[\], best\) \}, personalScoreHistoryChart\)/);
});
