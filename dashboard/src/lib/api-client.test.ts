import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './api-client';
import { session } from './session';
import { pushNotificationApi } from '../features/dashboard/dashboard-api';

describe('apiClient', () => {
  const apiBaseUrl = 'https://api.example.test';

  afterEach(() => {
    session.clear();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('attaches the session token as a Bearer header', async () => {
    vi.stubEnv('VITE_API_BASE_URL', apiBaseUrl);
    session.setToken('test-token');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: '1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.get('/api/v1/auth/me');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/me'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('surfaces a 403 as an ApiError without clearing the session', async () => {
    vi.stubEnv('VITE_API_BASE_URL', apiBaseUrl);
    session.setToken('test-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Tenant access denied' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(apiClient.get('/api/v1/tenants/example')).rejects.toMatchObject({
      status: 403,
      message: 'Tenant access denied',
    });
    expect(session.getToken()).toBe('test-token');
  });

  it('serializes PUT payloads and sends DELETE requests', async () => {
    vi.stubEnv('VITE_API_BASE_URL', apiBaseUrl);
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ id: 'resource-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.put('/api/v1/tenants/tenant-a/channels/channel-a', { display_name: 'Support' });
    await apiClient.delete('/api/v1/tenants/tenant-a/channels/channel-a');

    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ display_name: 'Support' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ method: 'DELETE' }));
  });

  it('sends authenticated JSON patch requests for explicit preference changes', async () => {
    vi.stubEnv('VITE_API_BASE_URL', apiBaseUrl);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ push_enabled: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await apiClient.patch('/api/v1/tenants/tenant/push-notifications/preference', { push_enabled: true });
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/v1/tenants/tenant/push-notifications/preference', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ push_enabled: true }) }));
  });

  it('scopes push capability lookup to the authenticated tenant route', async () => {
    vi.stubEnv('VITE_API_BASE_URL', apiBaseUrl);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: false, publicKey: null }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await pushNotificationApi.getCapability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/v1/tenants/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/push-notifications/capability', expect.objectContaining({ method: 'GET' }));
  });
});
