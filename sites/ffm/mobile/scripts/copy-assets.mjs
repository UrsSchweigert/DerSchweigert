// Builds the Capacitor webDir (www/) from the web game in ../static.
// ../static stays the single source of truth and deploys to the website on its
// own; www/ is build output and is never edited by hand.
//
// Scaffold baseline: copies the game without development-only files and checks
// that the entry points exist. Level data, app-only modules and the bundle check
// are added by the requirements in docs/harness/requirements/20261104_arithmoslayer-mobile.md.
import { cp, rm, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, '..', 'static');
const dest = join(root, 'www');

export const EXCLUDED = [
  /^game\/source-assets(\/|$)/,
  /^game\/calibrate\./,
  /^game\/_dragon_test\.html$/,
  /^game\/[^/]+\.test\.js$/,
  /^export-sprites\.html$/,
  /^demo\.html$/,
];

export const REQUIRED_FILES = ['index.html', 'styles.css', 'game/main.js'];

function isExcluded(relative) {
  return EXCLUDED.some((pattern) => pattern.test(relative));
}

export async function copyAssets(from = src, to = dest) {
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  await cp(from, to, {
    recursive: true,
    filter: (path) => {
      const relative = path === from ? '' : path.slice(from.length + 1).split('\\').join('/');
      return relative === '' || (!isExcluded(relative) && basename(path) !== '.DS_Store');
    },
  });
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
  console.log(`Copied web game: ${src} -> ${dest}`);
}
