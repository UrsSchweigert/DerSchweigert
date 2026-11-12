// calibrate.js — standalone visual tool for tuning the hero's and each fiend
// class's ground-contact offset by eye. Reuses the real game's Renderer,
// Hero, Fiend (via Slimeling) and difficulty-classes modules directly, so
// what you see here is pixel-identical to what the real game renders once
// you paste the generated values back into entities.js / difficulty-classes.js.
// Not part of the shipped game — a dev tool only, reachable at calibrate.html.

import { Renderer, CANVAS_W, GROUND_Y } from './renderer.js';
import { Hero, Slimeling, getHeroGroundOffsetPx, setHeroGroundOffsetPx } from './entities.js';
import { FIEND_CLASSES, getFiendClass } from './difficulty-classes.js';
import { LEVEL_ART_MANIFEST } from './level-art.js';
// The parsed manifest carries only the file names, so the chapter labels come
// from the raw JSON — same import form level-art.js already uses.
import levelManifestSource from './levels/manifest.json' with { type: 'json' };

const FIEND_CAL_X = 560; // fixed on-screen position for the calibration fiend

// The ground line the level currently under inspection stands on. Moving it takes
// the hero, the fiend and the red line with it, and the result is remembered per
// level so the "copy" button can emit the manifest overrides.
const GROUND_Y_FLOOR = 240;   // same band the game accepts (level-art.js)
const GROUND_Y_CEILING = 436;
let groundY = GROUND_Y;
const sessionGroundOverrides = new Map(); // level -> y

// Snapshot of the CURRENT hard-coded defaults, so "copy code" always reflects
// (these defaults + whatever you've changed this session), even though the
// live preview mutates FIEND_CLASSES entries in memory as you tune.
const DEFAULT_RATIOS = FIEND_CLASSES.map((c) => c.bottomPadRatio);
const DEFAULT_HERO_OFFSET = getHeroGroundOffsetPx();

const sessionRatioOverrides = new Map(); // id -> ratio
let heroOffsetPx = DEFAULT_HERO_OFFSET;
let selectedId = 1;

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const hero = new Hero();
const fiend = new Slimeling(FIEND_CAL_X, GROUND_Y, 1);
fiend.setState('idle'); // static pose — we never call fiend.update(), so it never walks/animates away

const classSelect = document.getElementById('class-select');
FIEND_CLASSES.forEach((c) => {
  const opt = document.createElement('option');
  opt.value = String(c.id);
  opt.textContent = `${c.id} — ${c.name}`;
  classSelect.appendChild(opt);
});
classSelect.value = '1';

// ─── background level ─────────────────────────────────────────────────────────
// The 60 level backgrounds each paint their walkable floor at a different height,
// so the feet baseline has to be judged against the level that ships with it.
const LEVEL_NUMBERS = Object.keys(LEVEL_ART_MANIFEST.levels).map(Number).sort((a, b) => a - b);
const levelSelect = document.getElementById('level-select');
const levelValueEl = document.getElementById('level-value');
let selectedLevel = LEVEL_NUMBERS[0] ?? 1;

function levelLabel(level) {
  const chapter = levelManifestSource?.levels?.[String(level)]?.chapter;
  return `L${String(level).padStart(2, '0')}${chapter ? ` · ${chapter}` : ''}`;
}

LEVEL_NUMBERS.forEach((level) => {
  const opt = document.createElement('option');
  opt.value = String(level);
  opt.textContent = levelLabel(level);
  levelSelect.appendChild(opt);
});

function selectLevel(level) {
  const count = LEVEL_NUMBERS.length;
  selectedLevel = count ? LEVEL_NUMBERS[((level - 1) % count + count) % count] : level;
  levelSelect.value = String(selectedLevel);
  levelValueEl.textContent = levelLabel(selectedLevel);
  renderer.setBackgroundByLevel(selectedLevel);
  // setBackgroundByLevel() already resolved this level's own line from the
  // manifest; a value tuned in this session wins over it.
  setGroundY(sessionGroundOverrides.get(selectedLevel) ?? renderer.groundY);
  // The draw loop repaints immediately; awaiting only guarantees the caller that
  // the swap is complete, which keeps screenshots and DevTools checks deterministic.
  return renderer.waitForBackgroundLoad();
}

function groundValueLabel() {
  const shipped = renderer.groundY;
  const tuned = groundY !== shipped;
  return tuned ? `${groundY} (was ${shipped})` : `${groundY}`;
}

function setGroundY(value) {
  groundY = Math.min(GROUND_Y_CEILING, Math.max(GROUND_Y_FLOOR, Math.round(value)));
  if (groundY === renderer.groundY) sessionGroundOverrides.delete(selectedLevel);
  else sessionGroundOverrides.set(selectedLevel, groundY);
  hero.y = groundY;
  fiend.y = groundY;
  groundValueEl.textContent = groundValueLabel();
}

function resetGroundY() {
  sessionGroundOverrides.delete(selectedLevel);
  setGroundY(renderer.groundY);
}

levelSelect.addEventListener('change', () => selectLevel(parseInt(levelSelect.value, 10)));
document.querySelectorAll('[data-level-nav]').forEach((btn) => {
  btn.addEventListener('click', () => selectLevel(selectedLevel + parseInt(btn.dataset.levelNav, 10)));
});

document.querySelectorAll('[data-ground-step]').forEach((btn) => {
  btn.addEventListener('click', () => setGroundY(groundY + parseInt(btn.dataset.groundStep, 10)));
});
document.querySelector('[data-ground-reset]').addEventListener('click', resetGroundY);

const heroValueEl = document.getElementById('hero-value');
const fiendValueEl = document.getElementById('fiend-value');
const groundValueEl = document.getElementById('ground-value');

function currentRatio(id) {
  return sessionRatioOverrides.has(id) ? sessionRatioOverrides.get(id) : DEFAULT_RATIOS[id - 1];
}

function applyLive() {
  setHeroGroundOffsetPx(heroOffsetPx);
  getFiendClass(selectedId).bottomPadRatio = currentRatio(selectedId);
  heroValueEl.textContent = String(heroOffsetPx);
  fiendValueEl.textContent = currentRatio(selectedId).toFixed(3);
}

function setHeroOffset(px) {
  heroOffsetPx = px;
  applyLive();
}

function setFiendRatio(id, ratio) {
  sessionRatioOverrides.set(id, Math.max(0, Math.round(ratio * 1000) / 1000));
  applyLive();
}

function selectClass(id) {
  const count = FIEND_CLASSES.length;
  selectedId = ((id - 1 + count) % count) + 1;
  classSelect.value = String(selectedId);
  applyLive();
}

classSelect.addEventListener('change', () => selectClass(parseInt(classSelect.value, 10)));

document.querySelectorAll('[data-hero-step]').forEach((btn) => {
  btn.addEventListener('click', () => setHeroOffset(heroOffsetPx + parseFloat(btn.dataset.heroStep)));
});
document.querySelector('[data-hero-reset]').addEventListener('click', () => setHeroOffset(DEFAULT_HERO_OFFSET));

document.querySelectorAll('[data-fiend-step]').forEach((btn) => {
  btn.addEventListener('click', () => setFiendRatio(selectedId, currentRatio(selectedId) + parseFloat(btn.dataset.fiendStep)));
});
document.querySelector('[data-fiend-reset]').addEventListener('click', () => {
  sessionRatioOverrides.delete(selectedId);
  applyLive();
});
document.querySelectorAll('[data-fiend-nav]').forEach((btn) => {
  btn.addEventListener('click', () => selectClass(selectedId + parseInt(btn.dataset.fiendNav, 10)));
});

window.addEventListener('keydown', (e) => {
  // A native <select> also uses Up/Down to browse its own options, and would
  // otherwise fight with these shortcuts (double-changing state) whenever the
  // dropdown has focus. Only handle these shortcuts when focus is elsewhere
  // (e.g. the body/canvas) — let form controls handle their own keys.
  const tag = (e.target && e.target.tagName || '').toLowerCase();
  if (tag === 'select' || tag === 'input' || tag === 'textarea') return;

  const big = e.shiftKey;
  if (e.key === 'ArrowUp')    { setFiendRatio(selectedId, currentRatio(selectedId) + (big ? 0.02 : 0.005)); e.preventDefault(); }
  if (e.key === 'ArrowDown')  { setFiendRatio(selectedId, currentRatio(selectedId) - (big ? 0.02 : 0.005)); e.preventDefault(); }
  if (e.key === 'ArrowLeft')  { selectClass(selectedId - 1); e.preventDefault(); }
  if (e.key === 'ArrowRight') { selectClass(selectedId + 1); e.preventDefault(); }
  if (e.key === 'PageUp')     { setHeroOffset(heroOffsetPx + (big ? 5 : 1)); e.preventDefault(); }
  if (e.key === 'PageDown')   { setHeroOffset(heroOffsetPx - (big ? 5 : 1)); e.preventDefault(); }
  if (e.key === '[')          { selectLevel(selectedLevel - 1); e.preventDefault(); }
  if (e.key === ']')          { selectLevel(selectedLevel + 1); e.preventDefault(); }
  if (e.key === '-' || e.key === '_') { setGroundY(groundY - (big ? 5 : 1)); e.preventDefault(); }
  if (e.key === '+' || e.key === '=') { setGroundY(groundY + (big ? 5 : 1)); e.preventDefault(); }
});

function trimNum(n) {
  return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0');
}

document.getElementById('copy-btn').addEventListener('click', () => {
  const finalRatios = DEFAULT_RATIOS.map((def, idx) =>
    sessionRatioOverrides.has(idx + 1) ? sessionRatioOverrides.get(idx + 1) : def
  );
  const rows = [];
  for (let start = 0; start < finalRatios.length; start += 18) {
    rows.push(finalRatios.slice(start, start + 18).map(trimNum).join(', '));
  }
  // One flat table, one entry per class (18 young, 18 old, 18 ancient, 6 dragons).
  const body = rows.map((row, index) => `  // ${['young', 'old', 'ancient', 'dragons'][index] ?? 'class'}\n  ${row},`).join('\n');
  const groundRows = [...sessionGroundOverrides.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, y]) => `    "${level}": ${y}`);
  const groundSnippet = groundRows.length
    ? `"groundY": {\n${groundRows.join(',\n')}\n  }`
    : '"groundY": {}';
  const code = `// --- entities.js: replace the hero ground offset with ---\n`
    + `let _heroGroundOffsetPx = ${heroOffsetPx};\n\n`
    + `// --- difficulty-classes.js: replace the BOTTOM_PAD_RATIO array with ---\n`
    + `const BOTTOM_PAD_RATIO = [\n${body}\n];\n\n`
    + `// --- levels/manifest.json: replace the \"groundY\" object with ---\n`
    + `${groundSnippet}\n`;
  const out = document.getElementById('output');
  out.value = code;
  navigator.clipboard?.writeText(code).catch(() => {});
});

function drawGroundLine() {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.strokeStyle = '#ff2040';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, groundY + 0.5);
  ctx.lineTo(CANVAS_W, groundY + 0.5);
  ctx.stroke();
  ctx.restore();
}

// Magnified inset showing a tight window around each character's feet and the
// ground line — judging a 1-2px snap on the full-size 800x450 canvas is hard;
// zooming ~6x makes the exact pixel where feet meet the line unambiguous.
const ZOOM = 6;
const WIN_W = 100; // source px captured around each subject, before zoom — wide
                    // enough to include both hero boots in one window
const WIN_H = 40;

function drawMagnifier(id, canvasEl, subjectX) {
  const ctx = canvasEl.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  const sx = Math.round(subjectX - WIN_W / 2);
  const sy = Math.round(groundY - WIN_H / 2);
  ctx.drawImage(canvas, sx, sy, WIN_W, WIN_H, 0, 0, WIN_W * ZOOM, WIN_H * ZOOM);
  // re-draw the ground line at zoomed scale for a crisp, unambiguous reference
  const lineY = (groundY - sy) * ZOOM;
  ctx.strokeStyle = '#ff2040';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, lineY);
  ctx.lineTo(canvasEl.width, lineY);
  ctx.stroke();
}

const heroZoomCanvas = document.getElementById('hero-zoom');
const fiendZoomCanvas = document.getElementById('fiend-zoom');

function loop() {
  renderer.clear();
  renderer.drawBackground(0);
  hero.y = groundY;
  renderer.drawEntity(hero);
  fiend.fiendClassId = selectedId;
  fiend.x = FIEND_CAL_X;
  fiend.y = groundY;
  renderer.drawEntity(fiend);
  drawGroundLine();
  drawMagnifier('hero', heroZoomCanvas, hero.x);
  drawMagnifier('fiend', fiendZoomCanvas, FIEND_CAL_X);
  requestAnimationFrame(loop);
}

applyLive();
selectLevel(selectedLevel);
requestAnimationFrame(loop);
