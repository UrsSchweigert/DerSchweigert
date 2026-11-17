// App-only: whether the shell is the iOS Capacitor app. The web build and the
// Android app never load this module.
export function isIosApp(root = globalThis) {
  try {
    return root?.Capacitor?.getPlatform?.() === 'ios';
  } catch {
    return false;
  }
}
