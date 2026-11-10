// mobile-ui.js — App-only overlay UI seam for the Capacitor build.
//
// main.js loads this module only behind `platform.isApp` (see the guarded
// dynamic import there), so the web build never imports it. The module injects
// the app-only stylesheet that copy-assets ships as www/game/mobile-ui.css and
// publishes the small hook surface the later mobile UI issues consume:
//
//   const ui = mountMobileUi({ doc: document });
//   ui.registerWidget('timer-bar', {
//     updateTimerState(state) { ... },
//     updateLevelSelection(state) { ... },
//   });
//   ui.updateTimerState({ remaining, max, paused, running });
//   ui.updateLevelSelection({ level, chapter, mode });
//   ui.updateEncounterProgress({ defeated, total });
//
// Timer, level-selection and encounter-progress payloads are passed through unchanged; widgets own
// their own rendering. A widget that throws is isolated, so one broken widget
// can never break the game loop, and a missing/failing module never breaks
// startup because main.js catches the import.
//
// This module deliberately changes no visuals: it only adds its stylesheet to
// the document and forwards updates to whatever widgets have registered.

/** Stylesheet path relative to this module (www/game/mobile-ui.css). */
export const MOBILE_UI_STYLESHEET = './mobile-ui.css';

/**
 * Absolute stylesheet URL. A document-relative href would resolve against
 * index.html at the bundle root, so resolve against this module instead.
 */
export const MOBILE_UI_STYLESHEET_URL = new URL(MOBILE_UI_STYLESHEET, import.meta.url).href;

/** Marks the injected <link> so re-mounting never duplicates it. */
export const STYLESHEET_ATTRIBUTE = 'data-mobile-ui-stylesheet';

/** Widget methods the hook surface forwards. */
export const WIDGET_UPDATES = Object.freeze(['updateTimerState', 'updateLevelSelection', 'updateEncounterProgress']);

/**
 * Inject the app-only stylesheet once per document.
 * @param {Document} doc
 * @param {string} [href]
 * @returns {HTMLLinkElement|null} the stylesheet link, or null without a head
 */
export function injectStylesheet(doc, href = MOBILE_UI_STYLESHEET_URL) {
  if (!doc || typeof doc.createElement !== 'function' || !doc.head) return null;
  const existing = typeof doc.querySelector === 'function'
    ? doc.querySelector(`link[${STYLESHEET_ATTRIBUTE}]`)
    : null;
  if (existing) return existing;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute(STYLESHEET_ATTRIBUTE, '');
  doc.head.appendChild(link);
  return link;
}

function updateWidget(widget, method, payload, warn, name) {
  const update = widget?.[method];
  if (typeof update !== 'function') return;
  try {
    update(payload);
  } catch (error) {
    warn(`mobile-ui widget ${name} failed in ${method}`, error);
  }
}

/**
 * Create the overlay UI handle without touching the document yet.
 *
 * @param {object} [options]
 * @param {Document} [options.doc] document to inject the stylesheet into
 * @param {string} [options.stylesheet] stylesheet path override
 * @param {(message: string, error: unknown) => void} [options.warn] error sink
 * @returns {object} documented hook surface
 */
export function createMobileUi({
  doc = globalThis.document,
  stylesheet = MOBILE_UI_STYLESHEET_URL,
  warn = () => {},
} = {}) {
  const widgets = new Map();
  let timerState = null;
  let levelSelection = null;
  let encounterProgress = null;
  let stylesheetLink = null;
  let attached = false;

  const notify = (method, payload) => {
    for (const [name, widget] of widgets) updateWidget(widget, method, payload, warn, name);
  };

  const replay = (name, widget) => {
    if (timerState !== null) updateWidget(widget, 'updateTimerState', timerState, warn, name);
    if (levelSelection !== null) {
      updateWidget(widget, 'updateLevelSelection', levelSelection, warn, name);
    }
    if (encounterProgress !== null) {
      updateWidget(widget, 'updateEncounterProgress', encounterProgress, warn, name);
    }
  };

  return {
    /** True once the stylesheet has been requested. */
    get attached() {
      return attached;
    },
    /** The injected <link>, or null before attach()/without a document head. */
    get stylesheetLink() {
      return stylesheetLink;
    },
    /** Inject the app-only stylesheet; safe to call repeatedly. */
    attach() {
      if (!attached) {
        stylesheetLink = injectStylesheet(doc, stylesheet);
        attached = true;
      }
      return stylesheetLink;
    },
    /** Remove the stylesheet this handle injected. */
    detach() {
      if (stylesheetLink) stylesheetLink.remove?.();
      stylesheetLink = null;
      attached = false;
    },
    /**
     * Register a widget and replay the latest timer/level/encounter state to it.
     * @param {string} name unique widget name
     * @param {object} widget object with any of the WIDGET_UPDATES methods
     * @returns {() => void} unregister function
     */
    registerWidget(name, widget) {
      if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('mobile-ui widget needs a non-empty name');
      }
      if (!widget || typeof widget !== 'object') {
        throw new TypeError(`mobile-ui widget ${name} must be an object`);
      }
      widgets.set(name, widget);
      replay(name, widget);
      return () => {
        if (widgets.get(name) === widget) widgets.delete(name);
      };
    },
    /** Remove a widget by name. */
    unregisterWidget(name) {
      return widgets.delete(name);
    },
    /** Registered widget names, in registration order. */
    widgetNames() {
      return [...widgets.keys()];
    },
    /** Forward the current timer state to every widget. */
    updateTimerState(state) {
      timerState = state;
      notify('updateTimerState', state);
    },
    /** Forward the current level/continuation selection to every widget. */
    updateLevelSelection(selection) {
      levelSelection = selection;
      notify('updateLevelSelection', selection);
    },
    /** Forward the defeated/total encounter count to every widget. */
    updateEncounterProgress(progress) {
      encounterProgress = progress;
      notify('updateEncounterProgress', progress);
    },
  };
}

/**
 * Create the overlay UI handle and inject its stylesheet.
 * @param {Parameters<typeof createMobileUi>[0]} [options]
 * @returns {ReturnType<typeof createMobileUi>}
 */
export function mountMobileUi(options) {
  const ui = createMobileUi(options);
  ui.attach();
  return ui;
}
