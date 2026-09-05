// level-fiend-allocator.js — standalone tool for manually assigning which
// fiend class (1-36 art tier) appears at each of the 60 levels. Reuses the
// real Renderer/Hero/Fiend and difficulty-classes/levels modules directly,
// so the live preview is pixel-identical to what the shipped game renders.
// Not part of the shipped game — a dev tool only, reachable at
// level-fiend-allocator.html.
//
// Uses a custom dropdown (not a native <select>) so hovering an option can
// preview it live in the canvas before it's committed — native <select>
// popups don't reliably fire any event while browsing unclicked options.

import { Renderer, CANVAS_W, GROUND_Y } from './renderer.js';
import { Hero, Slimeling } from './entities.js';
import { FIEND_CLASSES, getFiendClass, LEVEL_FIEND_CLASS_ID } from './difficulty-classes.js';
import { LevelConfig } from './levels.js';

const FIEND_CAL_X = 560; // fixed on-screen position for the preview fiend

// Snapshot of the CURRENT defaults (whatever LEVEL_FIEND_CLASS_ID held at
// module load — the formula-seeded table, unless difficulty-classes.js has
// already been hand-edited), so "Reset" always has something sane to fall
// back to per level.
const DEFAULT_CLASS_ID = { ...LEVEL_FIEND_CLASS_ID };

let selectedLevel = 1;

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const hero = new Hero();
const fiend = new Slimeling(FIEND_CAL_X, GROUND_Y, 1);
fiend.setState('idle'); // static pose — we never call fiend.update()

function currentClassId(level) {
  return LEVEL_FIEND_CLASS_ID[level] ?? DEFAULT_CLASS_ID[level] ?? 1;
}

function setClassId(level, id) {
  const clamped = Math.max(1, Math.min(36, id));
  LEVEL_FIEND_CLASS_ID[level] = clamped;
  if (level === selectedLevel) fiend.fiendClassId = clamped;
}

function selectLevel(level) {
  selectedLevel = Math.max(1, Math.min(60, level));
  fiend.fiendClassId = currentClassId(selectedLevel);
  document.querySelectorAll('[data-level-row]').forEach((row) => {
    row.classList.toggle('active', Number(row.dataset.levelRow) === selectedLevel);
  });
  const row = document.querySelector(`[data-level-row="${selectedLevel}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
  document.getElementById('preview-label').textContent =
    `Level ${selectedLevel} — ${LevelConfig[selectedLevel - 1].chapterName} (type: ${LevelConfig[selectedLevel - 1].fiendType})`;
}

// ─── shared custom dropdown (one instance, reused/repositioned per row) ──────
// Hovering an option previews it live in the canvas WITHOUT committing;
// clicking commits; clicking outside (or Escape) cancels back to whatever was
// actually committed for that row.
const panel = document.createElement('div');
panel.id = 'picker-panel';
panel.style.display = 'none';
document.body.appendChild(panel);
FIEND_CLASSES.forEach((c) => {
  const opt = document.createElement('div');
  opt.className = 'picker-option';
  opt.dataset.classId = String(c.id);
  const img = document.createElement('img');
  img.className = 'picker-thumb';
  img.alt = '';
  img.src = c.spritePath;
  const span = document.createElement('span');
  span.textContent = `${c.id} — ${c.name}`;
  opt.appendChild(img);
  opt.appendChild(span);
  panel.appendChild(opt);
});

let openLevel = null;   // which level's trigger opened the panel
let openTrigger = null; // that row's trigger button element

function closePanel() {
  if (openLevel !== null) fiend.fiendClassId = currentClassId(selectedLevel); // drop any hover preview
  panel.style.display = 'none';
  openLevel = null;
  openTrigger = null;
}

function openPanelFor(level, triggerEl) {
  openLevel = level;
  openTrigger = triggerEl;
  const current = currentClassId(level);
  panel.querySelectorAll('.picker-option').forEach((opt) => {
    opt.classList.toggle('selected', Number(opt.dataset.classId) === current);
  });
  const r = triggerEl.getBoundingClientRect();
  panel.style.left = `${window.scrollX + r.left}px`;
  panel.style.top = `${window.scrollY + r.bottom + 4}px`;
  panel.style.minWidth = `${r.width}px`;
  panel.style.display = 'block';
  // keep the panel on-screen vertically (flip above the trigger if it would overflow)
  const panelRect = panel.getBoundingClientRect();
  if (panelRect.bottom > window.innerHeight) {
    panel.style.top = `${window.scrollY + r.top - panelRect.height - 4}px`;
  }
  const selectedOpt = panel.querySelector('.picker-option.selected');
  if (selectedOpt) selectedOpt.scrollIntoView({ block: 'center' });
}

panel.addEventListener('mouseover', (e) => {
  const opt = e.target.closest('.picker-option');
  if (opt) fiend.fiendClassId = Number(opt.dataset.classId); // live preview, not yet committed
});

panel.addEventListener('click', (e) => {
  const opt = e.target.closest('.picker-option');
  if (!opt || openLevel === null) return;
  const id = Number(opt.dataset.classId);
  setClassId(openLevel, id);
  const trigger = openTrigger;
  updateTriggerLabel(trigger, id);
  selectLevel(openLevel); // clicking a row's dropdown also focuses that row as the main preview
  panel.style.display = 'none';
  openLevel = null;
  openTrigger = null;
});

document.addEventListener('click', (e) => {
  if (panel.style.display === 'none') return;
  if (e.target.closest('#picker-panel') || e.target.closest('.picker-trigger')) return;
  closePanel();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && panel.style.display !== 'none') closePanel();
});

function updateTriggerLabel(trigger, id) {
  const cls = getFiendClass(id);
  trigger.querySelector('.thumb').src = cls.spritePath;
  trigger.querySelector('.trigger-text').textContent = `${cls.id} — ${cls.name}`;
}

// --- build the 60-row list, grouped by chapter ---
const listEl = document.getElementById('level-list');
let lastChapter = null;
for (let level = 1; level <= 60; level++) {
  const cfg = LevelConfig[level - 1];
  if (cfg.chapter !== lastChapter) {
    lastChapter = cfg.chapter;
    const header = document.createElement('div');
    header.className = 'chapter-header';
    header.textContent = `Chapter ${cfg.chapter} — ${cfg.chapterName}`;
    listEl.appendChild(header);
  }

  const row = document.createElement('div');
  row.className = 'level-row';
  row.dataset.levelRow = String(level);

  const label = document.createElement('span');
  label.className = 'level-label';
  label.textContent = `Lv ${level}`;
  row.appendChild(label);

  const typeLabel = document.createElement('span');
  typeLabel.className = 'type-label';
  typeLabel.textContent = cfg.fiendType;
  row.appendChild(typeLabel);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'picker-trigger';
  const triggerThumb = document.createElement('img');
  triggerThumb.className = 'thumb';
  triggerThumb.alt = '';
  const triggerText = document.createElement('span');
  triggerText.className = 'trigger-text';
  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▾';
  trigger.appendChild(triggerThumb);
  trigger.appendChild(triggerText);
  trigger.appendChild(caret);
  updateTriggerLabel(trigger, currentClassId(level));
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openLevel === level) { closePanel(); return; }
    openPanelFor(level, trigger);
  });
  row.appendChild(trigger);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = '↺';
  resetBtn.title = 'Reset this level to its formula default';
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const def = DEFAULT_CLASS_ID[level] ?? 1;
    setClassId(level, def);
    updateTriggerLabel(trigger, def);
  });
  row.appendChild(resetBtn);

  row.addEventListener('click', (e) => {
    if (e.target === trigger || e.target === resetBtn || trigger.contains(e.target)) return;
    selectLevel(level);
  });

  listEl.appendChild(row);
}

document.getElementById('reset-all-btn').addEventListener('click', () => {
  for (let level = 1; level <= 60; level++) {
    const def = DEFAULT_CLASS_ID[level] ?? 1;
    setClassId(level, def);
    const row = document.querySelector(`[data-level-row="${level}"]`);
    if (row) updateTriggerLabel(row.querySelector('.picker-trigger'), def);
  }
});

document.getElementById('prev-level-btn').addEventListener('click', () => selectLevel(selectedLevel - 1));
document.getElementById('next-level-btn').addEventListener('click', () => selectLevel(selectedLevel + 1));

document.getElementById('copy-btn').addEventListener('click', () => {
  const lines = [];
  for (let level = 1; level <= 60; level++) {
    lines.push(`  ${level}: ${currentClassId(level)},`);
  }
  const code = `// --- difficulty-classes.js: replace the LEVEL_FIEND_CLASS_ID seeding block with ---\n`
    + `export const LEVEL_FIEND_CLASS_ID = {\n${lines.join('\n')}\n};\n`;
  const out = document.getElementById('output');
  out.value = code;
  navigator.clipboard?.writeText(code).catch(() => {});
});

function loop() {
  renderer.clear();
  renderer.drawBackground(0);
  renderer.drawEntity(hero);
  fiend.x = FIEND_CAL_X;
  fiend.y = GROUND_Y;
  renderer.drawEntity(fiend);
  requestAnimationFrame(loop);
}

selectLevel(1);
requestAnimationFrame(loop);
