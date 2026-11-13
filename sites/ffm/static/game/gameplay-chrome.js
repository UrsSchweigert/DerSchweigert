// Lifecycle owners call setVisible on screen changes and update(state, activeProblem)
// with paused/reveal flags. Queued fiends never belong in this live question.
export function createGameplayChrome({ doc = globalThis.document, translate, onScoreGain } = {}) {
  const element = id => doc?.getElementById(id);
  const chrome = element('gameplay-chrome');
  let shapesHeader = null;
  const text = (id, value) => {
    const el = element(id);
    if (el && el.textContent !== String(value)) el.textContent = String(value);
  };
  /**
   * Write the Shapes question as two block lines (instruction, shapes) so each
   * row is unbroken and the row count is fixed by the mode rather than by how
   * the sentence happens to wrap. `null` clears it back to plain text.
   */
  function setQuestionLines(lines) {
    const el = element('active-question');
    if (!el || !doc?.createElement) return;
    if (!lines) {
      if (el.dataset?.shapesHeader === 'two-rows') {
        el.textContent = '';
        delete el.dataset.shapesHeader;
      }
      return;
    }
    const [instruction, shapes] = lines;
    el.textContent = '';
    el.dataset.shapesHeader = 'two-rows';
    for (const [cls, value] of [['shapes-instruction', instruction], ['shapes-row', shapes]]) {
      const row = doc.createElement('span');
      row.className = cls;
      row.textContent = value;
      el.appendChild(row);
    }
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
  // to beat: six seconds of gameplay time is long enough to read it while
  // solving the first problem and never interrupts the level.
  const BONUS_NOTICE_SECONDS = 6;
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

  function setVisible(visible) {
    if (!chrome) return;
    if (visible) everShown = true;
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
   */
  function setQuestionReserve(shapesLevel) {
    if (!chrome?.dataset) return;
    const value = shapesLevel ? '2' : '1';
    if (chrome.dataset.questionRows !== value) chrome.dataset.questionRows = value;
  }
  function update(state = {}, problem = null) {
    if (!chrome) return;
    setQuestionReserve(!!state.isShapesMode);
    const active = !!problem && !state.paused && !state.reveal && !!(state.questionActive ?? state.timerActive);
    let question = '';
    let shapesLines = null;
    let ownedByWidget = false;
    if (active) {
      if (problem.displayMode === 'shapes') {
        const instruction = message('hud.countShapes', 'Count the shapes');
        const count = Math.max(0, Math.min(10, Math.floor(Number(problem.count) || 0)));
        const symbol = { circle: '●', triangle: '▲', square: '■' }[problem.shapeType] || '■';
        const shapes = Array.from({ length: count }, () => symbol).join(' ');
        if (shapesHeader) {
          try {
            shapesHeader.render({ element: element('active-question'), problem, instruction });
            ownedByWidget = true;
          } catch {
            shapesLines = [instruction, shapes];
          }
        } else {
          shapesLines = [instruction, shapes];
        }
        question = `${instruction}: ${shapes}`;
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
      question = correction;
    }
    if (!ownedByWidget) {
      if (shapesLines) {
        setQuestionLines(shapesLines);
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
      if (timer.value !== value) timer.value = value;
    }
    for (const id of ['accessible-combo-wrap', 'accessible-score-wrap']) {
      const el = element(id);
      if (el) el.hidden = !!state.isShapesMode;
    }
    const pause = element('btn-pause-game');
    if (pause) pause.disabled = !!state.paused;
  }
  return { update, setVisible, setShapesHeader, showBonusNotice, tickBonusNotice, clearBonusNotice };
}
