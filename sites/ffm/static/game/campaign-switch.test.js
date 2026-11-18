// campaign-switch.test.js — the campaign choice belongs to the player, the app keeps the
// switch on the Players page and the web in the account profile, Campaign II is offered with
// no level-40 gate, and the title shows the Campaign II picture only to a player who chose it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCampaignSelection, SELECTION_KEY_PREFIX, campaignDragon, campaignDragonSrc } from './campaign2/selection.js';

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
  assert.match(html, /<button type="button" id="campaign-emblem" class="campaign-emblem" data-title-target="family" data-dragon="ancient" hidden/);
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

test('the switch and the picture scale with the space they get, dragons included', () => {
  const rules = css.slice(css.indexOf('.campaign-switch {'), css.indexOf('/* end campaign switch */'));
  assert.match(rules, /container-type: inline-size;/);
  // One height drives everything; the switch follows its column and the viewport height.
  assert.match(rules, /\.campaign-switch-btn \{\s*--switch-h: clamp\([^;]*cqi[^;]*vh[^;]*\);/);
  assert.match(rules, /\.campaign-emblem \{\s*--switch-h: clamp\([^;]*vmin[^;]*\);/);
  // The dragons' outer halves stay inside the column (the old small-screen overflow).
  assert.match(rules, /width: min\(calc\(100% - 2 \* var\(--dragon-out\)\), 440px\);/);
  assert.match(rules, /max-width: calc\(100% - 2 \* var\(--dragon-out\)\);/);
  // The text clears the dragons and fits in the frame, the overhang has its room.
  assert.match(rules, /padding-inline: calc\(var\(--dragon-w\) \* 0\.55\);/);
  assert.match(rules, /margin-block: calc\(var\(--switch-h\) \* \(var\(--dragon-scale\) - 1\) \/ 2\);/);
  assert.match(rules, /\.campaign-switch-title \{[^}]*font-size: calc\(var\(--switch-h\) \* 0\.31\);/);
  // Pieces are placed with translate, never transform (the reduced-motion rule resets transform).
  assert.match(rules, /\.campaign-switch-dragon--left \{ left: 0; translate: -45% -50%; \}/);
  assert.match(rules, /\.campaign-switch-dragon--right \{ right: 0; translate: 45% -50%; \}/);
  assert.doesNotMatch(rules, /(^|[^-])transform:/m);
  assert.match(rules, /@container \(max-width: 300px\)/, 'a 320px phone gets smaller dragons, not clipped text');
});

test('the title picture is three quarters of its first size, proportions and tap area kept', () => {
  // The owner asked for the dragon picture on the title 25% smaller. Its size was
  // clamp(38px, 9vmin, 60px) with the shared 44px floor; every bound shrinks by a quarter.
  const rules = css.slice(css.indexOf('.campaign-switch {'), css.indexOf('/* end campaign switch */'));
  const emblem = rules.match(/\n\.campaign-emblem \{([^}]*)\}/)[1];
  const [, low, fluid, high] = emblem.match(/--switch-h: clamp\(([\d.]+)px, ([\d.]+)vmin, ([\d.]+)px\);/).map(Number);
  assert.deepEqual([low, fluid, high], [38 * 0.75, 9 * 0.75, 60 * 0.75]);
  assert.match(emblem, new RegExp(`min-height: ${44 * 0.75}px;`));
  // The dragons keep their size relative to the frame (the shared 1.75x / 2.1x scales and the
  // 45% overhang), so only --switch-h changes.
  assert.doesNotMatch(emblem, /--dragon-scale/);
  // Still a 44px tap target, and the text keeps a readable floor that fits the 33px frame.
  assert.match(rules, /\.campaign-emblem::after \{[^}]*position: absolute;[^}]*inset: -6px 0;/);
  const eyebrow = Number(rules.match(/\.campaign-emblem \.campaign-switch-eyebrow \{ font-size: max\(([\d.]+)px/)[1]);
  const title = Number(rules.match(/\.campaign-emblem \.campaign-switch-title \{ font-size: max\(([\d.]+)px/)[1]);
  assert.ok(eyebrow >= 7 && title >= 11, 'readable');
  assert.ok((eyebrow + title) * 1.15 + 12 <= 44 * 0.75, 'both lines fit inside the double frame');
  // The switch itself (Players page / account profile) keeps its size.
  assert.match(rules, /\.campaign-switch-btn \{\s*--switch-h: clamp\(56px, min\(16cqi, 13vh\), 80px\);/);
});

test('the right dragon frames each campaign, and every piece exists', () => {
  assert.deepEqual(campaignDragon(1), { kind: 'young', width: 402, height: 480 });
  assert.deepEqual(campaignDragon(2), { kind: 'ancient', width: 354, height: 480 });
  assert.equal(campaignDragon(undefined).kind, 'young', 'anything but Campaign II is Campaign I');
  for (const campaign of [1, 2]) {
    const { kind, width, height } = campaignDragon(campaign);
    for (const side of ['left', 'right']) {
      const src = campaignDragonSrc(kind, side);
      const file = readFileSync(new URL(`../${src}`, import.meta.url));
      // RIFF....WEBP, and the VP8X canvas size matches the declared width/height.
      assert.equal(file.toString('latin1', 0, 4), 'RIFF', src);
      assert.equal(file.toString('latin1', 8, 12), 'WEBP', src);
      if (file.toString('latin1', 12, 16) === 'VP8X') {
        assert.equal(file.readUIntLE(24, 3) + 1, width, `${src} width`);
        assert.equal(file.readUIntLE(27, 3) + 1, height, `${src} height`);
      }
    }
  }
  // The markup starts in Campaign I (young) on the switch; the title picture is Campaign II (ancient).
  const button = html.slice(html.indexOf('id="genius-campaign-btn"'), html.indexOf('</button>', html.indexOf('id="genius-campaign-btn"')));
  assert.match(html, /id="genius-campaign-btn" class="campaign-switch-btn" data-dragon="young"/);
  assert.match(button, /src="game\/art\/ui\/campaign-dragon-young-left\.webp" alt="" width="402" height="480"/);
  assert.match(button, /src="game\/art\/ui\/campaign-dragon-young-right\.webp" alt="" width="402" height="480"/);
  const emblem = html.slice(html.indexOf('id="campaign-emblem"'), html.indexOf('</button>', html.indexOf('id="campaign-emblem"')));
  assert.match(emblem, /campaign-dragon-ancient-left\.webp" alt="" width="354" height="480"/);
  assert.match(emblem, /campaign-dragon-ancient-right\.webp" alt="" width="354" height="480"/);
  // main.js swaps the pair with the campaign the button names.
  assert.match(main, /const dragon = campaignDragon\(selectedCampaign\);[\s\S]{0,500}piece\.src = campaignDragonSrc\(dragon\.kind, side\);/);
  assert.match(css, /\[data-dragon="ancient"\] \{\s*--dragon-scale: 2\.1;\s*--dragon-aspect: 0\.7375;/);
  assert.doesNotMatch(html, /campaign-switch-dragon--mirror|campaign-switch-dragon" src="game\/intro-replay/);
});

test('the web profile that holds the switch scrolls instead of cutting it off', () => {
  // A phone held sideways, a short window or the desktop phone frame is shorter than the
  // Profile tab (email form, campaign switch, hero picker): the card itself scrolls.
  assert.match(css, /#account-modal \.overlay-card \{ overflow-y: auto;/);
  assert.match(css, /#account-modal \.overlay-card > \* \{ flex-shrink: 0; \}/);
});
