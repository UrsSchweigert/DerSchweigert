export function createRetryableInitialization(initialize) {
  let pending = null;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(initialize).catch(error => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}
