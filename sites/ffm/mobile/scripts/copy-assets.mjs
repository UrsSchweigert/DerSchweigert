// Builds the Capacitor webDir (www/) from the web game in ../static.
// ../static stays the single source of truth and deploys to the website on its
// own; www/ is build output and is never edited by hand.
//
// The copy has two layers:
//   1. ../static, without development-only and web-only files;
//   2. game/, the app-only overlay, copied on top of www/game so an app module
//      replaces the web one with the same name (mobile wins).
// Level data and the bundle check are added by the other 1.2 requirements in
// docs/harness/requirements/20261104_arithmoslayer-mobile.md.
import { cp, rm, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, '..', 'static');
const dest = join(root, 'www');

// App-only modules. Paths stay relative to www/game, so
// game/platform-adapter.js in this directory replaces the web adapter of the
// same name in static/game/.
export const APP_OVERLAY = join(root, 'game');

// Web-only and development-only paths, matched against the path relative to
// the bundle root (posix separators). Everything here must stay out of www/:
// the app has no FFM API, account, checkout or web legal pages, and no tests.
export const EXCLUDED = [
  /^game\/source-assets(\/|$)/,
  /^game\/calibrate\./,
  /^game\/_dragon_test\.html$/,
  /^game\/api\.js$/,
  /^game\/access-flow\.js$/,
  /(^|\/)tests?(\/|$)/,
  /(^|\/)[^/]+\.test\.js$/,
  /^export-sprites\.html$/,
  /^demo\.html$/,
  /^cancel\.html$/,
  /^widerruf\.html$/,
];

export const REQUIRED_FILES = ['index.html', 'styles.css', 'game/main.js'];

export function isExcluded(relative) {
  return EXCLUDED.some((pattern) => pattern.test(relative));
}

const posix = (path) => path.split('\\').join('/');

function relativeTo(base, path) {
  return path === base ? '' : posix(path.slice(base.length + 1));
}

function keep(base, toBundlePath) {
  return (path) => {
    if (path === base) return true;
    if (basename(path) === '.DS_Store') return false;
    return !isExcluded(toBundlePath(relativeTo(base, path)));
  };
}

async function isDirectory(path) {
  const info = await stat(path).catch(() => null);
  return Boolean(info?.isDirectory());
}

export async function copyAssets(from = src, to = dest, overlay = APP_OVERLAY) {
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  await cp(from, to, {
    recursive: true,
    filter: keep(from, (relative) => relative),
  });

  // Overlay after the shared copy so app-only modules win. The directory is
  // optional: before the app modules land it simply copies nothing.
  if (await isDirectory(overlay)) {
    await cp(overlay, join(to, 'game'), {
      recursive: true,
      filter: keep(overlay, (relative) => `game/${relative}`),
    });
  }

  const missing = [];
  for (const rel of REQUIRED_FILES) {
    const info = await stat(join(to, rel)).catch(() => null);
    if (!info?.isFile()) missing.push(rel);
  }
  if (missing.length > 0) {
    throw new Error(`Asset copy is incomplete; missing from ${to}: ${missing.join(', ')}`);
  }
  return to;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await copyAssets();
  console.log(`Copied web game and app overlay: ${src} -> ${dest}`);
}
