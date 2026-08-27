import { describe, expect, it } from 'vitest';
import { shouldShowConversationWorkspaceSkeleton } from './conversation-list-search-state';

describe('conversation-list search loading', () => {
  it('keeps the active workspace mounted while a scoped search is loading', () => {
    expect(shouldShowConversationWorkspaceSkeleton({ isLoading: true, hasData: false, search: 'merh' })).toBe(false);
  });

  it('uses the full workspace skeleton only for the initial unfiltered inbox load', () => {
    expect(shouldShowConversationWorkspaceSkeleton({ isLoading: true, hasData: false, search: '' })).toBe(true);
  });
});
