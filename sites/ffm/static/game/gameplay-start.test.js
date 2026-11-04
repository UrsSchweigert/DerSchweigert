import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');

it('hides the title when a blocked level successfully resumes', () => {
  const fn = source.match(/function finishStartLevel\([\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'finishStartLevel must exist');
  const context = {
    gameplayTimers: [],
    state: { score: 0 },
    diffSelect: { style: { display: 'flex' } },
    pauseOverlay: { style: {} },
    topBar: { style: {} },
    levelClearOverlay: { style: {} },
    gameOverOverlay: { style: {} },
    resetHealHold() {},
    updateHUDLogoutVisibility() {},
    hud: { update() {} },
    audio: { startBGM() {} },
    syncKeepAwake() {},
    animFrameId: 1,
  };
  vm.createContext(context);
  vm.runInContext(
    `${fn}\nfinishStartLevel(2, { level: 3, chapter: 1, waveSize: 3 });`,
    context,
  );
  assert.equal(context.diffSelect.style.display, 'none');
  assert.equal(context.gameRunning, true);
  assert.equal(context.state.level, 3);
  assert.equal(context.spawnQueue.length, 3);
});

it('closes account and checkout dialogs while keeping title controls available after logout', () => {
  const fn = source.match(/function clearPremiumSession\([\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'clearPremiumSession must exist');
  const context = {
    gameplayTimers: [],
    setAccountModalVisible(visible) {
      context.accountModal.style.display = visible ? 'flex' : 'none';
    },
    levelRequestGeneration: 0,
    platform: {
      incrementRequestGeneration() {},
      setCurrentLevelConfig() {},
    },
    state: { timerActive: true },
    input: { disable() {} },
    accountModal: { style: { display: 'flex' } },
    checkoutModal: { style: { display: 'flex' } },
    diffSelect: { style: { display: 'none' } },
    hideLoadingOverlay() {},
    updateHUDLogoutVisibility() {},
    topBar: { style: { display: 'none' } },
    audio: { stopBGM() {} },
    syncKeepAwake() {},
  };
  vm.createContext(context);
  vm.runInContext(`${fn}\nclearPremiumSession();`, context);
  assert.equal(context.topBar.style.display, 'flex');
  assert.equal(context.accountModal.style.display, 'none');
  assert.equal(context.checkoutModal.style.display, 'none');
  assert.equal(context.diffSelect.style.display, 'flex');
  assert.equal(context.gameRunning, false);
  assert.equal(context.state.timerActive, false);
});

it('hides HUD logout button when splash screen is visible and shows it during gameplay', () => {
  const updateFn = source.match(/function updateHUDLogoutVisibility\(\)[\s\S]*?\n\}/)?.[0];
  const applyFn = source.match(/function applyAuthUIState\(\)[\s\S]*?\n\}/)?.[0];
  assert.ok(updateFn, 'updateHUDLogoutVisibility must exist');
  assert.ok(applyFn, 'applyAuthUIState must exist');

  const context = {
    platform: { username: 'testuser' },
    diffSelect: { style: { display: 'flex' } },
    logoutBtn: { style: { display: '' } },
    loginBtn: { style: { display: '' } },
    userDisplay: { style: { display: '' }, textContent: '' },
    splashLoginBtn: { textContent: '' },
    splashGreeting: { textContent: '' },
    t: (key, data) => {
      if (key === 'splash.logout') return 'Logout';
      if (key === 'splash.greeting') return `Hello, ${data?.username}`;
      return key;
    },
    refreshProfileAndLeaderboard() {},
  };
  vm.createContext(context);
  vm.runInContext(`${updateFn}\n${applyFn}`, context);

  // Apply auth state with logged-in user
  vm.runInContext('applyAuthUIState();', context);
  // HUD logout should be hidden when splash is visible
  assert.equal(context.logoutBtn.style.display, 'none', 'HUD logout should be hidden when splash is visible');

  // Simulate going into gameplay (splash hidden)
  context.diffSelect.style.display = 'none';
  vm.runInContext('updateHUDLogoutVisibility();', context);
  // HUD logout should be shown during gameplay
  assert.equal(context.logoutBtn.style.display, '', 'HUD logout should be shown during gameplay');

  // Simulate returning to title (splash shown)
  context.diffSelect.style.display = 'flex';
  vm.runInContext('updateHUDLogoutVisibility();', context);
  // HUD logout should be hidden again when splash is visible
  assert.equal(context.logoutBtn.style.display, 'none', 'HUD logout should be hidden when splash is shown again');

  // Test when logged out
  context.platform.username = '';
  vm.runInContext('applyAuthUIState();', context);
  // HUD logout should be hidden when not logged in
  assert.equal(context.logoutBtn.style.display, 'none', 'HUD logout should be hidden when not logged in');
});

it('stops music when access is denied for premium level', () => {
  const fn = source.match(/function handleLevelConfigError\([\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'handleLevelConfigError must exist');

  const audioStopBGMCalls = [];
  const context = {
    state: { score: 0, difficulty: 'easy', timerMax: 60, maxHearts: 3 },
    t: (key, data) => {
      if (key === 'auth.accessDenied') return 'Access Denied';
      if (key === 'auth.failedToLoadLevel') return `Failed to load level ${data?.level}`;
      return key;
    },
    savePendingRecord() {},
    platform: { isApp: false },
    diffSelect: { style: { display: 'none' } },
    authStatusMessage: { textContent: '' },
    authStatusModal: { style: { display: 'none' } },
    updateHUDLogoutVisibility() {},
    audio: {
      stopBGM() {
        audioStopBGMCalls.push('stopBGM');
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(`${fn}`, context);

  // Test 403 access denied error for L3
  audioStopBGMCalls.length = 0;
  vm.runInContext('handleLevelConfigError({ statusCode: 403 }, 2);', context);
  assert.equal(audioStopBGMCalls.length, 1, 'stopBGM should be called on 403 error');
  assert.equal(context.diffSelect.style.display, 'flex', 'diffSelect should be shown on error');
  assert.equal(context.authStatusModal.style.display, 'flex', '403 error should show status modal');

  // Test 402 billing required error for L3
  audioStopBGMCalls.length = 0;
  context.openBillingPanel = () => {
    context.accountModal = { style: { display: 'flex' } };
  };
  vm.runInContext('handleLevelConfigError({ statusCode: 402 }, 2);', context);
  assert.equal(audioStopBGMCalls.length, 1, 'stopBGM should be called on 402 error');
  assert.equal(context.diffSelect.style.display, 'flex', 'diffSelect should be shown on error');
});
