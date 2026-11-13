import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('./api.js', import.meta.url), 'utf8');
const appAdapter = readFileSync(new URL('../../mobile/game/platform-adapter.js', import.meta.url), 'utf8');

function functionSource(name) {
  const asyncStart = main.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : main.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  let index = main.indexOf('{', start);
  const open = index;
  for (; index < main.length; index++) {
    if (main[index] === '{') depth++;
    else if (main[index] === '}') {
      depth--;
      if (depth === 0) return main.slice(start, index + 1);
    }
  }
  throw new Error(`${name} never closes`);
}

function fakeElement() {
  return { style: {}, textContent: '', title: '', innerHTML: '' };
}

function boardContext({ board, central, isLoggedIn = true, username = 'me', deviceBest = null, failBoard = false } = {}) {
  const elements = {
    'speedrun-board': fakeElement(),
    'speedrun-board-personal': fakeElement(),
    'speedrun-board-runs': fakeElement(),
    'speedrun-board-levels-wrap': fakeElement(),
    'speedrun-board-levels': fakeElement(),
  };
  const context = {
    speedrunBoard: elements['speedrun-board'],
    speedrunBoardPersonal: elements['speedrun-board-personal'],
    speedrunBoardRuns: elements['speedrun-board-runs'],
    speedrunBoardLevelsWrap: elements['speedrun-board-levels-wrap'],
    speedrunBoardLevels: elements['speedrun-board-levels'],
    speedrunRecords: { bestRun: deviceBest === null ? null : { totalMs: deviceBest } },
    platform: {
      isApp: false,
      hasLeaderboard: true,
      isLoggedIn,
      username,
      async getSpeedrunLeaderboard() {
        if (failBoard) throw new Error('offline');
        return board;
      },
      async getSpeedrunRecords() {
        return central;
      },
      async postSpeedrunRun() { return { saved: true }; },
    },
    // The real translator; the tests only care about which key was used.
    t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
    escHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    formatRunTime: (ms) => `t${ms}`,
    console,
  };
  vm.createContext(context);
  vm.runInContext(functionSource('refreshSpeedrunBoard'), context);
  vm.runInContext(functionSource('reportSpeedrunRun'), context);
  return { context, elements };
}

const BOARD = {
  entries: [
    { rank: 1, username: 'ana', total_ms: 5000 },
    { rank: 2, username: 'me', total_ms: 6000 },
  ],
  levels: [{ level: 3, ms: 900, username: 'ana' }],
};

describe('the ranking page speedrun block', () => {
  it('shows the overall runs and marks the signed-in player', async () => {
    const { context, elements } = boardContext({ board: BOARD, central: { best_run: { total_ms: 6000 }, levels: [] } });
    await context.refreshSpeedrunBoard();

    assert.equal(elements['speedrun-board'].style.display, '');
    assert.equal(elements['speedrun-board-runs'].innerHTML,
      '<li class="">#1 ana — t5000</li><li class="current-user">#2 me — t6000</li>');
    assert.equal(elements['speedrun-board-levels-wrap'].style.display, '');
    assert.match(elements['speedrun-board-levels'].innerHTML, /speedrun\.boardLevel:\{&quot;level&quot;:3\}/);
    assert.match(elements['speedrun-board-levels'].innerHTML, /t900/);
  });

  it('prefers the central personal best and mentions the device record separately', async () => {
    const same = boardContext({ board: BOARD, central: { best_run: { total_ms: 6000 } }, deviceBest: 6000 });
    await same.context.refreshSpeedrunBoard();
    assert.equal(same.elements['speedrun-board-personal'].textContent, 'speedrun.boardPersonal:{"time":"t6000"}');

    const better = boardContext({ board: BOARD, central: { best_run: { total_ms: 6000 } }, deviceBest: 4000 });
    await better.context.refreshSpeedrunBoard();
    assert.equal(
      better.elements['speedrun-board-personal'].textContent,
      'speedrun.boardPersonal:{"time":"t6000"} · speedrun.boardDevice:{"time":"t4000"}',
    );
  });

  it('asks a guest to sign in and still shows the device record', async () => {
    const { context, elements } = boardContext({ board: BOARD, isLoggedIn: false, username: null, deviceBest: 1234 });
    await context.refreshSpeedrunBoard();
    assert.equal(
      elements['speedrun-board-personal'].textContent,
      'speedrun.boardSignIn · speedrun.boardDevice:{"time":"t1234"}',
    );
    assert.equal(elements['speedrun-board-runs'].innerHTML.includes('current-user'), false);
  });

  it('says so when nobody has finished a run', async () => {
    const { context, elements } = boardContext({ board: { entries: [], levels: [] }, central: { best_run: null } });
    await context.refreshSpeedrunBoard();
    assert.equal(elements['speedrun-board-personal'].textContent, 'speedrun.boardNoRun');
    assert.equal(elements['speedrun-board-runs'].innerHTML, '<li>speedrun.boardEmpty</li>');
    assert.equal(elements['speedrun-board-levels-wrap'].style.display, 'none');
  });

  it('survives the board being unreachable', async () => {
    const { context, elements } = boardContext({ failBoard: true });
    await context.refreshSpeedrunBoard();
    assert.equal(elements['speedrun-board-personal'].textContent, 'speedrun.boardFailed');
  });

  it('stays hidden where there is no central leaderboard', async () => {
    const { context, elements } = boardContext({ board: BOARD });
    context.platform.hasLeaderboard = false;
    await context.refreshSpeedrunBoard();
    assert.equal(elements['speedrun-board'].style.display, 'none');
  });
});

describe('reporting a finished run', () => {
  it('posts sixty splits and a whole-millisecond total, then refreshes the board', async () => {
    const posted = [];
    let refreshed = 0;
    const { context } = boardContext();
    context.platform.postSpeedrunRun = (run) => { posted.push(run); return Promise.resolve({ saved: true }); };
    context.refreshSpeedrunBoard = () => { refreshed++; };
    context.reportSpeedrunRun(300_000.6, [{ level: 1, ms: 5000 }]);
    await Promise.resolve();
    await Promise.resolve();
    // Spread into host objects: the payload literal is built inside the vm
    // realm, so a cross-realm deepEqual would compare prototypes as well.
    assert.equal(JSON.stringify(posted), JSON.stringify([{ total_ms: 300_001, splits: [{ level: 1, ms: 5000 }] }]));
    assert.equal(refreshed, 1);
  });

  it('never reports from the app build or while signed out', () => {
    for (const overrides of [{ isApp: true }, { isLoggedIn: false }]) {
      const posted = [];
      const { context } = boardContext();
      Object.assign(context.platform, overrides);
      context.platform.postSpeedrunRun = (run) => { posted.push(run); return Promise.resolve({}); };
      context.reportSpeedrunRun(1000, []);
      assert.deepEqual(posted, [], `${JSON.stringify(overrides)} posts nothing`);
    }
  });

  it('swallows a failed report', async () => {
    const { context } = boardContext();
    context.platform.postSpeedrunRun = () => Promise.reject(new Error('offline'));
    context.reportSpeedrunRun(1000, []);
    await new Promise(resolve => setImmediate(resolve));
  });
});

describe('the central records are web only', () => {
  it('keeps the block out of the app bundle and behind a capability check', () => {
    const block = html.match(/<!-- app-omit:start -->[\s\S]*?id="speedrun-board"[\s\S]*?<!-- app-omit:end -->/)?.[0];
    assert.ok(block, 'the speedrun block sits in an app-omit region');
    assert.match(main, /if \(!speedrunBoard \|\| !platform\.hasLeaderboard\) \{/);
  });

  it('reads and writes the three central endpoints', () => {
    assert.match(apiSource, /async postSpeedrunRun\(run\) \{[\s\S]*?'\/speedrun\/run'/);
    assert.match(apiSource, /async getSpeedrunRecords\(\) \{[\s\S]*?'\/speedrun\/records'/);
    assert.match(apiSource, /async getSpeedrunLeaderboard\(\) \{[\s\S]*?'\/speedrun\/leaderboard'/);
  });

  it('answers the app adapter with empty central data instead of a network call', () => {
    assert.match(appAdapter, /async getSpeedrunLeaderboard\(\) \{\n    return \{ entries: \[\], levels: \[\] \};/);
    assert.match(appAdapter, /async postSpeedrunRun\(\) \{\n    return \{ saved: false, central_best_ms: null \};/);
  });
});
