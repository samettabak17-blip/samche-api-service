import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './login-page';
import { AcceptInvitationPage } from './accept-invitation-page';
import { useAuth } from './auth-context';
import { onboardingApi } from '../dashboard/dashboard-api';

vi.mock('./auth-context', () => ({ useAuth: vi.fn() }));
vi.mock('../dashboard/dashboard-api', () => ({
  onboardingApi: { validateInvitation: vi.fn(), acceptInvitation: vi.fn() },
}));

afterEach(cleanup);

describe('Auth visual content contracts', () => {
  it('keeps the compact login form followed by the six reference capability cards', () => {
    vi.mocked(useAuth).mockReturnValue({ login: vi.fn(), status: 'anonymous' } as never);
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    expect(screen.getAllByRole('img', { name: 'SamChe Company LLC' })).toHaveLength(1);
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();

    const labels = ['AI Assistants', 'Knowledge Intelligence', 'Omnichannel', 'CRM & Pipeline', 'Automation', 'Analytics'];
    expect(screen.getAllByRole('article')).toHaveLength(6);
    labels.forEach((label) => expect(screen.getByRole('heading', { name: label })).toBeTruthy());
  });

  it('keeps invitation identity and account setup fields ahead of the same six cards', async () => {
    window.history.replaceState({}, '', '/accept-invitation?token=visual-contract-token');
    vi.mocked(onboardingApi.validateInvitation).mockResolvedValue({
      status: 'VALID', company_name: 'Reference Workspace', email: 'invitee@example.test',
    });

    render(<MemoryRouter initialEntries={['/accept-invitation?token=visual-contract-token']}><AcceptInvitationPage /></MemoryRouter>);

    await screen.findByRole('heading', { name: 'Set up your account' });
    expect(screen.getAllByRole('img', { name: 'SamChe Company LLC' })).toHaveLength(1);
    expect(screen.getByText('Reference Workspace')).toBeTruthy();
    expect(screen.getByText('invitee@example.test')).toBeTruthy();
    ['First name', 'Last name', 'Password', 'Confirm password'].forEach((label) => expect(screen.getByLabelText(label)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Set up account' })).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(6);
  });
});
