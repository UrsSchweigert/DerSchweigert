import { it } from 'node:test';
import assert from 'node:assert/strict';
import { InputManager } from './input.js';

class Element {
  constructor() {
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.textContent = '';
    this.value = '';
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatch(type, event = {}) { for (const fn of this.listeners[type] ?? []) fn(event); }
  setAttribute(name, value) { this[name] = value; }
  appendChild(child) { child.parent = this; this.children.push(child); }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  querySelectorAll() { return this.children; }
  focus() { this.focused = true; if (globalThis.document) globalThis.document.activeElement = this; }
  blur() {
    this.focused = false;
    if (globalThis.document?.activeElement === this) globalThis.document.activeElement = null;
  }
}

it('resizes choices across modes and accepts secondary touch without duplicate answers', () => {
  const elements = Object.fromEntries(['answer-input', 'strike-btn', 'mc-buttons', 'free-text-zone']
    .map(id => [id, new Element()]));
  for (let i = 0; i < 4; i++) elements['mc-buttons'].appendChild(new Element());
  const doc = new Element();
  doc.getElementById = id => elements[id];
  doc.createElement = () => new Element();
  const original = globalThis.document;
  globalThis.document = doc;
  try {
    const answers = [];
    const input = new InputManager(value => answers.push(value));
    const container = elements['mc-buttons'];
    assert.ok(elements['answer-input'].disabled && elements['strike-btn'].disabled);
    input.setMCOptions([0, 1, 2, 3, 4]);
    assert.ok(container.children.every(button => button.disabled));
    assert.equal(container.children.length, 5);
    assert.equal(container.dataset.optionCount, '5');
    input.enable('multiple-choice');
    assert.ok(container.children.every(button => !button.disabled));
    assert.ok(elements['strike-btn'].disabled);
    assert.equal(container.style.display, '');
    assert.equal(container.hidden, false);
    assert.equal(elements['free-text-zone'].hidden, true);
    container.children[4].dispatch('pointerup', { pointerId: 2, isPrimary: false });
    container.children[3].dispatch('pointerup', { pointerId: 2 });
    assert.deepEqual(answers, ['4']);
    assert.ok(container.children.every(button => button.disabled));

    input.setMCOptions(Array.from({ length: 10 }, (_, i) => i + 10));
    assert.equal(container.children.length, 10);
    assert.equal(container.dataset.optionCount, '10');
    input.enable('free-text');
    assert.equal(elements['answer-input'].disabled, false);
    assert.equal(elements['strike-btn'].disabled, false);
    assert.ok(container.children.every(button => button.disabled));
    container.children[0].dispatch('pointerup', { pointerId: 2 });
    assert.deepEqual(answers, ['4']);
    assert.equal(container.style.display, '');
    assert.equal(container.hidden, true);
    assert.equal(elements['free-text-zone'].hidden, false);
    elements['answer-input'].value = '12';
    elements['answer-input'].dispatch('keydown', { key: 'Enter' });
    assert.deepEqual(answers, ['4', '12']);
    assert.ok(elements['answer-input'].disabled && elements['strike-btn'].disabled);

    input.setMCOptions([1, 2, 3, 4]);
    assert.equal(container.children.length, 4);
    assert.equal(container.dataset.optionCount, '4');
    input.enable('multiple-choice');
    doc.dispatch('keydown', { key: '3' });
    assert.deepEqual(answers, ['4', '12', '3']);
    input.enable('multiple-choice');
    input.disable();
    assert.ok(container.children.every(button => button.disabled));
  } finally {
    globalThis.document = original;
  }
});

it('disabling and regenerating choices cannot leave focus on a disabled answer', () => {
  const elements = Object.fromEntries(['answer-input', 'strike-btn', 'mc-buttons', 'free-text-zone']
    .map(id => [id, new Element()]));
  const doc = new Element();
  doc.getElementById = id => elements[id];
  doc.createElement = () => new Element();
  const original = globalThis.document;
  globalThis.document = doc;
  try {
    const input = new InputManager(() => {});
    input.setMCOptions([1, 2]);
    input.enable('multiple-choice');
    const focused = elements['mc-buttons'].children[0];
    focused.focus();
    input.disable();
    assert.equal(focused.disabled, true);
    assert.notEqual(doc.activeElement, focused);
    input.setMCOptions([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.ok(elements['mc-buttons'].children.every(button => button.disabled));
    assert.equal(doc.activeElement, null);
    input.enable('multiple-choice');
    assert.ok(elements['mc-buttons'].children.every(button => !button.disabled));
  } finally {
    globalThis.document = original;
  }
});

it('native keyboard/click activation and secondary touch never submit twice when callback reenables input', () => {
  const elements = Object.fromEntries(['answer-input', 'strike-btn', 'mc-buttons', 'free-text-zone']
    .map(id => [id, new Element()]));
  const doc = new Element();
  doc.getElementById = id => elements[id];
  doc.createElement = () => new Element();
  const original = globalThis.document;
  globalThis.document = doc;
  try {
    const answers = [];
    const input = new InputManager(value => { answers.push(value); input.enable('multiple-choice'); });
    input.setMCOptions([1, 2, 3, 4, 5]);
    input.enable('multiple-choice');
    const button = elements['mc-buttons'].children[0];
    button.dispatch('pointerdown', { isPrimary: true, pointerType: 'touch' });
    button.dispatch('pointerup', { isPrimary: true, pointerType: 'touch' });
    assert.deepEqual(answers, []);
    button.dispatch('click', { detail: 1 });
    assert.deepEqual(answers, ['1']);
    button.dispatch('pointerdown', { isPrimary: false, pointerType: 'touch' });
    button.dispatch('pointerup', { isPrimary: false, pointerType: 'touch' });
    button.dispatch('click', { detail: 1 });
    assert.deepEqual(answers, ['1', '1']);
    button.focus();
    let prevented = 0;
    for (const key of ['Enter', ' ']) {
      button.dispatch('keydown', { key, repeat: true, preventDefault() { prevented++; } });
    }
    assert.equal(prevented, 2);
    button.dispatch('click', { detail: 0 }); // Native Enter/Space and assistive activation.
    assert.deepEqual(answers, ['1', '1', '1']);
    doc.dispatch('keydown', { key: '2', repeat: true });
    doc.dispatch('keydown', { key: '2', ctrlKey: true });
    doc.dispatch('keydown', { key: '2', target: { tagName: 'INPUT' } });
    assert.equal(answers.length, 3);
    input.enable('free-text');
    elements['answer-input'].value = '99';
    elements['strike-btn'].dispatch('click', { detail: 0 });
    assert.equal(answers.at(-1), '99');
  } finally {
    globalThis.document = original;
  }
});

it('reports the tapped button position, and the button centre when there was no press', () => {
  const elements = Object.fromEntries(['answer-input', 'strike-btn', 'mc-buttons', 'free-text-zone']
    .map(id => [id, new Element()]));
  for (let i = 0; i < 4; i++) elements['mc-buttons'].appendChild(new Element());
  const doc = new Element();
  doc.getElementById = id => elements[id];
  doc.createElement = () => new Element();
  const original = globalThis.document;
  globalThis.document = doc;
  try {
    const answers = [];
    const input = new InputManager((value, point) => answers.push({ value, point }));
    input.setMCOptions([7, 8, 9, 10]);
    input.enable('multiple-choice');
    const [first, second] = elements['mc-buttons'].children;
    second.textContent = '8';
    first.getBoundingClientRect = () => ({ left: 100, top: 200, width: 60, height: 40 });
    second.getBoundingClientRect = () => ({ left: 400, top: 300, width: 80, height: 44 });

    doc.dispatch('pointerdown', { clientX: 421, clientY: 318 });
    second.dispatch('click', { detail: 1 });
    assert.deepEqual(answers.pop(), { value: '8', point: { x: 421, y: 318 } });

    // Keyboard Enter/Space produces a click with no pointerdown at all.
    input.enable('multiple-choice');
    first.dispatch('click', { detail: 0 });
    assert.deepEqual(answers.pop(), { value: '7', point: { x: 130, y: 220 } });

    // A press far older than the freshness window is ignored in favour of the button.
    input.enable('multiple-choice');
    doc.dispatch('pointerdown', { clientX: 5, clientY: 5 });
    input._lastPress.time -= 5000;
    second.dispatch('click', { detail: 1 });
    assert.deepEqual(answers.pop(), { value: '8', point: { x: 440, y: 322 } });
  } finally {
    globalThis.document = original;
  }
});
