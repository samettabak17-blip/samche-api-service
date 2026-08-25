export function senderLabel(senderType: string): string {
  return ({ CUSTOMER: 'Customer', ASSISTANT: 'Assistant', AGENT: 'Agent', SYSTEM: 'System' } as Record<string, string>)[senderType] ?? 'Unknown sender';
}

export function senderTone(senderType: string): string {
  return ({ CUSTOMER: 'bg-stone-100 border-stone-200 text-ink', ASSISTANT: 'bg-signal-soft border-signal/20 text-ink', AGENT: 'bg-gold/10 border-gold/30 text-ink', SYSTEM: 'bg-stone-100 border-stone-200 text-stone-700' } as Record<string, string>)[senderType] ?? 'bg-stone-100 border-stone-200 text-stone-700';
}

export function supportsHumanReplyChannel(channelType?: string): boolean {
  return channelType === 'SAMCHEGUIDE' || channelType === 'WHATSAPP';
}

export function canUseHumanReplyComposer(channelType?: string, humanDeliveryConfigured?: boolean): boolean {
  return supportsHumanReplyChannel(channelType) && humanDeliveryConfigured === true;
}

export function liveSupportWaitingLabel(requestedCount: number): string {
  return requestedCount === 1 ? '1 CUSTOMER WAITING' : requestedCount + ' CUSTOMERS WAITING';
}

export function liveSupportAlertTitle(requestedCount: number): string {
  return requestedCount > 0 ? '(' + requestedCount + ') LIVE SUPPORT — SamChe Dashboard' : 'SamChe Dashboard';
}

export function dashboardSoundMutePreferenceKey(userId?: string): string {
  return 'samche.dashboard.live-support.muted:' + (userId || 'anonymous');
}

export function clearSentAgentDraft(currentDraft: string, deliveredDraft: string): string {
  return currentDraft === deliveredDraft ? '' : currentDraft;
}
