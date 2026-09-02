import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('approval orphan safety migration only deactivates unlinked unapproved conversation materializations', () => {
  const sql = fs.readFileSync(new URL('../migrations/050_candidate_approval_orphan_safety.sql', import.meta.url), 'utf8');
  assert.match(sql, /source_type = 'CONVERSATION_CANDIDATE'/);
  assert.match(sql, /candidate\.status IN \('DRAFT', 'NEEDS_REVIEW'\)/);
  assert.match(sql, /candidate\.approved_source_id = source\.id/);
  assert.match(sql, /knowledge_materialized_source_provenance/);
  assert.match(sql, /SET status = 'inactive', enabled = FALSE/);
});
