/**
 * Card scoring and Flop Training deck selection logic.
 *
 * recordAttempt updates card stats based on correctness and mode.
 * selectFlopDeck selects the worst-performing cards for focused practice.
 */

/**
 * Record an attempt on a card and update the stats map.
 * @param {object} stats - A map of card text to { correct_count, incorrect_count }
 * @param {string} key - The card text (unique identifier)
 * @param {boolean} correct - Whether the answer was correct
 * @param {{flop: boolean}} options - Options object; flop=true awards 3 points for correct
 */
export function recordAttempt(stats, key, correct, { flop } = {}) {
  if (!stats[key]) {
    stats[key] = { correct_count: 0, incorrect_count: 0 };
  }

  if (correct) {
    // Flop mode awards 3 points for correct, normal mode awards 1
    stats[key].correct_count += flop ? 3 : 1;
  } else {
    // Incorrect always adds 1
    stats[key].incorrect_count += 1;
  }
}

/**
 * Select cards for Flop Training (focused practice on weak cards).
 * 
 * Algorithm:
 * 1. Filter to allowedCards that have been attempted at least once
 * 2. Sort ascending by success rate: correct/(correct+incorrect)
 * 3. Take bottom 10% (rounding up, with min 1 and max 30)
 * 
 * @param {object} stats - A map of card text to { correct_count, incorrect_count }
 * @param {string[]} allowedCards - Array of card texts to consider
 * @returns {string[]} Array of card texts for Flop Training
 */
export function selectFlopDeck(stats, allowedCards) {
  // Filter to only cards that have been attempted at least once
  const attempted = allowedCards.filter((card) => {
    const cardStats = stats[card];
    if (!cardStats) return false;
    const total = cardStats.correct_count + cardStats.incorrect_count;
    return total > 0;
  });

  if (attempted.length === 0) {
    return [];
  }

  // Sort by success rate ascending (worst first)
  const sorted = attempted.sort((a, b) => {
    const statsA = stats[a];
    const statsB = stats[b];
    const rateA =
      statsA.correct_count / (statsA.correct_count + statsA.incorrect_count);
    const rateB =
      statsB.correct_count / (statsB.correct_count + statsB.incorrect_count);
    return rateA - rateB;
  });

  // Calculate bottom 10%, with at least 1 and max 30
  const bottomPercent = Math.ceil(sorted.length * 0.1);
  const count = Math.min(Math.max(bottomPercent, 1), 30);

  return sorted.slice(0, count);
}
