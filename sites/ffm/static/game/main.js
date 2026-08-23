// main.js — Complete game loop for Math Fiend Slayer

import { LevelConfig, generateProblem } from './levels.js';
import { Renderer, CANVAS_W, CANVAS_H, GROUND_Y, LOGICAL_PX } from './renderer.js';
import { Hero, Slimeling, Bonehead, Toadlord, Magelitch } from './entities.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { InputManager } from './input.js';
import { api } from './api.js';

// --- Fiend factory ---
function createFiend(levelIndex, x) {
  const cfg = LevelConfig[levelIndex];
  const Classes = { slimeling: Slimeling, bonehead: Bonehead, toadlord: Toadlord, magelitch: Magelitch };
  const FiendClass = Classes[cfg.fiendType] || Slimeling;
  return new FiendClass(x, GROUND_Y, cfg.fiendHP);
}

// --- GameState ---
let state = {
  level: 1,
  difficulty: 'medium',
  hearts: 5,
  maxHearts: 5,
  score: 0,
  combo: 0,
  scrollX: 0,
  waveNumber: 1,
  enemiesDefeated: 0,
  timerMax: 20,
  timerRemaining: 20,
  timerActive: false,
};

// --- DOM refs ---
const canvas = document.getElementById('game');
const diffSelect = document.getElementById('difficulty-select');
const authModal = document.getElementById('auth-modal');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userDisplay = document.getElementById('username-display');
const muteBtn = document.getElementById('mute-btn');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const closeAuth = document.getElementById('close-auth');

// --- Engine instances ---
const renderer = new Renderer(canvas);
const hud = new HUD(renderer);
const audio = new AudioEngine();

// --- Entity state ---
let hero = new Hero();
let fiends = [];
let spawnQueue = [];
let requeuedFiends = [];
let activeFiend = null;
let spawnInterval = 4.0;
let spawnTimer = 0;
let answerTimes = [];
let questionStartTime = 0;
let inputDisabled = false;
let gameRunning = false;

// --- Input ---
const input = new InputManager(handleAnswer);

// --- Difficulty select ---
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.difficulty = btn.dataset.difficulty;
    state.timerMax = parseInt(btn.dataset.timer);
    state.timerRemaining = state.timerMax;
    state.maxHearts = parseInt(btn.dataset.hearts);
    state.hearts = state.maxHearts;
    diffSelect.style.display = 'none';
    startLevel(0);
  });
});

// --- Auth ---
loginBtn.addEventListener('click', () => {
  authModal.style.display = 'flex';
});
closeAuth.addEventListener('click', () => {
  authModal.style.display = 'none';
});
logoutBtn.addEventListener('click', async () => {
  await api.logout();
  loginBtn.style.display = '';
  logoutBtn.style.display = 'none';
  userDisplay.style.display = 'none';
});
tabLogin.addEventListener('click', () => {
  loginForm.style.display = '';
  registerForm.style.display = 'none';
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
});
tabRegister.addEventListener('click', () => {
  registerForm.style.display = '';
  loginForm.style.display = 'none';
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
});
loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const u = document.getElementById('login-username').value;
    const p = document.getElementById('login-password').value;
    await api.login(u, p);
    authModal.style.display = 'none';
    loginBtn.style.display = 'none';
    userDisplay.textContent = api.username || 'Player';
    userDisplay.style.display = '';
    logoutBtn.style.display = '';
    loginError.textContent = '';
  } catch (err) {
    loginError.textContent = err.message;
  }
});
registerForm.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const u = document.getElementById('reg-username').value;
    const em = document.getElementById('reg-email').value;
    const pw = document.getElementById('reg-password').value;
    await api.register(u, em, pw);
    authModal.style.display = 'none';
    loginBtn.style.display = 'none';
    userDisplay.textContent = api.username || 'Player';
    userDisplay.style.display = '';
    logoutBtn.style.display = '';
    registerError.textContent = '';
  } catch (err) {
    registerError.textContent = err.message;
  }
});
muteBtn.addEventListener('click', () => {
  audio.toggleMute();
  muteBtn.textContent = audio.muted ? '🔇' : '🔊';
});

// --- Level/Wave setup ---
function startLevel(levelIndex) {
  const cfg = LevelConfig[levelIndex];
  state.level = cfg.level;
  state.waveNumber = 1;
  state.enemiesDefeated = 0;
  spawnQueue = [];
  requeuedFiends = [];
  fiends = [];
  activeFiend = null;
  inputDisabled = false;
  
  const waveSize = cfg.waveSize;
  for (let i = 0; i < waveSize; i++) {
    spawnQueue.push(levelIndex);
  }
  spawnTimer = 2.0;
  gameRunning = true;
  audio.startBGM(cfg.chapter);
  if (!animFrameId) gameLoop(performance.now());
}

// Only one fiend on screen at a time; gap kept for requeue safety
const FIEND_MIN_GAP = 145;

function spawnNextFiend() {
  // Wait until the previous fiend is completely gone
  if (fiends.length > 0) return;

  let fiend;
  if (requeuedFiends.length > 0) {
    fiend = requeuedFiends.shift();
    fiend.x = CANVAS_W + 20;
    fiend.wasRequeued = true;
    fiend.setState('walk');
  } else if (spawnQueue.length > 0) {
    const levelIndex = spawnQueue.shift();
    fiend = createFiend(levelIndex, CANVAS_W + 20);
    fiend.problem = generateProblem(levelIndex, Date.now());
  }
  if (fiend) {
    fiend.on('retreated', () => { onFiendRetreated(fiend); });
    fiend.on('dead', () => { onFiendDead(fiend); });
    fiends.push(fiend);
  }
}

function onFiendRetreated(fiend) {
  fiends = fiends.filter(f => f !== fiend);
  activeFiend = null;
  inputDisabled = false;
  input.disable();
}

function onFiendDead(fiend) {
  fiends = fiends.filter(f => f !== fiend);
}

function checkAllDefeated() {
  return spawnQueue.length === 0 &&
         requeuedFiends.length === 0 &&
         fiends.every(f => f.isDead || f.state === 'retreat');
}

function handleAnswer(value) {
  if (!activeFiend || activeFiend.isDead) return;
  // ignore input while fiend is retreating, revealing, or exploding
  if (['retreat', 'reveal', 'death'].includes(activeFiend.state)) return;
  const correct = parseInt(value) === activeFiend.problem.answer;
  if (correct) {
    handleCorrectAnswer();
  } else {
    handleWrongAnswer();
  }
}

function handleCorrectAnswer() {
  const elapsed = (Date.now() - questionStartTime) / 1000;
  
  if (!activeFiend.wasRequeued) {
    answerTimes.push(elapsed);
    if (answerTimes.length > 5) answerTimes.shift();
    updatePaceAdapter();
  }
  
  const ratio = Math.max(0, state.timerRemaining / state.timerMax);
  const speedBonus = activeFiend.wasRequeued ? 0 : Math.round(ratio * 50);
  const comboBonus = activeFiend.wasRequeued ? 0 : state.combo * 10;
  const points = 100 + speedBonus + comboBonus;
  
  state.score += points;
  state.combo++;
  state.timerActive = false;
  
  hero.setState('swing');
  activeFiend.hit();
  audio.playSwordSwing();
  
  if (activeFiend.isDead) {
    audio.playEnemyDeath();
    state.enemiesDefeated++;
    activeFiend = null;
    input.disable();
    inputDisabled = true;
    
    setTimeout(() => {
      if (checkAllDefeated()) {
        triggerWaveClear();
      } else {
        spawnTimer = spawnInterval;
        inputDisabled = false;
      }
    }, 600);
  } else {
    activeFiend.problem = generateProblem(state.level - 1, Date.now());
    state.timerRemaining = state.timerMax;
    state.timerActive = true;
    showProblem(activeFiend);
  }
  hud.update(state);
}

function handleWrongAnswer() {
  state.combo = 0;
  hero.setState('hurt');
  activeFiend._redFlash = 0.5;  // red flash = wrong answer
  activeFiend.setState('attack');
  audio.playWrong();
  audio.playHeroHurt();
  state.timerActive = false;
  state.hearts--;
  hud.update(state);
  input.disable();
  inputDisabled = true;
  
  if (state.hearts <= 0) {
    triggerGameOver();
    return;
  }
  
  setTimeout(() => {
    if (activeFiend) {
      const p = activeFiend.problem;
      activeFiend._revealText = p.question.replace(' = ?', ' = ' + p.answer);
      activeFiend.setState('reveal');
      
      setTimeout(() => {
        if (activeFiend) {
          requeuedFiends.push(activeFiend);
          activeFiend.setState('retreat');
        }
      }, 2000);
    }
  }, 600);
}

function showProblem(fiend) {
  const cfg = LevelConfig[state.level - 1];
  const mode = cfg.inputMode;
  if (mode === 'multiple-choice') {
    const options = [fiend.problem.answer, ...(fiend.problem.distractors || [])].sort(() => Math.random() - 0.5);
    input.setMCOptions(options);
  }
  input.enable(mode);
  questionStartTime = Date.now();
  state.timerRemaining = state.timerMax;
  state.timerActive = true;
}

function updatePaceAdapter() {
  if (answerTimes.length < 3) return;
  const avg = answerTimes.reduce((a, b) => a + b, 0) / answerTimes.length;
  if (avg < state.timerMax * 0.4) {
    spawnInterval = Math.max(1.5, spawnInterval * 0.9);
  } else if (avg > state.timerMax * 0.8) {
    spawnInterval = Math.min(6.0, spawnInterval * 1.1);
  }
}

function triggerWaveClear() {
  gameRunning = false;
  hero.setState('victory');
  audio.playLevelClear();
  
  setTimeout(() => {
    triggerLevelClear();
  }, 2000);
}

function triggerLevelClear() {
  spawnQueue = [];
  requeuedFiends = [];
  
  if (api.isLoggedIn) {
    api.postScore(state.level, state.score, state.difficulty).catch(() => {});
  }
  
  if (state.level >= 40) {
    triggerGameOver();
    return;
  }
  
  setTimeout(() => {
    startLevel(state.level);
  }, 3000);
}

function triggerGameOver() {
  gameRunning = false;
  audio.stopBGM();
  audio.playGameOver();
  renderer.drawBanner('GAME OVER  SCORE: ' + state.score);
}

// --- Timer ---
function updateTimer(dt) {
  if (!state.timerActive) return;
  state.timerRemaining -= dt;
  if (state.timerRemaining <= 0) {
    state.timerRemaining = 0;
    state.timerActive = false;
    handleWrongAnswer();
  }
}

// --- Main game loop ---
let animFrameId = null;
let lastTs = 0;

function gameLoop(ts) {
  animFrameId = requestAnimationFrame(gameLoop);
  
  const rawDt = (ts - lastTs) / 1000;
  lastTs = ts;
  const dt = Math.min(rawDt, 0.1);
  
  if (gameRunning) {
    updateTimer(dt);
    
    if (!activeFiend && !inputDisabled) {
      spawnTimer -= dt;
      if (spawnTimer <= 0 && (spawnQueue.length > 0 || requeuedFiends.length > 0)) {
        spawnNextFiend();
        spawnTimer = spawnInterval;
      }
    }
    
    hero.update(dt);
    fiends.forEach(f => f.update(dt));
    
    if (!activeFiend && !inputDisabled) {
      // enable input as soon as the problem bubble enters the screen
      const visible = fiends.find(f => !f.isDead && f.problem && f.x < CANVAS_W - 40);
      if (visible) {
        activeFiend = visible;
        hero.setState('swing');
        showProblem(activeFiend);
      }
    }
    
    if (hero.state === 'walk') state.scrollX += 100 * dt;
  }
  
  renderer.clear();
  renderer.drawBackground(state.scrollX);

  // Draw fiends right-to-left (farther right = behind, so draw first)
  const sorted = [...fiends].sort((a, b) => b.x - a.x)
  sorted.forEach(f => {
    renderer.drawEntity(f)
    // Show problem bubble as soon as fiend is mostly on-screen
    if (f.problem && f.x < CANVAS_W - 20 && !f.isDead && f.state !== 'death') {
      const bubbleText = f.state === 'reveal'
        ? (f._revealText || f.problem.question)
        : f.problem.question
      const isActive = (f === activeFiend)
      renderer.drawSpeechBubble(f.x, f.y - 20 * LOGICAL_PX, bubbleText, isActive)
    }
    if (f === activeFiend && state.timerActive) {
      const ratio = state.timerRemaining / state.timerMax
      renderer.drawTimerBar(f.x - 44, f.y - 22 * LOGICAL_PX, 88, ratio)
    }
  });
  renderer.drawEntity(hero);
  hud.draw();
}
