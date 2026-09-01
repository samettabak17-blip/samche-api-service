import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './login-page';
import { useAuth } from './auth-context';

vi.mock('./auth-context', () => ({ useAuth: vi.fn() }));

const login = vi.fn();

describe('LoginPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    login.mockReset();
    login.mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({ login, status: 'anonymous' } as never);
  });

  it('renders the approved SamChe identity without an unsupported password recovery action', () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    expect(screen.getAllByRole('img', { name: 'SamChe Company LLC' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'AI OPERATIONS.' })).toBeTruthy();
    expect(screen.getAllByRole('img', { name: 'SamChe Company LLC' })[0]).toHaveClass('h-32', 'w-72');
    expect(screen.getByRole('heading', { name: 'SMARTER.' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'STRONGER.' })).toBeTruthy();
    expect(screen.getByText('Analytics')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /forgot password/i })).toBeNull();
  });

  it('keeps the existing login submit contract and lets the password be revealed locally', async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' admin@samche.test ' } });
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'not-a-real-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));

    expect(password.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: /^sign in/i }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('admin@samche.test', 'not-a-real-password'));
  });
});
