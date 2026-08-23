import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationResource, listConversationResources } from '../services/conversation-resource-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const messageId = '33333333-3333-4333-8333-333333333333';

test('resource persistence is scoped to the message conversation and tenant', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: '44444444-4444-4444-8444-444444444444', ...Object.fromEntries([
        ['tenant_id', params[0]], ['conversation_id', params[1]], ['message_id', params[2]],
      ]) }] };
    },
  };
  const resource = await createConversationResource(client, {
    tenantId,
    conversationId,
    messageId,
    sourceType: 'UPLOAD',
    mediaCategory: 'DOCUMENT',
    originalFilename: 'license.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 12,
    storageKey: 'conversation-resources/a/b/c',
    contentHash: 'a'.repeat(64),
  });
  assert.equal(resource.tenant_id, tenantId);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params.slice(0, 5), [tenantId, conversationId, messageId, 'UPLOAD', 'DOCUMENT']);
});

test('resource reads remain tenant and conversation scoped', async () => {
  const calls = [];
  await listConversationResources(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  }, { tenantId, conversationId });
  assert.deepEqual(calls[0].params, [tenantId, conversationId, null]);
  assert.match(calls[0].sql, /tenant_id = \$1/);
  assert.match(calls[0].sql, /conversation_id = \$2/);
});
