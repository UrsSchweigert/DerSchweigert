import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('../../mobile/game/mobile-ui.css', import.meta.url), 'utf8');

const rule = (selector) => {
  const start = styles.lastIndexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} rule missing`);
  return styles.slice(start, styles.indexOf('}', start));
};

test('the splash grid fills the band on both platforms, app included', () => {
  // The old flex rule's justify-content: center survived into the grid and
  // shrank the column to each page's content, so the app's menu pages were
  // narrower than the play page.
  assert.match(styles,
    /\.splash-content \{[^}]*display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\);\s*justify-content: stretch;/);
});

test('every menu page is one scrolling sheet instead of a nested list', () => {
  const sheet = rule('.title-page:not(.title-play)');
  assert.match(sheet, /height: auto;/);
  assert.match(sheet, /max-height: 100%;/);
  assert.match(sheet, /align-self: center;/);
  assert.match(sheet, /overflow-y: auto;/);
  assert.match(sheet, /overscroll-behavior: contain;/);
  assert.match(styles, /\.title-pages \{ display: grid; \}/);

  // The list no longer clips: a long leaderboard extends the sheet.
  assert.match(rule('.leaderboard-list'), /overflow: visible;/);
  assert.doesNotMatch(rule('.splash-leaderboard'), /flex: 1;/,
    'a zero-basis flex item collapses inside an auto-height sheet');
});

test('the practice submenu is the page, so its own height never clips it', () => {
  const open = rule('#practice-panel[open]');
  assert.match(open, /display: block;/);
  assert.match(open, /flex: 0 0 auto;/);
  assert.doesNotMatch(open, /flex: 1;/,
    'a flex <details> is sized by its ::details-content wrapper and clipped Start/Back');
  assert.doesNotMatch(rule('#practice-panel[open] .practice-controls'), /overflow-y:/);
  assert.match(styles, /@media \(orientation: portrait\) \{[\s\S]*?\.practice-controls \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test('the app legal stack becomes two columns in a short landscape band', () => {
  const block = mobileCss.match(/@media \(orientation: landscape\) and \(max-height: 460px\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(block, 'landscape legal rule missing');
  assert.match(block, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  // The web build keeps its own single-column stack at normal sizes; only a
  // short landscape band turns it into two columns.
  const webStack = styles.match(/:root\[data-platform="web"\] \.splash-legal-links \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(webStack, 'web legal stack missing');
  assert.match(webStack, /flex-direction: column;/);
});
