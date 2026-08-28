import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadCurrentProviderHistory,
  resolveAssistantKnowledgeAuthority,
  resolveConversationKnowledgeAuthority,
} from '../services/knowledge-authority-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const assistantId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

test('resolves a tenant-scoped Assistant authority snapshot', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ assistant_id: assistantId, knowledge_authority_version: '7' }], rowCount: 1 };
    },
  };

  const snapshot = await resolveAssistantKnowledgeAuthority(client, { tenantId, assistantId });
  assert.deepEqual(snapshot, { assistantId, version: 7n });
  assert.match(calls[0].sql, /tenant_id = \$1/);
  assert.match(calls[0].sql, /id = \$2/);
  assert.deepEqual(calls[0].params, [tenantId, assistantId]);
});

test('conversation authority resolution fails closed for an unmapped channel', async () => {
  const client = { async query() { return { rows: [], rowCount: 0 }; } };
  assert.equal(await resolveConversationKnowledgeAuthority(client, { tenantId, conversationId }), null);
});

test('provider history accepts every sender type only at the exact current epoch', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [
          { sender_type: 'SYSTEM', content: 'current system' },
          { sender_type: 'AGENT', content: 'current agent' },
          { sender_type: 'ASSISTANT', content: 'current assistant' },
          { sender_type: 'CUSTOMER', content: 'current customer' },
        ],
      };
    },
  };

  const history = await loadCurrentProviderHistory(client, {
    tenantId,
    conversationId,
    assistantId,
    version: 7n,
    limit: 12,
    excludeMessageId: '44444444-4444-4444-8444-444444444444',
  });

  assert.deepEqual(history.map((row) => row.sender_type), ['CUSTOMER', 'ASSISTANT', 'AGENT', 'SYSTEM']);
  assert.match(calls[0].sql, /authority_assistant_id = \$3/);
  assert.match(calls[0].sql, /knowledge_authority_version = \$4/);
  assert.match(calls[0].sql, /id <> \$6/);
  assert.doesNotMatch(calls[0].sql, /authority_assistant_id IS NULL|knowledge_authority_version IS NULL/);
  assert.deepEqual(calls[0].params, [tenantId, conversationId, assistantId, '7', 12, '44444444-4444-4444-8444-444444444444']);
});

test('provider history query fails closed without a proven authority snapshot', async () => {
  let queried = false;
  const client = { async query() { queried = true; return { rows: [] }; } };
  assert.deepEqual(await loadCurrentProviderHistory(client, {
    tenantId,
    conversationId,
    assistantId: null,
    version: null,
  }), []);
  assert.equal(queried, false);
});
