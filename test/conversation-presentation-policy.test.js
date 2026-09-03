import assert from 'node:assert/strict';
import test from 'node:test';
import { channelPresentationCapabilities, conversationPresentationTiming, selectConversationPresentation } from '../services/conversation-presentation-policy.js';

test('SamChe presentation policy keeps canonical provider events separate from channel capabilities', () => {
  assert.deepEqual(channelPresentationCapabilities('WEB'), {
    supports_typing_indicator: true,
    supports_streaming_display: true,
    supports_progressive_chunks: true,
    supports_structured_cards: true,
    supports_message_update: true,
  });
  assert.equal(selectConversationPresentation({ channel: 'WEB', providerStreams: true }).delivery, 'STREAM');
  assert.equal(selectConversationPresentation({ channel: 'WEB', providerStreams: false }).delivery, 'PROGRESSIVE_CHUNKS');
  assert.equal(selectConversationPresentation({ channel: 'WHATSAPP', providerStreams: true }).delivery, 'PROGRESSIVE_CHUNKS');
});

test('web progressive presentation uses readable chunk timing rather than provider token speed', () => {
  const timing = conversationPresentationTiming('WEB');
  assert.ok(timing.chunk_words >= 3);
  assert.ok(timing.base_delay_ms >= 70);
  assert.ok(timing.sentence_pause_ms > timing.base_delay_ms);
  assert.equal(conversationPresentationTiming('WHATSAPP').progressive_display, false);
});
