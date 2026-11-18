// title-bar.js — hides the title bar (intro replay, sound, language) while a
// dialog that cannot use it is open.
//
// The bar floats above every overlay. Over the skill intro, the level-clear and
// game-over cards, the pause card and the store sheets its buttons were live but
// did nothing useful: the intro replay is title-screen material, and those
// dialogs render their text once, so a language switch left them unchanged. A
// button that answers a tap with nothing reads as broken, so the bar is not shown
// at all while one of them is open.
//
// Dialogs that do react stay out of the list on purpose: the hero picker sits
// below the bar and re-renders on a language switch, and the first-open notice
// and the help dialog re-render too.
//
// The watcher observes only the dialogs' own style/hidden attributes and the
// body's direct children (the store sheets are appended there while open), never
// a subtree: the gameplay header repaints every frame and must not wake it.

/** Static dialogs from index.html, shown with an inline display:flex. */
export const TITLE_BAR_DIALOG_IDS = Object.freeze([
  'skill-intro',
  'heal-tip-overlay',
  'level-clear',
  'game-over',
  'pause-overlay',
]);

/** Dialogs created on demand and appended to <body> while they are open. */
export const TITLE_BAR_DIALOG_SELECTORS = Object.freeze([
  '.paywall-overlay',
  '.parental-gate-overlay',
]);

export const TITLE_BAR_HIDDEN_CLASS = 'behind-dialog';

/** Whether a static dialog element is currently on screen. */
export function isDialogShown(element) {
  if (!element || element.hidden) return false;
  const display = element.style?.display ?? '';
  return display !== '' && display !== 'none';
}

/**
 * Keep the title bar hidden while one of the dialogs is open.
 * @param {{doc?: Document, bar: HTMLElement, ids?: string[], selectors?: string[], Observer?: typeof MutationObserver}} options
 * @returns {{sync: () => boolean, disconnect: () => void}}
 */
export function watchTitleBarDialogs({
  doc = globalThis.document,
  bar,
  ids = TITLE_BAR_DIALOG_IDS,
  selectors = TITLE_BAR_DIALOG_SELECTORS,
  Observer = globalThis.MutationObserver,
} = {}) {
  if (!bar) throw new TypeError('watchTitleBarDialogs needs the title bar element');
  const sync = () => {
    const open = ids.some((id) => isDialogShown(doc.getElementById(id)))
      || selectors.some((selector) => Boolean(doc.querySelector(selector)));
    // The class hides the bar with visibility:hidden (styles.css), which also
    // takes the buttons out of the tab order and the accessibility tree. inert
    // stays with updateTopBarModalState() in main.js, which owns it for the web
    // account and login modals.
    bar.classList.toggle(TITLE_BAR_HIDDEN_CLASS, open);
    return open;
  };
  let observer = null;
  if (typeof Observer === 'function') {
    observer = new Observer(sync);
    for (const id of ids) {
      const element = doc.getElementById(id);
      if (element) observer.observe(element, { attributes: true, attributeFilter: ['style', 'hidden'] });
    }
    if (doc.body) observer.observe(doc.body, { childList: true });
  }
  sync();
  return {
    sync,
    disconnect: () => observer?.disconnect(),
  };
}
