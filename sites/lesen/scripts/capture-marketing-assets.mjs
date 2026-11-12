// Regenerates the marketing site's product imagery from the real app in `static/`.
//
// Usage: node scripts/capture-marketing-assets.mjs
//
// Requires a Chrome/Chromium binary (CHROME_PATH overrides the default lookup) and
// `cwebp` from libwebp for the responsive variants. Everything else uses the Node
// standard library plus the DevTools protocol, so no npm dependencies are added.
//
// Re-run this whenever the app's selection or reading screen changes visually.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const root = resolve(new URL('../', import.meta.url).pathname);
const staticDir = join(root, 'static');
const outDir = join(root, 'marketing', 'images');

const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function serve(directory) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = join(directory, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': mimeTypes[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

class DevTools {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${message.error.message} (${pending.method})`));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.#listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new DevTools(socket);
  }

  on(method, listener) {
    this.#listeners.set(method, [...(this.#listeners.get(method) ?? []), listener]);
  }

  once(method) {
    return new Promise(resolve => {
      const listener = params => {
        this.#listeners.set(method, (this.#listeners.get(method) ?? []).filter(entry => entry !== listener));
        resolve(params);
      };
      this.on(method, listener);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject, method }));
  }

  close() {
    this.#socket.close();
  }
}

async function launchChrome(profileDir) {
  const executable = chromeCandidates.find(Boolean);
  const child = spawn(executable, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const portFile = join(profileDir, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const [port] = (await readFile(portFile, 'utf8')).trim().split('\n');
      return { child, port: Number(port) };
    } catch {
      await sleep(100);
    }
  }
  child.kill();
  throw new Error(`Chrome did not expose a DevTools port (${executable})`);
}

async function openPage(devtools, port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(target => target.type === 'page');
  const { sessionId } = await devtools.send('Target.attachToTarget', { targetId: page.id, flatten: true });
  await devtools.send('Page.enable', {}, sessionId);
  await devtools.send('Runtime.enable', {}, sessionId);
  return sessionId;
}

async function evaluate(devtools, sessionId, expression) {
  const { result, exceptionDetails } = await devtools.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function navigate(devtools, sessionId, url) {
  const loaded = devtools.once('Page.loadEventFired');
  await devtools.send('Page.navigate', { url }, sessionId);
  await loaded;
  await evaluate(devtools, sessionId, 'document.fonts.ready.then(() => true)');
  await sleep(400);
}

async function screenshot(devtools, sessionId, clip) {
  const { data } = await devtools.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  }, sessionId);
  return Buffer.from(data, 'base64');
}

// Clips a vertical slice of the app between two selectors, keeping the full device
// width so the app's own outer padding stays visible.
async function slice(devtools, sessionId, { from, to, padTop = 0, padBottom = 0 }) {
  const box = await evaluate(devtools, sessionId, `(() => {
    const top = document.querySelector(${JSON.stringify(from)}).getBoundingClientRect();
    const bottom = document.querySelector(${JSON.stringify(to)}).getBoundingClientRect();
    return { top: top.top + window.scrollY, bottom: bottom.bottom + window.scrollY, width: window.innerWidth };
  })()`);
  return {
    x: 0,
    y: Math.round(box.top - padTop),
    width: Math.round(box.width),
    height: Math.round(box.bottom - box.top + padTop + padBottom),
  };
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`))));
  });
}

async function writeWebp(png, name, widths) {
  const source = join(outDir, `.source-${name}.png`);
  await writeFile(source, png);
  for (const width of widths) {
    await run('cwebp', ['-quiet', '-q', '86', '-resize', String(width), '0', source, '-o', join(outDir, `${name}-${width}.webp`)]);
  }
  await rm(source);
}

const appStyles = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff8eb; font-family: -apple-system, "Segoe UI", sans-serif; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand-badge { display: grid; place-items: center; width: 104px; height: 104px; border-radius: 28px; background: #ffd84c; color: #07346d; font-size: 60px; transform: rotate(-5deg); }
  .brand-name { color: #07346d; font-size: 40px; font-weight: 800; letter-spacing: -.5px; }
`;

const ogCard = `
  <html><head><meta charset="utf-8"><style>${appStyles}
    body {
      display: grid;
      width: 1200px;
      height: 630px;
      grid-template-columns: 1.05fr .95fr;
      align-items: center;
      gap: 40px;
      padding: 64px 72px;
      background:
        radial-gradient(circle at 86% 12%, rgba(255, 216, 76, .28), transparent 20rem),
        linear-gradient(135deg, #0b4288 0%, #08336f 58%, #102b60 100%);
    }
    .copy { color: #fff; }
    .eyebrow { margin: 0 0 20px; color: #ffe083; font-size: 20px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
    h1 { margin: 0 0 22px; font-size: 76px; line-height: 1.06; letter-spacing: -2px; }
    h1 span { color: #ffd84c; }
    p { margin: 0; max-width: 30ch; color: #e1edff; font-size: 27px; line-height: 1.45; }
    .art { position: relative; display: grid; place-items: center; }
    .art img { width: 460px; height: 460px; object-fit: contain; border-radius: 84px; background: #fff; padding: 18px; box-shadow: 0 30px 60px rgba(0,0,0,.28); transform: rotate(3deg); }
  </style></head>
  <body>
    <div class="copy">
      <p class="eyebrow">Kleine Schritte. Große Lese-Momente.</p>
      <h1>Lesen lernen –<br><span>Karte für Karte.</span></h1>
      <p>Die begleitete Leseübung für Kinder – ohne Werbung, ohne Konto.</p>
    </div>
    <div class="art"><img src="/images/buchstabenzeit-logo.png" alt=""></div>
  </body></html>`;

const touchIcon = `
  <html><head><meta charset="utf-8"><style>
    body { margin: 0; }
    .tile { display: grid; width: 180px; height: 180px; place-items: center; background: linear-gradient(160deg, #0b4288, #07346d); }
    img { width: 150px; height: 150px; border-radius: 34px; }
  </style></head>
  <body><div class="tile"><img src="/images/buchstabenzeit-logo.png" alt=""></div></body></html>`;

async function main() {
  await mkdir(outDir, { recursive: true });
  const served = await serve(staticDir);
  const profile = await mkdtemp(join(tmpdir(), 'buchstabenzeit-capture-'));
  const { child, port } = await launchChrome(profile);
  const devtools = await DevTools.connect((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);

  try {
    const sessionId = await openPage(devtools, port);
    await devtools.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    }, sessionId);

    await navigate(devtools, sessionId, `${served.origin}/index.html`);

    const setupShot = await slice(devtools, sessionId, { from: '.letter-group', to: '#specials', padTop: 10, padBottom: 30 });
    const setupPng = await screenshot(devtools, sessionId, setupShot);
    await writeWebp(setupPng, 'app-auswahl', [480, 780]);

    await evaluate(devtools, sessionId, `(() => {
      document.querySelector('#start-button').click();
      return true;
    })()`);
    await sleep(900);

    // The first card is drawn at random; prefer a plain lower-case syllable for the
    // marketing shot instead of a capitalised pattern that can look like a typo.
    for (let attempt = 0; attempt < 12; attempt++) {
      const syllable = await evaluate(devtools, sessionId, 'document.querySelector("#syllable").textContent.trim()');
      if (/^[a-zäöüß]{2,4}$/u.test(syllable)) break;
      await evaluate(devtools, sessionId, 'document.querySelector("#retry").click(), true');
      await sleep(300);
    }
    await sleep(300);

    const cardShot = await slice(devtools, sessionId, { from: '.reading-card', to: '.actions', padTop: 16, padBottom: 20 });
    const cardPng = await screenshot(devtools, sessionId, cardShot);
    await writeWebp(cardPng, 'app-lesekarte', [520, 780]);

    const mascot = await readFile(join(staticDir, 'images', 'buchstabenzeit-logo.png'));
    await writeWebp(mascot, 'eule', [192, 384]);

    await devtools.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
    await devtools.send('Emulation.setDeviceMetricsOverride', {
      width: 1200, height: 630, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    await devtools.send('Page.setDocumentContent', { frameId: (await devtools.send('Page.getFrameTree', {}, sessionId)).frameTree.frame.id, html: ogCard }, sessionId);
    await sleep(700);
    const og = await devtools.send('Page.captureScreenshot', { format: 'jpeg', quality: 86, captureBeyondViewport: true }, sessionId);
    await writeFile(join(outDir, 'og-card.jpg'), Buffer.from(og.data, 'base64'));

    await devtools.send('Emulation.setDeviceMetricsOverride', {
      width: 180, height: 180, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    await devtools.send('Page.setDocumentContent', { frameId: (await devtools.send('Page.getFrameTree', {}, sessionId)).frameTree.frame.id, html: touchIcon }, sessionId);
    await sleep(500);
    const icon = await screenshot(devtools, sessionId, { x: 0, y: 0, width: 180, height: 180 });
    await writeFile(join(outDir, 'apple-touch-icon.png'), icon);

    console.log(`marketing assets written to ${outDir}`);
  } finally {
    devtools.close();
    child.kill();
    served.close();
    await sleep(500);
    await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
}

await main();
