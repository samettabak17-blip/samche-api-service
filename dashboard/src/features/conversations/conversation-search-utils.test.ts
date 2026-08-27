import { describe, expect, it } from 'vitest';
import { findSearchTokenRanges, messageMatchesSearch, nextSearchMatchIndex, normalizeSearchTokens } from './conversation-search-utils';

describe('conversation search matching', () => {
  it('matches every whitespace-separated token without losing Turkish or Arabic text', () => {
    expect(normalizeSearchTokens('  Merhaba   İstanbul  مرحبا  ')).toEqual(['merhaba', 'istanbul', 'مرحبا']);
    expect(messageMatchesSearch({ content: 'Merhaba İstanbul مرحبا', resourceNames: [] }, ['merhaba', 'istanbul', 'مرحبا'])).toBe(true);
  });

  it('finds each typed word for safe inline highlighting', () => {
    expect(findSearchTokenRanges('Merhaba dünya, merhaba!', ['merhaba', 'dünya'])).toEqual([
      { start: 0, end: 7 }, { start: 8, end: 13 }, { start: 15, end: 22 },
    ]);
  });

  it('requires all tokens when searching a current conversation', () => {
    expect(messageMatchesSearch({ content: 'Merhaba dünya', resourceNames: ['proposal.pdf'] }, ['merhaba', 'invoice'])).toBe(false);
  });

  it('wraps current-conversation navigation in either direction', () => {
    expect(nextSearchMatchIndex(1, 3, 'next')).toBe(2);
    expect(nextSearchMatchIndex(2, 3, 'next')).toBe(0);
    expect(nextSearchMatchIndex(0, 3, 'previous')).toBe(2);
  });
});