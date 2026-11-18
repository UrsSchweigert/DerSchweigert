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

test('the close X keeps its own corner: the tab rows end before it', () => {
  assert.match(html, /<button id="close-account" class="close-btn"[^>]*>×<\/button>\s*<div id="account-tabs">/);
  assert.match(html, /<button id="close-auth"[^>]*>×<\/button>\s*<div id="auth-tabs">/);
  const close = lastBlock(':is(.close-btn, #close-auth)');
  assert.match(close, /width: 44px;/);
  assert.match(close, /height: 44px;/);
  assert.match(close, /right: 4px;/);
  // 4px inset + 44px X = 48px; the card's own 12px padding covers the rest, so a 44px
  // margin on the tab row keeps every tab clear of the X at any width.
  assert.match(css, /#account-tabs, #auth-tabs \{ margin-inline-end: 44px; \}/);
});

test('links and plain billing buttons in the dialogs are brass and forest, not blue or grey', () => {
  assert.match(lastBlock('.link-btn, .billing-disclosure a'), /color: var\(--brass-light\)/);
  const plain = lastBlock('#btn-redeem-code, #billing-actions > button:not(.splash-btn)');
  assert.match(plain, /border: 2px solid var\(--brass-deep\)/);
  assert.match(plain, /background: linear-gradient\(145deg, #203e32, #10241c\)/);
});
