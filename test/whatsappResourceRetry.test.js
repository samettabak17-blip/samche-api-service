import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForReadyResource } from '../services/whatsapp-resource-retry.js';

test('returns a resource that becomes ready during a bounded retry', async () => {
  const states = ['PROCESSING', 'PROCESSING', 'READY'];
  const result = await waitForReadyResource({
    read: async () => ({ processing_status: states.shift() }),
    sleep: async () => {},
    attempts: 3,
    delayMs: 1,
  });
  assert.equal(result.status, 'READY');
  assert.equal(result.attempts, 3);
});

test('stops after the bounded retry and never claims a processing resource is ready', async () => {
  let reads = 0;
  const result = await waitForReadyResource({
    read: async () => { reads += 1; return { processing_status: 'PROCESSING' }; },
    sleep: async () => {},
    attempts: 3,
    delayMs: 1,
  });
  assert.equal(result.status, 'PROCESSING');
  assert.equal(reads, 3);
});

