import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRetryableInitialization } from './retryable-init.js';

test('a temporary storage failure can recover in-session and success initializes only once', async () => {
  let attempts = 0;
  const ready = createRetryableInitialization(async () => {
    if (++attempts === 1) throw new Error('storage unavailable');
    return 'initialized';
  });
  await assert.rejects(ready(), /storage unavailable/);
  assert.deepEqual(await Promise.all([ready(), ready()]), ['initialized', 'initialized']);
  await ready();
  assert.equal(attempts, 2);
});
