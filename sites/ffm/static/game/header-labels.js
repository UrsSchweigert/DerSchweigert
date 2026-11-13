// header-labels.js — the gameplay readouts as text.
//
// The app header gives the readouts one full-width row under the question, and
// at 375 px (iPhone SE 3, the narrowest phone the app supports) the qualified
// labels do not fit on a line: "Defeated: 13/17" and "Dragon 3" push the row to
// three or four lines, which steals height from the playfield above it. The app
// drops the qualifiers there; the website keeps them, it has the room.
//
// Pure formatting only — no DOM, no i18n table; the caller passes `translate`.

/** Widest phone screen that gets the compact labels (iPhone SE 3 is 375). */
export const COMPACT_HEADER_MAX_WIDTH = 420;

/**
 * @param {{isApp?: boolean, width?: number}} [options]
 * @returns {boolean} whether the header should use the compact labels.
 */
export function useCompactHeaderLabels({ isApp = false, width = 0 } = {}) {
  return Boolean(isApp) && Number.isFinite(width) && width > 0 && width <= COMPACT_HEADER_MAX_WIDTH;
}

/**
 * "Defeated: 13/17" on the website, "Defeated: 13" in the app on a narrow phone.
 * @param {{defeated: number, total: number}} progress
 * @param {{compact: boolean, translate: (key: string, vars?: object) => string}} options
 */
export function formatEncounterLabel(progress, { compact, translate }) {
  return compact
    ? translate('gameplay.encountersCompact', { defeated: progress.defeated })
    : translate('gameplay.encounters', progress);
}

/**
 * "Dragon in 6" / "Dragon" on the website; "Dragon 6" / "Dragon" in the app on a
 * narrow phone, where the countdown is all the row has space for.
 * @param {{ability: string, remaining: number, chance: number}} reward
 * @param {{compact: boolean, translate: (key: string, vars?: object) => string}} options
 */
export function formatRewardLabel(reward, { compact, translate }) {
  const ability = translate(`reward.${reward.ability}`);
  if (reward.remaining > 0) {
    if (compact) return translate('reward.upcomingCompact', { ability, count: reward.remaining });
    return reward.chance < 1
      ? translate('reward.upcomingChance', {
        ability,
        count: reward.remaining,
        chance: Math.round(reward.chance * 100),
      })
      : translate('reward.upcoming', { ability, count: reward.remaining });
  }
  return reward.chance < 1
    ? translate('reward.activeChance', { ability, chance: Math.round(reward.chance * 100) })
    : translate('reward.active', { ability });
}
