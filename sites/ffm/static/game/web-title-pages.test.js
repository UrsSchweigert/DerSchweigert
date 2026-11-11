import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLocale, t } from './i18n.js';

const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
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

test('the web Terms tab mirrors the app legal navigation stack', () => {
  const legalTab = html.match(/<section data-title-page="legal"[\s\S]*?<\/section>/)?.[0];
  assert.ok(legalTab, 'legal title page missing');
  assert.doesNotMatch(legalTab, /·/, 'stacked links need no inline separators');
  const block = styles.match(/:root\[data-platform="web"\] \.splash-legal-links \{[\s\S]*?\n\}/)?.[0];
  assert.ok(block, 'web legal stack missing');
  assert.match(block, /flex-direction: column;/);
  assert.match(block, /width: min\(100%, 560px\);/);
  assert.match(styles, /:root\[data-platform="web"\] \.splash-legal-links a,[\s\S]*?min-height: 44px/);
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

test('the web title screen announces both stores and the app bundle drops them', () => {
  const play = html.match(/<section data-title-page="play"[\s\S]*?\n      <\/section>/)?.[0];
  assert.ok(play, 'the play title page exists');
  const block = play.match(/<!-- app-omit:start -->([\s\S]*?<!-- app-omit:end -->)/g)
    ?.map((region) => region).find((region) => region.includes('splash-store-row'));
  assert.ok(block, 'the store row sits inside an app-omit region');
  assert.match(block, /class="splash-store-row"/);
  assert.match(block, /data-i18n-aria-label="splash.storesLabel"/);
  assert.match(block, /promo\/art\/ui\/badge-appstore\.svg/);
  assert.match(block, /promo\/art\/ui\/badge-playstore\.svg/);
  assert.match(block, /data-i18n="splash.storeAppStore"/);
  assert.match(block, /data-i18n="splash.storePlayStore"/);
  assert.doesNotMatch(block, /<a\b/, 'nothing is linked until the listings are live');
  assert.doesNotMatch(play, /<a\b[^>]*apple\.com/, 'no live App Store link yet');
  assert.doesNotMatch(play, /<a\b[^>]*play\.google\.com/, 'no live Play link yet');
  assert.match(styles, /\.splash-store-badge\.store-badge--pending \{ border-style: dashed; \}/,
    'pending badges stay quiet: dashed, not a solid call to action');
  assert.match(styles, /\.title-play \{ display: grid; grid-template-rows: auto minmax\(0, 1fr\) auto; \}/,
    'the third row holds the store badges');
});

test('the store badge copy exists in both languages', () => {
  setLocale('en');
  assert.equal(t('splash.storeAppStore'), 'Soon in the App Store');
  assert.equal(t('splash.storePlayStore'), 'Soon on Google Play');
  assert.ok(t('splash.storesLabel').length > 0);
  setLocale('de');
  assert.equal(t('splash.storeAppStore'), 'Bald im App Store');
  assert.equal(t('splash.storePlayStore'), 'Bald bei Google Play');
  assert.ok(t('splash.storesLabel').length > 0);
  setLocale('en');
});
