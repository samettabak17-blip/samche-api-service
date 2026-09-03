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
