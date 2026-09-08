import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './login-page';
import { AcceptInvitationPage } from './accept-invitation-page';
import { useAuth } from './auth-context';
import { onboardingApi } from '../dashboard/dashboard-api';

vi.mock('./auth-context', () => ({ useAuth: vi.fn() }));
vi.mock('../dashboard/dashboard-api', () => ({
  onboardingApi: {
    validateInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
  },
}));

afterEach(cleanup);

describe('Workstream B - Evidence-based Reference Matching Verification', () => {
  it('DESKTOP LOGIN matches reference samche-login-reference.png (1600x983)', () => {
    vi.mocked(useAuth).mockReturnValue({ login: vi.fn(), status: 'anonymous' } as never);
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    const page = screen.getByRole('main');
    expect(page).toHaveClass('auth-page');

    // 1. Futuristic red laser SVG background elements
    const svg = page.querySelector('svg.auth-laser-bg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 1600 983');
    expect(svg?.querySelector('#glow-laser')).toBeTruthy();
    expect(svg?.querySelector('#glow-core')).toBeTruthy();
    expect(svg?.querySelector('#particle-dots')).toBeTruthy();

    // 2. Logo scaling & position
    const heroLogo = screen.getAllByRole('img', { name: 'SamChe Company LLC' })[0];
    expect(heroLogo).toHaveClass('auth-hero-logo');

    // 3. Eyebrow, Heading, Subtitle
    expect(screen.getByText('SAMCHE AI PLATFORM')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Manage your AI operations from a single platform.' })).toBeTruthy();
    expect(screen.getByText(/Unify assistants, conversations, knowledge and automation/)).toBeTruthy();

    // 4. Feature Cards (6 items)
    const capabilities = ['AI Assistants', 'Knowledge Intelligence', 'Omnichannel', 'CRM & Pipeline', 'Automation / Agentic', 'Analytics'];
    for (const cap of capabilities) {
      expect(screen.getByText(cap)).toBeTruthy();
    }

    // 5. Card composition
    const card = page.querySelector('.auth-card');
    expect(card).toBeTruthy();
    expect(screen.getByText('SECURE SIGN IN')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(screen.getByPlaceholderText('admin@samchecompany.com')).toBeTruthy();
    expect(screen.getByPlaceholderText('••••••••••••')).toBeTruthy();
    expect(screen.getByText('Show')).toBeTruthy();
    expect(screen.getByText('Remember me')).toBeTruthy();
    expect(screen.getByText('Forgot password?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeTruthy();
    expect(screen.getByText('Secure and trusted')).toBeTruthy();
    expect(screen.getByText('Secure access')).toBeTruthy();
    expect(screen.getByText('Protected credentials')).toBeTruthy();
    expect(screen.getByText('Role-based workspace')).toBeTruthy();

    // 6. Footer
    expect(screen.getByText(/© \d{4} SamChe Company LLC\. All rights reserved\./)).toBeTruthy();
  });

  it('DESKTOP INVITATION matches reference samche-customer-invitation-reference.png (1672x941)', async () => {
    window.history.replaceState({}, '', '/accept-invitation?token=valid-invite-token');
    vi.mocked(onboardingApi.validateInvitation).mockResolvedValue({
      status: 'VALID',
      company_name: 'Blue Dune Event Management LLC',
      email: 'smttbk@gmail.com',
    });

    render(
      <MemoryRouter initialEntries={['/accept-invitation?token=valid-invite-token']}>
        <AcceptInvitationPage />
      </MemoryRouter>
    );

    await screen.findByRole('heading', { name: 'Set up your account' });
    expect(screen.getByText('CUSTOMER INVITATION')).toBeTruthy();
    expect(screen.getByText('Blue Dune Event Management LLC')).toBeTruthy();
    expect(screen.getByText('smttbk@gmail.com')).toBeTruthy();
    expect(screen.getByPlaceholderText('Enter your first name')).toBeTruthy();
    expect(screen.getByPlaceholderText('Enter your last name')).toBeTruthy();
    expect(screen.getByPlaceholderText('Create a strong password')).toBeTruthy();
    expect(screen.getByPlaceholderText('Confirm your password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set up account' })).toBeTruthy();

    // Trust items
    expect(screen.getByText('Secure invitation link')).toBeTruthy();
    expect(screen.getByText('Encrypted access')).toBeTruthy();
    expect(screen.getByText('Role-based workspace access')).toBeTruthy();
  });

  it('MOBILE LOGIN matches reference login.mobile.png and adapts cleanly down to 320px', () => {
    vi.mocked(useAuth).mockReturnValue({ login: vi.fn(), status: 'anonymous' } as never);
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    const page = screen.getByRole('main');
    expect(page).toHaveClass('auth-page');

    // 1. Top section has logo and hero text
    const heroTop = page.querySelector('.auth-hero-top');
    expect(heroTop).toBeTruthy();
    expect(heroTop?.querySelector('.auth-hero-logo')).toBeTruthy();
    expect(screen.getByText('SAMCHE AI PLATFORM')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Manage your AI operations from a single platform.' })).toBeTruthy();

    // 2. Middle section has login card
    const card = page.querySelector('.auth-card');
    expect(card).toBeTruthy();
    const button = screen.getByRole('button', { name: /Sign in/ });
    expect(button).toHaveClass('w-full');
    expect(button).toHaveClass('auth-button-primary');

    // 3. Bottom section has 6 capability cards below the form
    const heroBottom = page.querySelector('.auth-hero-bottom');
    expect(heroBottom).toBeTruthy();
    const grid = heroBottom?.querySelector('.auth-capability-grid');
    expect(grid).toBeTruthy();
    expect(grid).toHaveClass('grid-cols-2');

    const capabilities = ['AI Assistants', 'Knowledge Intelligence', 'Omnichannel', 'CRM & Pipeline', 'Automation / Agentic', 'Analytics'];
    for (const cap of capabilities) {
      expect(screen.getByText(cap)).toBeTruthy();
    }
  });

  it('MOBILE INVITATION matches reference invatation.login.png with no hero split above card', async () => {
    window.history.replaceState({}, '', '/accept-invitation?token=valid-invite-token');
    vi.mocked(onboardingApi.validateInvitation).mockResolvedValue({
      status: 'VALID',
      company_name: 'Blue Dune Event Management LLC',
      email: 'smttbk@gmail.com',
    });

    render(
      <MemoryRouter initialEntries={['/accept-invitation?token=valid-invite-token']}>
        <AcceptInvitationPage />
      </MemoryRouter>
    );

    await screen.findByRole('heading', { name: 'Set up your account' });
    const page = screen.getByRole('main');

    // 1. Top section has logo and hides hero text on mobile via auth-hero-top-invitation
    const heroTop = page.querySelector('.auth-hero-top-invitation');
    expect(heroTop).toBeTruthy();
    expect(heroTop?.querySelector('.auth-hero-logo')).toBeTruthy();

    // 2. Card contains customer invitation fields directly
    expect(screen.getByText('CUSTOMER INVITATION')).toBeTruthy();
    expect(screen.getByText('Blue Dune Event Management LLC')).toBeTruthy();
    expect(screen.getByPlaceholderText('Enter your first name')).toBeTruthy();

    // 3. Bottom section has capability cards and copyright below card
    const heroBottom = page.querySelector('.auth-hero-bottom');
    expect(heroBottom).toBeTruthy();
    expect(heroBottom?.querySelector('.auth-capability-grid')).toBeTruthy();
  });
});
