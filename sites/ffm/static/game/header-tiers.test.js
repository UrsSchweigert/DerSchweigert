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

test('no reveal row is reserved, so the header has no standing empty line', () => {
  // The correction replaces the question instead of a line reserved below it:
  // a reserved row left a gap in the header for the whole level.
  assert.doesNotMatch(css, /#gameplay-feedback/, 'the reveal element is gone');
  assert.doesNotMatch(html, /id="gameplay-feedback"/, 'and so is its markup');
  assert.match(css, /\.gameplay-readouts > span:empty \{ visibility: hidden; \}/,
    'an empty marker keeps its cell so the line count cannot change');
});

test('the question rows are reserved per mode on both builds', () => {
  // Shapes asks a question and shows the shapes, so it reserves two rows for
  // the whole level; the campaign asks one problem question and reserves one.
  // Both stylesheets must turn the same marker into a fixed height.
  assert.match(appCss, /#gameplay-chrome\[data-question-rows="2"\] #active-question \{\s*min-height: 52px;/,
    'the app keeps two 26px rows between problems and during the reveal');
  assert.match(css, /#gameplay-chrome\[data-question-rows="2"\] #active-question \{ min-height: 56px; \}/,
    'the web keeps two 28px rows');
  assert.match(css, /#gameplay-chrome\[data-question-rows="1"\] #active-question \{\s*white-space: nowrap;/,
    'the campaign question is one line that cannot wrap into a second one');
});

test('the shapes question is drawn as two unbroken rows on the web too', () => {
  assert.match(css, /#active-question\[data-shapes-header="two-rows"\] \{\s*display: grid;\s*grid-template-rows: auto auto;/,
    'the two rows are a grid, not a wrapped sentence');
  const row = css.match(/#active-question\[data-shapes-header="two-rows"\] > span \{([^}]*)\}/)?.[1];
  assert.ok(row, 'each row needs its own rule');
  assert.match(row, /white-space: nowrap;/, 'a shape row never breaks between symbols');
  assert.match(row, /overflow-wrap: normal;/);
});

test('the readout row cannot reflow between problems', () => {
  // As a wrapping flex row, a shorter value ("Time —" between problems instead
  // of "Time 12s") packed one more marker into the first line and the header
  // lost a whole line - 22px on a phone, which relaid the scene out.
  const rule = css.match(/^\.gameplay-readouts \{([^}]*)\}/m)?.[1];
  assert.ok(rule, 'readout rule missing');
  assert.match(rule, /display: grid;/, 'a grid, so the line count is width-only');
  assert.match(rule, /grid-template-columns: repeat\(auto-fit, minmax\(106px, 1fr\)\);/);
  assert.doesNotMatch(rule, /flex-wrap/, 'no wrapping that follows the content');
});

test('the correction cannot run under the help and pause buttons', () => {
  assert.match(css, /#active-question:not\(\[data-shapes-header\]\) \{\s*white-space: nowrap;\s*overflow: hidden;\s*text-overflow: ellipsis;/,
    'the answer row stops at the buttons in both modes');
});

test('the mode marker is level-scoped and published on every build', () => {
  const chrome = readFileSync(new URL('./gameplay-chrome.js', import.meta.url), 'utf8');
  assert.match(chrome, /function setQuestionReserve\(shapesLevel\)/);
  assert.match(chrome, /const value = shapesLevel \? '2' : '1';/);
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
