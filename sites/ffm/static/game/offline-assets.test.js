// offline-assets.test.js — the static game must stay offline. The web page may
// talk to the FFM API, but every gameplay module loads only same-origin assets:
// no remote URL, fetch, XHR, beacon or analytics SDK. The map below pins the
// counts that already exist (the level tracks and the app adapter seams) so any
// new use fails here, and a cleanup may only lower a count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const TOKENS = Object.freeze({
  urls: /https?:\/\//g,
  fetches: /\bfetch\s*\(/g,
  xhr: /\bXMLHttpRequest\b/g,
  beacons: /\bnavigator\.sendBeacon\s*\(/g,
  analytics: /\b(?:gtag|googletagmanager|google-analytics|plausible\.io|umami\.is|matomo|hotjar|segment\.(?:com|io)|mixpanel)\b/gi,
});

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.html', '.css', '.svg', '.webmanifest']);

// Measured before this suite landed. Only files with a non-zero count appear;
// everything else must stay at zero.
const BASELINE = Object.freeze({
  'access-flow.js': Object.freeze({ urls: 2 }),
  'api.js': Object.freeze({ fetches: 10 }),
  'audio.js': Object.freeze({ fetches: 3 }),
  'cookie-consent.js': Object.freeze({ urls: 1 }),
  'level-numerals.js': Object.freeze({ urls: 1 }),
  'main.js': Object.freeze({ urls: 1, fetches: 3 }),
  'tracks.json': Object.freeze({ urls: 8 }),
});

export function scanSource(text) {
  const counts = {};
  for (const [name, pattern] of Object.entries(TOKENS)) {
    counts[name] = (String(text).match(pattern) ?? []).length;
  }
  return counts;
}

const total = (counts) => Object.values(counts).reduce((sum, value) => sum + value, 0);

async function listModules(dir) {
  const found = [];
  async function walk(current, prefix) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.test.js')) continue;
      if (!TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      found.push(rel);
    }
  }
  await walk(dir, '');
  return found;
}

test('the scanner detects every network token', () => {
  const counts = scanSource(
    "fetch('/api/x'); const u = 'https://a.example/b'; new XMLHttpRequest();"
    + " navigator.sendBeacon('/x'); gtag('event');",
  );
  assert.deepEqual(counts, { urls: 1, fetches: 1, xhr: 1, beacons: 1, analytics: 1 });
  assert.equal(total(scanSource('const x = 1;')), 0);
});

test('no static game module adds a remote URL, fetch or analytics call', async () => {
  const modules = await listModules(here);
  assert.ok(modules.length > 50, 'the scan must cover the whole game directory');

  const additions = [];
  for (const rel of modules) {
    const counts = scanSource(await readFile(join(here, rel), 'utf8'));
    const allowed = BASELINE[rel] ?? {};
    for (const [name, count] of Object.entries(counts)) {
      const limit = allowed[name] ?? 0;
      if (count > limit) additions.push(`${rel}: ${name} ${count} > baseline ${limit}`);
    }
  }
  assert.deepEqual(additions, [], `new network use:\n${additions.join('\n')}`);
});

test('the baseline names only files that still exist', async () => {
  const modules = new Set(await listModules(here));
  const stale = Object.keys(BASELINE).filter((rel) => !modules.has(rel));
  assert.deepEqual(stale, [], 'drop retired modules from the baseline');
});
