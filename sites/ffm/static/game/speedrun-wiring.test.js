import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { _resetForTests, setLocale, t } from './i18n.js';

const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

function bodyOf(name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  // Walk to the matching closing brace of the function's own block.
  let depth = 0;
  let index = main.indexOf('{', start);
  const open = index;
  for (; index < main.length; index++) {
    if (main[index] === '{') depth++;
    else if (main[index] === '}') {
      depth--;
      if (depth === 0) return main.slice(open, index + 1);
    }
  }
  throw new Error(`${name} never closes`);
}

describe('the run timer is fed by the game and nothing else', () => {
  it('starts a run only for a campaign level', () => {
    const body = bodyOf('finishStartLevel');
    assert.match(body, /if \(!practiceRun && !state\.isShapesMode\) speedrunTimer\.start\(state\.level\);/);
    assert.match(body, /else speedrunTimer\.abandon\(\);/);
  });

  it('counts only while a level is on screen and not paused', () => {
    const loop = bodyOf('gameLoop');
    const block = loop.match(/if \(typeof speedrunTimer !== 'undefined'\) \{[\s\S]*?speedrunTimer\.tick\(dt\);[\s\S]*?\n  \}/)?.[0];
    assert.ok(block, 'the tick is gated');
    assert.match(block, /if \(gameRunning && !paused && !practiceRun && !state\.isShapesMode/);
    assert.match(block, /diffSelect\.style\.display === 'none'/);
    assert.match(block, /levelClearOverlay\.style\.display === 'none'/);
  });

  it('records the split when a level is cleared, and the run when level 60 is', () => {
    const body = bodyOf('triggerLevelClear');
    assert.match(body, /const speedrunSplit = typeof speedrunTimer === 'undefined' \? null : speedrunTimer\.completeLevel\(\);/);
    assert.match(body, /speedrunRecords\.recordLevel\(speedrunSplit\.level, speedrunSplit\.levelMs\);/);
    assert.match(body, /if \(speedrunSplit\.final\) speedrunRecords\.recordRun\(speedrunSplit\.runMs\);/);
    assert.ok(
      body.indexOf('speedrunSplit') < body.indexOf("levelClearOverlay.style.display = 'flex'"),
      'the split is taken before the card goes up',
    );
  });

  it('ends the run on every way out of it', () => {
    for (const name of ['triggerGameOver', 'returnToTitle']) {
      assert.match(bodyOf(name), /speedrunTimer\.abandon\(\);/, `${name} ends the run`);
    }
    const replay = main.match(/btnReplayLevel\.onclick = \(\) => finishCompletion\(\(\) => \{[\s\S]*?\n  \}\);/)?.[0];
    assert.ok(replay, 'the replay handler exists');
    assert.match(replay, /speedrunTimer\.abandon\(\);/, 'a replay is not part of the run');
    const returnTitle = main.match(/btnSaveScoreReturnTitle\.onclick = \(\) => finishCompletion\(async \(\) => \{[\s\S]*?\n  \}\);/)?.[0];
    assert.ok(returnTitle, 'the return-to-title handler exists');
    assert.match(returnTitle, /speedrunTimer\.abandon\(\);/);
  });

  it('drives the HUD clock from the timer', () => {
    assert.match(main, /speedrunUi\?\.updateClock\(speedrunRecords\.enabled \? speedrunTimer\.snapshot\(\) : null\);/);
  });
});

describe('the speedrun strings exist in both languages', () => {
  it('translates every key the card uses', () => {
    const keys = [
      'speedrun.readout', 'speedrun.title', 'speedrun.enable', 'speedrun.bestRun',
      'speedrun.noRun', 'speedrun.levelsHeading', 'speedrun.empty', 'speedrun.levelSplit',
      'speedrun.close',
    ];
    for (const key of keys) {
      const en = (setLocale('en'), t(key, { level: 1, time: '0:01.0' }));
      const de = (setLocale('de'), t(key, { level: 1, time: '0:01.0' }));
      assert.notEqual(en, key, `${key} has an English string`);
      assert.notEqual(de, key, `${key} has a German string`);
      assert.ok(!/\{level\}|\{time\}/.test(en), `${key} fills its placeholders`);
    }
    _resetForTests();
  });
});
