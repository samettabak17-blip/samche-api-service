import type { ConversationChannelType } from '../../types/api';

export const conversationCapabilities = [
  { key: 'documents', label: 'Document Reading' },
  { key: 'voice', label: 'Voice Messages' },
  { key: 'media', label: 'Images & Media' },
] as const;

export const conversationOverflowActions = ['Pause AI', 'Close conversation'] as const;
export const conversationListLoadMoreLabel = 'Load more conversations';

export type ConversationCapabilityKey = (typeof conversationCapabilities)[number]['key'];

export function workspaceVisualIdentity(channelType: ConversationChannelType | 'ALL') {
  if (channelType === 'WHATSAPP') {
    return { shell: 'whatsapp', outgoing: 'bg-[#087b4d] border-emerald-300/20 text-white', canvas: 'bg-[#071b18]' };
  }
  if (channelType === 'INSTAGRAM') {
    return { shell: 'instagram', outgoing: 'bg-gradient-to-br from-[#7928ca] to-[#ff0080] border-pink-400/40 text-white', canvas: 'bg-[#120d1c]' };
  }
  return { shell: 'samche', outgoing: 'bg-gradient-to-br from-[#5f1822] to-[#2b1017] border-red-400/45 text-white', canvas: 'bg-[#0a111b]' };
}

