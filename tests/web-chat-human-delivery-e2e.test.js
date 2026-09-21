process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.JWT_SECRET ||= 'test-jwt-secret-at-least-32-chars-long';
process.env.OPENAI_API_KEY ||= 'test-openai-key';
process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { issuePublicWebChatSession } from '../services/public-web-chat-session.js';
import { appendAgentMessage, getWebChatPublicFeed, operateConversation, persistAssistantResponseIfCurrent } from '../services/live-inbox-service.js';
import { claimDueCustomerSupportLifecycle } from '../services/human-support-service.js';
import { emitTenantEvent } from '../services/live-event-bus.js';
import { app } from '../app.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const assistantId = '44444444-4444-4444-8444-444444444444';
const profileId = '55555555-5555-4555-8555-555555555555';
const configId = '66666666-6666-4666-8666-666666666666';
const operatorUserId = '33333333-3333-4333-8333-333333333333';

test('PUBLIC SSE SUBSCRIBER: an authorized empty WebChat conversation has a stable live feed before its first message', async () => {
  const database = {
    connect: async () => ({
      query: async (sql) => {
        // An empty conversation is returned only by the required LEFT JOIN.
        if (/LEFT JOIN conversation_messages/i.test(sql)) {
          return {
            rows: [{
              conversation_id: conversationId,
              handling_mode: 'AI',
              id: null,
              sender_type: null,
              content: null,
              created_at: null,
            }],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    }),
  };

  const feed = await getWebChatPublicFeed({
    externalSessionId: 'empty-session',
    integration: { tenant_id: tenantId, channel_id: 'channel-1', channel_status: 'active' },
    database,
  });

  assert.equal(feed.conversationId, conversationId);
  assert.equal(feed.handlingMode, 'AI');
  assert.deepEqual(feed.messages, []);
});

test('PUBLIC SESSION LIFECYCLE: chat responses cannot replace the signed session with a raw UUID', async () => {
  const source = await readFile(new URL('../public/web-chat.js', import.meta.url), 'utf8');
  const assignments = source.match(/sessionToken\s*=\s*data\.session/g) || [];
  assert.equal(assignments.length, 1, 'only bootstrap may establish the signed WebChat session token');
});

test('PUBLIC SSE SESSION BOUNDARY: missing, invalid, and expired query tokens are rejected', async () => {
  const secret = 'test-secret-at-least-32-chars-long-12345';
  process.env.WEB_CHAT_PUBLIC_SESSION_SECRET = secret;
  const expired = issuePublicWebChatSession({ widgetKey: 'wch_live_widget_123', secret, now: 100, ttlSeconds: 1 });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const missing = await fetch(`http://127.0.0.1:${port}/api/chat/live?session_token=`);
    assert.equal(missing.status, 401);
    const invalid = await fetch(`http://127.0.0.1:${port}/api/chat/live?session_token=not-a-signed-session`);
    assert.equal(invalid.status, 401);
    const expiredResponse = await fetch(`http://127.0.0.1:${port}/api/chat/live?session_token=${encodeURIComponent(expired.token)}`);
    assert.equal(expiredResponse.status, 401);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

function createMockDeliveryDb() {
  const conversationState = {
    id: conversationId,
    tenant_id: tenantId,
    channel_id: 'channel-1',
    handling_mode: 'HUMAN',
    status: 'open',
    handling_version: 1,
    assigned_agent_user_id: operatorUserId,
    human_attention_state: 'REQUESTED',
    human_attention_requested_at: new Date(Date.now() - (11 * 60 * 1000)).toISOString(),
    external_conversation_id: 'sess-123',
  };

  const messagesStore = [];

  const queryHandler = async (sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('platform_lifecycle_message_templates')) {
      return {
        rowCount: 15,
        rows: [
          ...['tr', 'en', 'ar'].map((locale) => ({ message_key: 'human_support_default_topic', locale, body: locale === 'en' ? 'General support' : 'Genel destek', allowed_variables: [] })),
          ...['tr', 'en', 'ar'].map((locale) => ({ message_key: 'human_support_request', locale, body: '{TOPIC}', allowed_variables: ['TOPIC'] })),
          ...['tr', 'en', 'ar'].map((locale) => ({ message_key: 'human_session_warning', locale, body: 'Human support remains open.', allowed_variables: [] })),
          ...['tr', 'en', 'ar'].map((locale) => ({ message_key: 'human_takeover', locale, body: 'Human support has taken over.', allowed_variables: [] })),
          ...['tr', 'en', 'ar'].map((locale) => ({ message_key: 'return_to_ai', locale, body: locale === 'en' ? 'The human-support session has ended. You may continue with the AI assistant.' : 'AI devam.', allowed_variables: [] })),
        ],
      };
    }
    if (sql.startsWith('SELECT pg_notify')) {
      try {
        const payload = JSON.parse(params[1]);
        emitTenantEvent(payload.tenant_id, payload);
      } catch {}
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('SELECT id, tenant_id, customer_external_id, contact_id')) {
      return {
        rowCount: 1,
        rows: [{ ...conversationState, customer_external_id: 'customer-1', contact_id: null }],
      };
    }
    if (sql.includes('INSERT INTO crm_contacts')) {
      return { rowCount: 1, rows: [{ id: 'contact-1' }] };
    }
    if (sql.includes('SELECT id, tenant_id, contact_id, conversation_id')) {
      return { rowCount: 1, rows: [{ id: 'lead-1', tenant_id: tenantId, contact_id: 'contact-1', conversation_id: conversationId }] };
    }
    if (sql.includes('FROM conversations c') && sql.includes('conversation_messages')) {
      if (sql.includes('LEFT JOIN conversation_messages')) {
        return {
          rowCount: Math.max(messagesStore.length, 1),
          rows: messagesStore.length
            ? messagesStore.map((message) => ({ ...message, conversation_id: conversationId, handling_mode: conversationState.handling_mode }))
            : [{ conversation_id: conversationId, handling_mode: conversationState.handling_mode, id: null, sender_type: null, content: null, created_at: null }],
        };
      }
      return {
        rowCount: 1,
        rows: [{
          ...conversationState,
          conversation_id: conversationId,
          channel_type: 'WEB_CHAT',
          external_channel_id: 'web-1',
        }],
      };
    }
    if (sql.includes('FOR UPDATE OF c') && sql.includes('human_support_closed_at')) {
      return {
        rowCount: 1,
        rows: [{
          ...conversationState,
          channel_type: 'WEB_CHAT',
          external_channel_id: 'web-1',
        }],
      };
    }
    if (sql.includes('FROM guide_domains')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('channel_integrations') || sql.includes('integration_key') || sql.includes('widget_key')) {
      return {
        rowCount: 1,
        rows: [{
          tenant_id: tenantId,
          channel_id: 'channel-1',
          assistant_id: assistantId,
          channel_type: 'WEB_CHAT',
          channel_status: 'active',
          channel_name: 'Web Chat',
          assistant_status: 'active',
          assistant_name: 'SamChe AI',
          config: {},
        }],
      };
    }
    if (sql.includes('ai_assistants') && (sql.includes('knowledge_authority_version') || sql.includes('active_configuration_version_id') || sql.includes('assistant_configuration_versions'))) {
      return {
        rowCount: 1,
        rows: [{
          assistant_id: assistantId,
          knowledge_authority_version: 1,
          id: configId,
          configuration_data: { assistant_identity: 'SamChe AI', supported_languages: ['en', 'tr'] },
          configuration_schema_version: 2,
          source_profile_version_id: profileId,
          assistant_metadata_name: 'SamChe AI',
          active_business_profile_version_id: profileId,
          active_business_profile: { company_identity: 'SamChe LLC', company_display_name: 'SamChe LLC' },
          profile_schema_version: 2,
        }],
      };
    }
    if (sql.includes('SELECT c.id AS conversation_id, c.handling_mode') || sql.includes('SELECT c.*, tc.channel_type')) {
      return {
        rowCount: 1,
        rows: [{
          ...conversationState,
          conversation_id: conversationId,
          channel_type: 'WEB_CHAT',
          external_channel_id: 'web-1',
        }],
      };
    }
    if (sql.includes('SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2 FOR UPDATE') || sql.includes('SELECT * FROM conversations')) {
      return {
        rowCount: 1,
        rows: [conversationState],
      };
    }
    if (sql.includes('UPDATE conversations')) {
      if (sql.includes("handling_mode = 'AI'")) {
        conversationState.handling_mode = 'AI';
        conversationState.assigned_agent_user_id = null;
        conversationState.human_attention_state = 'RESOLVED';
        conversationState.handoff_requested = false;
      } else if (sql.includes("handling_mode = 'HUMAN'")) {
        conversationState.handling_mode = 'HUMAN';
      }
      return {
        rowCount: 1,
        rows: [conversationState],
      };
    }
    if (sql.includes('INSERT INTO conversation_messages')) {
      const msg = {
        id: `msg-${messagesStore.length + 1}`,
        tenant_id: params[0] || tenantId,
        conversation_id: params[1] || conversationId,
        sender_type: params[2] || 'AGENT',
        content: params[3] || 'Agent reply',
        created_at: new Date().toISOString(),
      };
      messagesStore.push(msg);
      return { rowCount: 1, rows: [msg] };
    }
    if (sql.includes('SELECT id, sender_type, content, created_at') && sql.includes('sender_type = $3')) {
      const matchingMsgs = messagesStore.filter((m) => m.sender_type === params[2]);
      return {
        rowCount: matchingMsgs.length,
        rows: matchingMsgs.slice(-1),
      };
    }
    if (sql.includes('users') || sql.includes('tenant_users')) {
      return {
        rowCount: 1,
        rows: [{ id: operatorUserId, system_role: 'ADMIN', tenant_role: 'ADMIN', status: 'active' }],
      };
    }
    return { rowCount: 1, rows: [] };
  };

  return {
    connect: async () => ({
      query: queryHandler,
      release: () => {},
    }),
    query: queryHandler,
    conversationState,
    messagesStore,
  };
}

test('HUMAN OUTBOUND DELIVERY: Agent message from Dashboard reaches WebChat SSE stream and renders with AGENT role', async () => {
  const secret = 'test-secret-at-least-32-chars-long-12345';
  process.env.WEB_CHAT_PUBLIC_SESSION_SECRET = secret;

  const session = issuePublicWebChatSession({
    widgetKey: 'wch_live_widget_123',
    secret,
  });

  const mockDb = createMockDeliveryDb();
  app.locals.database = mockDb;
  app.locals.storage = { get: async () => null };

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  const controller = new AbortController();

  try {
    // 1. Connect customer to WebChat live stream
    const sseRes = await fetch(`http://127.0.0.1:${port}/api/chat/live?session_token=${encodeURIComponent(session.token)}`, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
      },
      signal: controller.signal,
    });

    assert.equal(sseRes.status, 200, 'SSE stream must connect with 200 OK');
    assert.match(sseRes.headers.get('content-type') || '', /^text\/event-stream(?:;|$)/);

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();

    // Read initial connect event
    const { value: initialChunk } = await reader.read();
    const initialText = decoder.decode(initialChunk);
    assert.match(initialText, /event: connected/);

    // 2. Operator sends message from Dashboard
    const agentSendOutcome = await appendAgentMessage({
      tenantId,
      conversationId,
      actor: { userId: operatorUserId, systemRole: 'ADMIN', tenantRole: 'ADMIN' },
      content: 'hi hoew can i help you',
      database: mockDb,
    });

    assert.equal(agentSendOutcome.duplicate, false);
    assert.equal(agentSendOutcome.message.content, 'hi hoew can i help you');
    assert.equal(agentSendOutcome.message.sender_type, 'AGENT');

    // 3. Verify customer SSE stream receives the exact AGENT message event
    const { value: messageChunk } = await reader.read();
    const messageEventText = decoder.decode(messageChunk);

    assert.match(messageEventText, /event: message/);
    assert.match(messageEventText, /"role":"agent"/);
    assert.match(messageEventText, /"sender_type":"AGENT"/);
    assert.match(messageEventText, /hi hoew can i help you/);
    assert.doesNotMatch(messageEventText, new RegExp(operatorUserId));

    // 4. While handling_mode = HUMAN, customer sending message receives human active notice
    const chatRes = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Samche-Web-Chat-Session': session.token,
      },
      body: JSON.stringify({
        message: 'I have a question about my order.',
      }),
    });

    assert.equal(chatRes.status, 200);
    const chatBody = await chatRes.json();
    assert.equal(chatBody.suppress_reply, true);
    assert.equal(chatBody.reply, '');

    // 5. Operator returns conversation to AI
    await operateConversation({
      tenantId,
      conversationId,
      actor: { userId: operatorUserId, systemRole: 'ADMIN', tenantRole: 'ADMIN' },
      action: 'return_to_ai',
      database: mockDb,
    });

    // 6. Verify customer SSE stream receives mode_change to AI
    const { value: modeChunk } = await reader.read();
    const modeEventText = decoder.decode(modeChunk);
    assert.match(modeEventText, /event: mode_change/);
    assert.match(modeEventText, /"handling_mode":"AI"/);
  } finally {
    controller.abort();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    delete app.locals.database;
    delete app.locals.storage;
  }
});

test('PUBLIC SSE: human typing is transient, scoped to the current conversation, and never exposes an operator identity', async () => {
  const secret = 'test-secret-at-least-32-chars-long-12345';
  process.env.WEB_CHAT_PUBLIC_SESSION_SECRET = secret;
  const session = issuePublicWebChatSession({ widgetKey: 'wch_live_widget_123', secret });
  const mockDb = createMockDeliveryDb();
  app.locals.database = mockDb;
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const controller = new AbortController();

  try {
    const sseRes = await fetch(`http://127.0.0.1:${port}/api/chat/live?session_token=${encodeURIComponent(session.token)}`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    assert.equal(sseRes.status, 200);
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    await reader.read();

    emitTenantEvent(tenantId, {
      tenant_id: tenantId,
      conversation_id: conversationId,
      type: 'HUMAN_TYPING',
      active: true,
      expires_at: new Date(Date.now() + 5000).toISOString(),
      actor_user_id: operatorUserId,
    });

    const result = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 500)),
    ]);
    assert.notEqual(result.timeout, true, 'typing activity must reach the active customer stream');
    const eventText = decoder.decode(result.value);
    assert.match(eventText, /event: human_typing/);
    assert.match(eventText, /"active":true/);
    assert.doesNotMatch(eventText, new RegExp(operatorUserId));
  } finally {
    controller.abort();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    delete app.locals.database;
  }
});

test('AI OUTBOUND DELIVERY: Assistant message reaches the same WebChat SSE stream after Return AI', async () => {
  const secret = 'test-secret-at-least-32-chars-long-12345';
  process.env.WEB_CHAT_PUBLIC_SESSION_SECRET = secret;
  const session = issuePublicWebChatSession({ widgetKey: 'wch_live_widget_123', secret });
  const mockDb = createMockDeliveryDb();
  app.locals.database = mockDb;
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const controller = new AbortController();

  try {
    const sseRes = await fetch(`http://127.0.0.1:${port}/api/chat/live?session_token=${encodeURIComponent(session.token)}`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    assert.equal(sseRes.status, 200);
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    await reader.read();

    const returned = await operateConversation({
      tenantId,
      conversationId,
      actor: { userId: operatorUserId, systemRole: 'ADMIN', tenantRole: 'ADMIN' },
      action: 'return_to_ai',
      database: mockDb,
    });
    assert.equal(returned.handling_mode, 'AI');
    const modeResult = await reader.read();
    const lifecycleEventText = decoder.decode(modeResult.value);
    assert.match(lifecycleEventText, /"handling_mode":"AI"/);
    assert.match(lifecycleEventText, /event: message/);
    assert.match(lifecycleEventText, /The human-support session has ended/);
    assert.match(lifecycleEventText, /"sender_type":"ASSISTANT"/);

    const persisted = await persistAssistantResponseIfCurrent({
      tenantId,
      conversationId,
      content: 'AI_RETURN_TEST_RESPONSE',
      handlingVersion: returned.handling_version,
      database: mockDb,
    });
    assert.equal(persisted.delivered, true);
    assert.equal(persisted.message.sender_type, 'ASSISTANT');

    const result = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 500)),
    ]);
    assert.notEqual(result.timeout, true, 'assistant message must be delivered through the public stream');
    const text = decoder.decode(result.value);
    assert.match(text, /event: message/);
    assert.match(text, /AI_RETURN_TEST_RESPONSE/);
    assert.match(text, /"sender_type":"ASSISTANT"/);
  } finally {
    controller.abort();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    delete app.locals.database;
  }
});

test('AUTOMATIC RETURN TO AI: WebChat receives the canonical session-ended message once and reconnecting state is AI', async () => {
  const secret = 'test-secret-at-least-32-chars-long-12345';
  process.env.WEB_CHAT_PUBLIC_SESSION_SECRET = secret;
  const session = issuePublicWebChatSession({ widgetKey: 'wch_live_widget_123', secret });
  const mockDb = createMockDeliveryDb();
  app.locals.database = mockDb;
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const controller = new AbortController();

  try {
    const sseRes = await fetch(`http://127.0.0.1:${port}/api/chat/live?session_token=${encodeURIComponent(session.token)}`, {
      headers: { Accept: 'text/event-stream' }, signal: controller.signal,
    });
    assert.equal(sseRes.status, 200);
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    await reader.read();

    await claimDueCustomerSupportLifecycle({ database: mockDb, now: new Date() });
    assert.equal(mockDb.conversationState.handling_mode, 'AI');
    assert.equal(mockDb.conversationState.human_attention_state, 'RESOLVED');
    assert.equal(mockDb.conversationState.handoff_requested, false);

    let received = '';
    for (let attempt = 0; attempt < 3 && (!received.includes('mode_change') || !received.includes('The human-support session has ended')); attempt++) {
      const result = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 750)),
      ]);
      if (result.timeout) break;
      received += decoder.decode(result.value);
    }
    assert.match(received, /event: mode_change/);
    assert.match(received, /"handling_mode":"AI"/);
    assert.match(received, /The human-support session has ended/);
    assert.equal((received.match(/The human-support session has ended/g) || []).length, 1);

    const reconnectController = new AbortController();
    const reconnectRes = await fetch(`http://127.0.0.1:${port}/api/chat/live?session_token=${encodeURIComponent(session.token)}`, {
      headers: { Accept: 'text/event-stream' }, signal: reconnectController.signal,
    });
    const reconnectReader = reconnectRes.body.getReader();
    const reconnectSnapshot = decoder.decode((await reconnectReader.read()).value);
    assert.match(reconnectSnapshot, /event: connected/);
    assert.match(reconnectSnapshot, /"handling_mode":"AI"/);
    assert.match(reconnectSnapshot, /The human-support session has ended/);
    reconnectController.abort();

    const feed = await getWebChatPublicFeed({
      externalSessionId: 'sess-123',
      integration: { tenant_id: tenantId, channel_id: 'channel-1', channel_status: 'active' },
      database: mockDb,
    });
    assert.equal(feed.handlingMode, 'AI', 'reconnect state must be read from canonical server state');
    assert.equal(mockDb.messagesStore.filter((message) => message.content === 'The human-support session has ended. You may continue with the AI assistant.').length, 1);
  } finally {
    controller.abort();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    delete app.locals.database;
  }
});

