import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { OverviewSummary } from './overview-page';

afterEach(cleanup);

describe('OverviewSummary', () => {
  it('presents recent conversations without claiming a paginated list is a total', () => {
    render(<MemoryRouter><OverviewSummary assistantCount={2} channelCount={3} documentCount={4} teamCount={5} recentConversations={[]} /></MemoryRouter>);
    expect(screen.queryByText('Total conversations')).toBeNull();
  });
  it('keeps the overview data-led while providing the primary operational entry points', () => {
    render(<MemoryRouter><OverviewSummary assistantCount={2} channelCount={3} documentCount={4} teamCount={5} recentConversations={[]} tenantId="tenant-1" /></MemoryRouter>);
    expect(screen.getByText('AI operations at a glance')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open conversations/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open pipeline/i })).toBeTruthy();
    expect(screen.queryByText('98.6%')).toBeNull();
  });
});
