// Pins the decorative sword icons on the difficulty picker: one, two or three
// per Easy, Medium and Hard button, none on Shapes, and one shared sword
// silhouette in styles.css, the same one the portrait sword bar draws.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readPage() {
  return readFile(new URL('../index.html', import.meta.url), 'utf8');
}

async function readStyles() {
  return readFile(new URL('../styles.css', import.meta.url), 'utf8');
}

function buttonFor(html, difficulty) {
  const start = html.indexOf(`data-difficulty="${difficulty}"`);
  assert.ok(start >= 0, `the ${difficulty} button exists`);
  const end = html.indexOf('</button>', start);
  return html.slice(start, end);
}

describe('difficulty picker sword icons', () => {
  it('shows 0, 1, 2 and 3 sword icons on Shapes, Easy, Medium and Hard', async () => {
    const html = await readPage();
    const expected = { shapes: 0, easy: 1, medium: 2, hard: 3 };
    for (const [difficulty, count] of Object.entries(expected)) {
      const button = buttonFor(html, difficulty);
      const icons = button.match(/class="diff-sword"/g) ?? [];
      assert.equal(icons.length, count, `${difficulty} shows ${count} swords`);
      const groups = button.match(/class="diff-swords"/g) ?? [];
      assert.equal(groups.length, count > 0 ? 1 : 0, `${difficulty} has ${count > 0 ? 'one' : 'no'} icon group`);
    }
  });

  it('hides the icon group from assistive technology', async () => {
    const html = await readPage();
    for (const difficulty of ['easy', 'medium', 'hard']) {
      const button = buttonFor(html, difficulty);
      assert.match(button, /<span class="diff-swords" aria-hidden="true">/, `${difficulty} group is aria-hidden`);
    }
  });

  it('places the icon group between the label and the detail', async () => {
    const html = await readPage();
    for (const difficulty of ['easy', 'medium', 'hard']) {
      const button = buttonFor(html, difficulty);
      const label = button.indexOf('class="diff-label"');
      const group = button.indexOf('class="diff-swords"');
      const detail = button.indexOf('class="diff-detail"');
      assert.ok(label < group && group < detail, `${difficulty} order is label, swords, detail`);
    }
  });

  it('keeps the new class names clear of the sword row classes', async () => {
    const html = await readPage();
    const names = [...html.matchAll(/class="(diff-sword[^"]*)"/g)].map(m => m[1]);
    assert.ok(names.length > 0, 'the icon classes are present');
    for (const name of names) {
      assert.doesNotMatch(name, /encounter-swords|app-encounter-sword/);
    }
  });

  it('adds no inline SVG or remote URL to the page or the stylesheet', async () => {
    const html = await readPage();
    const css = await readStyles();
    assert.doesNotMatch(html, /<svg[\s>]/, 'no inline svg on the page');
    assert.doesNotMatch(css, /https?:\/\//, 'no remote URL in the stylesheet');
  });

  it('declares the sword clip-path once, shared with the portrait sword bar', async () => {
    const css = await readStyles();
    const polygons = css.match(/clip-path:\s*polygon\(/g) ?? [];
    assert.equal(polygons.length, 1, 'the sword silhouette is declared once');
    const shared = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/([^{}]*)\{([^}]*clip-path:\s*polygon\([^}]*)\}/);
    assert.ok(shared, 'the clip-path sits in a rule');
    const selectors = shared[1].trim().split(/\s*,\s*/);
    assert.equal(selectors.at(-1), '.app-encounter-sword::before', 'the grouped rule ends on the bar sword');
    assert.ok(selectors.includes('.diff-sword::before'), 'the picker icon shares the rule');
  });

  it('draws the icon as a filled green sword without animation', async () => {
    const css = await readStyles();
    const fill = css.match(/\.diff-sword::before\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(fill, /#5fd068/, 'the gradient matches the bar fill');
    const sized = css.match(/\.diff-sword\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(sized, /flex:\s*0 0 12px/);
    assert.match(sized, /width:\s*12px/);
    assert.match(sized, /height:\s*20px/);
    const group = css.match(/\.diff-swords\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(group, /flex:\s*0 0 auto/);
    assert.doesNotMatch(group + sized, /animation/);
  });
});
