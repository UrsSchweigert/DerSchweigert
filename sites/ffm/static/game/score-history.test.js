import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { t, setLocale } from './i18n.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const renderers = source.slice(source.indexOf('function buildScoreHistorySvg('),
  source.indexOf('function renderLevelJumpOptions('));

function render(history, locale = 'en') {
  setLocale(locale);
  const container = { style: {}, innerHTML: '' };
  vm.runInNewContext(`${renderers}\nrenderScoreHistory({ history }, container);`, {
    history, container, t,
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
  assert.match(chart.innerHTML, /Latest score: 1200/);
  assert.match(chart.innerHTML, /Saved results: 1/);
  assert.doesNotMatch(chart.innerHTML, /polyline|NaN|Infinity/);
});

test('zero, equal and changing scores retain finite plotted points and ordered history', () => {
  for (const scores of [[0], [0, 0], [1200, 1200], [0, 1200, 300]]) {
    const chart = render(scores.map(score => ({ score })), 'de');
    assert.equal((chart.innerHTML.match(/<circle /g) ?? []).length, scores.length);
    assert.equal(chart.innerHTML.includes('<polyline'), scores.length > 1);
    assert.match(chart.innerHTML, new RegExp(`Letzte Punktzahl: ${scores.at(-1)}`));
    assert.doesNotMatch(chart.innerHTML, /NaN|Infinity/);
  }
});

test('unfinished attempts are labelled without presenting them as clears', () => {
  const cleared = render([{ score: 1200 }]);
  assert.ok(!cleared.innerHTML.includes(t('scoreHistory.unfinishedNote')));

  const mixed = render([{ score: 1200 }, { score: 400, unfinished: true }]);
  assert.ok(mixed.innerHTML.includes(t('scoreHistory.unfinishedNote')));
  assert.match(mixed.innerHTML, /Latest score: 400/);
  assert.match(mixed.innerHTML, /Saved results: 2/);
  assert.equal((mixed.innerHTML.match(/<circle /g) ?? []).length, 2);
});
