// phone-frame.test.js — the web game on a wide screen plays inside a portrait phone frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./phone-frame.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../phone-frame.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const terraform = readFileSync(new URL('../../../../infra/terraform/sites/ffm/main.tf', import.meta.url), 'utf8');

// The pure helpers, loaded the way a test can: no document, so the script only publishes them.
function helpers() {
  const context = {};
  vm.runInNewContext(source, { window: context });
  return context.ArithmoPhoneFrame;
}

test('a wide top-level page hosts the frame, the framed page plays, a phone gets no frame', () => {
  const { decide } = helpers();
  assert.equal(decide({ isTop: true, wide: true, noFrame: false }), 'host');
  assert.equal(decide({ isTop: true, wide: false, noFrame: false }), 'none', 'a phone plays full screen');
  assert.equal(decide({ isTop: true, wide: true, noFrame: true }), 'none', 'the fallback and ?noframe=1 opt out');
  assert.equal(decide({ isTop: false, wide: true, noFrame: false }), 'screen', 'never a frame inside the frame');
});

test('the frame is an upright iPhone screen; a phone held sideways is not framed', () => {
  const { FRAME_QUERY, SCREEN } = helpers();
  assert.deepEqual({ ...SCREEN }, { width: 390, height: 844 });
  assert.ok(SCREEN.height > SCREEN.width, 'portrait, also inside a landscape window');
  assert.equal(FRAME_QUERY, '(min-width: 600px) and (min-height: 500px)');
  // The largest phones: 430 wide upright, 430 high sideways. Neither may match.
  const matches = (width, height) => width >= 600 && height >= 500;
  assert.equal(matches(430, 932), false);
  assert.equal(matches(932, 430), false);
  assert.equal(matches(1440, 900), true);
  assert.match(css, /width: 390px;\s*height: 844px;/);
});

test('the frame only ever shrinks, to fit short and narrow windows', () => {
  const { frameScale, SCREEN, BEZEL, MARGIN } = helpers();
  assert.equal(frameScale(2560, 1440), 1, 'never larger than the phone');
  const short = frameScale(1280, 600);
  assert.ok(short < 1);
  assert.ok((SCREEN.height + 2 * BEZEL) * short <= 600 - 2 * MARGIN + 1e-9, 'fits the height with a margin');
  const narrow = frameScale(620, 2000);
  assert.ok((SCREEN.width + 2 * BEZEL) * narrow <= 620 - 2 * MARGIN + 1e-9, 'fits the width with a margin');
});

test('the session or the URL can turn the frame off', () => {
  const { noFrameRequested, NO_FRAME_KEY } = helpers();
  const storage = (value) => ({ getItem: (key) => (key === NO_FRAME_KEY ? value : null) });
  assert.equal(noFrameRequested({ search: '' }, storage(null)), false);
  assert.equal(noFrameRequested({ search: '?noframe=1' }, storage(null)), true);
  assert.equal(noFrameRequested({ search: '?a=b&noframe=1' }, storage(null)), true);
  assert.equal(noFrameRequested({ search: '?noframe=10' }, storage(null)), false);
  assert.equal(noFrameRequested({ search: '' }, storage('1')), true);
  assert.equal(noFrameRequested({ search: '' }, { getItem() { throw new Error('blocked'); } }), false);
});

test('index.html loads it last in <head>, web only, after the stylesheets', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  const block = head.slice(head.lastIndexOf('<!-- app-omit:start -->'));
  assert.match(block, /<link rel="stylesheet" href="phone-frame\.css">\s*<script src="game\/phone-frame\.js"><\/script>\s*<!-- app-omit:end -->\s*$/);
  assert.ok(head.indexOf('href="styles.css"') < head.indexOf('game/phone-frame.js'));
  assert.doesNotMatch(html, /<script[^>]*src="game\/phone-frame\.js"[^>]*(async|defer|type="module")/, 'it must run before the body is parsed');
});

test('the host stops the rest of the page and falls back when the frame cannot load', () => {
  assert.match(source, /doc\.write\('<plaintext hidden>'\)/, 'the host must not start a second game');
  assert.match(source, /data-phone-frame'\) === 'screen'/, 'the frame is checked to really hold the game');
  assert.match(source, /sessionStorage\.setItem\(NO_FRAME_KEY, '1'\)/);
  assert.match(css, /scale: var\(--phone-frame-scale, 1\)/);
  assert.doesNotMatch(css, /(^|[^-])transform:/m, 'the reduced-motion rule resets transform; use translate/scale');
});

test('Stripe opens in the whole tab, never inside the frame', () => {
  assert.equal((main.match(/\(window\.top \?\? window\)\.location\.href = result\.url;/g) ?? []).length, 2);
  assert.doesNotMatch(main, /\n\s*window\.location\.href = result\.url;/);
});

test('the site lets only itself frame the page', () => {
  const csp = terraform.match(/content_security_policy = "([^"]+)"/)[1];
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /frame-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.doesNotMatch(csp, /frame-ancestors[^;]*(\*|https?:)/, 'no other origin may frame it');
});
