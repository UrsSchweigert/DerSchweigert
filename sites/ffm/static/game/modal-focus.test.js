import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initGameplayModalFocus } from './modal-focus.js';

function fixture() {
  const listeners = {};
  const doc = {
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type) { delete listeners[type]; },
  };
  class Element {
    constructor(id, parent = null) {
      this.id = id;
      this.parentElement = parent;
      this.children = [];
      this.nodeType = 1;
      this.isConnected = true;
      this.style = { display: 'block', visibility: 'visible' };
      this.attributes = {};
      this.tabIndex = 0;
      this._inert = false;
      this.inertWrites = 0;
      parent?.children.push(this);
    }
    get inert() { return this._inert; }
    set inert(value) { this._inert = value; this.inertWrites++; }
    setAttribute(name, value) { this.attributes[name] = value; }
    hasAttribute(name) { return name in this.attributes; }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
    closest(selector) {
      if (selector !== '[inert]') return null;
      for (let node = this; node; node = node.parentElement) if (node.inert) return node;
      return null;
    }
    querySelector(selector) { return selector === 'h2' ? this.heading : null; }
    querySelectorAll() { return this.actions || []; }
    focus() { doc.activeElement = this; }
  }
  const body = doc.body = new Element('body');
  const background = new Element('game-wrap', body);
  const trigger = new Element('trigger', background);
  const bar = new Element('top-bar', body);
  bar.inert = true;
  const pause = new Element('pause-overlay', body);
  const heal = new Element('heal-tip-overlay', body);
  const level = new Element('level-clear', body);
  const defeat = new Element('game-over', body);
  const intro = new Element('skill-intro', body);
  for (const overlay of [pause, heal, level, defeat, intro]) {
    overlay.style.display = 'none';
    overlay.heading = new Element('', overlay);
  }
  const normal = new Element('normal-actions', pause);
  const confirm = new Element('confirm-actions', pause);
  confirm.style.display = 'none';
  const resume = new Element('resume', normal);
  const quit = new Element('quit', normal);
  const save = new Element('save', confirm);
  const back = new Element('back', confirm);
  pause.actions = [resume, quit, save, back];
  heal.actions = [new Element('heal-confirm', heal)];
  intro.actions = [new Element('intro-continue', intro), new Element('intro-skip', intro)];
  const all = [background, bar, pause, heal, level, defeat, intro];
  doc.getElementById = id => all.find(el => el.id === id);
  let observer;
  doc.defaultView = {
    getComputedStyle: el => el.style,
    MutationObserver: class {
      constructor(fn) { observer = this; this.callback = fn; this.targets = []; }
      observe(target, options) { this.targets.push({ target, options }); }
      disconnect() { this.disconnected = true; }
    },
  };
  trigger.focus();
  return { doc, listeners, observer: () => observer, background, bar, trigger, pause, heal, intro, normal, confirm, resume, quit, save, back };
}

test('worked-example dialog traps focus and restores title controls after skipping', () => {
  const f = fixture();
  const manager = initGameplayModalFocus({ doc: f.doc });
  f.intro.style.display = 'flex';
  manager.refresh();
  assert.equal(f.doc.activeElement.id, 'intro-continue');
  assert.equal(f.background.inert, true);
  f.intro.actions[1].focus();
  f.listeners.keydown({ key: 'Tab', preventDefault() {} });
  assert.equal(f.doc.activeElement.id, 'intro-continue');
  f.intro.style.display = 'none';
  manager.refresh();
  assert.equal(f.background.inert, false);
  assert.equal(f.doc.activeElement, f.trigger);
  manager.destroy();
});

test('gameplay dialogs trap focus, follow nested confirmation and restore prior focus/inert', () => {
  const f = fixture();
  const manager = initGameplayModalFocus({ doc: f.doc });
  const targets = f.observer().targets;
  for (const element of [f.pause, f.heal, f.normal, f.confirm, f.resume, f.save, f.back]) {
    assert.ok(targets.some(({ target }) => target === element));
  }
  assert.ok(targets.every(({ target, options }) => target !== f.doc.body && !options.subtree && !options.childList));
  f.pause.style.display = 'flex';
  f.observer().callback();
  assert.equal(f.pause.attributes.role, 'dialog');
  assert.equal(f.pause.attributes['aria-modal'], 'true');
  assert.equal(f.doc.activeElement, f.resume);
  assert.equal(f.background.inert, true);
  const writes = f.background.inertWrites;
  f.observer().callback();
  assert.equal(f.background.inertWrites, writes);
  f.normal.style.display = 'none';
  f.confirm.style.display = 'grid';
  f.observer().callback();
  assert.equal(f.doc.activeElement, f.save);
  f.back.focus();
  let prevented = false;
  f.listeners.keydown({ key: 'Tab', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.doc.activeElement, f.save);
  f.listeners.keydown({ key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(f.doc.activeElement, f.back);
  f.listeners.keydown({ key: 'Escape', preventDefault() { throw new Error('Escape must not dismiss'); } });
  f.heal.style.display = 'flex';
  f.observer().callback();
  assert.equal(f.doc.activeElement.id, 'heal-confirm');
  assert.equal(f.pause.inert, true);
  f.heal.style.display = 'none';
  f.observer().callback();
  assert.equal(f.doc.activeElement, f.save);
  f.pause.style.display = 'none';
  f.observer().callback();
  assert.equal(f.background.inert, false);
  assert.equal(f.bar.inert, true);
  assert.equal(f.doc.activeElement, f.trigger);
  manager.destroy();
  assert.equal(f.observer().disconnected, true);
});

test('asynchronously disabled focus and nested visibility changes select an enabled action', async () => {
  const f = fixture();
  const manager = initGameplayModalFocus({ doc: f.doc });
  f.pause.style.display = 'flex';
  f.observer().callback();
  f.normal.style.display = 'none';
  f.confirm.style.display = 'grid';
  await Promise.resolve();
  f.observer().callback();
  assert.equal(f.doc.activeElement, f.save);
  f.save.disabled = true;
  await Promise.resolve();
  f.observer().callback();
  assert.equal(f.doc.activeElement, f.back);
  f.back.disabled = true;
  await Promise.resolve();
  f.observer().callback();
  assert.equal(f.doc.activeElement, f.pause);
  f.normal.style.display = 'block';
  f.confirm.style.display = 'none';
  await Promise.resolve();
  f.observer().callback();
  assert.equal(f.doc.activeElement, f.resume);
  f.pause.focus();
  let prevented = false;
  f.listeners.keydown({ key: 'Tab', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.doc.activeElement, f.resume);
  manager.destroy();
});

test('invalid previous focus is not restored after dismissal', () => {
  const f = fixture();
  const manager = initGameplayModalFocus({ doc: f.doc });
  f.pause.style.display = 'flex';
  f.observer().callback();
  f.trigger.disabled = true;
  f.pause.style.display = 'none';
  f.observer().callback();
  assert.notEqual(f.doc.activeElement, f.trigger);
  manager.destroy();
});
