process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';

import test from 'node:test';
import assert from 'node:assert/strict';
import { listHumanAttentionSummary } from '../services/human-support-service.js';

test('human attention summary counts only the canonical active waiting state', async () => {
  let sql = '';
  const database = {
    query: async (queryText) => {
      sql = queryText;
      return { rows: [{ unresolved_count: 2 }] };
    },
  };

  const summary = await listHumanAttentionSummary({
    tenantId: '11111111-1111-4111-8111-111111111111',
    database,
  });

  assert.equal(summary.unresolvedCount, 2);
  assert.match(sql, /status = 'open'/i);
  assert.match(sql, /handling_mode = 'HUMAN'/i);
  assert.match(sql, /human_attention_state = 'REQUESTED'/i);
  assert.match(sql, /handoff_requested = TRUE/i);
  assert.match(sql, /human_support_closed_at IS NULL/i);
});
