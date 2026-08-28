import crypto from 'crypto';
import { writeFileSync } from 'fs';

const apiBaseUrl = (process.env.STAGING_API_BASE_URL || 'https://samche-api-staging.onrender.com').replace(/\/$/, '');
const adminToken = process.env.STAGING_ADMIN_TOKEN;
const ownerToken = process.env.STAGING_OWNER_TOKEN;
const agentEmail = process.env.LIVE_INBOX_AGENT_EMAIL;
const sessionId = process.env.LIVE_INBOX_SESSION_ID;

if (!adminToken || !ownerToken || !agentEmail || !sessionId) {
  console.error('Required staging acceptance configuration is missing.');
  process.exit(1);
}

let failures = 0;

function summary(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, 180);
  try {
    return JSON.stringify(value).slice(0, 180);
  } catch {
    return '';
  }
}

function pass(role, method, path, status, detail = '') {
  console.log('PASS | ' + role + ' | ' + method + ' ' + path + ' | HTTP ' + status + (detail ? ' | ' + detail : ''));
}

function fail(role, method, path, status, detail = '') {
  console.log('FAIL | ' + role + ' | ' + method + ' ' + path + ' | ' + status + (detail ? ' | ' + detail : ''));
  failures += 1;
}

async function request({ role, method, path, expected, body, headers = {} }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(apiBaseUrl + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* response may be plain text */ }
    const passed = Array.isArray(expected) ? expected.includes(response.status) : response.status === expected;
    if (passed) pass(role, method, path, response.status);
    else fail(role, method, path, 'HTTP ' + response.status, summary(data));
    return { response, data, passed };
  } catch (error) {
    fail(role, method, path, error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
    return { response: null, data: null, passed: false };
  } finally {
    clearTimeout(timeout);
  }
}

function conversationKey(value) {
  return 'samcheguide:' + crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hasMessage(messages, senderType, content) {
  return Array.isArray(messages) && messages.some((message) => message?.sender_type === senderType && message?.content === content);
}

async function startLiveStream(tenantId, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(apiBaseUrl + '/api/v1/tenants/' + tenantId + '/conversations/live', {
      headers: { Authorization: 'Bearer ' + token },
      signal: controller.signal,
    });
    if (response.status !== 200 || !response.body) {
      clearTimeout(timeout);
      fail('ADMIN', 'GET', '/api/v1/tenants/' + tenantId + '/conversations/live', 'HTTP ' + response.status);
      return null;
    }
    return {
      async waitFor(conversationId, eventType) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split('\n\n');
            buffer = frames.pop() ?? '';
            for (const frame of frames) {
              if (!frame.includes('event: conversation')) continue;
              const line = frame.split('\n').find((entry) => entry.startsWith('data: '));
              if (!line) continue;
              const event = JSON.parse(line.slice(6));
              if (event?.conversation_id === conversationId && event?.type === eventType) {
                pass('ADMIN', 'SSE', '/api/v1/tenants/' + tenantId + '/conversations/live', 200, eventType);
                return true;
              }
            }
          }
        } catch {
          // The assertion below reports the failure without leaking any stream data.
        } finally {
          clearTimeout(timeout);
          controller.abort();
        }
        fail('ADMIN', 'SSE', '/api/v1/tenants/' + tenantId + '/conversations/live', 'EVENT_TIMEOUT', eventType);
        return false;
      },
    };
  } catch {
    clearTimeout(timeout);
    fail('ADMIN', 'GET', '/api/v1/tenants/' + tenantId + '/conversations/live', 'NETWORK_ERROR');
    return null;
  }
}

async function listMessages(tenantId, conversationId, headers) {
  const result = await request({
    role: 'ADMIN',
    method: 'GET',
    path: '/api/v1/tenants/' + tenantId + '/conversations/' + conversationId + '/messages?limit=100&offset=0',
    expected: 200,
    headers,
  });
  return result.passed && Array.isArray(result.data) ? result.data : null;
}

async function main() {
  const adminHeaders = { Authorization: 'Bearer ' + adminToken };
  const ownerHeaders = { Authorization: 'Bearer ' + ownerToken };

  const initialCustomerText = 'hello';
  const initial = await request({
    role: 'PUBLIC',
    method: 'POST',
    path: '/chat',
    expected: 200,
    body: { text: initialCustomerText },
  });
  if (!initial.passed) return;

  const publicSessionToken = initial.data?.conversation_session;
  if (typeof publicSessionToken !== 'string') {
    fail('PUBLIC', 'VERIFY', 'signed conversation session', 'MISSING');
    return;
  }

  let publicSessionId;
  try {
    publicSessionId = JSON.parse(Buffer.from(publicSessionToken.split('.')[0], 'base64url').toString('utf8')).sid;
  } catch {
    fail('PUBLIC', 'VERIFY', 'signed conversation session', 'INVALID');
    return;
  }
  if (typeof publicSessionId !== 'string' || !publicSessionId) {
    fail('PUBLIC', 'VERIFY', 'signed conversation session', 'INVALID');
    return;
  }
  writeFileSync('.live-inbox-public-session-id', publicSessionId, { encoding: 'utf8', mode: 0o600 });
  const sessionHeaders = { 'X-Samcheguide-Session': publicSessionToken };

  const tenants = await request({ role: 'ADMIN', method: 'GET', path: '/api/v1/tenants', expected: 200, headers: adminHeaders });
  if (!tenants.passed || !Array.isArray(tenants.data)) return;

  const externalConversationId = conversationKey(publicSessionId);
  let match = null;
  for (const tenant of tenants.data.filter((item) => item.tenant_role === 'ADMIN')) {
    const list = await request({
      role: 'ADMIN',
      method: 'GET',
      path: '/api/v1/tenants/' + tenant.id + '/conversations?limit=100&offset=0',
      expected: 200,
      headers: adminHeaders,
    });
    if (list.passed && Array.isArray(list.data)) {
      const conversation = list.data.find((item) => item.external_conversation_id === externalConversationId);
      if (conversation) {
        match = { tenantId: tenant.id, conversationId: conversation.id };
        break;
      }
    }
  }
  if (!match) {
    fail('ADMIN', 'GET', 'tenant conversations', 'NOT_FOUND', 'Persisted Samcheguide conversation was not found');
    return;
  }

  await request({ role: 'ADMIN', method: 'GET', path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId, expected: 200, headers: adminHeaders });
  let messages = await listMessages(match.tenantId, match.conversationId, adminHeaders);
  if (!hasMessage(messages, 'CUSTOMER', initialCustomerText)) fail('ADMIN', 'VERIFY', 'initial CUSTOMER persistence', 'MISSING');
  else pass('ADMIN', 'VERIFY', 'initial CUSTOMER persistence', 200);
  if (!Array.isArray(messages) || !messages.some((message) => message?.sender_type === 'ASSISTANT')) fail('ADMIN', 'VERIFY', 'initial ASSISTANT persistence', 'MISSING');
  else pass('ADMIN', 'VERIFY', 'initial ASSISTANT persistence', 200);

  const agentPassword = crypto.randomUUID() + 'Aa1!';
  const registration = await request({ role: 'PUBLIC', method: 'POST', path: '/api/v1/auth/register', expected: 201, body: { email: agentEmail, password: agentPassword } });
  const agentUserId = registration.data?.user?.id;
  if (!registration.passed || !agentUserId) return;

  const assignment = await request({
    role: 'OWNER',
    method: 'POST',
    path: '/api/v1/tenants/' + match.tenantId + '/users',
    expected: 201,
    body: { user_id: agentUserId, tenant_role: 'AGENT' },
    headers: ownerHeaders,
  });
  if (!assignment.passed) return;

  const login = await request({ role: 'AGENT', method: 'POST', path: '/api/v1/auth/login', expected: 200, body: { email: agentEmail, password: agentPassword } });
  const agentToken = login.data?.token;
  if (!login.passed || typeof agentToken !== 'string') return;
  const agentHeaders = { Authorization: 'Bearer ' + agentToken };

  const agentTenants = await request({ role: 'AGENT', method: 'GET', path: '/api/v1/tenants', expected: 200, headers: agentHeaders });
  if (!Array.isArray(agentTenants.data) || !agentTenants.data.some((tenant) => tenant.id === match.tenantId && tenant.tenant_role === 'AGENT')) {
    fail('AGENT', 'VERIFY', 'tenant assignment', 'MISSING_AGENT_ROLE');
  } else {
    pass('AGENT', 'VERIFY', 'tenant assignment', 200, 'AGENT');
  }

  const stream = await startLiveStream(match.tenantId, adminToken);
  const takeoverRequest = request({ role: 'AGENT', method: 'POST', path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId + '/takeover', expected: 200, headers: agentHeaders });
  const takeoverEvent = stream ? stream.waitFor(match.conversationId, 'TAKEOVER') : Promise.resolve(false);
  const takeover = await takeoverRequest;
  await takeoverEvent;
  if (takeover.passed && takeover.data?.conversation?.handling_mode === 'HUMAN') pass('AGENT', 'VERIFY', 'takeover state', 200, 'HUMAN');
  else fail('AGENT', 'VERIFY', 'takeover state', 'INVALID_STATE');

  const humanModeCustomerText = 'human mode customer message ' + sessionId;
  const humanModeCustomer = await request({ role: 'PUBLIC', method: 'POST', path: '/chat', expected: 202, body: { text: humanModeCustomerText }, headers: sessionHeaders });
  if (humanModeCustomer.passed && humanModeCustomer.data?.status === 'human_handling') pass('PUBLIC', 'VERIFY', 'AI suppression in HUMAN mode', 202);
  else fail('PUBLIC', 'VERIFY', 'AI suppression in HUMAN mode', 'INVALID_RESPONSE');
  messages = await listMessages(match.tenantId, match.conversationId, adminHeaders);
  if (!hasMessage(messages, 'CUSTOMER', humanModeCustomerText)) fail('ADMIN', 'VERIFY', 'HUMAN mode CUSTOMER persistence', 'MISSING');
  else pass('ADMIN', 'VERIFY', 'HUMAN mode CUSTOMER persistence', 200);

  const humanReply = 'Agent acceptance reply ' + sessionId;
  await request({
    role: 'AGENT',
    method: 'POST',
    path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId + '/messages',
    expected: 201,
    body: { content: humanReply },
    headers: { ...agentHeaders, 'Idempotency-Key': 'agent-acceptance-' + sessionId },
  });
  messages = await listMessages(match.tenantId, match.conversationId, adminHeaders);
  if (!hasMessage(messages, 'AGENT', humanReply)) fail('ADMIN', 'VERIFY', 'AGENT message persistence', 'MISSING');
  else pass('ADMIN', 'VERIFY', 'AGENT message persistence', 200);

  const publicHistory = await request({ role: 'PUBLIC', method: 'GET', path: '/chat/history', expected: 200, headers: sessionHeaders });
  const publicMessages = publicHistory.data?.messages;
  if (publicHistory.passed && Array.isArray(publicMessages) && publicMessages.some((message) => message?.sender_type === 'AGENT' && message?.content === humanReply)) {
    pass('PUBLIC', 'VERIFY', 'Samcheguide agent reply feed', 200);
  } else {
    fail('PUBLIC', 'VERIFY', 'Samcheguide agent reply feed', 'MISSING');
  }

  await request({ role: 'AGENT', method: 'POST', path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId + '/pause', expected: 403, headers: agentHeaders });
  await request({ role: 'AGENT', method: 'POST', path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId + '/return-to-ai', expected: 200, headers: agentHeaders });

  const returnedAiText = 'hello';
  await request({ role: 'PUBLIC', method: 'POST', path: '/chat', expected: 200, body: { text: returnedAiText }, headers: sessionHeaders });
  messages = await listMessages(match.tenantId, match.conversationId, adminHeaders);
  const assistantCountAfterReturn = Array.isArray(messages) ? messages.filter((message) => message?.sender_type === 'ASSISTANT').length : 0;
  if (assistantCountAfterReturn >= 2) pass('ADMIN', 'VERIFY', 'AI resumed after return-to-ai', 200);
  else fail('ADMIN', 'VERIFY', 'AI resumed after return-to-ai', 'MISSING_ASSISTANT_RESPONSE');

  await request({ role: 'ADMIN', method: 'POST', path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId + '/pause', expected: 200, headers: adminHeaders });
  const beforePausedAssistantCount = assistantCountAfterReturn;
  const pausedCustomerText = 'paused customer message ' + sessionId;
  const paused = await request({ role: 'PUBLIC', method: 'POST', path: '/chat', expected: 202, body: { text: pausedCustomerText }, headers: sessionHeaders });
  if (paused.passed && paused.data?.status === 'paused') pass('PUBLIC', 'VERIFY', 'AI suppression in PAUSED mode', 202);
  else fail('PUBLIC', 'VERIFY', 'AI suppression in PAUSED mode', 'INVALID_RESPONSE');
  messages = await listMessages(match.tenantId, match.conversationId, adminHeaders);
  const pausedAssistantCount = Array.isArray(messages) ? messages.filter((message) => message?.sender_type === 'ASSISTANT').length : -1;
  if (hasMessage(messages, 'CUSTOMER', pausedCustomerText) && pausedAssistantCount === beforePausedAssistantCount) pass('ADMIN', 'VERIFY', 'PAUSED message persistence without AI reply', 200);
  else fail('ADMIN', 'VERIFY', 'PAUSED message persistence without AI reply', 'INVALID_HISTORY');

  await request({ role: 'ADMIN', method: 'POST', path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId + '/resume', expected: 200, headers: adminHeaders });
  await request({ role: 'PUBLIC', method: 'POST', path: '/chat', expected: 200, body: { text: 'hello' }, headers: sessionHeaders });
  messages = await listMessages(match.tenantId, match.conversationId, adminHeaders);
  const assistantCountAfterResume = Array.isArray(messages) ? messages.filter((message) => message?.sender_type === 'ASSISTANT').length : 0;
  if (assistantCountAfterResume === beforePausedAssistantCount + 1) pass('ADMIN', 'VERIFY', 'AI resumed after PAUSED mode', 200);
  else fail('ADMIN', 'VERIFY', 'AI resumed after PAUSED mode', 'MISSING_ASSISTANT_RESPONSE');

  await request({ role: 'ADMIN', method: 'POST', path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId + '/close', expected: 200, headers: adminHeaders });
  const events = await request({ role: 'ADMIN', method: 'GET', path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId + '/events', expected: 200, headers: adminHeaders });
  const eventTypes = new Set(Array.isArray(events.data) ? events.data.map((event) => event.event_type) : []);
  for (const eventType of ['TAKEOVER', 'HUMAN_MESSAGE', 'RETURN_TO_AI', 'PAUSE', 'RESUME', 'CLOSE']) {
    if (!eventTypes.has(eventType)) fail('ADMIN', 'VERIFY', 'audit event ' + eventType, 'MISSING');
    else pass('ADMIN', 'VERIFY', 'audit event ' + eventType, 200);
  }

  const finalMessages = await listMessages(match.tenantId, match.conversationId, adminHeaders);
  if (Array.isArray(finalMessages) && finalMessages.length >= 8) pass('ADMIN', 'VERIFY', 'full conversation history retained after close', 200);
  else fail('ADMIN', 'VERIFY', 'full conversation history retained after close', 'INCOMPLETE');
}

await main();
if (failures > 0) process.exitCode = 1;
