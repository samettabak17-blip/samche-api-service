import { describe, expect, it } from 'vitest';
import { liveSupportAlertTitle, liveSupportFavicon, liveSupportWaitingLabel, senderLabel, senderTone, supportsHumanReplyChannel } from './conversation-utils';

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
    expect(liveSupportFavicon(3)).toContain('LIVE%20SUPPORT');
    expect(liveSupportFavicon(3)).toContain('%3E3%3C');
  });
});
