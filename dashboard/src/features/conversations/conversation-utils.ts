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


export function isInlinePreviewableAttachment(mimeType?: string | null): boolean {
  return String(mimeType ?? '').startsWith('image/') || String(mimeType ?? '') === 'application/pdf';
}

export function canTakeOverConversation({
  status,
  handlingMode,
  assignedAgentUserId,
  humanAttentionState,
  operatorAllowed,
}: {
  status?: string;
  handlingMode?: string;
  assignedAgentUserId?: string | null;
  humanAttentionState?: string | null;
  operatorAllowed: boolean;
}): boolean {
  if (!operatorAllowed || status !== 'open' || assignedAgentUserId) return false;
  // A customer-requested handoff is already HUMAN to suppress AI, but remains
  // deliberately unassigned until an operator takes ownership.
  return handlingMode === 'AI' || (handlingMode === 'HUMAN' && humanAttentionState === 'REQUESTED');
}

export function displayConversationCustomerIdentifier(value?: string | null): string {
  if (!value) return 'Customer conversation';
  if (value.startsWith('whatsapp:')) return '+' + value.slice('whatsapp:'.length);
  if (value.startsWith('samcheguide:')) return 'Guide conversation';
  return value;
}


export function isVoiceResource(resource: { media_category?: string | null; mime_type?: string | null }): boolean {
  return resource.media_category === 'AUDIO' || String(resource.mime_type ?? '').startsWith('audio/');
}

const technicalResourceName = /^(?:whatsapp-(?:image|audio|document|video)-|resource-|upload-|blob-)|\bwamid\.|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

function extensionForMime(mimeType?: string | null): string {
  const mime = String(mimeType ?? '').toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'xlsx';
  if (mime.includes('wordprocessingml')) return 'docx';
  if (mime.startsWith('image/')) return mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1] || 'jpg';
  if (mime.startsWith('video/')) return mime.split('/')[1] || 'mp4';
  return '';
}

export function resourceDisplayName(resource: { original_filename?: string | null; mime_type?: string | null; media_category?: string | null }): string {
  if (isVoiceResource(resource)) return 'Voice message';
  const original = String(resource.original_filename ?? '').trim();
  if (original && !technicalResourceName.test(original)) return original;
  const extension = extensionForMime(resource.mime_type);
  if (String(resource.mime_type ?? '').startsWith('image/')) return `Image${extension ? '.' + extension : ''}`;
  if (String(resource.mime_type ?? '').startsWith('video/')) return `Video${extension ? '.' + extension : ''}`;
  return `Document${extension ? '.' + extension : ''}`;
}

export function voiceResourceDisplayLabel(resource: { original_filename?: string | null; mime_type?: string | null }): string {
  return resourceDisplayName(resource);
}
