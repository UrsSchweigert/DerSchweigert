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
  const message = (key, fallback) => translate?.(key) || fallback;
  function setVisible(visible) {
    if (!chrome) return;
    chrome.hidden = !visible;
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
    // empty row is left standing between problems.
    const feedback = !state.paused && state.reveal && state.feedback;
    const feedbackPrefix = feedback?.kind === 'incorrect' ? message('hud.incorrect', 'Incorrect')
      : feedback?.kind === 'timeout' ? message('hud.timeout', 'Time ran out') : '';
    const correction = feedbackPrefix && feedback.question ? `${feedbackPrefix}: ${feedback.question}` : '';
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
