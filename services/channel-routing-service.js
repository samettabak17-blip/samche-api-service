export const SUPPORTED_CHANNEL_TYPES = Object.freeze([
  'WHATSAPP',
  'WEB_CHAT',
  'SAMCHEGUIDE',
  'INSTAGRAM',
]);

export const CHANNEL_ROUTE_SEGMENTS = Object.freeze({
  WHATSAPP: 'whatsapp',
  WEB_CHAT: 'web-chat',
  SAMCHEGUIDE: 'guide',
  INSTAGRAM: 'instagram',
});

export function normalizeChannelType(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return SUPPORTED_CHANNEL_TYPES.includes(normalized) ? normalized : null;
}

export function isValidChannelType(value) {
  return normalizeChannelType(value) !== null;
}

export function resolveChannelDashboardRoute(channelType) {
  const normalized = normalizeChannelType(channelType);
  if (!normalized) return 'whatsapp';
  return CHANNEL_ROUTE_SEGMENTS[normalized] ?? 'whatsapp';
}
