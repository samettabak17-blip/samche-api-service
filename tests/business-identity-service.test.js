import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBusinessIdentityScope, normalizeBusinessIdentity } from '../services/business-identity-service.js';

test('one identity across multiple selected sources resolves', async () => {
  const provider = {
    provider: 'GEMINI', model: 'gemini-3-flash-preview',
    generateBusinessIdentityAnalysis: async ({ source }) => ({ detected_identity: source.title.includes('One') ? 'Meridian Arc Technologies LLC' : 'Meridian Arc Technologies L.L.C.', confidence: '0.98', evidence: 'Company header' }),
  };
  const result = await analyzeBusinessIdentityScope({ provider, sources: [
    { id: 'a', title: 'One', content: 'x', content_hash: '1' },
    { id: 'b', title: 'Two', content: 'y', content_hash: '2' },
  ] });
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.identities.length, 1);
  assert.equal(result.evidence.length, 2);
});

test('two distinct source-derived identities require explicit resolution', async () => {
  const provider = {
    provider: 'GEMINI', model: 'gemini-3-flash-preview',
    generateBusinessIdentityAnalysis: async ({ source }) => ({ detected_identity: source.title, confidence: '0.99', evidence: 'Legal name' }),
  };
  const result = await analyzeBusinessIdentityScope({ provider, sources: [
    { id: 'a', title: 'Meridian Arc Technologies LLC', content: 'x', content_hash: '1' },
    { id: 'b', title: 'Nova Crest Business Services LLC', content: 'y', content_hash: '2' },
  ] });
  assert.equal(result.status, 'IDENTITY_RESOLUTION_REQUIRED');
  assert.deepEqual(result.identities.map((item) => item.detected_identity), ['Meridian Arc Technologies LLC', 'Nova Crest Business Services LLC']);
});

test('every selected source must resolve confidently to the same identity', async () => {
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessIdentityAnalysis: async ({ source }) => source.id === 'a'
    ? { detected_identity: 'Meridian Arc Technologies LLC', confidence: '0.99', evidence: 'Legal name' }
    : { detected_identity: '', confidence: '0.20', evidence: 'Contact test@example.com +971501234567' } };
  const result = await analyzeBusinessIdentityScope({ provider, sources: [{ id: 'a', title: 'Identity', content: 'x' }, { id: 'b', title: 'Unclear', content: 'y' }] });
  assert.equal(result.status, 'IDENTITY_RESOLUTION_REQUIRED');
  assert.equal(result.evidence[1].normalized_identity, null);
  assert.doesNotMatch(result.evidence[1].safe_evidence, /test@example|501234567/);
});

test('normalization is generic and does not contain customer-specific mapping', () => {
  assert.equal(normalizeBusinessIdentity(' Meridian Arc Technologies L.L.C. '), 'meridian arc technologies');
  assert.equal(normalizeBusinessIdentity('NOVA-CREST Business Services LLC'), 'nova crest business services');
});
