import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TeamTable } from './team-page';

describe('TeamTable', () => {
  it('renders backend roles without user-management actions', () => {
    render(<TeamTable members={[{ id: 'member-1', email: 'agent@example.test', system_role: 'CUSTOMER', tenant_role: 'AGENT', created_at: '2026-08-22T02:55:30.000Z' }]} />);

    expect(screen.getByText('agent@example.test')).toBeTruthy();
    expect(screen.getByText('AGENT')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add|delete|remove/i })).toBeNull();
  });
});

