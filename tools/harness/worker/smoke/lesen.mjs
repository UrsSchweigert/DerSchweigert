// Browser smoke test for the lesen page. Trusted harness code: it is baked into the worker image, and a worker cannot change it.
// Usage: node /opt/harness/smoke/lesen.mjs <repository root>
// It serves sites/lesen/static, opens the page in headless Chromium, and fails on anything a user would see broken.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.resolve(process.argv[2] || '.');
const staticDir = path.join(root, 'sites', 'lesen', 'static');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};
const problems = [];
const fail = (message) => problems.push(message);

if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
  console.log(`FAIL: ${staticDir}/index.html does not exist`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.normalize(path.join(staticDir, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!file.startsWith(staticDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const watchdog = setTimeout(() => { console.log('FAIL: smoke test timed out after 90 seconds'); process.exit(1); }, 90000);
let browser;

async function step(name, fn) {
  try { await fn(); } catch (e) { fail(`${name}: ${String(e.message || e).split('\n')[0]}`); }
}

async function letterGroups(page) {
  return page.evaluate(() => [...document.querySelectorAll('fieldset, [role=group]')].map((g) => ({
    name: (g.querySelector('legend')?.textContent || g.getAttribute('aria-label') || '').trim(),
    buttons: g.querySelectorAll('button').length,
  })));
}

function expectGroups(groups, where) {
  for (const [label, re, min] of [['consonants', /^Konsonanten/, 15], ['vowels', /^Vokale/, 5], ['specials', /^Besonderheiten/, 4]]) {
    const g = groups.find((x) => re.test(x.name));
    if (!g) fail(`${where}: the ${label} group is missing`);
    else if (g.buttons < min) fail(`${where}: the ${label} group has ${g.buttons} letter buttons, expected at least ${min}`);
  }
}

async function wordCount(page) {
  const text = await page.getByRole('radio', { name: /^Wörter/ }).evaluate((r) => r.closest('label').innerText);
  const m = /(\d+)\s+Wörter passen/.exec(text.replace(/\s+/g, ' '));
  if (!m) throw new Error(`the word counter does not show a number (it says: ${text.replace(/\s+/g, ' ').trim()})`);
  return Number(m[1]);
}

try {
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (e) => fail(`page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') fail(`console error: ${m.text()}`); });
  page.on('requestfailed', (r) => fail(`request failed: ${r.url()} (${r.failure()?.errorText})`));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) fail(`HTTP ${r.status()} for ${r.url()}`); });

  await step('load the page', async () => { await page.goto(`${base}/index.html`, { waitUntil: 'networkidle', timeout: 20000 }); });
  await step('setup screen letters', async () => expectGroups(await letterGroups(page), 'setup screen'));

  let before;
  await step('word counter', async () => { before = await wordCount(page); });
  await step('selecting a letter updates the counter', async () => {
    await page.getByRole('group', { name: /^Konsonanten/ }).getByRole('button', { name: 'b', exact: true }).click();
    const after = await wordCount(page);
    if (before !== undefined && after < before) throw new Error(`adding a letter lowered the word count from ${before} to ${after}`);
  });

  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await step('start a session', async () => {
    await page.getByRole('button', { name: /Lesen starten/ }).click();
    await page.getByRole('button', { name: 'Richtig gelesen' }).waitFor({ state: 'visible', timeout: 8000 });
  });
  await step('answer every card', async () => {
    for (let answered = 0; answered < 80; answered++) {
      const done = await page.getByRole('heading', { name: /Alle Karten geschafft/ }).isVisible().catch(() => false);
      if (done) break;
      const ok = page.getByRole('button', { name: 'Richtig gelesen' });
      if (!(await ok.isVisible().catch(() => false))) break;
      await (answered % 3 === 2 ? page.getByRole('button', { name: 'Noch üben' }) : ok).click();
      await page.waitForTimeout(60);
    }
    await page.getByRole('heading', { name: /Alle Karten geschafft/ }).waitFor({ state: 'visible', timeout: 5000 });
  });
  await step('card statistics are saved', async () => {
    const raw = await page.evaluate(() => localStorage.getItem('buchstabenzeit:card-stats'));
    if (!raw) throw new Error('no card statistics were saved after a session');
    const stats = JSON.parse(raw);
    const bad = Object.entries(stats).filter(([, v]) => !Number.isInteger(v.correct_count) || !Number.isInteger(v.incorrect_count));
    if (!Object.keys(stats).length || bad.length) throw new Error('card statistics are empty or lack correct_count and incorrect_count');
  });
  await step('back to the setup screen', async () => {
    await page.getByRole('button', { name: /Buchstaben ändern/ }).click();
    await page.getByRole('group', { name: /^Konsonanten/ }).waitFor({ state: 'visible', timeout: 5000 });
    expectGroups(await letterGroups(page), 'setup screen after a session');
  });
  await step('landscape layout', async () => {
    await page.setViewportSize({ width: 844, height: 390 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 2) throw new Error(`the page is ${overflow}px wider than a landscape phone screen`);
  });
} catch (e) {
  fail(`smoke test crashed: ${String(e.message || e).split('\n')[0]}`);
} finally {
  clearTimeout(watchdog);
  await browser?.close().catch(() => {});
  server.close();
}

const unique = [...new Set(problems)];
if (unique.length) {
  console.log(unique.map((p) => `FAIL: ${p}`).join('\n'));
  process.exit(1);
}
console.log('OK: lesen smoke test passed (page loads, letters render, a session runs, statistics are saved, landscape fits)');
