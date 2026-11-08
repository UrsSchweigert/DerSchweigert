import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('sharp title and blurred overlays use redesigned bundled art without intercepting controls', async () => {
  const art = await readFile(new URL('./title-art.png', import.meta.url));
  assert.deepEqual([...art.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(css, /\.splash-bg\s*\{[^}]*url\('game\/title-art\.png'\)[^}]*filter:\s*none[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.overlay:not\(\.splash-screen\)::before\s*\{[^}]*pointer-events:\s*none[^}]*url\('game\/title-art\.png'\)[^}]*cover/s);
  const wide = await readFile(new URL('./title-art-wide.png', import.meta.url));
  assert.deepEqual([...wide.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(css, /@media \(orientation: landscape\)[\s\S]*url\('game\/title-art-wide\.png'\)/);
});

test('interface text wraps at word boundaries and compact navigation keeps whole labels', () => {
  assert.match(css, /button\s*\{\s*overflow-wrap:\s*normal;\s*word-break:\s*normal;\s*hyphens:\s*none;/);
  assert.match(css, /\.title-navigation button\s*\{[^}]*font-family:\s*system-ui[^}]*white-space:\s*nowrap/s);
  assert.match(css, /#level-attempt-summary, #defeat-attempt-summary\s*\{[^}]*overflow-wrap:\s*normal/);
  assert.match(css, /body:not\(\.legal-body\)\s*\{[^}]*word-break:\s*normal[^}]*hyphens:\s*none/s);
});

test('title is centered independently of utility buttons and headings retain the original font', () => {
  assert.match(css, /\.splash-title\s*\{[^}]*justify-self:\s*center[^}]*text-align:\s*center[^}]*padding-right:\s*0/s);
  assert.match(css, /\.splash-title\s*\{[^}]*font-family:\s*monospace/s);
  assert.match(css, /\.overlay-card h2, \.title-page h2, \.title-page h3\s*\{[^}]*font-family:\s*monospace/s);
});

test('mode choices form oblong rows and portrait answers have a decorative blurred background', () => {
  assert.match(css, /\.splash-diff-buttons\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*repeat\(4,/s);
  assert.match(css, /\.splash-diff-btn\s*\{[^}]*flex-direction:\s*row/s);
  assert.match(css, /#game-wrap\[data-layout="portrait"\] #input-zone::before\s*\{[^}]*pointer-events:\s*none[^}]*title-art\.png[^}]*blur\(6px\)/s);
  assert.match(css, /\.playing-as-row button\s*\{[^}]*var\(--brass-deep\)/s);
  assert.match(css, /#audio-settings > summary\s*\{\s*justify-content:\s*center/);
});

test('title lettering has accessible text and all shell surfaces share native safe insets', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<h1 class="splash-title" aria-label="Arithmo Slayer"><img[^>]*alt="Arithmo Slayer"/);
  const logo = await readFile(new URL('./title-logo.png', import.meta.url));
  assert.deepEqual([...logo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    assert.ok(css.includes(`--safe-area-${edge}: env(safe-area-inset-${edge}, 0px)`));
    assert.ok(css.includes(`var(--safe-area-${edge})`));
  }
  assert.match(css, /@media \(orientation: landscape\) and \(min-height: 500px\)[\s\S]*\.title-logo \{ height: 184px/);
  assert.match(css, /\.title-play-intro\s*\{[^}]*height:\s*auto[^}]*background:\s*none/s);
});

test('title modes shrink to available space and introduction stays readable over art', () => {
  assert.match(css, /\.splash-diff-buttons\s*\{[^}]*grid-template-rows:\s*repeat\(4, minmax\(44px, 1fr\)\)[^}]*height:\s*100%[^}]*max-height:\s*312px/s);
  assert.match(css, /@media \(orientation: portrait\) and \(max-height: 650px\)\s*\{[^}]*\}[^}]*\}[^}]*\.title-play-intro \.splash-intro \{ display: none; \}/s);
  assert.match(css, /\.title-play-intro \.player-identity, \.title-play-intro #continue-level\s*\{[^}]*color:\s*#fff[^}]*text-shadow:/s);
});
