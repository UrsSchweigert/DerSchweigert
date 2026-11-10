// Builds the Capacitor webDir (www/) from the web game in ../static.
// ../static stays the single source of truth and deploys to the website on its
// own; www/ is build output and is never edited by hand.
//
// The copy has two layers:
//   1. ../static, without development-only and web-only files;
//   2. game/, the app-only overlay, copied on top of www/game so an app module
//      replaces the web one with the same name (mobile wins).
// After the copy it generates game/level-data.js from the private curriculum,
// removes web-only inline scripts (visitor tracking) and the app-omit DOM
// regions (account, checkout, web legal) from index.html.
import { cp, rm, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { generateLevelData } from './level-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, '..', 'static');
const dest = join(root, 'www');

// App-only modules. Paths stay relative to www/game, so
// game/platform-adapter.js in this directory replaces the web adapter of the
// same name in static/game/.
export const APP_OVERLAY = join(root, 'game');

// App-only legal pages (privacy, imprint, terms, licence; DE and EN). They
// replace the web legal footer in the app and are copied to www/legal/.
export const LEGAL_DIR = join(root, 'legal');

// Web-only and development-only paths, matched against the path relative to
// the bundle root (posix separators). Everything here must stay out of www/:
// the app has no FFM API, account, checkout or web legal pages, and no tests.
export const EXCLUDED = [
  /^game\/source-assets(\/|$)/,
  /^game\/calibrate\./,
  /^game\/_dragon_test\.html$/,
  /^game\/(api|access-flow|cancel-request|withdrawal-request)\.js$/,
  // The raw hero sheets are inputs for export-sprites.html (a dev tool); the
  // game itself loads hero-spritesheet-clean.png.
  /^game\/hero-spritesheet(-upload)?\.png$/,
  // Story dioramas ship only what the player needs at runtime; the generation
  // sources, the approved reference sheets, the art bible and the dev preview
  // stay on the web side.
  /^story\/(sources|references|tools)(\/|$)/,
  /^story\/(preview|reel)\.html$/,
  /^story\/(README|ART-BIBLE)\.md$/,
  /(^|\/)tests?(\/|$)/,
  /(^|\/)[^/]+\.test\.js$/,
  /^export-sprites\.html$/,
  /^demo\.html$/,
  /^cancel\.html$/,
  /^widerruf\.html$/,
];

export const REQUIRED_FILES = ['index.html', 'styles.css', 'game/main.js', 'game/level-data.js'];

// Build output that copy-assets writes on top of the copied web game.
export const GENERATED_FILES = ['game/level-data.js'];

// Web-only inline scripts. The website tracks page visits with a fetch to the
// FFM API; the app is offline and must not make that request, so the script
// block is dropped while copying.
const INLINE_SCRIPT_RE = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
const FFM_API_CALL_RE = /\bfetch\s*\(\s*['"`][^'"`]*\/api(?:\/|['"`])/;

export function stripWebOnlyScripts(html) {
  return html.replace(INLINE_SCRIPT_RE, (block, body) =>
    FFM_API_CALL_RE.test(body) ? '' : block);
}

// Web-only DOM regions. index.html wraps the account, checkout, auth-status
// and web-legal markup in paired comments so the website keeps that UI while
// the app copy drops it (the app has no accounts, checkout or web legal
// pages; see FORBIDDEN_UI_IDS in bundle-check.mjs). Each marker sits on its
// own line and markers never nest.
const APP_OMIT_START_RE = /^\s*<!--\s*app-omit:start\s*-->\s*$/;
const APP_OMIT_END_RE = /^\s*<!--\s*app-omit:end\s*-->\s*$/;

export function stripAppOnlyDom(html) {
  const kept = [];
  let omitting = false;
  for (const line of html.split('\n')) {
    if (omitting) {
      if (APP_OMIT_END_RE.test(line)) omitting = false;
      continue;
    }
    if (APP_OMIT_START_RE.test(line)) {
      omitting = true;
      continue;
    }
    kept.push(line);
  }
  if (omitting) throw new Error('Unclosed app-omit:start marker in index.html');
  return kept.join('\n');
}

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

  if (await isDirectory(LEGAL_DIR)) {
    await cp(LEGAL_DIR, join(to, 'legal'), {
      recursive: true,
      filter: keep(LEGAL_DIR, (relative) => `legal/${relative}`),
    });
  }

  await generateLevelData(join(to, 'game', 'level-data.js'));

  const indexPath = join(to, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  const stripped = stripAppOnlyDom(stripWebOnlyScripts(html));
  if (stripped !== html) await writeFile(indexPath, stripped);

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
