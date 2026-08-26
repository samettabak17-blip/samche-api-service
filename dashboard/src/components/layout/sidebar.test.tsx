import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Sidebar, workspaceAccessCopy } from './sidebar';

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



describe('workspace access presentation', () => {
  it('shows real administrator access without fabricating a tenant plan', () => {
    expect(workspaceAccessCopy('OWNER')).toEqual({ label: 'ADMIN', detail: 'FULL ACCESS' });
    expect(workspaceAccessCopy('ADMIN')).toEqual({ label: 'ADMIN', detail: 'FULL ACCESS' });
  });
});


it('provides the three neutral conversation channel labels without repeated company branding', () => {
  render(<MemoryRouter initialEntries={['/app/tenant-agent/conversations/whatsapp']}><Sidebar tenantId="tenant-agent" tenantName="Agent tenant" tenantRole="ADMIN" email="agent@samche.test" onLogout={() => undefined} onNavigate={() => undefined} /></MemoryRouter>);
  expect(screen.getAllByRole('button', { name: /Conversations/i }).length).toBeGreaterThan(0);
  expect(screen.getByRole('link', { name: 'WhatsApp' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Web Chatbot' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'AI Guide' })).toBeTruthy();
  expect(screen.queryByText('SamChe WhatsApp')).toBeNull();
});
