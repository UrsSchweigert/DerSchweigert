let sequence = 0;

export function createCompletionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++sequence}`;
}

// Capture the completed level and its owner before the game can advance.
export function createLevelCompletion(platform, record) {
  const snapshot = Object.freeze({
    ...record,
    ...(record.attemptSummary ? { attemptSummary: Object.freeze({ ...record.attemptSummary }) } : {}),
  });
  let pending = null;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(() => platform.postLevelScore(
        snapshot.level, snapshot.score, snapshot.difficulty,
        {
          profileId: snapshot.profileId, completionId: snapshot.completionId,
          ...(snapshot.attemptSummary ? { attemptSummary: snapshot.attemptSummary } : {}),
        },
      )).catch(error => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}
