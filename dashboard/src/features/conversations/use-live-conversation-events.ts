import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { session } from '../../lib/session';

type LiveState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

function apiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? '';
}

export function useTenantConversationLiveEvents(tenantId: string) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<LiveState>('disconnected');

  useEffect(() => {
    if (!tenantId || !apiBaseUrl() || !session.getToken()) {
      setState('disconnected');
      return;
    }

    let active = true;
    let retryTimer: number | undefined;
    let controller: AbortController | undefined;

    const connect = async () => {
      controller = new AbortController();
      setState((current) => current === 'connected' ? 'reconnecting' : 'connecting');

      try {
        const response = await fetch(`${apiBaseUrl()}/api/v1/tenants/${tenantId}/conversations/live`, {
          headers: { Authorization: `Bearer ${session.getToken()}` },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error('Live stream is unavailable');

        setState('connected');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (active) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          if (frames.length) {
            await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'conversations'] });
            await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'conversation'] });
          }
        }
      } catch {
        // The UI reports reconnecting; authorization errors remain visible on the next query.
      } finally {
        if (active) {
          setState('reconnecting');
          retryTimer = window.setTimeout(() => void connect(), 3000);
        }
      }
    };

    void connect();
    return () => {
      active = false;
      controller?.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
      setState('disconnected');
    };
  }, [queryClient, tenantId]);

  return state;
}
