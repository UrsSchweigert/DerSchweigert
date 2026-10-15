// main.js — Complete game loop for Arithmo Slayer

import { generateProblem, sampleFiendType, TOTAL_LEVELS } from './levels.js';
import { Renderer, CANVAS_W, CANVAS_H, GROUND_Y, LOGICAL_PX, HERO_X } from './renderer.js';
import { Hero, Slimeling, Bonehead, Toadlord, Magelitch, BirdFoe, WolfFoe, SnakeFoe, LightningBolt, Fireball, DragonSummon } from './entities.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { InputManager } from './input.js';
import { api } from './api.js';
import { getFiendClass, sampleFiendClassId, FIEND_CLASSES } from './difficulty-classes.js';
import { pickComboAbility, getComboFrameBand } from './combo-abilities.js';
import {
  FIEND_ENTRY_TRIGGER_X,
  getFiendWalkSpeed,
  getProblemTimerRemaining,
  shouldPreserveTimerAfterHit,
} from './difficulty.js';
import { CookieConsent } from './cookie-consent.js';
import { preloadGameAssets } from './asset-preload.js';
import { updateHealHold, getHealHoldRatio, isInHealZone } from './heal-hold.js';
import { generateShapesProblem } from './shapes.js';
import { getAuthorizedLevelConfig, setCurrentLevelConfig, getCurrentLevelConfig, incrementRequestGeneration, isStripeRedirect, validatePendingRecord } from './access-flow.js';
import { initI18n, t, toggleLocale, translateServerMessage, onLocaleChange } from './i18n.js';

// Resolves the active locale, translates every data-i18n-* element in the
// page, and sets <html lang> before anything else runs.
initI18n();

// The page's CSP is `script-src 'self' https://challenges.cloudflare.com`
// with no 'unsafe-inline'/nonce, so an inline <script type="module"> in
// index.html would be silently blocked by the browser and never run at
// all (window.ffmCookieConsent would stay undefined, the banner would
// never show, and Turnstile would never load). Wiring it up here instead,
// in a same-origin file loaded via <script src>, is what actually executes.
window.ffmCookieConsent = new CookieConsent();
window.ffmCookieConsent.init();
document.getElementById('cookie-accept')?.addEventListener('click', () => {
  window.ffmCookieConsent.accept();
});
document.getElementById('cookie-decline')?.addEventListener('click', () => {
  window.ffmCookieConsent.decline();
});

// --- Loading screen ---
// Preload every sprite the game can show (hero, dragon/fireball combo
// effects, all stage backgrounds, all 36 fiend class sprites) behind a
// full-screen black loading bar, shown from first paint (see index.html),
// instead of letting each sprite's procedural pixel-art fallback (see
// entities.js) render first and pop over to the real PNG whenever it
// happens to finish downloading — which looked like a flicker of
// placeholder art on a slow connection.
const loadingOverlay = document.getElementById('loading-overlay');
const loadingBarFill = document.getElementById('loading-bar-fill');
const loadingPercentEl = document.getElementById('loading-percent');

function showLoadingOverlay() {
  if (loadingOverlay) loadingOverlay.style.display = 'flex';
}

function hideLoadingOverlay() {
  if (loadingOverlay) loadingOverlay.style.display = 'none';
}

const assetsLoaded = preloadGameAssets((loaded, total) => {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 100;
  if (loadingBarFill) loadingBarFill.style.width = pct + '%';
  if (loadingPercentEl) loadingPercentEl.textContent = pct + '%';
});

// A single stuck/broken asset (or a truly catastrophic connection) must not
// permanently trap the player behind a black screen — fall back to
// revealing the game after a generous timeout even if preload never
// settles, accepting the small risk of a placeholder flicker over an
// unplayable page. Shared by the initial page-load preload below and by
// every startLevel() transition (see startLevel in the Level/Wave setup
// section), which re-shows this same overlay/bar so a level never starts
// rendering until its assets (including that level's own stage background,
// via renderer.waitForBackgroundLoad()) are actually ready.
const LOADING_SAFETY_TIMEOUT_MS = 30000;
Promise.race([
  assetsLoaded,
  new Promise((resolve) => setTimeout(resolve, LOADING_SAFETY_TIMEOUT_MS)),
]).then(hideLoadingOverlay);

// --- Checkout redirect handling ---
// After Stripe checkout completes, user is redirected back with billing=success
async function handleCheckoutRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('billing') === 'success') {
    try {
      // Get updated billing status
      const status = await api.getBillingStatus();
      // Clean URL to remove billing parameter
      window.history.replaceState({}, document.title, window.location.pathname);
      // If user is entitled, resume pending level
      if (status.premium_access) {
        resumePendingLevel();
      } else {
        openBillingPanel();
        billingStatusText.textContent = t('auth.paymentConfirmPending');
      }
    } catch (err) {
      authStatusMessage.textContent = t('auth.paymentConfirmFailed', { message: translateServerMessage(err.message) });
      authStatusModal.style.display = 'flex';
    }
  }
}

// Check for checkout redirect on page load

// ─── Tunable game-event constants (edit here to adjust game feel) ─────────────
const GAME_CONFIG = {
  eliteFiendChance:      0.10,  // probability a spawned fiend is elite
  eliteFiendHp:          3,     // HP of an elite fiend
  elitePointMultiplier:  3,     // score multiplier per answer on an elite fiend
  healingAuraDuration:   2.0,   // seconds green aura lasts after level clear
  healHoldSecondsPerHeart: 9.0, // seconds of continuous hold-to-heal needed to restore one heart
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
  const cfg = getCurrentLevelConfig();
  if (!cfg) throw new Error('Level config not loaded');
  const problem = generateProblem(levelIndex, Date.now(), cfg);
  const spawnIndex = state.fiendsSpawned;
  state.fiendsSpawned++;
  const fiendTypeKey = String(sampleFiendType(cfg.level, spawnIndex) || cfg.fiendType || '').toLowerCase();
  const FiendClass = FIEND_TYPE_CLASS[fiendTypeKey] ?? OPERATOR_FIEND[problem.operation] ?? Slimeling;
  const isElite = Math.random() < GAME_CONFIG.eliteFiendChance;
  const hp = isElite ? GAME_CONFIG.eliteFiendHp : cfg.fiendHP;
  const tier = Math.min(3, Math.floor(levelIndex / 15));
  const palettes = FIEND_PALETTES[fiendTypeKey];
  const palette = palettes ? palettes[tier] : undefined;
  const fiend = new FiendClass(x, GROUND_Y, hp, palette);
  fiend.walkSpeed = getFiendWalkSpeed(state.timerMax);
  fiend.problem = problem;
  fiend.isElite = isElite;
  fiend.fiendClassId = sampleFiendClassId(cfg.level, spawnIndex);
  return fiend;
}

// Shapes-mode fiend factory: a plain 1-HP fiend of a uniformly random
// type (no elite roll, no per-level curriculum lookup) carrying a
// shape-counting "problem" instead of a math question. Deliberately
// independent of LevelConfig/createFiend so this mode never needs a real
// curriculum entry.
const SHAPES_FIEND_TYPE_KEYS = Object.keys(FIEND_TYPE_CLASS);
function createShapesFiend(x) {
  const problem = generateShapesProblem(Date.now());
  state.fiendsSpawned++;
  const fiendTypeKey = SHAPES_FIEND_TYPE_KEYS[Math.floor(Math.random() * SHAPES_FIEND_TYPE_KEYS.length)];
  const FiendClass = FIEND_TYPE_CLASS[fiendTypeKey];
  const palettes = FIEND_PALETTES[fiendTypeKey];
  const palette = palettes ? palettes[0] : undefined;
  const fiend = new FiendClass(x, GROUND_Y, 1, palette);
  fiend.walkSpeed = getFiendWalkSpeed(state.timerMax);
  fiend.problem = problem;
  fiend.isElite = false;
  // sampleFiendClassId(level, spawnIndex) is what actually drives the fiend's
  // *visible* sprite (via Fiend._drawClassSprite/FIEND_CLASSES) — the
  // FiendClass picked above only affects HP/behavior defaults, since a
  // loaded class sprite always takes drawing priority over the per-class
  // procedural fallback. Calling it with a fixed level (e.g. always level 1)
  // would be a bug here: getFiendClassWeights(1) has only one entry (no
  // level-1/-2 history to blend in), so it would deterministically return
  // the exact same sprite id every time regardless of spawnIndex — exactly
  // the "always the same fiend" symptom this mode must avoid. Sample a
  // uniformly random class id across the whole roster instead, for real
  // visual variety on every spawn.
  fiend.fiendClassId = 1 + Math.floor(Math.random() * FIEND_CLASSES.length);
  return fiend;
}

// Returns the current problem's input mode ('multiple-choice' | 'free-text').
// Shapes mode isn't a LevelConfig entry, so it's special-cased here rather
// than relying on state.level happening to alias a real level's inputMode.
function getCurrentInputMode() {
  if (state.isShapesMode) return 'multiple-choice';
  const cfg = getCurrentLevelConfig();
  return cfg?.inputMode;
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
  fiendsSpawned: 0,
  timerMax: 10,
  timerRemaining: 10,
  timerActive: false,
  isShapesMode: false, // "Shapes" mode: infinite, unscored shape-counting practice
};

// --- DOM refs ---
const canvas = document.getElementById('game');
const pauseOverlay = document.getElementById('pause-overlay');
const healTipOverlay = document.getElementById('heal-tip-overlay');
const btnHealTipConfirm = document.getElementById('btn-heal-tip-confirm');
const levelClearOverlay = document.getElementById('level-clear');
const levelClearTitle = document.getElementById('level-clear-title');
const levelClearScore = document.getElementById('level-clear-score');
const btnNextLevel = document.getElementById('btn-next-level');
const btnReplayLevel = document.getElementById('btn-replay-level');
const btnSaveScoreReturnTitle = document.getElementById('btn-save-score-return-title');
const gameOverOverlay = document.getElementById('game-over');
const gameOverScore = document.getElementById('game-over-score');
const btnRetryLevel = document.getElementById('btn-retry-level');
const btnReturnTitle = document.getElementById('btn-return-title');
const diffSelect = document.getElementById('difficulty-select');
const authModal = document.getElementById('auth-modal');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userDisplay = document.getElementById('username-display');
const muteBtn = document.getElementById('mute-btn');
const langToggleBtn = document.getElementById('lang-toggle-btn');
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
const leaderboardList = document.getElementById('leaderboard-list');
const leaderboardYearFilter = document.getElementById('leaderboard-year-filter');
const leaderboardPersonalBest = document.getElementById('leaderboard-personal-best');
const scoreHistoryChart = document.getElementById('score-history-chart');
const leaderboardProfilePrompt = document.getElementById('leaderboard-profile-prompt');
const leaderboardCompleteProfile = document.getElementById('leaderboard-complete-profile');
const levelJumpRow = document.getElementById('level-jump-row');
const levelJumpSelect = document.getElementById('level-jump-select');

const checkoutModal = document.getElementById('checkout-modal');
const closeCheckout = document.getElementById('close-checkout');
const checkoutForm = document.getElementById('checkout-form');
const checkoutAdultConfirm = document.getElementById('checkout-adult-confirm');
const checkoutTermsAccept = document.getElementById('checkout-terms-accept');
const checkoutMessage = document.getElementById('checkout-message');

const accountModal = document.getElementById('account-modal');
const closeAccount = document.getElementById('close-account');
const tabAccountProfile = document.getElementById('tab-account-profile');
const tabAccountPassword = document.getElementById('tab-account-password');
const tabAccountScores = document.getElementById('tab-account-scores');
const tabAccountDanger = document.getElementById('tab-account-danger');
const accountProfilePanel = document.getElementById('account-profile-panel');
const accountPasswordPanel = document.getElementById('account-password-panel');
const accountScoresPanel = document.getElementById('account-scores-panel');
const accountDangerPanel = document.getElementById('account-danger-panel');
const accountBillingPanel = document.getElementById('account-billing-panel');
const tabAccountBilling = document.getElementById('tab-account-billing');
const accountProfileForm = document.getElementById('account-profile-form');
const accountCurrentEmailDisplay = document.getElementById('account-current-email-display');
const accountPendingEmailNote = document.getElementById('account-pending-email-note');
const accountNewEmail = document.getElementById('account-new-email');
const accountFirstGradeYear = document.getElementById('account-first-grade-year');
const accountProfileCurrentPassword = document.getElementById('account-profile-current-password');
const accountProfileMessage = document.getElementById('account-profile-message');
const accountPasswordForm = document.getElementById('account-password-form');
const accountCurrentPassword = document.getElementById('account-current-password');
const accountNewPassword = document.getElementById('account-new-password');
const accountConfirmNewPassword = document.getElementById('account-confirm-new-password');
const accountPasswordMessage = document.getElementById('account-password-message');
const accountPersonalBest = document.getElementById('account-personal-best');
const accountScoreHistoryChart = document.getElementById('account-score-history-chart');
const accountDeleteForm = document.getElementById('account-delete-form');
const accountDeletePassword = document.getElementById('account-delete-password');
const accountDeleteConfirmCheckbox = document.getElementById('account-delete-confirm-checkbox');
const accountDeleteSubmit = document.getElementById('account-delete-submit');
const accountDeleteMessage = document.getElementById('account-delete-message');

const billingStatusDisplay = document.getElementById('billing-status-display');
const billingActions = document.getElementById('billing-actions');
const billingStatusText = document.getElementById('billing-status-text');
const btnStartCheckout = document.getElementById('btn-start-checkout');
const btnOpenPortal = document.getElementById('btn-open-portal');
const billingRedeemSection = document.getElementById('billing-redeem-section');
const billingRedeemCode = document.getElementById('billing-redeem-code');
const btnRedeemCode = document.getElementById('btn-redeem-code');
const billingRedeemMessage = document.getElementById('billing-redeem-message');

const forgotPasswordLink = document.getElementById('forgot-password-link');
const forgotPasswordForm = document.getElementById('forgot-password-form');
const backToLoginLink = document.getElementById('back-to-login-link');
const resetPasswordForm = document.getElementById('reset-password-form');
const loginVerifyResend = document.getElementById('login-verify-resend');
const loginResendEmail = document.getElementById('login-resend-email');
const loginResendBtn = document.getElementById('login-resend-btn');

const authStatusModal = document.getElementById('auth-status-modal');
const authStatusMessage = document.getElementById('auth-status-message');
const closeAuthStatus = document.getElementById('close-auth-status');

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
let pendingProblemActivation = null;
let gameRunning = false;
let paused = false;
let currentLevelIndex = 0;
let levelStartScore = 0;
let levelRequestGeneration = 0; // Prevents stale level configs after logout/restart
let activeLightningBolts = [];
let activeFireballs = [];
let activeDragons = [];
let heroLunge = null; // { phase:'out'|'back', fiend?, targetX, onArrive? }
let healHoldProgress = 0;   // seconds accumulated toward the next healed heart
let isHealHolding = false;  // true while a pointer is held down in the heal zone
let healHoldPointerId = null; // the pointer currently tracked for hold-to-heal (only one at a time)
let healTipShown = false;   // whether the "hold left edge to heal" tip has been shown this playthrough
const LUNGE_SPEED = 420;  // px/s for both the dash-in and return
const LUNGE_MIN_DIST = 140; // skip lunge when fiend is already within this distance of HERO_X
// Ranged spells (fireball/lightning) launch from just right of the hero's
// sprite while he strikes in place at the base location, rather than lunging
// up to the fiend like a melee hit does. The target height matches the
// launch height so the bolt/fireball flies level, straight into the fiend's
// body instead of angling down at its feet.
const SPELL_LAUNCH_X = HERO_X + 130;
const SPELL_LAUNCH_Y = GROUND_Y - 60;
const SPELL_TARGET_Y_OFFSET = 60;
// Must match Fireball's `life` (in entities.js) in milliseconds, so the hit
// lands right as the sprite reaches the fiend instead of the instant it's cast.
const FIREBALL_FLIGHT_MS = 1350;
let currentProfile = null;
let currentLeaderboard = null;
let pendingResetToken = null;
let lastBillingStatus = null;
let lastLevelClearNum = null;

// --- Cloudflare Turnstile CAPTCHA (register/forgot-password/resend-verification) ---
// Site key is public by design (Cloudflare's own docs embed it directly in
// client HTML/JS) — only the secret key (server-side, verified in
// app/captcha.py) is sensitive.
const TURNSTILE_SITE_KEY = '0x4AAAAAAEpYkPRsDpkS9Dlo';
const turnstileWidgets = { register: null, forgotPassword: null, resend: null };
const TURNSTILE_CONTAINER_IDS = {
  register: 'turnstile-register',
  forgotPassword: 'turnstile-forgot-password',
  resend: 'turnstile-resend',
};

// Turnstile refuses to actually run its challenge (and never yields a
// token) inside a `display:none` ancestor, so widgets must only be
// rendered once their container is genuinely visible on screen — not
// eagerly at page load, when the auth modal/forms are still hidden.
// Call this right after making a widget's container visible.
function ensureTurnstileWidget(key) {
  if (turnstileWidgets[key] !== null) return;

  // Check if user declined cookies
  if (window.ffmCookieConsent && window.ffmCookieConsent.getState() === 'declined') {
    const containerId = TURNSTILE_CONTAINER_IDS[key];
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `<p style="color: #d0a0a0; font-size: 12px; margin: 8px 0;">${t('cookie.turnstileBlocked')}</p>`;
    }
    return;
  }

  if (!window.turnstile) {
    // Turnstile's script tag loads asynchronously; poll
    // briefly until it's available rather than relying on a fixed delay.
    setTimeout(() => ensureTurnstileWidget(key), 100);
    return;
  }
  const container = document.getElementById(TURNSTILE_CONTAINER_IDS[key]);
  if (container) {
    turnstileWidgets[key] = window.turnstile.render(container, { sitekey: TURNSTILE_SITE_KEY });
  }
}

function getTurnstileToken(key) {
  const widgetId = turnstileWidgets[key];
  if (!window.turnstile || widgetId === null) return '';
  return window.turnstile.getResponse(widgetId) || '';
}

function resetTurnstileWidget(key) {
  const widgetId = turnstileWidgets[key];
  if (window.turnstile && widgetId !== null) {
    window.turnstile.reset(widgetId);
  }
}

// --- Input ---
const input = new InputManager(handleAnswer);

function leaderboardBucketLabel(value) {
  return value === null || value === undefined ? t('leaderboard.unclassified') : String(value);
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatAchievedAt(value) {
  if (!value) return '';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return timestamp.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderPersonalBest(profile, container) {
  if (!container) return;
  if (!profile?.high_score) {
    container.style.display = 'none';
    container.textContent = '';
    return;
  }

  const achievedAt = formatAchievedAt(profile.high_score.achieved_at);
  container.textContent = t('leaderboard.personalBest', { score: profile.high_score.score, date: achievedAt });
  container.style.display = '';
}

function buildScoreHistorySvg(history) {
  const width = 300;
  const height = 100;
  const padding = 8;

  if (!history || history.length === 0) {
    return '';
  }

  const scores = history.map((entry) => entry.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const range = maxScore - minScore;

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  const points = history.map((entry, i) => {
    const x = history.length === 1
      ? padding + innerWidth / 2
      : padding + (i / (history.length - 1)) * innerWidth;
    const y = range === 0
      ? padding + innerHeight / 2
      : padding + innerHeight - ((entry.score - minScore) / range) * innerHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const circles = points.map((p) => {
    const [x, y] = p.split(',');
    return `<circle cx="${x}" cy="${y}" r="2.5" fill="#4dd0e1" />`;
  }).join('');

  const polyline = history.length > 1
    ? `<polyline points="${points.join(' ')}" fill="none" stroke="#4dd0e1" stroke-width="2" />`
    : '';

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100" role="img" aria-label="${t('scoreHistory.ariaLabel')}">` +
    `<line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#555" stroke-width="1" />` +
    polyline + circles +
    `</svg>`;
}

function renderScoreHistory(historyResponse, container) {
  if (!container) return;
  const history = historyResponse?.history || [];
  if (history.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  container.innerHTML = buildScoreHistorySvg(history);
  container.style.display = '';
}

function renderLevelJumpOptions(profile) {
  const scores = profile && profile.scores ? profile.scores : [];
  const levels = [...new Set(scores.map((s) => s.level))].sort((a, b) => a - b);
  if (levels.length === 0) {
    levelJumpRow.style.display = 'none';
    levelJumpSelect.innerHTML = `<option value="">${t('levels.startFromOne')}</option>`;
    return;
  }
  const options = [`<option value="">${t('levels.startFromOne')}</option>`]
    .concat(levels.map((lvl) => `<option value="${lvl}">${t('levels.level', { level: lvl })}</option>`));
  levelJumpSelect.innerHTML = options.join('');
  levelJumpRow.style.display = '';
}

function renderLeaderboard(entries) {
  if (!entries || entries.length === 0) {
    leaderboardList.innerHTML = `<li>${t('leaderboard.empty')}</li>`;
    return;
  }

  const currentUser = api.username;
  leaderboardList.innerHTML = entries.map((entry) => {
    const isCurrent = currentUser && entry.username === currentUser;
    const bucket = leaderboardBucketLabel(entry.first_grade_year);
    return `<li class="${isCurrent ? 'current-user' : ''}">#${entry.rank} ${escHtml(entry.username)} — ${escHtml(entry.high_score)} (${escHtml(bucket)})</li>`;
  }).join('');
}

function syncLeaderboardFilterOptions(groupedEntries) {
  const previous = leaderboardYearFilter.value;
  const yearValues = new Set();
  for (const group of groupedEntries || []) {
    if (group.first_grade_year !== null && group.first_grade_year !== undefined) {
      yearValues.add(String(group.first_grade_year));
    }
  }

  const sortedYears = Array.from(yearValues).sort();
  leaderboardYearFilter.innerHTML = `<option value="">${t('leaderboard.allYears')}</option>` +
    sortedYears.map((year) => `<option value="${year}">${year}</option>`).join('') +
    `<option value="unclassified">${t('leaderboard.unclassified')}</option>`;

  if (previous && Array.from(leaderboardYearFilter.options).some((opt) => opt.value === previous)) {
    leaderboardYearFilter.value = previous;
  }
}

function entriesForSelectedFilter(data) {
  if (!data) return [];
  const selected = leaderboardYearFilter.value;
  if (!selected) return data.global_entries || [];

  const wantedYear = selected === 'unclassified' ? null : Number(selected);
  const group = (data.grouped_entries || []).find((entry) => entry.first_grade_year === wantedYear);
  return group ? group.entries : [];
}

async function refreshProfileAndLeaderboard() {
  try {
    currentLeaderboard = await api.getLeaderboard();
    syncLeaderboardFilterOptions(currentLeaderboard.grouped_entries || []);
    renderLeaderboard(entriesForSelectedFilter(currentLeaderboard));
  } catch {
    renderLeaderboard([]);
  }

  if (!api.isLoggedIn) {
    currentProfile = null;
    renderPersonalBest(null, leaderboardPersonalBest);
    renderScoreHistory(null, scoreHistoryChart);
    renderLevelJumpOptions(null);
    leaderboardProfilePrompt.style.display = 'none';
    leaderboardCompleteProfile.style.display = 'none';
    return;
  }

  try {
    currentProfile = await api.getProfile();
    renderPersonalBest(currentProfile, leaderboardPersonalBest);
    renderLevelJumpOptions(currentProfile);
    const year = currentProfile?.user?.first_grade_year;
    if (year === null || year === undefined) {
      leaderboardProfilePrompt.textContent = t('leaderboard.profilePrompt');
      leaderboardProfilePrompt.style.display = '';
      leaderboardCompleteProfile.style.display = '';
    } else {
      leaderboardProfilePrompt.style.display = 'none';
      leaderboardCompleteProfile.style.display = 'none';
    }
  } catch {
    renderPersonalBest(null, leaderboardPersonalBest);
    leaderboardProfilePrompt.style.display = 'none';
    leaderboardCompleteProfile.style.display = 'none';
  }

  try {
    const historyResponse = await api.getScoreHistory();
    renderScoreHistory(historyResponse, scoreHistoryChart);
  } catch {
    renderScoreHistory(null, scoreHistoryChart);
  }
}

// --- Splash login button ---
function updateHUDLogoutVisibility() {
  const splashVisible = diffSelect.style.display !== 'none';
  if (splashVisible || !api.username) {
    logoutBtn.style.display = 'none';
  } else {
    logoutBtn.style.display = '';
  }
}

function applyAuthUIState() {
  if (api.username) {
    loginBtn.style.display = 'none';
    userDisplay.textContent = api.username;
    userDisplay.style.display = '';
    splashLoginBtn.textContent = t('splash.logout');
    splashGreeting.textContent = t('splash.greeting', { username: api.username });
  } else {
    loginBtn.style.display = '';
    userDisplay.textContent = '';
    userDisplay.style.display = 'none';
    splashLoginBtn.textContent = t('splash.loginRegister');
    splashGreeting.textContent = '';
  }
  updateHUDLogoutVisibility();
  refreshProfileAndLeaderboard();
}

splashLoginBtn.addEventListener('click', () => {
  if (api.username) {
    clearPremiumSession();
    api.logout().then(() => {
      applyAuthUIState();
    });
  } else {
    showAuthForm(loginForm);
    authModal.style.display = 'flex';
  }
});

// --- Difficulty select ---
document.querySelectorAll('#difficulty-select .diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.difficulty === 'shapes') {
      state.difficulty = 'shapes';
      state.timerMax = parseInt(btn.dataset.timer);
      state.timerRemaining = state.timerMax;
      state.maxHearts = parseInt(btn.dataset.hearts);
      state.hearts = state.maxHearts;
      state.score = 0;
      levelStartScore = 0;
      healTipShown = false;
      diffSelect.style.display = 'none';
      startShapesMode();
      return;
    }
    state.difficulty = btn.dataset.difficulty;
    state.timerMax = parseInt(btn.dataset.timer);
    state.timerRemaining = state.timerMax;
    state.maxHearts = parseInt(btn.dataset.hearts);
    state.hearts = state.maxHearts;
    healTipShown = false;
    const jumpValue = levelJumpSelect.value;
    const targetLevel = jumpValue ? parseInt(jumpValue, 10) : 1;
    const targetIndex = targetLevel - 1;
    state.score = 0;
    levelStartScore = state.score;
    diffSelect.style.display = 'none';
    startLevel(targetIndex, true);
  });
});

// --- Auth ---
const authForms = [loginForm, registerForm, forgotPasswordForm, resetPasswordForm];

function showAuthForm(formToShow) {
  authForms.forEach(f => { f.style.display = (f === formToShow) ? '' : 'none'; });
  if (formToShow !== loginForm) {
    loginVerifyResend.style.display = 'none';
  }
  const isMainTabForm = formToShow === loginForm || formToShow === registerForm;
  document.getElementById('auth-tabs').style.display = isMainTabForm ? '' : 'none';
  if (formToShow === loginForm) {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
  } else if (formToShow === registerForm) {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    ensureTurnstileWidget('register');
  } else if (formToShow === forgotPasswordForm) {
    ensureTurnstileWidget('forgotPassword');
  }
}

tabLogin.addEventListener('click', () => showAuthForm(loginForm));
tabRegister.addEventListener('click', () => showAuthForm(registerForm));

loginBtn.addEventListener('click', () => {
  showAuthForm(loginForm);
  authModal.style.display = 'flex';
});
closeAuth.addEventListener('click', () => {
  authModal.style.display = 'none';
  showAuthForm(loginForm);
});
logoutBtn.addEventListener('click', async () => {
  clearPremiumSession();
  await api.logout();
  applyAuthUIState();
});
loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginError.classList.remove('success-msg');
  loginVerifyResend.style.display = 'none';
  try {
    const u = document.getElementById('login-username').value;
    const p = document.getElementById('login-password').value;
    await api.login(u, p);
    authModal.style.display = 'none';
    loginError.textContent = '';
    applyAuthUIState();
    if (new URLSearchParams(location.search).get('account') === 'billing') openBillingPanel();
    else resumePendingLevel();
  } catch (err) {
    if (err.message === 'email_not_verified') {
      loginError.textContent = t('auth.verifyBeforeLogin');
      loginVerifyResend.style.display = '';
      ensureTurnstileWidget('resend');
    } else {
      loginError.textContent = translateServerMessage(err.message);
    }
  }
});

loginResendBtn.addEventListener('click', async () => {
  const email = loginResendEmail.value.trim();
  if (!email) {
    loginError.textContent = t('auth.enterEmailToResend');
    return;
  }
  try {
    await api.resendVerification(email, getTurnstileToken('resend'));
    loginError.classList.add('success-msg');
    loginError.textContent = t('auth.verificationResent');
    loginVerifyResend.style.display = 'none';
  } catch (err) {
    loginError.classList.remove('success-msg');
    loginError.textContent = translateServerMessage(err.message);
  } finally {
    resetTurnstileWidget('resend');
  }
});

registerForm.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const consentCheckbox = document.getElementById('reg-consent-checkbox');
    if (!consentCheckbox.checked) {
      registerError.textContent = t('auth.mustConfirmTerms');
      return;
    }
    const u = document.getElementById('reg-username').value;
    const em = document.getElementById('reg-email').value;
    const pw = document.getElementById('reg-password').value;
    const firstGradeYear = document.getElementById('reg-first-grade-year').value;
    await api.register(u, em, pw, firstGradeYear, getTurnstileToken('register'));
    registerError.textContent = '';
    registerForm.reset();
    showAuthForm(loginForm);
    loginError.classList.add('success-msg');
    loginError.textContent = t('auth.registrationSuccessful');
  } catch (err) {
    registerError.textContent = translateServerMessage(err.message);
  } finally {
    resetTurnstileWidget('register');
  }
});

forgotPasswordLink.addEventListener('click', () => {
  showAuthForm(forgotPasswordForm);
});

backToLoginLink.addEventListener('click', () => {
  showAuthForm(loginForm);
});

forgotPasswordForm.addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('forgot-password-email').value.trim();
  const msgEl = document.getElementById('forgot-password-message');
  try {
    await api.forgotPassword(email, getTurnstileToken('forgotPassword'));
    msgEl.classList.add('success-msg');
    msgEl.textContent = t('auth.resetLinkSent');
  } catch (err) {
    msgEl.classList.remove('success-msg');
    msgEl.textContent = translateServerMessage(err.message);
  } finally {
    resetTurnstileWidget('forgotPassword');
  }
});

resetPasswordForm.addEventListener('submit', async e => {
  e.preventDefault();
  const msgEl = document.getElementById('reset-password-message');
  const newPw = document.getElementById('reset-new-password').value;
  const confirmPw = document.getElementById('reset-confirm-password').value;
  if (newPw !== confirmPw) {
    msgEl.classList.remove('success-msg');
    msgEl.textContent = t('auth.passwordsDoNotMatch');
    return;
  }
  if (!pendingResetToken) {
    msgEl.classList.remove('success-msg');
    msgEl.textContent = t('auth.missingOrExpiredResetLink');
    return;
  }
  try {
    await api.resetPassword(pendingResetToken, newPw);
    msgEl.classList.add('success-msg');
    msgEl.textContent = t('auth.passwordResetDone');
    pendingResetToken = null;
    resetPasswordForm.reset();
    setTimeout(() => showAuthForm(loginForm), 1500);
  } catch (err) {
    msgEl.classList.remove('success-msg');
    msgEl.textContent = translateServerMessage(err.message);
  }
});

closeAuthStatus.addEventListener('click', () => {
  authStatusModal.style.display = 'none';
});

leaderboardYearFilter.addEventListener('change', () => {
  renderLeaderboard(entriesForSelectedFilter(currentLeaderboard));
});

leaderboardCompleteProfile.addEventListener('click', async () => {
  const yearInput = prompt(t('leaderboard.yearPromptMessage'));
  if (yearInput === null) return;
  const year = Number(yearInput);
  if (!Number.isInteger(year)) {
    leaderboardProfilePrompt.textContent = t('leaderboard.yearPromptInvalid');
    leaderboardProfilePrompt.style.display = '';
    return;
  }
  const result = await api.updateProfile(year);
  if (result.error) {
    leaderboardProfilePrompt.textContent = translateServerMessage(result.error);
    leaderboardProfilePrompt.style.display = '';
    return;
  }
  await refreshProfileAndLeaderboard();
});

closeCheckout?.addEventListener('click', () => {
  checkoutModal.style.display = 'none';
});

checkoutForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const adultConfirmed = checkoutAdultConfirm?.checked;
  const termsAccepted = checkoutTermsAccept?.checked;
  if (!adultConfirmed || !termsAccepted) {
    checkoutMessage.textContent = t('checkout.confirmAdultAndTerms');
    return;
  }
  try {
    const result = await api.startCheckout(adultConfirmed, termsAccepted);
    if (isStripeRedirect(result.url, 'checkout.stripe.com')) {
      window.location.href = result.url;
    } else {
      checkoutMessage.textContent = t('checkout.invalidUrl');
    }
  } catch (err) {
    checkoutMessage.textContent = translateServerMessage(err.message) || t('checkout.failed');
  }
});

userDisplay.addEventListener('click', async () => {
  if (!api.isLoggedIn) return;
  showAccountTab(tabAccountProfile, accountProfilePanel);
  accountModal.style.display = 'flex';
  await populateAccountModal();
});

closeAccount.addEventListener('click', () => {
  accountModal.style.display = 'none';
});

function showAccountTab(tabBtn, panel) {
  [accountProfilePanel, accountPasswordPanel, accountScoresPanel, accountBillingPanel, accountDangerPanel].forEach(p => { p.style.display = 'none'; });
  [tabAccountProfile, tabAccountPassword, tabAccountScores, tabAccountBilling, tabAccountDanger].forEach(t => t.classList.remove('active'));
  panel.style.display = '';
  tabBtn.classList.add('active');
  if (tabBtn === tabAccountBilling) {
    loadBilling();
  }
}

tabAccountProfile.addEventListener('click', () => showAccountTab(tabAccountProfile, accountProfilePanel));
tabAccountPassword.addEventListener('click', () => showAccountTab(tabAccountPassword, accountPasswordPanel));
tabAccountScores.addEventListener('click', () => showAccountTab(tabAccountScores, accountScoresPanel));
tabAccountBilling.addEventListener('click', () => showAccountTab(tabAccountBilling, accountBillingPanel));
tabAccountDanger.addEventListener('click', () => {
  accountDeleteForm.reset();
  accountDeleteMessage.classList.remove('success-msg');
  accountDeleteMessage.textContent = '';
  showAccountTab(tabAccountDanger, accountDangerPanel);
});

btnStartCheckout.addEventListener('click', () => {
  checkoutModal.style.display = 'flex';
});

btnOpenPortal.addEventListener('click', async () => {
  if (btnOpenPortal.disabled) return;
  const originalLabel = btnOpenPortal.textContent;
  btnOpenPortal.disabled = true;
  btnOpenPortal.textContent = t('billing.openingPortal');
  btnOpenPortal.setAttribute('aria-busy', 'true');
  try {
    const result = await api.openBillingPortal();
    if (isStripeRedirect(result.url, 'billing.stripe.com')) {
      window.location.href = result.url;
    } else {
      billingStatusText.textContent = t('billing.invalidPortalUrl');
    }
  } catch (err) {
    billingStatusText.textContent = translateServerMessage(err.message) || t('billing.openPortalFailed');
  } finally {
    btnOpenPortal.disabled = false;
    btnOpenPortal.textContent = originalLabel;
    btnOpenPortal.removeAttribute('aria-busy');
  }
});

btnRedeemCode.addEventListener('click', async () => {
  const code = billingRedeemCode.value.trim();
  if (!code) {
    billingRedeemMessage.classList.remove('success-msg');
    billingRedeemMessage.textContent = t('billing.pleaseEnterCode');
    return;
  }
  try {
    await api.redeemCode(code);
    billingRedeemMessage.classList.add('success-msg');
    billingRedeemMessage.textContent = t('billing.codeRedeemed');
    billingRedeemCode.value = '';
    await loadBilling();
    resumePendingLevel();
  } catch (err) {
    billingRedeemMessage.classList.remove('success-msg');
    billingRedeemMessage.textContent = translateServerMessage(err.message) || t('billing.redeemFailed');
  }
});

async function loadBilling() {
  try {
    billingStatusDisplay.textContent = t('billing.loadingShort');
    billingActions.style.display = 'none';
    const status = await api.getBillingStatus();
    renderBillingStatus(status);
  } catch (err) {
    billingStatusDisplay.textContent = translateServerMessage(err.message) || t('billing.loadFailed');
  }
}

function renderBillingStatus(status) {
  lastBillingStatus = status;
  billingStatusDisplay.textContent = '';
  billingActions.style.display = 'block';
  const founding = status.reason === 'grandfathered';
  const parts = [founding ? t('billing.foundingPlayer')
    : status.premium_access ? t('billing.accessUntil', { date: formatAchievedAt(status.access_until) })
    : status.reason === 'prelaunch' ? t('billing.prelaunch')
    : t('billing.freeLevelsNotice')];
  if (status.next_payment_at) parts.push(t('billing.nextPayment', { date: formatAchievedAt(status.next_payment_at) }));
  else if (status.subscription_id) parts.push(t('billing.noFurtherPaymentScheduled'));
  billingStatusText.textContent = parts.join(' ');
  btnStartCheckout.style.display = status.can_checkout ? 'block' : 'none';
  btnOpenPortal.style.display = status.subscription_id ? 'block' : 'none';
  document.getElementById('btn-cancel-subscription').style.display =
    status.subscription_id && !status.cancel_at_period_end &&
    !['canceled', 'incomplete_expired'].includes(status.subscription_status) ? 'block' : 'none';
  billingRedeemSection.style.display = api.isLoggedIn && !founding ? 'block' : 'none';
}

function openBillingPanel() {
  accountModal.style.display = 'flex';
  showAccountTab(tabAccountBilling, accountBillingPanel);
}

document.getElementById('btn-refresh-billing').addEventListener('click', async () => {
  await loadBilling();
  resumePendingLevel();
});
document.getElementById('btn-recover-gift').addEventListener('click', async () => {
  try {
    const response = await api._fetch('/billing/recover', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    renderBillingStatus(data.access);
    resumePendingLevel();
  } catch (error) {
    billingStatusText.textContent = translateServerMessage(error.message);
  }
});
document.getElementById('btn-cancel-subscription').addEventListener('click', async () => {
  if (!window.confirm(t('billing.confirmCancelRenewals'))) return;
  try {
    const result = await api.cancelSubscription();
    renderBillingStatus(result.access);
  } catch (error) {
    billingStatusText.textContent = translateServerMessage(error.message);
  }
});

async function populateAccountModal() {
  accountProfileMessage.textContent = '';
  accountProfileMessage.classList.remove('success-msg');
  try {
    const profile = await api.getProfile();
    accountCurrentEmailDisplay.textContent = profile.user.email;
    accountNewEmail.value = '';
    accountFirstGradeYear.value = profile.user.first_grade_year ?? '';
    accountProfileCurrentPassword.value = '';
    if (profile.user.pending_email) {
      accountPendingEmailNote.textContent = t('account.pendingEmailNote', { email: profile.user.pending_email });
      accountPendingEmailNote.style.display = '';
    } else {
      accountPendingEmailNote.style.display = 'none';
    }
    renderPersonalBest(profile, accountPersonalBest);
  } catch (err) {
    accountProfileMessage.textContent = t('account.loadProfileFailed');
  }

  try {
    const historyResponse = await api.getScoreHistory();
    renderScoreHistory(historyResponse, accountScoreHistoryChart);
  } catch {
    renderScoreHistory(null, accountScoreHistoryChart);
  }
}

accountProfileForm.addEventListener('submit', async e => {
  e.preventDefault();
  accountProfileMessage.classList.remove('success-msg');
  accountProfileMessage.textContent = '';
  const newEmail = accountNewEmail.value.trim();
  const yearRaw = accountFirstGradeYear.value;
  const currentPassword = accountProfileCurrentPassword.value;

  try {
    if (yearRaw !== '') {
      const year = Number(yearRaw);
      if (!Number.isInteger(year)) {
        accountProfileMessage.textContent = t('account.validYearRequired');
        return;
      }
      const result = await api.updateProfile(year);
      if (result.error) {
        accountProfileMessage.textContent = translateServerMessage(result.error);
        return;
      }
    }

    if (newEmail) {
      if (!currentPassword) {
        accountProfileMessage.textContent = t('account.currentPasswordRequiredForEmail');
        return;
      }
      const result = await api.changeEmail(newEmail, currentPassword);
      accountPendingEmailNote.textContent = t('account.pendingEmailNote', { email: result.pending_email });
      accountPendingEmailNote.style.display = '';
      accountNewEmail.value = '';
      accountProfileCurrentPassword.value = '';
    }

    accountProfileMessage.classList.add('success-msg');
    accountProfileMessage.textContent = t('account.saved');
    await refreshProfileAndLeaderboard();
  } catch (err) {
    accountProfileMessage.classList.remove('success-msg');
    accountProfileMessage.textContent = translateServerMessage(err.message);
  }
});

accountPasswordForm.addEventListener('submit', async e => {
  e.preventDefault();
  accountPasswordMessage.classList.remove('success-msg');
  const current = accountCurrentPassword.value;
  const next = accountNewPassword.value;
  const confirm = accountConfirmNewPassword.value;
  if (next !== confirm) {
    accountPasswordMessage.textContent = t('account.newPasswordsDoNotMatch');
    return;
  }
  try {
    await api.changePassword(current, next);
    accountPasswordMessage.classList.add('success-msg');
    accountPasswordMessage.textContent = t('account.passwordChanged');
    accountPasswordForm.reset();
  } catch (err) {
    accountPasswordMessage.classList.remove('success-msg');
    accountPasswordMessage.textContent = translateServerMessage(err.message);
  }
});

// Deleting an account requires: the checkbox acknowledgement (button stays
// disabled without it), the current password, and a final native confirm()
// dialog — three independent confirmations for an irreversible action.
accountDeleteConfirmCheckbox.addEventListener('change', () => {
  accountDeleteSubmit.disabled = !accountDeleteConfirmCheckbox.checked;
});
accountDeleteSubmit.disabled = true;

accountDeleteForm.addEventListener('submit', async e => {
  e.preventDefault();
  accountDeleteMessage.classList.remove('success-msg');
  accountDeleteMessage.textContent = '';

  if (!accountDeleteConfirmCheckbox.checked) {
    accountDeleteMessage.textContent = t('account.deleteConfirmNeeded');
    return;
  }
  const password = accountDeletePassword.value;
  if (!password) {
    accountDeleteMessage.textContent = t('account.enterCurrentPassword');
    return;
  }
  if (!window.confirm(t('account.confirmDeleteDialog'))) {
    return;
  }

  try {
    await api.deleteAccount(password);
    clearPremiumSession();
    accountModal.style.display = 'none';
    accountDeleteForm.reset();
    accountDeleteSubmit.disabled = true;
    applyAuthUIState();
    loginError.textContent = t('auth.accountDeleted');
    showAuthForm(loginForm);
  } catch (err) {
    accountDeleteMessage.classList.remove('success-msg');
    accountDeleteMessage.textContent = translateServerMessage(err.message);
  }
});

function updateMuteButtonLabel() {
  muteBtn.textContent = audio.muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-label', t(audio.muted ? 'topbar.unmuteAriaLabel' : 'topbar.muteAriaLabel'));
}

muteBtn.addEventListener('click', () => {
  audio.toggleMute();
  updateMuteButtonLabel();
});

langToggleBtn?.addEventListener('click', () => {
  toggleLocale();
});

// --- SessionStorage pending record helpers ---
function savePendingRecord(levelIndex, score, difficulty, timerMax, maxHearts) {
  const record = {
    levelIndex,
    score: Math.max(0, Math.floor(score)),
    difficulty,
    timerMax: Math.max(0, Math.floor(timerMax)),
    maxHearts: Math.max(1, Math.floor(maxHearts))
  };
  try {
    sessionStorage.setItem('pending_level_record', JSON.stringify(record));
  } catch {
    // quota exceeded or other storage error
  }
}

function getPendingRecord() {
  try {
    const str = sessionStorage.getItem('pending_level_record');
    if (!str) return null;
    const record = JSON.parse(str);
    return validatePendingRecord(record) ? record : null;
  } catch {
    return null;
  }
}

function clearPendingRecord() {
  try {
    sessionStorage.removeItem('pending_level_record');
  } catch {
    // ignore
  }
}

function resumePendingLevel() {
  if (!api.isLoggedIn) return;
  const pending = getPendingRecord();
  if (!pending) return;
  state.score = pending.score;
  state.difficulty = pending.difficulty;
  state.timerMax = pending.timerMax;
  state.timerRemaining = pending.timerMax;
  state.maxHearts = pending.maxHearts;
  state.hearts = pending.maxHearts;
  startLevel(pending.levelIndex);
}

function clearPremiumSession() {
  levelRequestGeneration++;
  incrementRequestGeneration();
  setCurrentLevelConfig(null);
  gameRunning = false;
  inputDisabled = true;
  state.timerActive = false;
  input.disable();
  accountModal.style.display = 'none';
  checkoutModal.style.display = 'none';
  diffSelect.style.display = 'flex';
  hideLoadingOverlay();
  topBar.style.display = 'flex';
  audio.stopBGM();
  updateHUDLogoutVisibility();
}

// --- Level/Wave setup ---
// Shows the same black loading bar used on first page load (see "Loading
// screen" above) for every level transition too — this is the moment the
// slow-connection artifact flicker was actually observed: even with all
// sprites preloaded up front, crossing a chapter boundary (every 10 levels)
// swaps renderer's single background Image's `.src`, which needs a fresh
// decode (see waitForBackgroundLoad()) before it's paintable again, and a
// freshly-loaded/very-slow session could still reach this point before the
// initial preload (or its safety timeout) finished. Gating the actual level
// setup behind both checks means gameplay never starts painting until
// everything it needs is genuinely ready.
async function startLevel(levelIndex, includeBaseline = false) {
  showLoadingOverlay();

  // Increment generation and capture it to detect stale requests
  levelRequestGeneration++;
  const myGeneration = levelRequestGeneration;
  const originalUsername = api.username;

  // Stop any in-flight game state
  gameRunning = false;
  inputDisabled = true;
  state.timerActive = false;
  input.disable();

  try {
    // Fetch level config (handles authorization for premium levels)
    const cfg = await getAuthorizedLevelConfig(levelIndex, api, includeBaseline);

    // Check if this request became stale (user logged in/out, or new level started)
    if (myGeneration !== levelRequestGeneration || originalUsername !== api.username) {
      hideLoadingOverlay();
      return; // Silently ignore stale request
    }

    // Don't set config until we've verified generation
    setCurrentLevelConfig(cfg);

    renderer.setBackgroundByLevel(cfg.level);

    // Apply baseline score to state if requested and available
    let baselineScore = 0;
    if (includeBaseline && cfg.baseline_score !== undefined) {
      baselineScore = cfg.baseline_score;
    }

    const ready = Promise.all([assetsLoaded, renderer.waitForBackgroundLoad()]);
    await Promise.race([
      ready,
      new Promise((resolve) => setTimeout(resolve, LOADING_SAFETY_TIMEOUT_MS)),
    ]);
      // Final stale check before finishing
      if (myGeneration !== levelRequestGeneration || originalUsername !== api.username) {
        hideLoadingOverlay();
        return; // Silently ignore stale request
      }
      hideLoadingOverlay();
      finishStartLevel(levelIndex, cfg, baselineScore);
      clearPendingRecord();
      accountModal.style.display = 'none';
  } catch (err) {
    hideLoadingOverlay();
    // Only show error if this is still the current generation
    if (myGeneration === levelRequestGeneration) {
      handleLevelConfigError(err, levelIndex);
    }
  }
}

function handleLevelConfigError(err, levelIndex) {
  const level = levelIndex + 1;
  let message = t('auth.failedToLoadLevel', { level });

  audio.stopBGM();

  if ([401, 402, 403].includes(err.statusCode) && level > 2) {
    savePendingRecord(levelIndex, state.score, state.difficulty, state.timerMax, state.maxHearts);
  }
  if (err.statusCode === 401) {
    message = t('auth.loginRequiredForPremium');
    showAuthForm(loginForm);
    authModal.style.display = 'flex';
  } else if (err.statusCode === 402) {
    message = t('auth.subscriptionRequired');
    // Save pending record for L3+ so user can resume after purchasing
    if (level > 2) {
      savePendingRecord(levelIndex, state.score, state.difficulty, state.timerMax, state.maxHearts);
    }
    // Show account modal with billing tab
    openBillingPanel();
  } else if (err.statusCode === 403) {
    message = t('auth.accessDenied');
  }

  authStatusMessage.textContent = message;
  authStatusModal.style.display = [401, 402].includes(err.statusCode) ? 'none' : 'flex';

  diffSelect.style.display = 'flex';
  updateHUDLogoutVisibility();
}

function finishStartLevel(levelIndex, cfg, baselineScore = 0) {
  state.isShapesMode = false;
  currentLevelIndex = levelIndex;
  levelStartScore = state.score;
  state.level = cfg.level;
  state.waveNumber = 1;
  state.enemiesDefeated = 0;
  state.fiendsSpawned = 0;
  spawnQueue = [];
  requeuedFiends = [];
  fiends = [];
  activeFiend = null;
  inputDisabled = false;
  pendingProblemActivation = null;
  activeLightningBolts = [];
  activeFireballs = [];
  activeDragons = [];
  resetHealHold();

  // If this is a new run (score 0) and baseline provided, set baseline as score
  if (baselineScore > 0 && state.score === 0) {
    state.score = baselineScore;
    levelStartScore = baselineScore;
  }

  const waveSize = cfg.waveSize;
  for (let i = 0; i < waveSize; i++) {
    spawnQueue.push(levelIndex);
  }
  spawnTimer = 2.0;
  state.combo = 0;
  gameRunning = true;
  paused = false;
  diffSelect.style.display = 'none';
  pauseOverlay.style.display = 'none';
  topBar.style.display = 'none';
  levelClearOverlay.style.display = 'none';
  gameOverOverlay.style.display = 'none';
  updateHUDLogoutVisibility();
  hud.update(state);
  audio.startBGM(cfg.chapter);
  if (!animFrameId) gameLoop(performance.now());
}

// Bootstraps the "Shapes" mode: an infinite, unscored shape-counting
// practice loop. Deliberately independent of startLevel/finishStartLevel
// (no LevelConfig entry, no waveSize/spawnQueue prefill, no level-clear) —
// see createShapesFiend/spawnNextFiend/checkAllDefeated for how the
// "infinite" spawning and "never clears" behavior is achieved.
function startShapesMode() {
  levelRequestGeneration++;
  const generation = levelRequestGeneration;
  showLoadingOverlay();
  renderer.setBackgroundByLevel(1); // reuse the Grade-1 stage art; no dedicated asset needed

  const ready = Promise.all([assetsLoaded, renderer.waitForBackgroundLoad()]);
  Promise.race([
    ready,
    new Promise((resolve) => setTimeout(resolve, LOADING_SAFETY_TIMEOUT_MS)),
  ]).then(() => {
    if (generation !== levelRequestGeneration) return;
    hideLoadingOverlay();
    finishStartShapesMode();
  });
}

function finishStartShapesMode() {
  currentLevelIndex = 0;
  state.isShapesMode = true;
  levelStartScore = state.score; // stays 0 — this mode never scores
  state.level = 1;
  state.waveNumber = 1;
  state.enemiesDefeated = 0;
  state.fiendsSpawned = 0;
  spawnQueue = [];
  requeuedFiends = [];
  fiends = [];
  activeFiend = null;
  inputDisabled = false;
  pendingProblemActivation = null;
  activeLightningBolts = [];
  activeFireballs = [];
  activeDragons = [];
  resetHealHold();

  spawnTimer = 2.0;
  state.combo = 0;
  gameRunning = true;
  paused = false;
  pauseOverlay.style.display = 'none';
  topBar.style.display = 'none';
  levelClearOverlay.style.display = 'none';
  gameOverOverlay.style.display = 'none';
  hud.update(state);
  audio.startBGM(1);
  if (!animFrameId) gameLoop(performance.now());
}

// Converts a pointer/mouse event's CSS-pixel client coordinates into the
// game's 800x450 logical canvas coordinate space. The canvas is scaled
// responsively via CSS (see styles.css `#game { width:100%; height:100% }`
// inside a viewport-sized wrapper), so client coordinates must be rescaled
// by the canvas's actual on-screen size before they mean anything in game
// coordinates (e.g. for the CANVAS_W/4 heal-zone boundary below).
function canvasLogicalX(clientX) {
  const rect = canvas.getBoundingClientRect();
  return (clientX - rect.left) * (CANVAS_W / rect.width);
}

function resetHealHold() {
  healHoldProgress = 0;
  isHealHolding = false;
  healHoldPointerId = null;
  hero._holdHealActive = false;
  hero._holdHealRatio = 0;
}

// Left quarter of the screen = hold-to-heal zone (see heal-hold.js); the
// remaining three quarters keep the existing tap-to-pause/resume behavior.
// Healing is only offered on multiple-choice levels — free-text levels need
// the on-screen keyboard/typing, which doesn't leave a spare hand/finger
// free to also hold the heal zone, so there's no point competing with it
// there. A single gesture is either "start healing" or "toggle pause" —
// never both — so pointerdown decides which, and the paired
// pointerup/cancel/leave only ever tears down the heal-hold side of it.
canvas.addEventListener('pointerdown', (e) => {
  if (!gameRunning || paused) return;
  if (getCurrentInputMode() !== 'multiple-choice') return;
  const x = canvasLogicalX(e.clientX);
  if (isInHealZone(x, CANVAS_W)) {
    isHealHolding = true;
    healHoldPointerId = e.pointerId;
  }
});

function stopHealHoldForPointer(e) {
  if (healHoldPointerId !== null && e.pointerId === healHoldPointerId) {
    isHealHolding = false;
    healHoldPointerId = null;
    healHoldProgress = 0;
  }
}
canvas.addEventListener('pointerup', stopHealHoldForPointer);
canvas.addEventListener('pointercancel', stopHealHoldForPointer);
canvas.addEventListener('pointerleave', stopHealHoldForPointer);

canvas.addEventListener('click', (e) => {
  // A click landing in the heal zone is part of the hold-to-heal gesture,
  // never the pause toggle — even a quick tap there just starts/stops a
  // (very short) heal attempt rather than pausing the game.
  if (isInHealZone(canvasLogicalX(e.clientX), CANVAS_W)) return;
  if (paused) {
    resumeGame();
  } else if (gameRunning) {
    pauseGame();
  }
});

// The pause overlay is a full-screen element stacked on top of the canvas
// (like the other overlays), so once it's visible it intercepts every
// click/tap before it can reach the canvas below — the canvas's own click
// listener above never fires again to resume. Listen on the overlay itself
// too, so tapping/clicking anywhere on the "Paused" screen resumes play.
pauseOverlay.addEventListener('click', () => {
  if (paused) resumeGame();
});

function pauseGame() {
  if (paused || !gameRunning) return;
  paused = true;
  pauseOverlay.style.display = 'flex';
  input.disable();
  audio.pauseBGM();
  resetHealHold();
}

function resumeGame() {
  if (!paused) return;
  paused = false;
  pauseOverlay.style.display = 'none';
  audio.resumeBGM();
  if (activeFiend && state.timerActive) {
    input.enable(getCurrentInputMode());
  }
}

// Shown once per playthrough, the first time hearts drop to half (or below)
// of maxHearts, explaining the hold-to-heal mechanic. Pauses gameplay (like
// pauseGame()) but shows a dedicated overlay instead of the generic "Paused"
// one, and deliberately leaves `input`/`inputDisabled` untouched — the
// wrong-answer sequence that triggered this (see handleWrongAnswer) already
// owns that state via its own timers, and confirming this tip must not
// re-enable input early or interfere with that sequence.
function showHealTip() {
  paused = true;
  healTipOverlay.style.display = 'flex';
  audio.pauseBGM();
}

btnHealTipConfirm.addEventListener('click', () => {
  healTipOverlay.style.display = 'none';
  paused = false;
  audio.resumeBGM();
});

// Only one fiend on screen at a time; gap kept for requeue safety
const FIEND_MIN_GAP = 145;

function spawnNextFiend() {
  // Wait until the previous fiend is completely gone
  if (fiends.length > 0) return;

  let fiend;
  if (spawnQueue.length > 0) {
    const levelIndex = spawnQueue.shift();
    fiend = createFiend(levelIndex, CANVAS_W + 20);  // problem already assigned inside
  } else if (requeuedFiends.length > 0) {
    fiend = requeuedFiends.shift();
    fiend.x = CANVAS_W + 20;
    fiend.walkSpeed = getFiendWalkSpeed(state.timerMax);
    fiend.wasRequeued = true;
    fiend.setState('walk');
  } else if (state.isShapesMode) {
    // Shapes mode never populates spawnQueue/requeuedFiends — it always
    // falls through to here, giving the "infinite" one-fiend-at-a-time
    // stream this mode needs.
    fiend = createShapesFiend(CANVAS_W + 20);
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
  // Shapes mode is an endless practice loop with no wave/level-clear
  // concept at all — never treat it as "cleared".
  if (state.isShapesMode) return false;
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
  const classBase   = getFiendClass(activeFiend.fiendClassId).scoreValue;
  const points      = (classBase + speedBonus + comboBonus) * multiplier;

  // Shapes mode is deliberately unscored (no score/combo/leaderboard) —
  // combo staying at 0 also naturally keeps pickComboAbility() below from
  // ever triggering fireball/lightning/dragon, so this mode is melee-only.
  if (!state.isShapesMode) {
    state.score += points;
    state.combo++;
  }
  state.timerActive = false;

  const fiend = activeFiend;
  // Decided once up front (not inside strikeNow) so the lunge gate below can
  // tell ranged spells apart from a melee hit before the hero starts moving.
  const ability = pickComboAbility(state.combo);

  const strikeNow = () => {
    if (ability === 'lightning') {
      // Hero strikes in place at the base location; the bolt is launched
      // from just right of his sprite toward the fiend.
      hero.setState('swing');
      activeLightningBolts.push(new LightningBolt(SPELL_LAUNCH_X, SPELL_LAUNCH_Y, fiend.x, fiend.y - SPELL_TARGET_Y_OFFSET));
      audio.playLightningCast();
      input.disable();
      inputDisabled = true;
      setTimeout(() => {
        fiend.hp = 0;
        fiend.setState('death');
        audio.playLightningHit();
        audio.playEnemyDeath();
        state.enemiesDefeated++;
        activeFiend = null;
        heroLunge = { phase: 'back', targetX: HERO_X, onArrive: () => {
          hero.setState('idle');
          setTimeout(() => {
            if (checkAllDefeated()) triggerWaveClear();
            else { spawnTimer = spawnInterval; inputDisabled = false; }
          }, 300);
        }};
        hud.update(state);
      }, 600);
    } else if (ability === 'fireball') {
      // Hero strikes in place at the base location; the fireball is launched
      // from just right of his sprite toward the fiend, and the hit lands
      // when it actually arrives rather than the instant it's cast.
      hero.setState('swing');
      activeFireballs.push(new Fireball(SPELL_LAUNCH_X, SPELL_LAUNCH_Y, fiend.x, fiend.y - SPELL_TARGET_Y_OFFSET));
      audio.playFireballCast();
      input.disable();
      inputDisabled = true;
      setTimeout(() => {
        audio.playFireballHit();
        fiend.hit();

        if (fiend.isDead) {
          audio.playEnemyDeath();
          state.enemiesDefeated++;
          activeFiend = null;
          heroLunge = { phase: 'back', targetX: HERO_X, onArrive: () => {
            setTimeout(() => {
              if (checkAllDefeated()) triggerWaveClear();
              else { spawnTimer = spawnInterval; inputDisabled = false; }
            }, 300);
          }};
        } else {
          const preserveTimer = shouldPreserveTimerAfterHit(fiend);
          activeFiend = null;
          heroLunge = {
            phase: 'back',
            targetX: HERO_X,
            onArrive: () => {
              const cfg = getCurrentLevelConfig();
              if (cfg) fiend.problem = generateProblem(state.level - 1, Date.now(), cfg);
              queueProblemActivation(fiend, { preserveTimer });
              inputDisabled = false;
            }
          };
        }
        hud.update(state);
      }, FIREBALL_FLIGHT_MS);
    } else if (ability === 'dragon') {
      activeDragons.push(new DragonSummon(CANVAS_W, GROUND_Y));
      hero.setState('swing');
      fiend.hit();
      audio.playDragonRoar();

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
        const preserveTimer = shouldPreserveTimerAfterHit(fiend);
        activeFiend = null;
        input.disable();
        inputDisabled = true;
        heroLunge = {
          phase: 'back',
          targetX: HERO_X,
          onArrive: () => {
            const cfg = getCurrentLevelConfig();
            if (cfg) fiend.problem = generateProblem(state.level - 1, Date.now(), cfg);
            queueProblemActivation(fiend, { preserveTimer });
            inputDisabled = false;
          }
        };
      }
    } else {
      // No ability (null): normal hit resolution
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
        const preserveTimer = shouldPreserveTimerAfterHit(fiend);
        activeFiend = null;
        input.disable();
        inputDisabled = true;
        heroLunge = {
          phase: 'back',
          targetX: HERO_X,
          onArrive: () => {
            const cfg = getCurrentLevelConfig();
            if (cfg) fiend.problem = generateProblem(state.level - 1, Date.now(), cfg);
            queueProblemActivation(fiend, { preserveTimer });
            inputDisabled = false;
          }
        };
      }
    }
    hud.update(state);
  };

  // Ranged spells strike from the hero's base location, so only lunge the
  // hero toward the fiend for a plain melee hit (or a dragon summon, which
  // still swings the sword up close).
  const isRangedSpell = ability === 'lightning' || ability === 'fireball';
  if (!isRangedSpell && fiend.x - HERO_X > LUNGE_MIN_DIST) {
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

  // First time hearts drop to half (or below) in this playthrough: pause and
  // explain the hold-to-heal mechanic before letting the wrong-answer
  // sequence (reveal/retreat, scheduled below) continue.
  if (!healTipShown && state.hearts <= state.maxHearts / 2) {
    healTipShown = true;
    showHealTip();
  }

  setTimeout(() => {
    if (activeFiend) {
      const p = activeFiend.problem;
      // Shapes problems have no text question (see shapes.js's
      // displayMode: 'shapes') — fall back to a plain "Answer: N" reveal.
      activeFiend._revealText = p.question
        ? p.question.replace(' = ?', ' = ' + p.answer)
        : `Answer: ${p.answer}`;
      activeFiend.setState('reveal');

      setTimeout(() => {
        if (activeFiend) {
          if (activeFiend.isElite) {
            const cfg = getCurrentLevelConfig();
            const regularHp = cfg?.fiendHP ?? 1;
            activeFiend.isElite = false;
            activeFiend.hp = Math.max(1, Math.min(activeFiend.hp, regularHp));
          }
          requeuedFiends.push(activeFiend);
          activeFiend.setState('retreat');
        }
      }, 2000);
    }
  }, 600);
}

function queueProblemActivation(fiend, options = {}) {
  const { preserveTimer = false } = options;
  pendingProblemActivation = { fiend, preserveTimer };
}

function activatePendingProblem() {
  if (!pendingProblemActivation) return;

  const { fiend, preserveTimer } = pendingProblemActivation;
  pendingProblemActivation = null;
  const mode = getCurrentInputMode();
  fiend.walkSpeed = getFiendWalkSpeed(state.timerMax, fiend.x);
  activeFiend = fiend;
  state.timerRemaining = getProblemTimerRemaining(state.timerMax, state.timerRemaining, preserveTimer);
  state.timerActive = true;
  questionStartTime = Date.now();
  if (mode === 'multiple-choice') {
    const mcOptions = [fiend.problem.answer, ...(fiend.problem.distractors || [])].sort(() => Math.random() - 0.5);
    input.setMCOptions(mcOptions);
  }
  input.enable(mode);
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

  if (state.level >= TOTAL_LEVELS) {
    triggerGameOver();
    return;
  }

  const completedLevelNum = state.level;          // 1-based display number
  const completedIndex = completedLevelNum - 1;   // 0-based LevelConfig index
  if (api.isLoggedIn) {
    api.postLevelScore(completedLevelNum, state.score - levelStartScore, state.difficulty).catch(() => {});
  }
  lastLevelClearNum = completedLevelNum;
  levelClearTitle.textContent = t('overlay.levelClearTitle', { level: completedLevelNum });
  levelClearScore.textContent = t('overlay.scoreLine', { score: state.score });
  topBar.style.display = 'flex';
  btnNextLevel.onclick = () => {
    levelClearOverlay.style.display = 'none';
    startLevel(completedIndex + 1);
  };
  btnReplayLevel.onclick = () => {
    levelClearOverlay.style.display = 'none';
    state.score = levelStartScore;
    startLevel(completedIndex);
  };
  btnSaveScoreReturnTitle.style.display = api.isLoggedIn ? 'block' : 'none';
  btnSaveScoreReturnTitle.onclick = async () => {
    if (!api.isLoggedIn) return;
    try {
      await api.postHighScore(state.score, state.level);
      await refreshProfileAndLeaderboard();
      levelClearOverlay.style.display = 'none';
      diffSelect.style.display = 'flex';
      updateHUDLogoutVisibility();
    } catch {
      levelClearScore.textContent = t('overlay.saveScoreFailed');
    }
  };
  levelClearOverlay.style.display = 'flex';
}

function triggerGameOver() {
  gameRunning = false;
  resetHealHold();
  input.disable();
  inputDisabled = true;
  state.timerActive = false;
  levelClearOverlay.style.display = 'none';
  topBar.style.display = 'flex';
  audio.stopBGM();
  audio.playGameOver();
  // Shapes mode is unscored — never submit a high score for it.
  if (api.isLoggedIn && !state.isShapesMode) {
    api.postHighScore(state.score, state.level).then(() => {
      refreshProfileAndLeaderboard();
    }).catch(() => {});
  }
  gameOverScore.textContent = state.isShapesMode
    ? t('overlay.shapesTryAgain')
    : t('overlay.scoreLine', { score: state.score });
  btnRetryLevel.onclick = () => {
    gameOverOverlay.style.display = 'none';
    if (state.isShapesMode) {
      startShapesMode();
      return;
    }
    state.score = levelStartScore;
    startLevel(currentLevelIndex);
  };
  btnReturnTitle.onclick = () => {
    gameOverOverlay.style.display = 'none';
    diffSelect.style.display = 'flex';
    updateHUDLogoutVisibility();
  };
  gameOverOverlay.style.display = 'flex';
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

  if (gameRunning && !paused) {
    updateTimer(dt);

    if (!activeFiend && !inputDisabled) {
      spawnTimer -= dt;
      if (spawnTimer <= 0 && (spawnQueue.length > 0 || requeuedFiends.length > 0 || state.isShapesMode)) {
        spawnNextFiend();
        spawnTimer = spawnInterval;
      }
    }

    hero.update(dt);

    // Hold-to-heal: continuously holding a pointer in the left-quarter heal
    // zone (see canvas 'pointerdown' listener above) slowly restores hearts.
    // Only offered on multiple-choice levels (see the pointerdown listener's
    // gate); re-checked here too so a level transition mid-hold (e.g. into
    // a free-text level) can't leave a stale hold running. Deliberately NOT
    // gated on hearts < maxHearts: the hold gesture (aura + HUD glow +
    // progress) stays fully "live" even at full hearts, so it never feels
    // unresponsive if a player starts holding pre-emptively — any heart it
    // would grant while already full is simply a harmless no-op (capped
    // below), not a dead/silent interaction.
    const isMCLevel = getCurrentInputMode() === 'multiple-choice';
    const canHeal = isMCLevel && hero.state !== 'hurt';
    const healResult = updateHealHold(healHoldProgress, dt, {
      isHolding: isHealHolding,
      canHeal,
      secondsPerHeart: GAME_CONFIG.healHoldSecondsPerHeart,
    });
    healHoldProgress = healResult.progress;
    if (healResult.healed) {
      state.hearts = Math.min(state.maxHearts, state.hearts + 1);
      hud.update(state);
    }
    hero._holdHealActive = isHealHolding && canHeal;
    hero._holdHealRatio = getHealHoldRatio(healHoldProgress, GAME_CONFIG.healHoldSecondsPerHeart);

    fiends.forEach(f => f.update(dt));
    activeLightningBolts = activeLightningBolts.filter(b => { b.update(dt); return !b.isDone; });
    activeFireballs = activeFireballs.filter(b => { b.update(dt); return !b.isDone; });
    activeDragons.forEach(d => {
      d.update(dt);
      if (d.breathJustCompleted) {
        audio.playDragonBreath();
        fiends.forEach(f => { if (!f.isDead) { f.hp = 0; f.setState('death'); } });
        triggerWaveClear();
      }
    });
    activeDragons = activeDragons.filter(d => !d.isDone);

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
      const visible = fiends.find(f => !f.isDead && f.problem && f.x < FIEND_ENTRY_TRIGGER_X);
      if (visible) {
        queueProblemActivation(visible);
      }
    }

    activatePendingProblem();

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
    if (f.problem && f.x < FIEND_ENTRY_TRIGGER_X && !f.isDead && f.state !== 'death') {
      if (f.problem.displayMode === 'shapes' && f.state !== 'reveal') {
        renderer.drawShapeBubble(f.x, f.y - 20 * LOGICAL_PX, f.problem.shapeType, f.problem.count, f === activeFiend);
      } else {
        const bubbleText = f.state === 'reveal'
          ? (f._revealText || f.problem.question)
          : f.problem.question;
        renderer.drawSpeechBubble(f.x, f.y - 20 * LOGICAL_PX, bubbleText, f === activeFiend);
      }
    }
    if (f === activeFiend && state.timerActive) {
      const ratio = state.timerRemaining / state.timerMax;
      renderer.drawTimerBar(f.x - 44, f.y - 22 * LOGICAL_PX, 88, ratio);
    }
  });

  // Pass 3: lightning bolts (over gameplay, under HUD)
  activeLightningBolts.forEach(b => b.draw(renderer.ctx));
  activeFireballs.forEach(b => b.draw(renderer.ctx));
  activeDragons.forEach(d => d.draw(renderer.ctx));

  // Pulsating frame around the play area while the combo counter is charging
  // toward (or sitting in) a special-ability band.
  renderer.drawComboFrame(getComboFrameBand(state.combo), ts);

  // Hearts glow the same green hue as the hero's healing aura while
  // hold-to-heal is active, so the HUD visibly reflects the same effect.
  // healGlowRatio: ambient row backdrop (floored so it's instantly visible
  // once holding starts). healFillRatio: raw progress, drives the gradual
  // per-heart fill cue in drawHUD (see renderer.js) so the next heart to be
  // healed visibly brightens in step with the actual 9s hold countdown.
  hud.update({
    healGlowRatio: hero._holdHealActive ? Math.max(0.35, hero._holdHealRatio) : 0,
    healFillRatio: hero._holdHealActive ? hero._holdHealRatio : 0,
  });
  hud.draw();
}

function handleUrlAuthTokens() {
  const params = new URLSearchParams(window.location.search);
  const verifyToken = params.get('verify_token');
  const resetToken = params.get('reset_token');
  const confirmEmailToken = params.get('confirm_email_token');

  if (verifyToken) {
    history.replaceState(null, '', window.location.pathname);
    authStatusModal.style.display = 'flex';
    authStatusMessage.textContent = t('auth.verifyingEmail');
    api.verifyEmail(verifyToken)
      .then(() => { authStatusMessage.textContent = t('auth.emailVerified'); })
      .catch(err => { authStatusMessage.textContent = t('auth.verificationFailed', { message: translateServerMessage(err.message) }); });
    return;
  }

  if (confirmEmailToken) {
    history.replaceState(null, '', window.location.pathname);
    authStatusModal.style.display = 'flex';
    authStatusMessage.textContent = t('auth.confirmingEmailChange');
    api.confirmEmailChange(confirmEmailToken)
      .then(() => { authStatusMessage.textContent = t('auth.emailChangeConfirmed'); })
      .catch(err => { authStatusMessage.textContent = t('auth.emailChangeConfirmFailed', { message: translateServerMessage(err.message) }); });
    return;
  }

  if (resetToken) {
    history.replaceState(null, '', window.location.pathname);
    pendingResetToken = resetToken;
    showAuthForm(resetPasswordForm);
    authModal.style.display = 'flex';
  }
}

handleUrlAuthTokens();

// Show a loading placeholder immediately so the leaderboard section never
// looks empty/broken while the first network round-trip is in flight, and
// kick off the leaderboard fetch right away rather than waiting on
// api.refresh() to settle first — the leaderboard doesn't need auth, so
// serializing it behind the refresh round-trip only doubles the wait
// (each hop can also hit a cold Lambda) before anything is shown.
leaderboardList.innerHTML = `<li>${t('leaderboard.loading')}</li>`;
refreshProfileAndLeaderboard();

updateMuteButtonLabel();

// Re-render dynamic (non data-i18n) UI text when the user switches locale,
// using whatever cached data we already have, so the toggle updates the
// visible UI immediately without a reload or re-fetch (gameplay state,
// including an in-progress level, is untouched).
onLocaleChange(() => {
  updateMuteButtonLabel();
  if (currentLeaderboard) renderLeaderboard(entriesForSelectedFilter(currentLeaderboard));
  if (currentProfile) renderPersonalBest(currentProfile, leaderboardPersonalBest);
  renderPersonalBest(currentProfile, accountPersonalBest);
  renderLevelJumpOptions(currentProfile);
  if (api.isLoggedIn) {
    splashLoginBtn.textContent = t('splash.logout');
    splashGreeting.textContent = t('splash.greeting', { username: api.username });
  } else {
    splashLoginBtn.textContent = t('splash.loginRegister');
  }
  if (lastBillingStatus) renderBillingStatus(lastBillingStatus);
  if (levelClearOverlay.style.display !== 'none' && lastLevelClearNum !== null) {
    levelClearTitle.textContent = t('overlay.levelClearTitle', { level: lastLevelClearNum });
    levelClearScore.textContent = t('overlay.scoreLine', { score: state.score });
  }
  if (gameOverOverlay.style.display !== 'none') {
    gameOverScore.textContent = state.isShapesMode
      ? t('overlay.shapesTryAgain')
      : t('overlay.scoreLine', { score: state.score });
  }
});

api.refresh()
  .catch(() => false)
  .finally(async () => {
    applyAuthUIState();
    await handleCheckoutRedirect();
    if (new URLSearchParams(location.search).get('account') === 'billing') {
      if (api.isLoggedIn) openBillingPanel();
      else {
        showAuthForm(loginForm);
        authModal.style.display = 'flex';
      }
    }
  });
