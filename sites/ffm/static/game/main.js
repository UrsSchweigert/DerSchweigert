// main.js — Complete game loop for Arithmo Slayer

import { LevelConfig, generateProblem } from './levels.js';
import { Renderer, CANVAS_W, CANVAS_H, GROUND_Y, LOGICAL_PX, HERO_X } from './renderer.js';
import { Hero, Slimeling, Bonehead, Toadlord, Magelitch, BirdFoe, WolfFoe, SnakeFoe, LightningBolt } from './entities.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { InputManager } from './input.js';
import { api } from './api.js';

// ─── Tunable game-event constants (edit here to adjust game feel) ─────────────
const GAME_CONFIG = {
  eliteFiendChance:      0.10,  // probability a spawned fiend is elite
  eliteFiendHp:          3,     // HP of an elite fiend
  elitePointMultiplier:  3,     // score multiplier per answer on an elite fiend
  lightningEveryN:       10,    // check for lightning on every Nth kill
  lightningChance:       0.30,  // probability lightning fires on that Nth kill
  healingAuraDuration:   2.0,   // seconds green aura lasts after level clear
};

// Operator → Fiend class (fallback when level fiendType is unknown)
const OPERATOR_FIEND = {
  '+': Slimeling,
  '-': BirdFoe,
  '*': WolfFoe,
  '/': SnakeFoe,
};

// Level config fiendType → Fiend class
const FIEND_TYPE_CLASS = {
  slimeling: Slimeling,
  bonehead: Bonehead,
  toadlord: Toadlord,
  magelitch: Magelitch,
  birdfoe: BirdFoe,
  wolffoe: WolfFoe,
  snakefoe: SnakeFoe,
};

// Colour tiers (0-3) keyed by fiend type, applied by level band (every 15 levels)
const FIEND_PALETTES = {
  slimeling: [
    { body:'#f07030', dark:'#a04010', hi:'#ffb060' },
    { body:'#9040d0', dark:'#601090', hi:'#c878f8' },
    { body:'#20b840', dark:'#106828', hi:'#50e870' },
    { body:'#d02020', dark:'#801010', hi:'#ff5050' },
  ],
  bonehead: [
    { body:'#b8c0c8', dark:'#606870', hi:'#d8e4ec' },
    { body:'#c8b870', dark:'#807840', hi:'#f0e090' },
    { body:'#789060', dark:'#405040', hi:'#a8c090' },
    { body:'#504868', dark:'#201830', hi:'#8078a0' },
  ],
  toadlord: [
    { body:'#e02828', dark:'#901010', hi:'#ff6060' },
    { body:'#38a028', dark:'#186010', hi:'#68d048' },
    { body:'#8028a8', dark:'#501068', hi:'#b058d8' },
    { body:'#c03010', dark:'#781808', hi:'#f06040' },
  ],
  magelitch: [
    { body:'#1890a8', dark:'#0c5870', hi:'#30c0d8' },
    { body:'#7828b0', dark:'#481878', hi:'#a050d8' },
    { body:'#b08018', dark:'#705010', hi:'#e0b030' },
    { body:'#1818a0', dark:'#101060', hi:'#3838d0' },
  ],
  birdfoe: [
    { body:'#5048a8', dark:'#28205a', hi:'#8878d0' },
    { body:'#a04040', dark:'#601818', hi:'#d07070' },
    { body:'#308848', dark:'#185028', hi:'#58b870' },
    { body:'#b89018', dark:'#786010', hi:'#e8c040' },
  ],
  wolffoe: [
    { body:'#808090', dark:'#404050', hi:'#b0b0c0' },
    { body:'#804020', dark:'#401808', hi:'#c07040' },
    { body:'#204070', dark:'#102040', hi:'#4070a0' },
    { body:'#601020', dark:'#300810', hi:'#a03040' },
  ],
  snakefoe: [
    { body:'#40a840', dark:'#205428', hi:'#70d870' },
    { body:'#a8a020', dark:'#686010', hi:'#d8d040' },
    { body:'#284898', dark:'#101860', hi:'#5878c8' },
    { body:'#881830', dark:'#480c18', hi:'#b84050' },
  ],
};

// --- Fiend factory ---
function createFiend(levelIndex, x) {
  const cfg = LevelConfig[levelIndex];
  const problem = generateProblem(levelIndex, Date.now());
  const fiendTypeKey = String(cfg.fiendType || '').toLowerCase();
  const FiendClass = FIEND_TYPE_CLASS[fiendTypeKey] ?? OPERATOR_FIEND[problem.operation] ?? Slimeling;
  const isElite = Math.random() < GAME_CONFIG.eliteFiendChance;
  const hp = isElite ? GAME_CONFIG.eliteFiendHp : cfg.fiendHP;
  const tier = Math.min(3, Math.floor(levelIndex / 15));
  const palettes = FIEND_PALETTES[fiendTypeKey];
  const palette = palettes ? palettes[tier] : undefined;
  const fiend = new FiendClass(x, GROUND_Y, hp, palette);
  fiend.problem = problem;
  fiend.isElite = isElite;
  return fiend;
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
const levelClearOverlay = document.getElementById('level-clear');
const levelClearTitle = document.getElementById('level-clear-title');
const levelClearScore = document.getElementById('level-clear-score');
const btnNextLevel = document.getElementById('btn-next-level');
const btnReplayLevel = document.getElementById('btn-replay-level');
const diffSelect = document.getElementById('difficulty-select');
const authModal = document.getElementById('auth-modal');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userDisplay = document.getElementById('username-display');
const muteBtn = document.getElementById('mute-btn');
const topBar  = document.getElementById('top-bar');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const closeAuth = document.getElementById('close-auth');
const splashLoginBtn = document.getElementById('splash-login-btn');
const splashGreeting = document.getElementById('splash-user-greeting');

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
let activeLightningBolts = [];
let heroLunge = null; // { phase:'out'|'back', fiend?, targetX, onArrive? }
const LUNGE_SPEED = 420;  // px/s for both the dash-in and return
const LUNGE_MIN_DIST = 140; // skip lunge when fiend is already within this distance of HERO_X

// --- Input ---
const input = new InputManager(handleAnswer);

// --- Splash login button ---
function updateSplashAuthState() {
  if (api.username) {
    splashLoginBtn.textContent = 'Logout';
    splashGreeting.textContent = `Welcome, ${api.username}!`;
  } else {
    splashLoginBtn.textContent = 'Login / Register';
    splashGreeting.textContent = '';
  }
}

splashLoginBtn.addEventListener('click', () => {
  if (api.username) {
    api.logout().then(() => {
      loginBtn.style.display = '';
      logoutBtn.style.display = 'none';
      userDisplay.style.display = 'none';
      updateSplashAuthState();
    });
  } else {
    authModal.style.display = 'flex';
  }
});

// --- Difficulty select ---
document.querySelectorAll('#difficulty-select .diff-btn').forEach(btn => {
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
  updateSplashAuthState();
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
    updateSplashAuthState();
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
    updateSplashAuthState();
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
  state.combo = 0;
  gameRunning = true;
  topBar.style.display = 'none';
  hud.update(state);
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
    fiend = createFiend(levelIndex, CANVAS_W + 20);  // problem already assigned inside
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
  // ignore if value contains no digits (prevents empty or accidental submissions)
  if (!/\d/.test(value)) return;
  const correct = parseInt(value, 10) === activeFiend.problem.answer;
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

  const safeMax = state.timerMax > 0 ? state.timerMax : 1;
  const ratio = Math.max(0, Math.min(1, state.timerRemaining / safeMax));
  const speedBonus  = activeFiend.wasRequeued ? 0 : Math.round(ratio * 50);
  const comboBonus  = activeFiend.wasRequeued ? 0 : state.combo * 10;
  const multiplier  = activeFiend.isElite ? GAME_CONFIG.elitePointMultiplier : 1;
  const points      = (100 + speedBonus + comboBonus) * multiplier;

  state.score += points;
  state.combo++;
  state.timerActive = false;

  const fiend = activeFiend;

  const strikeNow = () => {
    const willKill     = fiend.hp <= 1;
    const nextDefeated = state.enemiesDefeated + 1;
    const useLightning = willKill &&
      nextDefeated % GAME_CONFIG.lightningEveryN === 0 &&
      Math.random() < GAME_CONFIG.lightningChance;

    if (useLightning) {
      // Hero raises sword skyward (hold at victory frame 1)
      hero.setState('victory');
      hero._frame = 1; hero._tick = 0; hero._dur = 999;
      activeLightningBolts.push(new LightningBolt(fiend.x, fiend.y - 6 * LOGICAL_PX));
      setTimeout(() => {
        fiend.hp = 0;
        fiend.setState('death');
        audio.playEnemyDeath();
        state.enemiesDefeated++;
        activeFiend = null;
        input.disable();
        inputDisabled = true;
        heroLunge = { phase: 'back', targetX: HERO_X, onArrive: () => {
          hero.setState('idle');
          setTimeout(() => {
            if (checkAllDefeated()) triggerWaveClear();
            else { spawnTimer = spawnInterval; inputDisabled = false; }
          }, 300);
        }};
        hud.update(state);
      }, 600);
    } else {
      hero.setState('swing');
      fiend.hit();
      audio.playSwordSwing();

      if (fiend.isDead) {
        audio.playEnemyDeath();
        state.enemiesDefeated++;
        activeFiend = null;
        input.disable();
        inputDisabled = true;
        heroLunge = { phase: 'back', targetX: HERO_X, onArrive: () => {
          setTimeout(() => {
            if (checkAllDefeated()) triggerWaveClear();
            else { spawnTimer = spawnInterval; inputDisabled = false; }
          }, 300);
        }};
      } else {
        activeFiend.problem = generateProblem(state.level - 1, Date.now());
        inputDisabled = false;
        heroLunge = { phase: 'back', targetX: HERO_X };
        showProblem(activeFiend);
      }
    }
    hud.update(state);
  };

  if (fiend.x - HERO_X > LUNGE_MIN_DIST) {
    input.disable();
    inputDisabled = true;
    heroLunge = { phase: 'out', fiend, onArrive: strikeNow };
  } else {
    strikeNow();
  }
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

  // Restore all hearts and show green healing aura
  state.hearts = state.maxHearts;
  hero._healAura = GAME_CONFIG.healingAuraDuration;
  hud.update(state);

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

  if (state.level >= LevelConfig.length) {
    triggerGameOver();
    return;
  }

  const completedLevelNum = state.level;          // 1-based display number
  const completedIndex = completedLevelNum - 1;   // 0-based LevelConfig index
  levelClearTitle.textContent = `Level ${completedLevelNum} Clear!`;
  levelClearScore.textContent = `Score: ${state.score}`;
  topBar.style.display = 'flex';
  btnNextLevel.onclick = () => {
    levelClearOverlay.style.display = 'none';
    startLevel(completedIndex + 1);
  };
  btnReplayLevel.onclick = () => {
    levelClearOverlay.style.display = 'none';
    startLevel(completedIndex);
  };
  levelClearOverlay.style.display = 'flex';
}

function triggerGameOver() {
  gameRunning = false;
  topBar.style.display = 'flex';
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
    activeLightningBolts = activeLightningBolts.filter(b => { b.update(dt); return !b.isDone; });

    if (heroLunge) {
      if (heroLunge.phase === 'out') {
        // chase the fiend's current position so they meet naturally
        const targetX = heroLunge.fiend.x - 65;
        if (hero.x >= targetX - 4) {
          hero.x = targetX;
          const cb = heroLunge.onArrive;
          heroLunge = null; // clear before cb so cb can install 'back' phase
          cb();
        } else {
          hero.x += LUNGE_SPEED * dt;
        }
      } else {
        // 'back' — return to home position
        if (hero.x <= HERO_X + 4) {
          hero.x = HERO_X;
          const cb = heroLunge.onArrive;
          heroLunge = null;
          if (cb) cb();
        } else {
          hero.x -= LUNGE_SPEED * dt;
        }
      }
    }

    if (!activeFiend && !inputDisabled) {
      // enable input as soon as the problem bubble enters the screen
      const visible = fiends.find(f => !f.isDead && f.problem && f.x < CANVAS_W - 40);
      if (visible) {
        activeFiend = visible;
        showProblem(activeFiend);
      }
    }
    
    if (hero.state === 'walk' && !heroLunge) state.scrollX += 100 * dt;
    hero.lunging = heroLunge !== null && hero.state !== 'swing';
  }
  
  renderer.clear();
  renderer.drawBackground(0);

  // Pass 1: all entity sprites (right-to-left so farther back draws first)
  const sorted = [...fiends].sort((a, b) => b.x - a.x);
  sorted.forEach(f => renderer.drawEntity(f));
  renderer.drawEntity(hero);

  // Pass 2: speech bubbles and timer bars always on top of every sprite
  sorted.forEach(f => {
    if (f.problem && f.x < CANVAS_W - 20 && !f.isDead && f.state !== 'death') {
      const bubbleText = f.state === 'reveal'
        ? (f._revealText || f.problem.question)
        : f.problem.question;
      renderer.drawSpeechBubble(f.x, f.y - 20 * LOGICAL_PX, bubbleText, f === activeFiend);
    }
    if (f === activeFiend && state.timerActive) {
      const ratio = state.timerRemaining / state.timerMax;
      renderer.drawTimerBar(f.x - 44, f.y - 22 * LOGICAL_PX, 88, ratio);
    }
  });

  // Pass 3: lightning bolts (over gameplay, under HUD)
  activeLightningBolts.forEach(b => b.draw(renderer.ctx));

  hud.draw();
}
