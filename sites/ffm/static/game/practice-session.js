const KINDS = new Set(['targeted', 'short', 'assisted', 'elite', 'recovery', 'shapes']);
const isProblem = (problem) => problem !== null && typeof problem === 'object' && !Array.isArray(problem);
const invalid = (message) => Object.assign(new TypeError(message), { code: 'invalid_practice' });

export function collectTargetedProblems(problems) {
  if (!Array.isArray(problems) || !problems.every(isProblem)) throw invalid('Problem objects are required');
  return [...new Set(problems)].slice(0, 5);
}

export const createTargetedProblems = collectTargetedProblems;

export function getPracticeEliteHp(regularHP) {
  if (!Number.isSafeInteger(regularHP) || regularHP < 1) throw invalid('Positive enemy HP is required');
  return Math.max(3, regularHP);
}

export function getPracticeBadgeIds(operations, kind) {
  if (!KINDS.has(kind)) throw invalid('Unknown practice kind');
  if (kind === 'targeted') return ['practice-targeted'];
  if (kind === 'shapes') return ['practice-shapes'];
  const badges = { '+': 'addition', '-': 'subtraction', '*': 'multiplication', '/': 'division' };
  if (!Array.isArray(operations) || !operations.every((operation) => Object.hasOwn(badges, operation))) {
    throw invalid('Arithmetic operations are required');
  }
  return [...new Set(operations.map((operation) => `practice-${badges[operation]}`))];
}

function validateAnswer(problem, correct, options) {
  if (!isProblem(problem) || typeof correct !== 'boolean' || !isProblem(options)
      || Object.keys(options).some((key) => !['timeout', 'spell'].includes(key))
      || ['timeout', 'spell'].some((key) => options[key] !== undefined && typeof options[key] !== 'boolean')
      || (correct && options.timeout)) throw invalid('A problem, reply and valid answer options are required');
}

/**
 * All kinds are unscored. Enemy-budget sessions count defeated encounters,
 * never individual replies (an elite encounter can have several HP).
 * Shapes/targeted resolve failed replies too; the caller waits for correction
 * feedback before displaying completion.
 */
export function createPracticeSession({ kind, problems = [] } = {}) {
  if (!KINDS.has(kind)) throw invalid('Unknown practice kind');
  if (!Array.isArray(problems) || !problems.every(isProblem)) throw invalid('Problem objects are required');
  const ordered = kind === 'targeted' ? collectTargetedProblems(problems) : [...problems];
  if (kind === 'targeted' && ordered.length === 0) throw invalid('Targeted practice requires missed problems');
  const targetProblems = kind === 'targeted' ? ordered.length : kind === 'shapes' ? 10 : null;
  const targetEncounters = targetProblems === null ? 10 : null;
  const resolved = new Set();
  let encountersDefeated = 0;
  let correctAnswers = 0;
  let incorrectAnswers = 0;
  let timeouts = 0;
  const isComplete = () => targetProblems === null
    ? encountersDefeated >= targetEncounters : resolved.size >= targetProblems;
  const snapshot = () => Object.freeze({
    kind, scored: false, untimed: ['targeted', 'assisted'].includes(kind), targetProblems, targetEncounters,
    resolvedProblems: resolved.size, encountersDefeated, correctAnswers, incorrectAnswers,
    timeouts, complete: isComplete(),
  });
  return Object.freeze({
    snapshot, isComplete,
    nextProblem: () => ordered.find((problem) => !resolved.has(problem)) ?? null,
    recordAnswer(problem, correct, options = {}) {
      validateAnswer(problem, correct, options);
      if (options.spell || isComplete()) return snapshot();
      if (kind === 'targeted' && !ordered.includes(problem)) throw invalid('Problem is outside this targeted session');
      if (correct) correctAnswers++;
      else if (options.timeout) timeouts++;
      else incorrectAnswers++;
      resolved.add(problem);
      return snapshot();
    },
    recordEncounterDefeated() {
      if (targetEncounters !== null && !isComplete()) encountersDefeated++;
      return snapshot();
    },
  });
}

/**
 * A fresh tracker belongs to one attempt. Only actual correct replies count;
 * corrected retries count once by object identity, spells never count.
 */
export function createEarnedRecovery() {
  const credited = new WeakSet();
  let correctSinceHeal = 0;
  let heals = 0;
  const snapshot = () => Object.freeze({ correctSinceHeal, heals, maxHeals: 2 });
  return Object.freeze({
    snapshot,
    recordCorrect(problem, { hearts, maxHearts, spell = false, timeout = false } = {}) {
      if (!isProblem(problem) || !Number.isSafeInteger(hearts) || hearts < 0
          || !Number.isSafeInteger(maxHearts) || maxHearts < 1 || hearts > maxHearts
          || typeof spell !== 'boolean' || typeof timeout !== 'boolean') {
        throw invalid('A problem and valid heart state are required');
      }
      if (hearts === maxHearts) {
        correctSinceHeal = 0;
        if (!spell && !timeout) credited.add(problem);
        return false;
      }
      if (spell || timeout || credited.has(problem) || heals >= 2) return false;
      credited.add(problem);
      if (++correctSinceHeal < 5) return false;
      correctSinceHeal = 0;
      heals++;
      return true;
    },
  });
}
