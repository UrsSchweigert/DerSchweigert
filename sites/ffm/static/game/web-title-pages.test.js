import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLocale, t } from './i18n.js';

const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('main.js marks the root element as web or app before rendering', () => {
  assert.match(main, /document\.documentElement\.dataset\.platform = platform\.isApp \? 'app' : 'web';/);
});

test('web title pages share one centred width, scoped to the web build only', () => {
  const block = styles.match(/:root\[data-platform="web"\] \.splash-content \{[^}]*\}/)?.[0];
  assert.ok(block, 'web splash-content override missing');
  assert.match(block, /grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(block, /justify-content: stretch;/);
  assert.match(styles, /:root\[data-platform="web"\] \.title-pages,\s*:root\[data-platform="web"\] \.title-navigation \{[^}]*width: min\(100%, 560px\);/);
  assert.doesNotMatch(styles, /:root\[data-platform="app"\]/);
});

test('the web 📈 history page is filled from the account score history', () => {
  const body = main.match(/function renderWebHistoryPage\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(body, 'renderWebHistoryPage missing');
  assert.match(body, /if \(platform\.isApp\) return;/);
  assert.match(body, /scoreHistory\.loginRequired/);
  assert.match(body, /renderScoreHistory\(webScoreHistory, personalScoreHistoryChart\)/);
  assert.match(body, /renderPersonalBest\(currentProfile, personalCompletedOverview\)/);
  const refresh = main.match(/async function refreshProfileAndLeaderboard\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.equal((refresh.match(/renderWebHistoryPage\(\);/g) || []).length, 2, 'guest and logged-in paths both render it');
  assert.match(main, /onLocaleChange\(\(\) => \{[\s\S]*?renderWebHistoryPage\(\);/);
});

test('the web history login hint is translated', () => {
  setLocale('de');
  const de = t('scoreHistory.loginRequired');
  setLocale('en');
  const en = t('scoreHistory.loginRequired');
  assert.notEqual(en, 'scoreHistory.loginRequired');
  assert.notEqual(de, en);
});
