// Focused accessibility checks for the shared web source (P6 requirement 6.1).
// These assert the static markup and stylesheet contract that the documented
// audit relies on; real-device TalkBack/VoiceOver behaviour stays a manual gate.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

const siteRoot = new URL('../', import.meta.url);

/** Read a file from the lesen site tree. */
async function readSiteFile(relativePath) {
  return readFile(new URL(relativePath, siteRoot), 'utf8');
}

/** Return the body of a top-level `function name(...) { ... }` block. */
function functionBody(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected a function named ${name}`);
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(open, index + 1);
    }
  }
  assert.fail(`unbalanced braces in ${name}`);
}

/** Return the declarations of a CSS rule, or '' when the selector is absent. */
function cssRule(html, selector) {
  const start = html.indexOf(`${selector} {`);
  if (start < 0) return '';
  const open = html.indexOf('{', start);
  const close = html.indexOf('}', open);
  return html.slice(open + 1, close);
}

function luminance(hex) {
  const [r, g, b] = hex.replace('#', '').match(/../g)
    .map(pair => parseInt(pair, 16) / 255)
    .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

test('a11y: the viewport allows pinch zoom and text scaling', async () => {
  const html = await readSiteFile('static/index.html');
  const viewport = html.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? '';

  assert.ok(viewport.includes('viewport-fit=cover'), 'safe-area opt-in must stay');
  assert.ok(!/user-scalable\s*=\s*no/.test(viewport), 'user-scalable=no blocks text scaling');
  assert.ok(!/maximum-scale\s*=\s*1(\.0*)?\b/.test(viewport), 'maximum-scale=1 blocks pinch zoom');
});

test('a11y: visible focus covers buttons, inputs, summary and links', async () => {
  const html = await readSiteFile('static/index.html');
  const rule = cssRule(html, 'button:focus-visible,\n        input:focus-visible,\n        summary:focus-visible,\n        a:focus-visible');

  assert.ok(rule.length > 0, 'the shared :focus-visible rule must include all interactive elements');
  assert.match(rule, /outline:\s*3px solid var\(--orange\)/);
  assert.match(rule, /outline-offset:\s*4px/);
});

test('a11y: controls meet the 44px touch-target minimum', async () => {
  const html = await readSiteFile('static/index.html');

  const aboutX = cssRule(html, '.about-x');
  assert.match(aboutX, /width:\s*44px/, 'about close button must be 44px wide');
  assert.match(aboutX, /height:\s*44px/, 'about close button must be 44px tall');

  const shared = cssRule(html, '.primary,\n        .action,\n        .quiet');
  assert.match(shared, /min-height:\s*44px/, 'primary/action/quiet buttons must be at least 44px tall');

  const link = cssRule(html, '.link-button');
  assert.match(link, /min-height:\s*44px/, 'footer link buttons must be at least 44px tall');

  const language = cssRule(html, '.language-control button');
  assert.match(language, /min-width:\s*44px/);
  assert.match(language, /min-height:\s*44px/);

  const reminder = cssRule(html, '.reminder-toggle');
  assert.match(reminder, /display:\s*flex/);
  assert.match(reminder, /min-height:\s*44px/);
  assert.match(html, /<label class="reminder-toggle"><input id="reminders-enabled"/);
});

test('a11y: the confirm dialog stays scrollable when text is enlarged', async () => {
  const html = await readSiteFile('static/index.html');
  const rule = cssRule(html, '.confirm-dialog');

  assert.match(rule, /max-height:/, 'confirm dialog needs a height cap');
  assert.match(rule, /overflow-y:\s*auto/, 'confirm dialog must scroll instead of clipping its actions');
});

test('a11y: the green action colour meets WCAG AA contrast', async () => {
  const html = await readSiteFile('static/index.html');
  const green = html.match(/--green:\s*(#[0-9a-fA-F]{6})/)?.[1];
  assert.ok(green, 'expected a --green custom property');

  assert.ok(
    contrastRatio(green, '#ffffff') >= 4.5,
    `white text on the green action needs 4.5:1, got ${contrastRatio(green, '#ffffff').toFixed(2)}`,
  );
  assert.ok(
    contrastRatio(green, '#e9f8dc') >= 3,
    `the completion mark needs 3:1 non-text contrast, got ${contrastRatio(green, '#e9f8dc').toFixed(2)}`,
  );

  const hover = html.match(/\.correct:hover\s*\{[^}]*background:\s*(#[0-9a-fA-F]{6})/)?.[1];
  assert.ok(hover, 'expected a .correct:hover background colour');
  assert.ok(
    contrastRatio(hover, '#ffffff') >= 4.5,
    `white text on the green hover needs 4.5:1, got ${contrastRatio(hover, '#ffffff').toFixed(2)}`,
  );
});

test('a11y: the language buttons expose their pressed state', async () => {
  const html = await readSiteFile('static/index.html');

  assert.match(html, /id="lang-de"[^>]*aria-pressed="true"/);
  assert.match(html, /id="lang-en"[^>]*aria-pressed="false"/);

  const body = functionBody(html, 'setLanguage');
  assert.match(
    body,
    /setAttribute\('aria-pressed', String\(active\)\)/,
    'setLanguage must keep aria-pressed in sync with the active language',
  );
});

test('a11y: a language change turns the page, except under reduced motion', async () => {
  const html = await readSiteFile('static/index.html');
  const body = functionBody(html, 'switchLanguage');

  assert.match(html, /\.lang-btn'\)\.forEach\(btn => \{\s*btn\.addEventListener\('click', \(\) => switchLanguage\(/);
  assert.match(body, /prefers-reduced-motion: reduce/);
  assert.match(body, /!document\.startViewTransition \|\| reduceMotion\) \{\s*setLanguage\(lang\);\s*return;/,
    'WebViews without View Transitions and reduced motion must switch instantly');
  assert.match(body, /document\.startViewTransition\(\(\) => setLanguage\(lang\)\)/);
  assert.match(cssRule(html, '        .language-control'), /view-transition-name:\s*language-control/,
    'the flags stay in place as an anchor while the page turns');
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*::view-transition-old\(\*\)[^}]*animation:\s*none !important/);
});

test('a11y: the about close button name follows the UI language', async () => {
  const html = await readSiteFile('static/index.html');
  const body = functionBody(html, 'updateDialogText');

  assert.match(
    body,
    /byId\('about-x'\)\.setAttribute\('aria-label', tr\('dialog\.about\.close'\)\)/,
    'the focused close button must not stay German when the UI is English',
  );
});

test('a11y: the card language is stated explicitly when a card renders', async () => {
  const html = await readSiteFile('static/index.html');
  const body = functionBody(html, 'renderCard');

  assert.match(body, /byId\('syllable'\)\.lang = currentLanguage/);
});

test('a11y: completion announces its summary once, without auto speech', async () => {
  const html = await readSiteFile('static/index.html');

  assert.match(html, /id="complete-title"[^>]*aria-describedby="complete-summary"/);
  assert.match(html, /id="syllable"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(html, /id="feedback"[^>]*role="status"/);

  const render = functionBody(html, 'renderCard');
  assert.ok(!/\.speak\(/.test(render), 'cards must not be spoken automatically alongside the live region');
});

test('a11y: a boot splash covers the first paint and never traps the user', async () => {
  const html = await readSiteFile('static/index.html');

  assert.match(html, /<div id="boot-splash" aria-hidden="true">/);
  assert.match(html, /#boot-splash\s*\{[^}]*position:\s*fixed/, 'splash must overlay the whole viewport');
  assert.match(html, /#boot-splash\s*\{[^}]*background:\s*var\(--paper\)/, 'splash must use the brand background, not black');
  assert.match(html, /html\s*\{[^}]*background-color:\s*var\(--paper\)/, 'html background prevents a black WebView flash');
  assert.match(
    html,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*#boot-splash img\s*\{\s*animation:\s*none/,
    'the pulse must stop under reduced motion',
  );
  assert.match(html, /setTimeout\(hideBootSplash, 3000\)/, 'splash must remove itself even if startup stalls');
});
