import test from 'node:test';
import assert from 'node:assert/strict';
import { highestLevelRow, scrollRowToTop, scrollToHighestLevel } from './scroll-focus.js';

const row = (level, offsetTop) => ({ dataset: { level: String(level) }, offsetTop, offsetParent: null });
const list = rows => ({ scrollTop: 99, offsetTop: 0, offsetParent: null, querySelectorAll: () => rows });

test('the highest level row is found regardless of order', () => {
  const rows = [row(2, 0), row(7, 40), row(3, 80)];
  assert.equal(highestLevelRow(list(rows)), rows[1]);
});

test('scrolling puts the highest level at the top of the list', () => {
  const container = list([row(1, 0), row(5, 120), row(2, 60)]);
  assert.equal(scrollToHighestLevel(container), true);
  assert.equal(container.scrollTop, 120);
});

test('no scored level starts at the top', () => {
  const container = list([]);
  assert.equal(scrollToHighestLevel(container), false);
  assert.equal(container.scrollTop, 0);
});

test('missing container or row is a no-op', () => {
  assert.equal(scrollRowToTop(null, row(1, 0)), false);
  assert.equal(scrollRowToTop(list([]), null), false);
  assert.equal(highestLevelRow(null), null);
});
