// main.js — Complete game loop for Arithmo Slayer

import {
  BOSS_ROUND_HITS, MISSING_OPERAND_BONUS, bossRoundKinds, generateProblem, getArithmeticOptionCount,
  isBossRoundLevel, revealQuestion, sampleFiendType, TOTAL_LEVELS,
} from './levels.js';
import { Renderer, CANVAS_W, CANVAS_H, GROUND_Y, LOGICAL_PX, HERO_X } from './renderer.js';
import { LEVEL_ART_MANIFEST, resolveLevelBackground, stageArtUrl } from './level-art.js';
import { Hero, Slimeling, Bonehead, Toadlord, Magelitch, BirdFoe, WolfFoe, SnakeFoe, LightningBolt, Fireball, DragonSummon, getHeroGroundOffsetPx } from './entities.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import {
  applyAudioPreferences,
  applyDeferredMusicVolume,
  readAudioPreferences,
  writeAudioPreferences,
} from './audio-preferences.js';
import { createHeartbeat, isLowHealth } from './low-health.js';
import { createHaptics } from './haptics.js';
import { noopVibration, resolveVibrationSource } from './haptics-source.js';
import {
  applyVibrationPreferences,
  readVibrationPreferences,
  writeVibrationPreferences,
} from './vibration-preferences.js';
import { InputManager } from './input.js';
import { createCompletionId, createLevelCompletion } from './level-completion.js';
import { initViewportLayout } from './viewport-layout.js';
import { createRetryableInitialization } from './retryable-init.js';
import { getCampaignProgress, resetLevelAttempt } from './campaign-progress.js';
import { resolvePlatform } from './platform.js';
import { getFiendClass, sampleFiendClassId, FIEND_CLASSES } from './difficulty-classes.js';
import { pickComboAbility, getComboFrameBand, getComboRewardProgress, isAbilityBandStart } from './combo-abilities.js';
import {
  formatEncounterLabel,
  formatRewardLabel,
  useCompactHeaderLabels,
} from './header-labels.js';
import {
  FIEND_ENTRY_TRIGGER_X,
  FIEND_PORTAL_X,
  getFiendWalkSpeed,
  getProblemTimerRemaining,
  shouldPreserveTimerAfterHit,
} from './difficulty.js';
import { CookieConsent } from './cookie-consent.js';
import { createHeroSkinManager, loadHeroSkin } from './hero-skin.js';
import { resolveHero, HEROES, heroAssetUrl } from './heroes.js';
import { renderHeroIdentity } from './hero-identity.js';
import { preloadGameAssets, preloadAbilityIcons, buildCriticalAssetManifest, buildDeferredAssetManifest } from './asset-preload.js';
import { updateHealHold, getHealHoldRatio, isInHealZone } from './heal-hold.js';
import { generateShapesProblem } from './shapes.js';
import { initI18n, t, toggleLocale, translateServerMessage, onLocaleChange, getLocale } from './i18n.js';
import { initWardenMode } from './boss-run.js';
import { createGameplayChrome } from './gameplay-chrome.js';
import { createAbilityBar } from './ability-bar.js';
import { BONUS_CAPS, applyBonus, bonusForLevel, createBonusRuntime } from './bonus-ladder.js';
import { applySpikeSlow, createAbilityRuntime, restoreSpikeSlow, spikeSlowForBonuses } from './cooldown-abilities.js';
import { createAttemptSummary } from './attempt-summary.js';
import { initGameplayModalFocus } from './modal-focus.js';
import { resolveDragonBreath, createAnswerClock, countDragonRemainingEncounters } from './encounter-flow.js';
import { dragonFinishPerFiendValue } from './level-baseline-score.js';
import {
  PRACTICE_KINDS,
  collectTargetedProblems,
  createEarnedRecovery,
  createPracticeSession,
  getPracticeBadgeIds,
  getPracticeEliteHp,
} from './practice-session.js';
import { getSkillIntro } from './skill-intro.js';
import { generateGameProblem2 } from './campaign2/problem.js';
import { bossRoundKinds2, isBossRoundLevel2, TOTAL_LEVELS_2 } from './campaign2/campaign2-levels.js';
import { getCampaign2LevelConfig, ABILITY_LEVEL } from './campaign2/config.js';
import { getSkillIntro2, INTRO_TEXT_2 } from './campaign2/intro-text.js';
import { createCampaign2Progress } from './campaign2/progress.js';
import { createCampaignSelection, campaignDragon, campaignDragonSrc } from './campaign2/selection.js';
import { campaign2Access, campaignSwitchVisible } from './campaign2/access.js';
import { expressionHtml } from './campaign2/math-render.js';
import { runestoneDataUri } from './runestone.js';
import { createLevelNumerals } from './level-numerals.js';
import { createLevelGrid } from './level-grid.js';
import { isLevelTestProfile, levelAvailability } from './test-profile.js';
import { createStoryIntro } from './story-intro.js';
import { dailyBestTrend, highScoreTrend } from './score-trend.js';
import { frameDelta } from './frame-delta.js';
import { createScreenFx, FX_Z_INDEX } from './screen-fx.js';
import { createEffectTable } from './screen-fx-effects.js';
import { createEncounterSwords } from './encounter-swords.js';
import { watchTitleBarDialogs } from './title-bar.js';
import { createDomBurst } from './dom-burst.js';
import { TOTAL_RUN_LEVELS, createSpeedrunRecords, createSpeedrunTimer, formatRunTime } from './speedrun.js';
import { createSpeedrunUi } from './speedrun-ui.js';
import { scrollToHighestLevel } from './scroll-focus.js';

// The active platform: web (api.js + access-flow.js) or the app bundle's
// local-only adapter. Resolved once, before any game code runs.
const platform = await resolvePlatform();
// Lets styles.css scope web-only layout rules without touching the app.
document.documentElement.dataset.platform = platform.isApp ? 'app' : 'web';
// HUD particles for the DOM parts of the screen: the score readout in the
// header and the ability orbs in the answer zone. The playfield keeps its own
// canvas engine; this one only ever adds short-lived spans.
const hudBurst = createDomBurst({
  reducedMotion: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
});
const gameplayChrome = createGameplayChrome({
  translate: t,
  // The score readout is the receipt for an answer: it throws a little brass
  // whenever the number goes up, and never on a reset to zero.
  onScoreGain: ({ element: readout }) => {
    if (readout) hudBurst.burst(readout, 'score', 10);
  },
});
// One bar for the whole session; the run's runtime feeds it progress every
// frame. It mounts itself into the answer zone, under the portrait sword row
// (see ability-bar.js), so the gameplay header keeps its height.
const abilityBar = createAbilityBar({
  translate: t,
  onActivate: (id) => activateAbility(id),
  // The orb is glass: pressing a ready one cracks it under the finger, whether
  // or not the cast is accepted. The spell's own cue follows on a real cast
  // (see playAbilityCastFeedback).
  onPress: (id, button) => {
    // The click is the whole spell: glass breaking, then that spell's own voice
    // (wind gust / storm snap / earth rumble) layered under it. Both belong to
    // the press, so a cast that the game refuses still sounds like the button it
    // is.
    audio.playAbilityPress?.();
    audio.playAbilityCast?.(id);
    if (button) hudBurst.burst(button, 'glass', 14);
  },
  // A cooling orb cannot cast, but it must not feel like a dead button: a dull
  // "not yet" and no shards (nothing broke).
  onRefused: () => {
    audio.playAbilityRefused?.();
  },
});
// The continuous-run clock and its device records. The timer is fed only while
// a campaign level is actually being played, so pauses, level-clear screens and
// loading never enter a time; the records card is hidden behind three taps on
// the title's level number (see speedrun-ui.js).
const speedrunRecords = createSpeedrunRecords({ storage: globalThis.localStorage ?? null });
const speedrunTimer = createSpeedrunTimer();
// The splits of the run in progress, kept only to report a finished run: the
// server checks that they add up to the total it is given.
let speedrunSplits = [];
const speedrunUi = createSpeedrunUi({
  doc: document,
  translate: t,
  records: speedrunRecords,
});
const gameplayModalFocus = initGameplayModalFocus({ doc: document });

// App-only lifecycle handle (see ./lifecycle.js, shipped by the app overlay).
// Stays null on the web build and until the app plugin has been wired.
let appLifecycle = null;

// App-only overlay UI handle (see ./mobile-ui.js, shipped by the app overlay).
// Stays null on the web build; later mobile issues feed timer and
// level-selection updates through it.
let mobileUi = null;

// App-only top-bar gain control (see ./volume-control.js, shipped by the app
// overlay). Stays null on the web build and until the overlay module loads.
let volumeControl = null;

// App-only contextual help handle (see ./help-overlay.js, shipped by the app
// overlay). Stays null on the web build; its question-mark buttons live in the
// play area, the pause menu and the title navigation.
let helpOverlay = null;

// The cached store entitlement, kept in step by syncNoticeHelp() below (launch,
// every return to the foreground, a finished purchase). The level grid renders
// synchronously and needs this without awaiting the store, and the "unlocked"
// test profile is only honoured while it is true.
let premiumAccess = false;

// Which campaign the title screen has selected (1: the 60-level campaign, 2: Arithmoslayer II),
// (the level being played carries its own: state.campaign). Declared up here because title code runs early.
let selectedCampaign = 1;

// App-only: a player who owns the unlock has nothing left to be told about
// what is free, so the "What is free?" entries follow the store entitlement.
// The buttons start hidden in the markup and are revealed by the first-open
// notice; this keeps them in step on launch, after a purchase and on a resume
// refresh. The web build never shows them, so it never asks.
async function syncNoticeHelp() {
  if (!platform.isApp) return false;
  let unlocked = false;
  try {
    unlocked = (await platform.getBillingStatus())?.premium_access === true;
  } catch {
    unlocked = false;
  }
  for (const id of ['first-open-notice-help', 'btn-notice-help']) {
    const button = document.getElementById(id);
    if (button) button.hidden = unlocked;
  }
  // A launch or purchase that flips the entitlement can change what the Levels
  // page offers a test profile, and the grid may well have been rendered before
  // the store answered.
  const gained = unlocked && !premiumAccess;
  const changed = unlocked !== premiumAccess;
  premiumAccess = unlocked;
  if (gained && currentPersonalDevelopment) {
    renderLocalCampaign(currentPersonalDevelopment.completed);
  }
  // "Add player" follows the unlock (see the profile UI's canCreate).
  if (changed && typeof profileUI !== 'undefined') profileUI?.refresh();
  return unlocked;
}

// The app caches the store entitlement on device. Refresh it on launch and on
// every return to the foreground, so a refund made while the app was closed
// revokes access and a purchase finished outside the app is picked up.
if (platform.isApp) {
  platform.refreshEntitlement().then(() => syncNoticeHelp(), () => false);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    platform.refreshEntitlement().then(() => syncNoticeHelp(), () => false);
  });
  // The app bundles its own privacy, imprint, terms and licence pages (see
  // ./legal.js); replace the web legal footer with localized links to them.
  // The web build never loads this module and keeps its existing footer.
  import('./legal.js')
    .then(({ setupTitleLegalLinks }) => setupTitleLegalLinks({ getLocale, onLocaleChange }))
    .catch(() => {});
  // Mount the app-only overlay UI: injects www/game/mobile-ui.css and
  // publishes the widget/timer/level hooks later mobile issues consume. A
  // missing or failing module leaves the game untouched; the web build never
  // loads it.
  import('./mobile-ui.js')
    .then(({ mountMobileUi }) => {
      mobileUi = mountMobileUi({ doc: document });
      return import('./timer-bar.js');
    })
    .then(({ createTimerBar }) => {
      mobileUi?.registerWidget('timer-bar', createTimerBar({ doc: document }));
      return import('./shapes-header.js');
    })
    .then(({ createShapesHeader }) => {
      gameplayChrome.setShapesHeader(createShapesHeader({ doc: document, stoneSrc: runestoneDataUri() }));
    })
    .catch(() => {});
  // App-only music/effects gain control in the top bar, wired to the same
  // engine and persisted preferences as the pause-menu audio settings. It is
  // created after the engine exists because the overlay import resolves after
  // this synchronous module body.
  Promise.all([
    import('./volume-control.js'),
    import('./ios-platform.js').catch(() => null),
  ])
    .then(([{ createVolumeControl }, iosPlatform]) => {
      volumeControl = createVolumeControl({
        silentSwitchHint: Boolean(iosPlatform?.isIosApp()),
        doc: document,
        audio,
        translate: t,
        persist: persistAudioPreferences,
        warn: (message, error) => console.warn(message, error),
      });
    })
    .catch(error => console.error('Unable to mount app audio settings', error));
  // App-only contextual help: question-mark buttons in the play area, pause
  // menu and title navigation open staged help with a link to the manual.
  import('./help-overlay.js')
    .then(({ mountHelpOverlay }) => {
      helpOverlay = mountHelpOverlay({
        doc: document,
        translate: t,
        getLocale,
        getGameMode: () => practiceRun?.kind ?? (state.isShapesMode ? 'shapes' : null),
        getTitlePage: () => activeTitlePage,
        game: {
          isPlaying: () => gameRunning && !paused,
          // A paused level is still a run: opening the manual from the pause
          // menu would end it, so help warns before the link (help-overlay.js).
          hasActiveRun: () => gameRunning,
          pause: pauseForHelp,
          resume: resumeFromHelp,
        },
        registerOverlay: gameplayModalFocus.registerOverlay,
        refreshFocus: gameplayModalFocus.refresh,
      });
    })
    .catch(() => {});
  // Pause gameplay and music while the app is in the background — including
  // the music no level owns — resume only after an automatic pause, map the
  // Android back button, and keep the screen awake only while a level is
  // running. The web build never loads this module.
  import('./lifecycle.js')
    .then(({ createAppPlugin, createKeepAwakePlugin, createLifecycle }) => {
      const app = createAppPlugin();
      if (!app) return;
      appLifecycle = createLifecycle({
        app,
        keepAwake: createKeepAwakePlugin(),
        game: {
          isPlaying: () => gameRunning && !paused,
          isPaused: () => paused,
          pause: pauseGame,
          resume: resumeGame,
          // The title playlist, the story intro, the result screens and the
          // victory hymn play outside any level, so the level pause above never
          // reaches them — Android keeps the WebView's audio running in the
          // background. Resuming keeps a pause the game owns, so returning from
          // the background never overrides the player.
          suspendAudio: () => audio.suspendForBackground(),
          resumeAudio: () => audio.resumeFromBackground(!paused),
          goBack: handleAppBack,
        },
      });
      appLifecycle.start().catch(() => {});
      syncKeepAwake();
    })
    .catch(() => {});
}

// Resolves the active locale, translates every data-i18n-* element in the
// page, and sets <html lang> before anything else runs.
initI18n();
initViewportLayout();
const titleLevelNumerals = createLevelNumerals({ doc: document, translate: t });
titleLevelNumerals.updateLevelSelection({ level: 1 });
// One portrait sword row for both channels; the CSS keeps it display:none
// outside portrait. The per-frame chrome update feeds it the same count as the
// header's "Defeated" readout.
const encounterSwords = createEncounterSwords({ doc: document });

// The page's CSP is `script-src 'self' https://challenges.cloudflare.com`
// with no 'unsafe-inline'/nonce, so an inline <script type="module"> in
// index.html would be silently blocked by the browser and never run at
// all (window.ffmCookieConsent would stay undefined, the banner would
// never show, and Turnstile would never load). Wiring it up here instead,
// in a same-origin file loaded via <script src>, is what actually executes.
window.ffmCookieConsent = new CookieConsent();
if (!platform.isApp) window.ffmCookieConsent.init();
else {
  // The app copy drops the web consent banner entirely; these lookups stay
  // null-safe so the shared module runs in both builds.
  const banner = document.getElementById('cookie-banner');
  if (banner) banner.style.display = 'none';
  const settings = document.getElementById('cookie-settings-link');
  if (settings) settings.hidden = true;
}
document.getElementById('cookie-accept')?.addEventListener('click', () => {
  window.ffmCookieConsent.accept();
});
document.getElementById('cookie-decline')?.addEventListener('click', () => {
  window.ffmCookieConsent.decline();
});
document.getElementById('cookie-settings-link')?.addEventListener('click', () => {
  window.ffmCookieConsent.revisit();
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

// First paint only needs the hero atlas and the fireball; the dragon, the six
// chapter backgrounds and all 60 fiend class sprites are reachable only once a
// level starts. Fetching them in front of the overlay instead of behind it cost
// 11 s to a playable title screen on a 9 Mbps / 60 ms link, against 2.8 s for
// the critical list alone.
// The stored hero the player may use; null (logged out, revoked, unreadable)
// means the adventurer. platform.getActiveHeroSkin() never rejects, and the
// choice itself stays stored when it is not honoured.
async function resolveActiveHeroId() {
  try {
    return resolveHero(await platform.getActiveHeroSkin?.(), { entitled: true }).id;
  } catch {
    return resolveHero(null).id;
  }
}
const activeHeroEntry = resolveHero(await resolveActiveHeroId(), { entitled: true });

const criticalAssetsLoaded = preloadGameAssets((loaded, total) => {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 100;
  if (loadingBarFill) loadingBarFill.style.width = pct + '%';
  if (loadingPercentEl) loadingPercentEl.textContent = pct + '%';
}, buildCriticalAssetManifest(activeHeroEntry));

// Started once the title screen is unblocked, so the two lists never compete
// for bandwidth. startLevel() still waits for this before painting a level, so
// a fiend can never appear as the procedural placeholder and pop into its art.
const deferredAssetsLoaded = criticalAssetsLoaded.then(
  () => preloadGameAssets(undefined, buildDeferredAssetManifest()),
);
const assetsLoaded = Promise.all([criticalAssetsLoaded, deferredAssetsLoaded]);

// The three ability icons are optional owner-delivered art; warming them in
// the background keeps the first unlock from flashing the text fallback.
// Every URL settles on load and error, so this can never block the game.
preloadAbilityIcons();

// A single stuck/broken asset (or a truly catastrophic connection) must not
// permanently trap the player behind a black screen — fall back to
// revealing the game after a generous timeout even if preload never
// settles, accepting the small risk of a placeholder flicker over an
// unplayable page. Used by the first-paint preload below, which only waits
// for the critical list, and by every startLevel() transition (see startLevel
// in the Level/Wave setup section), which re-shows this same overlay/bar so a
// level never starts rendering until its assets (including that level's own
// stage background, via renderer.waitForBackgroundLoad()) are actually ready.
const LOADING_SAFETY_TIMEOUT_MS = 30000;
// Resolves once the first-paint loading screen is hidden, so the app-only
// first-open notice appears over the title screen rather than behind it.
const loadingDone = Promise.race([
  criticalAssetsLoaded,
  new Promise((resolve) => setTimeout(resolve, LOADING_SAFETY_TIMEOUT_MS)),
]).then(hideLoadingOverlay);

// --- Story dioramas (see ../story/) ---
// The prologue plays on the first open of the install; each act's opening plays
// when its first level starts (see ./story-intro.js). The player loads lazily,
// and a missing scene or index never blocks the game.
const storyBase = new URL('../story/', import.meta.url);
// The narrator carries a story scene, so the title playlist steps back under it
// and comes back up when the scene ends. Silent playback has nothing to clear
// the way for, so it leaves the music alone.
const STORY_NARRATION_DUCK = 0.3;
async function playStoryScene(sceneId) {
  const sceneBase = new URL(`scenes/${sceneId}/`, storyBase);
  const [{ createDioramaPlayer }, scene] = await Promise.all([
    import(new URL('player/diorama-player.js', storyBase).href),
    fetch(new URL('scene.json', sceneBase)).then((response) => {
      if (!response.ok) throw new Error(`Story scene ${sceneId}: HTTP ${response.status}`);
      return response.json();
    }),
  ]);
  // iOS app only: narration goes through Web Audio like the music and effects,
  // so the hardware silent switch silences it too. Web and Android keep the
  // <audio> element; a failing import just keeps that path.
  const iosPlatform = platform.isApp
    ? await import('./ios-platform.js').catch(() => null)
    : null;
  const useWebAudioNarration = Boolean(iosPlatform?.isIosApp());
  const player = createDioramaPlayer({
    container: document.body,
    ...(useWebAudioNarration ? { createNarration: url => audio.createNarrationVoice(url) } : {}),
    scene,
    baseUrl: sceneBase,
    locale: getLocale(),
    // The diorama is a full-screen modal, so the mute choice is taken once, as
    // it stands when the scene opens.
    muted: audio.muted,
  });
  audio.setMusicDuck('story-narration', audio.muted ? null : STORY_NARRATION_DUCK);
  try {
    return await player.play();
  } finally {
    audio.setMusicDuck('story-narration', null);
    player.destroy();
  }
}
// The scene index maps a level to the act opening that belongs to it; it is
// fetched once, on first use.
let storyIndex = null;
async function storySceneForLevel(level) {
  storyIndex ??= fetch(new URL('scenes/index.json', storyBase))
    .then((response) => (response.ok ? response.json() : { scenes: [] }))
    .catch(() => ({ scenes: [] }));
  const { scenes = [] } = await storyIndex;
  const entry = scenes.find((candidate) => candidate.slot?.type === 'act'
    && candidate.slot.fromLevel === Number(level));
  return entry?.id ?? null;
}
const storyIntro = createStoryIntro({
  play: playStoryScene,
  sceneForLevel: storySceneForLevel,
  // A diorama is title-screen material: run it on the menu playlist instead of
  // whatever music the field was playing. Idempotent while the menu track runs.
  beforeScene: () => startMenuMusic(),
});
// Plays after the loading screen is gone, so it is never hidden behind it.
const introAtOpen = loadingDone.then(() => storyIntro.playOnOpen());
// The title screen offers the prologue again on demand; the player's own skip
// and the in-flight guard in story-intro.js keep it to one scene at a time.
document.getElementById('btn-replay-intro')?.addEventListener('click', () => {
  storyIntro.replay();
});

// --- Checkout redirect handling ---
// After Stripe checkout completes, user is redirected back with billing=success
async function handleCheckoutRedirect() {
  if (platform.isApp) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get('billing') === 'success') {
    try {
      // Get updated billing status
      const status = await platform.getBillingStatus();
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

function campaign2Progress() {
  return createCampaign2Progress({ playerId: campaign2PlayerId() });
}
// Campaign 2 is part of the web subscription; the apps sell it as one more in-app product.
async function getCampaign2AccessNow() {
  if (platform.isApp) {
    let owned = [];
    try { owned = (await platform.getOwnedProductIds?.()) ?? []; } catch { owned = []; }
    return campaign2Access({ platform: 'app', ownedProductIds: owned });
  }
  let premium = false;
  try { premium = (await platform.getBillingStatus())?.premium_access === true; } catch { premium = false; }
  return campaign2Access({ platform: 'web', premiumAccess: premium });
}
async function getCampaign2Config(levelIndex) {
  const access = await getCampaign2AccessNow();
  if (!access.granted) {
    const error = new Error('Campaign 2 is locked');
    error.code = 'campaign2_locked';
    error.reason = access.reason;
    throw error;
  }
  return getCampaign2LevelConfig(levelIndex + 1);
}

// A multi-hit fiend asks a fresh question after every hit. The last fiend of a
// boss-round level (20, 30, 40, 50, 60) walks through three different question
// types in a row instead: ordinary, the newest operation, then a missing operand.
//
// Campaign 2 (Arithmoslayer II, cfg.campaign === 2) has its own question generator, boss
// kinds, and scene / ability levels; Campaign 1 configs carry none of those fields.
const isBossFor = cfg => (cfg.campaign === 2 ? isBossRoundLevel2(cfg.level) : isBossRoundLevel(cfg.level));
function makeProblem(cfg, options) {
  return cfg.campaign === 2
    ? generateGameProblem2(cfg.level, Date.now(), options)
    : generateProblem(cfg.level - 1, Date.now(), cfg, options);
}
function nextHitProblem(fiend, cfg) {
  if (fiend.bossRound && !practiceRun) {
    fiend.bossStep = (fiend.bossStep ?? 0) + 1;
    const kinds = cfg.campaign === 2 ? bossRoundKinds2(cfg.level) : bossRoundKinds(cfg.level);
    return makeProblem(cfg, kinds[fiend.bossStep % kinds.length]);
  }
  return makeProblem(cfg);
}

// --- Fiend factory ---
function createFiend(levelIndex, x) {
  const cfg = platform.getCurrentLevelConfig();
  if (!cfg) throw new Error('Level config not loaded');
  const problem = cfg.campaign === 2 ? makeProblem(cfg) : generateProblem(levelIndex, Date.now(), cfg);
  const spawnIndex = state.fiendsSpawned;
  state.fiendsSpawned++;
  const fiendTypeKey = String(sampleFiendType(cfg.artLevel ?? cfg.level, spawnIndex) || cfg.fiendType || '').toLowerCase();
  const FiendClass = FIEND_TYPE_CLASS[fiendTypeKey] ?? OPERATOR_FIEND[problem.operation] ?? Slimeling;
  const isElite = Math.random() < GAME_CONFIG.eliteFiendChance;
  const practiceElite = practiceRun?.kind === 'elite';
  const bossRound = !practiceRun && isBossFor(cfg) && spawnIndex === cfg.waveSize - 1;
  const hp = practiceElite ? getPracticeEliteHp(cfg.fiendHP)
    : bossRound ? Math.max(BOSS_ROUND_HITS, cfg.fiendHP)
      : isElite ? GAME_CONFIG.eliteFiendHp : cfg.fiendHP;
  const tier = Math.min(3, Math.floor(((cfg.artLevel ?? cfg.level) - 1) / 15));
  const palettes = FIEND_PALETTES[fiendTypeKey];
  const palette = palettes ? palettes[tier] : undefined;
  const fiend = new FiendClass(x, groundY, hp, palette);
  fiend.walkSpeed = getFiendWalkSpeed(state.timerMax, FIEND_PORTAL_X,
    typeof abilityRuntime !== 'undefined' ? abilityRuntime?.fiendSpeedMultiplier : 1);
  fiend.problem = problem;
  fiend.isElite = practiceElite || (isElite && !bossRound);
  fiend.bossRound = bossRound;
  fiend.fiendClassId = sampleFiendClassId(cfg.artLevel ?? cfg.level, spawnIndex);
  fiend.type = fiendTypeKey;
  audio.prepareFiend?.(fiendTypeKey);
  if (practiceRun && practiceRun.kind !== 'targeted' && problem.operation) {
    practiceRun.operations.add(problem.operation);
  }
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
  const fiend = new FiendClass(x, groundY, 1, palette);
  fiend.walkSpeed = getFiendWalkSpeed(state.timerMax, FIEND_PORTAL_X,
    typeof abilityRuntime !== 'undefined' ? abilityRuntime?.fiendSpeedMultiplier : 1);
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
  fiend.type = fiendTypeKey;
  audio.prepareFiend?.(fiendTypeKey);
  return fiend;
}

// Returns the current problem's input mode ('multiple-choice' | 'free-text').
// Shapes mode isn't a LevelConfig entry, so it's special-cased here rather
// than relying on state.level happening to alias a real level's inputMode.
function getCurrentInputMode() {
  if (state.isShapesMode) return 'multiple-choice';
  const cfg = platform.getCurrentLevelConfig();
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
  // Enemies the level still holds. Beating one fills a sword and leaves this
  // alone; a storm takes enemies off the level and shrinks it, so the portrait
  // sword row empties exactly those slots (see levelSwordSlots).
  levelEnemies: 0,
  // The enemy count the level started with. The sword row keeps one slot per
  // entry, so a storm removal leaves an empty slot where that sword stood
  // instead of shortening the row and re-centring every remaining sword.
  levelSwordSlots: 0,
  fiendsSpawned: 0,
  timerMax: 10,
  timerRemaining: 10,
  timerActive: false,
  isShapesMode: false, // separate from practiceRun so shape UI stays mode-specific
};
let attemptSummary = createAttemptSummary();
let completionFeedback = null;
let lastCastAbility = null;
const answerClock = createAnswerClock();
let waveClearing = false;
let dragonFinishResolved = false;

function renderAttemptAccomplishment(id, result = completionFeedback) {
  const element = document.getElementById(id);
  if (!element) return;
  const summary = attemptSummary.snapshot();
  element.hidden = Boolean(practiceRun) || state.isShapesMode || summary.firstAttemptTotal === 0;
  if (element.hidden) {
    element.textContent = '';
    return;
  }
  const lines = [
    t('attempt.firstReplies', { correct: summary.firstAttemptCorrect, total: summary.firstAttemptTotal }),
    t('attempt.bestStreak', { streak: summary.bestStreak }),
  ];
  const previous = result?.previousAttemptSummary;
  if (previous && summary.firstAttemptCorrect * previous.firstAttemptTotal >
      previous.firstAttemptCorrect * summary.firstAttemptTotal) {
    lines.push(t('attempt.accuracyImproved'));
  } else if (previous && summary.bestStreak > previous.bestStreak) {
    lines.push(t('attempt.streakImproved', { improvement: summary.bestStreak - previous.bestStreak }));
  } else if (result?.saved) {
    lines.push(t('attempt.personalBest'));
  } else {
    lines.push(t(summary.firstAttemptCorrect === summary.firstAttemptTotal
      ? 'attempt.keepAccuracy' : 'attempt.replayGoal'));
  }
  element.textContent = lines.join('\n');
}

// --- DOM refs ---
const canvas = document.getElementById('game');
const pauseOverlay = document.getElementById('pause-overlay');
const pauseActions = document.getElementById('pause-actions');
const pauseQuitActions = document.getElementById('pause-quit-actions');
const pauseSaveNotice = document.getElementById('pause-save-notice');
const pauseSaveError = document.getElementById('pause-save-error');
const btnResumeGame = document.getElementById('btn-resume-game');
const btnQuitGame = document.getElementById('btn-quit-game');
const btnPauseSave = document.getElementById('btn-pause-save');
const btnPauseDiscard = document.getElementById('btn-pause-discard');
const btnPauseBack = document.getElementById('btn-pause-back');
const healTipOverlay = document.getElementById('heal-tip-overlay');
const btnHealTipConfirm = document.getElementById('btn-heal-tip-confirm');
const levelClearOverlay = document.getElementById('level-clear');
const levelClearTitle = document.getElementById('level-clear-title');
const levelClearScore = document.getElementById('level-clear-score');
const levelClearPreview = document.getElementById('level-clear-preview');
const levelClearPreviewImage = document.getElementById('level-clear-preview-image');
const levelClearPreviewTitle = document.getElementById('level-clear-preview-title');
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
// Intro, sound and language do nothing over the skill intro, the result and
// pause cards or a store sheet, so the bar is not shown there (title-bar.js).
watchTitleBarDialogs({ bar: topBar });
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
// Central speedrun records. Web only, so the app bundle has no such section.
const speedrunBoard = document.getElementById('speedrun-board');
const speedrunBoardPersonal = document.getElementById('speedrun-board-personal');
const speedrunBoardRuns = document.getElementById('speedrun-board-runs');
const speedrunBoardLevelsWrap = document.getElementById('speedrun-board-levels-wrap');
const speedrunBoardLevels = document.getElementById('speedrun-board-levels');
const leaderboardYearFilter = document.getElementById('leaderboard-year-filter');
const leaderboardPersonalBest = document.getElementById('leaderboard-personal-best');
const scoreHistoryChart = document.getElementById('score-history-chart');
const leaderboardProfilePrompt = document.getElementById('leaderboard-profile-prompt');
const leaderboardCompleteProfile = document.getElementById('leaderboard-complete-profile');
const leaderboardSection = document.getElementById('leaderboard-section');
const personalDevelopment = document.getElementById('personal-development');
const personalBestList = document.getElementById('personal-best-list');
const personalScoreHistoryChart = document.getElementById('personal-score-history-chart');
const personalCompletedOverview = document.getElementById('personal-completed-overview');
const levelJumpRow = document.getElementById('level-jump-row');
const levelGrid = createLevelGrid({ doc: document, onSelect: onLevelGridSelect });
const practiceKindSelect = document.getElementById('practice-kind');
const practiceLevelSelect = document.getElementById('practice-level-select');
const practiceBadges = document.getElementById('practice-badges');
const practiceStatus = document.getElementById('practice-status');
const practiceLevelHint = document.getElementById('practice-level-hint');
const practicePanel = document.getElementById('practice-panel');
const btnStartPractice = document.getElementById('btn-start-practice');
const skillIntroOverlay = document.getElementById('skill-intro');
const skillIntroTitle = document.getElementById('skill-intro-title');
const skillIntroBody = document.getElementById('skill-intro-body');
const skillIntroExample = document.getElementById('skill-intro-example');
const btnSkillIntroContinue = document.getElementById('btn-skill-intro-continue');
const btnSkillIntroSkip = document.getElementById('btn-skill-intro-skip');
const musicVolumeInput = document.getElementById('music-volume');
const musicVolumeStatus = document.getElementById('music-volume-status');
const effectsVolumeInput = document.getElementById('effects-volume');
const hapticsToggle = document.getElementById('haptics-toggle');

const checkoutModal = document.getElementById('checkout-modal');
const closeCheckout = document.getElementById('close-checkout');
const checkoutForm = document.getElementById('checkout-form');
const checkoutAdultConfirm = document.getElementById('checkout-adult-confirm');
const checkoutTermsAccept = document.getElementById('checkout-terms-accept');
const checkoutImmediateAccessConfirm = document.getElementById('checkout-immediate-access-confirm');
const checkoutWithdrawalWaiverConfirm = document.getElementById('checkout-withdrawal-waiver-confirm');
const checkoutMessage = document.getElementById('checkout-message');

// Must match app/legal_texts.py's DECLARATIONS_VERSION exactly. The server
// is always authoritative (it rejects a stale/mismatched version with
// declarations_version_mismatch rather than trusting this client constant),
// so an out-of-sync value here only ever surfaces as a safe rejection
// asking the purchaser to reload, never as silently-accepted consent to
// unseen/outdated wording.
const CHECKOUT_DECLARATIONS_VERSION = 'checkout-declarations-v1-2026-10-16';

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
// Reached through globalThis because several tests eval single functions from
// this module in a bare VM: an undeclared module binding throws there, while an
// absent global is simply a no-op.
globalThis.ffmScreenFx = createScreenFx({
  playfield: document.getElementById('playfield'),
  effects: createEffectTable(),
  reducedMotion: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
});
// Weather has a layer of its own, pinned to the playfield: rain and the storm
// dim must never wash across the answer row, and the scene-sized canvas is
// cheaper to clear and composite than a viewport-sized one. It sits one step
// under the gameplay layer so a spell cast during a storm still reads on top,
// and it has no bloom — rain does not need the extra blur passes.
globalThis.ffmStormFx = createScreenFx({
  playfield: document.getElementById('playfield'),
  effects: createEffectTable(),
  confined: true,
  zIndex: FX_Z_INDEX - 1,
  id: 'storm-fx',
  bloom: false,
  reducedMotion: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
});
// The app shell serves bundled tracks from the WebView's own origin, so their
// media elements can share the effects gain path. The web build keeps its
// unverified status until a deployment is validated.
let deferredMusicVolume = null;
const audio = new AudioEngine({
  musicGainRouting: platform.isApp,
  onMusicVolumeReady: () => flushDeferredMusicVolume(),
  onMusicVolumeUnavailable: () => audioPreferenceStatus(),
});

// Haptics: one facade for the session. It is published on globalThis because
// several tests evaluate single functions from this module in a bare VM where
// a module binding would be undeclared. The device driver resolves
// asynchronously (the app plugin may not be bundled), so the delegate starts
// absent and is swapped in place once resolveVibrationSource settles; until
// then every event is the silent no-op.
let vibrationDriver = null;
const haptics = createHaptics({
  vibrate: pattern => vibrationDriver?.(pattern),
  reducedMotion: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
});
globalThis.ffmHaptics = haptics;
resolveVibrationSource()
  .then(({ vibrate }) => { vibrationDriver = vibrate; })
  .catch(() => { vibrationDriver = noopVibration; });

function audioPreferenceStatus() {
  if (musicVolumeStatus) {
    const capability = audio.musicVolumeCapability;
    musicVolumeStatus.textContent = t(capability.supported
      ? 'audio.musicVolumeReady' : 'audio.musicVolumeUnavailable');
    if (musicVolumeInput) {
      musicVolumeInput.disabled = !capability.supported;
      musicVolumeInput.value = String(audio.getMusicVolume());
    }
  }
  if (effectsVolumeInput) effectsVolumeInput.value = String(audio.getEffectsVolume());
  // The app-only top-bar control mirrors the same engine state and localized
  // capability explanation. `typeof` keeps the extracted-function tests that
  // run this helper outside main.js working without the overlay handle.
  if (typeof volumeControl !== 'undefined') volumeControl?.refresh();
}

function flushDeferredMusicVolume() {
  if (deferredMusicVolume !== null) {
    deferredMusicVolume = applyDeferredMusicVolume(audio, deferredMusicVolume);
    if (deferredMusicVolume === null && musicVolumeInput) {
      musicVolumeInput.value = String(audio.getMusicVolume());
    }
  }
  audioPreferenceStatus();
}

function persistAudioPreferences() {
  if (writeAudioPreferences(window.localStorage, audio)) {
    audioPreferenceStatus();
    return;
  }
  console.error('Unable to persist audio preferences');
  if (musicVolumeStatus) musicVolumeStatus.textContent = t('audio.preferencesSaveFailed');
}

function initializeAudioPreferences() {
  let saved = null;
  try {
    saved = readAudioPreferences(window.localStorage);
    deferredMusicVolume = applyAudioPreferences(audio, saved);
  } catch (error) {
    console.error('Unable to load audio preferences', error);
    if (musicVolumeStatus) musicVolumeStatus.textContent = t('audio.preferencesLoadFailed');
  }
  if (saved) {
    if (saved.effects !== null && effectsVolumeInput) {
      effectsVolumeInput.value = String(audio.getEffectsVolume());
    }
    if (saved.music !== null && musicVolumeInput && audio.musicVolumeCapability.supported) {
      musicVolumeInput.value = String(audio.getMusicVolume());
    }
  }
  audioPreferenceStatus();
}

function initializeHapticsPreferences() {
  applyVibrationPreferences(haptics, readVibrationPreferences(window.localStorage));
  if (hapticsToggle) hapticsToggle.checked = haptics.enabled;
}

effectsVolumeInput?.addEventListener('input', () => {
  try {
    audio.setEffectsVolume(Number(effectsVolumeInput.value));
    persistAudioPreferences();
  } catch (error) {
    console.error('Unable to change effects volume', error);
    if (musicVolumeStatus) musicVolumeStatus.textContent = t('audio.preferencesSaveFailed');
  }
});
musicVolumeInput?.addEventListener('input', () => {
  try {
    audio.setMusicVolume(Number(musicVolumeInput.value));
    deferredMusicVolume = null;
    persistAudioPreferences();
  } catch (error) {
    console.error('Unable to change music volume', error);
    audioPreferenceStatus();
  }
});
// A saved gain can arrive before the first track is routed; retry whenever the
// player opens the settings.
document.getElementById('audio-settings')?.addEventListener('toggle', (event) => {
  if (event.target.open) flushDeferredMusicVolume();
});
initializeAudioPreferences();
initializeHapticsPreferences();

hapticsToggle?.addEventListener('change', () => {
  haptics.setEnabled(hapticsToggle.checked);
  writeVibrationPreferences(window.localStorage, haptics.enabled);
});

// --- Entity state ---
let hero = new Hero();
const heroSkins = createHeroSkinManager();
async function applyActiveHeroSkin() {
  try {
    await heroSkins.apply(hero, await resolveActiveHeroId());
  } catch (error) {
    console.error('Unable to apply the hero skin', error);
  }
}
// Outside startLevel the skin is only swapped while no level is in play.
function refreshHeroSkin() {
  if (gameRunning || levelStarting) return;
  applyActiveHeroSkin();
}
let fiends = [];
let spawnQueue = [];
let requeuedFiends = [];
let activeFiend = null;

// The ground line of the level being played. It starts at the shipped default and
// is replaced by Renderer.groundY in startLevel(): the 60 level backgrounds paint
// their floor at different heights, and the hero, the fiends and every effect
// anchored to them have to follow the level's own line.
let groundY = GROUND_Y;

// Moves the hero (and any fiend already on screen) onto the level's ground line.
function applyLevelGround(y) {
  groundY = Number.isFinite(y) ? y : GROUND_Y;
  hero.y = groundY;
  for (const fiend of fiends) fiend.y = groundY;
}
// The pause between encounters: how long the stage stays empty after a fiend is
// killed or walks off. Four seconds read as dead air between problems; half a
// second keeps the run moving without stomping on the strike's animation.
const SPAWN_INTERVAL_SECONDS = 0.5;
let spawnInterval = SPAWN_INTERVAL_SECONDS;
let spawnTimer = 0;
let answerTimes = [];
let inputDisabled = false;
let pendingProblemActivation = null;
let gameRunning = false;
let paused = false;
let currentLevelIndex = 0;
// One ability runtime per run: created when a run starts, re-levelled on each
// level transition so cooldowns carry across levels, and ticked by gameLoop.
let abilityRuntime = null;
// Bonus inputs for the ability bar's readouts, rebuilt from the level ladder at
// every level start: the earned bonus totals plus the per-ability cooldown
// reduction each cooldown bonus named.
let levelBonusRuntime = null;
let levelBonusCooldowns = null;
// Earth-spike slow: the fiends currently slowed and how many upcoming spawns
// the active spike may still slow. Cleared whenever the slow ends.
let spikeSlowedFiends = new Set();
let spikeSpawnSlowLeft = 0;
// Bumped whenever the earth aura must stop, so a stale emitter callback from
// the previous cast cannot keep pulsing after the slow is gone.
let spikeAuraToken = 0;
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
// Ranged spells (fireball/lightning) leave the palm of the cast pose while the
// hero strikes in place at the base location, rather than lunging up to the
// fiend like a melee hit does. The origin is the release frame's hand anchor
// from hero-anim.js - the same point the palm glow is drawn at - expressed in
// world coordinates, so raising the hand in the art moves the launch point with
// it. The target stays at torso height, so the projectile flies into the body.
const SPELL_TARGET_Y_OFFSET = 60;

function spellLaunchPoint() {
  const [dx, dy] = hero.castHandAnchor();
  return { x: hero.x + dx, y: hero.y + getHeroGroundOffsetPx() + dy };
}
// Must match Fireball's `life` (in entities.js) in milliseconds, so the hit
// lands right as the sprite reaches the fiend instead of the instant it's cast.
// The hero sprite is 150-160px tall, so its visual centre sits roughly 78px
// above the ground line. Healing light is centred there rather than at the feet.
const HERO_CENTRE_ABOVE_GROUND = 78;

const FIREBALL_FLIGHT_MS = 1350;
let currentProfile = null;
let webScoreHistory = null;
let currentLeaderboard = null;
let currentPersonalDevelopment = null;
let pendingResetToken = null;
let lastBillingStatus = null;
let lastLevelClearNum = null;
let runProfileId = null;
let completedLevelSave = null;
let completionPending = false;
let profileUI = null;
let entitlementPanel = null;
let firstOpenNotice = null;
let activeTitlePage = 'play';
const PERSONAL_BEST_PAGE_SIZE = 3;
let leaderboardPage = 0;
let profileMutationPending = false;
let levelStarting = false;
let campaignWon = false;
let activeLocalPlayer = null;
let practiceRun = null;
let missedProblemsByLevel = new Map();
let missedProblemsOwner = null;
let practiceBadgeRetryButton = null;
let pendingSkillIntro = null;
let activeSkillIntro = null;

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
document.getElementById('input-zone').hidden = true;

function setAnswerInputVisible(visible) {
  const zone = document.getElementById('input-zone');
  if (zone) zone.hidden = !visible;
}

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

function formatTrendDate(value) {
  const timestamp = value ? new Date(value) : null;
  if (!timestamp || Number.isNaN(timestamp.getTime())) return '';
  return timestamp.toLocaleDateString(typeof getLocale === 'function' ? getLocale() : undefined,
    { day: 'numeric', month: 'short', year: '2-digit' });
}

function trendTimestamp(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? null : time;
}

// The summary states the best score of the whole series (the record the curve
// peaks at) and how many saved results the points stand for.
function trendSummary(history) {
  return {
    score: history.reduce((best, entry) => Math.max(best, entry.score), 0),
    count: history.reduce((sum, entry) => sum + (entry.results ?? 1), 0),
  };
}

function buildScoreHistorySvg(history, summaryKey = 'scoreHistory.highScore') {
  const width = 300;
  const height = 140;
  const left = 54;
  const right = 12;
  const top = 14;
  const bottom = 28;

  if (!history || history.length === 0) {
    return '';
  }

  const summary = trendSummary(history);
  const scores = history.map((entry) => entry.score);
  const maxScore = Math.max(1, ...scores);

  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  // Each result is plotted on the day it was achieved, so the horizontal
  // distance between dots reflects the real gap between results. Histories
  // without usable timestamps, or all within one instant, keep even spacing.
  const times = history.map((entry) => trendTimestamp(entry.achieved_at));
  const dated = times.every((time) => time !== null);
  const firstTime = dated ? Math.min(...times) : 0;
  const lastTime = dated ? Math.max(...times) : 0;
  const timeSpan = lastTime - firstTime;

  const xForIndex = (i) => {
    if (history.length === 1) return left + innerWidth / 2;
    if (!dated || timeSpan === 0) return left + (i / (history.length - 1)) * innerWidth;
    return left + ((times[i] - firstTime) / timeSpan) * innerWidth;
  };

  const firstLabel = dated && timeSpan > 0
    ? formatTrendDate(firstTime)
    : formatTrendDate(history[0].achieved_at) || '1';
  const lastLabel = dated && timeSpan > 0
    ? formatTrendDate(lastTime)
    : formatTrendDate(history.at(-1).achieved_at) || String(history.length);

  const points = history.map((entry, i) => {
    const x = xForIndex(i);
    const y = top + innerHeight - (entry.score / maxScore) * innerHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const circles = points.map((p) => {
    const [x, y] = p.split(',');
    return `<circle cx="${x}" cy="${y}" r="4" fill="#f3ce77" />`;
  }).join('');

  const polyline = history.length > 1
    ? `<polyline points="${points.join(' ')}" fill="none" stroke="#f3ce77" stroke-width="2" />`
    : '';

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="${t('scoreHistory.ariaLabel')}">` +
    `<title>${escHtml(t(summaryKey, summary))}</title>` +
    `<path d="M${left} ${top}V${height - bottom}H${width - right}" fill="none" stroke="#b5bcae" />` +
    `<g fill="#fff" font-size="12" font-family="system-ui, sans-serif">` +
    `<text x="${left - 6}" y="${top + 4}" text-anchor="end">${maxScore}</text>` +
    `<text x="${left - 6}" y="${height - bottom + 4}" text-anchor="end">0</text>` +
    `<text x="${history.length === 1 ? left + innerWidth / 2 : left}" y="${height - 7}"${history.length === 1 ? ' text-anchor="middle"' : ''}>${escHtml(firstLabel)}</text>` +
    (history.length > 1 ? `<text x="${width - right}" y="${height - 7}" text-anchor="end">${escHtml(lastLabel)}</text>` : '') +
    `</g>` +
    polyline + circles +
    `</svg>`;
}

function renderScoreHistory(historyResponse, container) {
  if (!container) return;
  // The app passes its locally built cumulative total-high-score series; the
  // web its submitted level scores, which it can only group per day.
  const history = historyResponse?.trend ?? dailyBestTrend(historyResponse?.history || []);
  const summaryKey = historyResponse?.trend ? 'scoreHistory.totalHighScore' : 'scoreHistory.highScore';
  if (history.length === 0) {
    container.style.display = '';
    container.innerHTML = `<p class="score-history-summary">${escHtml(t('scoreHistory.empty'))}</p>`;
    return;
  }
  container.innerHTML = buildScoreHistorySvg(history, summaryKey) +
    `<p class="score-history-summary">${escHtml(t(summaryKey, trendSummary(history)))}</p>` +
    (history.some((entry) => entry.unfinished === true)
      ? `<p class="score-history-summary">${escHtml(t('scoreHistory.unfinishedNote'))}</p>` : '');
  container.style.display = '';
}

function renderLevelJumpOptions(profile) {
  // The Levels page lists the campaign being played. Campaign II has its own 40 levels and
  // its own (device-local) progress; the account's scores are Campaign I levels only.
  if (isCampaign2Selected()) {
    renderCampaign2Levels();
    return;
  }
  const scores = profile && profile.scores ? profile.scores : [];
  const levels = [...new Set(scores.map((s) => s.level))].sort((a, b) => a - b);
  if (levels.length === 0) {
    levelJumpRow.style.display = 'none';
    levelGrid.render({ total: TOTAL_LEVELS, defaultLevel: 1, available: [] });
    document.getElementById('title-levels-btn').hidden = true;
    updateTitleStartingLevel();
    return;
  }
  document.getElementById('title-levels-btn').hidden = false;
  levelGrid.render({
    total: TOTAL_LEVELS,
    defaultLevel: 1,
    available: levels,
    labelFor: ({ level, state }) => t(state === 'default' ? 'levels.startFromOne'
      : state === 'locked' ? 'levels.locked' : 'levels.level', { level }),
  });
  levelJumpRow.style.display = '';
  updateTitleStartingLevel();
}

// The `typeof` keeps extracted-function tests (which run without main.js's globals) working.
function isCampaign2Selected() {
  return typeof selectedCampaign !== 'undefined' && selectedCampaign === 2;
}

// Campaign II's Levels page, on the web and in the app: its own 40 levels, the next one to
// play as the default tile, the cleared ones to replay, and every level for the "unlocked"
// test profile (test-profile.js). It used to fall through to Campaign I's 60-level grid,
// whose pick the Campaign II start then ignored.
function renderCampaign2Levels({ resetSelection = false } = {}) {
  const progress = campaign2Progress().progress();
  if (resetSelection) levelGrid.value = '';
  levelGrid.render({
    total: TOTAL_LEVELS_2,
    defaultLevel: progress.nextLevel ?? 1,
    available: levelAvailability({
      testProfile: isLevelTestProfile({
        isApp: platform.isApp,
        profileName: activeLocalPlayer?.name,
        premiumAccess,
      }),
      cleared: progress.cleared,
      total: TOTAL_LEVELS_2,
    }),
    labelFor: ({ level, state }) => t(state === 'locked' ? 'levels.locked'
      : state === 'default' && !progress.complete ? 'campaign.continueAt' : 'campaign.replay', { level }),
  });
  levelJumpRow.style.display = '';
  document.getElementById('title-levels-btn').hidden = false;
  updateTitleStartingLevel();
}

function updateTitleStartingLevel(nextLevel = 1, continuationLabel = null, clearedLevels = null) {
  if (isCampaign2Selected()) {
    const progress = campaign2Progress().progress();
    if (!levelGrid.value) {
      const next = progress.nextLevel;
      titleLevelNumerals.updateLevelSelection({ level: next ?? TOTAL_LEVELS_2, mode: 'continuation' });
      const line = document.getElementById('continue-level');
      if (line) line.textContent = next ? t('campaign2.continueAt', { level: next }) : t('campaign2.complete');
      return;
    }
    // A level picked on Campaign II's Levels page: the title names it like a Campaign I pick.
    clearedLevels = progress.cleared;
  }
  const level = Number(levelGrid.value) || nextLevel;
  const mode = levelGrid.value ? 'replay' : 'continuation';
  titleLevelNumerals.updateLevelSelection({ level, mode });
  const continuation = document.getElementById('continue-level');
  // A selected level the player has not cleared is not a replay: the "unlocked"
  // test profile can start anywhere, and calling that a replay would be wrong.
  const replaying = !clearedLevels || clearedLevels.includes(level);
  if (continuation) continuation.textContent = platform.isApp
    ? (mode === 'replay' ? t(replaying ? 'campaign.replay' : 'campaign.startAt', { level })
      : continuationLabel ?? t('campaign.continueAt', { level }))
    : t('title.levelNumerals', { level });
}

function renderLeaderboard(entries) {
  const pages = Math.max(1, Math.ceil((entries?.length ?? 0) / PERSONAL_BEST_PAGE_SIZE));
  leaderboardPage = Math.min(leaderboardPage, pages - 1);
  document.getElementById('leaderboard-prev').disabled = leaderboardPage === 0;
  document.getElementById('leaderboard-next').disabled = leaderboardPage >= pages - 1;
  document.getElementById('leaderboard-page').textContent = t('common.page', { page: leaderboardPage + 1, pages });
  if (!entries || entries.length === 0) {
    leaderboardList.innerHTML = `<li>${t('leaderboard.empty')}</li>`;
    return;
  }

  const currentUser = platform.username;
  leaderboardList.innerHTML = entries.slice(
    leaderboardPage * PERSONAL_BEST_PAGE_SIZE, (leaderboardPage + 1) * PERSONAL_BEST_PAGE_SIZE,
  ).map((entry) => {
    const isCurrent = currentUser && entry.username === currentUser;
    const bucket = leaderboardBucketLabel(entry.first_grade_year);
    return `<li class="${isCurrent ? 'current-user' : ''}">#${entry.rank} ${escHtml(entry.username)} — ${escHtml(entry.high_score)} (${escHtml(bucket)})</li>`;
  }).join('');
}

/**
 * The speedrun block of the ranking page: the player's central best run, the
 * overall fastest finished runs, and the fastest single level anyone has run.
 *
 * Web only. The app keeps device records (see speedrun.js), so the markup is
 * dropped from the app bundle and this returns before touching the DOM.
 */
async function refreshSpeedrunBoard() {
  if (!speedrunBoard || !platform.hasLeaderboard) {
    if (speedrunBoard) speedrunBoard.style.display = 'none';
    return;
  }
  speedrunBoard.style.display = '';
  speedrunBoardPersonal.textContent = t('speedrun.boardLoading');
  speedrunBoardRuns.innerHTML = '';
  speedrunBoardLevelsWrap.style.display = 'none';

  let board = null;
  try {
    board = await platform.getSpeedrunLeaderboard();
  } catch {
    speedrunBoardPersonal.textContent = t('speedrun.boardFailed');
    return;
  }

  let central = null;
  if (platform.isLoggedIn) {
    try {
      central = await platform.getSpeedrunRecords();
    } catch {
      central = null;
    }
  }

  const centralBest = central?.best_run?.total_ms;
  const deviceBest = speedrunRecords.bestRun?.totalMs;
  if (typeof centralBest === 'number') {
    speedrunBoardPersonal.textContent = t('speedrun.boardPersonal', { time: formatRunTime(centralBest) });
  } else if (!platform.isLoggedIn) {
    speedrunBoardPersonal.textContent = t('speedrun.boardSignIn');
  } else {
    speedrunBoardPersonal.textContent = t('speedrun.boardNoRun');
  }
  if (typeof deviceBest === 'number' && deviceBest !== centralBest) {
    speedrunBoardPersonal.textContent += ' · ' + t('speedrun.boardDevice', { time: formatRunTime(deviceBest) });
  }

  const runs = Array.isArray(board?.entries) ? board.entries : [];
  speedrunBoardRuns.innerHTML = runs.length === 0
    ? `<li>${escHtml(t('speedrun.boardEmpty'))}</li>`
    : runs.map((entry) => {
      const isCurrent = platform.username && entry.username === platform.username;
      return `<li class="${isCurrent ? 'current-user' : ''}">#${escHtml(entry.rank)} ${escHtml(entry.username)} — ${escHtml(formatRunTime(entry.total_ms))}</li>`;
    }).join('');

  const levels = Array.isArray(board?.levels) ? board.levels : [];
  speedrunBoardLevelsWrap.style.display = levels.length === 0 ? 'none' : '';
  speedrunBoardLevels.innerHTML = levels.map((entry) => (
    `<li><span>${escHtml(t('speedrun.boardLevel', { level: entry.level }))}</span>`
    + `<strong>${escHtml(formatRunTime(entry.ms))}</strong>`
    + `<em>${escHtml(entry.username || '')}</em></li>`
  )).join('');
}

/**
 * Report a finished continuous run to the server. Fire-and-forget: a failed
 * report costs the player nothing (the device record already has it) and must
 * never interrupt the level-clear screen.
 */
function reportSpeedrunRun(totalMs, splits) {
  if (platform.isApp || !platform.isLoggedIn || typeof platform.postSpeedrunRun !== 'function') return;
  platform.postSpeedrunRun({ total_ms: Math.round(totalMs), splits })
    .then(() => refreshSpeedrunBoard())
    .catch((error) => console.error('Unable to report the speedrun', error));
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

function renderPersonalDevelopment(state) {
  if (!personalDevelopment) return;
  const best = state?.best || [];
  const completed = state?.completed || [];

  if (best.length === 0) {
    personalBestList.innerHTML = `<li>${t('personalDevelopment.noProgress')}</li>`;
  } else {
    // Every level with a score is listed in one scrolling list (no paging).
    personalBestList.innerHTML = best
      .map((entry) => `<li data-level="${Number(entry.level)}">${t(entry.unfinished === true
        ? 'personalDevelopment.perLevelBestUnfinished'
        : 'personalDevelopment.perLevelBest', {
        level: entry.level,
        score: entry.score,
      })}</li>`)
      .join('');
  }

  // The app has the player's per-level bests, so the chart plots the total high
  // score (their sum) after every saved result instead of a single level score.
  renderScoreHistory({ trend: highScoreTrend(state?.history || [], best) }, personalScoreHistoryChart);

  personalCompletedOverview.textContent = t('personalDevelopment.completed', {
    completed: completed.length,
    total: Math.max(TOTAL_LEVELS, completed.length),
  });
  scrollPersonalBestToHighest();
}

// Opens the list at the highest level that has a score (the top when none).
// A hidden page has no layout, so this also runs when the Practice page shows.
function scrollPersonalBestToHighest() {
  if (!personalBestList || personalBestList.closest('[hidden]')) return;
  scrollToHighestLevel(personalBestList);
}

function renderLocalCampaign(completed, { resetSelection = false } = {}) {
  const selectorLabel = document.getElementById('level-jump-label');
  selectorLabel.dataset.i18n = 'campaign.chooseLevel';
  selectorLabel.textContent = t('campaign.chooseLevel');
  // `completed` is Campaign I progress; Campaign II keeps its own.
  if (isCampaign2Selected()) {
    renderCampaign2Levels({ resetSelection });
    return;
  }
  const progress = getCampaignProgress(completed);
  if (resetSelection) levelGrid.value = '';
  const label = progress.complete ? t('campaign.complete') : t('campaign.continueAt', { level: progress.nextLevel });
  levelGrid.render({
    total: TOTAL_LEVELS,
    defaultLevel: progress.nextLevel ?? 1,
    available: levelAvailability({
      testProfile: isLevelTestProfile({
        isApp: platform.isApp,
        profileName: activeLocalPlayer?.name,
        premiumAccess,
      }),
      cleared: progress.cleared,
      total: TOTAL_LEVELS,
    }),
    labelFor: ({ level, state }) => t(state === 'locked' ? 'levels.locked'
      : state === 'default' && !progress.complete ? 'campaign.continueAt' : 'campaign.replay', { level }),
  });
  levelJumpRow.style.display = '';
  document.getElementById('title-levels-btn').hidden = false;
  updateTitleStartingLevel(progress.nextLevel ?? 1, label, progress.cleared);
}

function renderPlayerIdentity() {
  const name = platform.isApp ? activeLocalPlayer?.name : platform.username;
  for (const id of ['playing-as', 'progress-player-name', 'pause-player-name']) {
    const element = document.getElementById(id);
    if (!element) continue;
    element.textContent = name || '';
    element.title = name || '';
    element.hidden = !name;
    for (const selector of ['.playing-as-row', '.player-identity']) {
      const row = element.closest(selector);
      if (row) row.hidden = !name || !platform.isApp;
    }
  }
  document.getElementById('switch-player-btn')?.toggleAttribute('hidden', !platform.isApp);
  // typeof: the extracted-function tests run this without the portrait helper.
  if (typeof paintHeroIdentity === 'function') paintHeroIdentity();
}

// Paints the gated hero's portrait into the running channel's rows only: the
// app identity rows, or the web account greeting for a logged-in player. The
// sequence guards against an older async choice landing after a newer one.
// The title screen's player badge: the hero portrait beside the level numerals; a tap opens Players.
const titlePlayerBadge = document.getElementById('title-player-badge');
titlePlayerBadge?.addEventListener('click', () => {
  // The app has the Players page; the web has no player dialogue, so the badge opens the hero picker.
  if (platform.isApp) { document.getElementById('title-family-btn')?.click(); return; }
  void resolveActiveHeroId().then(hero => openHeroPicker({ hero }));
});
function paintTitlePlayerBadge(hero) {
  if (!titlePlayerBadge) return;
  renderHeroIdentity(titlePlayerBadge, hero, { t });
  titlePlayerBadge.hidden = !hero;
  const name = platform.isApp ? activeLocalPlayer?.name : platform.username;
  if (hero && name) titlePlayerBadge.setAttribute('aria-label', name);
}
let heroIdentitySeq = 0;
async function paintHeroIdentity() {
  const seq = ++heroIdentitySeq;
  const heroId = await resolveActiveHeroId();
  if (seq !== heroIdentitySeq) return;
  const hero = resolveHero(heroId, { entitled: true });
  paintTitlePlayerBadge((platform.isApp ? Boolean(activeLocalPlayer?.name) : platform.isLoggedIn) ? hero : null);
  if (platform.isApp) {
    for (const id of ['playing-as', 'progress-player-name', 'pause-player-name']) {
      const row = document.getElementById(id)?.parentElement;
      if (row) renderHeroIdentity(row, activeLocalPlayer?.name ? hero : null, { t });
    }
  } else if (splashGreeting) {
    renderHeroIdentity(splashGreeting, platform.isLoggedIn && splashGreeting.textContent ? hero : null, { t });
  }
}

function practiceOwnerId() {
  return platform.isApp ? platform.localProfiles.getActiveProfile()?.id ?? null
    : platform.username || 'guest';
}

function clearMissedProblemsForOwner(ownerId = practiceOwnerId()) {
  missedProblemsByLevel.clear();
  missedProblemsOwner = ownerId;
}

function rememberMissedProblem(problem, levelIndex) {
  if (!problem || practiceRun || state.isShapesMode || problem.campaign === 2) return;
  const ownerId = runProfileId ?? practiceOwnerId();
  if (missedProblemsOwner !== ownerId) clearMissedProblemsForOwner(ownerId);
  const level = levelIndex + 1;
  const missed = missedProblemsByLevel.get(level) ?? [];
  if (!missed.includes(problem) && missed.length < 5) missed.push(problem);
  missedProblemsByLevel.set(level, missed);
}

function getTargetedProblems(level) {
  const ownerId = practiceOwnerId();
  if (missedProblemsOwner !== ownerId) clearMissedProblemsForOwner(ownerId);
  return collectTargetedProblems(missedProblemsByLevel.get(level) ?? []);
}

function showPracticeStatus(message, isError = false) {
  if (!practiceStatus) return;
  practiceStatus.textContent = message;
  practiceStatus.classList.toggle('error-msg', isError);
}

function setPracticeLevelOptions() {
  if (!practiceLevelSelect) return;
  practiceLevelSelect.innerHTML = Array.from({ length: TOTAL_LEVELS }, (_, index) =>
    `<option value="${index + 1}">${escHtml(t('levels.level', { level: index + 1 }))}</option>`).join('');
}

// The training tab explains the selected level in one short line. The summary
// is read from the same authorized level config the session runs on, so it can
// never drift from the curriculum; a level the player may not open reports that
// instead of guessing. Results are cached per level and dropped whenever the
// disclosure is opened again, which is the moment right after a purchase.
const OPERATION_KEYS = Object.freeze({
  '+': 'practice.operation.add',
  '-': 'practice.operation.subtract',
  '*': 'practice.operation.multiply',
  '/': 'practice.operation.divide',
});
const OPERATION_ORDER = Object.freeze(['+', '-', '*', '/']);
const levelSummaries = new Map();
let levelHintGeneration = 0;

function resetLevelSummaries() {
  levelSummaries.clear();
  updatePracticeLevelHint();
}

/** Operation words in curriculum order: "plus", "plus and minus", "plus, minus and times". */
function levelOperationsLabel(operations = []) {
  const listed = Array.isArray(operations) ? operations : [];
  const words = OPERATION_ORDER.filter((operation) => listed.includes(operation))
    .map((operation) => t(OPERATION_KEYS[operation]));
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(t('practice.listSeparator'))}${t('practice.listAnd')}${words[words.length - 1]}`;
}

async function loadLevelSummary(level) {
  if (levelSummaries.has(level)) return levelSummaries.get(level);
  let summary = null;
  try {
    const config = await platform.getAuthorizedLevelConfig(level - 1);
    const maxResult = Number(config?.maxResult);
    if (Array.isArray(config?.operations) && Number.isFinite(maxResult)) {
      summary = { operations: config.operations, maxResult };
    }
  } catch {
    summary = null;
  }
  levelSummaries.set(level, summary);
  return summary;
}

async function updatePracticeLevelHint() {
  if (!practiceLevelHint) return;
  const generation = ++levelHintGeneration;
  if (practiceKindSelect?.value === 'shapes') {
    practiceLevelHint.textContent = t('practice.levelHintShapes');
    return;
  }
  practiceLevelHint.textContent = '';
  const level = Number(practiceLevelSelect?.value || 1);
  if (!Number.isInteger(level) || level < 1 || level > TOTAL_LEVELS) return;
  const summary = await loadLevelSummary(level);
  if (generation !== levelHintGeneration) return;
  const operations = summary ? levelOperationsLabel(summary.operations) : '';
  if (!summary || !operations) {
    // A locked level has no authorized config to describe. Say so instead of
    // leaving the line empty, which would read like a broken hint.
    practiceLevelHint.textContent = t('practice.levelHintLocked');
    return;
  }
  practiceLevelHint.textContent = t('practice.levelHint', {
    level,
    operations,
    maxResult: summary.maxResult,
    choices: getArithmeticOptionCount(level),
  });
}

async function refreshPracticeBadges() {
  if (!practiceBadges) return;
  if (!platform.isApp) {
    practiceBadges.textContent = '';
    return;
  }
  try {
    await ensureLocalProfiles();
    const profileId = platform.localProfiles.getActiveProfile().id;
    const result = await platform.localProfiles.getPracticeBadges(profileId);
    if (profileId !== platform.localProfiles.getActiveProfile().id) return;
    const badges = Array.isArray(result?.badges) ? result.badges : [];
    practiceBadges.textContent = badges.map(id => t(`practice.badge.${id}`)).join(' · ');
  } catch (error) {
    console.error('Unable to load practice badges', error);
    showPracticeStatus(t('practice.badgesLoadFailed'), true);
  }
}

async function startPracticeSession(kind = practiceKindSelect?.value, sourceLevel = Number(practiceLevelSelect?.value || 1), { endless = false } = {}) {
  if (levelStarting || profileMutationPending || pendingSkillIntro) return;
  if (!['targeted', 'short', 'assisted', 'elite', 'recovery', 'shapes'].includes(kind)) {
    showPracticeStatus(t('practice.invalidMode'), true);
    return;
  }
  levelStarting = true;
  if (btnStartPractice) btnStartPractice.disabled = true;
  try {
    if (!Number.isInteger(sourceLevel) || sourceLevel < 1 || sourceLevel > TOTAL_LEVELS) {
      throw new RangeError('Choose a practice level from 1 to 60');
    }
    if (platform.isApp) {
      await ensureLocalProfiles();
      await profileUI?.whenIdle();
      runProfileId = platform.localProfiles.getActiveProfile().id;
    } else {
      runProfileId = null;
    }
    const targetProblems = kind === 'targeted' ? getTargetedProblems(sourceLevel) : [];
    if (kind === 'targeted' && targetProblems.length === 0) {
      showPracticeStatus(t('practice.noMissedProblems', { level: sourceLevel }), true);
      return;
    }
    practiceRun = {
      kind,
      endless: kind === 'shapes' && endless,
      sourceLevel,
      sessionId: createCompletionId(),
      session: createPracticeSession({ kind, problems: targetProblems }),
      targetProblems,
      recovery: createEarnedRecovery(),
      operations: new Set(),
      savedBadges: false,
      badgeSavePending: false,
    };
    state.isShapesMode = kind === 'shapes';
    state.score = 0;
    state.combo = 0;
    const practiceDifficulty = {
      easy: { timer: 15, hearts: 7 },
      medium: { timer: 10, hearts: 5 },
      hard: { timer: 5, hearts: 3 },
    }[state.difficulty] ?? { timer: 10, hearts: 5 };
    state.timerMax = practiceDifficulty.timer;
    state.timerRemaining = state.timerMax;
    state.maxHearts = practiceDifficulty.hearts;
    state.hearts = state.maxHearts;
    healTipShown = true;
    if (state.difficulty === 'shapes') state.difficulty = 'medium';
    if (kind === 'shapes') {
      state.timerMax = 25;
      state.timerRemaining = 25;
      state.maxHearts = 9;
      state.hearts = state.maxHearts;
    }
    showPracticeStatus('');
    if (typeof beginAbilityRun === 'function') beginAbilityRun(sourceLevel);
    await startLevel(sourceLevel - 1);
  } catch (error) {
    console.error('Unable to start practice', error);
    practiceRun = null;
    state.isShapesMode = false;
    showPracticeStatus(t(error?.code === 'invalid_practice' ? 'practice.noMissedProblems' : 'practice.startFailed', {
      level: sourceLevel,
    }), true);
  } finally {
    levelStarting = false;
    if (btnStartPractice) btnStartPractice.disabled = false;
  }
}

function showSkillIntro(intro, levelIndex, cfg, baselineScore) {
  if (!skillIntroOverlay || !skillIntroBody || !btnSkillIntroContinue || !btnSkillIntroSkip) {
    finishStartLevel(levelIndex, cfg, baselineScore);
    return;
  }
  activeSkillIntro = intro;
  renderSkillIntro();
  skillIntroOverlay.style.display = 'flex';
  pendingSkillIntro = () => {
    pendingSkillIntro = null;
    activeSkillIntro = null;
    skillIntroOverlay.style.display = 'none';
    finishStartLevel(levelIndex, cfg, baselineScore);
    clearPendingRecord();
    setAccountModalVisible(false);
  };
}

function renderSkillIntro() {
  if (!activeSkillIntro) return;
  const [explanation, example] = activeSkillIntro.stages;
  if (activeSkillIntro.localizationKey?.startsWith('c2Intro.')) {
    // Campaign 2: texts live in campaign2/intro-text.js, the example is laid out as stacked maths.
    const text = key => INTRO_TEXT_2[key]?.[getLocale()] ?? INTRO_TEXT_2[key]?.en ?? '';
    if (skillIntroTitle) skillIntroTitle.textContent = t('practice.intro.title', { level: activeSkillIntro.level });
    if (skillIntroBody) skillIntroBody.textContent = text(explanation.localizationKey);
    if (skillIntroExample) {
      skillIntroExample.innerHTML = `<div class="m2-intro-math">${expressionHtml(example.tokens)}</div>`;
      const note = document.createElement('p');
      note.textContent = text(example.localizationKey);
      skillIntroExample.appendChild(note);
    }
    return;
  }
  const values = {
    ...explanation.values,
    a: activeSkillIntro.exampleProblem.a,
    b: activeSkillIntro.exampleProblem.b,
    answer: activeSkillIntro.exampleProblem.answer,
  };
  if (skillIntroTitle) skillIntroTitle.textContent = t('practice.intro.title', { level: activeSkillIntro.level });
  if (skillIntroBody) skillIntroBody.textContent = t(explanation.localizationKey, values);
  if (skillIntroExample) skillIntroExample.textContent = t(example.localizationKey, values);
}

btnSkillIntroContinue?.addEventListener('click', () => pendingSkillIntro?.());
btnSkillIntroSkip?.addEventListener('click', () => pendingSkillIntro?.());
btnStartPractice?.addEventListener('click', () => startPracticeSession());
function renderPracticeDescription() {
  const description = document.getElementById('practice-description');
  if (!description || !practiceKindSelect) return;
  const key = `practice.description.${practiceKindSelect.value}`;
  description.dataset.i18n = key;
  description.textContent = t(key);
}
practiceKindSelect?.addEventListener('change', () => {
  showPracticeStatus('');
  renderPracticeDescription();
  updatePracticeLevelHint();
});
practiceLevelSelect?.addEventListener('change', () => {
  showPracticeStatus('');
  updatePracticeLevelHint();
});
document.getElementById('btn-open-practice')?.addEventListener('click', () => {
  if (!practicePanel) return;
  practicePanel.open = true;
  practicePanel.querySelector('#practice-kind')?.focus?.({ preventScroll: true });
});
practicePanel?.addEventListener('toggle', () => {
  if (practicePanel.open) resetLevelSummaries();
});
/**
 * The practice panel is a submenu of the Training tab, so it needs its own way
 * back: the button closes it and returns focus to the summary that opened it.
 * Escape does the same for keyboard and switch users.
 */
function closePracticePanel() {
  if (!practicePanel?.open) return false;
  practicePanel.open = false;
  document.getElementById('btn-open-practice')?.focus?.();
  return true;
}
document.getElementById('btn-close-practice')?.addEventListener('click', closePracticePanel);
practicePanel?.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !practicePanel.open) return;
  event.preventDefault?.();
  event.stopPropagation?.();
  closePracticePanel();
});
setPracticeLevelOptions();
updatePracticeLevelHint();

async function refreshPersonalDevelopment() {
  const profileId = platform.isApp ? platform.localProfiles.getActiveProfile().id : null;
  try {
    const [best, history, completed] = await Promise.all([
      platform.getBestScores(profileId), platform.getScoreHistory(profileId), platform.getCompletedLevels(profileId),
    ]);
    if (platform.isApp && profileId !== platform.localProfiles.getActiveProfile().id) return;
    currentPersonalDevelopment = {
      best: best.best, history: history.history, completed: completed.completed,
    };
    renderPersonalDevelopment(currentPersonalDevelopment);
    renderLocalCampaign(currentPersonalDevelopment.completed);
    activeLocalPlayer = platform.localProfiles.getActiveProfile();
    renderPlayerIdentity();
    showProgressError('');
  } catch (error) {
    if (platform.isApp && profileId !== platform.localProfiles.getActiveProfile().id) return;
    console.error('Unable to load local progress', error);
    showProgressError(t('personalDevelopment.loadFailed'));
  }
}

function showProgressError(message) {
  const error = document.getElementById('personal-development-error');
  if (error) error.textContent = message;
}

// The web build has no local progress, so the 📈 history page shows the
// account's score history and high score instead of staying blank.
function renderWebHistoryPage() {
  if (platform.isApp) return;
  if (!platform.isLoggedIn) {
    personalScoreHistoryChart.innerHTML = `<p class="score-history-summary">${escHtml(t('scoreHistory.loginRequired'))}</p>`;
    personalScoreHistoryChart.style.display = '';
    renderPersonalBest(null, personalCompletedOverview);
    return;
  }
  renderScoreHistory(webScoreHistory, personalScoreHistoryChart);
  renderPersonalBest(currentProfile, personalCompletedOverview);
}

async function refreshProfileAndLeaderboard() {
  if (await platform.getAccountAvailability() === 'none') {
    leaderboardSection.style.display = 'none';
    personalDevelopment.style.display = '';
    await refreshPersonalDevelopment();
    return;
  }
  leaderboardSection.style.display = '';
  personalDevelopment.style.display = 'none';

  try {
    currentLeaderboard = await platform.getLeaderboard();
    syncLeaderboardFilterOptions(currentLeaderboard.grouped_entries || []);
    renderLeaderboard(entriesForSelectedFilter(currentLeaderboard));
  } catch {
    renderLeaderboard([]);
  }

  refreshSpeedrunBoard();

  if (!platform.isLoggedIn) {
    currentProfile = null;
    renderPersonalBest(null, leaderboardPersonalBest);
    renderScoreHistory(null, scoreHistoryChart);
    webScoreHistory = null;
    renderWebHistoryPage();
    renderLevelJumpOptions(null);
    leaderboardProfilePrompt.style.display = 'none';
    leaderboardCompleteProfile.style.display = 'none';
    return;
  }

  try {
    currentProfile = await platform.getProfile();
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
    webScoreHistory = await platform.getScoreHistory();
    renderScoreHistory(webScoreHistory, scoreHistoryChart);
  } catch {
    webScoreHistory = null;
    renderScoreHistory(null, scoreHistoryChart);
  }
  renderWebHistoryPage();
}

// --- Splash login button ---
function updateHUDLogoutVisibility() {
  if (!logoutBtn) return;
  const splashVisible = diffSelect.style.display !== 'none';
  if (splashVisible || !platform.username) {
    logoutBtn.style.display = 'none';
  } else {
    logoutBtn.style.display = '';
  }
}

function applyAuthUIState() {
  // typeof: the extracted-function tests run this without the skin helpers.
  if (typeof refreshHeroSkin === 'function') refreshHeroSkin();
  if (platform.isApp) return;
  renderPlayerIdentity();
  // typeof: as above; the web player is the account, so a login or logout reloads the choice.
  if (typeof loadCampaignSelection === 'function') loadCampaignSelection();
  if (platform.username) {
    loginBtn.style.display = 'none';
    userDisplay.textContent = platform.username;
    userDisplay.style.display = '';
    splashLoginBtn.textContent = t('splash.logout');
    splashGreeting.textContent = t('splash.greeting', { username: platform.username });
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

if (!platform.isApp) splashLoginBtn.addEventListener('click', () => {
  if (platform.username) {
    clearPremiumSession();
    platform.logout().then(() => {
      applyAuthUIState();
    });
  } else {
    showAuthForm(loginForm);
    setAuthModalVisible(true);
  }
});

// --- Campaign switch (Campaign I: Arithmetic <-> Campaign II: Genius) ---
// Campaign II is independent of Campaign I: there is no level to beat first and no need for
// the full unlock, so the switch is always there for the active player (campaign2/access.js).
// It switches between the campaigns, and while Campaign II is locked it manages the unlock:
// the app's in-app purchase, or on the web the subscription (login / billing).
function campaign2PlayerId() {
  return platform.isApp
    ? (platform.localProfiles?.getActiveProfile?.().id ?? 'app')
    : (platform.username || 'web');
}
// The campaign choice is per player (campaign2/selection.js): reload it whenever the
// player changes, and store it whenever the switch changes it.
function campaignSelection() {
  return createCampaignSelection({ playerId: campaign2PlayerId() });
}
function loadCampaignSelection() {
  selectedCampaign = campaignSelection().get();
  renderCampaignSwitch();
}
function chooseCampaign(campaign) {
  const next = campaign === 2 ? 2 : 1;
  // A level picked in one campaign means nothing in the other (level 47 has no Campaign II
  // twin): a switch starts the new campaign from its own continuation.
  if (next !== selectedCampaign) levelGrid.value = '';
  selectedCampaign = next;
  campaignSelection().set(selectedCampaign);
}
// Re-render the Levels page for the campaign now selected (60 levels or 40).
function refreshLevelGrid() {
  if (platform.isApp) {
    if (currentPersonalDevelopment) renderLocalCampaign(currentPersonalDevelopment.completed);
    else updateTitleStartingLevel();
  } else {
    renderLevelJumpOptions(currentProfile);
  }
}
// The switch lives with the player it belongs to. The app keeps it in the player dialog (the
// Players page), between the player list and the purchase panel; the web keeps it in the
// account profile, since the web player is the account. The title only shows the Campaign II
// picture, and a tap on it leads to wherever the switch is.
{
  const switchWrap = document.getElementById('genius-campaign');
  const emblem = document.getElementById('campaign-emblem');
  if (platform.isApp) {
    const familyPage = document.getElementById('local-profiles');
    if (familyPage && switchWrap) familyPage.insertBefore(switchWrap, document.getElementById('entitlement-root'));
  } else {
    const profilePanel = document.getElementById('account-profile-panel');
    if (profilePanel && switchWrap) profilePanel.insertBefore(switchWrap, document.getElementById('account-hero-picker'));
    if (emblem) {
      // No Players page on the web: the picture opens the profile instead.
      emblem.removeAttribute('data-title-target');
      emblem.dataset.i18nAriaLabel = 'campaign.emblem.web';
      emblem.setAttribute('aria-label', t('campaign.emblem.web'));
      emblem.addEventListener('click', () => {
        if (!platform.isLoggedIn) return;
        showAccountTab(tabAccountProfile, accountProfilePanel);
        setAccountModalVisible(true);
      });
    }
  }
}
async function renderCampaignSwitch() {
  const wrap = document.getElementById('genius-campaign');
  const button = document.getElementById('genius-campaign-btn');
  if (!wrap || !button) return;
  const access = await getCampaign2AccessNow();
  const visible = campaignSwitchVisible({
    platform: platform.isApp ? 'app' : 'web',
    loggedIn: Boolean(platform.isLoggedIn),
  });
  if (!visible) {
    wrap.hidden = true;
    if (selectedCampaign === 2) chooseCampaign(1);   // a stale selection never hides the way back
  } else {
    wrap.hidden = false;
    const inTwo = selectedCampaign === 2;
    const set = (id, key) => {
      const el = document.getElementById(id);
      if (el) { el.dataset.i18n = key; el.textContent = t(key); }
    };
    set('genius-eyebrow', inTwo ? 'campaign.switch.eyebrow2' : 'campaign.switch.eyebrow1');
    set('genius-title', inTwo ? 'campaign.switch.title2' : 'campaign.switch.title1');
    set('genius-status', inTwo ? 'campaign.switch.toArithmetic' : access.granted ? 'campaign.switch.toGenius' : 'campaign.switch.unlock');
    button.setAttribute('aria-pressed', String(inTwo));
    button.dataset.campaign = String(selectedCampaign);
    // The dragon pair belongs to the campaign the button names: young for I, ancient for II.
    const dragon = campaignDragon(selectedCampaign);
    if (button.dataset.dragon !== dragon.kind) {
      button.dataset.dragon = dragon.kind;
      for (const side of ['left', 'right']) {
        const piece = button.querySelector(`.campaign-switch-dragon--${side}`);
        if (!piece) continue;
        piece.width = dragon.width;
        piece.height = dragon.height;
        piece.src = campaignDragonSrc(dragon.kind, side);
      }
    }
    const note = document.getElementById('campaign2-note');
    if (note) {
      note.hidden = access.granted || !inTwo;
      note.textContent = t(platform.isApp ? 'campaign2.note.app' : 'campaign2.note.web');
    }
  }
  // The title shows the Campaign II picture only to a player who chose it; the switch itself
  // is in the player dialog (app) or the profile (web).
  const emblem = document.getElementById('campaign-emblem');
  if (emblem) emblem.hidden = wrap.hidden || selectedCampaign !== 2;
  // The Levels page follows the campaign too, not only the title line.
  refreshLevelGrid();
}
document.getElementById('genius-campaign-btn')?.addEventListener('click', async () => {
  if (levelStarting || pendingSkillIntro) return;
  if (selectedCampaign === 2) {
    chooseCampaign(1);
  } else if ((await getCampaign2AccessNow()).granted) {
    chooseCampaign(2);
  } else if (platform.isApp) {
    openCampaign2Purchase();            // the in-app purchase
  } else if (platform.isLoggedIn) {
    openBillingPanel();                 // the subscription
  } else {
    showAuthForm(loginForm);            // log in (or register) first
    setAuthModalVisible(true);
  }
  renderCampaignSwitch();
});
// The app sells Campaign 2 as one more in-app product (see campaign2/access.js).
async function openCampaign2Purchase() {
  try {
    const { createPaywall } = await import('./paywall.js');   // the app bundle's own module
    await createPaywall({
      platform, locale: getLocale(), product: 'campaign2',
      // The Players page lists Campaign II too: reload it so it shows the purchase.
      onGranted: () => { renderCampaignSwitch(); entitlementPanel?.load(); },
    }).open();
  } catch (error) {
    console.error('Campaign 2 purchase failed', error);
  }
}

// --- Difficulty select ---
// Only the buttons that name a difficulty: the splash overlay also holds the
// Back buttons of the Practice submenu and the history page, and those share
// the `diff-btn` class. Matching them started a level (with NaN hearts, since
// they carry no data-hearts) instead of just navigating back.
document.querySelectorAll('#difficulty-select [data-difficulty]').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (profileMutationPending || levelStarting || pendingSkillIntro) return;
    if (btn.dataset.difficulty === 'shapes') {
      await startPracticeSession('shapes', 1, { endless: true });
      return;
    }
    levelStarting = true;
    try {
      if (platform.isApp) {
        await ensureLocalProfiles();
        await profileUI?.whenIdle();
      }
      practiceRun = null;
      state.isShapesMode = false;
      state.difficulty = btn.dataset.difficulty;
      state.timerMax = parseInt(btn.dataset.timer);
      state.baseTimerMax = state.timerMax;   // Campaign 2 stretches this per level
      state.timerRemaining = state.timerMax;
      state.maxHearts = parseInt(btn.dataset.hearts);
      state.hearts = state.maxHearts;
      healTipShown = false;
      const jumpValue = levelGrid.value;
      let targetLevel = jumpValue ? parseInt(jumpValue, 10) : 1;
      const campaign2Selected = typeof selectedCampaign !== 'undefined' && selectedCampaign === 2;
      if (campaign2Selected) {
        // Campaign 2 continues from its own device-local progress (or starts over once
        // complete), or starts the level picked on its Levels page: a cleared one, or any of
        // its 40 for the "unlocked" test profile, the same rule as Campaign I below.
        const progress2 = campaign2Progress().progress();
        if (jumpValue) {
          const levelTest = isLevelTestProfile({
            isApp: platform.isApp,
            profileName: activeLocalPlayer?.name,
            premiumAccess,
          });
          if (!(targetLevel >= 1 && targetLevel <= TOTAL_LEVELS_2)
            || (!progress2.cleared.includes(targetLevel) && !levelTest)) {
            throw new Error('Selected Campaign II level was not offered to this player');
          }
        } else {
          targetLevel = progress2.nextLevel ?? 1;
        }
      } else if (platform.isApp) {
        const profileId = platform.localProfiles.getActiveProfile().id;
        const { completed } = await platform.getCompletedLevels(profileId);
        const progress = getCampaignProgress(completed);
        // The Levels page offers a cleared level for replay — and, for the
        // "unlocked" test profile, every level (see test-profile.js). Refuse a
        // level this player was not offered, so replaying stays limited to
        // cleared levels without blocking the hatch.
        const levelTest = isLevelTestProfile({
          isApp: true,
          profileName: activeLocalPlayer?.name,
          premiumAccess,
        });
        if (jumpValue && !progress.cleared.includes(targetLevel) && !levelTest) {
          throw new Error('Selected replay level has not been completed by this player');
        }
        if (!jumpValue) targetLevel = progress.nextLevel ?? 1;
      }
      const targetIndex = targetLevel - 1;
      // Run start: fresh cooldowns for the selected campaign level. The
      // `typeof` keeps extracted-function tests (which run this block without
      // main.js) working, matching the volumeControl guard above.
      if (typeof beginAbilityRun === 'function') beginAbilityRun(targetLevel);   // Campaign 2 is lifted to its ability level by finishStartLevel
      state.score = 0;
      levelStartScore = state.score;
      // Level 1 opens the story: play the intro unless it already ran this
      // session (the first app open shows it before the title appears).
      if (!campaign2Selected) await storyIntro.playBeforeLevel(targetLevel);
      diffSelect.style.display = 'none';
      await startLevel(targetIndex, true);
    } catch (error) {
      console.error('Unable to start the selected campaign', error);
      diffSelect.style.display = 'flex';
      showTitlePage('progress');
      showProgressError(t('personalDevelopment.loadFailed'));
    } finally {
      levelStarting = false;
    }
  });
});
function onLevelGridSelect() {
  if (platform.isApp && currentPersonalDevelopment) renderLocalCampaign(currentPersonalDevelopment.completed);
  else updateTitleStartingLevel();
  showTitlePage('play');
}

// --- Auth ---
// The app bundle ships without the account, checkout and web-legal markup
// (see mobile/scripts/copy-assets.mjs), so the web-only controls below are
// only wired and driven when the web platform is active.
const authForms = [loginForm, registerForm, forgotPasswordForm, resetPasswordForm];

function showAuthForm(formToShow) {
  if (platform.isApp) return;
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

if (!platform.isApp) tabLogin.addEventListener('click', () => showAuthForm(loginForm));
if (!platform.isApp) tabRegister.addEventListener('click', () => showAuthForm(registerForm));

if (!platform.isApp) loginBtn.addEventListener('click', () => {
  showAuthForm(loginForm);
  setAuthModalVisible(true);
});
if (!platform.isApp) closeAuth.addEventListener('click', () => {
  setAuthModalVisible(false);
  showAuthForm(loginForm);
});
if (!platform.isApp) logoutBtn.addEventListener('click', async () => {
  clearPremiumSession();
  await platform.logout();
  applyAuthUIState();
});
if (!platform.isApp) loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginError.classList.remove('success-msg');
  loginVerifyResend.style.display = 'none';
  try {
    const u = document.getElementById('login-username').value;
    const p = document.getElementById('login-password').value;
    await platform.login(u, p);
    setAuthModalVisible(false);
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

if (!platform.isApp) loginResendBtn.addEventListener('click', async () => {
  const email = loginResendEmail.value.trim();
  if (!email) {
    loginError.textContent = t('auth.enterEmailToResend');
    return;
  }
  try {
    await platform.resendVerification(email, getTurnstileToken('resend'));
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

if (!platform.isApp) registerForm.addEventListener('submit', async e => {
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
    await platform.register(u, em, pw, firstGradeYear, getTurnstileToken('register'));
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

if (!platform.isApp) forgotPasswordLink.addEventListener('click', () => {
  showAuthForm(forgotPasswordForm);
});

if (!platform.isApp) backToLoginLink.addEventListener('click', () => {
  showAuthForm(loginForm);
});

if (!platform.isApp) forgotPasswordForm.addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('forgot-password-email').value.trim();
  const msgEl = document.getElementById('forgot-password-message');
  try {
    await platform.forgotPassword(email, getTurnstileToken('forgotPassword'));
    msgEl.classList.add('success-msg');
    msgEl.textContent = t('auth.resetLinkSent');
  } catch (err) {
    msgEl.classList.remove('success-msg');
    msgEl.textContent = translateServerMessage(err.message);
  } finally {
    resetTurnstileWidget('forgotPassword');
  }
});

if (!platform.isApp) resetPasswordForm.addEventListener('submit', async e => {
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
    await platform.resetPassword(pendingResetToken, newPw);
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

if (!platform.isApp) closeAuthStatus.addEventListener('click', () => {
  authStatusModal.style.display = 'none';
});

leaderboardYearFilter.addEventListener('change', () => {
  renderLeaderboard(entriesForSelectedFilter(currentLeaderboard));
});

if (!platform.isApp) leaderboardCompleteProfile.addEventListener('click', async () => {
  const yearInput = prompt(t('leaderboard.yearPromptMessage'));
  if (yearInput === null) return;
  const year = Number(yearInput);
  if (!Number.isInteger(year)) {
    leaderboardProfilePrompt.textContent = t('leaderboard.yearPromptInvalid');
    leaderboardProfilePrompt.style.display = '';
    return;
  }
  const result = await platform.updateProfile(year);
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
  const immediateAccessConfirmed = checkoutImmediateAccessConfirm?.checked;
  const withdrawalWaiverConfirmed = checkoutWithdrawalWaiverConfirm?.checked;
  if (!adultConfirmed || !termsAccepted) {
    checkoutMessage.textContent = t('checkout.confirmAdultAndTerms');
    return;
  }
  if (!immediateAccessConfirmed || !withdrawalWaiverConfirmed) {
    checkoutMessage.textContent = t('checkout.confirmDigitalContentDeclarations');
    return;
  }
  try {
    const result = await platform.startCheckout(adultConfirmed, termsAccepted, {
      version: CHECKOUT_DECLARATIONS_VERSION,
      language: getLocale(),
      immediateAccessConfirmed,
      withdrawalWaiverConfirmed
    });
    if (platform.isStripeRedirect(result.url, 'checkout.stripe.com')) {
      // Stripe refuses to be framed: on a wide screen the game runs inside the phone frame
      // (phone-frame.js), so the checkout opens in the whole tab, not in the frame.
      (window.top ?? window).location.href = result.url;
    } else {
      checkoutMessage.textContent = t('checkout.invalidUrl');
    }
  } catch (err) {
    checkoutMessage.textContent = translateServerMessage(err.message) || t('checkout.failed');
  }
});

if (!platform.isApp) userDisplay.addEventListener('click', async () => {
  if (!platform.isLoggedIn) return;
  showAccountTab(tabAccountProfile, accountProfilePanel);
  setAccountModalVisible(true);
  await populateAccountModal();
});

function setAccountModalVisible(visible) {
  if (!accountModal) return;
  accountModal.style.display = visible ? 'flex' : 'none';
  updateTopBarModalState();
}

function setAuthModalVisible(visible) {
  if (!authModal) return;
  authModal.style.display = visible ? 'flex' : 'none';
  updateTopBarModalState();
}

function updateTopBarModalState() {
  const visible = accountModal.style.display !== 'none' || authModal.style.display !== 'none';
  topBar.inert = visible;
  topBar.classList.toggle('behind-modal', visible);
}

if (!platform.isApp) closeAccount.addEventListener('click', () => {
  setAccountModalVisible(false);
});

function showAccountTab(tabBtn, panel) {
  if (platform.isApp) return;
  [accountProfilePanel, accountPasswordPanel, accountScoresPanel, accountBillingPanel, accountDangerPanel].forEach(p => { p.style.display = 'none'; });
  [tabAccountProfile, tabAccountPassword, tabAccountScores, tabAccountBilling, tabAccountDanger].forEach(t => t.classList.remove('active'));
  panel.style.display = '';
  tabBtn.classList.add('active');
  if (tabBtn === tabAccountBilling) {
    loadBilling();
  }
}

if (!platform.isApp) tabAccountProfile.addEventListener('click', () => showAccountTab(tabAccountProfile, accountProfilePanel));
if (!platform.isApp) tabAccountPassword.addEventListener('click', () => showAccountTab(tabAccountPassword, accountPasswordPanel));
if (!platform.isApp) tabAccountScores.addEventListener('click', () => showAccountTab(tabAccountScores, accountScoresPanel));
if (!platform.isApp) tabAccountBilling.addEventListener('click', () => showAccountTab(tabAccountBilling, accountBillingPanel));
if (!platform.isApp) tabAccountDanger.addEventListener('click', () => {
  accountDeleteForm.reset();
  accountDeleteMessage.classList.remove('success-msg');
  accountDeleteMessage.textContent = '';
  showAccountTab(tabAccountDanger, accountDangerPanel);
});

if (!platform.isApp) btnStartCheckout.addEventListener('click', () => {
  checkoutModal.style.display = 'flex';
});

if (!platform.isApp) btnOpenPortal.addEventListener('click', async () => {
  if (btnOpenPortal.disabled) return;
  const originalLabel = btnOpenPortal.textContent;
  btnOpenPortal.disabled = true;
  btnOpenPortal.textContent = t('billing.openingPortal');
  btnOpenPortal.setAttribute('aria-busy', 'true');
  try {
    const result = await platform.openBillingPortal();
    if (platform.isStripeRedirect(result.url, 'billing.stripe.com')) {
      (window.top ?? window).location.href = result.url;   // the whole tab, as for checkout
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

if (!platform.isApp) btnRedeemCode.addEventListener('click', async () => {
  const code = billingRedeemCode.value.trim();
  if (!code) {
    billingRedeemMessage.classList.remove('success-msg');
    billingRedeemMessage.textContent = t('billing.pleaseEnterCode');
    return;
  }
  try {
    await platform.redeemCode(code);
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
  if (platform.isApp) return;
  try {
    billingStatusDisplay.textContent = t('billing.loadingShort');
    billingActions.style.display = 'none';
    const status = await platform.getBillingStatus();
    renderBillingStatus(status);
  } catch (err) {
    billingStatusDisplay.textContent = translateServerMessage(err.message) || t('billing.loadFailed');
  }
}

function renderBillingStatus(status) {
  if (platform.isApp) return;
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
  billingRedeemSection.style.display = platform.isLoggedIn && !founding ? 'block' : 'none';
}

function openBillingPanel() {
  if (platform.isApp) return;
  setAccountModalVisible(true);
  showAccountTab(tabAccountBilling, accountBillingPanel);
}

if (!platform.isApp) document.getElementById('btn-refresh-billing').addEventListener('click', async () => {
  await loadBilling();
  resumePendingLevel();
});
if (!platform.isApp) document.getElementById('btn-recover-gift').addEventListener('click', async () => {
  try {
    const response = await platform._fetch('/billing/recover', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    renderBillingStatus(data.access);
    resumePendingLevel();
  } catch (error) {
    billingStatusText.textContent = translateServerMessage(error.message);
  }
});
if (!platform.isApp) document.getElementById('btn-cancel-subscription').addEventListener('click', async () => {
  if (!window.confirm(t('billing.confirmCancelRenewals'))) return;
  try {
    const result = await platform.cancelSubscription();
    renderBillingStatus(result.access);
  } catch (error) {
    billingStatusText.textContent = translateServerMessage(error.message);
  }
});

// Web-only hero picker in the account modal. Logged-out players and the app
// never reach the import, so no request is made for the picker.
const accountHeroPicker = platform.isApp ? null : document.getElementById('account-hero-picker');
let accountHeroMount = null;
async function mountAccountHeroPicker(profile) {
  accountHeroMount?.destroy();
  accountHeroMount = null;
  if (!accountHeroPicker) return;
  if (!platform.isLoggedIn) {
    accountHeroPicker.hidden = true;
    return;
  }
  let premium = false;
  try {
    premium = (await platform.getBillingStatus())?.premium_access === true;
  } catch {
    premium = false;
  }
  let selectedId = resolveHero(profile?.user?.hero, { entitled: premium }).id;
  const { mountHeroPicker } = await import('./hero-picker.js');
  if (!platform.isLoggedIn) return;
  accountHeroPicker.hidden = false;
  accountHeroMount = mountHeroPicker(document.getElementById('account-hero-picker-grid'), {
    heroes: HEROES,
    t,
    getSelectedId: () => selectedId,
    isLocked: (entry) => !entry.free && !premium,
    canChange: () => !gameRunning && !levelStarting && !completionPending,
    onSelect: async (entry) => {
      const previous = selectedId;
      selectedId = entry.id;
      accountProfileMessage.classList.remove('success-msg');
      accountProfileMessage.textContent = '';
      try {
        const result = await platform.updateProfile({ hero: entry.id });
        if (result?.error) throw new Error(result.error);
        accountProfileMessage.classList.add('success-msg');
        accountProfileMessage.textContent = t('heroes.saved');
        paintHeroIdentity();
        refreshHeroSkin();
      } catch (err) {
        selectedId = previous;
        accountHeroMount?.update();
        accountProfileMessage.textContent = err?.message ? translateServerMessage(err.message) : t('heroes.saveFailed');
      }
    },
    onLocked: () => {
      accountProfileMessage.classList.remove('success-msg');
      accountProfileMessage.textContent = t('heroes.webLocked');
      showAccountTab(tabAccountBilling, accountBillingPanel);
    },
  });
}

async function populateAccountModal() {
  if (platform.isApp) return;
  accountProfileMessage.textContent = '';
  accountProfileMessage.classList.remove('success-msg');
  try {
    const profile = await platform.getProfile();
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
    await mountAccountHeroPicker(profile);
  } catch (err) {
    accountProfileMessage.textContent = t('account.loadProfileFailed');
  }

  try {
    const historyResponse = await platform.getScoreHistory();
    renderScoreHistory(historyResponse, accountScoreHistoryChart);
  } catch {
    renderScoreHistory(null, accountScoreHistoryChart);
  }
}

if (!platform.isApp) accountProfileForm.addEventListener('submit', async e => {
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
      const result = await platform.updateProfile(year);
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
      const result = await platform.changeEmail(newEmail, currentPassword);
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

if (!platform.isApp) accountPasswordForm.addEventListener('submit', async e => {
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
    await platform.changePassword(current, next);
    accountPasswordForm.reset();
    // The backend revokes every previously issued access/refresh token the
    // moment the password changes (see app/jwt_utils.py's token_version
    // check), so the tab's own in-memory access token and refresh cookie
    // are already dead. Mirror the account-deletion flow: clear local
    // session state and send the user back to the login form instead of
    // leaving them in an apparently-logged-in UI that will 401 on its next
    // request.
    clearPremiumSession();
    await platform.logout();
    setAccountModalVisible(false);
    applyAuthUIState();
    loginError.textContent = t('auth.passwordChangedPleaseLogIn');
    showAuthForm(loginForm);
    setAuthModalVisible(true);
  } catch (err) {
    accountPasswordMessage.classList.remove('success-msg');
    accountPasswordMessage.textContent = translateServerMessage(err.message);
  }
});

// Deleting an account requires: the checkbox acknowledgement (button stays
// disabled without it), the current password, and a final native confirm()
// dialog — three independent confirmations for an irreversible action.
if (!platform.isApp) accountDeleteConfirmCheckbox.addEventListener('change', () => {
  accountDeleteSubmit.disabled = !accountDeleteConfirmCheckbox.checked;
});
if (!platform.isApp) accountDeleteSubmit.disabled = true;

if (!platform.isApp) accountDeleteForm.addEventListener('submit', async e => {
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
    await platform.deleteAccount(password);
    clearPremiumSession();
    setAccountModalVisible(false);
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
  // The pause card's sound-settings speaker shows the same state as the title bar's.
  const pauseSpeaker = document.querySelector('#audio-settings .audio-settings-icon');
  if (pauseSpeaker) pauseSpeaker.textContent = audio.muted ? '🔇' : '🔊';
  volumeControl?.refresh();
}

muteBtn.addEventListener('click', () => {
  const wasMuted = audio.muted;
  audio.toggleMute();
  persistAudioPreferences();
  updateMuteButtonLabel();
  volumeControl?.noteMuteChange?.(wasMuted);
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
    return platform.validatePendingRecord(record) ? record : null;
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
  // The app has no account but still resumes the level the paywall interrupted.
  if (!platform.isLoggedIn && !platform.isApp) return;
  const pending = getPendingRecord();
  if (!pending) return;
  state.score = pending.score;
  state.difficulty = pending.difficulty;
  state.timerMax = pending.timerMax;
  state.timerRemaining = pending.timerMax;
  state.maxHearts = pending.maxHearts;
  state.hearts = pending.maxHearts;
  if (typeof beginAbilityRun === 'function') beginAbilityRun(pending.levelIndex + 1);
  startLevel(pending.levelIndex);
}

function clearPremiumSession() {
  if (typeof stopStorm === 'function') stopStorm();
  setAnswerInputVisible(false);
  gameplayTimers.length = 0;
  // Drop in-flight projectiles too, so no collision callback can fire after
  // the session (or a paused game) has been abandoned.
  activeLightningBolts = [];
  activeFireballs = [];
  activeDragons = [];
  levelRequestGeneration++;
  platform.incrementRequestGeneration();
  platform.setCurrentLevelConfig(null);
  gameRunning = false;
  inputDisabled = true;
  state.timerActive = false;
  input.disable();
  practiceRun = null;
  state.isShapesMode = false;
  setAccountModalVisible(false);
  if (checkoutModal) checkoutModal.style.display = 'none';
  diffSelect.style.display = 'flex';
  hideLoadingOverlay();
  topBar.style.display = 'flex';
  audio.stopBGM();
  if (typeof startMenuMusic === 'function') startMenuMusic();
  syncKeepAwake();
  updateHUDLogoutVisibility();
}

// --- Multi-hit level storm ---
// A level whose fiends need more than one answer runs under a thunderstorm: the
// playfield is dimmed, rain sheets across it and the odd bolt lands. The storm
// belongs to the level, so it is armed once when the level starts and stopped on
// clear, game over and quit — a chain of `schedule` ticks with a token, so
// stopping it is immediate and no stale tick can re-arm it.
let stormToken = 0;
let stormRunning = false;
// The particle layer steps at 30 Hz while a storm runs: rain and lightning do
// not need 60, and a full-viewport composite of a DPR-2 canvas is the most
// expensive per-frame work the game does on a phone. Sprites, input and the HUD
// keep the full frame rate, and a level without weather is untouched.
const FX_STORM_STEP_SECONDS = 1 / 30;
const FX_MAX_STEP_SECONDS = 1 / 20;
let fxFrameCarry = 0;

/**
 * How much time the particle layer should advance this frame, and what to carry
 * into the next one. Pure, so the cadence is testable without the game loop.
 * @param {number} dt frame delta in seconds
 * @param {boolean} storm whether a storm level is on screen
 * @param {number} carry time left over from the previous frame
 * @returns {{ step: number, carry: number }} `step` is 0 when no frame is due
 */
function fxStepFor(dt, storm, carry = 0) {
  const elapsed = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (!storm) return { step: elapsed, carry: 0 };
  const next = carry + elapsed;
  if (next < FX_STORM_STEP_SECONDS) return { step: 0, carry: next };
  return {
    step: Math.min(next, FX_MAX_STEP_SECONDS),
    carry: next - FX_STORM_STEP_SECONDS,
  };
}

function stopStorm() {
  stormToken += 1;
  stormRunning = false;
  fxFrameCarry = 0;
  // The weather owns its layer outright: stopping it clears dim, rain and bolts
  // without touching the gameplay particles on the layer above.
  globalThis.ffmStormFx?.clear?.();
}

function startStorm(cfg) {
  stopStorm();
  const fx = globalThis.ffmStormFx;
  const multiHit = Number(cfg?.fiendHP) > 1;
  if (!multiHit || !fx?.play || !fx?.schedule) return false;
  // The dim is added once and held for the level: a wash keeps a constant alpha
  // for its whole life and then vanishes, so re-adding short ones (the first
  // version) made the whole screen step lighter and darker instead of settling.
  fx.play('stormDim', {});
  stormRunning = true;
  fxFrameCarry = 0;
  const token = stormToken;
  const tick = () => {
    if (token !== stormToken) return;
    fx.play('stormRain', {});
    // One bolt every few seconds, never on the first tick, so the level opens
    // with rain and the thunder arrives as a surprise.
    if (Math.random() < 0.035) fx.play('stormBolt', { x: 110 + Math.random() * (CANVAS_W - 220) });
    fx.schedule(0.12, tick);
  };
  fx.schedule(0.12, tick);
  return true;
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
  globalThis.ffmScreenFx?.clear();
  setAnswerInputVisible(false);
  if (profileMutationPending) return;
  levelStarting = true;
  showLoadingOverlay();

  // Increment generation and capture it to detect stale requests
  levelRequestGeneration++;
  const myGeneration = levelRequestGeneration;
  const originalUsername = platform.username;

  // Stop any in-flight game state
  gameRunning = false;
  inputDisabled = true;
  state.timerActive = false;
  input.disable();

  try {
    if (platform.isApp) {
      await ensureLocalProfiles();
      await profileUI?.whenIdle();
      runProfileId = platform.localProfiles.getActiveProfile().id;
    }
    // Fetch level config (handles authorization for premium levels)
    const cfg = typeof selectedCampaign !== 'undefined' && selectedCampaign === 2
      ? await getCampaign2Config(levelIndex)
      : await platform.getAuthorizedLevelConfig(levelIndex, includeBaseline);

    // Check if this request became stale (user logged in/out, or new level started)
    if (myGeneration !== levelRequestGeneration || originalUsername !== platform.username) {
      hideLoadingOverlay();
      return; // Silently ignore stale request
    }

    // Don't set config until we've verified generation
    platform.setCurrentLevelConfig(cfg);

    renderer.setBackgroundByLevel(cfg.artLevel ?? cfg.level);
    applyLevelGround(renderer.groundY);
    // Warm only the current and next level art; the following levels are not
    // requested, and a level without a manifest entry is skipped entirely.
    renderer.preloadLevelArt?.([cfg.artLevel ?? cfg.level, (cfg.artLevel ?? cfg.level) + 1]);

    // Apply baseline score to state if requested and available
    let baselineScore = 0;
    if (!platform.isApp && includeBaseline && cfg.baseline_score !== undefined) {
      baselineScore = cfg.baseline_score;
    }

    // Level start is the one safe moment to swap the skin: the overlay is up
    // and no encounter exists. An unchanged choice loads nothing.
    if (typeof applyActiveHeroSkin === 'function') await applyActiveHeroSkin();
    const ready = Promise.all([assetsLoaded, renderer.waitForBackgroundLoad()]);
    await Promise.race([
      ready,
      new Promise((resolve) => setTimeout(resolve, LOADING_SAFETY_TIMEOUT_MS)),
    ]);
      // Final stale check before finishing
      if (myGeneration !== levelRequestGeneration || originalUsername !== platform.username) {
        hideLoadingOverlay();
        return; // Silently ignore stale request
      }
      hideLoadingOverlay();
      const intro = cfg.campaign === 2 ? getSkillIntro2(cfg.level) : getSkillIntro(cfg.level);
      if (intro) {
        showSkillIntro(intro, levelIndex, cfg, baselineScore);
        return;
      }
      finishStartLevel(levelIndex, cfg, baselineScore);
      clearPendingRecord();
      setAccountModalVisible(false);
  } catch (err) {
    hideLoadingOverlay();
    // Only show error if this is still the current generation
    if (myGeneration === levelRequestGeneration) {
      handleLevelConfigError(err, levelIndex);
    }
  } finally {
    if (myGeneration === levelRequestGeneration) levelStarting = false;
  }
}

// The app sells the unlock through StoreKit/Play Billing, so a locked level
// opens the store paywall instead of the web registration/payment flow.
async function showEntitlementPaywall() {
  try {
    const { createPaywall } = await import('./paywall.js');
    await createPaywall({ platform, locale: getLocale(), onGranted: resumePendingLevel }).open();
  } catch {
    openBillingPanel();
  }
}

function handleLevelConfigError(err, levelIndex) {
  const level = levelIndex + 1;
  let message = t('auth.failedToLoadLevel', { level });
  const isPractice = Boolean(practiceRun);

  if (err.code === 'campaign2_locked') {
    // Not entitled: back to the title, where the note under the campaign switch says how to get it.
    audio.stopBGM();
    diffSelect.style.display = 'flex';
    updateHUDLogoutVisibility();
    renderCampaignSwitch();
    if (platform.isApp) openCampaign2Purchase();
    else if (platform.isLoggedIn) openBillingPanel();
    else { showAuthForm(loginForm); setAuthModalVisible(true); }
    return;
  }

  audio.stopBGM();
  if (isPractice) {
    showPracticeStatus(t('practice.startFailed', { level }), true);
    practiceRun = null;
    state.isShapesMode = false;
  }
  if (platform.isApp && err.code === 'storage_unavailable') {
    showProgressError(t('profiles.storageError'));
    showTitlePage('progress');
  }

  if (!isPractice && [401, 402, 403].includes(err.statusCode) && level > 2) {
    savePendingRecord(levelIndex, state.score, state.difficulty, state.timerMax, state.maxHearts);
  }
  if (err.code === 'entitlement_required' && platform.isApp) {
    // The pending record saved above lets the paywall resume this level after
    // a successful purchase or restore. The app has no auth-status overlay.
    diffSelect.style.display = 'flex';
    updateHUDLogoutVisibility();
    showEntitlementPaywall();
    return;
  }
  if (platform.isApp) {
    // The app has no auth-status overlay; return to the title screen.
    diffSelect.style.display = 'flex';
    updateHUDLogoutVisibility();
    return;
  }
  if (err.statusCode === 401) {
    message = t('auth.loginRequiredForPremium');
    showAuthForm(loginForm);
    setAuthModalVisible(true);
  } else if (err.statusCode === 402) {
    message = t('auth.subscriptionRequired');
    // Save pending record for L3+ so user can resume after purchasing
    if (!isPractice && level > 2) {
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

// Rebuild the level's earned bonuses from the ladder. The ladder is a pure
// function of the level, so replaying it at every level start matches what the
// player has earned by then. The result feeds both sides of the game: the bar
// readouts and the ability runtime (`beginAbilityRun` / `setBonuses`).
// `cooldowns` stays per ability because each cooldown bonus names the ability
// it shortens, while the runtime keeps the capped totals the storm and earth
// readouts need.
function bonusReadoutsForLevel(level) {
  const safeLevel = Number.isFinite(level) && level >= 1 ? Math.trunc(level) : 1;
  let runtime = createBonusRuntime({ level: safeLevel });
  const cooldowns = { wind: 0, storm: 0, earth: 0 };
  let totalReduction = 0;
  for (let current = 2; current <= safeLevel; current += 1) {
    const bonus = bonusForLevel(current);
    if (!bonus) continue;
    runtime = applyBonus(runtime, bonus);
    if (bonus.type !== 'cooldown') continue;
    const room = Math.min(bonus.value, BONUS_CAPS.cooldownSeconds - totalReduction);
    if (room <= 0) continue;
    totalReduction += room;
    cooldowns[bonus.abilityId] += room;
  }
  return { runtime, cooldowns };
}

// Start a fresh ability run at `level`: every cooldown is cleared. Called
// whenever a run begins (level select, practice, resume after paywall, retry);
// level transitions inside a run only call setLevel so cooldowns persist.
// The run inherits every bonus the ladder grants up to `level`, so starting at
// level n is not a downgrade to level 1: storm rank, the passive fiend slow,
// the earth-spike targets and the per-ability cooldown reductions all come
// from the same replay the HUD readouts use. `rank` and `spikeSlow` stay
// overridable for callers that pin a value (and for the extracted tests).
function beginAbilityRun(level, rank = undefined, spikeSlow = undefined) {
  const safeLevel = Number.isFinite(level) && level >= 1 ? Math.trunc(level) : 1;
  // The `typeof` keeps extracted-function tests running without main.js.
  const readouts = typeof bonusReadoutsForLevel === 'function'
    ? bonusReadoutsForLevel(safeLevel)
    : null;
  const earned = readouts?.runtime;
  const safeRank = Number.isSafeInteger(rank) && rank >= 0 ? rank : earned?.stormRank ?? 0;
  if (typeof clearSpikeSlow === 'function') clearSpikeSlow();
  abilityRuntime = createAbilityRuntime({
    level: safeLevel,
    rank: safeRank,
    slowBonuses: earned?.slowBonuses ?? 0,
    spikeSlow: spikeSlow ?? spikeSlowForBonuses(earned?.spikeTargets ?? 0),
    cooldownReductions: readouts?.cooldowns,
  });
  return abilityRuntime;
}

// A bar activation is only honoured while the ability is unlocked and ready;
// the bar already refuses cooling/locked clicks, but this keeps the guard at
// the gameplay seam too. Wind needs a live fiend to remove and is refused
// while input is disabled; storm clears a slice of whatever remains; earth
// always casts, slowing the active fiend and the next spawns.
function activateAbility(id) {
  if (!abilityRuntime) return false;
  if (abilityRuntime.progress(id) < 1) return false;
  if (id === 'wind' && (!activeFiend || inputDisabled)) return false;
  // Storm always leaves one enemy behind, so a wave with nothing to spare is
  // refused before the cooldown is spent.
  if (id === 'storm' && remainingEnemyCount() < 2) return false;
  // Earth holds whatever the level still has to send; with nothing left to
  // slow the press must not burn the three-minute cooldown (wind and storm
  // refuse for the same reason).
  if (id === 'earth' && remainingEnemyCount() < 1) return false;
  if (!abilityRuntime.activate(id)) return false;
  // Captured before the cast: wind and storm remove the active fiend, so its
  // centre has to be read while it is still on the field. The `typeof` keeps
  // extracted-function tests running without main.js, like clearSpikeSlow.
  const origin = typeof abilityCastOrigin === 'function' ? abilityCastOrigin() : null;
  let cast;
  if (id === 'wind') cast = castWindAbility();
  else if (id === 'storm') cast = castStormAbility();
  else if (id === 'earth') cast = castEarthAbility();
  else cast = true;
  if (!cast) return false;
  // One cue and one effect per successful cast, fired here at the activation
  // seam so a rejected cast stays silent and the frame loop never retriggers.
  if (typeof playAbilityCastFeedback === 'function') playAbilityCastFeedback(id, origin);
  return true;
}

// Centre the cast feedback on the target when there is one; a cast with no
// live fiend (a storm finishing the queue) falls back to the hero's hands.
function abilityCastOrigin() {
  const centre = globalThis.ffmFx?.fiendCentre?.(activeFiend);
  return centre || { x: HERO_X, y: hero.y - HERO_CENTRE_ABOVE_GROUND };
}

// The level bonus is announced as text in the header, but it always strengthens
// one spell in the answer zone. This flies a glow from the pill into that orb,
// so the sentence and the orb it changed read as the same thing. Measured from
// the real boxes: portrait has the orbs under the playfield, landscape beside
// it, and the app puts them in the answer column on both.
function playBonusFlow(bonus) {
  const fx = globalThis.ffmScreenFx;
  const abilityId = bonus && typeof bonus.abilityId === 'string' ? bonus.abilityId : '';
  if (!fx || !abilityId) return false;
  const orb = document.querySelector(`.ability-slot[data-ability="${abilityId}"]`);
  const pill = document.getElementById('bonus-notice');
  const centreOf = (element) => {
    if (!element || typeof element.getBoundingClientRect !== 'function') return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const orbPoint = centreOf(orb);
  if (!orbPoint) return false;
  const pillPoint = centreOf(pill);
  const to = globalThis.ffmFx?.worldFromPoint(orbPoint);
  if (!to) return false;
  return fx.play('bonusFlow', {
    from: pillPoint ? globalThis.ffmFx?.worldFromPoint(pillPoint) : null,
    to,
    ability: abilityId,
  });
}

// The one place a successful cast makes noise and light. Earth also starts the
// persistent slow aura; the one-shot recipes are windCast, stormCast and
// spikeCast.
function playAbilityCastFeedback(id, origin) {
  const effect = { wind: 'windCast', storm: 'stormCast', earth: 'spikeCast' }[id];
  if (!effect) return false;
  // The cue already played on the press (see the bar's onPress); this seam owns
  // the light, so a spell is never double-voiced.
  globalThis.ffmScreenFx?.play(effect, origin || abilityCastOrigin());
  if (id === 'earth' && typeof startSpikeAura === 'function') startSpikeAura();
  return true;
}

// The earth slow's aura runs for exactly as long as the runtime's spike: the
// emitter is sized from spikeState.durationSeconds and every pulse re-checks
// the token, so stopSpikeAura silences it the moment the slow is cleared.
// Each pulse is anchored to a *slowed* fiend. The single origin it used before
// (the active fiend, or the hero's hands when none was active) pointed at the
// wrong sprite most of the time, because the spike also holds the spawns that
// have not walked in yet.
function startSpikeAura() {
  const spike = abilityRuntime?.spikeState;
  // The spike can be refreshed by every target it takes hold of, so the aura is
  // sized for the whole chain and lets each pulse check that the spike is still
  // running (it already does).
  const duration = spike?.active ? spike.durationSeconds * (spike.targets + 1) : 0;
  spikeAuraToken += 1;
  const token = spikeAuraToken;
  const fx = globalThis.ffmScreenFx;
  if (!fx?.emitter || !(duration > 0)) return null;
  return fx.emitter(duration, 8, (progress) => {
    if (token !== spikeAuraToken) return;
    // The runtime can clear the slow early (pause, level change, game over), so
    // the aura follows it instead of outliving it.
    if (!abilityRuntime?.spikeState.active) return;
    for (const fiend of spikeSlowedFiends) {
      if (!fiend || fiend.isDead) continue;
      const centre = globalThis.ffmFx?.fiendCentre?.(fiend) ||
        { x: fiend.x, y: fiend.y - 20 * LOGICAL_PX };
      fx.play('spikeAura', { ...centre, progress });
    }
  });
}

function stopSpikeAura() {
  spikeAuraToken += 1;
}

// How many encounters remain on the field: every queued spawn, every requeued
// fiend and every live fiend. A requeued fiend waits with state 'retreat' until
// it walks back on, which the dragon-breath count treats as resolved, so the
// requeue list is counted here on its own. The active fiend is normally one of
// `fiends`, but a cast can arrive while it is between arrays, so it is counted
// exactly once either way.
function remainingEnemyCount() {
  const requeued = new Set(requeuedFiends.filter((f) => f && !f.isDead));
  return countDragonRemainingEncounters({ fiends, spawnQueue }) +
    requeued.size +
    (activeFiend && !fiends.includes(activeFiend) && !requeued.has(activeFiend) ? 1 : 0);
}

// Remove the active fiend for an ability cast: it retreats off the field
// instead of dying, is dropped from the requeue list, and the next spawn is
// scheduled like any other resolved encounter. No score, combo or timing
// credit is awarded here.
// `exit` decides how the fiend leaves: 'blow' throws it at the viewer (wind and
// storm), 'retreat' keeps the old walk-off for anything that merely flees.
function removeActiveFiendForAbility(exit = 'retreat') {
  const fiend = activeFiend;
  activeFiend = null;
  pendingProblemActivation = null;
  if (fiend) {
    requeuedFiends = requeuedFiends.filter((f) => f !== fiend);
    if (typeof restoreSpikeSlow === 'function' && fiend.spikeSlowed) {
      restoreSpikeSlow(fiend);
      if (typeof spikeSlowedFiends !== 'undefined') spikeSlowedFiends.delete(fiend);
    }
    if (exit === 'blow' && typeof fiend.blowTowardViewer === 'function') fiend.blowTowardViewer();
    else fiend.setState('retreat');
  }
  state.timerActive = false;
  inputDisabled = false;
  spawnTimer = spawnInterval;
}

// Wind removes the active fiend outright: one defeat and no score, combo or
// timing credit, then the wave continues or clears exactly like a normal kill.
function castWindAbility() {
  if (!activeFiend) return false;
  removeActiveFiendForAbility('blow');
  state.enemiesDefeated++;
  recordPracticeEncounterDefeated();
  hud.update(state);
  if (checkAllDefeated()) triggerWaveClear();
  return true;
}

// Storm clears a capped slice of the remaining wave, draining the spawn queue
// first, then requeued fiends, then the active fiend, so the thing closest to
// the player survives longest. The removed enemies leave the level: the level's
// enemy count shrinks instead of the Defeated count growing, so the portrait
// sword row loses exactly their swords. The normal wave-clear check follows.
function castStormAbility() {
  const toRemove = abilityRuntime.stormRemovals(remainingEnemyCount());
  let removed = 0;
  while (removed < toRemove && spawnQueue.length > 0) {
    spawnQueue.shift();
    removed++;
  }
  while (removed < toRemove && requeuedFiends.length > 0) {
    requeuedFiends.shift();
    removed++;
  }
  if (removed < toRemove && activeFiend) {
    removeActiveFiendForAbility('blow');
    removed++;
  }
  if (removed === 0) return false;
  state.levelEnemies = Math.max(0, state.levelEnemies - removed);
  playStormRemovalFeedback(removed);
  hud.update(state);
  if (checkAllDefeated()) triggerWaveClear();
  // `inputDisabled` belongs to the encounter flow: a storm cast during a
  // reveal must not re-enable answering mid-sequence.
  else spawnTimer = spawnInterval;
  return true;
}

// The storm's visible and audible half: one banish burst per enemy it took off
// the level, spread along the ground from the portal towards the hero, the same
// number of swords puffing off the portrait row, and one thunder cue for the
// whole chain. The bursts read as separate hits, so a rank-5 storm looks wider
// than a rank-0 one instead of repeating one puff.
function playStormRemovalFeedback(removed) {
  const bursts = Math.max(0, Math.trunc(removed));
  const span = Math.max(0, FIEND_PORTAL_X - (HERO_X + 120));
  const fx = globalThis.ffmScreenFx;
  for (let i = 0; i < bursts; i += 1) {
    const t = bursts === 1 ? 0.5 : i / (bursts - 1);
    fx?.play?.('stormRemoval', { x: FIEND_PORTAL_X - 40 - t * span, y: groundY - 34 });
  }
  // `typeof` keeps the extracted-function tests running without main.js.
  if (typeof encounterSwords !== 'undefined') encounterSwords.shatter?.(bursts);
  audio.playStormRemoval?.(bursts);
}

// Earth spikes the ground: the active fiend, if any, is slowed once without
// spending a spawn slot, and the runtime's target count lets that many newly
// created fiends inherit the slow.
function castEarthAbility() {
  const spike = abilityRuntime.spikeState;
  spikeSpawnSlowLeft = spike.targets;
  if (activeFiend && applySpikeSlow(activeFiend, spike.factor)) {
    spikeSlowedFiends.add(activeFiend);
  }
  return true;
}

// End the earth-spike slow immediately: every tracked fiend returns to its
// stored base speed and upcoming spawns are no longer slowed.
function clearSpikeSlow() {
  for (const fiend of spikeSlowedFiends) restoreSpikeSlow(fiend);
  spikeSlowedFiends.clear();
  spikeSpawnSlowLeft = 0;
  if (typeof stopSpikeAura === 'function') stopSpikeAura();
  abilityRuntime?.clearSpike();
}

function finishStartLevel(levelIndex, cfg, baselineScore = 0) {
  setAnswerInputVisible(true);
  gameplayTimers.length = 0;
  waveClearing = false;
  dragonFinishResolved = false;
  answerTimes = [];
  spawnInterval = SPAWN_INTERVAL_SECONDS;
  answerClock.reset();
  attemptSummary = createAttemptSummary();
  completionFeedback = null;
  lastCastAbility = null;
  state.isShapesMode = practiceRun?.kind === 'shapes';
  campaignWon = false;
  completedLevelSave = null;
  currentLevelIndex = levelIndex;
  levelStartScore = state.score;
  state.level = cfg.level;
  state.campaign = cfg.campaign === 2 ? 2 : 1;
  // Campaign 2 plays with every hero ability from its first level; Campaign 1 earns them by level.
  const abilityLevel = cfg.abilityLevel ?? cfg.level;
  // Campaign 2 questions need more thinking time: the chosen difficulty's timer, stretched per level.
  if (cfg.campaign === 2) state.timerMax = Math.round((state.baseTimerMax ?? state.timerMax) * cfg.timerScale);
  // A run keeps its cooldowns across levels; the first level of a run creates
  // the runtime (run-start call sites do this earlier, this is the fallback).
  // The `typeof` keeps extracted-function tests running without main.js.
  //
  // The earned bonus ladder is rebuilt from the level for the HUD readouts and
  // applied to the live runtime at every level start, so a run that starts at
  // level n — or walks into it — plays with every bonus up to that level:
  // storm rank, passive fiend slow, earth-spike targets and the per-ability
  // cooldown reductions.
  let levelBonuses = null;
  if (typeof bonusReadoutsForLevel === 'function' && typeof levelBonusRuntime !== 'undefined') {
    levelBonuses = bonusReadoutsForLevel(abilityLevel);
    levelBonusRuntime = levelBonuses.runtime;
    levelBonusCooldowns = levelBonuses.cooldowns;
  }
  if (typeof abilityRuntime !== 'undefined') {
    if (abilityRuntime) abilityRuntime.setLevel(abilityLevel);
    else beginAbilityRun(abilityLevel);
    if (levelBonuses && abilityRuntime?.setBonuses) {
      abilityRuntime.setBonuses({
        rank: levelBonuses.runtime.stormRank,
        slowBonuses: levelBonuses.runtime.slowBonuses,
        cooldownReductions: levelBonuses.cooldowns,
        spikeSlow: spikeSlowForBonuses(levelBonuses.runtime.spikeTargets),
      });
    }
  }
  // A spike slow never survives a level transition.
  if (typeof clearSpikeSlow === 'function') clearSpikeSlow();
  state.waveNumber = 1;
  state.enemiesDefeated = 0;
  // The sword row reads this as "how many enemies this level still holds", so
  // it must match the spawn list filled below and survive storm removals.
  state.levelEnemies = practiceRun?.kind === 'targeted'
    ? practiceRun.targetProblems.length
    : practiceRun
      ? 10
      : cfg?.waveSize ?? 0;
  state.levelSwordSlots = state.levelEnemies;
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

  if (practiceRun?.kind === 'targeted') {
    spawnQueue = [...practiceRun.targetProblems];
  } else if (practiceRun && !state.isShapesMode) {
    spawnQueue = Array.from({ length: 10 }, () => levelIndex);
  } else if (!practiceRun) {
    for (let i = 0; i < cfg.waveSize; i++) spawnQueue.push(levelIndex);
  }
  spawnTimer = 2.0;
  state.combo = 0;
  gameRunning = true;
  paused = false;
  // A speedrun only ever begins at level 1 and only ever continues into the
  // level that follows the one it just finished; anything else ends it. The
  // `typeof` keeps extracted-function tests running without main.js.
  if (typeof speedrunTimer !== 'undefined') {
    if (!practiceRun && !state.isShapesMode && cfg.campaign !== 2 && speedrunTimer.start(state.level)) {
      if (state.level === 1) speedrunSplits = [];
    } else {
      speedrunTimer.abandon();
    }
  }
  // Announce the level's bonus once the level actually starts. Level 1 and
  // practice runs grant none, so the previous level's pill is cleared instead.
  // The `typeof` keeps extracted-function tests running without main.js.
  if (typeof gameplayChrome !== 'undefined') {
    const bonus = !practiceRun && typeof bonusForLevel === 'function'
      ? bonusForLevel(abilityLevel)
      : null;
    if (gameplayChrome?.showBonusNotice?.(bonus) && bonus) {
      // One beat later: this runs before the first frame of the level, while
      // the header is still hidden from the previous screen and has no box to
      // measure. The layer's clock only advances with the game loop, so a
      // paused level never fires the flow late.
      const fx = globalThis.ffmScreenFx;
      if (fx?.schedule) fx.schedule(0.12, () => playBonusFlow(bonus));
      else playBonusFlow(bonus);
    }
  }
  diffSelect.style.display = 'none';
  pauseOverlay.style.display = 'none';
  topBar.style.display = 'none';
  levelClearOverlay.style.display = 'none';
  gameOverOverlay.style.display = 'none';
  if (practiceBadgeRetryButton) practiceBadgeRetryButton.hidden = true;
  // The level's own weather: a multi-hit level dims the playfield and storms,
  // which announces "these fiends take more than one answer" before the first
  // one arrives. Practice and Shapes never carry it.
  if (typeof startStorm === 'function') startStorm(practiceRun ? null : cfg);
  updateHUDLogoutVisibility();
  hud.update(state);
  audio.startLevelBGM(cfg.artLevel ?? cfg.level, cfg.chapter);
  flushDeferredMusicVolume();
  syncKeepAwake();
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
  if (!gameRunning || paused || practiceRun) return;
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
  if (!practiceRun && isInHealZone(canvasLogicalX(e.clientX), CANVAS_W)) return;
  if (paused) {
    resumeGame();
  } else if (gameRunning) {
    pauseGame();
  }
});

btnResumeGame.addEventListener('click', resumeGame);
function closeAudioSettings() {
  const settings = document.getElementById('audio-settings');
  if (!settings?.open) return false;
  settings.open = false;
  settings.querySelector('summary')?.focus();
  return true;
}
document.getElementById('btn-audio-back').addEventListener('click', closeAudioSettings);
// One ID per paused attempt: a failed save retried while still paused reuses
// it, so the profile store's receipt makes the retry idempotent.
let pausedPartialId = null;

btnQuitGame.addEventListener('click', () => {
  pauseActions.style.display = 'none';
  pauseQuitActions.style.display = '';
  const canSave = (platform.isApp || platform.isLoggedIn) && !practiceRun && !state.isShapesMode;
  btnPauseSave.style.display = canSave ? '' : 'none';
  pauseSaveNotice.textContent = canSave
    ? (platform.isApp ? t('overlay.unfinishedSaveNotice') : '')
    : t(practiceRun
      ? 'practice.unscoredNotice' : state.isShapesMode
      ? 'overlay.shapesScoreNotice' : 'overlay.guestScoreNotice');
  pauseSaveError.textContent = '';
  const quitTitle = document.getElementById('pause-quit-title');
  quitTitle.dataset.i18n = 'overlay.quitScorePrompt';
  quitTitle.textContent = t('overlay.quitScorePrompt');
  btnPauseDiscard.style.display = '';
  btnPauseDiscard.dataset.i18n = practiceRun || state.isShapesMode ? 'overlay.returnTitle' : 'overlay.discardScore';
  btnPauseDiscard.textContent = t(btnPauseDiscard.dataset.i18n);
});
btnPauseBack.addEventListener('click', () => {
  pauseQuitActions.style.display = 'none';
  pauseActions.style.display = '';
});
btnPauseDiscard.addEventListener('click', quitPausedGame);
btnPauseSave.addEventListener('click', async () => {
  if (btnPauseSave.disabled || !paused || (!platform.isApp && !platform.isLoggedIn) || practiceRun || state.isShapesMode) return;
  btnPauseSave.disabled = true;
  btnPauseDiscard.disabled = true;
  btnPauseBack.disabled = true;
  pauseSaveError.textContent = '';
  try {
    if (completedLevelSave) await completedLevelSave();
    if (state.campaign === 2) {
      // Campaign 2 keeps no server or profile score yet, so there is nothing to bank.
    } else if (platform.isApp) {
      // Bank the reached score only: recordPartialAttempt keeps the level
      // unfinished and leaves completed/continuation untouched.
      await platform.localProfiles.recordPartialAttempt({
        profileId: runProfileId ?? platform.localProfiles.getActiveProfile().id,
        completionId: pausedPartialId ?? createCompletionId(),
        level: state.level,
        score: Math.max(0, state.score - levelStartScore),
        difficulty: state.difficulty,
      });
    } else {
      await platform.postHighScore(state.score, state.level);
    }
    pausedPartialId = null;
    quitPausedGame();
    await refreshProfileAndLeaderboard();
  } catch (error) {
    console.error('Unable to save before returning to title', error);
    pauseSaveError.textContent = t('overlay.saveScoreFailed');
  } finally {
    btnPauseSave.disabled = false;
    btnPauseDiscard.disabled = false;
    btnPauseBack.disabled = false;
  }
});

function quitPausedGame() {
  if (!paused) return;
  gameplayTimers.length = 0;
  clearPremiumSession();
  clearPendingRecord();
  paused = false;
  pauseOverlay.style.display = 'none';
  pauseQuitActions.style.display = 'none';
  diffSelect.scrollTop = 0;
  syncKeepAwake();
  refreshProfileAndLeaderboard();
}

const gameplayTimers = [];

function scheduleGameplayTimeout(callback, delay) {
  gameplayTimers.push({ callback, remaining: delay / 1000 });
}

function advanceGameplayTimers(dt) {
  const due = [];
  for (const timer of gameplayTimers) {
    timer.remaining -= dt;
    if (timer.remaining <= 0) due.push(timer);
  }
  for (const timer of due) {
    const index = gameplayTimers.indexOf(timer);
    if (index < 0) continue;
    gameplayTimers.splice(index, 1);
    timer.callback();
  }
}

// The screen may sleep on the title screen, in the pause menu, while the
// heal tip is up and after game over; only a running level keeps it awake.
function syncKeepAwake() {
  appLifecycle?.setKeepAwake(gameRunning && !paused);
}

// Android Back: while playing it pauses, while paused it backs out of the
// quit confirmation (or resumes), and everywhere else the lifecycle exits.
function handleAppBack() {
  if (helpOverlay?.isOpen?.()) {
    helpOverlay.close();
    return true;
  }
  if (pendingSkillIntro) {
    btnSkillIntroSkip?.click();
    return true;
  }
  if (levelClearOverlay.style.display === 'flex') {
    btnSaveScoreReturnTitle.click();
    return true;
  }
  if (gameOverOverlay.style.display === 'flex') {
    btnReturnTitle.click();
    return true;
  }
  if (pauseQuitActions.style.display !== 'none') {
    pauseQuitActions.style.display = 'none';
    pauseActions.style.display = '';
    return true;
  }
  if (paused) {
    if (closeAudioSettings()) return true;
    if (healTipOverlay.style.display === 'flex') {
      healTipOverlay.style.display = 'none';
      paused = false;
      audio.resumeBGM();
      syncKeepAwake();
      kickGameLoop();
      return true;
    }
    resumeGame();
    return true;
  }
  return false;
}

function pauseGame() {
  if (paused || !gameRunning) return;
  paused = true;
  if (typeof clearSpikeSlow === 'function') clearSpikeSlow();
  pausedPartialId = createCompletionId();
  closeAudioSettings();
  pauseActions.style.display = '';
  pauseQuitActions.style.display = 'none';
  pauseOverlay.style.display = 'flex';
  input.disable();
  audio.pauseBGM();
  resetHealHold();
  syncKeepAwake();
}
document.getElementById('btn-pause-game').addEventListener('click', pauseGame);

function resumeGame() {
  if (!paused) return;
  paused = false;
  closeAudioSettings();
  pauseOverlay.style.display = 'none';
  audio.resumeBGM();
  if (activeFiend && !inputDisabled) {
    input.enable(getCurrentInputMode());
  }
  syncKeepAwake();
  kickGameLoop();
}

// Contextual help pauses a live level without the pause menu or a partial-run
// record, so closing it restores the exact same state and lets play continue.
function pauseForHelp() {
  if (paused) return;
  paused = true;
  input.disable();
  audio.pauseBGM();
  resetHealHold();
  syncKeepAwake();
}

function resumeFromHelp() {
  if (!paused) return;
  paused = false;
  audio.resumeBGM();
  if (activeFiend && !inputDisabled) {
    input.enable(getCurrentInputMode());
  }
  syncKeepAwake();
  kickGameLoop();
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
  syncKeepAwake();
}

btnHealTipConfirm.addEventListener('click', () => {
  healTipOverlay.style.display = 'none';
  paused = false;
  audio.resumeBGM();
  syncKeepAwake();
  kickGameLoop();
});

// Only one fiend on screen at a time; gap kept for requeue safety
const FIEND_MIN_GAP = 145;

function spawnNextFiend() {
  if (state.isShapesMode && !practiceRun?.endless && practiceRun?.session.isComplete()) return;
  // Wait until the previous fiend is completely gone
  if (fiends.length > 0) return;

  let fiend;
  if (state.isShapesMode && (!practiceRun?.endless || requeuedFiends.length === 0)) {
    fiend = createShapesFiend(FIEND_PORTAL_X);
  } else if (practiceRun?.kind === 'targeted' && requeuedFiends.length > 0) {
    fiend = requeuedFiends.shift();
    fiend.x = FIEND_PORTAL_X;
    fiend.walkSpeed = getFiendWalkSpeed(state.timerMax, FIEND_PORTAL_X,
    typeof abilityRuntime !== 'undefined' ? abilityRuntime?.fiendSpeedMultiplier : 1);
    fiend.wasRequeued = true;
    fiend.setState('walk');
  } else if (practiceRun?.kind === 'targeted' && spawnQueue.length > 0) {
    const problem = spawnQueue.shift();
    fiend = createFiend(practiceRun.sourceLevel - 1, FIEND_PORTAL_X);
    fiend.problem = problem;
    if (problem.operation) practiceRun.operations.add(problem.operation);
  } else if (spawnQueue.length > 0) {
    const levelIndex = spawnQueue.shift();
    fiend = createFiend(levelIndex, FIEND_PORTAL_X);  // problem already assigned inside
  } else if (requeuedFiends.length > 0) {
    fiend = requeuedFiends.shift();
    fiend.x = FIEND_PORTAL_X;
    fiend.walkSpeed = getFiendWalkSpeed(state.timerMax, FIEND_PORTAL_X,
    typeof abilityRuntime !== 'undefined' ? abilityRuntime?.fiendSpeedMultiplier : 1);
    fiend.wasRequeued = true;
    fiend.setState('walk');
  }
  if (fiend) {
    // A requeued fiend is spawned again through this same path, so the pair is
    // registered `once`: each retreat/death consumes it and the next spawn adds
    // a fresh pair. Without that, every requeue stacked another handler on the
    // same EventTarget (no off() exists) and one retreat ran onFiendRetreated
    // once per stacked copy.
    fiend.on('retreated', () => { onFiendRetreated(fiend); }, { once: true });
    fiend.on('dead', () => { onFiendDead(fiend); }, { once: true });
    if (typeof spikeSpawnSlowLeft !== 'undefined' && spikeSpawnSlowLeft > 0 &&
        typeof abilityRuntime !== 'undefined' && abilityRuntime?.spikeState.active &&
        typeof applySpikeSlow === 'function' &&
        applySpikeSlow(fiend, abilityRuntime.spikeState.factor)) {
      spikeSlowedFiends.add(fiend);
      spikeSpawnSlowLeft -= 1;
      // Each promised target gets its own window. Without this the single
      // duration ran out while the slowed fiend in front of the player was
      // still being answered, so the second and third target never arrived in
      // time and the spell read as "only one fiend".
      abilityRuntime?.refreshSpike?.();
    }
    fiends.push(fiend);
    // The entrance: a portal on the level's own ground line, so the fiend appears
    // somewhere the art actually has floor instead of sliding in over scenery.
    // The sound belongs to the door, so it fires with the effect, not with the
    // fiend's first step.
    audio.playFiendPortal?.();
    globalThis.ffmScreenFx?.play('fiendPortal', { x: fiend.x, y: fiend.y });
  }
}

function onFiendRetreated(fiend) {
  // A requeued fiend comes back through spawnNextFiend(), so remember that the
  // spike still holds it: the base speed is restored here (the walk-off must
  // not crawl), but the slow has to return with the next approach while the
  // spike is still running. Without this the spike silently lost its hold on
  // every fiend that a wrong answer sent back — the opposite of what
  // activatePendingProblem() documents.
  if (fiend?.spikeSlowed && requeuedFiends.includes(fiend)) fiend.spikeSlowOnReturn = true;
  if (fiend?.spikeSlowed) {
    restoreSpikeSlow(fiend);
    spikeSlowedFiends.delete(fiend);
  }
  fiends = fiends.filter(f => f !== fiend);
  activeFiend = null;
  inputDisabled = false;
  input.disable();
  // A fiend that leaves the field is one way an encounter resolves without a
  // death animation (a blown-away fiend, a requeued one), and removing it is
  // the last moment anything happens in the level. Re-check here so the wave
  // still clears when this was the final encounter instead of leaving a level
  // that runs on with no fiend and no way to conclude.
  if (checkAllDefeated()) triggerWaveClear();
}

function onFiendDead(fiend) {
  fiends = fiends.filter(f => f !== fiend);
  // A dead fiend never retreats, so the spike's restore hook would otherwise
  // keep the removed fiend in the set until the spike's own timer runs out.
  if (typeof spikeSlowedFiends !== 'undefined') spikeSlowedFiends.delete(fiend);
}

function checkAllDefeated() {
  // "Nothing left to fight" = nothing queued, nothing requeued, and no live
  // fiend still on the field. A fiend blown at the camera by wind or storm is
  // already defeated (its sword is filled) but keeps flying for a moment; it
  // reports 'retreated' when it is gone and onFiendRetreated() re-runs this
  // check, so the wave clears with a clean field instead of freezing the sprite
  // mid-flight. Every other removal path must re-check too.
  const fiendsStillOnField = () => fiends.every(f => f.isDead || f.state === 'retreat');
  if (state.isShapesMode) {
    if (practiceRun?.endless) return false;
    return practiceRun?.session.isComplete() &&
      spawnQueue.length === 0 && requeuedFiends.length === 0 &&
      fiendsStillOnField();
  }
  return spawnQueue.length === 0 &&
         requeuedFiends.length === 0 &&
         fiendsStillOnField();
}

function recordPracticeEncounterDefeated() {
  if (!practiceRun || state.isShapesMode || practiceRun.kind === 'targeted') return;
  practiceRun.session.recordEncounterDefeated();
}

// Screen-FX geometry helpers. Reached through globalThis for the same reason as
// the layer itself: several tests eval single functions out of this module in a
// bare VM, where a module binding would throw and an absent global is a no-op.
// Charge cue while hold-to-heal accumulates: a small green build-up that
// follows the hero, throttled so it does not spawn a particle every frame.
let healChargeAccum = 0;
function emitHealCharge(holding, secondsHeld, dt) {
  if (!holding || secondsHeld <= 0) {
    healChargeAccum = 0;
    audio.setHealCharge?.(null);
    return;
  }
  // The charge bed is a state, not an event: it starts with the hold, rises
  // with the charge and stops on release, so it is updated before the particle
  // throttle below can swallow the call.
  audio.setHealCharge?.(Math.min(1, secondsHeld / GAME_CONFIG.healHoldSecondsPerHeart));
  healChargeAccum += dt;
  if (healChargeAccum < 0.12) return;
  healChargeAccum = 0;
  globalThis.ffmScreenFx?.play('healCharge', {
    x: hero.x,
    y: hero.y - HERO_CENTRE_ABOVE_GROUND,
    progress: Math.min(1, secondsHeld / GAME_CONFIG.healHoldSecondsPerHeart),
  });
}

globalThis.ffmFx = {
  // Centre of a fiend's visible sprite, so impacts land on the body rather than
  // at its feet or above its head. getHitBounds() is the box the projectiles
  // already collide against.
  fiendCentre(fiend) {
    if (!fiend) return null;
    const bounds = fiend.getHitBounds?.();
    if (!bounds) return { x: fiend.x, y: fiend.y - 34 };
    // Not the geometric centre: several fiend sprites carry tall gear above the
    // body (this one brandishes a burning torch, others have wings or horns), so
    // the box's middle sits at the head. Bias down to ~35% of the box height
    // above the feet, which lands on the torso for both the sprite and the
    // procedural fallback.
    const height = bounds.bottom - bounds.top;
    return {
      x: (bounds.left + bounds.right) / 2,
      y: bounds.bottom - height * 0.35,
    };
  },

  fiendHurt(fiend) {
    const centre = this.fiendCentre(fiend);
    if (!centre) return;
    globalThis.ffmScreenFx?.play('fiendHurt', { x: centre.x, y: centre.y });
  },

  // Viewport press -> the layer's unbounded world coordinates, so an effect can
  // start exactly where the finger landed.
  worldFromPoint(point) {
    const fx = globalThis.ffmScreenFx;
    if (!fx || !point) return null;
    const map = fx.mapping();
    if (!map || !map.scale) return null;
    return { x: (point.x - map.offsetX) / map.scale, y: (point.y - map.offsetY) / map.scale };
  },
};

function handleAnswer(value, point) {
  if (!activeFiend || activeFiend.isDead) return;
  // ignore input while fiend is retreating, revealing, or exploding
  if (['retreat', 'reveal', 'death'].includes(activeFiend.state)) return;
  // ignore if value contains no digits (prevents empty or accidental submissions)
  if (!/\d/.test(value)) return;
  // Campaign 2 answers are exact keys ("7/12", "6√2"), compared as text; arithmetic answers are integers.
  const correct = activeFiend.problem.campaign === 2
    ? value === activeFiend.problem.answer
    : parseInt(value, 10) === activeFiend.problem.answer;
  const origin = globalThis.ffmFx?.worldFromPoint(point);
  if (correct) {
    handleCorrectAnswer(origin);
  } else {
    handleWrongAnswer({ origin });
  }
}

// Shared resolution for a lightning strike, whether it was triggered by the
// app build's projectile collision or the web build's arrival timer. Called at
// most once per cast.
function resolveLightningHit(fiend) {
  const boltCentre = globalThis.ffmFx?.fiendCentre(fiend);
  if (boltCentre) globalThis.ffmScreenFx?.play('boltImpact', boltCentre);
  fiend.hp = 0;
  fiend.setState('death');
  audio.playLightningHit();
  globalThis.ffmHaptics?.impact();
  audio.playEnemyDeath(fiend.type);
  state.enemiesDefeated++;
  recordPracticeEncounterDefeated();
  activeFiend = null;
  heroLunge = { phase: 'back', targetX: HERO_X, onArrive: () => {
    hero.setState('idle');
    scheduleGameplayTimeout(() => {
      if (checkAllDefeated()) triggerWaveClear();
      else { spawnTimer = spawnInterval; inputDisabled = false; }
    }, 300);
  }};
  hud.update(state);
}

// Shared resolution for a fireball hit (see resolveLightningHit). The fireball
// damages the fiend through Fiend.hit(), so a nonlethal hit keeps it alive and
// only re-queues its problem.
function resolveFireballHit(fiend) {
  audio.playFireballHit();
  globalThis.ffmHaptics?.impact();
  const fireCentre = globalThis.ffmFx?.fiendCentre(fiend);
  if (fireCentre) globalThis.ffmScreenFx?.play('fireImpact', fireCentre);
  fiend.hit();
  globalThis.ffmFx?.fiendHurt(fiend);

  if (fiend.isDead) {
    audio.playEnemyDeath(fiend.type);
    state.enemiesDefeated++;
    recordPracticeEncounterDefeated();
    activeFiend = null;
    heroLunge = { phase: 'back', targetX: HERO_X, onArrive: () => {
      scheduleGameplayTimeout(() => {
        if (checkAllDefeated()) triggerWaveClear();
        else { spawnTimer = spawnInterval; inputDisabled = false; }
      }, 300);
    }};
  } else {
    const preserveTimer = shouldPreserveProblemTimer(fiend);
    activeFiend = null;
    heroLunge = {
      phase: 'back',
      targetX: HERO_X,
      onArrive: () => {
        const cfg = platform.getCurrentLevelConfig();
        if (cfg) fiend.problem = nextHitProblem(fiend, cfg);
        queueProblemActivation(fiend, { preserveTimer });
        inputDisabled = false;
      }
    };
  }
  hud.update(state);
}

function handleCorrectAnswer(origin) {
  globalThis.ffmScreenFx?.play('correctAnswer', origin ? { origin } : undefined);
  attemptSummary.recordAnswer(activeFiend.problem, true);
  audio.playCorrect?.();
  const elapsed = answerClock.read();
  const problem = activeFiend.problem;
  if (practiceRun && !practiceRun.endless) {
    if (practiceRun.kind !== 'targeted' || practiceRun.targetProblems.includes(problem)) {
      practiceRun.session.recordAnswer(problem, true);
    }
    if (practiceRun.kind === 'recovery' &&
        practiceRun.recovery.recordCorrect(problem, { hearts: state.hearts, maxHearts: state.maxHearts })) {
      const previousHearts = state.hearts;
      state.hearts = Math.min(state.maxHearts, state.hearts + 1);
      if (state.hearts > previousHearts) {
        audio.playHeal?.();
        globalThis.ffmHaptics?.heal();
        globalThis.ffmScreenFx?.play('heal', { x: hero.x, y: hero.y - HERO_CENTRE_ABOVE_GROUND });
      }
    }
  }

  if (!practiceRun && !activeFiend.wasRequeued) {
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
  const insightBonus = !practiceRun && problem.hidden ? MISSING_OPERAND_BONUS : 0;   // the harder, backwards form
  const points      = (classBase + speedBonus + comboBonus + insightBonus) * multiplier;

  // Shapes mode is deliberately unscored (no score/combo/leaderboard) —
  // combo staying at 0 also naturally keeps pickComboAbility() below from
  // ever triggering fireball/lightning/dragon, so this mode is melee-only.
  if (!practiceRun && !state.isShapesMode) {
    state.score += points;
    state.combo++;
  } else {
    state.combo = 0;
  }
  // One chime per band entered, just before the ability that band unlocks.
  if (isAbilityBandStart(state.combo)) audio.playSwordGain?.();
  state.timerActive = false;

  const fiend = activeFiend;
  // Decided once up front (not inside strikeNow) so the lunge gate below can
  // tell ranged spells apart from a melee hit before the hero starts moving.
  const ability = practiceRun ? null : pickComboAbility(state.combo);

  const strikeNow = () => {
    lastCastAbility = ability;
    if (ability === 'lightning') {
      // Hero casts in place at the base location; the bolt erupts from the
      // palm the cast pose draws and travels toward the fiend.
      hero.cast('bolt');
      const launch = spellLaunchPoint();
      globalThis.ffmScreenFx?.play('lightning', {
        from: launch,
        to: globalThis.ffmFx?.fiendCentre(fiend) || { x: fiend.x, y: fiend.y - SPELL_TARGET_Y_OFFSET },
        duration: 0.46,
        impact: false,
      });
      // The app build lets the projectile's own collision decide the hit, so
      // the bolt lands exactly when the sprite reaches the fiend's bounds.
      // The web build keeps its fixed arrival timer unchanged.
      const collides = platform.isApp;
      activeLightningBolts.push(collides
        ? new LightningBolt(launch.x, launch.y, fiend.x, fiend.y - SPELL_TARGET_Y_OFFSET,
          { target: fiend, onHit: () => resolveLightningHit(fiend) })
        : new LightningBolt(launch.x, launch.y, fiend.x, fiend.y - SPELL_TARGET_Y_OFFSET));
      audio.playLightningCast();
      input.disable();
      inputDisabled = true;
      if (!collides) scheduleGameplayTimeout(() => resolveLightningHit(fiend), 600);
    } else if (ability === 'fireball') {
      // Hero casts in place at the base location; the fireball erupts from the
      // palm the cast pose draws, and the hit lands when it actually arrives
      // rather than the instant it's cast.
      hero.cast('fire');
      const launch = spellLaunchPoint();
      globalThis.ffmScreenFx?.play('fireball', {
        from: launch,
        to: globalThis.ffmFx?.fiendCentre(fiend) || { x: fiend.x, y: fiend.y - SPELL_TARGET_Y_OFFSET },
        duration: FIREBALL_FLIGHT_MS / 1000,
        impact: false,
      });
      const collides = platform.isApp;
      activeFireballs.push(collides
        ? new Fireball(launch.x, launch.y, fiend.x, fiend.y - SPELL_TARGET_Y_OFFSET,
          { target: fiend, onHit: () => resolveFireballHit(fiend) })
        : new Fireball(launch.x, launch.y, fiend.x, fiend.y - SPELL_TARGET_Y_OFFSET));
      audio.playFireballCast();
      input.disable();
      inputDisabled = true;
      if (!collides) scheduleGameplayTimeout(() => resolveFireballHit(fiend), FIREBALL_FLIGHT_MS);
    } else if (ability === 'dragon') {
      const launch = spellLaunchPoint();
      activeDragons.push(new DragonSummon(CANVAS_W, hero.y));
      globalThis.ffmScreenFx?.play('dragonFinisher', { origin: launch });
      hero.setState('swing');
      fiend.hit();
      globalThis.ffmFx?.fiendHurt(fiend);
      audio.playDragonRoar();
      globalThis.ffmHaptics?.impact();

      if (fiend.isDead) {
        audio.playEnemyDeath(fiend.type);
        state.enemiesDefeated++;
        recordPracticeEncounterDefeated();
        activeFiend = null;
        input.disable();
        inputDisabled = true;
        heroLunge = { phase: 'back', targetX: HERO_X, onArrive: () => {
          scheduleGameplayTimeout(() => {
            if (checkAllDefeated()) triggerWaveClear();
            else { spawnTimer = spawnInterval; inputDisabled = false; }
          }, 300);
        }};
      } else {
        const preserveTimer = shouldPreserveProblemTimer(fiend);
        activeFiend = null;
        input.disable();
        inputDisabled = true;
        heroLunge = {
          phase: 'back',
          targetX: HERO_X,
          onArrive: () => {
            const cfg = platform.getCurrentLevelConfig();
            if (cfg) fiend.problem = nextHitProblem(fiend, cfg);
            queueProblemActivation(fiend, { preserveTimer });
            inputDisabled = false;
          }
        };
      }
    } else {
      // No ability (null): normal hit resolution
      // hero.x follows the lunge, so the arc lands where the sword connects
      // rather than at the resting position it started from.
      globalThis.ffmScreenFx?.play('heroStrike', { x: hero.x + 62, y: hero.y - 46 });
      hero.setState('swing');
      fiend.hit();
      globalThis.ffmFx?.fiendHurt(fiend);
      if (!hero.strike || hero.strike === 'sword') audio.playSwordSwing();
      else audio.playStrike(hero.strike);
      globalThis.ffmHaptics?.impact();
      audio.playFiendHit?.(fiend.type);

      if (fiend.isDead) {
        audio.playEnemyDeath(fiend.type);
        state.enemiesDefeated++;
        recordPracticeEncounterDefeated();
        activeFiend = null;
        input.disable();
        inputDisabled = true;
        heroLunge = { phase: 'back', targetX: HERO_X, onArrive: () => {
          scheduleGameplayTimeout(() => {
            if (checkAllDefeated()) triggerWaveClear();
            else { spawnTimer = spawnInterval; inputDisabled = false; }
          }, 300);
        }};
      } else {
        const preserveTimer = shouldPreserveProblemTimer(fiend);
        activeFiend = null;
        input.disable();
        inputDisabled = true;
        heroLunge = {
          phase: 'back',
          targetX: HERO_X,
          onArrive: () => {
            const cfg = platform.getCurrentLevelConfig();
            if (cfg) fiend.problem = nextHitProblem(fiend, cfg);
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

function handleWrongAnswer({ timeout = false, origin = null } = {}) {
  const problem = activeFiend.problem;
  attemptSummary.recordAnswer(problem, false, { timeout });
  if (!practiceRun) rememberMissedProblem(problem, currentLevelIndex);
  if (practiceRun && !['targeted', 'shapes'].includes(practiceRun.kind)) {
    practiceRun.session.recordAnswer(problem, false, { timeout });
  }
  activeFiend._answerFeedback = timeout ? 'timeout' : 'incorrect';
  state.combo = 0;
  globalThis.ffmScreenFx?.play('wrongAnswer', origin ? { origin } : undefined);
  globalThis.ffmScreenFx?.schedule(0.12, () => globalThis.ffmScreenFx?.play('heroHurt', { x: HERO_X, y: hero.y - HERO_CENTRE_ABOVE_GROUND }));
  hero.setState('hurt');
  activeFiend._redFlash = 0.5;  // red flash = wrong answer
  activeFiend.setState('attack');
  if (timeout) audio.playTimeout?.();
  else audio.playWrong?.();
  // The body blow lands with the strike animation, not on the answer beep.
  audio.playHeroHurt?.(0.12);
  globalThis.ffmHaptics?.impact();
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
  if (!practiceRun && !healTipShown && state.hearts <= state.maxHearts / 2) {
    healTipShown = true;
    showHealTip();
  }

  scheduleGameplayTimeout(() => {
    if (activeFiend) {
      // The spike slow is *not* dropped here: onFiendRetreated() restores the
      // base speed once the fiend actually walks off, and remembers the slow so
      // a requeued fiend returns still held by a running spike. Clearing it at
      // this point (before the retreat) is what used to lose it for good.
      const p = activeFiend.problem;
      // Shapes problems have no text question (see shapes.js's
      // displayMode: 'shapes') — fall back to a plain "Answer: N" reveal.
      activeFiend._revealText = p.question
        ? revealQuestion(p)
        : t('feedback.shapesAnswer', { count: p.answer });
      activeFiend.setState('reveal');

      scheduleGameplayTimeout(() => {
        if (activeFiend) {
          if (activeFiend.isElite && practiceRun?.kind !== 'elite') {
            const cfg = platform.getCurrentLevelConfig();
            const regularHp = cfg?.fiendHP ?? 1;
            activeFiend.isElite = false;
            activeFiend.hp = Math.max(1, Math.min(activeFiend.hp, regularHp));
          }
          if (state.isShapesMode && !practiceRun.endless) {
            const completedFiend = activeFiend;
            practiceRun.session.recordAnswer(problem, false, { timeout });
            fiends = fiends.filter(fiend => fiend !== completedFiend);
            activeFiend = null;
            if (practiceRun.session.isComplete()) finishPracticeSession();
            else {
              inputDisabled = false;
              spawnTimer = spawnInterval;
            }
          } else {
            requeuedFiends.push(activeFiend);
            activeFiend.setState('retreat');
          }
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
  lastCastAbility = null;
  const mode = getCurrentInputMode();
  // A requeued fiend comes back with a freshly computed base speed; if it was
  // slowed before it retreated, the active spike re-applies the slow on top.
  // `spikeSlowOnReturn` is what onFiendRetreated() left behind, because the
  // base speed has to be restored for the walk-off.
  const wasSpikeSlowed = typeof restoreSpikeSlow === 'function' &&
    (Boolean(fiend.spikeSlowed) || fiend.spikeSlowOnReturn === true);
  if (wasSpikeSlowed) {
    restoreSpikeSlow(fiend);
    if (typeof spikeSlowedFiends !== 'undefined') spikeSlowedFiends.delete(fiend);
  }
  delete fiend.spikeSlowOnReturn;
  fiend.walkSpeed = getFiendWalkSpeed(state.timerMax, fiend.x,
    typeof abilityRuntime !== 'undefined' ? abilityRuntime?.fiendSpeedMultiplier : 1);
  if (wasSpikeSlowed && typeof abilityRuntime !== 'undefined' &&
      abilityRuntime?.spikeState.active &&
      typeof applySpikeSlow === 'function' &&
      applySpikeSlow(fiend, abilityRuntime.spikeState.factor)) {
    spikeSlowedFiends.add(fiend);
  }
  activeFiend = fiend;
  state.timerRemaining = getProblemTimerRemaining(state.timerMax, state.timerRemaining, preserveTimer);
  state.timerActive = !['assisted', 'targeted'].includes(practiceRun?.kind);
  answerClock.reset();
  if (mode === 'multiple-choice') {
    const mcOptions = fiend.problem.options ??
      [fiend.problem.answer, ...(fiend.problem.distractors || [])].sort(() => Math.random() - 0.5);
    input.setMCOptions(mcOptions, fiend.problem.optionsHtml ?? null);
  }
  input.enable(mode);
}

function shouldPreserveProblemTimer(fiend) {
  return practiceRun?.kind === 'elite' ? false : shouldPreserveTimerAfterHit(fiend);
}

function updatePaceAdapter() {
  if (practiceRun) return;
  if (answerTimes.length < 3) return;
  const avg = answerTimes.reduce((a, b) => a + b, 0) / answerTimes.length;
  if (avg < state.timerMax * 0.4) {
    spawnInterval = Math.max(1.5, spawnInterval * 0.9);
  } else if (avg > state.timerMax * 0.8) {
    spawnInterval = Math.min(6.0, spawnInterval * 1.1);
  }
}

// A successful dragon breath in the campaign — web and app alike — ends the
// level: every encounter still queued, requeued or on screen is cleared at
// once, paid a deterministic bonus proportional to how many remain, and then
// handed to the normal single level-clear path. Practice and Shapes keep
// today's present-fiends-only breath and are never campaign-completed here.
function finishDragonLevel() {
  if (dragonFinishResolved) return true;
  if (practiceRun || state.isShapesMode) return false;
  dragonFinishResolved = true;

  const remainingEncounters = countDragonRemainingEncounters({ fiends, spawnQueue, requeuedFiends });
  const perFiendValue = dragonFinishPerFiendValue(platform.getCurrentLevelConfig());
  state.score += remainingEncounters * perFiendValue;
  state.enemiesDefeated += remainingEncounters;

  spawnQueue = [];
  requeuedFiends = [];
  fiends = [];
  activeFiend = null;
  pendingProblemActivation = null;
  heroLunge = null;
  activeLightningBolts = [];
  activeFireballs = [];
  state.timerActive = false;
  inputDisabled = true;
  input.disable();
  hud.update(state);
  triggerWaveClear();
  return true;
}

function triggerWaveClear() {
  if (waveClearing) return;
  waveClearing = true;
  gameRunning = false;
  // The storm belongs to the level, so the level-clear fanfare plays in clear
  // weather.
  if (typeof stopStorm === 'function') stopStorm();
  syncKeepAwake();
  hero.setState('victory');

  if (practiceRun) {
    scheduleGameplayTimeout(finishPracticeSession, 1200);
    return;
  }
  // Level-complete fanfare: the bundled hymn, or the synth cue when it cannot
  // be decoded. The call stays inline because tests evaluate these functions
  // on their own.
  if (state.level < (state.campaign === 2 ? TOTAL_LEVELS_2 : TOTAL_LEVELS)) {
    const hymn = audio.playVictoryHymn?.();
    if (hymn?.then) hymn.then((started) => { if (!started) audio.playLevelClear?.(); });
    else audio.playLevelClear?.();
  }
  globalThis.ffmHaptics?.levelClear();
  const healed = state.hearts < state.maxHearts;
  state.hearts = state.maxHearts;
  if (healed) {
    hero._healAura = GAME_CONFIG.healingAuraDuration;
    audio.playHeal?.();
    globalThis.ffmHaptics?.heal();
    globalThis.ffmScreenFx?.play('heal', { x: hero.x, y: hero.y - HERO_CENTRE_ABOVE_GROUND });
  }
  hud.update(state);

  scheduleGameplayTimeout(() => {
    triggerLevelClear();
  }, 2000);
}

function ensurePracticeBadgeRetryButton() {
  if (!gameOverOverlay || practiceBadgeRetryButton) return practiceBadgeRetryButton;
  practiceBadgeRetryButton = document.createElement('button');
  practiceBadgeRetryButton.type = 'button';
  practiceBadgeRetryButton.id = 'btn-retry-practice-badges';
  practiceBadgeRetryButton.className = 'diff-btn';
  practiceBadgeRetryButton.textContent = t('practice.retryBadgeSave');
  practiceBadgeRetryButton.hidden = true;
  practiceBadgeRetryButton.addEventListener('click', savePracticeBadges);
  gameOverOverlay.appendChild(practiceBadgeRetryButton);
  return practiceBadgeRetryButton;
}

async function savePracticeBadges() {
  if (!platform.isApp || !practiceRun?.completed || practiceRun.savedBadges || practiceRun.badgeSavePending) return;
  if (!runProfileId || typeof platform.localProfiles.recordPractice !== 'function') return;
  practiceRun.badgeSavePending = true;
  const retryButton = ensurePracticeBadgeRetryButton();
  if (retryButton) retryButton.disabled = true;
  try {
    const badgeIds = practiceRun.badgeIds ?? getPracticeBadgeIds(
      [...practiceRun.operations], practiceRun.kind,
    );
    practiceRun.badgeIds = badgeIds;
    const result = await platform.localProfiles.recordPractice({
      profileId: runProfileId,
      sessionId: practiceRun.sessionId,
      badgeIds,
    });
    if (!result?.persisted) throw new Error('Practice badges were not persisted');
    practiceRun.savedBadges = true;
    if (retryButton) retryButton.hidden = true;
    await refreshPracticeBadges();
  } catch (error) {
    console.error('Unable to save practice badges', error);
    gameOverScore.textContent = t('practice.badgesSaveFailed');
    if (retryButton) retryButton.hidden = false;
  } finally {
    practiceRun.badgeSavePending = false;
    if (retryButton) retryButton.disabled = false;
  }
}

function finishPracticeSession() {
  if (!practiceRun || practiceRun.endless || practiceRun.completed) return;
  practiceRun.completed = true;
  triggerGameOver(true);
  savePracticeBadges();
}

function returnToTitle() {
  // Leaving the campaign ends the run; the clock is not resumed by coming back.
  if (typeof speedrunTimer !== 'undefined') {
    speedrunTimer.abandon();
    speedrunUi?.updateClock(null);
  }
  setAnswerInputVisible(false);
  if (typeof gameplayChrome !== 'undefined') gameplayChrome?.clearBonusNotice?.();
  practiceRun = null;
  state.isShapesMode = false;
  pendingSkillIntro = null;
  activeSkillIntro = null;
  if (skillIntroOverlay) skillIntroOverlay.style.display = 'none';
  diffSelect.style.display = 'flex';
  if (typeof startMenuMusic === 'function') startMenuMusic();
  updateHUDLogoutVisibility();
  refreshProfileAndLeaderboard();
  profileUI?.refresh();
  refreshPracticeBadges();
}

// Shows the next scene under the level-clear score: the upcoming level's art
// and title, or the finale once level 60 is cleared. It resolves the image
// exactly like the renderer (level art, then chapter stage) and requests only
// that one scene; a level file that fails to load swaps to the chapter stage.
function renderLevelClearPreview(nextLevel) {
  if (!levelClearPreview) return;
  const number = Number.parseInt(nextLevel, 10);
  levelClearPreview.style.display = 'flex';
  if (!Number.isInteger(number) || number > TOTAL_LEVELS) {
    levelClearPreviewImage.onerror = null;
    levelClearPreviewImage.removeAttribute('src');
    levelClearPreviewImage.style.display = 'none';
    levelClearPreviewImage.alt = '';
    levelClearPreviewTitle.textContent = t('overlay.finaleTitle');
    return;
  }
  const stageUrl = stageArtUrl(number);
  levelClearPreviewImage.style.display = '';
  levelClearPreviewImage.onerror = () => {
    levelClearPreviewImage.onerror = null;
    levelClearPreviewImage.src = stageUrl;
  };
  levelClearPreviewImage.src = resolveLevelBackground(number, LEVEL_ART_MANIFEST);
  levelClearPreviewImage.alt = t('overlay.nextSceneAlt', { level: number });
  levelClearPreviewTitle.textContent = t('overlay.nextSceneTitle', { level: number });
}

function triggerLevelClear() {
  setAnswerInputVisible(false);
  if (typeof gameplayChrome !== 'undefined') gameplayChrome?.clearBonusNotice?.();
  if (practiceRun) {
    finishPracticeSession();
    return;
  }
  spawnQueue = [];
  requeuedFiends = [];

  const completedLevelNum = state.level;          // 1-based display number
  // The run's split for this level, recorded before the card goes up: a level
  // best only counts for a level that was actually cleared.
  const speedrunSplit = typeof speedrunTimer === 'undefined' ? null : speedrunTimer.completeLevel();
  if (speedrunSplit) {
    speedrunRecords.recordLevel(speedrunSplit.level, speedrunSplit.levelMs);
    speedrunSplits.push({ level: speedrunSplit.level, ms: Math.round(speedrunSplit.levelMs) });
    if (speedrunSplit.final) {
      speedrunRecords.recordRun(speedrunSplit.runMs);
      reportSpeedrunRun(speedrunSplit.runMs, speedrunSplits);
    }
  }
  const completedIndex = completedLevelNum - 1;   // 0-based LevelConfig index
  const campaign2 = state.campaign === 2;
  // Campaign 2 progress stays on this device; it has no server or profile record yet.
  if (campaign2) campaign2Progress().markCleared(completedLevelNum);
  if (!practiceRun && !campaign2 && !completedLevelSave && (platform.isApp || platform.isLoggedIn)) {
    completedLevelSave = createLevelCompletion(platform, {
      level: completedLevelNum, score: state.score - levelStartScore,
      difficulty: state.difficulty, profileId: runProfileId, completionId: createCompletionId(),
      ...(platform.isApp ? { attemptSummary: attemptSummary.snapshot() } : {}),
    });
  }
  lastLevelClearNum = completedLevelNum;
  levelClearTitle.textContent = t('overlay.levelClearTitle', { level: completedLevelNum });
  levelClearScore.textContent = t('overlay.scoreLine', { score: state.score });
  if (campaign2) {
    // The preview names the next scene by its Campaign 1 number, which means nothing here.
    levelClearPreview?.style.setProperty('display', 'none');
  } else if (typeof renderLevelClearPreview === 'function') renderLevelClearPreview(state.level + 1);
  renderAttemptAccomplishment('level-attempt-summary');
  topBar.style.display = 'flex';
  const finishCompletion = async action => {
    if (completionPending) return;
    completionPending = true;
    for (const button of [btnNextLevel, btnReplayLevel, btnSaveScoreReturnTitle]) button.disabled = true;
    try {
      if (completedLevelSave) {
        completionFeedback = await completedLevelSave();
        renderAttemptAccomplishment('level-attempt-summary');
      }
      await action();
    } catch (error) {
      console.error('Unable to save completed level', error);
      levelClearScore.textContent = t('overlay.saveScoreFailed');
    } finally {
      completionPending = false;
      for (const button of [btnNextLevel, btnReplayLevel, btnSaveScoreReturnTitle]) button.disabled = false;
    }
  };
  btnNextLevel.textContent = t(completedLevelNum >= (state.campaign === 2 ? TOTAL_LEVELS_2 : TOTAL_LEVELS) ? 'overlay.finishGame' : 'overlay.nextLevel');
  btnNextLevel.onclick = () => finishCompletion(() => {
    if (completedLevelNum >= (state.campaign === 2 ? TOTAL_LEVELS_2 : TOTAL_LEVELS)) triggerGameOver(true);
    else {
      levelClearOverlay.style.display = 'none';
      startLevel(completedIndex + 1);
    }
  });
  btnReplayLevel.onclick = () => finishCompletion(() => {
    // A replay is not part of the run: it would compare a fresh attempt against
    // a clock that already carries the levels behind it.
    if (typeof speedrunTimer !== 'undefined') speedrunTimer.abandon();
    levelClearOverlay.style.display = 'none';
    if (typeof levelClearPreview !== 'undefined' && levelClearPreview) levelClearPreview.style.display = 'none';
    resetLevelAttempt(state, levelStartScore);
    startLevel(completedIndex);
  });
  btnSaveScoreReturnTitle.style.display = '';
  if (platform.isApp || !platform.isLoggedIn) {
    btnSaveScoreReturnTitle.textContent = t('overlay.returnTitle');
  }
  btnSaveScoreReturnTitle.onclick = () => finishCompletion(async () => {
    if (typeof speedrunTimer !== 'undefined') speedrunTimer.abandon();
    if (!practiceRun && !campaign2 && !platform.isApp && platform.isLoggedIn) await platform.postHighScore(state.score, state.level);
    await refreshProfileAndLeaderboard();
    levelClearOverlay.style.display = 'none';
    if (typeof levelClearPreview !== 'undefined' && levelClearPreview) levelClearPreview.style.display = 'none';
    audio.stopBGM();
    diffSelect.style.display = 'flex';
    if (typeof startMenuMusic === 'function') startMenuMusic();
    updateHUDLogoutVisibility();
    profileUI?.refresh();
  });
  levelClearOverlay.style.display = 'flex';
  globalThis.ffmScreenFx?.play('levelWon');
  audio.playWinPop?.();
  if (completedLevelSave) return finishCompletion(() => refreshProfileAndLeaderboard());
}

function triggerGameOver(won = false) {
  if (typeof speedrunTimer !== 'undefined') speedrunTimer.abandon();
  // The storm ends with the level, whichever way it ended.
  if (typeof stopStorm === 'function') stopStorm();
  setAnswerInputVisible(false);
  if (typeof gameplayChrome !== 'undefined') gameplayChrome?.clearBonusNotice?.();
  campaignWon = won;
  globalThis.ffmScreenFx?.play(won ? 'levelWon' : 'gameOver');
  gameplayTimers.length = 0;
  activeLightningBolts = [];
  activeFireballs = [];
  activeDragons = [];
  gameRunning = false;
  if (typeof clearSpikeSlow === 'function') clearSpikeSlow();
  resetHealHold();
  input.disable();
  inputDisabled = true;
  state.timerActive = false;
  if (won && !practiceRun) {
    // The hymn replaces the synth finale; playCampaignVictory stays as the
    // fallback for a build where the track cannot be decoded.
    const hymn = audio.playVictoryHymn?.();
    if (hymn?.then) hymn.then((started) => { if (!started) audio.playCampaignVictory?.(); });
    else audio.playCampaignVictory?.();
  }
  levelClearOverlay.style.display = 'none';
  if (typeof levelClearPreview !== 'undefined' && levelClearPreview) levelClearPreview.style.display = 'none';
  topBar.style.display = 'flex';
  audio.stopBGM();
  syncKeepAwake();
  if (!won) audio.playGameOver();
  const resultTitle = document.getElementById('game-over-title');
  if (resultTitle) resultTitle.textContent = t(practiceRun
    ? won ? 'practice.resultsTitle' : 'overlay.gameOverTitle'
    : won ? 'campaign.victory' : 'overlay.gameOverTitle');
  // Shapes mode is unscored — never submit a high score for it.
  if (platform.isLoggedIn && !practiceRun && !state.isShapesMode && state.campaign !== 2) {
    platform.postHighScore(state.score, state.level).then(() => {
      refreshProfileAndLeaderboard();
    }).catch(() => {});
  }
  gameOverScore.textContent = practiceRun?.endless ? t('overlay.shapesTryAgain') : practiceRun
    ? t('practice.completed', {
      correct: practiceRun.session.snapshot().correctAnswers,
      resolved: practiceRun.session.snapshot().resolvedProblems,
      encounters: practiceRun.session.snapshot().encountersDefeated,
    })
    : state.isShapesMode ? t('overlay.shapesTryAgain')
    : t('overlay.scoreLine', { score: state.score });
  renderAttemptAccomplishment('defeat-attempt-summary', won ? completionFeedback : null);
  btnRetryLevel.textContent = practiceRun ? t('practice.retry')
    : won ? t('campaign.replay', { level: state.level }) : t('overlay.retryLevel');
  btnRetryLevel.onclick = () => {
    gameOverOverlay.style.display = 'none';
    if (practiceRun) {
      const { kind, sourceLevel, endless } = practiceRun;
      resetLevelAttempt(state, 0);
      return startPracticeSession(kind, sourceLevel, { endless });
    }
    if (state.isShapesMode) {
      resetLevelAttempt(state, 0);
      return startPracticeSession('shapes', 1);
    }
    resetLevelAttempt(state, levelStartScore);
    if (typeof beginAbilityRun === 'function') beginAbilityRun(currentLevelIndex + 1);
    startLevel(currentLevelIndex);
  };
  btnReturnTitle.onclick = () => {
    gameOverOverlay.style.display = 'none';
    returnToTitle();
  };
  gameOverOverlay.style.display = 'flex';
}

// --- Timer ---
function updateTimer(dt) {
  if (!state.timerActive) return;
  // The earth spike slows the clock it was cast against, not just the sprite:
  // a slowed fiend's problem timer burns at the spike's factor, so the spell
  // buys real answering time. Slowing only the walk-in made the fiend fall
  // behind its own timer — the sprite was still marching when the clock had
  // already run out. The `typeof` guards keep extracted-function tests running
  // without main.js.
  let step = dt;
  if (typeof abilityRuntime !== 'undefined' && abilityRuntime?.spikeState.active &&
      typeof activeFiend !== 'undefined' && activeFiend?.spikeSlowed) {
    step = dt * abilityRuntime.spikeState.factor;
  }
  state.timerRemaining -= step;
  if (state.timerRemaining <= 0) {
    state.timerRemaining = 0;
    state.timerActive = false;
    handleWrongAnswer({ timeout: true });
  }
}

// --- Main game loop ---
let animFrameId = null;
let lastTs = null;
// Set once the loop has drawn its final frame and stopped asking for more.
let loopParked = false;
// Paces the red edge pulse while the hero is at low health.
const lowHealthBeat = createHeartbeat();

// Repainting the playfield is a full-canvas raster every frame, and the phone
// pays for it in heat and battery. A paused level, the title screen, the
// level-clear card and game over each put an opaque overlay over the canvas, so
// the loop parks instead of drawing frames nobody can see. It stays awake while
// a level is live, while a gameplay timer still has to mature (the practice
// wave-clear delay and the chained hit sequences outlive gameRunning) and while
// the screen-fx layer still has particles to fade out.
function needsFrame() {
  if (paused) return false;
  if (gameRunning) return true;
  if (gameplayTimers.length > 0) return true;
  return Boolean(globalThis.ffmScreenFx?.isActive?.());
}

// Wakes a parked loop. A no-op while it is already running.
function kickGameLoop() {
  if (!animFrameId) gameLoop(performance.now());
}

function gameLoop(ts) {
  if (needsFrame()) {
    loopParked = false;
  } else if (loopParked) {
    animFrameId = null;
    // The next run starts a fresh clock, so a parked gap never reaches gameplay.
    lastTs = null;
    return;
  } else {
    // One last frame, so the DOM (timer bar, gameplay chrome, HUD) reflects the
    // state the loop leaves the screen in.
    loopParked = true;
  }
  animFrameId = requestAnimationFrame(gameLoop);

  const dt = frameDelta(ts, lastTs);
  lastTs = ts;

  if (!paused && (globalThis.ffmScreenFx?.isActive() || globalThis.ffmStormFx?.isActive())) {
    // A storm level advances the layer at 30 Hz (see fxStepFor); every other
    // level keeps one particle step per rendered frame.
    const fxStep = fxStepFor(dt, stormRunning, fxFrameCarry);
    fxFrameCarry = fxStep.carry;
    if (fxStep.step > 0) {
      globalThis.ffmScreenFx?.frame(fxStep.step);
      globalThis.ffmStormFx?.frame(fxStep.step);
    }
    // Whole-screen shake: the canvas moves with the same offset the layer uses
    // for its particles, plus a hair of scale so no gap shows at the edges.
    // Both layers can shake; a bolt on the weather layer must move the scene
    // with it, or the rain would slide out of the storm.
    const shake = globalThis.ffmScreenFx?.getShakeOffset?.();
    const stormShake = globalThis.ffmStormFx?.getShakeOffset?.();
    const sx = (shake ? shake.x : 0) + (stormShake ? stormShake.x : 0);
    const sy = (shake ? shake.y : 0) + (stormShake ? stormShake.y : 0);
    // The scale is not free: it re-grids the pixel art while it is on screen, so
    // a sub-pixel nudge is not worth it. Only a real impact (storm, earth) is
    // allowed to move the camera — the spawn portal deliberately does not shake.
    if (Math.abs(sx) >= 0.75 || Math.abs(sy) >= 0.75) {
      canvas.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) scale(1.015)`;
    } else if (canvas.style.transform) {
      canvas.style.transform = '';
    }
  } else if (canvas.style.transform) {
    canvas.style.transform = '';
  }

  if (!paused) advanceGameplayTimers(dt);

  // The level bonus pill counts down in gameplay time only: a pause freezes it
  // and a level clear hides it (see triggerLevelClear).
  if (typeof gameplayChrome !== 'undefined') gameplayChrome?.tickBonusNotice?.(dt, { paused });

  // Ability cooldowns only advance while an encounter is live, so pausing,
  // level clear, game over and loading never burn cooldown time. The bar gets
  // 0-1 progress every frame and only rewrites DOM text when a value changes.
  abilityRuntime?.tick(dt, { encounterRunning: gameRunning && !paused });
  // The spike slow expires with its runtime state; restore every fiend it held.
  if (abilityRuntime && !abilityRuntime.spikeState.active && spikeSlowedFiends.size > 0) {
    clearSpikeSlow();
  }
  // The run clock counts gameplay only: the same gate the HUD uses to decide
  // that a level is on screen, so pauses, the level-clear card and loading are
  // never part of a time.
  if (typeof speedrunTimer !== 'undefined') {
    if (gameRunning && !paused && !practiceRun && !state.isShapesMode
      && diffSelect.style.display === 'none' && levelClearOverlay.style.display === 'none') {
      speedrunTimer.tick(dt);
    }
    speedrunUi?.updateClock(speedrunRecords.enabled ? speedrunTimer.snapshot() : null);
  }
  abilityBar.update({
    level: state.campaign === 2 ? ABILITY_LEVEL : state.level,
    progress: abilityRuntime ? (id) => abilityRuntime.progress(id) : 1,
    runtime: abilityRuntime,
    bonus: typeof levelBonusRuntime !== 'undefined' ? levelBonusRuntime : null,
    cooldowns: typeof levelBonusCooldowns !== 'undefined' ? levelBonusCooldowns : null,
    spikeTargetsLeft: typeof spikeSpawnSlowLeft !== 'undefined' ? spikeSpawnSlowLeft : 0,
  });

  if (gameRunning && !paused) {
    if (lowHealthBeat.tick(dt, isLowHealth(state.hearts, state.maxHearts))) {
      globalThis.ffmScreenFx?.play('lowHealthPulse');
    }
    answerClock.advance(dt, state.timerActive && !inputDisabled);
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
    const canHeal = !practiceRun && isMCLevel && hero.state !== 'hurt';
    const healResult = updateHealHold(healHoldProgress, dt, {
      isHolding: isHealHolding,
      canHeal,
      secondsPerHeart: GAME_CONFIG.healHoldSecondsPerHeart,
    });
    healHoldProgress = healResult.progress;
    emitHealCharge(isHealHolding && canHeal, healHoldProgress, dt);
    if (healResult.healed) {
      const previousHearts = state.hearts;
      state.hearts = Math.min(state.maxHearts, state.hearts + 1);
      if (state.hearts > previousHearts) {
        audio.playHeal?.();
        globalThis.ffmHaptics?.heal();
        globalThis.ffmScreenFx?.play('heal', { x: hero.x, y: hero.y - HERO_CENTRE_ABOVE_GROUND });
      }
      hud.update(state);
    }
    hero._holdHealActive = isHealHolding && canHeal;
    hero._holdHealRatio = getHealHoldRatio(healHoldProgress, GAME_CONFIG.healHoldSecondsPerHeart);

    fiends.forEach(f => f.update(dt));
    activeLightningBolts = activeLightningBolts.filter(b => { b.update(dt); return !b.isDone; });
    activeFireballs = activeFireballs.filter(b => { b.update(dt); return !b.isDone; });
    // Snapshot before resolveDragonBreath changes any state, so the hurt FX
    // lands on the fiends that were actually hit.
    const breathTargets = fiends.filter(f => !f.isDead && f.state !== 'death' && f.state !== 'retreat');
    activeDragons.forEach(d => {
      d.update(dt);
      if (d.breathJustCompleted) {
        audio.playDragonBreath();
        if (!finishDragonLevel()) {
          state.enemiesDefeated += resolveDragonBreath(fiends);
          for (const f of breathTargets) {
            globalThis.ffmFx?.fiendHurt(f);
          }
          if (activeFiend?.isDead || activeFiend?.state === 'death') {
            activeFiend = null;
            pendingProblemActivation = null;
            state.timerActive = false;
            input.disable();
          }
          if (checkAllDefeated()) triggerWaveClear();
          else {
            inputDisabled = false;
            spawnTimer = spawnInterval;
          }
        }
      }
    });
    activeDragons = activeDragons.filter(d => !d.isDone);

    if (heroLunge) {
      // Both phases ease instead of running at a constant speed: the dash
      // accelerates into the strike and the return decelerates into the home
      // position. A linear slide plus a dead stop is what made the old lunge
      // read as a sprite being dragged across the screen.
      if (heroLunge.phase === 'out') {
        // The legs carry the approach: the walk cycle is what makes the travel
        // read as running. A swing/hurt/dead clip owns its own frames, so it
        // plays out first.
        if (hero.state !== 'swing' && hero.state !== 'hurt' && hero.state !== 'dead') {
          hero.setState('walk');
        }
      } else if (hero.anim.clip === 'swing') {
        // The way back is a rebound, not a walk: the strike's last pose is held
        // while the dash carries him home, so he never runs backwards while
        // facing forwards. The clip finishes first, so the strike is not cut.
        hero.holdPose();
      }
      if (heroLunge.phase === 'out') {
        // chase the fiend's current position so they meet naturally
        const targetX = heroLunge.fiend.x - 65;
        if (hero.x >= targetX - 4) {
          hero.x = targetX;
          const cb = heroLunge.onArrive;
          heroLunge = null; // clear before cb so cb can install 'back' phase
          cb();
        } else {
          if (heroLunge.startX === undefined) heroLunge.startX = hero.x;
          const total = Math.max(1, targetX - heroLunge.startX);
          const progress = Math.min(1, (hero.x - heroLunge.startX) / total);
          hero.x += LUNGE_SPEED * (0.4 + 1.2 * progress) * dt;
        }
      } else {
        // 'back' — return to home position
        if (hero.x <= HERO_X + 4) {
          hero.x = HERO_X;
          const cb = heroLunge.onArrive;
          heroLunge = null;
          if (cb) cb();
        } else {
          if (heroLunge.startX === undefined) heroLunge.startX = hero.x;
          const total = Math.max(1, heroLunge.startX - HERO_X);
          const progress = Math.min(1, (heroLunge.startX - hero.x) / total);
          hero.x -= LUNGE_SPEED * (1.6 - 1.2 * progress) * dt;
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

    // The dash is over: drop the walk/rebound pose so the hero does not keep
    // running (or drifting) on the spot, and so the idle scroll below cannot
    // start on its own. A finished strike then hands over to idle as usual.
    if (!heroLunge) {
      if (hero.state === 'walk') hero.setState('idle');
      else hero.releasePose();
    }

    if (hero.state === 'walk' && !heroLunge) state.scrollX += 100 * dt;
    hero.lunging = heroLunge !== null && hero.state !== 'swing';
  } else {
    lowHealthBeat.reset();
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
      } else if (f.problem.visual && f.state !== 'reveal') {
        renderer.drawStoneSumBubble(f.x, f.y - 20 * LOGICAL_PX, f.problem.visual.a, f.problem.visual.b, f === activeFiend);
      } else {
        const bubbleText = f.state === 'reveal'
          ? (f._revealText || f.problem.question)
          : f.problem.question;
        renderer.drawSpeechBubble(f.x, f.y - 20 * LOGICAL_PX, bubbleText, f === activeFiend);
      }
    }
    // The app draws the question timer as the DOM header bar (see
    // mobile/game/timer-bar.js) with continuous colours, so the canvas bar
    // stays a web-only visual and keeps its banded colours byte-for-byte.
    if (f === activeFiend && state.timerActive && !platform.isApp) {
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
  const gameplayVisible = gameRunning && diffSelect.style.display === 'none' &&
    levelClearOverlay.style.display === 'none';
  if (document.body.dataset.gameplay !== String(gameplayVisible)) {
    document.body.dataset.gameplay = String(gameplayVisible);
  }
  gameplayChrome.setVisible(gameplayVisible && !paused);
  const reward = getComboRewardProgress(state.combo);
  const cfg = platform.getCurrentLevelConfig();
  // The app's readout row is one line tall; on a 375 px phone the qualified
  // labels do not fit, so the app drops to name plus countdown (header-labels.js).
  const compactHeader = useCompactHeaderLabels({
    isApp: platform.isApp,
    width: globalThis.innerWidth ?? 0,
  });
  const rewardLabel = formatRewardLabel(reward, { compact: compactHeader, translate: t });
  const feedback = activeFiend?.state === 'reveal' ? {
    kind: activeFiend._answerFeedback,
    // The header shows the answer alone and keeps it short enough for the
    // question column; the fiend's speech bubble carries the full sentence.
    question: activeFiend.problem.question
      ? revealQuestion(activeFiend.problem)
      : t('feedback.shapesAnswerShort', { count: activeFiend.problem.answer }),
  } : null;
  const practiceProgress = practiceRun?.session.snapshot();
  const encounterProgress = practiceRun?.endless ? null : state.isShapesMode
    ? { defeated: practiceProgress.resolvedProblems, total: 10, slots: state.levelSwordSlots || 10 }
    : {
      defeated: state.enemiesDefeated,
      // The level's own count, shrunk by storm removals, so a cast takes the
      // removed enemies' swords off the portrait row instead of filling them.
      total: state.levelEnemies > 0
        ? state.levelEnemies
        : practiceRun
          ? practiceRun.kind === 'targeted' ? practiceRun.targetProblems.length : 10
          : cfg?.waveSize ?? 0,
      // What the level started with: the row keeps a slot for every one of
      // them, so the shrunk total shows up as empty slots on the right.
      slots: state.levelSwordSlots,
    };
  gameplayChrome.update({
    ...state, paused, reveal: inputDisabled || ['reveal', 'retreat', 'death'].includes(activeFiend?.state),
    questionActive: Boolean(activeFiend && !inputDisabled &&
      !['reveal', 'retreat', 'death'].includes(activeFiend.state)),
    healingEnabled: !practiceRun,
    progressLabel: !encounterProgress ? '' : state.isShapesMode
      ? t('practice.questionProgress', { resolved: encounterProgress.defeated, total: encounterProgress.total })
      : formatEncounterLabel(encounterProgress, { compact: compactHeader, translate: t }),
    rewardLabel: practiceRun || state.isShapesMode ? '' : lastCastAbility && inputDisabled
      ? t('reward.cast', { ability: t(`reward.${lastCastAbility}`) }) : rewardLabel,
    healLabel: practiceRun ? '' : t('gameplay.healProgress', {
      percent: Math.round(getHealHoldRatio(healHoldProgress, GAME_CONFIG.healHoldSecondsPerHeart) * 100),
    }),
    healHint: practiceRun ? '' : t('overlay.healTipBody'),
    feedback,
  }, activeFiend?.problem ?? null);
  // Publish the live timer state once per frame for the app-only header bar
  // (and any later portrait timer). Reading state.timerRemaining here keeps it
  // in sync through pause, correction, retry and preserved elite timers; the
  // hook is null on the web build, so this is a no-op there.
  mobileUi?.updateTimerState({
    remaining: state.timerRemaining,
    max: state.timerMax,
    untimed: !(state.timerMax > 0) || practiceProgress?.untimed === true,
    paused,
  });
  // The shared portrait sword row mirrors the "Defeated" readout above; it is
  // hidden by CSS on the web's landscape layout and in the app's landscape.
  encounterSwords.updateEncounterProgress(encounterProgress ?? { defeated: 0, total: 0 });
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
    platform.verifyEmail(verifyToken)
      .then(() => { authStatusMessage.textContent = t('auth.emailVerified'); })
      .catch(err => { authStatusMessage.textContent = t('auth.verificationFailed', { message: translateServerMessage(err.message) }); });
    return;
  }

  if (confirmEmailToken) {
    history.replaceState(null, '', window.location.pathname);
    authStatusModal.style.display = 'flex';
    authStatusMessage.textContent = t('auth.confirmingEmailChange');
    platform.confirmEmailChange(confirmEmailToken)
      .then(() => { authStatusMessage.textContent = t('auth.emailChangeConfirmed'); })
      .catch(err => { authStatusMessage.textContent = t('auth.emailChangeConfirmFailed', { message: translateServerMessage(err.message) }); });
    return;
  }

  if (resetToken) {
    history.replaceState(null, '', window.location.pathname);
    pendingResetToken = resetToken;
    showAuthForm(resetPasswordForm);
    setAuthModalVisible(true);
  }
}

if (!platform.isApp) handleUrlAuthTokens();

// The app build has no leaderboard; its title screen shows the local
// personal-development panel instead (see refreshProfileAndLeaderboard).
if (!platform.isApp) {
  // Show a loading placeholder immediately so the leaderboard section never
  // looks empty/broken while the first network round-trip is in flight, and
  // kick off the leaderboard fetch right away rather than waiting on
  // platform.refresh() to settle first — the leaderboard doesn't need auth, so
  // serializing it behind the refresh round-trip only doubles the wait
  // (each hop can also hit a cold Lambda) before anything is shown.
  leaderboardList.innerHTML = `<li>${t('leaderboard.loading')}</li>`;
}
// App hero picker: the shared grid in a dialog over the profile list. The colour
// schemes come with the regular full unlock, so lock state is the cached unlock
// entitlement (works offline), and a locked scheme opens the regular paywall.
let heroUnlocked = false;
async function readHeroUnlocked() {
  try {
    heroUnlocked = (await platform.getBillingStatus())?.premium_access === true;
  } catch {
    heroUnlocked = false;
  }
}
const heroPortraitFor = profile => heroAssetUrl(resolveHero(profile.hero, { entitled: true }).portrait);
const canSwitchProfiles = () => diffSelect.style.display !== 'none' && !completionPending && !levelStarting;

async function openHeroPicker(profile) {
  if (document.querySelector('.hero-picker-overlay')) return;
  await readHeroUnlocked();
  const { mountHeroPicker } = await import('./hero-picker.js');
  // committedId is the saved hero; selectedId is the highlighted choice and
  // only becomes the saved hero when "Change hero" is pressed.
  let committedId = resolveHero(profile.hero, { entitled: true }).id;
  let selectedId = committedId;
  const overlay = document.createElement('div');
  overlay.className = 'overlay hero-picker-overlay';
  const card = document.createElement('div');
  card.className = 'overlay-card hero-picker-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'hero-picker-title');
  const title = document.createElement('h2');
  title.id = 'hero-picker-title';
  title.textContent = t('heroes.title');
  const gridRoot = document.createElement('div');
  const actions = document.createElement('div');
  actions.className = 'hero-picker-actions';
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'diff-btn action-primary hero-picker-confirm';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'diff-btn hero-picker-close';
  actions.append(confirmBtn, closeBtn);
  card.append(title, gridRoot, actions);
  // "Change hero" needs a different, unlocked hero and a moment between games.
  const syncActions = () => {
    title.textContent = t('heroes.title');
    confirmBtn.textContent = t('heroes.confirm');
    closeBtn.textContent = t('heroes.cancel');
    const entry = HEROES.find(hero => hero.id === selectedId);
    const locked = !entry || (!entry.free && !heroUnlocked);
    confirmBtn.disabled = selectedId === committedId || locked || !canSwitchProfiles();
  };
  overlay.append(card);

  // One preview atlas at a time; the sequence drops a load that lost the race.
  let previewSkin = null;
  let previewSeq = 0;
  const releasePreview = () => {
    try { if (previewSkin?.atlas) previewSkin.atlas.src = ''; } catch { /* nothing to release */ }
    previewSkin = null;
  };
  const renderPreview = async (entry, area) => {
    const seq = ++previewSeq;
    const skin = await loadHeroSkin({ heroId: entry.id });
    if (seq !== previewSeq) {
      try { if (skin.atlas) skin.atlas.src = ''; } catch { /* nothing to release */ }
      return;
    }
    releasePreview();
    previewSkin = skin;
    area.replaceChildren();
    const frame = skin.atlas && skin.frames?.['idle-1'];
    if (!frame) return;
    const canvas = document.createElement('canvas');
    canvas.width = frame.w;
    canvas.height = frame.h;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', t(entry.nameKey));
    canvas.getContext('2d')?.drawImage(skin.atlas, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
    area.append(canvas);
  };

  let picker = null;
  const setStatus = text => {
    const status = gridRoot.querySelector('[data-hero-status]');
    if (status) status.textContent = text;
  };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    stopLocale();
    previewSeq++;
    picker?.destroy();
    releasePreview();
    overlay.remove();
    document.querySelector('#profile-root .profile-change-hero')?.focus();
  };
  function onKey(event) {
    if (event.key === 'Escape' && !document.querySelector('.paywall-overlay')) close();
  }
  document.addEventListener('keydown', onKey);
  // The title bar stays usable under the dialog: sound and language act in
  // place, so a language switch re-renders the dialog text instead of leaving
  // it in the old language.
  const stopLocale = onLocaleChange(() => { picker?.update(); syncActions(); });
  closeBtn.addEventListener('click', close);
  confirmBtn.addEventListener('click', async () => {
    if (confirmBtn.disabled) return;
    if (!canSwitchProfiles()) {
      setStatus(t('heroes.blockedWhilePlaying'));
      syncActions();
      return;
    }
    const entry = HEROES.find(hero => hero.id === selectedId);
    if (!entry) return;
    confirmBtn.disabled = true;
    try {
      if (platform.isApp) {
        await platform.localProfiles.setHero(profile.id, entry.id);
      } else {
        const result = await platform.updateProfile({ hero: entry.id });
        if (result?.error) throw new Error(result.error);
      }
    } catch (error) {
      console.error('Unable to save the hero', error);
      setStatus(t('heroes.saveFailed'));
      syncActions();
      return;
    }
    committedId = entry.id;
    if (platform.isApp) activeLocalPlayer = platform.localProfiles.getActiveProfile();
    await profileUI?.refresh();
    renderPlayerIdentity();
    refreshHeroSkin();
    close();
  });

  picker = mountHeroPicker(gridRoot, {
    t,
    getSelectedId: () => selectedId,
    getCurrentId: () => committedId,
    canChange: canSwitchProfiles,
    isLocked: entry => !entry.free && !heroUnlocked,
    renderPreview,
    // Selecting only highlights; "Change hero" saves it.
    onSelect: entry => {
      selectedId = entry.id;
      syncActions();
    },
    onLocked: async () => {
      try {
        const { createPaywall } = await import('./paywall.js');
        await createPaywall({
          platform,
          locale: getLocale(),
          onGranted: async () => {
            await readHeroUnlocked();
            picker?.update();
          },
        }).open();
      } catch (error) {
        console.error('Unable to open the unlock paywall', error);
      }
    },
  });
  syncActions();
  document.body.append(overlay);
  gridRoot.querySelector('button[data-hero-id]')?.focus();
}

const ensureLocalProfiles = createRetryableInitialization(async () => {
  if (platform.isApp) {
    await platform.localProfiles.initialize({ defaultName: t('profiles.defaultName') });
    activeLocalPlayer = platform.localProfiles.getActiveProfile();
    renderPlayerIdentity();
    loadCampaignSelection();
    const { mountProfileUI } = await import('./profile-ui.js');
    const root = document.getElementById('profile-root');
    if (root && !profileUI) {
      profileUI = mountProfileUI({
        root, adapter: platform.localProfiles, translate: t,
        onBusyChange: busy => {
          profileMutationPending = busy;
          // Same set as the difficulty handler: the Practice and history Back
          // buttons are not difficulty buttons and must stay clickable.
          for (const button of document.querySelectorAll('#difficulty-select [data-difficulty]')) button.disabled = busy;
          if (btnStartPractice) btnStartPractice.disabled = busy;
        },
        canSwitch: canSwitchProfiles,
        // "Add player" appears once the app is fully unlocked (premiumAccess, kept by syncNoticeHelp).
        canCreate: () => premiumAccess,
        portraitFor: heroPortraitFor,
        onChangeHero: profile => { void openHeroPicker(profile); },
        onSelected: async () => {
          clearMissedProblemsForOwner(platform.localProfiles.getActiveProfile().id);
          currentPersonalDevelopment = null;
          activeLocalPlayer = platform.localProfiles.getActiveProfile();
          renderPlayerIdentity();
          loadCampaignSelection();
          refreshHeroSkin();
          levelGrid.value = '';
          await refreshPracticeBadges();
          personalBestList.textContent = '';
          personalCompletedOverview.textContent = '';
          personalScoreHistoryChart.textContent = '';
          await refreshProfileAndLeaderboard();
        },
        onError: error => {
          console.error('Local profile operation failed', error);
          showProgressError(t('profiles.storageError'));
        },
      });
      await profileUI.refresh();
    }
    const { mountEntitlementPanel } = await import('./entitlement-panel.js');
    const entitlementRoot = document.getElementById('entitlement-root');
    if (entitlementRoot && !entitlementPanel) {
      entitlementPanel = mountEntitlementPanel({
        root: entitlementRoot,
        platform,
        getLocale,
        totalLevels: TOTAL_LEVELS,
        // A finished purchase unlocks everything, so the "What is free?"
        // entries have nothing left to answer.
        onGranted: () => syncNoticeHelp(),
        // The same Restore brings Campaign II back (there is no second restore button).
        onExtrasRestored: () => renderCampaignSwitch(),
        // Campaign II is listed next to the full unlock and bought on its own.
        onCampaign2Granted: () => renderCampaignSwitch(),
      });
    }
  }
  refreshHeroSkin();
  await refreshProfileAndLeaderboard();
});
ensureLocalProfiles().then(refreshPracticeBadges).catch(error => {
  console.error('Unable to initialize family profiles', error);
  showProgressError(t('profiles.storageError'));
});
// App-only first-open thank-you notice (see ./first-open-notice.js). Its
// acknowledgement is device-wide, so it is not tied to the active profile,
// and every string comes from the i18n dictionary. The notice shows once the
// loading screen is gone; both reopen buttons stay hidden on the web build
// because this branch never runs there.
if (platform.isApp) {
  import('./first-open-notice.js')
    .then(({ createFirstOpenNotice }) => {
      firstOpenNotice = createFirstOpenNotice({
        platform,
        translate: t,
        getLocale,
        totalLevels: TOTAL_LEVELS,
        practiceKinds: PRACTICE_KINDS,
      });
      // An owner of the unlock has nothing left to ask about what is free, so
      // the entries are only revealed once the store status says locked:
      // showing them first would flash them on an unlocked device.
      syncNoticeHelp().then((unlocked) => {
        if (unlocked) return;
        for (const id of ['first-open-notice-help', 'btn-notice-help']) {
          const button = document.getElementById(id);
          if (!button) continue;
          button.hidden = false;
          button.addEventListener('click', () => firstOpenNotice?.open());
        }
      });
      return loadingDone
        // The story intro comes first, so the notice is not hidden behind it.
        .then(() => introAtOpen)
        .then(() => firstOpenNotice?.maybeShow());
    })
    .catch(() => {});
}
for (const [id, delta] of [['leaderboard-prev', -1], ['leaderboard-next', 1]]) {
  document.getElementById(id)?.addEventListener('click', () => {
    leaderboardPage = Math.max(0, leaderboardPage + delta);
    renderLeaderboard(entriesForSelectedFilter(currentLeaderboard));
  });
}
const TITLE_FADE_MS = 170;
const screenFade = document.getElementById('screen-fade');
let titleFadeRun = 0;
let titlePageReady = false;

function applyTitlePage(name) {
  activeTitlePage = name;
  for (const section of document.querySelectorAll('[data-title-page]')) {
    section.hidden = section.dataset.titlePage !== name;
  }
  // The history page is a sub-page of Practice (opened from the chart button
  // there), so its tab stays lit and doubles as the way back.
  const navPage = name === 'history' ? 'progress' : name;
  for (const button of document.querySelectorAll('.title-navigation [data-title-target]')) {
    button.setAttribute('aria-pressed', String(button.dataset.titleTarget === navPage));
  }
  if (name === 'progress') scrollPersonalBestToHighest();
  if (name === 'play') renderCampaignSwitch();
}

// The intro and the menu pages swap behind a fade to black. The very first
// call runs without the fade so the splash never flashes at load, and the
// running counter drops stale timers when the player taps quickly.
function showTitlePage(name) {
  const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (!screenFade || reduceMotion || !titlePageReady || name === activeTitlePage) {
    titlePageReady = true;
    applyTitlePage(name);
    return;
  }
  const run = ++titleFadeRun;
  screenFade.classList.add('is-visible');
  setTimeout(() => {
    if (run !== titleFadeRun) return;
    applyTitlePage(name);
    screenFade.classList.remove('is-visible');
  }, TITLE_FADE_MS);
}
for (const button of document.querySelectorAll('[data-title-target]')) {
  button.addEventListener('click', () => {
    showTitlePage(button.dataset.titleTarget);
    if (button.dataset.titleTarget === 'family') {
      profileUI?.refresh();
      entitlementPanel?.refresh();
    }
  });
}
// Cancel leaves the Levels page without choosing: the default start level stays.
document.getElementById('btn-level-cancel')?.addEventListener('click', () => {
  levelGrid.value = '';
  if (platform.isApp && currentPersonalDevelopment) renderLocalCampaign(currentPersonalDevelopment.completed);
  else updateTitleStartingLevel();
});
document.getElementById('title-leaderboard-btn').hidden = platform.isApp;
document.getElementById('title-progress-btn').hidden = false;
document.getElementById('title-family-btn').hidden = !platform.isApp;
showTitlePage('play');

// Title/menu music is one continuous session: it starts on the first user
// gesture (autoplay policy) and, because switching title pages never touches
// the audio engine, it keeps playing across the intro and between menus. A
// running level owns the audio instead, so it is skipped while on the field.
function startMenuMusic() {
  if (gameRunning || diffSelect.style.display === 'none') return;
  audio.startMenuBGM();
}
// Ask for the menu track immediately: browsers that allow it (or that have
// already granted this site playback) start it before the intro, so the intro
// is not silent. A blocked attempt leaves the session resumable, and the
// listeners below retry it inside the next real gesture.
startMenuMusic();
document.addEventListener('pointerdown', startMenuMusic, { passive: true });
document.addEventListener('keydown', startMenuMusic);

updateMuteButtonLabel();

// Re-render dynamic (non data-i18n) UI text when the user switches locale,
// using whatever cached data we already have, so the toggle updates the
// visible UI immediately without a reload or re-fetch (gameplay state,
// including an in-progress level, is untouched).
onLocaleChange(() => {
  renderAttemptAccomplishment('level-attempt-summary');
  renderAttemptAccomplishment('defeat-attempt-summary', campaignWon ? completionFeedback : null);
  if (platform.isApp) btnSaveScoreReturnTitle.textContent = t('overlay.returnTitle');
  profileUI?.refresh();
  entitlementPanel?.render();
  firstOpenNotice?.render();
  helpOverlay?.refresh();
  if (platform.isApp && !practiceRun && !state.isShapesMode) {
    pauseSaveNotice.textContent = t('overlay.unfinishedSaveNotice');
  }
  updateMuteButtonLabel();
  audioPreferenceStatus();
  renderSkillIntro();
  renderPracticeDescription();
  updatePracticeLevelHint();
  if (practiceBadgeRetryButton) practiceBadgeRetryButton.textContent = t('practice.retryBadgeSave');
  refreshPracticeBadges();
  if (currentLeaderboard) renderLeaderboard(entriesForSelectedFilter(currentLeaderboard));
  refreshSpeedrunBoard();
  if (currentProfile) renderPersonalBest(currentProfile, leaderboardPersonalBest);
  if (currentPersonalDevelopment) renderPersonalDevelopment(currentPersonalDevelopment);
  renderWebHistoryPage();
  renderPersonalBest(currentProfile, accountPersonalBest);
  if (platform.isApp && currentPersonalDevelopment) renderLocalCampaign(currentPersonalDevelopment.completed);
  else renderLevelJumpOptions(currentProfile);
  renderPlayerIdentity();
  if (!platform.isApp) {
    if (platform.isLoggedIn) {
      splashLoginBtn.textContent = t('splash.logout');
      splashGreeting.textContent = t('splash.greeting', { username: platform.username });
    } else {
      splashLoginBtn.textContent = t('splash.loginRegister');
    }
    if (lastBillingStatus) renderBillingStatus(lastBillingStatus);
  }
  if (levelClearOverlay.style.display !== 'none' && lastLevelClearNum !== null) {
    levelClearTitle.textContent = t('overlay.levelClearTitle', { level: lastLevelClearNum });
    levelClearScore.textContent = t('overlay.scoreLine', { score: state.score });
    renderLevelClearPreview(lastLevelClearNum + 1);
    btnNextLevel.textContent = t(state.level >= (state.campaign === 2 ? TOTAL_LEVELS_2 : TOTAL_LEVELS) ? 'overlay.finishGame' : 'overlay.nextLevel');
    if (!platform.isApp && !platform.isLoggedIn) btnSaveScoreReturnTitle.textContent = t('overlay.returnTitle');
  }
  if (gameOverOverlay.style.display !== 'none') {
    const resultTitle = document.getElementById('game-over-title');
    if (resultTitle) resultTitle.textContent = t(practiceRun
      ? campaignWon ? 'practice.resultsTitle' : 'overlay.gameOverTitle'
      : campaignWon ? 'campaign.victory' : 'overlay.gameOverTitle');
    btnRetryLevel.textContent = practiceRun ? t('practice.retry')
      : campaignWon ? t('campaign.replay', { level: state.level }) : t('overlay.retryLevel');
    gameOverScore.textContent = practiceRun?.endless ? t('overlay.shapesTryAgain') : practiceRun
      ? t('practice.completed', {
        correct: practiceRun.session.snapshot().correctAnswers,
        resolved: practiceRun.session.snapshot().resolvedProblems,
        encounters: practiceRun.session.snapshot().encountersDefeated,
      })
      : state.isShapesMode
      ? t('overlay.shapesTryAgain')
      : t('overlay.scoreLine', { score: state.score });
  }
});

// Warden fights live outside the canvas loop: they are a room-sized puzzle over
// the title screen, so they need no enemy entity, spawn queue or camera.
initWardenMode({
  platform,
  getClearedLevels: () => currentPersonalDevelopment?.completed ?? [],
  getDifficulty: () => state.difficulty,
});

platform.refresh()
  .catch(() => false)
  .finally(async () => {
    if (platform.isApp) return;
    applyAuthUIState();
    await handleCheckoutRedirect();
    if (new URLSearchParams(location.search).get('account') === 'billing') {
      if (platform.isLoggedIn) openBillingPanel();
      else {
        showAuthForm(loginForm);
        setAuthModalVisible(true);
      }
    }
  });
