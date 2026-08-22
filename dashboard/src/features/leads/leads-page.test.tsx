import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LeadDetailPanel, LeadTable } from './leads-page';
import type { CrmLead } from '../../types/api';

const lead: CrmLead = { id: 'lead-a', tenant_id: 'tenant-a', contact_id: 'contact-a', lead_score: 78, temperature: 'HOT', pipeline_stage_id: 'stage-a', source_channel: 'SAMCHEGUIDE', display_name: null, email: null, phone: null, intent: null, service_interest: null, latest_analysis: null, deals: [], activities: [] };

describe('CRM leads presentation', () => {
  it('renders persisted lead data and honest unknown values', () => {
    render(<MemoryRouter><LeadTable leads={[lead]} tenantId="tenant-a" /><LeadDetailPanel lead={lead} tenantId="tenant-a" canManage={false} /></MemoryRouter>);
    expect(screen.getAllByText('HOT').length).toBeGreaterThan(0);
    expect(screen.getAllByText('78').length).toBeGreaterThan(0);
    expect(screen.getByText('Samcheguide')).toBeInTheDocument();
    expect(screen.getAllByText('Not provided').length).toBeGreaterThan(0);
  });
  it('does not render mutation controls for a read-only agent', () => {
    render(<MemoryRouter><LeadDetailPanel lead={{ ...lead, conversation_id: 'conversation-a' }} tenantId="tenant-a" canManage={false} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /assign|change stage|rescore/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open conversation/i })).toHaveAttribute('href', '/app/tenant-a/conversations/conversation-a');
  });
});
