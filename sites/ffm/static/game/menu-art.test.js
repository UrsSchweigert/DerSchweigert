import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('sharp title and blurred overlays use redesigned bundled art without intercepting controls', async () => {
  const art = await readFile(new URL('./title-art.webp', import.meta.url));
  assert.equal(art.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(art.subarray(8, 12).toString('latin1'), 'WEBP');
  assert.match(css, /\.splash-bg\s*\{[^}]*url\('game\/title-art\.webp'\)[^}]*filter:\s*none[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.overlay:not\(\.splash-screen\)::before\s*\{[^}]*pointer-events:\s*none[^}]*url\('game\/title-art\.webp'\)[^}]*cover/s);
  const wide = await readFile(new URL('./title-art-wide.webp', import.meta.url));
  assert.equal(wide.subarray(8, 12).toString('latin1'), 'WEBP');
  assert.match(css, /@media \(orientation: landscape\)[\s\S]*url\('game\/title-art-wide\.webp'\)/);
});

test('interface text wraps at word boundaries and compact navigation keeps whole labels', () => {
  assert.match(css, /button\s*\{\s*overflow-wrap:\s*normal;\s*word-break:\s*normal;\s*hyphens:\s*none;/);
  assert.match(css, /\.title-navigation button\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(css, /:where\(\.overlay\) :where\(button, summary, select\) \{[^}]*font-family:\s*var\(--font-ui\)/s,
    'menu buttons take their font from the shared button default');
  assert.match(css, /#level-attempt-summary, #defeat-attempt-summary\s*\{[^}]*overflow-wrap:\s*normal/);
  assert.match(css, /body:not\(\.legal-body\)\s*\{[^}]*word-break:\s*normal[^}]*hyphens:\s*none/s);
});

test('the menus share one type scale: tab-sized buttons, explanation-sized copy', () => {
  for (const token of ['--font-ui', '--font-prose', '--text-button', '--text-body', '--line-body',
    '--text-option', '--text-heading']) {
    assert.ok(css.includes(`${token}:`), `${token} must be defined`);
  }
  assert.match(css, /--text-button:\s*clamp\(11px, 1\.5vw, 15px\);/,
    'buttons default to the title-page tab size');
  assert.match(css, /--text-body:\s*12px;/, 'copy defaults to the difficulty-explanation size');
  // The defaults are the only place these roles are declared.
  const buttonSizes = css.match(/:where\(\.overlay\) :where\(button, summary, select\) \{([^}]*)\}/)?.[1];
  assert.ok(buttonSizes);
  assert.match(buttonSizes, /font-size:\s*var\(--text-button\);/);
  assert.match(buttonSizes, /font-weight:\s*400;/, 'buttons are not bold by default');
  const body = css.match(/:where\(\.overlay\) \{([^}]*)\}/)?.[1];
  assert.ok(body);
  assert.match(body, /font-size:\s*var\(--text-body\);/);
  assert.match(body, /color:\s*var\(--ivory-muted\);/);
  // Footer/navigation, pagination, profile and overlay buttons no longer
  // declare their own sizes.
  assert.doesNotMatch(css, /\.overlay-card \.diff-btn \{[^}]*font-size:/);
  assert.doesNotMatch(css, /#pause-overlay \.compact-disclosure > summary \{[^}]*font-size:/);
  assert.doesNotMatch(css, /\.splash-btn \{[^}]*font-size:/);
  assert.doesNotMatch(css, /\.playing-as-row button \{[^}]*font-size:/);
  // Bold is reserved: headings, the selected tab and the primary action.
  assert.match(css, /:where\(\.overlay\) :where\(h2, h3\) \{[^}]*font-weight:\s*700;/s);
  assert.match(css, /\.title-navigation button\[aria-pressed="true"\] \{[^}]*font-weight:\s*700;/s);
  assert.doesNotMatch(css, /\.compact-disclosure > summary \{[^}]*font-weight:/);
  // The menus' defaults stop at the menus: gameplay keeps its own metrics.
  assert.doesNotMatch(css, /:where\(\.overlay\)[^{]*#game-wrap/);
  assert.match(css, /\.mc-btn \{[^}]*font-size:\s*clamp\(18px, 2\.5vw, 24px\);/s);
  assert.match(css, /#active-question \{[^}]*font-size:\s*22px;/s);
});

test('title is centered independently of utility buttons and headings retain the original font', () => {
  assert.match(css, /\.splash-title\s*\{[^}]*justify-self:\s*center[^}]*text-align:\s*center[^}]*padding-right:\s*0/s);
  assert.match(css, /\.splash-title\s*\{[^}]*font-family:\s*monospace/s);
  assert.match(css, /\.overlay-card h2, \.title-page h2, \.title-page h3\s*\{[^}]*font-family:\s*monospace/s);
});

test('mode choices form oblong rows and portrait answers have a decorative blurred background', () => {
  assert.match(css, /\.splash-diff-buttons\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*repeat\(4,/s);
  assert.match(css, /\.splash-diff-btn\s*\{[^}]*flex-direction:\s*row/s);
  assert.match(css, /#game-wrap\[data-layout="portrait"\] #input-zone::before\s*\{[^}]*pointer-events:\s*none[^}]*title-art\.webp[^}]*blur\(6px\)/s);
  assert.match(css, /\.playing-as-row button\s*\{[^}]*var\(--brass-deep\)/s);
  assert.match(css, /\.compact-disclosure > summary \{[^}]*justify-content:\s*center/s,
    'every disclosure label is centred, like the button it is');
});

test('title lettering has accessible text and all shell surfaces share native safe insets', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<h1 class="splash-title" aria-label="Arithmo Slayer"><img[^>]*alt="Arithmo Slayer"/);
  const logo = await readFile(new URL('./title-logo.webp', import.meta.url));
  assert.equal(logo.subarray(8, 12).toString('latin1'), 'WEBP');
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    assert.ok(css.includes(`--safe-area-${edge}: env(safe-area-inset-${edge}, 0px)`));
    assert.ok(css.includes(`var(--safe-area-${edge})`));
  }
  assert.match(css, /@media \(orientation: landscape\) and \(min-height: 500px\)[\s\S]*\.title-logo \{ height: 184px/);
  assert.match(css, /\.title-play-intro\s*\{[^}]*height:\s*auto[^}]*background:\s*none/s);
});

test('title modes shrink to available space and introduction stays readable over art', () => {
  assert.match(css, /\.splash-diff-buttons\s*\{[^}]*grid-template-rows:\s*repeat\(4, minmax\(44px, 1fr\)\)[^}]*height:\s*100%[^}]*max-height:\s*312px/s);
  // Only short portrait screens drop the welcome text; roomy phones keep it.
  assert.match(css, /@media \(orientation: portrait\) and \(max-height: 700px\)\s*\{[^}]*\}[^}]*\}[^}]*\.title-play-intro \.splash-intro \{ display: none; \}/s);
  assert.match(css, /\.title-play-intro \.splash-subtitle,\s*\.title-play-intro \.player-identity,\s*\.title-play-intro #continue-level \{\s*color:\s*var\(--ivory-muted\);/,
    'secondary welcome copy uses the muted palette colour, not pure white');
  assert.match(css, /\.title-play-intro \.splash-intro, \.title-play-intro \.splash-subtitle,\s*\.title-play-intro \.player-identity, \.title-play-intro #continue-level \{[^}]*text-shadow:/s,
    'the welcome copy keeps its shadow so it stays readable over the art');
});

test('the welcome text keeps padding and a readable measure on every screen', () => {
  const intro = css.match(/^\.title-play-intro \{([^}]*height: auto[^}]*)\}/m)?.[1];
  assert.ok(intro, 'title-play-intro block missing');
  assert.match(intro, /padding:\s*24px 28px;/);
  assert.match(css, /\.title-play-intro \.splash-intro\s*\{[^}]*max-width:\s*min\(46ch, 100%\);/,
    'the welcome text keeps its readable measure');
  assert.match(css, /:where\(\.overlay\) \{[^}]*line-height:\s*var\(--line-body\)/s,
    'and takes its line height from the shared body default');
});
