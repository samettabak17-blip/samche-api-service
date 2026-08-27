import test from 'node:test';
import assert from 'node:assert/strict';
import { claimNextKnowledgeProcessingJob, streamToBuffer } from '../services/knowledge-source-processing-service.js';

test('claims only one pending knowledge job with SKIP LOCKED to keep tenant processing isolated', async () => {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 'job-1', tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] };
    },
  };

  const job = await claimNextKnowledgeProcessingJob(database);
  assert.equal(job.id, 'job-1');
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/i);
  assert.match(calls[0].sql, /status = 'PENDING'/i);
});

test('reads a private object stream without coercing its binary data to text', async () => {
  const body = (async function* stream() {
    yield Buffer.from([0, 1, 2]);
    yield Buffer.from([3, 255]);
  }());

  const bytes = await streamToBuffer(body);
  assert.deepEqual([...bytes], [0, 1, 2, 3, 255]);
});
