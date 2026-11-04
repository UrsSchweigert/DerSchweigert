// Verifies that the Capacitor offline bundle is complete and self-contained.
// copy-assets.mjs builds www/; this check proves every runtime file is present,
// the full level configuration is bundled, and nothing in www/ loads a remote
// first-party resource or calls the FFM API.
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import { REQUIRED_FILES } from './copy-assets.mjs';
import { TOTAL_LEVELS } from './level-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BUNDLE_DIR = join(here, '..', 'www');

// Runtime modules the core game needs offline, on top of the copy-assets
// entry points. Bundle-check is the place that knows the play graph.
export const BUNDLE_FILES = Object.freeze([
  ...REQUIRED_FILES,
  'game/levels.js',
  'game/renderer.js',
  'game/entities.js',
  'game/platform.js',
  'game/platform-adapter.js',
]);

const FIRST_PARTY_HOST_RE = /(^|\.)derschweigert\.de$/i;

// Navigational legal links that are text only; the app never loads them. The
// bundle check still rejects every other first-party URL, including app-load
// targets and the game host.
export const ALLOWED_NAVIGATION = Object.freeze({
  'terms.html': Object.freeze(['https://www.derschweigert.de/nutzungsbedingungen']),
  'terms.en.html': Object.freeze(['https://www.derschweigert.de/nutzungsbedingungen']),
});

const TEXT_EXTENSIONS = new Set([
  '.html', '.js', '.mjs', '.json', '.css', '.txt', '.md', '.webmanifest', '.svg', '.xml',
]);
const URL_RE = /https?:\/\/[^\s"'`<>()]+/gi;
const ANCHOR_HREF_RE = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
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

function anchorTargets(content) {
  return new Set(
    [...content.matchAll(ANCHOR_HREF_RE)]
      .map((match) => match[1] ?? match[2] ?? match[3] ?? ''),
  );
}

function navigationAllowed(rel, url) {
  return (ALLOWED_NAVIGATION[rel] ?? []).some((prefix) => url.startsWith(prefix));
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

  let files = [];
  try {
    files = await listTextFiles(bundleDir);
  } catch {
    // A missing bundle directory already surfaced as missing required files.
  }

  for (const rel of files) {
    const content = await readFile(join(bundleDir, rel), 'utf8');
    const allowedAnchors = anchorTargets(content);
    for (const url of new Set(content.match(URL_RE) ?? [])) {
      if (!isFirstParty(url)) continue;
      if (navigationAllowed(rel, url) && allowedAnchors.has(url)) continue;
      problems.push(`${rel}: remote first-party URL: ${url}`);
    }

    if (['.html', '.js', '.mjs'].includes(extname(rel).toLowerCase())) {
      for (const pattern of API_CALL_PATTERNS) {
        const match = content.match(pattern);
        if (match) problems.push(`${rel}: FFM API call: ${match[0]}`);
      }
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
      `Offline bundle OK: ${BUNDLE_FILES.length} required files, ${TOTAL_LEVELS} levels, no remote first-party URLs or FFM API calls.`,
    );
  }
}
