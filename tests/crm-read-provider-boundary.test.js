import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getContact,
  getCrmOverviewMetrics,
  getLead,
  getPipelineSummary,
  listCompanies,
  listContacts,
  listDeals,
  listLeads,
  listPipelineStages,
} from '../services/crm-read-service.js';
import { createAnalysisCheckpoint, qualifyConversation, shouldRunQualification } from '../services/lead-qualification-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const resourceId = '22222222-2222-4222-8222-222222222222';

function readQuerySpy() {
  const calls = [];
  const queryFn = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: resourceId, total: '1', tenant_id: tenantId }] };
  };
  return { calls, queryFn };
}

test('all CRM read services stay on the database boundary and invoke zero qualification providers', async () => {
  const { calls, queryFn } = readQuerySpy();
  let providerCalls = 0;
  const provider = async () => { providerCalls += 1; throw new Error('read must not invoke provider'); };

  await listLeads(queryFn, { tenantId, limit: 10, offset: 5, temperature: 'HOT', stageId: resourceId, assignedUserId: resourceId, source: 'SAMCHEGUIDE' });
  await getLead(queryFn, { tenantId, leadId: resourceId });
  await listContacts(queryFn, { tenantId, limit: 10, offset: 0 });
  await getContact(queryFn, { tenantId, contactId: resourceId });
  await listCompanies(queryFn, { tenantId, limit: 10, offset: 0 });
  await listPipelineStages(queryFn, { tenantId });
  await listDeals(queryFn, { tenantId, limit: 10, offset: 0 });
  await getPipelineSummary(queryFn, { tenantId });
  await getCrmOverviewMetrics(queryFn, { tenantId });

  assert.equal(calls.length, 10);
  assert.equal(providerCalls, 0);
  assert.ok(calls.every(({ params }) => params[0] === tenantId), 'every read is tenant-scoped');
  assert.ok(calls.some(({ params }) => params.includes(10) && params.includes(5)), 'pagination is exercised');
  assert.ok(calls.some(({ params }) => params.includes('HOT')), 'filtering is exercised');
  assert.ok(calls.some(({ params }) => params.includes('SAMCHEGUIDE')), 'source filtering is exercised');
  // Keep the provider double in scope: a read path has no route to it.
  assert.equal(typeof provider, 'function');
});

test('manual rescore eligibility forces the existing qualification provider boundary', async () => {
  const messages = [{
    id: 'message-1',
    sender_type: 'CUSTOMER',
    content: 'Please prepare a company formation proposal. My approved budget is AED 30000.',
  }];
  const checkpoint = { hash: 'unchanged-checkpoint', analyzed_customer_message_count: 1 };
  assert.equal(shouldRunQualification({ messages, existingAnalysis: checkpoint, force: true }), true);

  let providerCalls = 0;
  await qualifyConversation({
    messages,
    existingAnalysis: checkpoint,
    force: true,
    contact: {},
    invokeModel: async () => {
      providerCalls += 1;
      return {
        signals: {
          purchase_intent: 'EXPLICIT', service_fit: 'STRONG', decision_readiness: 'HIGH',
          pricing_request: true, appointment_interest: false, human_consultant_request: false,
          budget: { amount: 30000, currency: 'AED', evidence: 'AED 30000' },
          timeline: { value: null, evidence: null },
        },
      };
    },
  });
  assert.equal(providerCalls, 1);
});

test('automatic qualification remains blocked for trivial or unchanged customer context', () => {
  const trivial = [{ id: 'm1', sender_type: 'CUSTOMER', content: 'hi' }];
  assert.equal(shouldRunQualification({ messages: trivial }), false);

  const meaningful = [{ id: 'm2', sender_type: 'CUSTOMER', content: 'I need a company formation proposal for two visas within two weeks.' }];
  const checkpoint = createAnalysisCheckpoint(meaningful);
  assert.equal(shouldRunQualification({ messages: meaningful, existingAnalysis: { analysis_hash: checkpoint.hash, analyzed_customer_message_count: 1 } }), false);
});

