import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantFollowUpRequest, resolveTenantFollowUpPolicy } from '../services/tenant-follow-up-service.js';
import { readFileSync } from 'node:fs';

const persona = {
  available: true,
  companyIdentity: 'Meridian Arc Technologies LLC',
  assistantIdentity: 'Meridian Client Advisor',
  profile: { services: ['Enterprise support'] },
  configuration: {
    tone: 'Calm and precise',
    follow_up_behavior: { enabled: true, timing_strategy: ['3h', '24h'], cta_behavior: 'Offer the next documented step.', suppression_rules: ['Do not message during human takeover.'] },
    scheduled_messaging_behavior: { enabled: true, allowed_topics: ['support continuity'] },
  },
};

test('tenant follow-up policy is read only from ACTIVE configuration data', () => {
  const policy = resolveTenantFollowUpPolicy({ persona, stage: '3h' });
  assert.equal(policy.enabled, true);
  assert.equal(policy.kind, 'follow_up');
  assert.match(JSON.stringify(policy), /Offer the next documented step/);
});

test('disabled or unconfigured follow-up fails closed without a platform business fallback', () => {
  assert.deepEqual(resolveTenantFollowUpPolicy({ persona: { ...persona, configuration: {} }, stage: '3h' }), { enabled: false, code: 'FOLLOW_UP_NOT_CONFIGURED' });
});

test('generated follow-up request is tenant-scoped and contains no SamChe or Dubai defaults', () => {
  const request = buildTenantFollowUpRequest({ persona, stage: '3h', language: 'en', conversationContext: 'Customer asked about enterprise support.' });
  assert.match(request, /Meridian Arc Technologies LLC/);
  assert.match(request, /Enterprise support/);
  assert.doesNotMatch(request, /SamChe|Dubai|company formation/i);
});

test('human takeover suppresses tenant follow-up generation', () => {
  assert.deepEqual(buildTenantFollowUpRequest({ persona, stage: '3h', humanHandling: true }), { available: false, code: 'HUMAN_HANDLING' });
});

test('cron orchestrates tenant-aware generation and does not select legacy SamChe wording', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const cron = app.slice(app.indexOf('cron.schedule("* * * * *"'), app.indexOf('// ============================================================================\n// 7. SUNUCU'));
  assert.match(cron, /generateTenantFollowUpMessage/);
  assert.doesNotMatch(cron, /getPingMessage\(|getFollowUpMessage\(/);
});
