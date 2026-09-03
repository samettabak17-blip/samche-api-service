const CAPABILITIES = Object.freeze({
  WEB: Object.freeze({ supports_typing_indicator: true, supports_streaming_display: true, supports_progressive_chunks: true, supports_structured_cards: true, supports_message_update: true }),
  WHATSAPP: Object.freeze({ supports_typing_indicator: true, supports_streaming_display: false, supports_progressive_chunks: true, supports_structured_cards: false, supports_message_update: false }),
});

export function channelPresentationCapabilities(channel) {
  return CAPABILITIES[channel] ?? Object.freeze({ supports_typing_indicator: false, supports_streaming_display: false, supports_progressive_chunks: false, supports_structured_cards: false, supports_message_update: false });
}

// Provider adapters emit SamChe canonical events. Channel adapters use this
// policy to decide their presentation without importing provider semantics.
export function selectConversationPresentation({ channel, providerStreams }) {
  const capabilities = channelPresentationCapabilities(channel);
  return {
    show_thinking: capabilities.supports_typing_indicator,
    delivery: capabilities.supports_streaming_display && providerStreams
      ? 'STREAM'
      : capabilities.supports_progressive_chunks
        ? 'PROGRESSIVE_CHUNKS'
        : 'COMPLETE',
    supports_structured_cards: capabilities.supports_structured_cards,
  };
}

const WEB_TIMING = Object.freeze({ progressive_display: true, chunk_words: 5, base_delay_ms: 92, sentence_pause_ms: 260, section_pause_ms: 360, thinking_minimum_ms: 420 });
const MESSAGE_TIMING = Object.freeze({ progressive_display: false, chunk_words: 0, base_delay_ms: 0, sentence_pause_ms: 0, section_pause_ms: 0, thinking_minimum_ms: 0 });

export function conversationPresentationTiming(channel) {
  return channelPresentationCapabilities(channel).supports_streaming_display ? WEB_TIMING : MESSAGE_TIMING;
}
