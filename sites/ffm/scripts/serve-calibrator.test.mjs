// serve-calibrator.test.mjs — the pure pieces of the calibrator server plus one
// end-to-end request against a throwaway directory. No repo state is touched:
// the origin/main extraction is exercised by hand, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { contentType, createStaticServer, firstFreePort, isDirectInvocation, isPortBusy, parseArgs, resolveRequestPath } = await import('./serve-calibrator.mjs');
const SELF = new URL('./serve-calibrator.mjs', import.meta.url);

test('parseArgs defaults to serving origin/main on port 8000', () => {
  assert.deepEqual(parseArgs([]), { worktree: false, offline: false, port: 8000, help: false });
  assert.deepEqual(parseArgs(['--worktree', '--offline', '--port', '0']), { worktree: true, offline: true, port: 0, help: false });
  assert.equal(parseArgs(['--port=8081']).port, 8081);
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--port', 'eighty']), /--port needs a port number/);
  assert.throws(() => parseArgs(['--wat']), /unknown argument/);
});

test('contentType covers the module, art and data types the game loads', () => {
  assert.match(contentType('/x/game/main.js'), /javascript/);
  assert.equal(contentType('/x/game/levels/level-01.webp'), 'image/webp');
  assert.match(contentType('/x/levels/manifest.json'), /application\/json/);
  assert.match(contentType('/x/game/calibrate.html'), /text\/html/);
  assert.equal(contentType('/x/mystery.bin'), 'application/octet-stream');
});

test('resolveRequestPath keeps requests inside the served root', () => {
  const root = '/tmp/served-static';
  assert.equal(resolveRequestPath(root, '/game/calibrate.html'), join(root, 'game/calibrate.html'));
  assert.equal(resolveRequestPath(root, '/game/calibrate.html?v=62'), join(root, 'game/calibrate.html'));
  assert.equal(resolveRequestPath(root, '/'), join(root, 'index.html'));
  assert.equal(resolveRequestPath(root, '/../../etc/passwd'), null);
  assert.equal(resolveRequestPath(root, '/%2e%2e/%2e%2e/etc/passwd'), null);
  assert.equal(resolveRequestPath(root, '/%zz'), null, 'a malformed escape is refused, not thrown');
});

// fetch() normalises ".." away client-side, so the traversal case needs a raw
// request path to reach the server the way a hostile client would send it.
const rawGet = (port, path) => new Promise((done, fail) => {
  const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
    res.resume();
    done(res.statusCode);
  });
  req.on('error', fail);
  req.end();
});

test('the server serves a file, a directory index, and 404s the rest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'serve-calibrator-test-'));
  mkdirSync(join(dir, 'game'));
  writeFileSync(join(dir, 'game', 'calibrate.html'), '<!doctype html><title>cal</title>');
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>game</title>');
  const server = createStaticServer(dir);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/game/calibrate.html`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal(page.headers.get('cache-control'), 'no-store', 'a calibration tool must never be served from cache');
    assert.match(await page.text(), /cal/);

    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /game/);

    assert.equal((await fetch(`${base}/game/missing.js`)).status, 404);
    assert.equal(await rawGet(server.address().port, '/../outside'), 403, 'path traversal is refused');
    assert.equal((await fetch(`${base}/game/calibrate.html`, { method: 'POST' })).status, 405);
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isDirectInvocation recognises the script through a symlinked path', async () => {
  // `node /tmp/copy.mjs` must run main(); on macOS /tmp is a symlink to
  // /private/tmp, so a raw URL comparison silently does nothing.
  const dir = mkdtempSync(join(tmpdir(), 'serve-calibrator-link-'));
  const link = join(dir, 'serve-calibrator.mjs');
  try {
    symlinkSync(new URL(SELF), link);
    assert.equal(isDirectInvocation(link, SELF.href), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(isDirectInvocation(SELF.pathname, SELF.href), true);
  assert.equal(isDirectInvocation(undefined, SELF.href), false, 'being imported is not an invocation');
  assert.equal(isDirectInvocation('/nope/missing.mjs', SELF.href), false);
  assert.equal(pathToFileURL('/tmp/x.mjs').href.startsWith('file:///tmp/'), true);
});

test('isPortBusy notices a listener that only bound another loopback family', async () => {
  const server = createStaticServer(process.cwd());
  await new Promise((done) => server.listen(0, '::1', done));
  const { port } = server.address();
  try {
    assert.equal(await isPortBusy(port), true, 'an IPv6-only listener still blocks the URL');
    assert.equal(await firstFreePort(port), port + 1, 'the next free port is used instead');
    assert.equal(await firstFreePort(port, 5, async () => false), port, 'a free port is used as given');
  } finally {
    await new Promise((done) => server.close(done));
  }
});
