import test from 'node:test';
import assert from 'node:assert/strict';
import { getKnowledgeOverview } from '../services/knowledge-overview-service.js';

test('returns fixed tenant-scoped Knowledge Intelligence overview metrics', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ ready_sources: '3', processing_sources: '1', failed_sources: '2', review_candidates: '4', open_gaps: '5', review_profiles: '1', active_profile: '1', review_recommendations: '2', review_configurations: '3', active_configurations: '2', assistants: '4' }] };
  } };

  const overview = await getKnowledgeOverview({ database, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });

  assert.deepEqual(overview, {
    sources: { ready: 3, processing: 1, failed: 2 },
    reviewQueue: { candidates: 4, profiles: 1, recommendations: 2, configurations: 3 },
    gaps: { open: 5 },
    runtime: { activeProfile: true, activeConfigurations: 2, assistants: 4 },
  });
  assert.deepEqual(calls[0].params, ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
  assert.match(calls[0].sql, /knowledge_base_documents[\s\S]*knowledge_candidates[\s\S]*knowledge_gaps[\s\S]*business_profile_versions[\s\S]*assistant_configuration_versions/i);
});
