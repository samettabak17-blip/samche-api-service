import test from 'node:test';
import assert from 'node:assert/strict';

import { parseInstagramMessagingEvent } from '../services/instagram-inbound-adapter.js';
import { buildInstagramAttachmentResourceMetadata } from '../services/instagram-live-inbox-service.js';
import {
  buildInstagramSharedContentContext,
  generateContextualConversationalFallback,
} from '../services/instagram-ai-orchestrator.js';
import { createSharedAiRuntime } from '../services/shared-ai-provider-resilience.js';

test('normalizes Reel metadata without treating media as a factual source', () => {
  const parsed = parseInstagramMessagingEvent(
    { id: 'page-1', time: 1700000000000 },
    {
      sender: { id: 'customer-1' },
      recipient: { id: 'page-1' },
      timestamp: 1700000000000,
      message: {
        mid: 'mid-reel-1',
        attachments: [{
          type: 'ig_reel',
          payload: {
            url: 'https://example.test/reel/1',
            type: 'reel',
            id: 'reel-1',
            caption: 'Sponsorlu oturum hakkında bilgi',
            permalink_url: 'https://example.test/reel/1',
          },
        }],
      },
      referral: {
        source: 'SHARED_POST',
        ref: 'reel-ref-1',
        text: 'Sponsorlu oturum',
      },
    },
  );

  assert.equal(parsed.attachments[0].type, 'reel');
  assert.deepEqual(parsed.attachments[0].sharedContent, {
    type: 'REEL',
    id: 'reel-1',
    caption: 'Sponsorlu oturum hakkında bilgi',
    description: null,
    referralText: 'Sponsorlu oturum',
    source: 'SHARED_POST',
    permalink: 'https://example.test/reel/1',
  });
  assert.deepEqual(buildInstagramAttachmentResourceMetadata(parsed.attachments[0]), {
    provider: 'INSTAGRAM',
    attachment_type: 'reel',
    shared_content: {
      type: 'REEL',
      id: 'reel-1',
      caption: 'Sponsorlu oturum hakkında bilgi',
      description: null,
      referral_text: 'Sponsorlu oturum',
      source: 'SHARED_POST',
      permalink: 'https://example.test/reel/1',
    },
  });
});

test('shared Reel metadata becomes bounded conversation context and explicit text remains primary', () => {
  const context = buildInstagramSharedContentContext([
    {
      sender_type: 'CUSTOMER',
      content: '[Attachment: reel]',
      resources: [{
        metadata: {
          provider: 'INSTAGRAM',
          attachment_type: 'reel',
          shared_content: {
            type: 'REEL',
            id: 'reel-1',
            caption: 'Sponsorlu oturum hakkında bilgi',
            referral_text: 'Sponsorlu oturum',
            source: 'SHARED_POST',
          },
        },
      }],
    },
  ]);

  assert.equal(context.present, true);
  assert.equal(context.topicContextPresent, true);
  assert.match(context.instruction, /SHARED CONTENT CONTEXT/);
  assert.match(context.instruction, /Sponsorlu oturum hakkında bilgi/);
  assert.match(context.instruction, /CURRENT USER TEXT ALWAYS OVERRIDES/);
  assert.doesNotMatch(context.instruction, /video.*izledim|gördüm|gördüğüm/i);
});

test('Reel-only fallback uses trusted topic metadata, while missing metadata remains generic', () => {
  const withMetadata = generateContextualConversationalFallback({
    text: '[Attachment: reel]',
    memory: {
      sharedContentContext: {
        present: true,
        topicContextPresent: true,
        topicText: 'Sponsorlu oturum hakkında bilgi',
      },
    },
  });
  const withoutMetadata = generateContextualConversationalFallback({
    text: '[Attachment: reel]',
    memory: { sharedContentContext: { present: true, topicContextPresent: false } },
  });

  assert.notEqual(withMetadata, 'Bu içerikle ilgili size nasıl yardımcı olabilirim?');
  assert.match(withMetadata, /Sponsorlu oturum hakkında bilgi/);
  assert.equal(withoutMetadata, 'Bu içerikle ilgili size nasıl yardımcı olabilirim?');
});

test('Vertex failover preserves current user text and Reel metadata context', async () => {
  const calls = [];
  const systemInstruction = 'CURRENT USER TEXT ALWAYS OVERRIDES shared-content metadata\nCaption: Sponsorlu oturum';
  const runtime = createSharedAiRuntime({
    geminiProvider: {
      generateContent: async (request) => {
        calls.push({ provider: 'vertex', request });
        throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
      },
    },
    openaiClient: {
      chat: { completions: { create: async (request) => {
        calls.push({ provider: 'openai', request });
        return { choices: [{ message: { content: 'Oturum süreçleri hakkında bilgi verebilirim.' } }] };
      } } },
    },
    circuitBreaker: { getState: () => 'CLOSED', recordFailure: () => {}, recordSuccess: () => {} },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });

  const result = await runtime.generateAiResponse({
    systemInstruction,
    text: 'Oturum süreçleri hakkında bilgi almak istiyorum',
    conversationHistory: [{ role: 'user', content: '[Attachment: reel]' }],
    channel: 'INSTAGRAM',
  });

  assert.equal(result.provider, 'openai');
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[0].request), /Oturum süreçleri hakkında bilgi almak istiyorum/);
  assert.match(JSON.stringify(calls[0].request), /Sponsorlu oturum/);
  assert.match(JSON.stringify(calls[1].request), /Oturum süreçleri hakkında bilgi almak istiyorum/);
  assert.match(JSON.stringify(calls[1].request), /Sponsorlu oturum/);
});
