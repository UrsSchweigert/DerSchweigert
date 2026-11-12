// calibrate.js — standalone visual tool for tuning the hero's and each fiend
// class's ground-contact offset by eye. Reuses the real game's Renderer,
// Hero, Fiend (via Slimeling) and difficulty-classes modules directly, so
// what you see here is pixel-identical to what the real game renders once
// you paste the generated values back into entities.js / difficulty-classes.js.
// Not part of the shipped game — a dev tool only, reachable at calibrate.html.

import { Renderer, CANVAS_W, GROUND_Y } from './renderer.js';
import { Hero, Slimeling, getHeroGroundOffsetPx, setHeroGroundOffsetPx } from './entities.js';
import { FIEND_CLASSES, getFiendClass } from './difficulty-classes.js';
import { LEVEL_ART_MANIFEST, resolveLevelGroundY } from './level-art.js';
import {
  clampGroundY,
  effectiveGroundOverrides,
  groundSnippet,
  groundStats,
  levelMarker,
  nextUntunedLevel,
  parseStoredOverrides,
  serializeOverrides,
  STORAGE_KEY,
} from './calibrate-state.js';
// The parsed manifest carries only the file names, so the chapter labels come
// from the raw JSON — same import form level-art.js already uses.
import levelManifestSource from './levels/manifest.json' with { type: 'json' };

const FIEND_CAL_X = 560; // fixed on-screen position for the calibration fiend

// The ground line the level currently under inspection stands on. Moving it takes
// the hero, the fiend and the red line with it, and the result is remembered per
// level so the "copy" button can emit the manifest overrides. The tuning survives
// a reload through localStorage: a 60-level pass must not be lost to an accidental
// refresh (see calibrate-state.js for the validation).
let groundY = GROUND_Y;
const sessionGroundOverrides = {}; // level key -> y, saved per browser

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
const LAST_LEVEL_KEY = 'ffm-calibrator-level';
const levelSelect = document.getElementById('level-select');
const levelValueEl = document.getElementById('level-value');
let selectedLevel = LEVEL_NUMBERS[0] ?? 1;

function levelLabel(level) {
  const chapter = levelManifestSource?.levels?.[String(level)]?.chapter;
  return `L${String(level).padStart(2, '0')}${chapter ? ` · ${chapter}` : ''}`;
}

// What levels/manifest.json already ships, so the UI can tell a committed override
// apart from this session's tuning.
const committedGroundOverrides = {};
for (const level of LEVEL_NUMBERS) {
  const shipped = resolveLevelGroundY(level, LEVEL_ART_MANIFEST);
  if (shipped !== null) committedGroundOverrides[String(level)] = shipped;
}

function loadTuning() {
  try {
    const stored = parseStoredOverrides(window.localStorage?.getItem(STORAGE_KEY) ?? '', LEVEL_NUMBERS);
    Object.assign(sessionGroundOverrides, stored);
  } catch {
    // A blocked or full localStorage must not stop the calibrator from opening.
  }
}

function saveTuning() {
  try {
    const text = serializeOverrides(sessionGroundOverrides);
    if (text === '') window.localStorage?.removeItem(STORAGE_KEY);
    else window.localStorage?.setItem(STORAGE_KEY, text);
  } catch {
    // ignore — the tuning is still in memory and the copy button still works
  }
}

function levelOptions() {
  [...levelSelect.options].forEach((option) => {
    const level = Number(option.value);
    const marker = levelMarker(level, sessionGroundOverrides, committedGroundOverrides);
    option.textContent = `${levelLabel(level)}${marker ? ` ${marker}` : ''}`;
  });
}

function renderProgress() {
  const stats = groundStats(LEVEL_NUMBERS, sessionGroundOverrides, committedGroundOverrides);
  const parts = [`${stats.tuned} tuned here`, `${stats.committed} in the manifest`, `${stats.remaining} untouched`];
  progressEl.textContent = `${parts.join(' · ')} — of ${stats.total} levels`;
  progressEl.dataset.remaining = String(stats.remaining);
  levelOptions();
}

LEVEL_NUMBERS.forEach((level) => {
  const opt = document.createElement('option');
  opt.value = String(level);
  opt.textContent = levelLabel(level);
  levelSelect.appendChild(opt);
});

function rememberLevel(level) {
  try {
    window.localStorage?.setItem(LAST_LEVEL_KEY, String(level));
  } catch {
    // ignore
  }
}

function selectLevel(level) {
  const count = LEVEL_NUMBERS.length;
  selectedLevel = count ? LEVEL_NUMBERS[((level - 1) % count + count) % count] : level;
  levelSelect.value = String(selectedLevel);
  levelValueEl.textContent = levelLabel(selectedLevel);
  rememberLevel(selectedLevel);
  renderer.setBackgroundByLevel(selectedLevel);
  // setBackgroundByLevel() already resolved this level's own line from the
  // manifest; a value tuned in this session wins over it.
  applyGroundY(sessionGroundOverrides[String(selectedLevel)] ?? renderer.groundY);
  renderProgress();
  // The draw loop repaints immediately; awaiting only guarantees the caller that
  // the swap is complete, which keeps screenshots and DevTools checks deterministic.
  return renderer.waitForBackgroundLoad();
}

function groundValueLabel() {
  // renderer.groundY is what the manifest ships for this level; showing it makes a
  // tuned value readable as a change rather than a number in isolation.
  const shipped = renderer.groundY;
  const saved = sessionGroundOverrides[String(selectedLevel)] !== undefined;
  return groundY === shipped ? `${groundY}` : `${groundY} (ships ${shipped}${saved ? ', unsaved' : ''})`;
}

// Moves the line, the hero and the fiend without recording an intent — used when a
// level is selected or reset, where the manifest decides the value.
function applyGroundY(value) {
  groundY = clampGroundY(value) ?? GROUND_Y;
  hero.y = groundY;
  fiend.y = groundY;
  groundValueEl.textContent = groundValueLabel();
}

// A deliberate change by the user, remembered per level and saved immediately.
function setGroundY(value) {
  const level = clampGroundY(value);
  if (level === null) return;
  sessionGroundOverrides[String(selectedLevel)] = level;
  saveTuning();
  applyGroundY(level);
  renderProgress();
}

function resetGroundY() {
  delete sessionGroundOverrides[String(selectedLevel)];
  saveTuning();
  applyGroundY(renderer.groundY);
  renderProgress();
}

function goToNextUntunedLevel() {
  const level = nextUntunedLevel(LEVEL_NUMBERS, selectedLevel, sessionGroundOverrides, committedGroundOverrides);
  if (level === null) return;
  selectLevel(level);
}

function clearTuning() {
  for (const key of Object.keys(sessionGroundOverrides)) delete sessionGroundOverrides[key];
  saveTuning();
  applyGroundY(sessionGroundOverrides[String(selectedLevel)] ?? renderer.groundY);
  renderProgress();
}

levelSelect.addEventListener('change', () => selectLevel(parseInt(levelSelect.value, 10)));
document.querySelectorAll('[data-level-nav]').forEach((btn) => {
  btn.addEventListener('click', () => selectLevel(selectedLevel + parseInt(btn.dataset.levelNav, 10)));
});

document.querySelectorAll('[data-ground-step]').forEach((btn) => {
  btn.addEventListener('click', () => setGroundY(groundY + parseInt(btn.dataset.groundStep, 10)));
});
document.querySelector('[data-ground-reset]').addEventListener('click', resetGroundY);
document.querySelector('[data-ground-next]').addEventListener('click', goToNextUntunedLevel);
document.querySelector('[data-ground-clear]').addEventListener('click', () => {
  if (window.confirm('Discard the ground lines tuned in this browser? The manifest values stay.')) clearTuning();
});

const heroValueEl = document.getElementById('hero-value');
const fiendValueEl = document.getElementById('fiend-value');
const groundValueEl = document.getElementById('ground-value');
const progressEl = document.getElementById('ground-progress');

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
  if (e.key === 'n' || e.key === 'N') { goToNextUntunedLevel(); e.preventDefault(); }
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
  // Everything that ends up in the manifest: levels tuned here win over the ones
  // already committed, so pasting the block never drops an earlier override.
  const groundBlock = groundSnippet(effectiveGroundOverrides({
    levels: LEVEL_NUMBERS,
    tuned: sessionGroundOverrides,
    committed: committedGroundOverrides,
    defaultY: GROUND_Y,
  }));
  const code = `// --- entities.js: replace the hero ground offset with ---\n`
    + `let _heroGroundOffsetPx = ${heroOffsetPx};\n\n`
    + `// --- difficulty-classes.js: replace the BOTTOM_PAD_RATIO array with ---\n`
    + `const BOTTOM_PAD_RATIO = [\n${body}\n];\n\n`
    + `// --- levels/manifest.json: replace the \"groundY\" object with ---\n`
    + `${groundBlock}\n`;
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
loadTuning();
// Resume where the previous session stopped, if that level still exists.
let resumeLevel = selectedLevel;
try {
  const stored = Number.parseInt(window.localStorage?.getItem(LAST_LEVEL_KEY) ?? '', 10);
  if (LEVEL_NUMBERS.includes(stored)) resumeLevel = stored;
} catch {
  // ignore
}
selectLevel(resumeLevel);
renderProgress();
requestAnimationFrame(loop);
