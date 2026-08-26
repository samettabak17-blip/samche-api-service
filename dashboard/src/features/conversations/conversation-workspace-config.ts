export const conversationCapabilities = [
  { key: 'documents', label: 'Document Reading' },
  { key: 'voice', label: 'Voice Messages' },
  { key: 'media', label: 'Images & Media' },
] as const;

export const conversationOverflowActions = ['Pause AI', 'Close conversation'] as const;
export const conversationListLoadMoreLabel = 'Load more conversations';

export type ConversationCapabilityKey = (typeof conversationCapabilities)[number]['key'];

export function workspaceVisualIdentity(channelType: 'WHATSAPP' | 'WEB_CHAT' | 'SAMCHEGUIDE') {
  return channelType === 'WHATSAPP'
    ? { shell: 'whatsapp', outgoing: 'bg-[#087b4d] border-emerald-300/20 text-white', canvas: 'bg-[#071b18]' }
    : { shell: 'samche', outgoing: 'bg-gradient-to-br from-[#5f1822] to-[#2b1017] border-red-400/45 text-white', canvas: 'bg-[#0a111b]' };
}
