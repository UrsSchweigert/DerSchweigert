import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');

it('hides the title when a blocked level successfully resumes', () => {
  const fn = source.match(/function finishStartLevel\([\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'finishStartLevel must exist');
  const context = {
    state: { score: 0 },
    diffSelect: { style: { display: 'flex' } },
    pauseOverlay: { style: {} },
    topBar: { style: {} },
    levelClearOverlay: { style: {} },
    gameOverOverlay: { style: {} },
    resetHealHold() {},
    hud: { update() {} },
    audio: { startBGM() {} },
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
    levelRequestGeneration: 0,
    incrementRequestGeneration() {},
    setCurrentLevelConfig() {},
    state: { timerActive: true },
    input: { disable() {} },
    accountModal: { style: { display: 'flex' } },
    checkoutModal: { style: { display: 'flex' } },
    diffSelect: { style: { display: 'none' } },
    hideLoadingOverlay() {},
    topBar: { style: { display: 'none' } },
    audio: { stopBGM() {} },
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
