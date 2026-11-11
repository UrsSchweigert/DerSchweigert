// header-tiers.test.js — the gameplay header keeps one height, and the button
// and paging affordances that identify the important controls.
//
// The header sits above the playfield and viewport-layout.js lays the scene out
// from its measured height, so any header that grows or shrinks rescales the
// whole board. These tests pin that the reveal line is reserved on every build
// and that the app reserves the two-row Shapes question for the whole level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../../mobile/game/mobile-ui.css', import.meta.url), 'utf8');

test('the reveal line is reserved instead of collapsing when it is empty', () => {
  const rule = css.match(/^#gameplay-feedback \{([^}]*)\}/m)?.[1];
  assert.ok(rule, 'gameplay feedback rule missing');
  assert.match(rule, /min-height:\s*20px;/, 'one line stays reserved');
  assert.doesNotMatch(rule, /display:\s*none/);
  assert.match(css, /^#gameplay-feedback:empty \{ visibility: hidden; \}/m,
    'empty feedback hides without giving up its row');
  assert.match(css, /\.gameplay-readouts > span:empty \{ display: none; \}/,
    'the readouts still collapse when they are empty');
});

test('the app reserves the two-row Shapes question for the whole level', () => {
  assert.match(appCss, /#gameplay-chrome\[data-two-row-question="true"\] #active-question \{\s*min-height: 52px;/,
    'two 26px rows stay reserved between problems and during the reveal');
});

test('the two-row question marker is app-only and level-scoped', () => {
  const chrome = readFileSync(new URL('./gameplay-chrome.js', import.meta.url), 'utf8');
  assert.match(chrome, /function setQuestionReserve\(shapesLevel\)/);
  assert.match(chrome, /const value = shapesHeader && shapesLevel \? 'true' : 'false';/);
  assert.match(chrome, /setQuestionReserve\(!!state\.isShapesMode\);/,
    'every update republishes the level-scoped reservation');
});

test('paging controls draw a direction triangle without extra text', () => {
  const previous = css.match(/button\[data-page-direction="previous"\]::before \{([^}]*)\}/)?.[1];
  const next = css.match(/button\[data-page-direction="next"\]::before \{([^}]*)\}/)?.[1];
  assert.ok(previous && next, 'both triangle rules exist');
  assert.match(previous, /border-right: 7px solid var\(--brass-light\);/);
  assert.match(next, /border-left: 7px solid var\(--brass-light\);/);
  const base = css.match(/button\[data-page-direction\]::before \{([^}]*)\}/)?.[1];
  assert.ok(base, 'the shared triangle box exists');
  assert.match(base, /content: '';/, 'a drawn box, not a glyph');
  assert.match(base, /border-top: 5px solid transparent;/);
  for (const id of ['leaderboard-prev', 'leaderboard-next', 'personal-best-prev', 'personal-best-next']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*data-page-direction="(?:previous|next)"`), id);
    const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>([\\s\\S]*?)</button>`));
    assert.equal(tag?.[1]?.trim(), '', `${id} keeps an empty label for the drawn triangle`);
  }
});

test('the primary and danger tiers are visibly different from quiet buttons', () => {
  const primary = css.match(/:is\(\.action-primary,[^{]*\) \{([^}]*)\}/)?.[1];
  assert.ok(primary, 'primary tier rule missing');
  assert.match(primary, /border: 2px solid #f7e2a4;/, 'a thicker line marks the primary action');
  const marker = css.match(/:is\(\.action-primary,[^{]*\)::before \{([^}]*)\}/)?.[1];
  assert.ok(marker, 'primary buttons carry a graphic marker');
  assert.match(marker, /transform: rotate\(45deg\);/, 'the marker is a drawn diamond');
  const danger = css.match(/:is\(\.action-danger, #btn-pause-discard\) \{([^}]*)\}/)?.[1];
  assert.ok(danger, 'danger tier rule missing');
  assert.match(danger, /border: 2px solid #d0675c;/);
  assert.match(html, /class="diff-btn action-danger" id="btn-pause-discard"/,
    'discarding a score is the danger choice in the pause flow');
  assert.match(html, /class="action-primary" data-i18n="practice.start"/,
    'starting a practice session stays the primary play action');
});
