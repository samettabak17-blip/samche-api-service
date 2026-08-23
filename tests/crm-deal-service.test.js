import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDealUpdate,
  dealStatusForStage,
  isIsoDate,
  isValidCurrency,
  isValidProbability,
  resolveDealReferences,
} from '../services/crm-deal-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const leadId = '33333333-3333-4333-8333-333333333333';
const stageId = '44444444-4444-4444-8444-444444444444';

test('deal stage semantics keep only Won and Lost terminal', () => {
  assert.equal(dealStatusForStage('WON'), 'won');
  assert.equal(dealStatusForStage('LOST'), 'lost');
  assert.equal(dealStatusForStage('QUALIFIED'), 'open');
});

test('deal validation helpers reject invalid monetary and lifecycle inputs', () => {
  assert.equal(isValidCurrency('AED'), true);
  assert.equal(isValidCurrency('aed'), false);
  assert.equal(isValidProbability(0), true);
  assert.equal(isValidProbability(100), true);
  assert.equal(isValidProbability(101), false);
  assert.equal(isIsoDate('2026-08-23'), true);
  assert.equal(isIsoDate('2026-20-23'), false);
});

test('deal references are resolved only within the tenant and lead must match contact', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('crm_contacts')) return { rowCount: 1, rows: [{ id: contactId }] };
    if (sql.includes('crm_leads')) return { rowCount: 1, rows: [{ id: leadId }] };
    if (sql.includes('crm_pipeline_stages')) return { rowCount: 1, rows: [{ id: stageId, stage_key: 'NEW_LEAD' }] };
    return { rowCount: 1, rows: [{ user_id: leadId }] };
  };
  const resolved = await resolveDealReferences(query, { tenantId, contactId, leadId, stageId, ownerUserId: leadId });
  assert.equal(resolved.error, undefined);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.params[0] === tenantId));
});

test('deal update builder has a fixed allowlist and permits clearing optional fields', () => {
  const update = buildDealUpdate({ title: 'Proposal', notes: null, probability: 70, ignored: 'not persisted' });
  assert.deepEqual(update.values, ['Proposal', 70, null]);
  assert.equal(update.fields.join(', '), 'title = $1, probability = $2, notes = $3, updated_at = CURRENT_TIMESTAMP');
  assert.equal(buildDealUpdate({ ignored: 'no-op' }), null);
});
