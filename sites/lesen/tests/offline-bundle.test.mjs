import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { cp, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUIRED_FILES, verifyBundle } from '../scripts/verify-bundle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '..');
const staticDir = join(siteRoot, 'static');
const realConfig = join(siteRoot, 'capacitor.config.json');

const RELATIVE_TARGET_RE =
  /(?:\bimport\s*(?:[^'"`;]*?\bfrom\s*)?|\bimport\s*\(|\bfetch\s*\(|\bnew\s+Worker\s*\()\s*["'`](\.{1,2}\/[^"'`\s]+)["'`]/g;

async function makeBundle(t) {
  const dir = await mkdtemp(join(tmpdir(), 'offline-bundle-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(staticDir, dir, { recursive: true });
  return dir;
}

async function fileExists(path) {
  const info = await stat(path).catch(() => null);
  return Boolean(info?.isFile());
}

test('a complete bundle passes verification', async t => {
  const dir = await makeBundle(t);
  const problems = await verifyBundle(dir, realConfig);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('a missing legal notice is reported by name', async t => {
  const dir = await makeBundle(t);
  await unlink(join(dir, 'words-de-LICENSE.txt'));
  const problems = await verifyBundle(dir, realConfig);
  assert.ok(
    problems.some(problem => problem.includes('words-de-LICENSE.txt')),
    problems.join('\n'),
  );
});

test('a missing runtime module is reported by name', async t => {
  const dir = await makeBundle(t);
  await unlink(join(dir, 'platform.mjs'));
  const problems = await verifyBundle(dir, realConfig);
  assert.ok(
    problems.some(problem => problem.includes('platform.mjs')),
    problems.join('\n'),
  );
});

test('a CDN script tag in index.html fails the bundle', async t => {
  const dir = await makeBundle(t);
  const indexPath = join(dir, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  await writeFile(
    indexPath,
    html.replace(
      '</head>',
      '  <script src="https://cdn.example.com/app.js"></script>\n</head>',
    ),
  );
  const problems = await verifyBundle(dir, realConfig);
  assert.ok(
    problems.some(problem => problem.includes('cdn.example.com')),
    problems.join('\n'),
  );
});

test('an app-load dependency fails even on an allowlisted host', async t => {
  const dir = await makeBundle(t);
  const indexPath = join(dir, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  await writeFile(
    indexPath,
    html.replace(
      '</head>',
      '  <script src="https://www.w3.org/evil.js"></script>\n</head>',
    ),
  );
  const problems = await verifyBundle(dir, realConfig);
  assert.ok(
    problems.some(problem => problem.includes('app-load') && problem.includes('evil.js')),
    problems.join('\n'),
  );
});

test('an absolute module import in bundled code fails', async t => {
  const dir = await makeBundle(t);
  const modulePath = join(dir, 'i18n.mjs');
  const source = await readFile(modulePath, 'utf8');
  await writeFile(modulePath, `${source}\nimport 'https://cdn.example.com/extra.mjs';\n`);
  const problems = await verifyBundle(dir, realConfig);
  assert.ok(
    problems.some(problem => problem.startsWith('i18n.mjs:') && problem.includes('cdn.example.com')),
    problems.join('\n'),
  );
});

test('navigational legal and documentation links are allowed', async t => {
  const dir = await makeBundle(t);
  const privacy = await readFile(join(dir, 'datenschutz.html'), 'utf8');
  assert.match(privacy, /https:\/\/www\.lda\.bayern\.de\//);
  const problems = await verifyBundle(dir, realConfig);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('capacitor config with server.url is rejected', async t => {
  const dir = await makeBundle(t);
  const configPath = join(dir, 'capacitor.config.json');
  await writeFile(
    configPath,
    JSON.stringify({ appId: 'test', webDir: 'www', server: { url: 'https://example.com' } }),
  );
  const problems = await verifyBundle(dir, configPath);
  assert.ok(
    problems.some(problem => problem.includes('server.url')),
    problems.join('\n'),
  );
});

test('capacitor config with server.hostname is rejected', async t => {
  const dir = await makeBundle(t);
  const configPath = join(dir, 'capacitor.config.json');
  await writeFile(
    configPath,
    JSON.stringify({ appId: 'test', webDir: 'www', server: { hostname: 'example.com' } }),
  );
  const problems = await verifyBundle(dir, configPath);
  assert.ok(
    problems.some(problem => problem.includes('server.hostname')),
    problems.join('\n'),
  );
});

test('the repository capacitor config loads from the local origin', async t => {
  const config = JSON.parse(await readFile(realConfig, 'utf8'));
  assert.equal(config.server?.url, undefined);
  assert.equal(config.server?.hostname, undefined);
  const problems = await verifyBundle(staticDir, realConfig);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('REQUIRED_FILES covers every module imported at runtime', async () => {
  const required = new Set(REQUIRED_FILES);
  const visited = new Set();
  const queue = ['index.html'];

  while (queue.length > 0) {
    const rel = queue.shift();
    const source = await readFile(join(staticDir, rel), 'utf8');
    for (const match of source.matchAll(RELATIVE_TARGET_RE)) {
      const target = match[1];
      if (target.includes('${')) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(rel), target));
      if (visited.has(resolved)) continue;
      visited.add(resolved);
      queue.push(resolved);
    }
  }

  for (const module of visited) {
    assert.ok(required.has(module), `runtime module ${module} is missing from REQUIRED_FILES`);
    assert.ok(await fileExists(join(staticDir, module)), `runtime module ${module} does not exist`);
  }
  assert.ok(visited.has('platform.mjs'), 'the import graph must reach platform.mjs');
  assert.ok(visited.has('speech-adapter.js'), 'the import graph must reach speech-adapter.js');
});
