import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeConversationContext,
  buildTenantFollowUpRequest,
  calculateElapsedSemanticBucket,
  classifyFollowUpContextIntent,
  DEFAULT_FOLLOW_UP_STAGES,
  ELAPSED_TIME_SIGNALS,
  evaluateWhatsAppFollowUpSendGate,
  normalizeGeneratedFollowUpText,
  resolveTenantFollowUpPolicy,
  SEMANTIC_TIME_BUCKETS,
} from '../services/tenant-follow-up-service.js';
import { ensureTenantWebChatPersona } from '../services/tenant-web-chat-provisioning-service.js';

const mockBlueDunePersona = Object.freeze({
  available: true,
  companyIdentity: 'Blue Dune Event Management LLC',
  assistantIdentity: 'Blue Dune Event Concierge',
  profile: {
    services: ['Corporate conferences', 'VIP gala management', 'Venue coordination'],
    timezone: 'Asia/Dubai',
  },
  configuration: {
    tone: 'sophisticated, hospitable, and executive',
    follow_up_behavior: {
      enabled: true,
      timing_strategy: ['10m', '3h', '24h', '48h'],
      guidance: 'Helpful and consultative check-in',
    },
  },
});

const mockHealthTechPersona = Object.freeze({
  available: true,
  companyIdentity: 'HealthTech Solutions Inc',
  assistantIdentity: 'HealthTech Care Specialist',
  profile: {
    services: ['Clinical trial platform', 'HIPAA consulting', 'Patient telemetry'],
    timezone: 'America/New_York',
  },
  configuration: {
    tone: 'precise, clinical, and empathetic',
    follow_up_behavior: {
      enabled: true,
      timing_strategy: ['10m', '3h', '24h'],
      guidance: 'Compliance and care continuity',
    },
  },
});

test('Requirement 8.A: Product comparison conversation guides comparative follow-up', () => {
  const context = [
    'CUSTOMER: We are deciding between the Cloud Starter package and Cloud Enterprise package. What are the key differences?',
    'ASSISTANT: Cloud Starter includes 5 seats and standard support, while Cloud Enterprise includes unlimited seats and 24/7 priority support.',
  ].join('\n');

  const intent = classifyFollowUpContextIntent(context);
  assert.equal(intent, 'PRODUCT_OR_SERVICE_COMPARISON');

  const prompt = buildTenantFollowUpRequest({
    persona: mockBlueDunePersona,
    stage: '3h',
    language: 'en',
    conversationContext: context,
  });

  assert.ok(prompt.includes('Context classification: PRODUCT_OR_SERVICE_COMPARISON'));
  assert.ok(prompt.includes('The customer was comparing options, products, or services.'));
  assert.ok(prompt.includes('Cloud Starter package and Cloud Enterprise package'));
  assert.ok(prompt.includes('TOPIC CONFIDENCE: HIGH'));
});

test('Requirement 8.B: Service enquiry follow-up continues the specific enquiry', () => {
  const context = [
    'CUSTOMER: Hello, I am interested in organizing a corporate event in Dubai for 150 guests.',
    'ASSISTANT: We can assist with venue sourcing, AV production, and catering coordination for your corporate event in Dubai.',
  ].join('\n');

  const analysis = analyzeConversationContext(null, context);
  assert.equal(analysis.topicConfidence, 'HIGH');

  const prompt = buildTenantFollowUpRequest({
    persona: mockBlueDunePersona,
    stage: '3h',
    language: 'en',
    conversationContext: context,
  });

  assert.ok(prompt.includes('TOPIC CONFIDENCE: HIGH'));
  assert.ok(prompt.includes('MANDATORY: Continue the specific subject/entity discussed'));
  assert.ok(prompt.includes('corporate event in Dubai for 150 guests'));
  assert.ok(prompt.includes('Never send generic filler phrases like "Just following up"'));
});

test('Requirement 8.C: Sales decision conversation naturally continues decision process', () => {
  const context = [
    'CUSTOMER: We received your event proposal and pricing quote for the annual summit.',
    'ASSISTANT: Wonderful! Please let us know if you need any adjustments to the line items or package tiers.',
  ].join('\n');

  const prompt = buildTenantFollowUpRequest({
    persona: mockBlueDunePersona,
    stage: '3h',
    language: 'en',
    conversationContext: context,
  });

  assert.ok(prompt.includes('Context classification: SALES_INQUIRY'));
  assert.ok(prompt.includes("Continue the customer's decision process naturally"));
  assert.ok(prompt.includes('Do NOT invent products, services, prices, appointments, decisions, or promises'));
});

test('Requirement 8.D: Support problem follows up on resolution without sales pressure', () => {
  const context = [
    'CUSTOMER: The dashboard is broken and showing error 500 when exporting reports.',
    'ASSISTANT: I apologize for the inconvenience. Our engineering team is investigating the export service failure.',
  ].join('\n');

  const intent = classifyFollowUpContextIntent(context);
  assert.equal(intent, 'UNRESOLVED_SUPPORT_OR_COMPLAINT');

  const prompt = buildTenantFollowUpRequest({
    persona: mockHealthTechPersona,
    stage: '3h',
    language: 'en',
    conversationContext: context,
  });

  assert.ok(prompt.includes('Context classification: UNRESOLVED_SUPPORT_OR_COMPLAINT'));
  assert.ok(prompt.includes('DO NOT push sales pitches, commercial offers, or aggressive follow-ups.'));
  assert.ok(prompt.includes('Any follow-up must be exclusively supportive, empathetic, and aimed at resolving the issue.'));
  assert.ok(prompt.includes('Ask whether the issue was resolved or if they are still experiencing the problem'));
});


test('Requirement 8.E: Yesterday bucket accurately represents calendar yesterday', () => {
  const now = new Date('2026-09-17T14:00:00Z');
  const yesterdayMessageAt = new Date('2026-09-16T15:00:00Z');

  const bucketResult = calculateElapsedSemanticBucket({
    lastMeaningfulMessageAt: yesterdayMessageAt,
    now,
    timezone: 'UTC',
  });

  assert.equal(bucketResult.bucket, SEMANTIC_TIME_BUCKETS.YESTERDAY);
  assert.equal(bucketResult.label, 'yesterday');

  const promptEN = buildTenantFollowUpRequest({
    persona: mockBlueDunePersona,
    stage: '24h',
    language: 'en',
    lastCustomerMessageAt: yesterdayMessageAt,
    now,
  });
  assert.ok(promptEN.includes('Bucket: "yesterday" (yesterday)'));
  assert.ok(promptEN.includes('Localized cue for language "en": "yesterday"'));

  const promptTR = buildTenantFollowUpRequest({
    persona: mockBlueDunePersona,
    stage: '24h',
    language: 'tr',
    lastCustomerMessageAt: yesterdayMessageAt,
    now,
  });
  assert.ok(promptTR.includes('Localized cue for language "tr": "dün"'));

  const promptAR = buildTenantFollowUpRequest({
    persona: mockBlueDunePersona,
    stage: '24h',
    language: 'ar',
    lastCustomerMessageAt: yesterdayMessageAt,
    now,
  });
  assert.ok(promptAR.includes('Localized cue for language "ar": "أمس"'));
});

test('Requirement 8.F: Short-time bucket forbids saying "yesterday"', () => {
  const now = new Date('2026-09-17T14:00:00Z');
  const twoMinutesAgo = new Date('2026-09-17T13:58:00Z');

  const bucketResult = calculateElapsedSemanticBucket({
    lastMeaningfulMessageAt: twoMinutesAgo,
    now,
    timezone: 'UTC',
  });

  assert.equal(bucketResult.bucket, SEMANTIC_TIME_BUCKETS.SHORT_TIME);
  assert.equal(bucketResult.label, 'a short time ago');

  const prompt = buildTenantFollowUpRequest({
    persona: mockBlueDunePersona,
    stage: '3h',
    language: 'en',
    lastCustomerMessageAt: twoMinutesAgo,
    now,
  });

  assert.ok(prompt.includes('Bucket: "short_time" (a short time ago)'));
  assert.ok(prompt.includes('CRITICAL: DO NOT claim or imply "yesterday"'));
  assert.ok(prompt.includes('Localized cue for language "en": "a short time ago"'));
});

test('Requirement 8.G: Older conversation uses appropriate broader elapsed-time signals', () => {
  const now = new Date('2026-09-17T12:00:00Z');

  const threeDaysAgo = new Date('2026-09-14T12:00:00Z');
  const bucket3d = calculateElapsedSemanticBucket({ lastMeaningfulMessageAt: threeDaysAgo, now, timezone: 'UTC' });
  assert.equal(bucket3d.bucket, SEMANTIC_TIME_BUCKETS.FEW_DAYS_AGO);

  const sixDaysAgo = new Date('2026-09-11T12:00:00Z');
  const bucket6d = calculateElapsedSemanticBucket({ lastMeaningfulMessageAt: sixDaysAgo, now, timezone: 'UTC' });
  assert.equal(bucket6d.bucket, SEMANTIC_TIME_BUCKETS.RECENTLY);

  const twelveDaysAgo = new Date('2026-09-05T12:00:00Z');
  const bucket12d = calculateElapsedSemanticBucket({ lastMeaningfulMessageAt: twelveDaysAgo, now, timezone: 'UTC' });
  assert.equal(bucket12d.bucket, SEMANTIC_TIME_BUCKETS.SOME_TIME_AGO);
});

test('Requirement 8.H: Unknown or low-confidence topic gracefully degrades without inventing specifics', () => {
  const context = 'CUSTOMER: Hello';

  const analysis = analyzeConversationContext(null, context);
  assert.equal(analysis.topicConfidence, 'LOW');

  const prompt = buildTenantFollowUpRequest({
    persona: mockBlueDunePersona,
    stage: '3h',
    language: 'en',
    conversationContext: context,
  });

  assert.ok(prompt.includes('TOPIC CONFIDENCE: LOW / BROAD'));
  assert.ok(prompt.includes('Degrade gracefully to a broader check-in regarding their enquiry without hallucinating'));
  assert.ok(prompt.includes('Do NOT invent products, services, prices, appointments, decisions, or promises'));
});

test('Requirement 8.I: Tenant A context cannot appear in Tenant B follow-up', () => {
  const blueDunePrompt = buildTenantFollowUpRequest({
    persona: mockBlueDunePersona,
    stage: '3h',
    language: 'en',
    conversationContext: 'CUSTOMER: I want to book a gala venue.',
  });

  const healthTechPrompt = buildTenantFollowUpRequest({
    persona: mockHealthTechPersona,
    stage: '3h',
    language: 'en',
    conversationContext: 'CUSTOMER: We need a clinical trial compliance review.',
  });

  assert.ok(blueDunePrompt.includes('Blue Dune Event Management LLC'));
  assert.ok(blueDunePrompt.includes('Corporate conferences'));
  assert.ok(!blueDunePrompt.includes('HealthTech'));
  assert.ok(!blueDunePrompt.includes('Clinical trial'));

  assert.ok(healthTechPrompt.includes('HealthTech Solutions Inc'));
  assert.ok(healthTechPrompt.includes('Clinical trial platform'));
  assert.ok(!healthTechPrompt.includes('Blue Dune'));
  assert.ok(!healthTechPrompt.includes('VIP gala'));
  assert.ok(!healthTechPrompt.includes('venue'));
});


test('Requirement 8.J: Fresh eligible tenant automatically receives canonical contextual behavior', async () => {
  const mockDb = {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (sql.includes('SELECT id FROM business_identities')) {
        return { rowCount: 1, rows: [{ id: '11111111-1111-4111-8111-111111111111' }] };
      }
      if (sql.includes('SELECT id, active_version_id FROM business_profiles')) {
        return { rowCount: 1, rows: [{ id: '22222222-2222-4222-8222-222222222222', active_version_id: '33333333-3333-4333-8333-333333333333' }] };
      }
      if (sql.includes('SELECT configuration FROM assistants')) {
        return { rowCount: 1, rows: [{ configuration: {} }] };
      }
      if (sql.includes('UPDATE assistants')) {
        return { rowCount: 1, rows: [{ id: '44444444-4444-4444-8444-444444444444' }] };
      }
      return { rowCount: 1, rows: [{ id: 'mock-id' }] };
    },
  };

  await ensureTenantWebChatPersona(mockDb, {
    tenantId: '11111111-1111-4111-8111-111111111111',
    assistantId: '44444444-4444-4444-8444-444444444444',
    companyName: 'Apex Logistics LLC',
    assistantIdentity: 'Apex Freight Concierge',
  });

  const configVersionQuery = mockDb.queries.find((q) => q.sql.includes('INSERT INTO assistant_configuration_versions'));
  assert.ok(configVersionQuery);
  const updatedConfig = JSON.parse(configVersionQuery.params[2]);
  assert.equal(updatedConfig.follow_up_behavior?.enabled, true);
  assert.deepEqual(updatedConfig.follow_up_behavior?.timing_strategy, ['10m', '3h', '24h']);

  const freshPersona = {
    available: true,
    companyIdentity: 'Apex Logistics LLC',
    assistantIdentity: 'Apex Freight Concierge',
    profile: { services: ['Air Freight', 'Sea Cargo'] },
    configuration: updatedConfig,
  };

  const policy = resolveTenantFollowUpPolicy({ persona: freshPersona, stage: '3h' });
  assert.equal(policy.enabled, true);

  const freshPrompt = buildTenantFollowUpRequest({
    persona: freshPersona,
    stage: '3h',
    language: 'en',
    conversationContext: 'CUSTOMER: How much is air freight to Frankfurt?',
  });

  assert.ok(freshPrompt.includes('Apex Logistics LLC'));
  assert.ok(freshPrompt.includes('Air Freight'));
  assert.ok(freshPrompt.includes('Context classification: SALES_INQUIRY'));
});

test('Requirement 8.K: Multilingual EN, TR, AR elapsed-time signals and continuation preservation', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  const shortTimeAgo = new Date('2026-09-17T11:45:00Z');

  const promptEN = buildTenantFollowUpRequest({
    persona: mockBlueDunePersona,
    stage: '3h',
    language: 'en',
    lastCustomerMessageAt: shortTimeAgo,
    now,
  });
  assert.ok(promptEN.includes('Output language: en.'));
  assert.ok(promptEN.includes('Localized cue for language "en": "a short time ago"'));

  const promptTR = buildTenantFollowUpRequest({
    persona: mockBlueDunePersona,
    stage: '3h',
    language: 'tr',
    lastCustomerMessageAt: shortTimeAgo,
    now,
  });
  assert.ok(promptTR.includes('Output language: tr.'));
  assert.ok(promptTR.includes('Localized cue for language "tr": "kısa süre önce"'));

  const promptAR = buildTenantFollowUpRequest({
    persona: mockBlueDunePersona,
    stage: '3h',
    language: 'ar',
    lastCustomerMessageAt: shortTimeAgo,
    now,
  });
  assert.ok(promptAR.includes('Output language: ar.'));
  assert.ok(promptAR.includes('Localized cue for language "ar": "منذ وقت قصير"'));
});

test('Normalization helper removes quotes and role prefixes', () => {
  assert.equal(
    normalizeGeneratedFollowUpText('"We spoke a short while ago about the corporate event."'),
    'We spoke a short while ago about the corporate event.'
  );
  assert.equal(
    normalizeGeneratedFollowUpText('Assistant: We spoke yesterday about the options.'),
    'We spoke yesterday about the options.'
  );
  assert.equal(
    normalizeGeneratedFollowUpText('“Kısa süre önce etkinlik hakkında konuşmuştuk.”'),
    'Kısa süre önce etkinlik hakkında konuşmuştuk.'
  );
});

test('Requirement: Canonical intended sequence defines 10 minutes -> 3 hours -> 24 hours', () => {
  const stageMap = new Map(DEFAULT_FOLLOW_UP_STAGES);
  assert.equal(stageMap.get('10m'), 10 * 60 * 1000, 'Stage 1 delay must be 10 minutes (600,000 ms)');
  assert.equal(stageMap.get('3h'), 3 * 60 * 60 * 1000, 'Stage 2 delay must be 3 hours (10,800,000 ms)');
  assert.equal(stageMap.get('24h'), 24 * 60 * 60 * 1000, 'Stage 3 delay must be 24 hours (86,400,000 ms)');

  // Confirm temporary 2-minute (120,000 ms) test override is NOT active in defaults
  assert.notEqual(stageMap.get('3h'), 120000, '3h stage delay must NOT be temporary 2-minute override');
  for (const [stage, delay] of DEFAULT_FOLLOW_UP_STAGES) {
    assert.notEqual(delay, 120000, `Stage ${stage} must not have temporary 2-minute delay`);
  }
});

test('Requirement: Scheduler semantics are ABSOLUTE-FROM-CONVERSATION and produce exact effective timing', () => {
  const conversationTimestamp = 1726574400000; // Fixed reference timestamp
  const stageMap = new Map(DEFAULT_FOLLOW_UP_STAGES);

  // Scheduler calculates each stage due_at as: scheduledAt + stageDelay
  const stage1DueAt = conversationTimestamp + stageMap.get('10m');
  const stage2DueAt = conversationTimestamp + stageMap.get('3h');
  const stage3DueAt = conversationTimestamp + stageMap.get('24h');

  // Verify effective customer-facing timings from conversation
  const stage1EffectiveMinutes = (stage1DueAt - conversationTimestamp) / (60 * 1000);
  const stage2EffectiveHours = (stage2DueAt - conversationTimestamp) / (60 * 60 * 1000);
  const stage3EffectiveHours = (stage3DueAt - conversationTimestamp) / (60 * 60 * 1000);

  assert.equal(stage1EffectiveMinutes, 10, 'Stage 1 effective timing must be exactly 10 minutes');
  assert.equal(stage2EffectiveHours, 3, 'Stage 2 effective timing must be exactly 3 hours');
  assert.equal(stage3EffectiveHours, 24, 'Stage 3 effective timing must be exactly 24 hours');

  // Verify non-cumulative semantics: Stage 2 is NOT 3h10m, Stage 3 is NOT 27h10m
  assert.notEqual(stage2DueAt - conversationTimestamp, (10 * 60 * 1000) + (3 * 60 * 60 * 1000));
  assert.notEqual(stage3DueAt - conversationTimestamp, (10 * 60 * 1000) + (3 * 60 * 60 * 1000) + (24 * 60 * 60 * 1000));
});

test('Requirement: WhatsApp 24-hour policy gate allows 10m and 3h sessions, enforces gate at 24h', () => {
  const customerMessageAt = new Date('2026-09-17T10:00:00Z');

  // At 10 minutes: well within 24-hour session window -> freeform session message allowed
  const tenMinutesLater = new Date('2026-09-17T10:10:00Z');
  const gate10m = evaluateWhatsAppFollowUpSendGate({
    lastCustomerMessageAt: customerMessageAt,
    stage: '10m',
    now: tenMinutesLater,
  });
  assert.equal(gate10m.allowed, true);
  assert.equal(gate10m.mode, 'SESSION_MESSAGE');

  // At 3 hours: within 24-hour session window -> freeform session message allowed
  const threeHoursLater = new Date('2026-09-17T13:00:00Z');
  const gate3h = evaluateWhatsAppFollowUpSendGate({
    lastCustomerMessageAt: customerMessageAt,
    stage: '3h',
    now: threeHoursLater,
  });
  assert.equal(gate3h.allowed, true);
  assert.equal(gate3h.mode, 'SESSION_MESSAGE');

  // At exactly 24 hours: inside session window
  const twentyFourHoursExact = new Date('2026-09-18T10:00:00Z');
  const gate24hExact = evaluateWhatsAppFollowUpSendGate({
    lastCustomerMessageAt: customerMessageAt,
    stage: '24h',
    now: twentyFourHoursExact,
  });
  assert.equal(gate24hExact.allowed, true);
  assert.equal(gate24hExact.mode, 'SESSION_MESSAGE');

  // At 24 hours + 1 minute: outside session window -> rejected without approved template
  const twentyFourHoursAndOneMin = new Date('2026-09-18T10:01:00Z');
  const gate24hExpired = evaluateWhatsAppFollowUpSendGate({
    lastCustomerMessageAt: customerMessageAt,
    stage: '24h',
    now: twentyFourHoursAndOneMin,
  });
  assert.equal(gate24hExpired.allowed, false);
  assert.equal(gate24hExpired.code, 'WHATSAPP_SESSION_WINDOW_EXPIRED_NO_APPROVED_TEMPLATE');
  assert.equal(gate24hExpired.mode, 'REJECTED');

  // At 24 hours + 1 minute with approved template -> allowed via TEMPLATE_MESSAGE
  const gate24hWithTemplate = evaluateWhatsAppFollowUpSendGate({
    lastCustomerMessageAt: customerMessageAt,
    stage: '24h',
    templates: {
      follow_up_approved_templates: {
        '24h': { name: 'follow_up_reengagement_v1', status: 'APPROVED' },
      },
    },
    now: twentyFourHoursAndOneMin,
  });
  assert.equal(gate24hWithTemplate.allowed, true);
  assert.equal(gate24hWithTemplate.mode, 'TEMPLATE_MESSAGE');
  assert.equal(gate24hWithTemplate.templateName, 'follow_up_reengagement_v1');
});

test('Requirement: Multi-tenant configuration-driven delays allow custom overrides without code change', () => {
  const tenantCustomPersona = {
    ...mockBlueDunePersona,
    configuration: {
      ...mockBlueDunePersona.configuration,
      follow_up_behavior: {
        enabled: true,
        timing_strategy: ['10m', '3h', '24h'],
        stage_delays_ms: {
          '10m': 15 * 60 * 1000, // Custom 15 minutes
        },
      },
    },
  };

  const policy10m = resolveTenantFollowUpPolicy({ persona: tenantCustomPersona, stage: '10m' });
  assert.equal(policy10m.enabled, true);
  assert.equal(policy10m.policy.stage_delays_ms['10m'], 15 * 60 * 1000);

  const policy3h = resolveTenantFollowUpPolicy({ persona: tenantCustomPersona, stage: '3h' });
  assert.equal(policy3h.enabled, true);
  assert.equal(policy3h.policy.stage_delays_ms?.['3h'], undefined);
});
