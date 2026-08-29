import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardButton, DashboardTab } from './dashboard-control';

afterEach(cleanup);

describe('Dashboard controls', () => {
  it('uses shared semantic button states', () => {
    render(<><DashboardButton variant="primary">Generate</DashboardButton><DashboardButton variant="secondary">Preview</DashboardButton><DashboardButton variant="destructive">Archive</DashboardButton><DashboardButton disabled>Disabled</DashboardButton></>);
    expect(screen.getByRole('button', { name: 'Generate' }).className).toContain('bg-signal');
    expect(screen.getByRole('button', { name: 'Preview' }).className).toContain('bg-elevated');
    expect(screen.getByRole('button', { name: 'Archive' }).className).toContain('border-red');
    expect(screen.getByRole('button', { name: 'Disabled' }).className).toContain('disabled:cursor-not-allowed');
    expect(screen.getByRole('button', { name: 'Disabled' }).className).toContain('disabled:bg-stone-900');
  });

  it('distinguishes inactive, active, and disabled tabs', () => {
    render(<MemoryRouter><DashboardTab to="/one">Inactive</DashboardTab><DashboardTab to="/two" active>Active</DashboardTab><DashboardTab to="/three" disabled>Disabled</DashboardTab></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Inactive' }).className).toContain('bg-elevated');
    expect(screen.getByRole('link', { name: 'Active' }).className).toContain('bg-signal');
    expect(screen.getByText('Disabled')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Disabled').className).toContain('cursor-not-allowed');
  });
});
