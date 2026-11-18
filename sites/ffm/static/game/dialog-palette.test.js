// dialog-palette.test.js — the web account and login dialogs wear the game's forest and
// brass, and their close X never sits on top of a tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// The last rule for a selector wins: the declarations of the last block whose selector list
// is exactly `header`, or (prefix: true) starts with it.
function lastBlock(header, { prefix = false } = {}) {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tail = prefix ? '[^{}\\n]*' : '\\s*';
  const blocks = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}${tail}\\{([^}]*)\\}`, 'g'))];
  assert.ok(blocks.length, `${header} has a rule`);
  return blocks.at(-1)[1];
}

test('the selected dialog tab looks like the selected title tab, not indigo', () => {
  const nav = lastBlock('.title-navigation button[aria-pressed="true"]', { prefix: true });
  const active = lastBlock('.tab-btn.active');
  for (const declaration of ['border-color: var(--brass-light)', 'background: linear-gradient(145deg, #3e6247, #203b2e)']) {
    assert.ok(nav.includes(declaration), `title tab: ${declaration}`);
    assert.ok(active.includes(declaration), `dialog tab: ${declaration}`);
  }
  assert.match(lastBlock('.tab-btn'), /border: 2px solid var\(--brass-deep\)/);
  for (const block of [active, lastBlock('.tab-btn'), lastBlock('.tab-btn:hover')]) {
    assert.doesNotMatch(block, /#40[0-9a-f]{2}[a-f0-9]{2}|#2a2a5a|#3a3a6a|#6060d0/i, 'no indigo left');
  }
});

// The owner's request after #590: the X gets its own reserved space, so nothing can ever be
// laid out under it. #590 only kept a corner free with a margin on the tab rows.
test('every dialog close X sits in a row of its own, above all content', () => {
  // Each X is the first child of its card in the real markup...
  const cards = {
    'account-modal': 'close-account', 'auth-modal': 'close-auth',
    'checkout-modal': 'close-checkout', 'auth-status-modal': 'close-auth-status',
  };
  for (const [modal, close] of Object.entries(cards)) {
    assert.match(html, new RegExp(`<div id="${modal}" class="overlay"[^>]*>\\s*<div class="overlay-card">\\s*<button id="${close}"[^>]*>×</button>`), modal);
  }
  // ...and a static flex item (not absolutely placed) at the start of the column.
  const close = lastBlock(':is(#account-modal, #auth-modal, #checkout-modal, #auth-status-modal) :is(.close-btn, #close-auth)');
  assert.match(close, /position: static;/);
  assert.match(close, /align-self: flex-end;/);
  assert.match(close, /order: -1;/);
  assert.match(close, /width: 44px;/);
  assert.match(close, /height: 44px;/);
  const card = lastBlock(':is(#account-modal, #auth-modal, #checkout-modal, #auth-status-modal) .overlay-card');
  assert.match(card, /display: flex;/);
  assert.match(card, /flex-direction: column;/);
  // The old corner trick is gone: tabs use the full width again.
  assert.doesNotMatch(css, /#account-tabs, #auth-tabs \{ margin-inline-end/);
});

test('links and plain billing buttons in the dialogs are brass and forest, not blue or grey', () => {
  assert.match(lastBlock('.link-btn, .billing-disclosure a'), /color: var\(--brass-light\)/);
  const plain = lastBlock('#btn-redeem-code, #billing-actions > button:not(.splash-btn)');
  assert.match(plain, /border: 2px solid var\(--brass-deep\)/);
  assert.match(plain, /background: linear-gradient\(145deg, #203e32, #10241c\)/);
});
