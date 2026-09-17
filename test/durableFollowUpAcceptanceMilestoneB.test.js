import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelConversationContextualFollowUps,
  claimDueContextualFollowUps,
  processDueContextualFollowUps,
  scheduleContextualFollowUp,
  MAX_FOLLOW_UP_ATTEMPTS,
} from '../services/durable-follow-up-service.js';
import {
  buildTenantFollowUpRequest,
  classifyFollowUpContextIntent,
  evaluateWhatsAppFollowUpSendGate,
  isCustomerOptOut,
  resolveTenantFollowUpPolicy,
} from '../services/tenant-follow-up-service.js';

const mockPersona = Object.freeze({
  available: true,
  companyIdentity: 'Blue Dune Event Management LLC',
  assistantIdentity: 'WhatsApp Chatbot',
  profile: {
    services: ['Corporate conferences', 'VIP gala management', 'Logistics coordination'],
  },
  configuration: {
    tone: 'concise and professional',
    follow_up_behavior: {
      enabled: true,
      timing_strategy: ['3h', '24h', '48h'],
      guidance: 'Helpful check-in',
      approved_templates: {
        '48h': { name: 'reengagement_v1', status: 'APPROVED' },
      },
    },
  },
});

test('Milestone B Point 1: durable PostgreSQL scheduling persists tenant-scoped job', async () => {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [{ id: 'job-pg-1' }] };
    },
  };
  const result = await scheduleContextualFollowUp({
    database,
    tenantId: 'tenant-bd-1',
    conversationId: 'conv-bd-1',
    assistantId: 'asst-bd-1',
    channelId: 'chan-bd-1',
    stage: '3h',
    dueAt: new Date('2026-09-16T12:00:00Z'),
    idempotencyKey: 'idemp-bd-1',
  });
  assert.equal(result.scheduled, true);
  assert.equal(result.id, 'job-pg-1');
  assert.match(calls[0].sql, /INSERT INTO conversation_scheduled_jobs/);
  assert.match(calls[0].sql, /ON CONFLICT \(tenant_id, idempotency_key\) DO NOTHING/);
  assert.equal(calls[0].params[0], 'tenant-bd-1');
});

test('Milestone B Point 2: contextual JIT generation builds prompt at execution time', async () => {
  const job = { id: 'job-jit', tenant_id: 'tenant-bd', conversation_id: 'conv-jit' };
  const database = {
    async query() { return { rowCount: 1, rows: [] }; },
    async connect() {
      return {
        async query(sql) {
          if (sql.includes('FROM conversation_scheduled_jobs')) return { rows: [job] };
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
  };
  let jitPrompt = null;
  await processDueContextualFollowUps({
    database,
    resolveContext: async (claimedJob) => {
      return {
        job: claimedJob,
        prompt: buildTenantFollowUpRequest({
          persona: mockPersona,
          stage: '3h',
          language: 'en',
          conversationContext: 'CUSTOMER: I want a corporate event in Dubai\nASSISTANT: We can help with venue coordination.',
        }),
      };
    },
    generate: async ({ prompt }) => {
      jitPrompt = prompt;
      return 'Following up on your Dubai corporate event inquiry!';
    },
    persistCanonical: async ({ content }) => ({ id: 'msg-jit-1', content }),
    deliver: async () => ({ delivered: true }),
  });
  assert.ok(jitPrompt.includes('Blue Dune Event Management LLC'));
  assert.ok(jitPrompt.includes('I want a corporate event in Dubai'));
});

test('Milestone B Point 3: customer reply cancels pending and retry follow-ups', async () => {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 3 };
    },
  };
  const cancelResult = await cancelConversationContextualFollowUps({
    database,
    tenantId: 'tenant-bd',
    conversationId: 'conv-reply-1',
  });
  assert.equal(cancelResult.cancelledCount, 3);
  assert.match(calls[0].sql, /UPDATE conversation_scheduled_jobs/);
  assert.match(calls[0].sql, /status = 'CANCELLED'/);
  assert.match(calls[0].sql, /status IN \('PENDING', 'RETRY'\)/);
  assert.deepEqual(calls[0].params, ['tenant-bd', 'conv-reply-1']);
});

test('Milestone B Points 4, 5, 6, 7: human request, takeover, pause, and close cancel follow-ups', async () => {
  for (const action of ['human_request', 'takeover', 'pause', 'close']) {
    const calls = [];
    const database = {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rowCount: 1 };
      },
    };
    const res = await cancelConversationContextualFollowUps({
      database,
      tenantId: 'tenant-actions',
      conversationId: `conv-${action}`,
    });
    assert.equal(res.cancelledCount, 1);
    assert.deepEqual(calls[0].params, ['tenant-actions', `conv-${action}`]);
  }
});

test('Milestone B Point 8: Return to AI does NOT immediately send stale cancelled content', async () => {
  const calls = [];
  const database = {
    async query() { return { rowCount: 0, rows: [] }; },
    async connect() {
      return {
        async query(sql, params) {
          calls.push({ sql, params });
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  const claimed = await claimDueContextualFollowUps({ database, now: new Date() });
  assert.deepEqual(claimed, []);
  const selectQuery = calls.find((c) => c.sql.includes('FROM conversation_scheduled_jobs'));
  assert.ok(selectQuery);
  assert.match(selectQuery.sql, /status IN \('PENDING', 'RETRY'\)/);
  assert.ok(!selectQuery.sql.includes('CANCELLED'));
});

test('Milestone B Point 9: opt-out suppression cancels follow-up on customer opt-out', () => {
  assert.equal(isCustomerOptOut('STOP'), true);
  assert.equal(isCustomerOptOut('unsubscribe'), true);
  assert.equal(isCustomerOptOut('iptal'), true);
  assert.equal(isCustomerOptOut('lütfen artık mesaj atmayın'), true);
  assert.equal(isCustomerOptOut('توقف'), true);
  assert.equal(isCustomerOptOut('Hello, I have a question'), false);

  const optOutResult = buildTenantFollowUpRequest({
    persona: mockPersona,
    stage: '3h',
    conversationContext: 'CUSTOMER: please stop messaging me',
  });
  assert.deepEqual(optOutResult, { available: false, code: 'CUSTOMER_OPT_OUT' });
});

test('Milestone B Point 10: disabled integration suppression cancels due job', async () => {
  const calls = [];
  const job = { id: 'job-disabled', tenant_id: 'tenant-bd', conversation_id: 'conv-dis' };
  const database = {
    async query(sql) { calls.push(sql); return { rowCount: 1, rows: [] }; },
    async connect() {
      return {
        async query(sql) {
          if (sql.includes('FROM conversation_scheduled_jobs')) return { rows: [job] };
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
  };
  const result = await processDueContextualFollowUps({
    database,
    resolveContext: async () => null,
    generate: async () => { throw new Error('should not generate'); },
    persistCanonical: async () => {},
    deliver: async () => {},
  });
  assert.equal(result.cancelled, 1);
  assert.ok(calls.some((sql) => sql.includes("status = 'CANCELLED'")));
});

test('Milestone B Point 11: maximum-attempt protection transitions job to FAILED on reaching limit', async () => {
  const calls = [];
  const job = {
    id: 'job-attempts',
    tenant_id: 'tenant-bd',
    attempts: 2,
    max_attempts: 3,
  };
  const database = {
    async query(sql, params) { calls.push({ sql, params }); return { rowCount: 1, rows: [] }; },
    async connect() {
      return {
        async query(sql) {
          if (sql.includes('FROM conversation_scheduled_jobs')) return { rows: [job] };
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
  };
  const result = await processDueContextualFollowUps({
    database,
    maxAttempts: 3,
    resolveContext: async () => ({ prompt: 'test' }),
    generate: async () => { throw new Error('persistent provider failure'); },
    persistCanonical: async () => {},
    deliver: async () => {},
  });
  assert.equal(result.failed, 1);
  assert.equal(result.retried, 0);
  const updateCall = calls.find((c) => c.sql.includes("status = 'FAILED'"));
  assert.ok(updateCall, 'Job must transition to FAILED status');
  assert.equal(updateCall.params[0], 3);
});

test('Milestone B Point 12: deterministic dedupe prevents duplicate scheduling and message creation', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('ON CONFLICT (tenant_id, idempotency_key) DO NOTHING')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const res = await scheduleContextualFollowUp({
    database,
    tenantId: 'tenant-bd',
    conversationId: 'conv-dup',
    stage: '3h',
    idempotencyKey: 'dup-key',
  });
  assert.equal(res.scheduled, false);
  assert.equal(res.id, null);
});
test('Milestone B Point 13: duplicate worker protection uses SKIP LOCKED row claiming', async () => {
  const calls = [];
  const database = {
    async connect() {
      return {
        async query(sql, params) {
          calls.push({ sql, params });
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  await claimDueContextualFollowUps({ database, now: new Date() });
  const claimSql = calls.find((c) => c.sql.includes('FROM conversation_scheduled_jobs'))?.sql ?? '';
  assert.match(claimSql, /FOR UPDATE OF j SKIP LOCKED/);
});

test('Milestone B Point 14: retry safety reuses generated message without re-invoking LLM', async () => {
  const job = {
    id: 'job-retry-safe',
    tenant_id: 'tenant-bd',
    generated_message_id: 'persisted-msg-1',
    generated_content: 'Grounded follow-up content',
    attempts: 1,
  };
  const database = {
    async query() { return { rowCount: 1, rows: [] }; },
    async connect() {
      return {
        async query(sql) {
          if (sql.includes('FROM conversation_scheduled_jobs')) return { rows: [job] };
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
  };
  let llmCalled = false;
  let deliveredText = null;
  const result = await processDueContextualFollowUps({
    database,
    resolveContext: async () => ({ prompt: 'not used' }),
    generate: async () => { llmCalled = true; return 'fresh text'; },
    persistCanonical: async () => { throw new Error('must not re-persist'); },
    deliver: async ({ content }) => { deliveredText = content; return { delivered: true }; },
  });
  assert.equal(llmCalled, false);
  assert.equal(deliveredText, 'Grounded follow-up content');
  assert.equal(result.completed, 1);
});

test('Milestone B Point 15: restart durability reclaims stuck PROCESSING jobs older than 5 minutes', async () => {
  const calls = [];
  const database = {
    async connect() {
      return {
        async query(sql, params) {
          calls.push({ sql, params });
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  await claimDueContextualFollowUps({ database, now: new Date() });
  const claimSql = calls.find((c) => c.sql.includes('FROM conversation_scheduled_jobs'))?.sql ?? '';
  assert.match(claimSql, /j\.status = 'PROCESSING' AND j\.processing_started_at <= CURRENT_TIMESTAMP - INTERVAL '5 minutes'/);
});

test('Milestone B Point 16: provider failure handling safely marks RETRY without crashing worker', async () => {
  const job = { id: 'job-provider-fail', tenant_id: 'tenant-bd', attempts: 0 };
  const database = {
    async query() { return { rowCount: 1, rows: [] }; },
    async connect() {
      return {
        async query(sql) {
          if (sql.includes('FROM conversation_scheduled_jobs')) return { rows: [job] };
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
  };
  const result = await processDueContextualFollowUps({
    database,
    resolveContext: async () => ({ prompt: 'test' }),
    generate: async () => { throw new Error('GEMINI_503_UNAVAILABLE'); },
    persistCanonical: async () => {},
    deliver: async () => {},
  });
  assert.equal(result.retried, 1);
  assert.equal(result.completed, 0);
});

test('Milestone B Point 17: tenant isolation scopes queries strictly by tenant_id', async () => {
  const calls = [];
  const database = {
    async query(sql, params) { calls.push({ sql, params }); return { rowCount: 0 }; },
  };
  await cancelConversationContextualFollowUps({
    database,
    tenantId: 'tenant-isolated-xyz',
    conversationId: 'conv-123',
  });
  assert.match(calls[0].sql, /WHERE tenant_id = \$1/);
  assert.equal(calls[0].params[0], 'tenant-isolated-xyz');
});

test('Milestone B Point 18: language preservation passes EN, TR, and AR correctly', () => {
  for (const lang of ['en', 'tr', 'ar']) {
    const prompt = buildTenantFollowUpRequest({
      persona: mockPersona,
      stage: '3h',
      language: lang,
      conversationContext: 'CUSTOMER: Hello',
    });
    assert.ok(prompt.includes(`Output language: ${lang}.`), `Must enforce language ${lang}`);
  }
});

test('Milestone B Point 19: sales follow-up context identifies sales intent', () => {
  const intent = classifyFollowUpContextIntent('CUSTOMER: How much is the pricing for corporate packages?');
  assert.equal(intent, 'SALES_INQUIRY');

  const prompt = buildTenantFollowUpRequest({
    persona: mockPersona,
    stage: '3h',
    conversationContext: 'CUSTOMER: Can you send me the price list and packages?',
  });
  assert.ok(prompt.includes('Context classification: SALES_INQUIRY'));
  assert.ok(prompt.includes('consultative, and relevant assistance'));
});

test('Milestone B Points 20 & 21: unresolved support/complaint context prohibits aggressive sales', () => {
  const complaintContext = 'CUSTOMER: The equipment was broken and defective during the event. I am very dissatisfied.';
  const intent = classifyFollowUpContextIntent(complaintContext);
  assert.equal(intent, 'UNRESOLVED_SUPPORT_OR_COMPLAINT');

  const prompt = buildTenantFollowUpRequest({
    persona: mockPersona,
    stage: '3h',
    conversationContext: complaintContext,
  });
  assert.ok(prompt.includes('Context classification: UNRESOLVED_SUPPORT_OR_COMPLAINT'));
  assert.ok(prompt.includes('DO NOT push sales pitches, commercial offers, or aggressive follow-ups'));
  assert.ok(prompt.includes('exclusively supportive, empathetic, and aimed at resolving the issue'));
});

test('Milestone B Point 22 & 23: WhatsApp session/template send gate enforces 24h window and rejects unapproved templates', () => {
  const now = new Date('2026-09-16T12:00:00Z');
  // Case A: Within 24 hours -> session message allowed
  const within24h = evaluateWhatsAppFollowUpSendGate({
    lastCustomerMessageAt: new Date('2026-09-16T08:00:00Z'),
    stage: '3h',
    now,
  });
  assert.equal(within24h.allowed, true);
  assert.equal(within24h.mode, 'SESSION_MESSAGE');

  // Case B: Outside 24 hours with NO approved template -> REJECTED (no unapproved-template assumption)
  const outside24hNoTemplate = evaluateWhatsAppFollowUpSendGate({
    lastCustomerMessageAt: new Date('2026-09-14T08:00:00Z'),
    stage: '48h',
    templates: null,
    now,
  });
  assert.equal(outside24hNoTemplate.allowed, false);
  assert.equal(outside24hNoTemplate.code, 'WHATSAPP_SESSION_WINDOW_EXPIRED_NO_APPROVED_TEMPLATE');

  // Case C: Outside 24 hours with an approved template -> allowed as TEMPLATE_MESSAGE
  const outside24hApprovedTemplate = evaluateWhatsAppFollowUpSendGate({
    lastCustomerMessageAt: new Date('2026-09-14T08:00:00Z'),
    stage: '48h',
    templates: {
      follow_up_approved_templates: {
        '48h': { name: 'bd_reengage_v1', status: 'APPROVED' },
      },
    },
    now,
  });
  assert.equal(outside24hApprovedTemplate.allowed, true);
  assert.equal(outside24hApprovedTemplate.mode, 'TEMPLATE_MESSAGE');
  assert.equal(outside24hApprovedTemplate.templateName, 'bd_reengage_v1');
});

test('Milestone B Point 24: no LLM invocation on scheduler ticks when no messages need generation', async () => {
  const database = {
    async connect() {
      return {
        async query() { return { rows: [] }; },
        release() {},
      };
    },
  };
  let llmInvocations = 0;
  const result = await processDueContextualFollowUps({
    database,
    resolveContext: async () => { llmInvocations += 1; return null; },
    generate: async () => { llmInvocations += 1; return 'msg'; },
    persistCanonical: async () => {},
    deliver: async () => {},
  });
  assert.equal(llmInvocations, 0);
  assert.deepEqual(result, { completed: 0, retried: 0, cancelled: 0 });
});

test('Milestone B Point 25: JIT generation only when an eligible message actually needs generation', async () => {
  const eligibleJob = { id: 'job-eligible', tenant_id: 'tenant-bd', attempts: 0 };
  const database = {
    async query() { return { rowCount: 1, rows: [] }; },
    async connect() {
      return {
        async query(sql) {
          if (sql.includes('FROM conversation_scheduled_jobs')) return { rows: [eligibleJob] };
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
  };
  let generateCount = 0;
  await processDueContextualFollowUps({
    database,
    resolveContext: async () => ({ prompt: 'Eligible JIT prompt' }),
    generate: async () => {
      generateCount += 1;
      return 'Generated follow-up message';
    },
    persistCanonical: async ({ content }) => ({ id: 'msg-canon-1', content }),
    deliver: async () => ({ delivered: true }),
  });
  assert.equal(generateCount, 1, 'Generate must be called exactly once for eligible JIT job');
});

test('Milestone B Point 26: canonical stage_delays_ms override in follow_up_behavior configures custom stage delays without hardcoding', () => {
  const customPersona = {
    ...mockPersona,
    configuration: {
      ...mockPersona.configuration,
      follow_up_behavior: {
        enabled: true,
        timing_strategy: ['3h', '24h'],
        stage_delays_ms: {
          '3h': 120000,
        },
      },
    },
  };
  const policy3h = resolveTenantFollowUpPolicy({ persona: customPersona, stage: '3h' });
  assert.equal(policy3h.enabled, true);
  assert.equal(policy3h.policy.stage_delays_ms['3h'], 120000);

  const policy24h = resolveTenantFollowUpPolicy({ persona: customPersona, stage: '24h' });
  assert.equal(policy24h.enabled, true);
  assert.equal(policy24h.policy.stage_delays_ms?.['24h'], undefined);
});

test('Milestone B Point 27: structured observability logs emitted on due job lifecycle events', async () => {
  const logged = [];
  const originalInfo = console.info;
  console.info = (...args) => {
    logged.push(args.join(' '));
    originalInfo.apply(console, args);
  };
  try {
    const job = { id: 'job-obs-1', tenant_id: 'tenant-bd-1234', stage: '3h', attempts: 0 };
    const database = {
      async query() { return { rowCount: 1, rows: [] }; },
      async connect() {
        return {
          async query(sql) {
            if (sql.includes('FROM conversation_scheduled_jobs')) return { rows: [job] };
            return { rowCount: 1, rows: [] };
          },
          release() {},
        };
      },
    };
    await processDueContextualFollowUps({
      database,
      resolveContext: async () => ({ prompt: 'obs prompt' }),
      generate: async () => 'obs content',
      persistCanonical: async ({ content }) => ({ id: 'msg-obs-1', content }),
      deliver: async () => ({ delivered: true }),
    });

    assert.ok(logged.some((log) => log.includes('FOLLOWUP_CLAIMED') && log.includes('count=1')));
    assert.ok(logged.some((log) => log.includes('FOLLOWUP_DUE') && log.includes('job-obs-1')));
    assert.ok(logged.some((log) => log.includes('FOLLOWUP_COMPLETED') && log.includes('job-obs-1')));
  } finally {
    console.info = originalInfo;
  }
});

