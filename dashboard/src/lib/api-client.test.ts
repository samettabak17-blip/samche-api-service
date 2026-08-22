import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './api-client';
import { session } from './session';

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
});

