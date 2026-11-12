#!/usr/bin/env node
// serve-calibrator.mjs — serves sites/ffm/static for the ground calibrator
// (game/calibrate.html) and the game itself.
//
// It serves `origin/main` by default, extracted into a temp directory, and NOT
// whatever branch happens to be checked out. That default exists because the
// obvious `cd sites/ffm/static && python3 -m http.server` is branch-relative:
// running it on a feature branch silently serves that branch's older game — no
// level art, an old GROUND_Y, a calibrator without the level or ground controls —
// and the only symptom is that the tool "looks wrong".
//
//   node sites/ffm/scripts/serve-calibrator.mjs              # origin/main
//   node sites/ffm/scripts/serve-calibrator.mjs --worktree   # this checkout, with a staleness warning
//   node sites/ffm/scripts/serve-calibrator.mjs --port 8080 --offline
import { execFileSync } from 'node:child_process';
import { createReadStream, mkdirSync, rmSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const STATIC_DIR = join('sites', 'ffm', 'static');
const DEFAULT_PORT = 8000;
const ORIGIN = 'origin/main';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

export function contentType(file) {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

// Maps a request URL onto a file below `root`, or null when it escapes the root.
// Decoding happens before the comparison, so "%2e%2e%2f" is caught like "../".
export function resolveRequestPath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent((urlPath ?? '/').split('?')[0]);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '');
  const target = resolve(root, relative === '' ? 'index.html' : relative);
  const prefix = root.endsWith(sep) ? root : root + sep;
  return target === root || target.startsWith(prefix) ? target : null;
}

export function parseArgs(argv) {
  const options = { worktree: false, offline: false, port: DEFAULT_PORT, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--worktree') options.worktree = true;
    else if (arg === '--offline') options.offline = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--port') {
      const value = Number.parseInt(argv[++i] ?? '', 10);
      if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`--port needs a port number, got ${argv[i]}`);
      options.port = value;
    } else if (arg.startsWith('--port=')) {
      const value = Number.parseInt(arg.slice('--port='.length), 10);
      if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`--port needs a port number, got ${arg}`);
      options.port = value;
    } else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

export function createStaticServer(root) {
  return createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' }).end('GET or HEAD only\n');
      return;
    }
    const target = resolveRequestPath(root, request.url);
    if (!target) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('outside the served tree\n');
      return;
    }
    try {
      const info = await stat(target);
      // A calibration tool must never be a cache: no-store keeps a reload from
      // resurrecting an old module after the tree was re-extracted.
      const file = info.isDirectory() ? join(target, 'index.html') : target;
      const size = (await stat(file)).size;
      response.writeHead(200, {
        'content-type': contentType(file),
        'content-length': size,
        'cache-control': 'no-store',
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found\n');
    }
  });
}

const git = (repoRoot, args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();

export function repoRootOf(cwd = process.cwd()) {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

// Extracts sites/ffm/static from `ref` into `workDir` and returns the served root.
export function extractRef(repoRoot, ref, workDir) {
  const archive = join(workDir, 'static.tar');
  execFileSync('git', ['-C', repoRoot, 'archive', '--format=tar', '-o', archive, ref, STATIC_DIR.split(sep).join('/')]);
  execFileSync('tar', ['-xf', archive, '-C', workDir]);
  rmSync(archive, { force: true });
  return join(workDir, STATIC_DIR);
}

export function describeCommit(repoRoot, ref) {
  const sha = git(repoRoot, ['rev-parse', '--short', ref]);
  const subject = git(repoRoot, ['log', '-1', '--format=%s', ref]);
  return `${ref} @ ${sha} — ${subject}`;
}

function usage() {
  return [
    'Serves sites/ffm/static for the ground calibrator (game/calibrate.html).',
    '',
    '  node sites/ffm/scripts/serve-calibrator.mjs            serve origin/main (default)',
    '  node sites/ffm/scripts/serve-calibrator.mjs --worktree serve this checkout instead',
    '',
    'Options:',
    '  --worktree   serve the working tree, not origin/main (warns when it is behind)',
    '  --offline    do not fetch origin/main first',
    '  --port N     port to listen on (default 8000, 0 picks a free one)',
    '  --help       this text',
  ].join('\n');
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }

  const repoRoot = repoRootOf();
  let servedRoot;
  let label;
  let cleanup = () => {};

  if (options.worktree) {
    servedRoot = join(repoRoot, STATIC_DIR);
    label = `working tree @ ${git(repoRoot, ['rev-parse', '--short', 'HEAD'])} — ${git(repoRoot, ['log', '-1', '--format=%s', 'HEAD'])}`;
    const branch = git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    try {
      const behind = Number.parseInt(git(repoRoot, ['rev-list', '--count', 'HEAD..' + ORIGIN]), 10);
      if (behind > 0) {
        console.warn(
          `\n  WARNING  ${branch} is ${behind} commit(s) behind ${ORIGIN}.\n`
          + `           This tree may predate the level art or the ground-line work, so the\n`
          + `           calibrator can look broken. Drop --worktree to serve ${ORIGIN} instead.\n`,
        );
      }
    } catch {
      console.warn(`  note: cannot compare with ${ORIGIN} (not fetched); serving the working tree as-is.`);
    }
  } else {
    if (!options.offline) {
      try {
        execFileSync('git', ['-C', repoRoot, 'fetch', '--quiet', 'origin', 'main'], { stdio: ['ignore', 'ignore', 'pipe'] });
      } catch {
        console.warn(`  warning: git fetch failed; serving the locally known ${ORIGIN}. Use --offline to silence this.`);
      }
    }
    // A stable directory per repo, cleared on start: a hard-killed run must not
    // leave 150 MB of extracted static behind on every crash.
    const workDir = join(tmpdir(), `ffm-calibrator-${basename(repoRoot)}`);
    rmSync(workDir, { recursive: true, force: true });
    mkdirSync(workDir, { recursive: true });
    servedRoot = extractRef(repoRoot, ORIGIN, workDir);
    label = describeCommit(repoRoot, ORIGIN);
    cleanup = () => rmSync(workDir, { recursive: true, force: true });
  }

  const server = createStaticServer(servedRoot);
  server.on('error', (error) => {
    cleanup();
    if (error.code === 'EADDRINUSE') {
      console.error(`port ${options.port} is in use — pass --port with a free one.`);
    } else {
      console.error(error.message);
    }
    process.exitCode = 1;
  });
  server.listen(options.port, '127.0.0.1', () => {
    const { port } = server.address();
    console.log(`\n  serving  ${label}`);
    console.log(`  root     ${servedRoot}`);
    console.log(`\n  calibrator  http://127.0.0.1:${port}/game/calibrate.html`);
    console.log(`  game        http://127.0.0.1:${port}/index.html\n`);
  });

  const stop = () => {
    server.close();
    cleanup();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
