import { describe, expect, it } from 'vitest';
import { senderLabel, senderTone, supportsHumanReplyChannel } from './conversation-utils';

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

