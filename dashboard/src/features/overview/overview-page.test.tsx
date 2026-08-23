import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OverviewSummary } from './overview-page';

describe('OverviewSummary', () => {
  it('presents recent conversations without claiming a paginated list is a total', () => {
    render(<OverviewSummary assistantCount={2} channelCount={3} documentCount={4} teamCount={5} recentConversations={[]} />);
    expect(screen.getByText('Recent conversations')).toBeTruthy();
    expect(screen.queryByText('Total conversations')).toBeNull();
  });

  it('renders only supplied persisted CRM metrics and pipeline aggregation', () => {
    render(<OverviewSummary assistantCount={0} channelCount={0} documentCount={0} teamCount={0} recentConversations={[]} crmMetrics={{ total_contacts: 4, open_deals: 2, pipeline_value: '1200', won_deals: 1, won_revenue: '500' }} pipelineSummary={[{ id: 'stage-a', tenant_id: 'tenant-a', stage_key: 'NEW_LEAD', name: 'New Lead', position: 10, deal_count: 2, total_value: '1200' }]} />);
    expect(screen.getByText('CRM overview')).toBeInTheDocument();
    expect(screen.getByText('Total contacts')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('New Lead')).toBeInTheDocument();
  });
});
