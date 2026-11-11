// Lifecycle owners call setVisible on screen changes and update(state, activeProblem)
// with paused/reveal flags. Queued fiends never belong in this live question.
export function createGameplayChrome({ doc = globalThis.document, translate } = {}) {
  const element = id => doc?.getElementById(id);
  const chrome = element('gameplay-chrome');
  let shapesHeader = null;
  const text = (id, value) => {
    const el = element(id);
    if (el && el.textContent !== String(value)) el.textContent = String(value);
  };
  const message = (key, fallback) => translate?.(key) || fallback;
  function setVisible(visible) {
    if (!chrome) return;
    chrome.hidden = !visible;
    if (!visible) {
      shapesHeader?.clear?.();
      text('active-question', '');
      text('gameplay-feedback', '');
    }
  }
  /**
   * The app-only two-row Shapes header (see mobile/game/shapes-header.js)
   * takes over #active-question while it is installed. The web build never
   * installs one and keeps the single-line prompt below.
   */
  function setShapesHeader(renderer) {
    shapesHeader = renderer && typeof renderer.render === 'function' ? renderer : null;
    return shapesHeader;
  }
  /**
   * Reserve the two-row question height for the whole Shapes level, not just
   * while a problem is on screen. Without the marker the question row drops
   * from two rows to the empty single-line minimum between problems and during
   * the reveal, and the header (and with it the scene layout) jumps. The app
   * overlay stylesheet turns the marker into the reserved height.
   */
  function setQuestionReserve(shapesLevel) {
    if (!chrome?.dataset) return;
    const value = shapesHeader && shapesLevel ? 'true' : 'false';
    if (chrome.dataset.twoRowQuestion !== value) chrome.dataset.twoRowQuestion = value;
  }
  function update(state = {}, problem = null) {
    if (!chrome) return;
    setQuestionReserve(!!state.isShapesMode);
    const active = !!problem && !state.paused && !state.reveal && !!(state.questionActive ?? state.timerActive);
    let question = '';
    let questionOwned = false;
    if (active) {
      if (problem.displayMode === 'shapes') {
        const instruction = message('hud.countShapes', 'Count the shapes');
        if (shapesHeader) {
          try {
            shapesHeader.render({ element: element('active-question'), problem, instruction });
            questionOwned = true;
          } catch {
            questionOwned = false;
          }
        }
        if (!questionOwned) {
          const symbol = { circle: '●', triangle: '▲', square: '■' }[problem.shapeType] || '■';
          question = `${instruction}: ${Array.from({ length: Math.max(0, Math.min(10, Math.floor(Number(problem.count) || 0))) }, () => symbol).join(' ')}`;
        }
      } else {
        question = problem.question || '';
      }
    }
    if (!questionOwned) {
      shapesHeader?.clear?.();
      text('active-question', question);
    }
    const feedback = !state.paused && state.reveal && state.feedback;
    const feedbackPrefix = feedback?.kind === 'incorrect' ? message('hud.incorrect', 'Incorrect')
      : feedback?.kind === 'timeout' ? message('hud.timeout', 'Time ran out') : '';
    text('gameplay-feedback', feedbackPrefix && feedback.question ? `${feedbackPrefix}: ${feedback.question}` : '');
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
    text('accessible-score', state.score ?? 0);
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
  return { update, setVisible, setShapesHeader };
}
