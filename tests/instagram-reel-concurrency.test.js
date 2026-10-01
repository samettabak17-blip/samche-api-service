import test from 'node:test';
import assert from 'node:assert/strict';

import { orchestrateInstagramInboundAiResponse } from '../services/instagram-ai-orchestrator.js';

const TENANT_ID = 'b85d7e7b-d52e-4541-92e7-284a6a67024b';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';

class RaceDatabase {
  constructor() {
    this.messages = [];
    this.nextAssistantId = 1;
    this.conversation = {
      id: CONVERSATION_ID,
      tenant_id: TENANT_ID,
      channel_id: 'channel-1',
      status: 'open',
      handling_mode: 'AI',
      handling_version: 1,
      communication_language: 'tr',
      ai_behavior_override: 'AI_ONLY',
    };
  }

  async connect() {
    return this;
  }

  release() {}

  async query(sql, params = []) {
    const statement = String(sql).trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(statement)) return { rowCount: 0, rows: [] };
    if (statement.includes('FROM conversations')) return { rowCount: 1, rows: [this.conversation] };

    if (statement.includes('FROM conversation_messages')) {
      const customerMessages = this.messages.filter((message) => message.sender_type === 'CUSTOMER');
      const assistantIdempotencyKey = params[2];
      if (statement.includes("sender_type = 'ASSISTANT'") && statement.includes('idempotency_key')) {
        return {
          rowCount: this.messages.filter((message) => message.sender_type === 'ASSISTANT' && message.idempotency_key === assistantIdempotencyKey).length,
          rows: this.messages.filter((message) => message.sender_type === 'ASSISTANT' && message.idempotency_key === assistantIdempotencyKey),
        };
      }
      if (statement.includes("sender_type = 'CUSTOMER'") && statement.includes('LIMIT 1')) {
        const latestCustomer = customerMessages.at(-1);
        return { rowCount: latestCustomer ? 1 : 0, rows: latestCustomer ? [latestCustomer] : [] };
      }
      const ordered = [...this.messages].reverse();
      if (statement.includes('LIMIT 1')) return { rowCount: ordered.length ? 1 : 0, rows: ordered.slice(0, 1) };
      return { rowCount: ordered.length, rows: ordered };
    }

    if (statement.includes('INSERT INTO conversation_messages')) {
      const message = {
        id: `assistant-${this.nextAssistantId++}`,
        sender_type: 'ASSISTANT',
        content: params[2],
        idempotency_key: params[3] || null,
        created_at: new Date(Date.now() + this.nextAssistantId),
      };
      this.messages.push(message);
      return { rowCount: 1, rows: [message] };
    }

    if (statement.includes('FROM crm_leads') || statement.includes('FROM crm_consultations')) return { rowCount: 0, rows: [] };
    if (statement.includes('INSERT INTO crm_consultations')) return { rowCount: 1, rows: [{ id: 'consultation-1' }] };
    return { rowCount: 0, rows: [] };
  }
}

function inboundState(messageId, content) {
  return {
    duplicate: false,
    shouldInvokeAi: true,
    handlingVersion: 1,
    integration: {
      tenant_id: TENANT_ID,
      assistant_id: 'assistant-1',
      assistant_model: 'default',
      external_channel_id: 'page-1',
      config: { access_token: 'token-1', page_id: 'page-1', activation_policy: 'ALL_MESSAGES' },
    },
    conversation: {
      id: CONVERSATION_ID,
      status: 'open',
      handling_mode: 'AI',
      handling_version: 1,
      communication_language: 'tr',
    },
    customerMessage: { id: messageId, content },
  };
}

test('new explicit text supersedes an in-flight Reel-only response and remains deliverable', async () => {
  const database = new RaceDatabase();
  const reelText = '[Attachment: reel]';
  const explicitText = 'Oturum süreçleri hakkında bilgi almak istiyorum.';
  database.messages.push({ id: 'reel-mid', sender_type: 'CUSTOMER', content: reelText, created_at: new Date(1000) });

  let releaseReel;
  const reelStarted = new Promise((resolve) => { releaseReel = resolve; });
  let reelGenerationStarted = false;
  const providerRequests = [];
  const logs = [];
  const originalInfo = console.info;
  console.info = (...args) => logs.push(args.join(' '));

  const fakeHttp = {
    post: async () => ({ status: 200, data: { message_id: 'outbound-1', recipient_id: 'customer-1' } }),
  };

  try {
    const reelPromise = orchestrateInstagramInboundAiResponse({
      database,
      inboundState: inboundState('reel-mid', reelText),
      senderIgsid: 'customer-1',
      text: reelText,
      http: fakeHttp,
      applyPacing: false,
      generateAiResponse: async ({ text }) => {
        reelGenerationStarted = true;
        providerRequests.push({ trigger: 'REEL', text });
        await reelStarted;
        return 'Bu içerikle ilgili size nasıl yardımcı olabilirim?';
      },
    });

    while (!reelGenerationStarted) await new Promise((resolve) => setImmediate(resolve));

    database.messages.push({ id: 'text-mid', sender_type: 'CUSTOMER', content: explicitText, created_at: new Date(2000) });
    const textResult = await orchestrateInstagramInboundAiResponse({
      database,
      inboundState: inboundState('text-mid', explicitText),
      senderIgsid: 'customer-1',
      text: explicitText,
      http: fakeHttp,
      applyPacing: false,
      generateAiResponse: async ({ text }) => {
        providerRequests.push({ trigger: 'TEXT', text });
        return 'Oturum süreçleri hakkında memnuniyetle bilgi verebilirim.';
      },
    });

    releaseReel();
    const reelResult = await reelPromise;

    assert.equal(textResult.delivered, true);
    assert.equal(reelResult.delivered, false);
    assert.equal(reelResult.reason, 'STALE_SHARED_CONTENT_TURN');
    assert.deepEqual(providerRequests, [
      { trigger: 'REEL', text: reelText },
      { trigger: 'TEXT', text: explicitText },
    ]);
    assert.equal(database.messages.filter((message) => message.sender_type === 'ASSISTANT').length, 1);
    assert.match(logs.find((entry) => entry.startsWith('INSTAGRAM_AI_TURN_VALIDITY') && entry.includes('triggerType=REEL')), /newerExplicitUserMessage=true/);
    assert.match(logs.find((entry) => entry.startsWith('INSTAGRAM_AI_TURN_VALIDITY') && entry.includes('triggerType=REEL')), /responseSuppressedReason=STALE_SHARED_CONTENT_TURN/);
  } finally {
    console.info = originalInfo;
  }
});
