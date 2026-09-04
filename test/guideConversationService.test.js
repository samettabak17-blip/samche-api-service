import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GuideConversationError,
  canonicalGuideResponseEvents,
  issueGuideResumeSession,
  loadGuideResumeState,
  normalizeGuideConversationRequest,
  resolveGuideResumeSession,
  saveGuideResumeState,
} from '../services/guide-conversation-service.js';

const scope = { domain_id: 'domain-a', tenant_id: 'tenant-a', assistant_id: 'assistant-a', channel_id: 'channel-a' };

test('maps provider-neutral text into safe canonical progressive Guide events', () => {
  const events = canonicalGuideResponseEvents('## Event strategy\n\n- Confirm the objective\n- Review venue options', { nextActions: ['Refine requirements'] });
  assert.deepEqual(events.map((event) => event.type), ['MESSAGE_START', 'THINKING', 'SECTION', 'LIST', 'ACTION', 'MESSAGE_COMPLETE']);
  assert.equal(events[2].title, 'Event strategy');
  assert.deepEqual(events[3].items, ['Confirm the objective', 'Review venue options']);
  assert.doesNotMatch(JSON.stringify(events), /##|<script|\*\*/i);
});

test('rejects unsafe or provider-shaped Guide events and bounds roadmap conversation input', () => {
  assert.throws(() => canonicalGuideResponseEvents('<script>alert(1)</script>'), GuideConversationError);
  assert.throws(() => normalizeGuideConversationRequest({ module: 'ROADMAP', text: 'x'.repeat(2001) }), GuideConversationError);
  assert.throws(() => normalizeGuideConversationRequest({ module: 'VERTEX_STREAM', text: 'hello' }), GuideConversationError);
  assert.deepEqual(normalizeGuideConversationRequest({ module: 'ROADMAP', text: ' Plan a launch ' }), { module: 'ROADMAP', text: 'Plan a launch' });
});

test('issues opaque durable resume tokens and rejects a cross-tenant resolution', async () => {
  const rows = new Map();
  const database = { query: async (sql, values) => {
    if (sql.includes('INSERT INTO guide_public_sessions')) { rows.set(values[0], { token_hash: values[0], session_id: values[1], tenant_id: values[2], assistant_id: values[3], channel_id: values[4], domain_id: values[5], experience_version: values[6], preview_mode: values[7], expires_at: values[8] }); return { rowCount: 1, rows: [] }; }
    if (sql.includes('FROM guide_public_sessions')) {
      const row = rows.get(values[0]);
      const scopeMatches = row && row.tenant_id === values[1] && row.assistant_id === values[2] && row.channel_id === values[3] && row.domain_id === values[4] && row.experience_version === values[5] && row.preview_mode === values[6];
      return { rowCount: scopeMatches ? 1 : 0, rows: scopeMatches ? [row] : [] };
    }
    return { rowCount: 1, rows: [] };
  } };
  const issued = await issueGuideResumeSession({ database, scope, experienceVersion: 10, previewMode: true, now: 1000 });
  assert.match(issued.token, /^[A-Za-z0-9_-]{32,}$/);
  const resolved = await resolveGuideResumeSession({ database, token: issued.token, scope, experienceVersion: 10, previewMode: true, now: 1001 });
  assert.equal(resolved.sessionId, issued.sessionId);
  assert.equal(await resolveGuideResumeSession({ database, token: issued.token, scope: { ...scope, tenant_id: 'tenant-b' }, experienceVersion: 10, previewMode: true, now: 1001 }), null);
});

test('persists only server-scoped Guide state behind the opaque resume token', async () => {
  const stateByHash = new Map();
  const database = { query: async (sql, values) => {
    if (sql.includes('INSERT INTO guide_public_sessions')) { stateByHash.set(values[0], { token_hash: values[0], session_id: values[1], tenant_id: values[2], assistant_id: values[3], channel_id: values[4], domain_id: values[5], experience_version: values[6], preview_mode: values[7], expires_at: values[8], state: {} }); return { rowCount: 1, rows: [] }; }
    if (sql.includes('SELECT session_id')) { const row = stateByHash.get(values[0]); return { rowCount: row ? 1 : 0, rows: row ? [row] : [] }; }
    if (sql.includes('SET state=')) { stateByHash.get(values[0]).state = JSON.parse(values[1]); return { rowCount: 1, rows: [] }; }
    if (sql.includes('SELECT state')) { const row = stateByHash.get(values[0]); return { rowCount: row ? 1 : 0, rows: row ? [row] : [] }; }
    return { rowCount: 1, rows: [] };
  } };
  const issued = await issueGuideResumeSession({ database, scope, experienceVersion: 10, previewMode: false });
  await saveGuideResumeState({ database, token: issued.token, scope, experienceVersion: 10, previewMode: false, state: { context: { roadmap: { attendees: 20 } }, current_module: 'ROADMAP' } });
  assert.deepEqual(await loadGuideResumeState({ database, token: issued.token, scope, experienceVersion: 10, previewMode: false }), { context: { roadmap: { attendees: 20 } }, current_module: 'ROADMAP' });
});

test('Roadmap persistence and isolation verification covering all 10 mandatory properties', async () => {
  const stateByHash = new Map();
  const database = { query: async (sql, values) => {
    if (sql.includes('INSERT INTO guide_public_sessions')) {
      stateByHash.set(values[0], { token_hash: values[0], session_id: values[1], tenant_id: values[2], assistant_id: values[3], channel_id: values[4], domain_id: values[5], experience_version: values[6], preview_mode: values[7], expires_at: values[8], state: {} });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('SELECT session_id')) {
      const row = stateByHash.get(values[0]);
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }
    if (sql.includes('SET state=')) {
      stateByHash.get(values[0]).state = JSON.parse(values[1]);
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('SELECT state')) {
      const row = stateByHash.get(values[0]);
      const matches = row && row.tenant_id === values[1] && row.assistant_id === values[2] && row.channel_id === values[3] && row.domain_id === values[4] && row.experience_version === values[5] && row.preview_mode === values[6];
      return { rowCount: matches ? 1 : 0, rows: matches ? [row] : [] };
    }
    return { rowCount: 1, rows: [] };
  } };

  const sessionA = await issueGuideResumeSession({ database, scope, experienceVersion: 1, previewMode: false });
  const sessionB = await issueGuideResumeSession({ database, scope, experienceVersion: 1, previewMode: false });
  const tenantBScope = { ...scope, tenant_id: 'tenant-b-unique' };

  const roadmapInitialState = {
    active_module: 'ROADMAP',
    roadmapState: {
      category: 'ENTERPRISE_LAUNCH',
      initialGoal: 'Launch digital services in UAE',
      structuredInputs: { timeline: '3_months', budget: '50k' },
      generatedAnalysis: { strategy: 'Phase 1 MVP, Phase 2 Full roll-out' },
      messages: [
        { role: 'user', content: 'What is step 1?' },
        { role: 'assistant', content: 'Step 1 is company incorporation.' }
      ],
      metadata: { createdAt: 123456789 }
    },
    planningState: {
      budgetCalculated: 50000,
      checklistComplete: false
    },
    assistantConversation: {
      messages: [
        { role: 'user', content: 'Hello general assistant' },
        { role: 'assistant', content: 'How can I assist your team today?' }
      ]
    },
    sharedContext: {
      jurisdiction: 'ADGM',
      companyType: 'LLC'
    }
  };

  await saveGuideResumeState({ database, token: sessionA.token, scope, experienceVersion: 1, previewMode: false, state: roadmapInitialState });
  const restoredState = await loadGuideResumeState({ database, token: sessionA.token, scope, experienceVersion: 1, previewMode: false });

  assert.deepEqual(restoredState.roadmapState.generatedAnalysis, { strategy: 'Phase 1 MVP, Phase 2 Full roll-out' });
  assert.equal(restoredState.roadmapState.category, 'ENTERPRISE_LAUNCH');
  assert.equal(restoredState.roadmapState.initialGoal, 'Launch digital services in UAE');
  assert.equal(restoredState.roadmapState.messages.length, 2);
  assert.equal(restoredState.roadmapState.messages[0].content, 'What is step 1?');
  assert.equal(restoredState.roadmapState.messages[1].content, 'Step 1 is company incorporation.');
  assert.equal(restoredState.assistantConversation.messages.length, 2);
  assert.equal(restoredState.assistantConversation.messages[0].content, 'Hello general assistant');
  const assistantTexts = restoredState.assistantConversation.messages.map(m => m.content);
  assert.ok(!assistantTexts.includes('What is step 1?'));
  assert.ok(!assistantTexts.includes('Step 1 is company incorporation.'));
  assert.deepEqual(restoredState.planningState, { budgetCalculated: 50000, checklistComplete: false });
  assert.deepEqual(restoredState.sharedContext, { jurisdiction: 'ADGM', companyType: 'LLC' });
  const stateFromB = await loadGuideResumeState({ database, token: sessionB.token, scope, experienceVersion: 1, previewMode: false });
  assert.deepEqual(stateFromB, {});
  const stateCrossTenant = await loadGuideResumeState({ database, token: sessionA.token, scope: tenantBScope, experienceVersion: 1, previewMode: false });
  assert.equal(stateCrossTenant, null);
});
