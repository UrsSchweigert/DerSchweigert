// mobile-ui.test.mjs — the app-only overlay UI seam.
//
// mobile-ui.js is loaded only by the app build (main.js guards the dynamic
// import with platform.isApp) and ships through copy-assets as
// www/game/mobile-ui.js + www/game/mobile-ui.css. These tests pin the hook
// surface later mobile UI issues consume: stylesheet injection, widget
// registration, and timer/level-selection fan-out that cannot break the game
// loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MOBILE_UI_STYLESHEET,
  MOBILE_UI_STYLESHEET_URL,
  STYLESHEET_ATTRIBUTE,
  WIDGET_UPDATES,
  createMobileUi,
  injectStylesheet,
  mountMobileUi,
} from '../game/mobile-ui.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(root, '..', 'static');

function fakeDocument() {
  const links = [];
  const head = {
    appendChild(node) {
      links.push(node);
    },
    removeChild(node) {
      const index = links.indexOf(node);
      if (index >= 0) links.splice(index, 1);
    },
  };
  const doc = {
    head,
    createElement(tagName) {
      const attributes = {};
      return {
        tagName: tagName.toUpperCase(),
        attributes,
        setAttribute(name, value) {
          attributes[name] = String(value);
        },
        getAttribute(name) {
          return attributes[name] ?? null;
        },
        remove() {
          doc.head.removeChild(this);
        },
      };
    },
    querySelector(selector) {
      if (!selector.includes(STYLESHEET_ATTRIBUTE)) return null;
      return links.find((link) => STYLESHEET_ATTRIBUTE in link.attributes) ?? null;
    },
  };
  return { doc, links };
}

test('mounting injects the app-only stylesheet exactly once', () => {
  const { doc, links } = fakeDocument();

  const first = mountMobileUi({ doc });
  assert.equal(first.attached, true);
  assert.equal(links.length, 1);
  assert.equal(links[0].tagName, 'LINK');
  assert.equal(links[0].rel, 'stylesheet');
  assert.equal(links[0].href, MOBILE_UI_STYLESHEET_URL);
  assert.ok(MOBILE_UI_STYLESHEET_URL.endsWith('/game/mobile-ui.css'),
    'the stylesheet resolves next to the overlay module, not at the bundle root');
  assert.equal(links[0].getAttribute(STYLESHEET_ATTRIBUTE), '');

  // A second mount (or a reloaded module) must not duplicate the link.
  const second = mountMobileUi({ doc });
  assert.equal(links.length, 1);
  assert.equal(second.stylesheetLink, first.stylesheetLink);

  second.detach();
  assert.equal(links.length, 0);
});

test('injectStylesheet is a no-op without a document head', () => {
  assert.equal(injectStylesheet(undefined), null);
  assert.equal(injectStylesheet({ createElement() {} }), null);
});

test('timer and level-selection updates reach registered widgets', () => {
  const { doc } = fakeDocument();
  const ui = mountMobileUi({ doc });
  const seen = [];
  ui.registerWidget('timer-bar', {
    updateTimerState(state) {
      seen.push(['timer', state]);
    },
    updateLevelSelection(selection) {
      seen.push(['level', selection]);
    },
  });

  const timer = { remaining: 7.5, max: 10, paused: false, running: true };
  const selection = { level: 4, chapter: 1, mode: 'continuation' };
  ui.updateTimerState(timer);
  ui.updateLevelSelection(selection);

  assert.deepEqual(seen, [['timer', timer], ['level', selection]]);
});

test('late widgets replay the latest timer and level state', () => {
  const { doc } = fakeDocument();
  const ui = mountMobileUi({ doc });
  const timer = { remaining: 3, max: 10 };
  const selection = { level: 12, chapter: 2 };
  ui.updateTimerState(timer);
  ui.updateLevelSelection(selection);

  const seen = [];
  ui.registerWidget('late', {
    updateTimerState(state) {
      seen.push(['timer', state]);
    },
    updateLevelSelection(state) {
      seen.push(['level', state]);
    },
  });
  assert.deepEqual(seen, [['timer', timer], ['level', selection]]);
});

test('one throwing widget never blocks the others or escapes', () => {
  const { doc } = fakeDocument();
  const warnings = [];
  const ui = mountMobileUi({ doc, warn: (message, error) => warnings.push([message, error]) });
  const seen = [];
  ui.registerWidget('broken', {
    updateTimerState() {
      throw new Error('widget bug');
    },
  });
  ui.registerWidget('healthy', {
    updateTimerState(state) {
      seen.push(state);
    },
  });

  assert.doesNotThrow(() => ui.updateTimerState({ remaining: 1, max: 5 }));
  assert.deepEqual(seen, [{ remaining: 1, max: 5 }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /broken/);
  assert.match(String(warnings[0][1]), /widget bug/);
});

test('widget registration validates its inputs and can be undone', () => {
  const { doc } = fakeDocument();
  const ui = mountMobileUi({ doc });
  assert.throws(() => ui.registerWidget('', {}), /non-empty name/);
  assert.throws(() => ui.registerWidget('bad', null), /must be an object/);

  const seen = [];
  const unregister = ui.registerWidget('timer-bar', {
    updateTimerState(state) {
      seen.push(state);
    },
  });
  assert.deepEqual(ui.widgetNames(), ['timer-bar']);
  ui.updateTimerState({ remaining: 2 });
  unregister();
  ui.updateTimerState({ remaining: 1 });
  assert.deepEqual(seen, [{ remaining: 2 }]);
  assert.deepEqual(ui.widgetNames(), []);
});

test('the documented hook surface is stable', () => {
  assert.equal(MOBILE_UI_STYLESHEET, './mobile-ui.css');
  assert.deepEqual([...WIDGET_UPDATES], ['updateTimerState', 'updateLevelSelection']);
  const { doc } = fakeDocument();
  const ui = createMobileUi({ doc });
  for (const name of ['attach', 'detach', 'registerWidget', 'unregisterWidget', 'updateTimerState', 'updateLevelSelection']) {
    assert.equal(typeof ui[name], 'function', `${name} must be part of the hook surface`);
  }
});

test('main.js loads the overlay UI only in the app build, behind a catch', async () => {
  const source = await readFile(join(staticDir, 'game', 'main.js'), 'utf8');
  const appStart = source.indexOf('if (platform.isApp) {');
  assert.ok(appStart >= 0, 'main.js keeps the app-only branch');
  const appBlock = source.slice(appStart, source.indexOf('\n}\n', appStart));

  assert.equal((source.match(/import\('\.\/mobile-ui\.js'\)/g) ?? []).length, 1);
  assert.ok(appBlock.includes("import('./mobile-ui.js')"), 'the app branch loads mobile-ui.js');
  assert.match(appBlock, /import\('\.\/mobile-ui\.js'\)[\s\S]{0,1200}\.catch\(\(\) => \{\}\)/);
  assert.match(appBlock, /mobileUi = mountMobileUi\(\{ doc: document \}\)/);
  assert.doesNotMatch(source, /from '\.\/mobile-ui\.js'/, 'no static import may reach the web build');
});

test('the overlay module and stylesheet stay out of the web source tree', async () => {
  for (const rel of ['game/mobile-ui.js', 'game/mobile-ui.css']) {
    await assert.rejects(stat(join(staticDir, rel)), { code: 'ENOENT' }, `${rel} is app-only`);
  }
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');
  assert.doesNotMatch(css, /https?:\/\//, 'the overlay stylesheet must stay offline');
});
