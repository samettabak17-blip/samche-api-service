import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthVisualLayout } from './auth-visual-layout';

afterEach(cleanup);

describe('AuthVisualLayout', () => {
  it('provides the shared dominant hero, capability grid, and premium auth card', () => {
    render(<AuthVisualLayout><p>Form content</p></AuthVisualLayout>);

    expect(screen.getByRole('main')).toHaveClass('auth-page');
    expect(screen.getAllByRole('img', { name: 'SamChe Company LLC' })[0]).toHaveClass('auth-hero-logo');
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(screen.getByText('Form content').parentElement).toHaveClass('auth-card');
  });

  it('keeps invitation context in one card while retaining all six shared capabilities', () => {
    render(<AuthVisualLayout showCardLogo capabilityCount={5}><p>Invitation content</p></AuthVisualLayout>);

    expect(screen.getByText('Invitation content').parentElement).toHaveClass('auth-card-invitation');
    expect(screen.getAllByRole('img', { name: 'SamChe Company LLC' })).toHaveLength(1);
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(screen.getAllByText('Analytics')).toHaveLength(1);
  });
});
