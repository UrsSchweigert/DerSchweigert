import { SCORE_HISTORY_LIMIT } from './progress-store.js';

export const PROFILE_KEY = 'arithmoslayer:profiles';
export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_NAME_LIMIT = 40;
export const PRACTICE_BADGE_IDS = Object.freeze([
  'practice-targeted', 'practice-addition', 'practice-subtraction',
  'practice-multiplication', 'practice-division', 'practice-shapes',
]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const levelValid = (level) => Number.isInteger(level) && level >= 1;
const scoreValid = (score) => typeof score === 'number' && Number.isFinite(score) && score >= 0;
const attemptFields = ['firstAttemptCorrect', 'firstAttemptTotal', 'correctAnswers',
  'incorrectAnswers', 'timeouts', 'bestStreak'];

function validAttempt(value) {
  if (!object(value) || Object.keys(value).length !== attemptFields.length
      || !attemptFields.every((key) => own(value, key) && Number.isSafeInteger(value[key]) && value[key] >= 0)) return false;
  const { firstAttemptCorrect: first, firstAttemptTotal: total, correctAnswers: correct,
    incorrectAnswers: incorrect, timeouts, bestStreak } = value;
  const failures = incorrect + timeouts;
  return Number.isSafeInteger(correct + failures) && first <= total && first <= correct
    && total <= correct + failures && total - first <= failures && bestStreak <= correct
    && (total > 0 || correct + failures === 0)
    && (correct === 0 ? bestStreak === 0 : bestStreak > 0);
}

const optionalAttemptValid = (value) => !own(value, 'attemptSummary') || validAttempt(value.attemptSummary);
const validBadges = (value) => Array.isArray(value) && value.length <= PRACTICE_BADGE_IDS.length
  && value.every((badge) => PRACTICE_BADGE_IDS.includes(badge)) && new Set(value).size === value.length;

function validPractice(profile) {
  const hasBadges = own(profile, 'practiceBadges');
  const hasReceipts = own(profile, 'practiceReceipts');
  if (!hasBadges && !hasReceipts) return true;
  if (!hasBadges || !hasReceipts || !validBadges(profile.practiceBadges)
      || !object(profile.practiceReceipts)) return false;
  const earned = new Set();
  for (const [id, receipt] of Object.entries(profile.practiceReceipts)) {
    if (!id || !object(receipt) || Object.keys(receipt).length !== 2
        || !own(receipt, 'badgeIds') || !own(receipt, 'badges')
        || !validBadges(receipt.badgeIds) || !validBadges(receipt.badges)
        || receipt.badgeIds.some((badge) => !profile.practiceBadges.includes(badge))
        || receipt.badges.some((badge) => !receipt.badgeIds.includes(badge) || earned.has(badge))) return false;
    receipt.badges.forEach((badge) => earned.add(badge));
  }
  return earned.size === profile.practiceBadges.length && profile.practiceBadges.every((badge) => earned.has(badge));
}

function error(code, message, cause) {
  return Object.assign(new Error(message, { cause }), { code });
}

function nameValue(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > PROFILE_NAME_LIMIT) {
    throw error('invalid_profile_name', 'Enter a name of 1–40 characters');
  }
  return name.trim();
}

function validEntry(entry) {
  return object(entry) && levelValid(entry.level) && scoreValid(entry.score)
    && (entry.difficulty === null || typeof entry.difficulty === 'string')
    && typeof entry.achieved_at === 'string' && optionalAttemptValid(entry)
    && (!own(entry, 'unfinished') || entry.unfinished === true);
}

function validPartialReceipt(receipt) {
  return object(receipt) && Object.keys(receipt).length === 4
    && levelValid(receipt.level) && scoreValid(receipt.score)
    && (receipt.difficulty === null || typeof receipt.difficulty === 'string')
    && typeof receipt.bestImproved === 'boolean';
}

function validateDocument(doc) {
  if (!object(doc) || doc.version !== PROFILE_SCHEMA_VERSION || !Array.isArray(doc.profiles)
      || !doc.profiles.length || typeof doc.activeProfileId !== 'string') return false;
  const ids = new Set();
  for (const profile of doc.profiles) {
    if (!object(profile) || typeof profile.id !== 'string' || !profile.id || ids.has(profile.id)
        || typeof profile.name !== 'string' || !profile.name.trim()
        || !Array.isArray(profile.best) || !profile.best.every(validEntry)
        || !Array.isArray(profile.history) || profile.history.length > SCORE_HISTORY_LIMIT
        || !profile.history.every(validEntry)
        || !Array.isArray(profile.completed) || !profile.completed.every(levelValid)
        || !object(profile.completions) || !validPractice(profile)) return false;
    if (own(profile, 'partialAttempts')
        && (!object(profile.partialAttempts)
          || !Object.values(profile.partialAttempts).every(validPartialReceipt))) return false;
    if (own(profile, 'attemptLast')) {
      if (!Array.isArray(profile.attemptLast)) return false;
      const keys = new Set();
      for (const entry of profile.attemptLast) {
        if (!object(entry) || !levelValid(entry.level)
            || (entry.difficulty !== null && typeof entry.difficulty !== 'string')
            || !validAttempt(entry.attemptSummary)) return false;
        const key = JSON.stringify([entry.level, entry.difficulty]);
        if (keys.has(key)) return false;
        keys.add(key);
      }
    }
    for (const receipt of Object.values(profile.completions)) {
      if (!object(receipt) || !levelValid(receipt.level) || !scoreValid(receipt.score)
          || (receipt.difficulty !== null && typeof receipt.difficulty !== 'string')
          || typeof receipt.bestImproved !== 'boolean' || !optionalAttemptValid(receipt)
          || (own(receipt, 'attemptSummary') && (!own(receipt, 'previousAttemptSummary')
            || (receipt.previousAttemptSummary !== null && !validAttempt(receipt.previousAttemptSummary))))
          || (!own(receipt, 'attemptSummary') && own(receipt, 'previousAttemptSummary'))) return false;
    }
    ids.add(profile.id);
  }
  return ids.has(doc.activeProfileId);
}

/**
 * The cache is committed only after the single document write resolves.
 * All operations queue behind pending writes, including reads and retries.
 */
export function createProfileStore(backend, {
  makeId = () => globalThis.crypto.randomUUID(),
  now = () => new Date().toISOString(),
} = {}) {
  let document = null;
  let queue = Promise.resolve();
  const serialize = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const available = () => backend && typeof backend.get === 'function'
    && typeof backend.set === 'function'
    && (typeof backend.isAvailable !== 'function' || backend.isAvailable());
  const storage = async (operation) => {
    try {
      if (!available()) throw new Error('Preferences is unavailable');
      return await operation();
    } catch (cause) {
      throw error('storage_unavailable', 'Profile storage is unavailable', cause);
    }
  };
  const requireDocument = () => {
    if (!document) throw error('storage_unavailable', 'Initialize profile storage first');
    return document;
  };
  const find = (doc, id) => {
    const profile = doc.profiles.find((item) => item.id === id);
    if (!profile) throw error('profile_not_found', 'Profile does not exist');
    return profile;
  };
  const summary = (profile) => ({ id: profile.id, name: profile.name });
  const fresh = (name, doc) => {
    const id = makeId();
    if (typeof id !== 'string' || !id || doc?.profiles.some((item) => item.id === id)) {
      throw error('invalid_profile_id', 'A unique profile ID is required');
    }
    return { id, name: nameValue(name), best: [], history: [], completed: [], completions: {} };
  };
  const commit = async (next) => {
    await storage(() => backend.set(PROFILE_KEY, JSON.stringify(next)));
    document = next;
  };
  const read = (operation) => serialize(() => clone(operation(requireDocument())));
  const mutate = (operation) => serialize(async () => {
    const next = clone(requireDocument());
    const result = operation(next);
    await commit(next);
    return clone(result);
  });

  return {
    initialize({ defaultName = 'Player 1' } = {}) {
      return serialize(async () => {
        if (document) return summary(find(document, document.activeProfileId));
        const raw = await storage(() => backend.get(PROFILE_KEY));
        if (raw !== null && raw !== undefined) {
          const loaded = await storage(() => {
            const parsed = JSON.parse(raw);
            if (!validateDocument(parsed)) throw new Error('Invalid or unsupported profile document');
            return parsed;
          });
          document = loaded;
        } else {
          const profile = fresh(defaultName);
          await commit({ version: PROFILE_SCHEMA_VERSION, activeProfileId: profile.id, profiles: [profile] });
        }
        return summary(find(document, document.activeProfileId));
      });
    },
    listProfiles: () => read((doc) => doc.profiles.map(summary)),
    getActiveProfile() {
      const doc = requireDocument();
      return summary(find(doc, doc.activeProfileId));
    },
    createProfile: (name) => mutate((doc) => {
      const profile = fresh(name, doc);
      doc.profiles.push(profile);
      doc.activeProfileId = profile.id;
      return summary(profile);
    }),
    selectProfile: (id) => mutate((doc) => {
      const profile = find(doc, id);
      doc.activeProfileId = profile.id;
      return summary(profile);
    }),
    renameProfile: (id, name) => mutate((doc) => {
      const profile = find(doc, id);
      profile.name = nameValue(name);
      return summary(profile);
    }),
    deleteProfile: (id, { confirmed = false } = {}) => mutate((doc) => {
      find(doc, id);
      if (!confirmed) throw error('confirmation_required', 'Confirm profile deletion');
      if (doc.profiles.length === 1) throw error('last_profile', 'Keep at least one profile');
      doc.profiles = doc.profiles.filter((profile) => profile.id !== id);
      if (doc.activeProfileId === id) doc.activeProfileId = doc.profiles[0].id;
      return summary(find(doc, doc.activeProfileId));
    }),
    getBestScores: (id) => read((doc) => ({ best: find(doc, id).best })),
    getScoreHistory: (id) => read((doc) => ({ history: find(doc, id).history })),
    getCompletedLevels: (id) => read((doc) => ({ completed: find(doc, id).completed })),
    getPracticeBadges: (id) => read((doc) => ({ badges: find(doc, id).practiceBadges ?? [] })),
    recordPractice(input) {
      const { profileId, sessionId } = input ?? {};
      const supplied = input?.badgeIds;
      if (typeof profileId !== 'string' || !profileId || typeof sessionId !== 'string' || !sessionId
          || !validBadges(supplied)) {
        return Promise.reject(error('invalid_practice', 'A profile, session ID and valid badge IDs are required'));
      }
      // Canonicalize the set and capture it before entering the write queue.
      const badgeIds = [...supplied].sort();
      return serialize(async () => {
        const next = clone(requireDocument());
        const profile = find(next, profileId);
        if (own(profile.practiceReceipts ?? {}, sessionId)) {
          const receipt = profile.practiceReceipts[sessionId];
          if (receipt.badgeIds.length !== badgeIds.length
              || !badgeIds.every((badge) => receipt.badgeIds.includes(badge))) {
            throw error('practice_conflict', 'Practice session ID was already used for different badges');
          }
          return { persisted: true, badges: clone(receipt.badges) };
        }
        const badges = badgeIds.filter((badge) => !(profile.practiceBadges ?? []).includes(badge));
        profile.practiceBadges = [...(profile.practiceBadges ?? []), ...badges];
        profile.practiceReceipts ??= {};
        Object.defineProperty(profile.practiceReceipts, sessionId, {
          value: { badgeIds, badges }, enumerable: true,
        });
        await commit(next);
        return { persisted: true, badges: clone(badges) };
      });
    },
    // Only the same level/difficulty's previous completed attempt is compared;
    // legacy completions have no summary, never inferred statistics.
    getAttemptSummary: (id, level, difficulty = null) => read((doc) => {
      if (!levelValid(level) || (difficulty !== null && typeof difficulty !== 'string')) {
        throw error('invalid_completion', 'A level and valid difficulty are required');
      }
      return find(doc, id).attemptLast?.find((entry) =>
        entry.level === level && entry.difficulty === difficulty)?.attemptSummary ?? null;
    }),
    // A pause-exit save banks the reached score without clearing the level:
    // best and history gain an `unfinished` entry, completed never changes.
    recordPartialAttempt(input) {
      const { profileId, completionId, level, score, difficulty = null } = input ?? {};
      if (typeof profileId !== 'string' || !profileId || typeof completionId !== 'string'
          || !completionId || !levelValid(level) || !scoreValid(score)
          || (difficulty !== null && typeof difficulty !== 'string')) {
        return Promise.reject(error('invalid_partial', 'A profile, partial ID, level and valid score are required'));
      }
      const resultFor = (receipt) => ({ persisted: true, bestImproved: receipt.bestImproved });
      return serialize(async () => {
        const next = clone(requireDocument());
        const profile = find(next, profileId);
        if (own(profile.partialAttempts ?? {}, completionId)) {
          const receipt = profile.partialAttempts[completionId];
          if (receipt.level !== level || receipt.score !== score || receipt.difficulty !== difficulty) {
            throw error('partial_conflict', 'Partial attempt ID was already used for a different result');
          }
          return resultFor(receipt);
        }
        const best = profile.best.find((entry) => entry.level === level);
        const bestImproved = score > (best?.score ?? 0);
        const timestamp = now();
        const entry = { level, score, difficulty, achieved_at: timestamp instanceof Date ? timestamp.toISOString() : timestamp,
          unfinished: true };
        if (!validEntry(entry)) throw error('invalid_partial', 'A valid timestamp is required');
        if (bestImproved) {
          profile.best = profile.best.filter((item) => item.level !== level);
          profile.best.push(entry);
          profile.best.sort((a, b) => a.level - b.level);
        }
        profile.history.push(entry);
        profile.history = profile.history.slice(-SCORE_HISTORY_LIMIT);
        profile.partialAttempts ??= {};
        Object.defineProperty(profile.partialAttempts, completionId, {
          value: { level, score, difficulty, bestImproved }, enumerable: true,
        });
        await commit(next);
        return resultFor({ bestImproved });
      });
    },
    recordLevel(input) {
      // Capture nested counters as well as the owner before waiting on writes.
      const { profileId, completionId, level, score, difficulty = null } = input ?? {};
      const hasAttempt = input != null && own(input, 'attemptSummary');
      let attemptSummary;
      if (hasAttempt) {
        const supplied = input.attemptSummary;
        if (!validAttempt(supplied)) {
          return Promise.reject(error('invalid_completion', 'A valid attempt summary is required'));
        }
        attemptSummary = Object.freeze(Object.fromEntries(attemptFields.map((key) => [key, supplied[key]])));
        if (!validAttempt(attemptSummary)) {
          return Promise.reject(error('invalid_completion', 'A valid attempt summary is required'));
        }
      }
      const resultFor = (receipt) => ({
        persisted: true, bestImproved: receipt.bestImproved,
        ...(own(receipt, 'attemptSummary') ? { previousAttemptSummary: clone(receipt.previousAttemptSummary) } : {}),
      });
      return serialize(async () => {
        if (typeof completionId !== 'string' || !completionId || !levelValid(level)
            || !scoreValid(score) || (difficulty !== null && typeof difficulty !== 'string')) {
          throw error('invalid_completion', 'A completion ID, level and valid score are required');
        }
        const next = clone(requireDocument());
        const profile = find(next, profileId);
        if (own(profile.completions, completionId)) {
          const receipt = profile.completions[completionId];
          if (receipt.level !== level || receipt.score !== score || receipt.difficulty !== difficulty
              || own(receipt, 'attemptSummary') !== hasAttempt
              || (hasAttempt && !attemptFields.every((key) => receipt.attemptSummary[key] === attemptSummary[key]))) {
            throw error('completion_conflict', 'Completion ID was already used for a different result');
          }
          return resultFor(receipt);
        }
        const best = profile.best.find((entry) => entry.level === level);
        const bestImproved = score > (best?.score ?? 0);
        const timestamp = now();
        const entry = { level, score, difficulty, achieved_at: timestamp instanceof Date ? timestamp.toISOString() : timestamp,
          ...(hasAttempt ? { attemptSummary } : {}) };
        if (!validEntry(entry)) throw error('invalid_completion', 'A valid timestamp is required');
        if (bestImproved) {
          profile.best = profile.best.filter((item) => item.level !== level);
          profile.best.push(entry);
          profile.best.sort((a, b) => a.level - b.level);
        }
        profile.history.push(entry);
        profile.history = profile.history.slice(-SCORE_HISTORY_LIMIT);
        profile.completed = [...new Set([...profile.completed, level])].sort((a, b) => a - b);
        const previousAttemptSummary = profile.attemptLast?.find((item) =>
          item.level === level && item.difficulty === difficulty)?.attemptSummary ?? null;
        if (hasAttempt || profile.attemptLast) {
          profile.attemptLast = (profile.attemptLast ?? []).filter((item) =>
            item.level !== level || item.difficulty !== difficulty);
          if (hasAttempt) profile.attemptLast.push({ level, difficulty, attemptSummary });
        }
        const receipt = { level, score, difficulty, bestImproved,
          ...(hasAttempt ? { attemptSummary, previousAttemptSummary } : {}) };
        Object.defineProperty(profile.completions, completionId, {
          value: receipt, enumerable: true,
        });
        await commit(next);
        return resultFor(receipt);
      });
    },
  };
}
