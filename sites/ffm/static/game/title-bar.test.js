// title-bar.test.js — the title bar is hidden while a dialog it cannot act on is open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TITLE_BAR_DIALOG_IDS,
  TITLE_BAR_HIDDEN_CLASS,
  isDialogShown,
  watchTitleBarDialogs,
} from './title-bar.js';

function element(display = 'none') {
  return { hidden: false, style: { display } };
}

function fakeDocument(elements, extra = new Set()) {
  return {
    body: {},
    getElementById: (id) => elements[id] ?? null,
    querySelector: (selector) => (extra.has(selector) ? {} : null),
  };
}

function fakeBar() {
  const classes = new Set();
  return {
    classes,
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
  };
}

class FakeObserver {
  static instances = [];
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    FakeObserver.instances.push(this);
  }
  observe(target, options) { this.targets.push({ target, options }); }
  disconnect() { this.targets = []; }
  fire() { this.callback([]); }
}

test('a dialog counts as shown only with an inline display other than none', () => {
  assert.equal(isDialogShown(null), false);
  assert.equal(isDialogShown(element('none')), false);
  assert.equal(isDialogShown(element('')), false, 'the markup default keeps it closed');
  assert.equal(isDialogShown(element('flex')), true);
  assert.equal(isDialogShown({ hidden: true, style: { display: 'flex' } }), false);
});

test('the skill intro hides the bar and closing it brings the bar back', () => {
  const elements = Object.fromEntries(TITLE_BAR_DIALOG_IDS.map((id) => [id, element()]));
  const bar = fakeBar();
  const watcher = watchTitleBarDialogs({ doc: fakeDocument(elements), bar, Observer: FakeObserver });
  assert.equal(bar.classes.has(TITLE_BAR_HIDDEN_CLASS), false, 'the title screen keeps its bar');

  elements['skill-intro'].style.display = 'flex';
  FakeObserver.instances.at(-1).fire();
  assert.equal(bar.classes.has(TITLE_BAR_HIDDEN_CLASS), true, 'over the skill intro the buttons would do nothing');

  elements['skill-intro'].style.display = 'none';
  assert.equal(watcher.sync(), false);
  assert.equal(bar.classes.has(TITLE_BAR_HIDDEN_CLASS), false);
});

test('every result, pause and tip card hides the bar', () => {
  for (const id of ['level-clear', 'game-over', 'pause-overlay', 'heal-tip-overlay']) {
    const elements = Object.fromEntries(TITLE_BAR_DIALOG_IDS.map((key) => [key, element()]));
    elements[id].style.display = 'flex';
    const bar = fakeBar();
    watchTitleBarDialogs({ doc: fakeDocument(elements), bar, Observer: FakeObserver });
    assert.equal(bar.classes.has(TITLE_BAR_HIDDEN_CLASS), true, id);
  }
});

test('a store sheet or parental gate appended to the body hides the bar', () => {
  const elements = Object.fromEntries(TITLE_BAR_DIALOG_IDS.map((id) => [id, element()]));
  for (const selector of ['.paywall-overlay', '.parental-gate-overlay']) {
    const bar = fakeBar();
    watchTitleBarDialogs({ doc: fakeDocument(elements, new Set([selector])), bar, Observer: FakeObserver });
    assert.equal(bar.classes.has(TITLE_BAR_HIDDEN_CLASS), true, selector);
  }
});

test('the watcher observes the dialogs themselves and the body children, never a subtree', () => {
  const elements = Object.fromEntries(TITLE_BAR_DIALOG_IDS.map((id) => [id, element()]));
  const doc = fakeDocument(elements);
  watchTitleBarDialogs({ doc, bar: fakeBar(), Observer: FakeObserver });
  const { targets } = FakeObserver.instances.at(-1);
  assert.equal(targets.length, TITLE_BAR_DIALOG_IDS.length + 1);
  for (const { options } of targets) assert.notEqual(options.subtree, true);
  assert.deepEqual(targets.at(-1), { target: doc.body, options: { childList: true } });
});

test('the hero picker and the help dialogs keep the bar: they re-render on a language switch', () => {
  assert.equal(TITLE_BAR_DIALOG_IDS.includes('first-open-notice'), false);
  assert.equal(TITLE_BAR_DIALOG_IDS.includes('help-overlay'), false);
});

test('main.js wires the watcher to the title bar and the stylesheet hides it', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /watchTitleBarDialogs\(\{ bar: topBar \}\)/);
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /#top-bar\.behind-dialog\s*\{\s*visibility:\s*hidden;\s*\}/);
});
