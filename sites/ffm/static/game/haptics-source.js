// haptics-source.js — Resolve the device driver behind the haptics module.
//
// The website uses navigator.vibrate. The Capacitor apps use
// @capacitor/haptics when it is bundled, otherwise the injected
// Capacitor.Plugins.Haptics bridge. Everything else (unsupported browser, web
// preview, M5 before the plugin ships) resolves to a no-op so callers never
// branch on the platform and gameplay never sees a throw or a rejection.

/** No-op driver: present so callers can always call it. */
export function noopVibration() {
  return undefined;
}

function swallow(result) {
  if (result && typeof result.then === 'function') result.then(undefined, () => {});
}

/** Wrap a driver so a synchronous throw or a rejected promise is contained. */
function guarded(driver) {
  return function vibrate(pattern) {
    try {
      swallow(driver(pattern));
    } catch {
      // A broken driver must never break the frame that triggered it.
    }
    return undefined;
  };
}

function attempt(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

async function attemptAsync(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function webDriver(scope) {
  const navigator = scope?.navigator;
  const vibrate = navigator?.vibrate;
  if (typeof vibrate !== 'function') return null;
  return guarded(pattern => vibrate.call(navigator, pattern));
}

function totalDuration(pattern) {
  if (Array.isArray(pattern)) {
    return pattern.reduce((total, value) => total + (Number(value) || 0), 0);
  }
  return Number(pattern) || 0;
}

/**
 * Adapt a @capacitor/haptics-shaped plugin to the pattern-based driver.
 * The plugin exposes vibrate({duration}) or impact({style}); both are
 * optional so a partial bridge is treated as absent instead of crashing.
 */
function pluginDriver(plugin) {
  if (!plugin || typeof plugin !== 'object') return null;
  if (typeof plugin.vibrate === 'function') {
    return guarded(pattern => plugin.vibrate({ duration: totalDuration(pattern) }));
  }
  if (typeof plugin.impact === 'function') {
    return guarded(() => plugin.impact({ style: 'MEDIUM' }));
  }
  return null;
}

function pluginFromModule(module) {
  if (!module) return null;
  return module.Haptics ?? module.default?.Haptics ?? module.default ?? null;
}

/**
 * Resolve { vibrate, source } for this environment.
 *
 * @param {object} [options]
 * @param {object} [options.scope] global object carrying navigator/Capacitor
 * @param {Function} [options.importModule] loader seam for @capacitor/haptics
 * @returns {Promise<{vibrate: Function, source: 'web'|'plugin'|'none'}>}
 */
export async function resolveVibrationSource({ scope = globalThis, importModule } = {}) {
  const web = attempt(() => webDriver(scope));
  if (web) return { vibrate: web, source: 'web' };

  const load = typeof importModule === 'function'
    ? importModule
    : () => import('@capacitor/haptics');
  const imported = await attemptAsync(load);
  const importedDriver = attempt(() => pluginDriver(pluginFromModule(imported)));
  if (importedDriver) return { vibrate: importedDriver, source: 'plugin' };

  const bridge = attempt(() => pluginDriver(attempt(() => scope?.Capacitor?.Plugins?.Haptics)));
  if (bridge) return { vibrate: bridge, source: 'plugin' };

  return { vibrate: noopVibration, source: 'none' };
}
