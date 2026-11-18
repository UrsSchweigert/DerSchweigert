import { appendRunestones } from './runestone.js';
import { MAX_SHAPE_COUNT } from './shapes.js';
import { expressionHtml, expressionText } from './campaign2/math-render.js';
import { COMPACT_ROW_PX, measureLevelReserve } from './campaign2/question-reserve.js';

const STONE_ADVANCE_EM = 0.9;      // stone width plus its gap, in the row's font size
const STONE_SUM_BUDGET_PX = 300;   // narrowest usable header width

// Lifecycle owners call setVisible on screen changes and update(state, activeProblem)
// with paused/reveal flags. Queued fiends never belong in this live question.
// `measureReserve(doc, row, level)` is the Campaign II row height (question-reserve.js); tests
// pass their own, since only a browser can lay maths out.
export function createGameplayChrome({
  doc = globalThis.document, translate, onScoreGain, measureReserve = measureLevelReserve,
} = {}) {
  const element = id => doc?.getElementById(id);
  const chrome = element('gameplay-chrome');
  // The Campaign II level the question row is reserved for, and its height. A new font size
  // (orientation, a resize across a media query, a web font that finished loading) changes
  // what the maths measures, so those drop the measurement and the next frame takes it again.
  let reserve = { key: null, px: COMPACT_ROW_PX };
  const remeasure = () => { reserve = { ...reserve, key: null }; };
  const win = doc?.defaultView;
  win?.addEventListener?.('resize', remeasure);
  win?.addEventListener?.('orientationchange', remeasure);
  doc?.fonts?.addEventListener?.('loadingdone', remeasure);
  let shapesHeader = null;
  const text = (id, value) => {
    const el = element(id);
    if (el && el.textContent !== String(value)) el.textContent = String(value);
  };
  /**
   * Write the Shapes question as two block lines (instruction, runestones) so
   * each row is unbroken and the row count is fixed by the mode rather than by
   * how the sentence happens to wrap. `null` clears it (and a counted-addition
   * row) back to plain text.
   */
  function setQuestionLines(lines) {
    const el = element('active-question');
    if (!el || !doc?.createElement) return;
    if (!lines) {
      if (el.dataset?.shapesHeader === 'two-rows' || el.dataset?.stoneSum || el.dataset?.mathKey) {
        el.textContent = '';
        delete el.dataset.shapesHeader;
        delete el.dataset.stoneSum;
        delete el.dataset.mathKey;
        if (el.style) el.style.fontSize = '';
        el.removeAttribute?.('aria-label');
      }
      return;
    }
    const [instruction, count] = lines;
    el.textContent = '';
    el.dataset.shapesHeader = 'two-rows';
    for (const cls of ['shapes-instruction', 'shapes-row']) {
      const row = doc.createElement('span');
      row.className = cls;
      if (cls === 'shapes-instruction') {
        row.textContent = instruction;
      } else {
        row.setAttribute?.('role', 'img');
        row.setAttribute?.('aria-label', String(count));
        appendRunestones(doc, row, count);
      }
      el.appendChild(row);
    }
  }
  // A Campaign 2 question (fractions, powers, roots, logarithms) laid out as stacked maths,
  // written once per problem like the stone sum.
  function setQuestionMath(tokens) {
    const el = element('active-question');
    if (!el || !doc?.createElement) return false;
    const html = expressionHtml(tokens);
    if (el.dataset?.mathKey === html) return true;
    el.textContent = '';
    delete el.dataset.shapesHeader;
    delete el.dataset.stoneSum;
    el.dataset.mathKey = html;
    el.innerHTML = html;
    el.setAttribute?.('aria-label', expressionText(tokens));
    guardReserve(el);
    return true;
  }
  // The reserve comes from a sample of the level's questions. Should a question ever be taller
  // than all of them, the row takes its height and keeps it for the rest of the level: it may
  // grow once, but it never shrinks back on the next, flatter question. One layout read per
  // new question, not per frame.
  function guardReserve(el) {
    if (!reserve.key) return;
    const height = el.firstElementChild?.getBoundingClientRect?.().height;
    if (!(height > reserve.px)) return;
    reserve = { ...reserve, px: Math.ceil(height) };
    applyReserve('math');
  }
  // Called every frame: the writes only happen when the marker or the height changes.
  let appliedHeight = '';
  function applyReserve(value) {
    if (chrome.dataset.questionRows !== value) chrome.dataset.questionRows = value;
    const height = value === 'math' ? `${reserve.px}px` : '';
    if (height === appliedHeight) return;
    appliedHeight = height;
    const style = chrome.style || (chrome.style = {});
    if (style.setProperty) {
      if (height) style.setProperty('--question-row-height', height);
      else style.removeProperty('--question-row-height');
    } else if (height) {
      style['--question-row-height'] = height;
    } else {
      delete style['--question-row-height'];
    }
  }
  // A counted addition on the first levels: "<stones> + <stones> = ?", written
  // once per problem (the key stops it being rewritten every frame).
  function setStoneSum({ a, b }) {
    const el = element('active-question');
    if (!el || !doc?.createElement) return false;
    const key = `${a}+${b}`;
    if (el.dataset?.stoneSum === key) return true;
    el.textContent = '';
    delete el.dataset.shapesHeader;
    el.dataset.stoneSum = key;
    // Stones and signs have no wrapping fallback, so the row shrinks its font to
    // fit the narrowest header (about 304px at 320px wide): each stone takes
    // 0.9em, the " + " and " = ?" signs 7 monospace characters at 0.6em.
    const emWidth = (a + b) * STONE_ADVANCE_EM + 7 * 0.6;
    if (el.style) el.style.fontSize = `${Math.min(22, Math.floor(STONE_SUM_BUDGET_PX / emWidth))}px`;
    const parts = [[a, null], [null, ' + '], [b, null], [null, ' = ?']];
    for (const [count, label] of parts) {
      const part = doc.createElement('span');
      part.className = count === null ? 'stone-sum-sign' : 'stone-sum-stones';
      if (count === null) part.textContent = label;
      else appendRunestones(doc, part, count);
      el.appendChild(part);
    }
    el.setAttribute?.('aria-label', `${a} + ${b} = ?`);
    return true;
  }
  const message = (key, fallback, vars) => {
    const translated = translate?.(key, vars);
    if (typeof translated === 'string' && translated && translated !== key) return translated;
    if (!vars) return fallback;
    return String(fallback).replace(/\{(\w+)\}/g, (match, name) => (
      Object.hasOwn(vars, name) ? String(vars[name]) : match
    ));
  };
  // English fallbacks keep the notice readable when a caller passes no
  // translator (for example a lightweight test double). The i18n dictionary
  // is the real source for every shipped string.
  const ABILITY_FALLBACK_NAMES = { wind: 'Wind', storm: 'Storm', earth: 'Earth' };
  const BONUS_NOTICE_FALLBACKS = {
    cooldown: 'Bonus: {ability} cooldown −{value}s',
    storm: 'Bonus: {ability} +{value} rank',
    slowSpeed: 'Bonus: {ability} slows fiends by {value}',
    slowTargets: 'Bonus: {ability} +{value} spike target',
  };
  // A bonus notice is a non-blocking status pill, not a timer the player has
  // to beat: twelve seconds of gameplay time let a reader finish reading it
  // after the first problem without ever interrupting the level. It used to be
  // six, which ran out while a slower reader was still on the first question.
  const BONUS_NOTICE_SECONDS = 12;
  let bonusNoticeRemaining = 0;

  function clearBonusNotice() {
    bonusNoticeRemaining = 0;
    const el = element('bonus-notice');
    if (!el) return;
    el.hidden = true;
    if (el.textContent) el.textContent = '';
  }

  /**
   * Announce the bonus a level grants. `null` (level 1, practice) clears the
   * pill instead, so a level change never leaves the previous level's bonus
   * on screen. Returns whether a notice was shown.
   */
  function showBonusNotice(bonus) {
    const el = element('bonus-notice');
    if (!el) return false;
    if (!bonus || typeof bonus !== 'object' || !bonus.type) {
      clearBonusNotice();
      return false;
    }
    const abilityId = typeof bonus.abilityId === 'string' ? bonus.abilityId : '';
    const ability = message(
      `ability.${abilityId}.name`,
      ABILITY_FALLBACK_NAMES[abilityId] || abilityId,
    );
    const vars = { ability, value: bonus.value ?? '' };
    const notice = message(
      `bonus.${bonus.type}.notice`,
      BONUS_NOTICE_FALLBACKS[bonus.type] || '{ability} bonus {value}',
      vars,
    );
    if (el.hidden) el.hidden = false;
    if (el.textContent !== notice) el.textContent = notice;
    bonusNoticeRemaining = BONUS_NOTICE_SECONDS;
    return true;
  }

  /**
   * Advance the notice countdown with gameplay time. Pausing freezes it;
   * the game loop passes `{ paused }` so a pause menu cannot outlive the
   * notice by accident.
   */
  function tickBonusNotice(dt, { paused: frozen = false } = {}) {
    const el = element('bonus-notice');
    if (!el || el.hidden || frozen) return bonusNoticeRemaining;
    const step = Number(dt);
    if (!Number.isFinite(step) || step <= 0) return bonusNoticeRemaining;
    bonusNoticeRemaining = Math.max(0, bonusNoticeRemaining - step);
    if (bonusNoticeRemaining <= 0) clearBonusNotice();
    return bonusNoticeRemaining;
  }

  // Once the HUD has been on screen, hiding it keeps the element in normal
  // flow and only makes it invisible. display:none collapsed its grid row,
  // which yanked the whole playfield upwards the instant the HUD was hidden
  // behind the level-clear, pause or game-over overlay.
  let everShown = false;
  // The frame loop calls setVisible() on every frame with the value it already
  // set, and each of the three writes below cost a style recalculation — one
  // per frame for the whole header. The teardown at the end still runs every
  // call: its own writers compare before touching the DOM, so it stays cheap.
  let shown = null;

  function setVisible(visible) {
    if (!chrome) return;
    if (visible) everShown = true;
    if (visible !== shown) {
      shown = visible;
      if (everShown) {
        chrome.hidden = false;
        const style = chrome.style || (chrome.style = {});
        style.visibility = visible ? '' : 'hidden';
        style.pointerEvents = visible ? '' : 'none';
        if (visible) chrome.removeAttribute?.('aria-hidden');
        else chrome.setAttribute?.('aria-hidden', 'true');
      } else {
        chrome.hidden = true;
      }
    }
    if (!visible) {
      shapesHeader?.clear?.();
      setQuestionLines(null);
      text('active-question', '');
    }
  }
  /**
   * The app-only two-row Shapes header (see mobile/game/shapes-header.js)
   * takes over #active-question while it is installed. Without it (the web
   * build) the same two lines are written here as two child spans, so Shapes
   * always reads "Count the shapes" / the shapes themselves and the question
   * row is exactly the two rows the mode reserves - never a wrapped sentence
   * with a ragged second line.
   */
  function setShapesHeader(renderer) {
    shapesHeader = renderer && typeof renderer.render === 'function' ? renderer : null;
    return shapesHeader;
  }
  /**
   * Publish how many question rows this mode needs. Shapes asks "Count the
   * shapes" *and* shows the shapes, so it reserves two rows for the whole
   * level; the campaign asks one problem question and reserves one. The header
   * sits above the playfield and viewport-layout.js lays the scene out from its
   * measured height, so a row that appears and disappears rescales the board
   * between problems. Both stylesheets read the marker (web styles.css and the
   * app overlay's mobile-ui.css).
   *
   * Campaign II asks one question too, but as stacked maths that can stand taller
   * than the text line. Its level reserves the height of its tallest question
   * (question-reserve.js) as --question-row-height under the marker "math"; a
   * level whose maths all fits the line keeps "1".
   */
  function setQuestionReserve(state) {
    if (!chrome?.dataset) return;
    if (state.isShapesMode) {
      reserve = { key: null, px: COMPACT_ROW_PX };
      applyReserve('2');
      return;
    }
    const level = state.campaign === 2 && Number.isInteger(state.level) ? state.level : null;
    const key = level === null ? null : `2:${level}`;
    if (key !== reserve.key) {
      let px = COMPACT_ROW_PX;
      if (key) {
        try {
          px = Math.max(COMPACT_ROW_PX, Math.ceil(Number(measureReserve(doc, element('active-question'), level)) || 0));
        } catch {
          px = COMPACT_ROW_PX;
        }
      }
      reserve = { key, px };
    }
    applyReserve(reserve.px > COMPACT_ROW_PX ? 'math' : '1');
  }
  function update(state = {}, problem = null) {
    if (!chrome) return;
    setQuestionReserve(state);
    const active = !!problem && !state.paused && !state.reveal && !!(state.questionActive ?? state.timerActive);
    let question = '';
    let shapesLines = null;
    let stoneSum = null;
    let mathTokens = null;
    let ownedByWidget = false;
    if (active) {
      if (problem.displayMode === 'shapes') {
        const instruction = message('hud.countShapes', 'Count the shapes');
        const count = Math.max(0, Math.min(MAX_SHAPE_COUNT, Math.floor(Number(problem.count) || 0)));
        if (shapesHeader) {
          try {
            shapesHeader.render({ element: element('active-question'), problem, instruction });
            ownedByWidget = true;
          } catch {
            shapesLines = [instruction, count];
          }
        } else {
          shapesLines = [instruction, count];
        }
        question = `${instruction}: ${count}`;
      } else if (problem.visual) {
        stoneSum = problem.visual;
        question = problem.question || '';
      } else if (problem.math) {
        mathTokens = problem.math;
        question = problem.question || '';
      } else {
        question = problem.question || '';
      }
    }
    // The correction takes the question's own line instead of a line reserved
    // below it: the header keeps exactly the rows its mode reserves, and no
    // empty row is left standing between problems. It shows the answer alone -
    // a leading "Not quite:" / "Time ran out:" pushed the answer out of the
    // question column, and the state already reads from the answer grid.
    const feedback = !state.paused && state.reveal && state.feedback;
    const correction = feedback?.question ? feedback.question : '';
    if (correction) {
      ownedByWidget = false;
      shapesLines = null;
      stoneSum = null;
      mathTokens = null;
      question = correction;
    }
    if (!ownedByWidget) {
      if (shapesLines) {
        setQuestionLines(shapesLines);
      } else if (mathTokens && setQuestionMath(mathTokens)) {
        // written by setQuestionMath
      } else if (stoneSum && setStoneSum(stoneSum)) {
        // drawn above
      } else {
        shapesHeader?.clear?.();
        setQuestionLines(null);
        text('active-question', question);
      }
    }
    text('encounter-progress', state.progressLabel || '');
    text('combo-reward', state.rewardLabel || '');
    text('heal-progress', state.healLabel || '');
    const heal = element('heal-progress');
    if (heal && state.healHint) {
      if (heal.title !== state.healHint) heal.title = state.healHint;
      if (heal.getAttribute?.('aria-label') !== state.healHint) heal.setAttribute?.('aria-label', state.healHint);
    } else if (heal) {
      if (heal.title) heal.title = '';
      heal.removeAttribute?.('aria-label');
    }
    text('accessible-hearts', `${state.hearts ?? 0}/${state.maxHearts ?? 0}`);
    text('accessible-combo', state.combo ?? 0);
    // Read the score before writing it: the difference is what the player just
    // earned, and the confetti on the readout is the receipt for it. Shapes mode
    // is unscored, so it never sparkles.
    const scoreEl = element('accessible-score');
    const shownScore = scoreEl?.textContent ?? '';
    const previousScore = shownScore === '' ? null : Number(shownScore);
    const nextScore = state.score ?? 0;
    text('accessible-score', nextScore);
    const gained = previousScore !== null && Number.isFinite(previousScore)
      ? nextScore - previousScore : 0;
    if (gained > 0 && !state.isShapesMode && typeof onScoreGain === 'function') {
      onScoreGain({ gained, score: nextScore, element: element('accessible-score-wrap') });
    }
    text('accessible-timer', active && state.timerActive ? `${Math.ceil(Math.max(0, state.timerRemaining || 0))}s` : '—');
    const timer = element('accessible-timer-progress');
    if (timer) {
      const value = active && state.timerActive && state.timerMax > 0
        ? Math.max(0, Math.min(1, state.timerRemaining / state.timerMax)) : 0;
      // Stepped to 1%: the announced text beside it already steps once a
      // second, so a 60 Hz value only churned style on every frame.
      const stepped = Math.round(value * 100) / 100;
      if (timer.value !== stepped) timer.value = stepped;
    }
    for (const id of ['accessible-combo-wrap', 'accessible-score-wrap']) {
      const el = element(id);
      if (el) {
        const hide = !!state.isShapesMode;
        if (el.hidden !== hide) el.hidden = hide;
      }
    }
    const pause = element('btn-pause-game');
    if (pause) pause.disabled = !!state.paused;
  }
  return { update, setVisible, setShapesHeader, showBonusNotice, tickBonusNotice, clearBonusNotice };
}
