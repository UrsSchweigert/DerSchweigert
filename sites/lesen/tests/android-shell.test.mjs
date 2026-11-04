import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

const siteRoot = new URL('../', import.meta.url);

/** Read a file from the lesen site tree. */
async function readSiteFile(relativePath) {
  return readFile(new URL(relativePath, siteRoot), 'utf8');
}

test('android shell: the viewport opts into safe-area insets', async () => {
  const html = await readSiteFile('static/index.html');

  assert.match(html, /<meta name="viewport"[^>]*viewport-fit=cover/);
  for (const inset of ['top', 'right', 'bottom', 'left']) {
    assert.ok(
      html.includes(`env(safe-area-inset-${inset}, 0px)`),
      `body CSS must pad the ${inset} safe-area inset`,
    );
  }
});

test('android shell: the activity draws edge-to-edge for real insets', async () => {
  const activity = await readSiteFile(
    'android/app/src/main/java/de/derschweigert/buchstabenzeit/MainActivity.java',
  );
  const styles = await readSiteFile('android/app/src/main/res/values/styles.xml');

  assert.ok(activity.includes('import androidx.core.view.WindowCompat;'));
  assert.ok(activity.includes('WindowCompat.setDecorFitsSystemWindows(getWindow(), false);'));
  assert.ok(styles.includes('android:statusBarColor'));
  assert.ok(styles.includes('android:navigationBarColor'));
});

test('android shell: the Back handler covers dialogs, practice and completion', async () => {
  const html = await readSiteFile('static/index.html');
  const start = html.indexOf("App.addListener('backButton'");
  assert.ok(start >= 0, 'the app must register a backButton listener');
  const body = html.slice(start, html.indexOf("App.addListener('appStateChange'", start));

  assert.ok(body.includes("document.querySelector('dialog[open]')"), 'Back must close an open dialog');
  assert.ok(body.includes("byId('confirm-end').showModal()"), 'Back must confirm during practice');
  assert.ok(body.includes("byId('complete')"), 'Back must leave the completion screen');
  assert.ok(body.includes('App.exitApp()'), 'Back must exit only from setup');
});

test('android shell: backgrounding cancels speech', async () => {
  const html = await readSiteFile('static/index.html');

  assert.match(html, /addListener\('appStateChange'[\s\S]*?__speech\?\.cancel\(\)/);
  assert.match(html, /visibilitychange[\s\S]*?__speech\?\.cancel\(\)/);
});

test('about dialog: the version has a single source and no hardcoded literal', async () => {
  const html = await readSiteFile('static/index.html');
  const i18n = await readSiteFile('static/i18n.mjs');

  assert.ok(html.includes("window.__platform.app.getInfo?.()"));
  assert.ok(html.includes('appVersion'));
  assert.doesNotMatch(html, /id="about-version">\s*Version\s+\d/);
  assert.doesNotMatch(i18n, /'dialog\.about\.version':\s*'[^']*\d/);
});

test('about dialog: bundled privacy and attribution links are present', async () => {
  const html = await readSiteFile('static/index.html');

  for (const target of [
    'datenschutz.html',
    'datenschutz-en.html',
    'words-de-LICENSE.txt',
    'words-en-LICENSE.txt',
    'fonts/OFL.txt',
  ]) {
    assert.ok(html.includes(target), `the about dialog must link bundled ${target}`);
  }
});
