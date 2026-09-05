import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendGuideModuleMessage,
  canonicalGuideResponseText,
  GuideConversationError,
  canonicalGuideResponseEvents,
  issueGuideResumeSession,
  loadGuideResumeState,
  normalizeGuideConversationRequest,
  patchGuideResumeState,
  resolveGuideResumeSessionByToken,
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

test('normalizes provider HTML roadmap content into canonical safe sections and lists', () => {
  const events = canonicalGuideResponseEvents('<h2>Yol haritası</h2><p>İlk adımı belirleyin.</p><ul><li><strong>Hedefi</strong> doğrulayın</li><li>Seçenekleri değerlendirin</li></ul>');
  assert.deepEqual(events.map((event) => event.type), ['MESSAGE_START', 'THINKING', 'SECTION', 'TEXT_DELTA', 'LIST', 'MESSAGE_COMPLETE']);
  assert.equal(events[2].title, 'Yol haritası');
  assert.equal(events[3].text, 'İlk adımı belirleyin.');
  assert.deepEqual(events[4].items, ['Hedefi doğrulayın', 'Seçenekleri değerlendirin']);
  assert.doesNotMatch(JSON.stringify(events), /<\/?(?:ul|li|strong|h2|p)>/i);
});

test('derives persisted Guide text only from canonical visible response events', () => {
  const text = canonicalGuideResponseText('<h2>Yol haritası</h2><ul><li><strong>Hedefi</strong> doğrulayın</li></ul>');
  assert.equal(text, 'Yol haritası\n- Hedefi doğrulayın');
  assert.doesNotMatch(text, /<\/?(?:ul|li|strong|h2)>/i);
});

test('preserves a persisted long provider response as bounded canonical Guide events', () => {
  const response = `## Detailed roadmap\n\n${'A complete planning recommendation. '.repeat(80)}`;
  const events = canonicalGuideResponseEvents(response);
  const deliveredText = events
    .filter((event) => event.type === 'TEXT_DELTA')
    .map((event) => event.text)
    .join(' ');
  assert.match(deliveredText, /complete planning recommendation/);
  assert.ok(events.filter((event) => event.type === 'TEXT_DELTA').every((event) => event.text.length <= 800));
});

test('rejects unsafe or provider-shaped Guide events and bounds roadmap conversation input', () => {
  assert.throws(() => canonicalGuideResponseEvents('<script>alert(1)</script>'), GuideConversationError);
  assert.throws(() => canonicalGuideResponseEvents('<img src=x onerror=alert(1)>'), GuideConversationError);
  assert.throws(() => normalizeGuideConversationRequest({ module: 'ROADMAP', text: 'x'.repeat(2001) }), GuideConversationError);
  assert.throws(() => normalizeGuideConversationRequest({ module: 'VERTEX_STREAM', text: 'hello' }), GuideConversationError);
  assert.deepEqual(normalizeGuideConversationRequest({ module: 'ROADMAP', text: ' Plan a launch ' }), { module: 'ROADMAP', text: 'Plan a launch' });
  assert.deepEqual(normalizeGuideConversationRequest({ module: 'ASSISTANT', text: ' Can you help? ' }), { module: 'AI_ASSISTANT', text: 'Can you help?' });
  assert.deepEqual(normalizeGuideConversationRequest({ module: 'AI_ASSISTANT', text: ' Can you help? ' }), { module: 'AI_ASSISTANT', text: 'Can you help?' });
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

test('resolves an established private session by its opaque token without requiring the expired bootstrap ticket', async () => {
  const rows = new Map();
  const database = { query: async (sql, values) => {
    if (sql.includes('INSERT INTO guide_public_sessions')) {
      rows.set(values[0], { token_hash: values[0], session_id: values[1], tenant_id: values[2], assistant_id: values[3], channel_id: values[4], domain_id: values[5], experience_version: values[6], preview_mode: values[7], expires_at: values[8] });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('SELECT session_id, experience_version') && sql.includes('preview_mode')) {
      const row = rows.get(values[0]);
      const matches = row && row.tenant_id === values[1] && row.assistant_id === values[2] && row.channel_id === values[3] && row.domain_id === values[4];
      return { rowCount: matches ? 1 : 0, rows: matches ? [row] : [] };
    }
    return { rowCount: 1, rows: [] };
  } };
  const issued = await issueGuideResumeSession({ database, scope, experienceVersion: 10, previewMode: true, now: 1000 });
  const resumed = await resolveGuideResumeSessionByToken({ database, token: issued.token, scope, now: 1001 });
  assert.equal(resumed.sessionId, issued.sessionId);
  assert.equal(resumed.previewMode, true);
  assert.equal(resumed.experienceVersion, 10);
  assert.equal(await resolveGuideResumeSessionByToken({ database, token: issued.token, scope: { ...scope, tenant_id: 'tenant-b' }, now: 1001 }), null);
});

test('patching Guide state preserves unrelated canonical modules', async () => {
  const row = {
    token_hash: 'stored', session_id: 'session-a', tenant_id: scope.tenant_id, assistant_id: scope.assistant_id, channel_id: scope.channel_id,
    domain_id: scope.domain_id, experience_version: 10, preview_mode: true, expires_at: new Date(Date.now() + 60_000),
    state: { roadmapState: { structuredInputs: { guests: 20 }, messages: [{ role: 'assistant', content: 'Roadmap' }] }, planningState: { venue: 'hotel' }, assistantConversation: { messages: [{ role: 'assistant', content: 'Assistant' }] }, sharedContext: { goal: 'launch' } },
  };
  const database = { query: async (sql, values) => {
    if (sql.includes('SELECT state FROM guide_public_sessions')) return { rowCount: 1, rows: [row] };
    if (sql.includes('SELECT session_id, expires_at')) return { rowCount: 1, rows: [row] };
    if (sql.includes('SET state=')) { row.state = JSON.parse(values[1]); return { rowCount: 1, rows: [] }; }
    return { rowCount: 1, rows: [] };
  } };
  const patched = await patchGuideResumeState({ database, token: 'a'.repeat(32), scope, experienceVersion: 10, previewMode: true, patch: { planningState: { catering: true } } });
  assert.deepEqual(patched.roadmapState, row.state.roadmapState);
  assert.deepEqual(patched.assistantConversation, row.state.assistantConversation);
  assert.deepEqual(patched.sharedContext, row.state.sharedContext);
  assert.deepEqual(patched.planningState, { venue: 'hotel', catering: true });
});

test('normalizes legacy module records before appending Roadmap and Assistant messages', () => {
  const legacyState = {
    roadmapState: { structuredInputs: { guests: 150 } },
    assistantConversation: {},
    planningState: { venue: 'hotel' },
  };
  const roadmap = appendGuideModuleMessage(legacyState, 'ROADMAP', { role: 'user', content: 'Create a roadmap' });
  assert.deepEqual(roadmap.roadmapState.messages, [{ role: 'user', content: 'Create a roadmap' }]);
  assert.deepEqual(roadmap.roadmapState.structuredInputs, { guests: 150 });
  const assistant = appendGuideModuleMessage(roadmap, 'AI_ASSISTANT', { role: 'user', content: 'Refine the plan' });
  assert.deepEqual(assistant.assistantConversation.messages, [{ role: 'user', content: 'Refine the plan' }]);
  assert.deepEqual(assistant.planningState, { venue: 'hotel' });
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
