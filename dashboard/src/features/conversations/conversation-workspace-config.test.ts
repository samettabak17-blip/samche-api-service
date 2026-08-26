import { describe, expect, it } from 'vitest';
import { conversationCapabilities, conversationOverflowActions } from './conversation-workspace-config';

describe('conversation workspace control hierarchy', () => {
  it('keeps the capability strip restricted to the three approved conversation resources', () => {
    expect(conversationCapabilities.map((item) => item.label)).toEqual(['Document Reading', 'Voice Messages', 'Images & Media']);
  });

  it('keeps Pause AI and Close out of the primary capability strip', () => {
    expect(conversationOverflowActions).toEqual(['Pause AI', 'Close conversation']);
    expect(conversationCapabilities.map((item) => item.label)).not.toContain('Take Over');
  });
});
