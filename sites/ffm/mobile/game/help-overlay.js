// help-overlay.js — App-only contextual help controls and the manual link.
//
// main.js imports this module only behind `platform.isApp`, so the web build
// never loads it. It injects a question-mark button into the play area, the
// pause menu and the title navigation. Each button opens a short staged dialog
// about the current screen or training mode and links to the bundled manual.
// Opening help during live play asks main.js to pause without showing the pause
// menu; closing restores the answer and focus. Score and timers are untouched.

import { manualPagePath, resolveLocale } from './legal.js';
import { DEFAULT_LOCALE } from './parental-gate.js';

export const HELP_CONTEXTS = Object.freeze([
  'title', 'play', 'practice', 'pause', 'progress', 'levels', 'players', 'ranks', 'terms',
]);

export const TITLE_PAGE_CONTEXTS = Object.freeze({
  play: 'title', progress: 'progress', family: 'players', levels: 'levels',
  leaderboard: 'ranks', history: 'progress', legal: 'terms',
});

/** Help contexts that belong to a running level; only these can lose a run. */
export const RUN_CONTEXTS = Object.freeze(['play', 'practice', 'pause']);

/** Id shared by the manual warning and the link's aria-describedby. */
export const MANUAL_WARNING_ID = 'help-manual-warning';

const TIP_SUFFIXES = Object.freeze(['tip1', 'tip2', 'tip3']);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function translateOr(translate, key, vars) {
  const value = typeof translate === 'function' ? translate(key, vars) : key;
  return typeof value === 'string' ? value : key;
}

/** Resolve the play-area help target from the live game mode. */
export function resolvePlayContext(mode) {
  return mode && mode !== 'campaign'
    ? { context: 'practice', mode }
    : { context: 'play', mode: null };
}

/** Resolve the title-navigation help target from the active title page. */
export function titlePageContext(page) {
  return TITLE_PAGE_CONTEXTS[page] ?? 'title';
}

/** Concise staged help markup: title, summary, up to three tips, manual link, close. */
export function buildHelpMarkup({
  context = 'title', locale = DEFAULT_LOCALE, translate, mode = null, hasActiveRun = false,
} = {}) {
  const loc = resolveLocale(locale);
  if (!HELP_CONTEXTS.includes(context)) throw new RangeError(`unknown help context: ${context}`);
  const vars = context === 'practice' && mode
    ? { mode: translateOr(translate, `practice.kind.${mode}`) }
    : undefined;
  const title = translateOr(translate, `help.${context}.title`, vars);
  const summary = translateOr(translate, `help.${context}.summary`, vars);
  const tips = TIP_SUFFIXES
    .map((suffix) => {
      const key = `help.${context}.${suffix}`;
      const text = translateOr(translate, key, vars);
      return text === key ? null : text;
    })
    .filter(Boolean);
  // The manual is a separate page, so following it abandons a running level.
  // Warn about that before the link, in every context that is part of a run.
  const warnsAboutManual = Boolean(hasActiveRun) && RUN_CONTEXTS.includes(context);
  const lines = [
    `<div class="overlay-card app-help-card" data-help-context="${escapeHtml(context)}">`,
    '  <div class="app-help-header">',
    `    <h2 id="help-title">${escapeHtml(title)}</h2>`,
    `    <button type="button" class="app-help-close" data-help-action="close" aria-label="${escapeHtml(translateOr(translate, 'help.close'))}">×</button>`,
    '  </div>',
    `  <p class="app-help-summary">${escapeHtml(summary)}</p>`,
  ];
  if (tips.length > 0) {
    lines.push('  <ul class="app-help-tips">');
    for (const tip of tips) lines.push(`    <li>${escapeHtml(tip)}</li>`);
    lines.push('  </ul>');
  }
  if (warnsAboutManual) {
    lines.push(`  <p class="app-help-warning" id="${MANUAL_WARNING_ID}" role="note">${escapeHtml(translateOr(translate, 'help.manualWarning'))}</p>`);
  }
  const describedBy = warnsAboutManual ? ` aria-describedby="${MANUAL_WARNING_ID}"` : '';
  lines.push(`  <a class="app-help-manual-link" href="${escapeHtml(manualPagePath(loc))}"${describedBy}>${escapeHtml(translateOr(translate, 'help.manual'))}</a>`);
  lines.push('</div>');
  return lines.join('\n');
}

/** Capture the answer input value and selection so help can restore them. */
export function readAnswerState(doc) {
  const element = doc?.getElementById?.('answer-input');
  if (!element) return null;
  return {
    element,
    value: typeof element.value === 'string' ? element.value : '',
    selectionStart: Number.isInteger(element.selectionStart) ? element.selectionStart : null,
    selectionEnd: Number.isInteger(element.selectionEnd) ? element.selectionEnd : null,
  };
}

/** Restore a captured answer value and selection. */
export function restoreAnswerState(state) {
  if (!state?.element) return false;
  const { element } = state;
  if (element.value !== state.value) element.value = state.value;
  if (state.selectionStart !== null && typeof element.setSelectionRange === 'function') {
    try {
      element.setSelectionRange(state.selectionStart, state.selectionEnd ?? state.selectionStart);
    } catch {
      // An input that rejects the selection still keeps its restored value.
    }
  }
  return true;
}

/** Default view: injects the dialog and the three question-mark buttons. */
export function createHelpView({ doc = globalThis.document, translate } = {}) {
  if (!doc?.body || typeof doc.createElement !== 'function') {
    throw new TypeError('help overlay needs a document');
  }
  let overlay = doc.getElementById?.('help-overlay') ?? null;
  if (!overlay) {
    overlay = doc.createElement('div');
    overlay.id = 'help-overlay';
    overlay.className = 'overlay app-help-overlay';
    doc.body.appendChild(overlay);
  }
  overlay.hidden = true;
  overlay.style.display = 'none';
  const buttons = [];
  function makeButton(host) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'app-help-button';
    button.dataset.helpHost = host;
    button.textContent = '?';
    button.setAttribute('aria-label', translateOr(translate, 'help.openAria'));
    button.setAttribute('title', translateOr(translate, 'help.open'));
    buttons.push(button);
    return button;
  }
  const chrome = doc.getElementById?.('gameplay-chrome');
  const pauseButton = doc.getElementById?.('btn-pause-game');
  if (chrome) {
    const button = makeButton('play');
    if (pauseButton && pauseButton.parentElement === chrome) chrome.insertBefore(button, pauseButton);
    else chrome.appendChild(button);
  }
  const actions = doc.getElementById?.('pause-actions');
  const quitButton = doc.getElementById?.('btn-quit-game');
  if (actions) {
    const button = makeButton('pause');
    if (quitButton && quitButton.parentElement === actions) actions.insertBefore(button, quitButton);
    else actions.appendChild(button);
  }
  const navigation = doc.querySelector?.('.title-navigation');
  if (navigation) navigation.appendChild(makeButton('title'));
  return {
    overlay,
    buttons,
    render(markup, handlers = {}) {
      overlay.innerHTML = markup;
      overlay.querySelector?.('[data-help-action="close"]')
        ?.addEventListener('click', handlers.close);
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'help-title');
      if (!overlay.hasAttribute?.('tabindex')) overlay.setAttribute('tabindex', '-1');
    },
    show() { overlay.hidden = false; overlay.style.display = 'flex'; },
    hide() { overlay.hidden = true; overlay.style.display = 'none'; },
    focusClose() { overlay.querySelector?.('[data-help-action="close"]')?.focus?.(); },
    setButtonLabel(label) {
      for (const button of buttons) {
        button.setAttribute('aria-label', label);
        button.setAttribute('title', translateOr(translate, 'help.open'));
      }
    },
    destroy() {
      for (const button of buttons) button.remove?.();
      overlay.remove?.();
    },
  };
}

/**
 * Create the help controller. `view`, `game` and `doc` are injectable so tests
 * can drive open/close without a browser. `game` supplies `isPlaying()`,
 * `hasActiveRun()`, `pause()` and `resume()`: help pauses only a running level
 * and resumes only when this open paused it. `hasActiveRun()` is true for any
 * level that is still in progress (also while it is paused), and the manual
 * warning is shown whenever the run cannot survive leaving the page.
 */
export function createHelpController({
  doc = globalThis.document,
  translate,
  getLocale = () => DEFAULT_LOCALE,
  getGameMode = () => null,
  getTitlePage = () => doc?.querySelector?.('[data-title-page]:not([hidden])')
    ?.dataset?.titlePage ?? 'play',
  game = {},
  view,
  registerOverlay = null,
  refreshFocus = null,
} = {}) {
  const screen = view ?? createHelpView({ doc, translate });
  let openContext = null;
  let openMode = null;
  let previousFocus = null;
  let savedAnswer = null;
  let pausedByHelp = false;
  let destroyed = false;
  const unregister = typeof registerOverlay === 'function'
    ? registerOverlay(screen.overlay) : null;

  function render() {
    screen.render(buildHelpMarkup({
      context: openContext,
      locale: getLocale(),
      translate,
      mode: openMode,
      hasActiveRun: Boolean(game?.hasActiveRun?.()),
    }), { close });
  }

  function open(context = 'title', mode = null) {
    if (destroyed) return false;
    if (!HELP_CONTEXTS.includes(context)) throw new RangeError(`unknown help context: ${context}`);
    if (openContext !== null) {
      openContext = context;
      openMode = mode;
      render();
      screen.focusClose?.();
      return true;
    }
    previousFocus = doc?.activeElement ?? null;
    savedAnswer = readAnswerState(doc);
    pausedByHelp = Boolean(game?.isPlaying?.());
    if (pausedByHelp) game.pause?.();
    openContext = context;
    openMode = mode;
    render();
    screen.show();
    refreshFocus?.();
    screen.focusClose?.();
    return true;
  }

  function openForHost(host) {
    if (host === 'play') {
      const resolved = resolvePlayContext(getGameMode());
      return open(resolved.context, resolved.mode);
    }
    if (host === 'pause') return open('pause');
    return open(titlePageContext(getTitlePage()));
  }

  function close() {
    if (openContext === null) return false;
    openContext = null;
    openMode = null;
    screen.hide();
    if (pausedByHelp) {
      pausedByHelp = false;
      game.resume?.();
    }
    restoreAnswerState(savedAnswer);
    savedAnswer = null;
    refreshFocus?.();
    const target = previousFocus;
    previousFocus = null;
    if (target && target.isConnected !== false && target.disabled !== true
      && typeof target.focus === 'function') target.focus();
    return true;
  }

  function refresh() {
    screen.setButtonLabel?.(translateOr(translate, 'help.openAria'));
    if (openContext !== null) {
      render();
      screen.focusClose?.();
    }
  }

  function destroy() {
    if (destroyed) return;
    if (openContext !== null) close();
    destroyed = true;
    doc?.removeEventListener?.('keydown', onKeydown);
    unregister?.();
    screen.destroy?.();
  }

  function onKeydown(event) {
    if (event.key !== 'Escape' || openContext === null) return;
    event.preventDefault?.();
    close();
  }

  for (const button of screen.buttons ?? []) {
    button.addEventListener?.('click', () => openForHost(button.dataset?.helpHost));
  }
  doc?.addEventListener?.('keydown', onKeydown);
  refresh();
  return {
    open, openForHost, close, refresh, destroy,
    isOpen: () => openContext !== null,
    getContext: () => openContext,
    getMode: () => openMode,
  };
}

/** Create the controller and inject its controls. */
export function mountHelpOverlay(options = {}) {
  return createHelpController(options);
}
