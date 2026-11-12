// Verifies that the Capacitor offline bundle is complete and self-contained.
// copy-assets.mjs builds www/; this check proves every runtime file is present,
// the full level configuration is bundled, nothing in www/ loads a remote
// first-party resource or calls the FFM API, and no web account/checkout UI
// or web-only legal link survives the copy.
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import { REQUIRED_FILES } from './copy-assets.mjs';
import { TOTAL_LEVELS } from './level-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BUNDLE_DIR = join(here, '..', 'www');

// Runtime modules the core game needs offline, on top of the copy-assets
// entry points. Bundle-check is the place that knows the play graph. The
// app-only overlay UI seam must reach www/game/ as well (see
// mobile/game/mobile-ui.js and its stylesheet).
export const BUNDLE_FILES = Object.freeze([
  ...REQUIRED_FILES,
  'game/levels.js',
  'game/renderer.js',
  'game/entities.js',
  'game/hero/hero-atlas.webp',
  'game/hero/hero-frames.js',
  'game/stage-1.webp',
  'game/stage-6.webp',
  'game/dragon.webp',
  'game/platform.js',
  'game/platform-adapter.js',
  'game/mobile-ui.js',
  'game/mobile-ui.css',
  'game/entitlement-panel.js',
  'game/first-open-notice.js',
  'game/timer-bar.js',
  'game/level-numerals.js',
  'game/level-grid.js',
  'game/score-trend.js',
  'game/encounter-swords.js',
  'game/shapes-header.js',
  'game/volume-control.js',
  'game/help-overlay.js',
  'game/story-intro.js',
  'story/player/diorama-player.js',
  'story/player/diorama-player.css',
  'story/scenes/index.json',
  'story/scenes/intro/scene.json',
  'story/scenes/intro/backdrop.webp',
  'story/scenes/intro/village.webp',
  'story/scenes/intro/hero.webp',
  'story/scenes/intro/hero-raised.webp',
  'story/scenes/intro/foreground.webp',
  'legal/legal.css',
  'legal/manual.de.html',
  'legal/manual.en.html',
  'legal/privacy.de.html',
  'legal/privacy.en.html',
  'legal/imprint.de.html',
  'legal/imprint.en.html',
  'legal/terms.de.html',
  'legal/terms.en.html',
  'legal/licence.de.html',
  'legal/licence.en.html',
]);

const FIRST_PARTY_HOST_RE = /(^|\.)derschweigert\.de$/i;

// Website/account legal pages. The app ships its own legal/ overlay instead, so
// none of these may reappear at the bundle root: the account terms state an
// 18+ registration age and would contradict a children-targeted listing.
export const FORBIDDEN_FILES = Object.freeze([
  'datenschutz.html',
  'datenschutz.en.html',
  'impressum.html',
  'impressum.en.html',
  'terms.html',
  'terms.en.html',
]);

// The app has no accounts, checkout or web legal pages, so its bundle must
// carry none of that markup. copy-assets.mjs strips every region index.html
// marks with app-omit comments; this list is the guard that keeps a future
// edit from shipping the account UI again (web-only ids and the web-only
// cancellation/withdrawal links).
export const FORBIDDEN_UI_IDS = Object.freeze([
  'auth-modal',
  'account-modal',
  'auth-status-modal',
  'checkout-modal',
  'login-btn',
  'logout-btn',
  'username-display',
  'splash-login-btn',
  'splash-user-greeting',
  'login-form',
  'register-form',
  'forgot-password-form',
  'reset-password-form',
  'btn-redeem-code',
  'btn-cancel-subscription',
  'checkout-withdrawal-waiver-confirm',
  'leaderboard-profile-prompt',
  'leaderboard-complete-profile',
]);

const FORBIDDEN_UI_ID_RE = new RegExp(
  `\\bid\\s*=\\s*["'](?:${FORBIDDEN_UI_IDS.join('|')}|billing-[\\w-]+)["']`,
);
// Web-only legal pages that are not copied into www/. Anchored to the bundle
// root so the app's own legal/ siblings (legal/terms.de.html) stay allowed.
const FORBIDDEN_NAV_RE =
  /href\s*=\s*["']\/?(?:cancel|widerruf|datenschutz|impressum|terms)(?:\.[a-z]{2})?\.html["']/i;

const TEXT_EXTENSIONS = new Set([
  '.html', '.js', '.mjs', '.json', '.css', '.txt', '.md', '.webmanifest', '.svg', '.xml',
]);
const URL_RE = /https?:\/\/[^\s"'`<>()]+/gi;
// Direct FFM API calls. The app has no server, so a literal /api path, a
// base-URL concatenation, an XHR or a beacon is a violation.
const API_CALL_PATTERNS = [
  /\bfetch\s*\(\s*['"`][^'"`]*\/api(?:\/|['"`])/i,
  /\bfetch\s*\(\s*[A-Za-z_$][\w$.]*\s*\+/i,
  /\bfetch\s*\(\s*`[^`]*\$\{/i,
  /\bXMLHttpRequest\b/,
  /\bnavigator\.sendBeacon\s*\(\s*['"`][^'"`]*\/api(?:\/|['"`])/i,
];

function isFirstParty(url) {
  const host = url.match(/^https?:\/\/([^/?#]+)/i)?.[1]
    ?.replace(/^[^@]*@/, '')
    .replace(/:\d+$/, '');
  return Boolean(host && FIRST_PARTY_HOST_RE.test(host));
}

async function listTextFiles(dir) {
  const found = [];
  async function walk(current, prefix) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), rel);
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        found.push(rel);
      }
    }
  }
  await walk(dir, '');
  return found;
}

async function levelDataProblems(dir) {
  const rel = 'game/level-data.js';
  const file = join(dir, rel);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return [];

  const module = await import(`${pathToFileURL(file).href}?v=${info.mtimeMs}`);
  const configs = module.LevelConfig;
  const problems = [];
  if (module.TOTAL_LEVELS !== TOTAL_LEVELS) {
    problems.push(`${rel}: TOTAL_LEVELS is ${module.TOTAL_LEVELS}, expected ${TOTAL_LEVELS}`);
  }
  if (!Array.isArray(configs) || configs.length !== TOTAL_LEVELS) {
    problems.push(`${rel}: expected ${TOTAL_LEVELS} level configs, found ${configs?.length ?? 0}`);
  } else {
    configs.forEach((config, index) => {
      if (config?.level !== index + 1) {
        problems.push(`${rel}: level config ${index} is not level ${index + 1}`);
      }
    });
  }
  return problems;
}

/**
 * Checks a copied bundle for completeness and offline-only behaviour.
 * @param {string} [bundleDir] directory holding the copied web bundle (www/)
 * @returns {Promise<string[]>} one human-readable reason per problem
 */
export async function bundleCheck(bundleDir = DEFAULT_BUNDLE_DIR) {
  const problems = [];

  for (const rel of BUNDLE_FILES) {
    const info = await stat(join(bundleDir, rel)).catch(() => null);
    if (!info?.isFile()) problems.push(`missing required file: ${rel}`);
  }

  for (const rel of FORBIDDEN_FILES) {
    const info = await stat(join(bundleDir, rel)).catch(() => null);
    if (info?.isFile()) problems.push(`web-only legal page: ${rel} must not be bundled`);
  }

  let files = [];
  try {
    files = await listTextFiles(bundleDir);
  } catch {
    // A missing bundle directory already surfaced as missing required files.
  }

  for (const rel of files) {
    const content = await readFile(join(bundleDir, rel), 'utf8');
    for (const url of new Set(content.match(URL_RE) ?? [])) {
      if (!isFirstParty(url)) continue;
      problems.push(`${rel}: remote first-party URL: ${url}`);
    }

    if (['.html', '.js', '.mjs'].includes(extname(rel).toLowerCase())) {
      for (const pattern of API_CALL_PATTERNS) {
        const match = content.match(pattern);
        if (match) problems.push(`${rel}: FFM API call: ${match[0]}`);
      }
    }

    if (extname(rel).toLowerCase() === '.html') {
      const uiMatch = content.match(FORBIDDEN_UI_ID_RE);
      if (uiMatch) problems.push(`${rel}: forbidden app UI: ${uiMatch[0]}`);
    }

    // The app shell must not link any root web legal page (cancellation,
    // withdrawal, account privacy, imprint, terms); those are excluded from the
    // copy. The bundled app legal pages live under legal/ and are unaffected.
    if (rel === 'index.html') {
      const navMatch = content.match(FORBIDDEN_NAV_RE);
      if (navMatch) problems.push(`${rel}: web-only legal link: ${navMatch[0]}`);
    }
  }

  problems.push(...(await levelDataProblems(bundleDir)));
  return problems;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const bundleDir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_BUNDLE_DIR;
  const problems = await bundleCheck(bundleDir);
  if (problems.length > 0) {
    const plural = problems.length === 1 ? '' : 's';
    console.error(`Offline bundle check failed (${problems.length} problem${plural}):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Offline bundle OK: ${BUNDLE_FILES.length} required files, ${TOTAL_LEVELS} levels, no remote first-party URLs, FFM API calls or web-only UI.`,
    );
  }
}
