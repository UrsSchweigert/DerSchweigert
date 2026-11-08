import { createPreferencesBackend } from './progress-store.js';
import { createProfileStore } from './profile-store.js';

// Compose this adapter into the app platform; billing remains device-wide.
// Optional attempt summaries share recordLevel's atomic profile transaction.
// Unscored practice badges use a separate, profile-local recordPractice receipt.
export function createLocalProfileAdapter({
  backend = createPreferencesBackend(),
  makeId,
  now,
} = {}) {
  return createProfileStore(backend, { makeId, now });
}
