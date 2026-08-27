import { describe, expect, it } from 'vitest';
import { canTakeOverConversation, clearSentAgentDraft, displayConversationCustomerIdentifier, isInlinePreviewableAttachment, isVoiceResource, voiceResourceDisplayLabel, resourceDisplayName, dashboardSoundMutePreferenceKey, liveSupportAlertTitle, liveSupportWaitingLabel, senderLabel, senderTone, supportsHumanReplyChannel, deliveryTickPresentation } from './conversation-utils';

describe('conversation sender presentation', () => {
  it('maps every backend sender type to a distinct safe label', () => {
    expect(senderLabel('CUSTOMER')).toBe('Customer');
    expect(senderLabel('ASSISTANT')).toBe('Assistant');
    expect(senderLabel('AGENT')).toBe('Agent');
    expect(senderLabel('SYSTEM')).toBe('System');
  });

  it('permits the human composer for the two tenant-safe delivery channels', () => {
    expect(supportsHumanReplyChannel('SAMCHEGUIDE')).toBe(true);
    expect(supportsHumanReplyChannel('WHATSAPP')).toBe(true);
    expect(supportsHumanReplyChannel('EMAIL')).toBe(false);
  });

  it('uses a neutral presentation for an unrecognised value', () => {
    expect(senderLabel('UNKNOWN')).toBe('Unknown sender');
    expect(senderTone('UNKNOWN')).toContain('stone');
  });
});


describe('live-support attention presentation', () => {
  it('uses professional waiting labels and a clear browser-title alert', () => {
    expect(liveSupportWaitingLabel(1)).toBe('1 CUSTOMER WAITING');
    expect(liveSupportWaitingLabel(2)).toBe('2 CUSTOMERS WAITING');
    expect(liveSupportAlertTitle(1)).toBe('(1) LIVE SUPPORT — SamChe Dashboard');
    expect(liveSupportAlertTitle(0)).toBe('SamChe Dashboard');
    expect(dashboardSoundMutePreferenceKey('operator-a')).not.toBe(dashboardSoundMutePreferenceKey('operator-b'));
    expect(dashboardSoundMutePreferenceKey('operator-a')).toBe('samche.dashboard.live-support.muted:operator-a');
  });
});


describe('agent composer draft handling', () => {
  it('clears only the draft confirmed by successful delivery', () => {
    expect(clearSentAgentDraft('Hello', 'Hello')).toBe('');
    expect(clearSentAgentDraft('New draft', 'Hello')).toBe('New draft');
  });
});


describe('inline attachment preview helpers', () => {
  it('renders only images and PDFs inside the Live Inbox overlay', () => {
    expect(isInlinePreviewableAttachment('image/jpeg')).toBe(true);
    expect(isInlinePreviewableAttachment('application/pdf')).toBe(true);
    expect(isInlinePreviewableAttachment('application/msword')).toBe(false);
  });
});


describe('customer-requested live-support ownership', () => {
  it('exposes Take Over for an unassigned HUMAN conversation that is still REQUESTED', () => {
    const allowed = { status: 'open', assignedAgentUserId: null, operatorAllowed: true };
    expect(canTakeOverConversation({ ...allowed, handlingMode: 'HUMAN', humanAttentionState: 'REQUESTED' })).toBe(true);
    expect(canTakeOverConversation({ ...allowed, handlingMode: 'HUMAN', humanAttentionState: 'ACKNOWLEDGED' })).toBe(false);
    expect(canTakeOverConversation({ ...allowed, handlingMode: 'HUMAN', humanAttentionState: 'NONE' })).toBe(false);
    expect(canTakeOverConversation({ ...allowed, handlingMode: 'AI', humanAttentionState: 'NONE' })).toBe(true);
  });
});


describe('customer identifier presentation', () => {
  it('does not expose internal WhatsApp or Guide prefixes as the primary identity', () => {
    expect(displayConversationCustomerIdentifier('whatsapp:971501234567')).toBe('+971501234567');
    expect(displayConversationCustomerIdentifier('samcheguide:opaque-session')).toBe('Guide conversation');
  });
});


describe('WhatsApp voice-resource presentation', () => {
  it('routes audio resources to a compact player and never exposes a provider filename', () => {
    expect(isVoiceResource({ media_category: 'AUDIO', mime_type: 'audio/ogg' })).toBe(true);
    expect(isVoiceResource({ media_category: 'DOCUMENT', mime_type: 'application/pdf' })).toBe(false);
    expect(voiceResourceDisplayLabel({ original_filename: 'whatsapp-voice-wamid.HBgMOT...ogg', mime_type: 'audio/ogg' })).toBe('Voice message');
  });
});


describe('canonical resource display names', () => {
  it('never exposes generated provider identifiers as attachment names', () => {
    expect(resourceDisplayName({ original_filename: 'whatsapp-image-wamid.HBgMOTcxNTAxNzkzODgwFQIAEhgUM0FBM0...jpg', mime_type: 'image/jpeg' })).toBe('Image.jpg');
    expect(resourceDisplayName({ original_filename: 'resource-8d765634-0b91-41d8-b4e9-0914c5e973ea', mime_type: 'application/pdf' })).toBe('Document.pdf');
  });
  it('retains a genuine uploaded filename and uses clean type fallbacks only when necessary', () => {
    expect(resourceDisplayName({ original_filename: 'Business setup.pdf', mime_type: 'application/pdf' })).toBe('Business setup.pdf');
    expect(resourceDisplayName({ original_filename: null, mime_type: 'image/png' })).toBe('Image.png');
    expect(resourceDisplayName({ original_filename: null, mime_type: 'audio/ogg' })).toBe('Voice message');
  });
});


describe('WhatsApp delivery ticks', () => {
  it('shows a single tick only after provider acceptance and double ticks only after persisted delivery state', () => {
    expect(deliveryTickPresentation('SENT')).toMatchObject({ glyph: '✓', label: 'Sent' });
    expect(deliveryTickPresentation('DELIVERED')).toMatchObject({ glyph: '✓✓', label: 'Delivered' });
    expect(deliveryTickPresentation('READ')).toMatchObject({ glyph: '✓✓', label: 'Read' });
    expect(deliveryTickPresentation('SENDING')).toMatchObject({ glyph: '◌', label: 'Sending' });
    expect(deliveryTickPresentation(undefined)).toBeNull();
  });
});
