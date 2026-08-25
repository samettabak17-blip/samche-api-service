import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { session } from '../../lib/session';

type LiveState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
type ConversationEvent = { type?: string; conversation_id?: string; tenant_id?: string };

function apiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? '';
}

function parseConversationEvent(frame: string): ConversationEvent | null {
  if (!frame.startsWith('event: conversation')) return null;
  const data = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
  if (!data) return null;
  try { return JSON.parse(data) as ConversationEvent; } catch { return null; }
}

export function useTenantConversationLiveEvents(tenantId: string, activeConversationId?: string) {
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

    const refresh = (event?: ConversationEvent) => {
      if (event?.tenant_id && event.tenant_id !== tenantId) return;
      void queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'human-attention'] });
      if (activeConversationId && (!event?.conversation_id || event.conversation_id === activeConversationId)) {
        void queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'conversation', activeConversationId] });
        void queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'messages', activeConversationId] });
        void queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'conversation-events', activeConversationId] });
      }
    };

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
        refresh();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (active) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          frames.forEach((frame) => refresh(parseConversationEvent(frame) ?? undefined));
        }
      } catch {
        // Connection recovery refetches the active tenant on success.
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
  }, [activeConversationId, queryClient, tenantId]);

  return state;
}