import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardButton, DashboardCheckbox, DashboardFileInput, DashboardFormMessage, DashboardInput, DashboardPasswordInput, DashboardSelect, DashboardTab, DashboardField, DashboardTextarea } from './dashboard-control';

afterEach(cleanup);

describe('Dashboard controls', () => {
  it('provides shared readable field primitives with helper and error states', () => {
    render(<><DashboardField label="Email" helper="Use your work email."><DashboardInput aria-label="Email" placeholder="you@example.com" /></DashboardField><DashboardField label="Name" error="Name is required."><DashboardInput aria-label="Name" /></DashboardField></>);
    expect(screen.getByText('Email')).toHaveClass('dashboard-field-label');
    expect(screen.getByPlaceholderText('you@example.com')).toHaveClass('dashboard-input');
    expect(screen.getByText('Use your work email.')).toHaveClass('dashboard-helper');
    expect(screen.getByRole('alert')).toHaveClass('dashboard-error');
  });

  it('keeps password visibility toggle accessible without clearing the field', () => {
    render(<DashboardPasswordInput aria-label="Password" value="secret123" onChange={() => undefined} />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Password')).toHaveValue('secret123');
  });

  it('uses the shared select primitive', () => {
    render(<DashboardSelect aria-label="Tenant"><option>Company</option></DashboardSelect>);
    expect(screen.getByLabelText('Tenant')).toHaveClass('dashboard-select');
  });

  it('provides a shared textarea with the same readable form contract', () => {
    render(<DashboardField label="Notes"><DashboardTextarea aria-label="Notes" /></DashboardField>);
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveClass('dashboard-input', 'w-full');
  });

  it('preserves focused input while its controlled value rerenders', () => {
    function Form() {
      const [value, setValue] = useState('');
      return <DashboardInput aria-label="First name" value={value} onChange={(event) => setValue(event.target.value)} />;
    }
    render(<Form />);
    const input = screen.getByLabelText('First name');
    input.focus();
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.change(input, { target: { value: 'Alex' } });
    expect(document.activeElement).toBe(input);
  });
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

  it('keeps outline and disabled actions legible on the dark theme', () => {
    render(<><DashboardButton variant="outline">Upgrade Plan</DashboardButton><DashboardButton disabled>Generating</DashboardButton></>);
    const upgrade = screen.getByRole('button', { name: 'Upgrade Plan' });
    const disabled = screen.getByRole('button', { name: 'Generating' });
    expect(upgrade.className).toContain('border-signal');
    expect(upgrade.className).toContain('hover:bg-signal/20');
    expect(upgrade.className).not.toContain('hover:bg-white');
    expect(disabled.className).toContain('disabled:text-stone-300');
    expect(disabled.className).toContain('disabled:opacity-100');
  });

  it('hides browser-localized file chrome and renders controlled English copy', () => {
    render(<DashboardFileInput aria-label="Source document" accept=".pdf,.docx,.txt" formatHint="PDF, DOCX or TXT" />);
    expect(screen.getByRole('button', { name: 'Choose File' })).toBeVisible();
    expect(screen.getByText('No file selected')).toBeVisible();
    expect(screen.getByText('PDF, DOCX or TXT')).toBeVisible();
    expect(screen.getByLabelText('Source document')).toHaveClass('sr-only');
    expect(screen.queryByText('Dosya Seç')).not.toBeInTheDocument();
    expect(screen.queryByText('Seçilen dosya yok')).not.toBeInTheDocument();
  });

  it('shows the selected filename unchanged and controls disabled styling', () => {
    const { rerender } = render(<DashboardFileInput aria-label="Source document" />);
    const input = screen.getByLabelText('Source document');
    const file = new File(['tenant content'], 'müşteri-belgesi.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText('müşteri-belgesi.pdf')).toBeVisible();
    rerender(<DashboardFileInput aria-label="Source document" disabled />);
    const button = screen.getByRole('button', { name: 'Choose File' });
    expect(button).toBeDisabled();
    expect(button.className).toContain('cursor-not-allowed');
  });
});
