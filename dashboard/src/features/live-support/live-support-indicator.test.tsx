import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LiveSupportIndicator } from './live-support-attention-provider';

describe('LiveSupportIndicator responsive presentation', () => {
  it('keeps waiting customers and sound controls reachable for a multi-digit queue', () => {
    const setMuted = vi.fn();

    render(<MemoryRouter><LiveSupportIndicator tenantId="tenant-1" requestedCount={12} muted={false} audioState="BLOCKED" setMuted={setMuted} /></MemoryRouter>);

    const status = screen.getByRole('status');
    expect(status).toHaveClass('live-support-indicator');
    expect(screen.getByRole('link', { name: /12 customers waiting/i })).toHaveAttribute('href', '/app/tenant-1/conversations');
    expect(screen.getByText('Sound notifications: ON')).toBeVisible();
    expect(screen.getByText('Sound will retry after your next interaction.')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(setMuted).toHaveBeenCalledWith(true);
  });
});
