// Player-name feature toggle. A feature that is still being tested ships in every build but
// shows only for a player whose name is exactly the toggle name below, so the owner can try it
// on any build (web or app) without a setting or a server change. Remove a feature's row when
// it is released. Pure logic: no imports, no DOM, no network.

export const FEATURE_PLAYER_NAMES = Object.freeze({
  heroPack: 'TOGGLE',
});

/** True when `name` (leading and trailing spaces ignored, case kept) is the toggle name of `feature`. */
export function featureOn(feature, name) {
  const wanted = FEATURE_PLAYER_NAMES[feature];
  return typeof wanted === 'string' && typeof name === 'string' && name.trim() === wanted;
}
