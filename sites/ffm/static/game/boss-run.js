// boss-run.js — the playable Warden fight, presented over the title screen.
//
// This module owns presentation only: it renders the seal pips, the Ward Clock,
// the rule banner and the orbs or answer choices, and forwards every decision
// to boss-attempt.js. Keeping the fight out of the canvas renderer means a boss
// needs no enemy entity, no spawn queue and no camera - it is a room-sized
// puzzle, not a wave.
//
// Entry point: initWardenMode() adds a "Wardens" row to the levels page and
// opens the overlay when a Warden is picked. The fight is loadable, not free
// roaming: leaving the overlay simply ends it.

import {
  availableBosses,
  BOSSES,
  getBoss,
} from './boss-data.js';
import { HIDDEN_RULE_SECONDS, planFight, problemFor } from './boss-plan.js';
import {
  advancePhase,
  answerProblem,
  createAttempt,
  crownsFor,
  firstAttemptAccuracy,
  retryPhase,
  scoreFor,
  strike,
  tick,
} from './boss-attempt.js';
import {
  crownCount,
  defeatedBossIds,
  readBossResults,
  recordBossResult,
  writeBossResults,
} from './boss-progress.js';
import { onLocaleChange, t } from './i18n.js';

const CLOCK_TICK_MS = 100;
const PHASE_CLEAR_MS = 900;

/**
 * What the levels page should offer, boss by boss. Pure so the gating can be
 * tested without a document.
 */
export function buildWardenRows({ clearedLevels = [], results = {} } = {}) {
  const defeated = defeatedBossIds(results);
  const open = availableBosses({ clearedLevels, defeatedBosses: defeated });
  return BOSSES.map(boss => ({
    bossId: boss.id,
    act: boss.act,
    unlocked: open.includes(boss.id),
    cleared: defeated.includes(boss.id),
    crowns: results[boss.id]?.crowns ?? 0,
    bestScore: results[boss.id]?.bestScore ?? 0,
  }));
}

/** The rule banner text for a lock, with its numbers filled in. */
export function ruleText(lock) {
  const { ruleId, params } = lock;
  if (ruleId === 'ascending') return t('boss.rule.ascending');
  if (ruleId === 'descending') return t('boss.rule.descending');
  if (ruleId === 'pairSum') return t('boss.rule.pairSum', { target: params.target });
  if (ruleId === 'factorChain') return t('boss.rule.factorChain', { factor: params.factor });
  if (ruleId === 'oddOneOut') return t('boss.rule.oddOneOut', { factor: params.factor });
  if (ruleId === 'equalShare') return t('boss.rule.equalShare', { pile: params.pile });
  if (ruleId === 'composeTarget') return t('boss.rule.composeTarget');
  return '';
}

/**
 * Mount the Warden mode.
 *
 * @param {object} options
 * @param {{getAuthorizedLevelConfig: Function}} options.platform
 * @param {() => number[]} [options.getClearedLevels]
 * @param {() => string} [options.getDifficulty]
 * @param {Document} [options.doc]
 */
export function initWardenMode({
  platform,
  getClearedLevels = () => [],
  getDifficulty = () => 'medium',
  storage,
  doc = globalThis.document,
} = {}) {
  if (!doc) return null;

  const levelsPage = doc.querySelector('[data-title-page="levels"]');

  const row = doc.createElement('section');
  row.id = 'warden-row';
  row.className = 'warden-row';
  row.innerHTML = [
    '<p class="warden-title" data-i18n="boss.title">Wardens</p>',
    '<p class="warden-intro" data-i18n="boss.intro">One Warden guards each act. Break its seal to open the next act.</p>',
    '<div id="warden-list" class="warden-list"></div>',
  ].join('');
  if (levelsPage) levelsPage.insertBefore(row, levelsPage.firstChild);

  const overlay = doc.createElement('div');
  overlay.id = 'boss-overlay';
  overlay.className = 'boss-overlay';
  overlay.hidden = true;
  overlay.innerHTML = [
    '<div class="boss-frame" role="dialog" aria-modal="true" aria-labelledby="boss-name">',
    '  <p class="boss-act" id="boss-act"></p>',
    '  <h2 class="boss-name" id="boss-name"></h2>',
    '  <p class="boss-phase" id="boss-phase"></p>',
    '  <div class="boss-seals" id="boss-seals" role="img"></div>',
    '  <div class="boss-meter"><span class="boss-meter-label" data-i18n="boss.clock">Ward Clock</span>',
    '    <div class="boss-clock"><span id="boss-clock-fill"></span></div></div>',
    '  <div class="boss-hearts" id="boss-hearts"></div>',
    '  <p class="boss-prompt" id="boss-prompt"></p>',
    '  <p class="boss-hint" id="boss-hint" hidden></p>',
    '  <div class="boss-options" id="boss-options"></div>',
    '  <button type="button" class="boss-leave" id="boss-leave" data-i18n="boss.leave">Leave</button>',
    '</div>',
    '<div class="boss-result" id="boss-result" hidden>',
    '  <h2 id="boss-result-title"></h2>',
    '  <p id="boss-result-body"></p>',
    '  <div class="boss-crowns" id="boss-crowns"></div>',
    '  <div class="boss-result-actions" id="boss-result-actions"></div>',
    '</div>',
  ].join('');
  doc.body.appendChild(overlay);

  const $ = id => doc.getElementById(id);
  const listEl = $('warden-list');
  const sealsEl = $('boss-seals');
  const clockFill = $('boss-clock-fill');
  const heartsEl = $('boss-hearts');
  const promptEl = $('boss-prompt');
  const hintEl = $('boss-hint');
  const optionsEl = $('boss-options');
  const resultEl = $('boss-result');
  const frameEl = overlay.querySelector('.boss-frame');

  let session = null;
  let clockTimer = null;
  let bannerTimer = null;
  let phaseTimer = null;

  function results() {
    return readBossResults(storage);
  }

  function refreshRows() {
    const rows = buildWardenRows({ clearedLevels: getClearedLevels(), results: results() });
    // Locked Wardens stay on the page: they are the visible goal of each act,
    // and hiding them would make the next gate a surprise.
    listEl.textContent = '';
    for (const entry of rows) {
      const boss = getBoss(entry.bossId);
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'warden-card';
      button.dataset.bossId = entry.bossId;
      button.disabled = !entry.unlocked;
      const crowns = entry.cleared ? '★'.repeat(entry.crowns) + '☆'.repeat(3 - entry.crowns) : '';
      button.innerHTML = [
        `<span class="warden-name">${t(boss.nameKey)}</span>`,
        `<span class="warden-act">${t('boss.actLabel', { act: boss.act })}</span>`,
        crowns ? `<span class="warden-crowns">${crowns}</span>` : '',
        entry.unlocked || entry.cleared
          ? ''
          : `<span class="warden-locked">${t(boss.final ? 'boss.lockedFinal' : 'boss.locked')}</span>`,
      ].join('');
      button.addEventListener('click', () => { void openFight(entry.bossId); });
      listEl.appendChild(button);
    }
  }

  function clearTimers() {
    if (clockTimer) clearInterval(clockTimer);
    if (bannerTimer) clearTimeout(bannerTimer);
    if (phaseTimer) clearTimeout(phaseTimer);
    clockTimer = null;
    bannerTimer = null;
    phaseTimer = null;
  }

  function close() {
    clearTimers();
    session = null;
    overlay.hidden = true;
    refreshRows();
  }

  async function openFight(bossId) {
    const boss = getBoss(bossId);
    overlay.hidden = false;
    resultEl.hidden = true;
    frameEl.hidden = false;
    promptEl.textContent = t('boss.opening');
    optionsEl.textContent = '';
    hintEl.hidden = true;

    let band;
    try {
      band = await platform.getAuthorizedLevelConfig(boss.bandLevel - 1);
    } catch {
      promptEl.textContent = t('boss.loadError');
      return;
    }

    const difficulty = getDifficulty();
    const attempt = createAttempt({ bossId, difficulty, seed: Date.now() });
    const fight = planFight({ bossId, band, seed: attempt.seed });
    session = { boss, band, attempt, fight, entry: null, locked: false };
    $('boss-name').textContent = t(boss.nameKey);
    $('boss-act').textContent = t(boss.final ? 'boss.finalLabel' : 'boss.actLabel', { act: boss.act });
    nextEncounter();
    clockTimer = setInterval(onClockTick, CLOCK_TICK_MS);
  }

  function currentPhasePlan() {
    return session.fight[session.attempt.phaseIndex];
  }

  function nextEncounter() {
    const { attempt } = session;
    if (attempt.status === 'phase-clear') return showPhaseClear();
    if (attempt.status === 'won' || attempt.status === 'defeated') return showResult();
    const plan = currentPhasePlan().entries[attempt.sealsThisPhase];
    if (!plan) return showResult();
    session.entry = problemFor({ band: session.band, plan });
    session.locked = false;
    renderEncounter();
  }

  function render() {
    const { attempt, boss } = session;
    const phase = attempt.phase;
    $('boss-phase').textContent = t('boss.phaseLabel', {
      index: attempt.phaseIndex + 1,
      total: boss.phases.length,
      name: t(phase.nameKey),
    });
    sealsEl.innerHTML = Array.from({ length: phase.seals }, (_, index) =>
      `<span class="seal${index < attempt.sealsThisPhase ? ' seal--broken' : ''}"></span>`).join('');
    heartsEl.innerHTML = Array.from({ length: attempt.maxHearts }, (_, index) =>
      `<span class="boss-heart${index < attempt.hearts ? '' : ' boss-heart--empty'}">♥</span>`).join('');
    const ratio = attempt.clockMax > 0 ? Math.max(0, attempt.clockRemaining / attempt.clockMax) : 0;
    clockFill.style.width = `${Math.round(ratio * 100)}%`;
    clockFill.dataset.empty = attempt.clockMax === 0 ? 'true' : 'false';
    hintEl.hidden = !attempt.lastHint;
    hintEl.textContent = attempt.lastHint
      ? t(attempt.lastHint.key, { ruleId: attempt.lastHint.ruleId })
      : '';
  }

  function renderEncounter() {
    const { attempt, entry } = session;
    const phase = attempt.phase;
    optionsEl.textContent = '';

    if (entry.kind === 'sequence') {
      const lock = entry.lock;
      promptEl.textContent = ruleText(lock);
      if (phase.hideRule) {
        if (bannerTimer) clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => {
          if (session && session.attempt.phase.hideRule) {
            promptEl.textContent = t('boss.ruleHidden');
          }
        }, HIDDEN_RULE_SECONDS * 1000);
      }
      lock.orbs.forEach((value, index) => {
        const orb = doc.createElement('button');
        orb.type = 'button';
        orb.className = 'seal-orb';
        orb.textContent = String(value);
        if (attempt.lockOrder.includes(index)) orb.classList.add('seal-orb--locked');
        orb.addEventListener('click', () => onOrb(index));
        optionsEl.appendChild(orb);
      });
    } else {
      const problem = entry.problem;
      promptEl.textContent = problem.question;
      problem.options.forEach(value => {
        const option = doc.createElement('button');
        option.type = 'button';
        option.className = 'boss-option';
        option.textContent = String(value);
        option.addEventListener('click', () => onAnswer(value, problem));
        optionsEl.appendChild(option);
      });
    }
    render();
  }

  function onOrb(index) {
    if (!session || session.locked) return;
    if (session.attempt.status !== 'active') return;
    const lock = session.entry.lock;
    const result = strike(session.attempt, lock, index);
    if (!result.accepted) {
      render();
      renderEncounterOptionsOnly();
      return;
    }
    if (result.complete) {
      session.locked = true;
      render();
      scheduleNext();
      return;
    }
    render();
    renderEncounterOptionsOnly();
  }

  function renderEncounterOptionsOnly() {
    // Re-paint just the orb states so the order shows without rebuilding text.
    const { attempt, entry } = session;
    if (entry.kind !== 'sequence') return;
    const orbs = optionsEl.querySelectorAll('.seal-orb');
    orbs.forEach((orb, index) => {
      orb.classList.toggle('seal-orb--locked', attempt.lockOrder.includes(index));
    });
  }

  function onAnswer(value, problem) {
    if (!session || session.locked) return;
    const { attempt } = session;
    if (attempt.status !== 'active') return;
    const correct = value === problem.answer;
    answerProblem(attempt, correct);
    render();
    if (correct) {
      session.locked = true;
      scheduleNext();
      return;
    }
    // Wrong answers never end a fight and never replace the problem: the player
    // finishes the same question, which is what makes the hint ladder land.
    hintEl.hidden = false;
    hintEl.textContent = t(attempt.lastHint?.key ?? 'boss.hint.restate');
  }

  function scheduleNext() {
    phaseTimer = setTimeout(() => {
      session.locked = false;
      if (session.attempt.status === 'phase-clear') showPhaseClear();
      else nextEncounter();
    }, 420);
  }

  function showPhaseClear() {
    const { attempt } = session;
    promptEl.textContent = t('boss.phaseClear', { name: t(attempt.phase.nameKey) });
    optionsEl.textContent = '';
    render();
    phaseTimer = setTimeout(() => {
      advancePhase(attempt);
      if (attempt.status === 'won') showResult();
      else nextEncounter();
    }, PHASE_CLEAR_MS);
  }

  function showResult() {
    const { attempt, boss } = session;
    if (attempt.status === 'defeated') {
      frameEl.hidden = false;
      resultEl.hidden = true;
      promptEl.textContent = t('boss.defeated');
      optionsEl.textContent = '';
      const retry = doc.createElement('button');
      retry.type = 'button';
      retry.className = 'boss-option boss-option--primary';
      retry.textContent = t('boss.retryPhase');
      retry.addEventListener('click', () => {
        retryPhase(attempt);
        resultEl.hidden = true;
        nextEncounter();
      });
      const leave = doc.createElement('button');
      leave.type = 'button';
      leave.className = 'boss-option';
      leave.textContent = t('boss.leave');
      leave.addEventListener('click', close);
      optionsEl.append(retry, leave);
      render();
      return;
    }

    const crowns = crownsFor(attempt);
    const score = scoreFor(attempt);
    const accuracy = firstAttemptAccuracy(attempt);
    const saved = recordBossResult(results(), {
      bossId: boss.id,
      crowns,
      score,
      accuracy,
    });
    writeBossResults(saved, storage);

    frameEl.hidden = true;
    resultEl.hidden = false;
    $('boss-result-title').textContent = t(boss.final ? 'boss.resultFinal' : 'boss.resultWon', {
      name: t(boss.nameKey),
    });
    $('boss-result-body').textContent = t('boss.resultBody', {
      score,
      solved: attempt.solved,
      misses: attempt.misses,
      accuracy: Math.round(accuracy * 100),
    });
    $('boss-crowns').textContent = '★'.repeat(crowns) + '☆'.repeat(3 - crowns);
    const actions = $('boss-result-actions');
    actions.textContent = '';
    const again = doc.createElement('button');
    again.type = 'button';
    again.className = 'boss-option boss-option--primary';
    again.textContent = t('boss.fightAgain');
    again.addEventListener('click', () => { void openFight(boss.id); });
    const done = doc.createElement('button');
    done.type = 'button';
    done.className = 'boss-option';
    done.textContent = t('boss.done');
    done.addEventListener('click', close);
    actions.append(again, done);
  }

  function onClockTick() {
    if (!session) return;
    const { attempt } = session;
    if (overlay.hidden || attempt.status !== 'active') return;
    tick(attempt, CLOCK_TICK_MS / 1000);
    render();
    if (attempt.status === 'defeated') showResult();
  }

  $('boss-leave').addEventListener('click', close);

  // The levels page is rendered by main.js; refresh on the way in so the row
  // reflects progress made since the page was last opened.
  doc.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('[data-title-target="levels"]')) {
      refreshRows();
    }
  });
  onLocaleChange(() => refreshRows());
  refreshRows();

  return { refresh: refreshRows, open: openFight, close, buildWardenRows, crownCount };
}
