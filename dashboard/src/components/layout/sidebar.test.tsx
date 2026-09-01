import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Sidebar, workspaceAccessCopy } from './sidebar';

afterEach(cleanup);

describe('Sidebar', () => {
  it('keeps read pages available while marking an AGENT workspace as read-only', () => {
    render(<MemoryRouter><Sidebar tenantId="tenant-agent" tenantName="Agent tenant" tenantRole="AGENT" email="agent@samche.test" onLogout={() => undefined} onNavigate={() => undefined} /></MemoryRouter>);
    expect(screen.getByRole('img', { name: 'SamChe Company LLC' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'SamChe Company LLC' })).toHaveClass('h-28', 'w-full', 'object-center');
    expect(screen.getByText('AI Platform')).toHaveClass('text-gold', 'text-center');
    expect(screen.getByText('Agent tenant')).toBeTruthy();
    expect(screen.getByText('Read-only access')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'AI Assistants' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Channels' })).toBeTruthy();
  });
  it('places Customer Engagement before operations and settings', () => {
    render(<MemoryRouter initialEntries={['/app/tenant-admin/conversations/whatsapp']}><Sidebar tenantId="tenant-admin" tenantName="Admin tenant" tenantRole="ADMIN" email="admin@samche.test" onLogout={() => undefined} onNavigate={() => undefined} /></MemoryRouter>);
    const navigationText = screen.getByLabelText('Dashboard navigation').textContent ?? '';
    expect(navigationText.indexOf('CUSTOMER ENGAGEMENT')).toBeLessThan(navigationText.indexOf('OPERATIONS'));
    expect(navigationText.indexOf('CUSTOMER ENGAGEMENT')).toBeLessThan(navigationText.indexOf('SETTINGS'));
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Web Chatbot' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'AI Guide' })).toBeTruthy();
  });
});
describe('workspace access presentation', () => {
  it('shows real administrator access without fabricating a tenant plan', () => {
    expect(workspaceAccessCopy('OWNER')).toEqual({ label: 'ADMIN', detail: 'FULL ACCESS' });
    expect(workspaceAccessCopy('ADMIN')).toEqual({ label: 'ADMIN', detail: 'FULL ACCESS' });
  });
  it('keeps the persistent access card connected to the real workspace settings route', () => {
    render(<MemoryRouter><Sidebar tenantId="tenant-admin" tenantName="Admin tenant" tenantRole="ADMIN" email="admin@samche.test" onLogout={() => undefined} onNavigate={() => undefined} /></MemoryRouter>);
    const managePlan = screen.getByRole('link', { name: 'Manage Plan' });
    expect(managePlan.getAttribute('href')).toBe('/app/tenant-admin/settings');
  });
});
