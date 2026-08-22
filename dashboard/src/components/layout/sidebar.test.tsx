import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Sidebar } from './sidebar';

describe('Sidebar', () => {
  it('keeps read pages available while marking an AGENT workspace as read-only', () => {
    render(
      <MemoryRouter>
        <Sidebar tenantId="tenant-agent" tenantName="Agent tenant" tenantRole="AGENT" email="agent@samche.test" onLogout={() => undefined} onNavigate={() => undefined} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('img', { name: 'SamChe Company LLC' })).toBeTruthy();
    expect(screen.getByText('Agent tenant')).toBeTruthy();
    expect(screen.getByText('Read-only access')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'AI Assistants' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Channels' })).toBeTruthy();
  });
});

