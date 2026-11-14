import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createGameplayChrome } from './gameplay-chrome.js';
import { bonusForLevel } from './bonus-ladder.js';
import { _resetForTests, setLocale, t } from './i18n.js';

const ABILITY_NAMES = { wind: 'Wind', storm: 'Storm', earth: 'Earth' };

function makeElement() {
  return {
    textContent: '',
    hidden: true,
    style: {},
    dataset: {},
    setAttribute(name, value) { this.attrs = { ...(this.attrs || {}), [name]: String(value) }; },
    removeAttribute(name) { if (this.attrs) delete this.attrs[name]; },
    getAttribute(name) { return this.attrs ? this.attrs[name] ?? null : null; },
  };
}

function fixture({ translate } = {}) {
  const elements = Object.fromEntries(['gameplay-chrome', 'bonus-notice']
    .map((id) => [id, makeElement()]));
  const doc = { getElementById: (id) => elements[id], createElement: makeElement };
  const chrome = createGameplayChrome({ doc, translate });
  return { chrome, notice: elements['bonus-notice'] };
}

test('level 1 grants no bonus and leaves no notice', () => {
  const { chrome, notice } = fixture();
  assert.equal(bonusForLevel(1), null);
  assert.equal(chrome.showBonusNotice(bonusForLevel(1)), false);
  assert.equal(notice.hidden, true);
  assert.equal(notice.textContent, '');
});

test('every bonus level shows exactly one notice naming the ability and value', () => {
  const calls = [];
  const translate = (key, vars) => {
    calls.push([key, vars]);
    if (key.startsWith('ability.')) return ABILITY_NAMES[key.split('.')[1]];
    if (key.startsWith('bonus.')) return `NOTICE ${key} ${vars.ability} ${vars.value}`;
    return undefined;
  };
  const { chrome, notice } = fixture({ translate });

  for (const level of [2, 3, 6, 7, 12, 13, 60]) {
    const bonus = bonusForLevel(level);
    const ability = ABILITY_NAMES[bonus.abilityId];
    calls.length = 0;

    assert.equal(chrome.showBonusNotice(bonus), true, `level ${level}`);
    assert.equal(notice.hidden, false, `level ${level} shows the pill`);
    assert.equal(notice.textContent,
      `NOTICE bonus.${bonus.type}.notice ${ability} ${bonus.value}`,
      `level ${level} names the ability and value once`);
    assert.deepEqual(calls, [
      [`ability.${bonus.abilityId}.name`, undefined],
      [`bonus.${bonus.type}.notice`, { ability, value: bonus.value }],
    ], `level ${level} uses the localized notice key`);
  }
});

test('the notice counts down twelve seconds of gameplay time', () => {
  const { chrome, notice } = fixture();
  chrome.showBonusNotice(bonusForLevel(7));

  chrome.tickBonusNotice(11.9);
  assert.equal(notice.hidden, false, 'still readable before twelve seconds');
  chrome.tickBonusNotice(0.1);
  assert.equal(notice.hidden, true, 'hidden at twelve seconds');
  assert.equal(notice.textContent, '');
});

test('pause freezes the countdown until gameplay resumes', () => {
  const { chrome, notice } = fixture();
  chrome.showBonusNotice(bonusForLevel(12));

  assert.equal(chrome.tickBonusNotice(3, { paused: true }), 12);
  chrome.tickBonusNotice(11.9, { paused: true });
  assert.equal(notice.hidden, false, 'paused time never burns the notice');

  chrome.tickBonusNotice(11.9);
  assert.equal(notice.hidden, false);
  chrome.tickBonusNotice(0.1);
  assert.equal(notice.hidden, true);
});

test('a level change replaces the previous bonus and clears it when none is granted', () => {
  const { chrome, notice } = fixture();
  chrome.showBonusNotice(bonusForLevel(2));
  const first = notice.textContent;
  assert.match(first, /Wind/);

  chrome.showBonusNotice(bonusForLevel(7));
  assert.equal(notice.hidden, false);
  assert.notEqual(notice.textContent, first);
  assert.match(notice.textContent, /Storm/);

  chrome.showBonusNotice(null);
  assert.equal(notice.hidden, true);
  assert.equal(notice.textContent, '');
});

test('clearBonusNotice hides and empties the pill immediately', () => {
  const { chrome, notice } = fixture();
  chrome.showBonusNotice(bonusForLevel(13));
  assert.equal(notice.hidden, false);
  chrome.clearBonusNotice();
  assert.equal(notice.hidden, true);
  assert.equal(notice.textContent, '');
});

test('english fallbacks keep the pill readable without a translator', () => {
  const { chrome, notice } = fixture();
  const expected = new Map([
    [2, 'Bonus: Wind cooldown −6s'],
    [7, 'Bonus: Storm +1 rank'],
    [12, 'Bonus: Earth slows fiends by 0.05'],
    [13, 'Bonus: Earth +1 spike target'],
  ]);
  for (const [level, text] of expected) {
    chrome.showBonusNotice(bonusForLevel(level));
    assert.equal(notice.textContent, text, `level ${level}`);
  }
});

test('the shipped en/de strings reach the pill through the real translator', () => {
  _resetForTests();
  try {
    const { chrome, notice } = fixture({ translate: t });
    setLocale('en');
    chrome.showBonusNotice(bonusForLevel(2));
    assert.equal(notice.textContent, 'Bonus: Wind cooldown −6s');

    setLocale('de');
    chrome.showBonusNotice(bonusForLevel(7));
    assert.equal(notice.textContent, 'Bonus: Sturm +1 Rang');
  } finally {
    _resetForTests();
  }
});

test('the host is a polite status region inside #gameplay-chrome', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const sectionStart = html.indexOf('<section id="gameplay-chrome"');
  const sectionEnd = html.indexOf('</section>', sectionStart);
  const tag = html.match(/<p id="bonus-notice"[^>]*>/)?.[0];
  assert.ok(tag, 'the bonus notice element exists');
  assert.equal((html.match(/id="bonus-notice"/g) || []).length, 1,
    'exactly one notice host');

  const noticeIndex = html.indexOf(tag);
  assert.ok(noticeIndex > sectionStart && noticeIndex < sectionEnd,
    'the notice lives inside the shared gameplay chrome');
  assert.match(tag, /role="status"/);
  assert.match(tag, /aria-live="polite"/);
  assert.match(tag, /aria-atomic="true"/);
  assert.match(tag, /\bhidden\b/);
  assert.ok(html.indexOf('id="mc-buttons"') > sectionEnd,
    'the answer row stays outside the chrome and cannot be pushed by the notice');
});

test('the pill is absolutely positioned so it adds no row', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const chromeRule = css.match(/#gameplay-chrome\s*\{[^}]*\}/)?.[0] || '';
  assert.match(chromeRule, /position:\s*relative/,
    'the chrome anchors the absolutely positioned notice');
  const noticeRule = css.match(/#bonus-notice\s*\{[^}]*\}/)?.[0] || '';
  assert.match(noticeRule, /position:\s*absolute/);
  assert.match(noticeRule, /pointer-events:\s*none/);
});

test('landscape keeps the pill inside the scene, clear of the answer panel', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const landscape = css.match(/#game-wrap\[data-layout="landscape"\] #bonus-notice\s*\{[^}]*\}/)?.[0];
  assert.ok(landscape, 'the landscape rule exists');
  // The answers paint over the header in landscape (z-index 20 against the
  // pill's 2), so the pill is clamped to the scene column instead of the
  // header: its right edge stops one answer column plus a gap short of the
  // header's.
  assert.match(landscape, /right:\s*calc\(var\(--answer-width\)/);
  assert.match(landscape, /max-width:\s*calc\(var\(--scene-width\)/);
  assert.match(landscape, /margin-inline:\s*auto/);
  assert.match(landscape, /transform:\s*none/);
});

test('main.js flies the bonus glow into the orb the bonus strengthened', async () => {
  const source = await readFile(new URL('./main.js', import.meta.url), 'utf8');
  const flow = source.match(/function playBonusFlow\(bonus\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(flow, 'playBonusFlow must exist');
  assert.match(flow, /ability-slot\[data-ability="\$\{abilityId\}"\]/,
    'it targets the orb by the bonus ability id');
  assert.match(flow, /worldFromPoint/, 'it converts the measured boxes into world space');
  assert.match(flow, /play\('bonusFlow'/, 'it plays the bonusFlow recipe');

  const finish = source.match(/function finishStartLevel\([\s\S]*?\n\}/)?.[0];
  assert.match(finish, /showBonusNotice\?\.\(bonus\) && bonus/,
    'the flow only runs for a levied bonus that actually showed a notice');
  assert.match(finish, /playBonusFlow\(bonus\)/);
});

test('main.js announces the level bonus once, ticks it and clears it', async () => {
  const source = await readFile(new URL('./main.js', import.meta.url), 'utf8');
  const finish = source.match(/function finishStartLevel\([\s\S]*?\n\}/)?.[0];
  assert.ok(finish, 'finishStartLevel must exist');
  assert.match(finish, /bonusForLevel\(cfg\.level\)/);
  assert.match(finish, /showBonusNotice\?\.\(bonus\)/);
  assert.match(finish, /practiceRun/);

  const loop = source.match(/function gameLoop\(ts\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(loop, 'gameLoop must exist');
  assert.match(loop, /tickBonusNotice\?\.\(dt, \{ paused \}\)/);

  const clear = source.match(/function triggerLevelClear\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(clear, 'triggerLevelClear must exist');
  assert.match(clear, /clearBonusNotice\?\.\(\)/);
});

test('absent DOM remains a no-op', () => {
  const chrome = createGameplayChrome({ doc: null });
  assert.doesNotThrow(() => {
    chrome.showBonusNotice(bonusForLevel(7));
    chrome.tickBonusNotice(1, { paused: false });
    chrome.clearBonusNotice();
  });
});
