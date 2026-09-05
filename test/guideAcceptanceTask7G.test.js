import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  GuideConversationError,
  canonicalGuideResponseEvents,
  normalizeGuideConversationRequest,
  issueGuideResumeSession,
  resolveGuideResumeSession,
} from '../services/guide-conversation-service.js';

const jsSource = fs.readFileSync(new URL('../public-guide/guide.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('1. guideSessionPayloadState is defined in guide.js and packages complete session state', () => {
  assert.match(jsSource, /function guideSessionPayloadState\(\)/);
  assert.match(jsSource, /active_module:\s*guideState\.active_module/);
  assert.match(jsSource, /sharedContext:\s*guideState\.shared_context/);
  assert.match(jsSource, /roadmapState:\s*\{/);
  assert.match(jsSource, /planningState:\s*guideState\.tool/);
});

test('2. submitGuideRequest sends guide_session_state without ReferenceError', () => {
  assert.match(jsSource, /guide_session_state:\s*guideSessionPayloadState\(\)/);
});

test('3. Roadmap form submission guards against in-flight requests and avoids duplicate user entries', () => {
  assert.match(jsSource, /if \(form\.dataset\.submitting\) return/);
  assert.match(jsSource, /form\.dataset\.submitting = "true"/);
  assert.match(jsSource, /delete form\.dataset\.submitting/);
  // User message is only pushed to persisted roadmap_messages on successful response
  assert.match(jsSource, /onResponse:\s*\(payload\)\s*=>\s*\{[\s\S]*guideState\.roadmap_messages\.push\(\{ role: "user", content: value \}\)/);
});

test('4. Assistant submit guards against in-flight requests and rapid double-clicks', () => {
  assert.match(jsSource, /async function submitMessage\(event\) \{[\s\S]*if \(form\?\.dataset\?\.submitting\) return/);
  assert.match(jsSource, /form\.dataset\.submitting = 'true'/);
  assert.match(jsSource, /delete form\.dataset\.submitting/);
});

test('5. Tenant and session isolation is enforced for Guide resume and chat contracts', async () => {
  const store = new Map();
  const database = {
    query: async (sql, values) => {
      if (sql.includes('INSERT INTO guide_public_sessions')) {
        store.set(values[0], { token_hash: values[0], session_id: values[1], tenant_id: values[2], assistant_id: values[3], channel_id: values[4], domain_id: values[5], experience_version: values[6], preview_mode: values[7], expires_at: values[8], state: {} });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('FROM guide_public_sessions')) {
        const row = store.get(values[0]);
        const match = row && row.tenant_id === values[1] && row.assistant_id === values[2] && row.channel_id === values[3] && row.domain_id === values[4] && row.experience_version === values[5] && row.preview_mode === values[6];
        return { rowCount: match ? 1 : 0, rows: match ? [row] : [] };
      }
      return { rowCount: 1, rows: [] };
    }
  };

  const scopeTenantA = { domain_id: 'dom-1', tenant_id: 'tenant-1', assistant_id: 'asst-1', channel_id: 'chan-1' };
  const session = await issueGuideResumeSession({ database, scope: scopeTenantA, experienceVersion: 1, previewMode: false });
  assert.ok(session.token);

  // Cross tenant lookup fails
  const scopeTenantB = { domain_id: 'dom-1', tenant_id: 'tenant-2', assistant_id: 'asst-1', channel_id: 'chan-1' };
  const crossResolve = await resolveGuideResumeSession({ database, token: session.token, scope: scopeTenantB, experienceVersion: 1, previewMode: false });
  assert.equal(crossResolve, null);
});
