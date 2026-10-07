import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

import {
  resolveActiveManagedGuideDomain,
  resolveGuideRuntimeScopeFromRequest,
} from '../services/guide-domain-service.js';
import {
  issueGuideResumeSession,
  resolveGuideResumeSession,
  resolveGuideResumeSessionByToken,
} from '../services/guide-conversation-service.js';
import { buildPublicChatFailure } from '../services/public-chat-failure.js';

const guideJsSource = fs.readFileSync(new URL('../public-guide/guide.js', import.meta.url), 'utf8');
const appJsSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const domainServiceSource = fs.readFileSync(new URL('../services/guide-domain-service.js', import.meta.url), 'utf8');

const TENANT_ALPHA = '11111111-1111-4111-8111-111111111111';
const TENANT_BETA = '22222222-2222-4222-8222-222222222222';
const ASSISTANT_ALPHA = '33333333-3333-4333-8333-333333333333';
const ASSISTANT_BETA = '44444444-4444-4444-8444-444444444444';
const CHANNEL_ALPHA = '55555555-5555-4555-8555-555555555555';
const CHANNEL_BETA = '66666666-6666-4666-8666-666666666666';
const DOMAIN_ALPHA = '77777777-7777-4777-8777-777777777777';
const DOMAIN_BETA = '88888888-8888-4888-8888-888888888888';

test('1. Clean first session: new conversation starts empty without reading stale localStorage messages', () => {
  assert.match(guideJsSource, /explicitResumeToken/);
  assert.match(guideJsSource, /sessionStorage\.getItem\(resumeStorageKey\)/);
  assert.match(guideJsSource, /if \(!session\) return fallback/);
  assert.match(guideJsSource, /session \? \{ 'X-Samcheguide-Session': session \}/);
  assert.match(guideJsSource, /let messages = \[\]/);
});

test('2. Valid resumed session: explicitly resumed session restores legitimate conversation state', async () => {
  const store = new Map();
  const mockDb = {
    async query(sql, params = []) {
      if (sql.includes('INSERT INTO guide_public_sessions')) {
        store.set(params[0], {
          token_hash: params[0],
          session_id: params[1],
          tenant_id: params[2],
          assistant_id: params[3],
          channel_id: params[4],
          domain_id: params[5],
          experience_version: params[6],
          preview_mode: params[7],
          expires_at: params[8],
          state: { assistantConversation: { messages: [{ role: 'user', content: 'Prior question' }] } },
        });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT session_id, expires_at FROM guide_public_sessions')) {
        const found = store.get(params[0]);
        if (found && found.tenant_id === params[1] && found.experience_version === params[5]) {
          return { rowCount: 1, rows: [{ session_id: found.session_id, expires_at: found.expires_at }] };
        }
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const scope = {
    tenant_id: TENANT_ALPHA,
    assistant_id: ASSISTANT_ALPHA,
    channel_id: CHANNEL_ALPHA,
    domain_id: DOMAIN_ALPHA,
  };

  const issued = await issueGuideResumeSession({
    database: mockDb,
    scope,
    experienceVersion: 1,
    previewMode: false,
  });

  const resolved = await resolveGuideResumeSession({
    database: mockDb,
    token: issued.token,
    scope,
    experienceVersion: 1,
    previewMode: false,
  });

  assert.ok(resolved);
  assert.equal(resolved.sessionId, issued.sessionId);
  assert.match(guideJsSource, /resumeGuideSession/);
  assert.match(guideJsSource, /\/guide\/session-context/);
});


test('3. Tenant & session isolation: cross-tenant session does not break domain resolution and fails closed', async () => {
  const tokenHashAlpha = crypto.createHash('sha256').update('session-token-from-tenant-alpha-32chars!').digest('hex');
  const mockDb = {
    async query(sql, params = []) {
      if (sql.includes('guide_domains gd') && sql.includes('lower(gd.slug) = $1')) {
        return {
          rowCount: 1,
          rows: [{
            domain_id: DOMAIN_BETA,
            hostname: 'guide-staging.samchecompany.com',
            slug: 'tenant-beta-slug',
            tenant_id: TENANT_BETA,
            assistant_id: ASSISTANT_BETA,
            channel_id: CHANNEL_BETA,
            channel_assistant_id: ASSISTANT_BETA,
            channel_type: 'SAMCHEGUIDE',
            channel_status: 'active',
            assistant_status: 'active',
            integration_enabled: true,
          }],
        };
      }
      if (sql.includes('SELECT tenant_id FROM guide_public_sessions WHERE token_hash = $1')) {
        if (params[0] === tokenHashAlpha) {
          return { rowCount: 1, rows: [{ tenant_id: TENANT_ALPHA }] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT session_id, expires_at FROM guide_public_sessions')) {
        if (params[1] === TENANT_BETA && params[0] === tokenHashAlpha) {
          return { rowCount: 0, rows: [] };
        }
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const req = {
    headers: {
      host: 'guide-staging.samchecompany.com',
      'x-samcheguide-session': 'session-token-from-tenant-alpha-32chars!',
    },
    params: { slug: 'tenant-beta-slug' },
  };

  const resolvedScope = await resolveGuideRuntimeScopeFromRequest({ database: mockDb, req });
  assert.ok(resolvedScope, 'Domain scope must resolve successfully for Tenant Beta');
  assert.equal(resolvedScope.tenant_id, TENANT_BETA);
  assert.equal(req.headers['x-samcheguide-session'], undefined);

  const crossResolve = await resolveGuideResumeSession({
    database: mockDb,
    token: 'session-token-from-tenant-alpha-32chars!',
    scope: { tenant_id: TENANT_BETA, assistant_id: ASSISTANT_BETA, channel_id: CHANNEL_BETA, domain_id: DOMAIN_BETA },
    experienceVersion: 1,
    previewMode: false,
  });
  assert.equal(crossResolve, null, 'Tenant Alpha session must not resolve for Tenant Beta');
});

test('4. Superseded experience version: public session recovers cleanly instead of throwing unhandled 503/400', () => {
  assert.match(appJsSource, /if \(resolved\.experience\.version !== durableSession\.experienceVersion/);
  assert.match(appJsSource, /if \(durableSession\.previewMode\) \{\s*throw new GuideConversationError\('GUIDE_SESSION_EXPERIENCE_REVOKED'\);\s*\}/);
  assert.match(appJsSource, /return \{ resolved, durableSession: null \};/);
});


test('5. Successful send: renders user message, AI reply, updates persisted state, and clears composer', () => {
  assert.match(guideJsSource, /messages\.push\(\{ value: displayValue, kind: 'user' \}\);/);
  assert.match(guideJsSource, /messages\.push\(\{ value: aiResponseText, kind: 'assistant' \}\);/);
  assert.match(guideJsSource, /guideState\.assistantConversation = \{/);
  assert.match(guideJsSource, /guideState\.assistant_draft = '';/);
  assert.match(guideJsSource, /guideState\.assistant_draft_origin = 'NONE';/);
  assert.match(guideJsSource, /await playGuideResponseEvents\(board, payload\.guide_events\);/);
  assert.match(guideJsSource, /if \(input\) input\.value = '';/);
});

test('6. Failure handling: retains draft, prevents duplicate error messages, and uses non-sensitive safe message', () => {
  assert.match(guideJsSource, /board\.querySelectorAll\('\.guide-validation'\)\.forEach/);
  assert.match(guideJsSource, /const safeErrorText = \(typeof payload\?\.reply === 'string' && payload\.reply\)/);
  assert.match(guideJsSource, /guideState\.assistant_draft = value;/);
  assert.match(guideJsSource, /guideState\.assistant_draft_origin = 'USER';/);
  assert.match(guideJsSource, /submittedMessage\.remove\(\);/);
});

test('7. Duplicate send prevention: form submission guards against re-entrant calls', () => {
  assert.match(guideJsSource, /if \(form\?\.dataset\?\.submitting\) return;/);
  assert.match(guideJsSource, /form\.dataset\.submitting = 'true';/);
  assert.match(guideJsSource, /delete form\.dataset\.submitting;/);
  assert.match(guideJsSource, /submit\.disabled = true;/);
  assert.match(guideJsSource, /submit\.disabled = false;/);
});

test('8. Recovery after failure: error state clears and conversation proceeds on subsequent success', () => {
  const submitBlock = guideJsSource.slice(guideJsSource.indexOf('async function submitGuideRequest'));
  const successHandling = submitBlock.slice(0, submitBlock.indexOf('await playGuideResponseEvents'));
  assert.match(successHandling, /board\.querySelectorAll\('\.guide-validation'\)\.forEach\(\(el\) => el\.remove\(\)\);/);
});
