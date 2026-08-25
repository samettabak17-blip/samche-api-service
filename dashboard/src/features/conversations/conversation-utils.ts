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

export function liveSupportFavicon(requestedCount: number): string {
  const count = String(Math.max(0, requestedCount));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#151817"/><path d="M27 30h74v40c0 20-16 32-37 32S27 90 27 70V30Z" fill="#c69a4b"/><text x="64" y="62" fill="#151817" font-family="Arial,sans-serif" font-size="27" font-weight="800" text-anchor="middle">SC</text><rect x="4" y="4" width="120" height="30" rx="12" fill="#b91c1c"/><text x="64" y="24" fill="white" font-family="Arial,sans-serif" font-size="14" font-weight="800" text-anchor="middle">LIVE SUPPORT</text><circle cx="106" cy="106" r="22" fill="#dc2626" stroke="white" stroke-width="4"/><text x="106" y="114" fill="white" font-family="Arial,sans-serif" font-size="23" font-weight="800" text-anchor="middle">' + count + '</text></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
