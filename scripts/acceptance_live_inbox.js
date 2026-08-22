import crypto from 'crypto';

const apiBaseUrl = (process.env.STAGING_API_BASE_URL || 'https://samche-api-staging.onrender.com').replace(/\/$/, '');
const adminToken = process.env.STAGING_ADMIN_TOKEN;
const sessionId = process.env.LIVE_INBOX_SESSION_ID;

if (!adminToken || !sessionId) {
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
    console.log((passed ? 'PASS' : 'FAIL') + ' | ' + role + ' | ' + method + ' ' + path + ' | HTTP ' + response.status + (passed ? '' : ' | ' + summary(data)));
    if (!passed) failures += 1;
    return { response, data, passed };
  } catch (error) {
    console.log('FAIL | ' + role + ' | ' + method + ' ' + path + ' | ' + (error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR'));
    failures += 1;
    return { response: null, data: null, passed: false };
  } finally {
    clearTimeout(timeout);
  }
}

function conversationKey(value) {
  return 'samcheguide:' + crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function main() {
  const sessionHeaders = { 'x-user-id': sessionId };
  const adminHeaders = { Authorization: 'Bearer ' + adminToken };

  const chat = await request({
    role: 'PUBLIC',
    method: 'POST',
    path: '/chat',
    expected: 200,
    body: { text: 'hello' },
    headers: sessionHeaders,
  });
  if (!chat.passed) return;

  const tenants = await request({
    role: 'ADMIN',
    method: 'GET',
    path: '/api/v1/tenants',
    expected: 200,
    headers: adminHeaders,
  });
  if (!tenants.passed || !Array.isArray(tenants.data)) return;

  const externalConversationId = conversationKey(sessionId);
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
    console.log('FAIL | ADMIN | GET tenant conversations | HTTP 404 | Persisted Samcheguide conversation was not found in an ADMIN workspace');
    failures += 1;
    return;
  }

  await request({ role: 'ADMIN', method: 'GET', path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId, expected: 200, headers: adminHeaders });
  await request({ role: 'ADMIN', method: 'POST', path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId + '/takeover', expected: 200, headers: adminHeaders });

  const agentReply = 'Live inbox acceptance reply ' + sessionId;
  await request({
    role: 'ADMIN',
    method: 'POST',
    path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId + '/messages',
    expected: 201,
    body: { content: agentReply },
    headers: { ...adminHeaders, 'Idempotency-Key': 'acceptance-' + sessionId },
  });

  const publicHistory = await request({
    role: 'PUBLIC',
    method: 'GET',
    path: '/chat/history',
    expected: 200,
    headers: sessionHeaders,
  });
  if (publicHistory.passed && (!Array.isArray(publicHistory.data) || !publicHistory.data.some((message) => message?.parts?.[0]?.text === agentReply))) {
    console.log('FAIL | PUBLIC | GET /chat/history | HTTP 200 | Agent reply missing from persisted Samcheguide feed');
    failures += 1;
  }

  await request({ role: 'ADMIN', method: 'GET', path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId + '/messages?limit=50&offset=0', expected: 200, headers: adminHeaders });
  await request({ role: 'ADMIN', method: 'GET', path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId + '/events', expected: 200, headers: adminHeaders });
  await request({ role: 'ADMIN', method: 'POST', path: '/api/v1/tenants/' + match.tenantId + '/conversations/' + match.conversationId + '/return-to-ai', expected: 200, headers: adminHeaders });
}

await main();
if (failures > 0) process.exitCode = 1;
