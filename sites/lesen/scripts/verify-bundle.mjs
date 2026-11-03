// Verifies that the Capacitor offline bundle is complete and self-contained.
// copy-assets.mjs copies static/ into www/; this check proves the bundle holds
// every runtime file and that nothing in it depends on a remote server.
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// Every file the app needs at runtime, including modules reachable through
// recursive imports (platform.mjs -> speech-adapter.js, storage.mjs, ...).
// tests/offline-bundle.test.mjs re-derives the import graph from static/ and
// fails when a runtime module is missing from this list.
export const REQUIRED_FILES = Object.freeze([
  'index.html',
  'favicon.png',
  'apple-touch-icon.png',
  'platform.mjs',
  'reminder-settings.mjs',
  'storage.mjs',
  'sounds.mjs',
  'scoring.mjs',
  'coverage.mjs',
  'i18n.mjs',
  'speech-adapter.js',
  'speech-offline-filter.mjs',
  'counts-compute.mjs',
  'counts-worker.mjs',
  'sentences/cards.mjs',
  'sentences/de.json',
  'sentences/en.json',
  'words-de.json',
  'words-en.json',
  'words-de-LICENSE.txt',
  'words-en-LICENSE.txt',
  'fonts/OFL.txt',
  'fonts/andika-latin-regular.woff2',
  'fonts/andika-latin-bold.woff2',
  'images/buchstabenzeit-logo.png',
  'datenschutz.html',
  'datenschutz-en.html',
  'books/README.md',
]);

// Namespace identifiers and licence references, not network loads. These may
// appear in any bundled text file; the app-load scan below still rejects them
// when they are used as src/href/import/fetch targets.
export const ALLOWED_URL_PREFIXES = Object.freeze([
  'http://www.w3.org/',
  'http://scripts.sil.org/OFL',
  'http://www.sil.org/',
]);

// Deterministic per-file allowlist for attribution, legal and documentation
// links. These are navigational text only; the app never fetches them.
export const ALLOWED_FILE_URL_PREFIXES = Object.freeze({
  'datenschutz.html': Object.freeze([
    'https://derschweigert.de/',
    'https://www.lda.bayern.de/',
  ]),
  'datenschutz-en.html': Object.freeze([
    'https://derschweigert.de/',
    'https://www.lda.bayern.de/',
  ]),
  'words-de.json': Object.freeze(['https://raw.githubusercontent.com/']),
  'words-en.json': Object.freeze(['https://raw.githubusercontent.com/']),
  'words-de-LICENSE.txt': Object.freeze([
    'https://creativecommons.org/',
    'https://de.wiktionary.org/',
    'https://github.com/',
    'https://raw.githubusercontent.com/',
    'https://opus.nlpl.eu/',
  ]),
  'words-en-LICENSE.txt': Object.freeze([
    'https://creativecommons.org/',
    'https://github.com/',
    'https://raw.githubusercontent.com/',
    'https://opus.nlpl.eu/',
  ]),
  // Documentation and the OFL licence contain no app-load dependency. New
  // links there must be reviewed and added to this allowlist explicitly.
  'books/README.md': Object.freeze([]),
  'fonts/OFL.txt': Object.freeze([]),
});

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.json', '.txt', '.css', '.md']);
const URL_RE = /https?:\/\/[^\s"'`<>()]+/g;
const ATTRIBUTE_URL_RE = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const MODULE_URL_RE = /(?:\bimport\s*(?:[^'"`;]*?\bfrom\s*)?|\bimport\s*\(|\bfetch\s*\(|\bnew\s+Worker\s*\()\s*["'`](https?:\/\/[^"'`\s]+)["'`]/g;

/** Lists bundled text files recursively, sorted for deterministic output. */
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

function uniqueUrls(text) {
  return [...new Set(text.match(URL_RE) ?? [])];
}

function urlAllowed(file, url) {
  if (ALLOWED_URL_PREFIXES.some(prefix => url.startsWith(prefix))) return true;
  const prefixes = ALLOWED_FILE_URL_PREFIXES[file] ?? [];
  return prefixes.some(prefix => url.startsWith(prefix));
}

function isRemote(target) {
  return /^https?:\/\//i.test(target);
}

/** Absolute http(s) targets of src/href attributes, e.g. a CDN script tag. */
function attributeRemoteTargets(html) {
  const targets = [];
  for (const match of html.matchAll(ATTRIBUTE_URL_RE)) {
    const target = match[1] ?? match[2] ?? match[3] ?? '';
    if (isRemote(target)) targets.push(target);
  }
  return targets;
}

/** Absolute http(s) targets passed to import, fetch or new Worker. */
function moduleRemoteTargets(source) {
  const targets = [];
  for (const match of source.matchAll(MODULE_URL_RE)) {
    if (isRemote(match[1])) targets.push(match[1]);
  }
  return targets;
}

async function configProblems(configPath) {
  let raw;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch {
    return [`missing Capacitor config: ${configPath}`];
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    return [`invalid Capacitor config ${configPath}: ${error.message}`];
  }
  const problems = [];
  const server = config?.server;
  if (server && typeof server === 'object') {
    if (server.url) {
      problems.push(`capacitor.config.json sets server.url (${server.url}); the app must load from the local origin`);
    }
    if (server.hostname) {
      problems.push(`capacitor.config.json sets server.hostname (${server.hostname}); the app must load from the local origin`);
    }
  }
  return problems;
}

/**
 * Checks a copied bundle for completeness and offline-first behaviour.
 * @param {string} bundleDir - Directory holding the copied web bundle (www/).
 * @param {string} [configPath] - Capacitor config to inspect.
 * @returns {Promise<string[]>} One human-readable reason per problem.
 */
export async function verifyBundle(bundleDir, configPath) {
  const problems = [];

  for (const rel of REQUIRED_FILES) {
    const info = await stat(join(bundleDir, rel)).catch(() => null);
    if (!info?.isFile()) problems.push(`missing required file: ${rel}`);
  }

  let textFiles = [];
  try {
    textFiles = await listTextFiles(bundleDir);
  } catch {
    // A missing bundle directory already surfaced as missing required files.
  }

  for (const rel of textFiles) {
    const content = await readFile(join(bundleDir, rel), 'utf8');
    for (const url of uniqueUrls(content)) {
      if (!urlAllowed(rel, url)) {
        problems.push(`${rel}: remote URL is not allowed: ${url}`);
      }
    }
  }

  const indexFile = textFiles.includes('index.html') ? join(bundleDir, 'index.html') : null;
  if (indexFile) {
    const html = await readFile(indexFile, 'utf8');
    for (const target of attributeRemoteTargets(html)) {
      problems.push(`index.html: app-load attribute points at a remote URL: ${target}`);
    }
  }

  for (const rel of textFiles) {
    if (!['.html', '.js', '.mjs'].includes(extname(rel).toLowerCase())) continue;
    const content = await readFile(join(bundleDir, rel), 'utf8');
    for (const target of moduleRemoteTargets(content)) {
      problems.push(`${rel}: app-load import/fetch points at a remote URL: ${target}`);
    }
  }

  if (configPath) {
    problems.push(...(await configProblems(configPath)));
  }

  return problems;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const bundleDir = join(root, 'www');
  const configPath = join(root, 'capacitor.config.json');
  const problems = await verifyBundle(bundleDir, configPath);
  if (problems.length > 0) {
    const plural = problems.length === 1 ? '' : 's';
    console.error(`Offline bundle verification failed (${problems.length} problem${plural}):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Offline bundle OK: ${REQUIRED_FILES.length} required files present, no remote app-load dependencies.`,
    );
  }
}
