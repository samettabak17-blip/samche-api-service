import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OverviewSummary } from './overview-page';

describe('OverviewSummary', () => {
  it('presents recent conversations without claiming a paginated list is a total', () => {
    render(<OverviewSummary assistantCount={2} channelCount={3} documentCount={4} teamCount={5} recentConversations={[]} />);

    expect(screen.getByText('Recent conversations')).toBeTruthy();
    expect(screen.queryByText('Total conversations')).toBeNull();
  });
});

