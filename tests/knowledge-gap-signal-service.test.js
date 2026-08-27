import test from 'node:test';
import assert from 'node:assert/strict';
import { recordVerifiedKnowledgeGapSignal } from '../services/knowledge-gap-signal-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const assistantId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const messageId = '44444444-4444-4444-8444-444444444444';

test('only verified missing-knowledge signals create a tenant-scoped review gap with safe provenance', async () => {
  const calls = [];
  const database = { async query(sql, params) { calls.push({ sql, params }); return { rows: [{ id: '55555555-5555-4555-8555-555555555555', status: 'NEEDS_REVIEW' }], rowCount: 1 }; } };
  await recordVerifiedKnowledgeGapSignal({ database, tenantId, assistantId, conversationId, messageId, channelType: 'WHATSAPP', signalType: 'MISSING_KNOWLEDGE_CONFIRMED', question: 'Contact ada@example.com about renewal policy' });
  assert.match(calls[0].sql, /knowledge_gap_signals/);
  assert.equal(calls[0].params[0], tenantId);
  assert.doesNotMatch(calls[0].params[5], /ada@example\.com/);
  assert.match(calls[1].sql, /knowledge_gaps/);
  assert.match(calls[1].sql, /NEEDS_REVIEW/);
});

test('unattributed handoffs and generic fallbacks cannot create knowledge gaps', async () => {
  const database = { async query() { throw new Error('must not query'); } };
  await assert.rejects(() => recordVerifiedKnowledgeGapSignal({ database, tenantId, assistantId, conversationId, messageId, channelType: 'WHATSAPP', signalType: 'HUMAN_TAKEOVER', question: 'help' }), { code: 'KNOWLEDGE_GAP_SIGNAL_NOT_ATTRIBUTED' });
});

