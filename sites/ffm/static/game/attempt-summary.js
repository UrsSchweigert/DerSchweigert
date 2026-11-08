/**
 * One tracker per attempt. Problem object identity distinguishes new questions
 * from requeued retries. Timeouts are failures, counted separately from wrong
 * replies; correctAnswers includes correct retries. The six counters describe
 * replies, not scores or proficiency.
 */
export function createAttemptSummary() {
  const seen = new WeakSet();
  let streak = 0;
  const counts = {
    firstAttemptCorrect: 0, firstAttemptTotal: 0, correctAnswers: 0,
    incorrectAnswers: 0, timeouts: 0, bestStreak: 0,
  };
  const snapshot = () => Object.freeze({ ...counts });
  return Object.freeze({
    snapshot,
    recordAnswer(problem, correct, options = {}) {
      if (problem === null || typeof problem !== 'object' || Array.isArray(problem)
          || typeof correct !== 'boolean' || options === null || typeof options !== 'object'
          || Array.isArray(options) || Object.keys(options).some((key) => key !== 'timeout')
          || (options.timeout !== undefined && typeof options.timeout !== 'boolean')
          || (correct && options.timeout === true)) {
        throw Object.assign(new TypeError('A problem object, boolean reply and valid timeout are required'), {
          code: 'invalid_answer',
        });
      }
      const timeout = options.timeout ?? false;
      if (!seen.has(problem)) {
        seen.add(problem);
        counts.firstAttemptTotal++;
        if (correct) counts.firstAttemptCorrect++;
      }
      if (correct) {
        counts.correctAnswers++;
        counts.bestStreak = Math.max(counts.bestStreak, ++streak);
      } else {
        counts[timeout ? 'timeouts' : 'incorrectAnswers']++;
        streak = 0;
      }
      return snapshot();
    },
  });
}
