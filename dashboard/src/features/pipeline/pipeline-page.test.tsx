import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PipelineBoard } from './pipeline-page';
import type { CrmDeal, CrmPipelineStage } from '../../types/api';

const stages: CrmPipelineStage[] = [
  { id: 'stage-new', tenant_id: 'tenant-a', stage_key: 'NEW_LEAD', name: 'New Lead', position: 10 },
  { id: 'stage-won', tenant_id: 'tenant-a', stage_key: 'WON', name: 'Won', position: 50, is_terminal: true },
];
const deal: CrmDeal = { id: 'deal-a', contact_id: 'contact-a', title: 'Formation proposal', pipeline_stage_id: 'stage-new', contact_display_name: 'SamChe customer', value: 30000, currency: 'AED', probability: 70 };

describe('PipelineBoard', () => {
  it('renders persisted deal data in its actual persisted stage', () => {
    render(<MemoryRouter><PipelineBoard stages={stages} deals={[deal]} tenantId="tenant-a" canManage={false} onMove={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('Formation proposal')).toBeInTheDocument();
    expect(screen.getByText('SamChe customer')).toBeInTheDocument();
    expect(screen.getByText('30,000 AED')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /formation proposal/i })).toHaveAttribute('href', '/app/tenant-a/pipeline/deal-a');
    expect(screen.queryByLabelText(/move formation proposal/i)).not.toBeInTheDocument();
  });

  it('exposes a persisted stage change control only to CRM managers', () => {
    render(<MemoryRouter><PipelineBoard stages={stages} deals={[deal]} tenantId="tenant-a" canManage onMove={vi.fn()} /></MemoryRouter>);
    expect(screen.getByLabelText('Move Formation proposal')).toBeInTheDocument();
  });
});
