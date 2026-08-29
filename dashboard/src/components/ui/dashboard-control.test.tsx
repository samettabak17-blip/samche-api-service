import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardButton, DashboardCheckbox, DashboardTab } from './dashboard-control';

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
    expect(screen.getByRole('link', { name: 'Inactive' }).className).not.toContain('hover:bg-white');
    expect(screen.getByRole('link', { name: 'Active' }).className).toContain('bg-signal');
    expect(screen.getByRole('link', { name: 'Active' }).className).toContain('hover:bg-signal');
    expect(screen.getByRole('link', { name: 'Active' }).className).toContain('hover:text-white');
    expect(screen.getByText('Disabled')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Disabled').className).toContain('cursor-not-allowed');
    expect(screen.getByText('Disabled').className).not.toMatch(/(?:^|\s)hover:/);
  });

  it('renders an accessible custom checkbox with distinct checked and focus states', () => {
    render(<DashboardCheckbox label="Meridian DOCX" checked onChange={() => undefined} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Meridian DOCX' });
    expect(checkbox).toBeChecked();
    expect(checkbox.className).toContain('appearance-none');
    expect(checkbox.className).toContain('checked:bg-signal');
    expect(checkbox.className).toContain('focus-visible:ring-2');
  });

  it('keeps primary, secondary and destructive hover semantics distinct', () => {
    render(<><DashboardButton variant="primary">Approve</DashboardButton><DashboardButton variant="secondary">Edit</DashboardButton><DashboardButton variant="destructive">Reject</DashboardButton></>);
    expect(screen.getByRole('button', { name: 'Approve' }).className).toContain('hover:bg-red-700');
    expect(screen.getByRole('button', { name: 'Edit' }).className).toContain('hover:bg-stone-800');
    expect(screen.getByRole('button', { name: 'Reject' }).className).toContain('hover:bg-red-900');
  });
});
