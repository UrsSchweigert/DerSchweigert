// campaign-switch.test.js — the campaign choice belongs to the player, the app keeps the
// switch on the Players page and the web in the account profile, Campaign II is offered with
// no level-40 gate, and the title shows the Campaign II picture only to a player who chose it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCampaignSelection, SELECTION_KEY_PREFIX } from './campaign2/selection.js';

const i18n = readFileSync(new URL('./i18n.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test('each player keeps their own campaign choice', () => {
  const storage = memoryStorage();
  const ada = createCampaignSelection({ storage, playerId: 'ada' });
  const ben = createCampaignSelection({ storage, playerId: 'ben' });
  assert.equal(ada.get(), 1, 'every player starts in Campaign I');
  ada.set(2);
  assert.equal(ada.get(), 2);
  assert.equal(ben.get(), 1, 'a sibling is not dropped into Campaign II');
  assert.equal(storage.data.get(`${SELECTION_KEY_PREFIX}ada`), '2');
  ada.set(1);
  assert.equal(ada.get(), 1);
  assert.equal(storage.data.has(`${SELECTION_KEY_PREFIX}ada`), false, 'Campaign I is the default, nothing stored');
});

test('storage failures read as Campaign I and never throw', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
  const selection = createCampaignSelection({ storage: broken, playerId: 'x' });
  assert.equal(selection.get(), 1);
  assert.doesNotThrow(() => selection.set(2));
});

test('main.js reloads the choice for the active player and stores every switch', () => {
  assert.match(main, /function loadCampaignSelection\(\) \{\s*selectedCampaign = campaignSelection\(\)\.get\(\);/);
  assert.match(main, /function chooseCampaign\(campaign\) \{[\s\S]*?campaignSelection\(\)\.set\(selectedCampaign\);/);
  // App: on launch and on every player switch; web: on login and logout.
  const ensure = main.slice(main.indexOf('const ensureLocalProfiles'), main.indexOf('ensureLocalProfiles().then'));
  assert.equal((ensure.match(/loadCampaignSelection\(\);/g) ?? []).length, 2);
  assert.match(main, /function applyAuthUIState\(\) \{[\s\S]*?loadCampaignSelection\(\);/);
  // The switch never assigns the campaign behind the store's back.
  const handler = main.slice(main.indexOf("getElementById('genius-campaign-btn')?.addEventListener"));
  assert.doesNotMatch(handler.slice(0, handler.indexOf('renderCampaignSwitch();')), /selectedCampaign = /);
});

test('the app moves the switch onto the Players page, the web into the account profile', () => {
  assert.match(main, /if \(platform\.isApp\) \{[\s\S]{0,200}familyPage\.insertBefore\(switchWrap, document\.getElementById\('entitlement-root'\)\)/);
  assert.match(main, /\} else \{[\s\S]{0,200}profilePanel\.insertBefore\(switchWrap, document\.getElementById\('account-hero-picker'\)\)/);
  assert.match(html, /id="account-profile-panel"[\s\S]*id="account-hero-picker"/);
});

test('Campaign II is offered with no level gate and no reveal flag', () => {
  // Owner decision after #586: Campaign II is independent of Campaign I.
  assert.doesNotMatch(main, /noteGeniusProgress|geniusReveal|geniusEarned|geniusButtonVisible|campaign2\/genius\.js/);
  assert.match(main, /const visible = campaignSwitchVisible\(\{/);
  assert.doesNotMatch(html, /level 40/i, 'no markup comment promises a level-40 reveal');
});

test('the title shows the Campaign II picture only while it is chosen, and it leads to the switch', () => {
  assert.match(html, /<button type="button" id="campaign-emblem" class="campaign-emblem" data-title-target="family" hidden/);
  assert.match(main, /emblem\.hidden = wrap\.hidden \|\| selectedCampaign !== 2;/);
  // The web has no Players page: the picture opens the account profile that holds the switch.
  assert.match(main, /emblem\.removeAttribute\('data-title-target'\);[\s\S]{0,400}showAccountTab\(tabAccountProfile, accountProfilePanel\);/);
  assert.match(i18n, /'campaign\.emblem\.web': \{ en: '[^']*profile[^']*', de: '[^']*Profil[^']*' \}/);
});

test('the switch names the campaign being played, with dragons and in the menu colours', () => {
  assert.match(html, /id="genius-title" data-i18n="campaign\.switch\.title1">Arithmetic</);
  assert.equal((html.match(/class="campaign-switch-dragon/g) ?? []).length, 4, 'two dragons on the switch, two on the picture');
  for (const key of ['eyebrow1', 'eyebrow2', 'title1', 'title2', 'toGenius', 'toArithmetic', 'unlock']) {
    assert.match(i18n, new RegExp(`'campaign\\.switch\\.${key}': \\{ en: '[^']+', de: '[^']+' \\}`), key);
  }
  assert.match(i18n, /'campaign\.switch\.title1': \{ en: 'Arithmetic',/);
  // No purple left: the switch uses the brass and forest of every other menu control.
  const rules = css.slice(css.indexOf('.campaign-switch {'));
  assert.doesNotMatch(rules.slice(0, rules.indexOf('/* end campaign switch */')), /#7c4dff|#cdb6ff|purple/i);
});

test('the switch and the picture scale with the space they get', () => {
  const rules = css.slice(css.indexOf('.campaign-switch {'), css.indexOf('/* end campaign switch */'));
  assert.match(rules, /\.campaign-switch-btn \{[^}]*max-width: 100%;/);
  assert.match(rules, /\.campaign-switch-title \{[^}]*font-size: clamp\(/);
  assert.match(rules, /container-type: inline-size;/);
});

test('the web profile that holds the switch scrolls instead of cutting it off', () => {
  // A phone held sideways, a short window or the desktop phone frame is shorter than the
  // Profile tab (email form, campaign switch, hero picker): the card itself scrolls.
  assert.match(css, /#account-modal \.overlay-card \{ overflow-y: auto;/);
  assert.match(css, /#account-modal \.overlay-card > \* \{ flex-shrink: 0; \}/);
});
