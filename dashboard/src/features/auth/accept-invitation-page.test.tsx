import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onboardingApi } from '../dashboard/dashboard-api';
import { AcceptInvitationPage } from './accept-invitation-page';

vi.mock('../dashboard/dashboard-api', () => ({
  onboardingApi: {
    validateInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
  },
}));

describe('AcceptInvitationPage', () => {
  afterEach(cleanup);
  beforeEach(() => {
    window.history.replaceState({}, '', '/accept-invitation?token=safe-token');
    vi.mocked(onboardingApi.validateInvitation).mockReset();
    vi.mocked(onboardingApi.acceptInvitation).mockReset();
  });

  it('captures the token, removes it from the visible URL, and offers password setup for a valid invitation', async () => {
    vi.mocked(onboardingApi.validateInvitation).mockResolvedValue({ status: 'VALID', company_name: 'Northwind', email: 'ada@northwind.example' });

    render(<BrowserRouter><AcceptInvitationPage /></BrowserRouter>);

    await screen.findByRole('heading', { name: 'Set up your account' });
    expect(onboardingApi.validateInvitation).toHaveBeenCalledWith('safe-token');
    expect(window.location.search).toBe('');
    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'SamChe Company LLC' })).toHaveClass('h-28', 'w-72', 'mx-auto', 'object-center');
  });

  it('submits matching passwords and navigates to sign in after acceptance', async () => {
    vi.mocked(onboardingApi.validateInvitation).mockResolvedValue({ status: 'VALID' });
    vi.mocked(onboardingApi.acceptInvitation).mockResolvedValue({ status: 'ACCEPTED' });

    render(<BrowserRouter><AcceptInvitationPage /></BrowserRouter>);
    await screen.findByLabelText('Password');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery-staple' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'correct-horse-battery-staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up account' }));

    await waitFor(() => expect(onboardingApi.acceptInvitation).toHaveBeenCalledWith({ token: 'safe-token', password: 'correct-horse-battery-staple', confirm_password: 'correct-horse-battery-staple' }));
    expect(await screen.findByText('Your account is ready.')).toBeTruthy();
  });
});
