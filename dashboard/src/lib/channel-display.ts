import type { Assistant, ConversationChannelType, TenantChannel } from '../types/api';

const productNames: Record<ConversationChannelType, string> = {
  WHATSAPP: 'WhatsApp Chatbot',
  WEB_CHAT: 'Web Chatbot',
  SAMCHEGUIDE: 'AI Guide',
};

const legacyDefaultNames = new Set(['samche ai', 'samcheguide runtime', 'samche bot', 'samche assistant']);

export function channelProductName(channelType: ConversationChannelType) {
  return productNames[channelType];
}

export function connectedChannelNames(assistantId: string, channels: TenantChannel[]) {
  return [...new Set(channels
    .filter((channel) => channel.assistant_id === assistantId && channel.status === 'active')
    .map((channel) => channelProductName(channel.channel_type)))];
}

export function assistantDisplayLabel(assistant: Assistant, channels: TenantChannel[]) {
  const products = connectedChannelNames(assistant.id, channels);
  if (!products.length) return assistant.name;
  const productLabel = products.join(' • ');
  return legacyDefaultNames.has(assistant.name.trim().toLocaleLowerCase('en-US'))
    ? productLabel
    : `${assistant.name} — ${productLabel}`;
}

export function assistantActivityLabel(assistant: { name: string; channel_types: ConversationChannelType[] }) {
  const products = [...new Set(assistant.channel_types.map(channelProductName))];
  if (!products.length) return assistant.name;
  const productLabel = products.join(' • ');
  return legacyDefaultNames.has(assistant.name.trim().toLocaleLowerCase('en-US')) ? productLabel : `${assistant.name} — ${productLabel}`;
}
