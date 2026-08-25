import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { session } from '../../lib/session';

type AttentionContextValue = {
  requestedCount: number;
  muted: boolean;
  audioState: 'OFF' | 'ARMED' | 'PLAYING' | 'BLOCKED';
  refreshAttention: (reason?: string) => Promise<void>;
  setMuted: (muted: boolean) => void;
};

const AttentionContext = createContext<AttentionContextValue | null>(null);

export function liveSupportBrowserTitle(requestedCount: number): string {
  return requestedCount > 0 ? '(' + requestedCount + ') LIVE SUPPORT — SamChe Dashboard' : 'SamChe Dashboard';
}

export function shouldRunLiveSupportAlarm({ requestedCount, muted, audioArmed }: { requestedCount: number; muted: boolean; audioArmed: boolean }): boolean {
  return requestedCount > 0 && !muted && audioArmed;
}

function preferenceKey(userId: string) {
  return 'samche.dashboard.live-support.muted:' + userId;
}

function parseLiveEvent(frame: string): { type?: string; tenant_id?: string } | null {
  if (!frame.startsWith('event: conversation')) return null;
  const data = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
  if (!data) return null;
  try { return JSON.parse(data) as { type?: string; tenant_id?: string }; } catch { return null; }
}

function apiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? '';
}

function buildAlertFavicon(count: number): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 128;
      const context = canvas.getContext('2d');
      if (!context) return resolve(null);
      context.drawImage(image, 4, 34, 120, 48);
      context.beginPath();
      context.arc(104, 101, 20, 0, Math.PI * 2);
      context.fillStyle = '#dc2626'; context.fill();
      context.lineWidth = 4; context.strokeStyle = '#ffffff'; context.stroke();
      if (count < 10) {
        context.fillStyle = '#ffffff';
        context.font = '800 22px Arial, sans-serif';
        context.textAlign = 'center';
        context.fillText(String(count), 104, 109);
      }
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => resolve(null);
    image.src = '/samche-logo.png';
  });
}

export function LiveSupportAttentionProvider({ tenantId, userId, children }: { tenantId: string; userId: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [streamConnected, setStreamConnected] = useState(false);
  const [muted, setMutedState] = useState(() => window.localStorage.getItem(preferenceKey(userId)) === 'true');
  const [audioArmed, setAudioArmed] = useState(false);
  const [audioState, setAudioState] = useState<'OFF' | 'ARMED' | 'PLAYING' | 'BLOCKED'>('OFF');
  const audioContext = useRef<AudioContext | null>(null);

  useEffect(() => {
    setMutedState(window.localStorage.getItem(preferenceKey(userId)) === 'true');
  }, [userId]);

  const setMuted = useCallback((nextMuted: boolean) => {
    window.localStorage.setItem(preferenceKey(userId), String(nextMuted));
    setMutedState(nextMuted);
  }, [userId]);

  const attentionQuery = useQuery({
    queryKey: tenantKeys.humanAttention(tenantId),
    queryFn: () => tenantApi.getHumanAttentionSummary(tenantId),
    enabled: Boolean(tenantId),
    refetchInterval: streamConnected ? false : 15000,
  });
  const requestedCount = attentionQuery.data?.unresolvedCount ?? 0;

  const refreshAttention = useCallback(async (reason?: string) => {
    const before = queryClient.getQueryData<{ unresolvedCount?: number }>(tenantKeys.humanAttention(tenantId))?.unresolvedCount ?? 0;
    await queryClient.invalidateQueries({ queryKey: tenantKeys.humanAttention(tenantId) });
    await queryClient.refetchQueries({ queryKey: tenantKeys.humanAttention(tenantId), type: 'active' });
    if (reason) {
      const after = queryClient.getQueryData<{ unresolvedCount?: number }>(tenantKeys.humanAttention(tenantId))?.unresolvedCount ?? 0;
      console.info('DASHBOARD_LIVE_SUPPORT_' + reason + ' requested_count_before=' + before + ' requested_count_after=' + after);
    }
  }, [queryClient, tenantId]);

  useEffect(() => {
    const token = session.getToken();
    if (!tenantId || !token || !apiBaseUrl()) return;
    let active = true;
    let retry: number | undefined;
    let controller: AbortController | undefined;
    const connect = async () => {
      controller = new AbortController();
      try {
        const response = await fetch(apiBaseUrl() + '/api/v1/tenants/' + tenantId + '/conversations/live', {
          headers: { Authorization: 'Bearer ' + token }, signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error('LIVE_STREAM_UNAVAILABLE');
        setStreamConnected(true);
        void refreshAttention('SSE_CONNECTED');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (active) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const event = parseLiveEvent(frame);
            if (event?.tenant_id === tenantId && event.type?.startsWith('HUMAN_SUPPORT_')) {
              console.info('DASHBOARD_ATTENTION_SSE received=' + event.type);
              void refreshAttention('SSE');
            }
          }
        }
      } catch {
        setStreamConnected(false);
      } finally {
        if (active) retry = window.setTimeout(() => void connect(), 3000);
      }
    };
    void connect();
    return () => { active = false; controller?.abort(); if (retry) window.clearTimeout(retry); };
  }, [refreshAttention, tenantId]);

  const armAudio = useCallback(async () => {
    if (muted) return;
    try {
      const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) throw new Error('AUDIO_UNSUPPORTED');
      audioContext.current ??= new Context();
      await audioContext.current.resume();
      if (audioContext.current.state !== 'running') throw new Error('AUDIO_NOT_RUNNING');
      setAudioArmed(true); setAudioState('ARMED');
      console.info('DASHBOARD_ATTENTION_AUDIO state=ARMED');
    } catch {
      setAudioArmed(false); setAudioState('BLOCKED');
      console.info('DASHBOARD_ATTENTION_AUDIO state=BLOCKED reason=PLAYBACK_POLICY');
    }
  }, [muted]);

  useEffect(() => {
    if (muted || audioArmed) return;
    const arm = () => { void armAudio(); };
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    return () => { window.removeEventListener('pointerdown', arm); window.removeEventListener('keydown', arm); };
  }, [armAudio, audioArmed, muted]);

  useEffect(() => {
    if (!shouldRunLiveSupportAlarm({ requestedCount, muted, audioArmed })) {
      if (audioState === 'PLAYING') { setAudioState('ARMED'); console.info('DASHBOARD_ATTENTION_AUDIO state=STOPPED requested_count=0'); }
      return;
    }
    let disposed = false;
    const ring = async () => {
      try {
        const context = audioContext.current;
        if (!context) throw new Error('AUDIO_UNARMED');
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(1046.5, context.currentTime);
        oscillator.frequency.setValueAtTime(1318.5, context.currentTime + 0.12);
        gain.gain.setValueAtTime(0, context.currentTime);
        gain.gain.linearRampToValueAtTime(0.07, context.currentTime + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.10);
        gain.gain.linearRampToValueAtTime(0.07, context.currentTime + 0.132);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.24);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(); oscillator.stop(context.currentTime + 0.25);
        if (!disposed) { setAudioState('PLAYING'); console.info('DASHBOARD_ATTENTION_AUDIO state=PLAYED'); }
      } catch {
        if (!disposed) { setAudioArmed(false); setAudioState('BLOCKED'); }
      }
    };
    console.info('DASHBOARD_ATTENTION_AUDIO state=STARTED requested_count=' + requestedCount);
    void ring();
    const timer = window.setInterval(() => { void ring(); }, 3000);
    return () => { disposed = true; window.clearInterval(timer); console.info('DASHBOARD_ATTENTION_AUDIO state=STOPPED'); };
  }, [audioArmed, audioState, muted, requestedCount]);

  useEffect(() => {
    document.title = liveSupportBrowserTitle(requestedCount);
    return () => { document.title = liveSupportBrowserTitle(0); };
  }, [requestedCount]);

  useEffect(() => {
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!favicon) return;
    const normal = favicon.dataset.normalHref ?? favicon.href;
    favicon.dataset.normalHref = normal;
    if (requestedCount < 1) { favicon.href = normal; return; }
    let disposed = false;
    let timer: number | undefined;
    void buildAlertFavicon(requestedCount).then((alert) => {
      if (disposed || !alert) return;
      let alertVisible = true;
      favicon.href = alert;
      timer = window.setInterval(() => { alertVisible = !alertVisible; favicon.href = alertVisible ? alert : normal; }, 1500);
    });
    return () => { disposed = true; if (timer) window.clearInterval(timer); favicon.href = normal; };
  }, [requestedCount]);

  const value: AttentionContextValue = { requestedCount, muted, audioState, refreshAttention, setMuted };
  return <AttentionContext.Provider value={value}>{children}</AttentionContext.Provider>;
}

export function useLiveSupportAttention() {
  const value = useContext(AttentionContext);
  if (!value) throw new Error('LiveSupportAttentionProvider is required');
  return value;
}

export function GlobalLiveSupportIndicator({ tenantId }: { tenantId: string }) {
  const { requestedCount, muted, audioState, setMuted } = useLiveSupportAttention();
  if (requestedCount < 1) return null;
  return <div role="status" className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 border-b border-red-400/40 bg-red-500/10 px-4 py-2 text-sm text-red-100 sm:px-7 lg:px-10">
    <Link to={'/app/' + tenantId + '/conversations'} className="inline-flex items-center gap-3 font-semibold">
      <span className="h-2.5 w-2.5 rounded-full bg-red-400 motion-safe:animate-pulse" />
      <span className="tracking-[0.12em]">LIVE SUPPORT</span>
      <span>{requestedCount} CUSTOMER{requestedCount === 1 ? '' : 'S'} WAITING</span>
    </Link>
    <div className="flex items-center gap-2 text-xs">
      <span className={muted ? 'text-stone-300' : 'text-gold'}>Sound notifications: {muted ? 'MUTED' : 'ON'}</span>
      <button type="button" onClick={() => setMuted(!muted)} className="underline underline-offset-4">{muted ? 'Unmute' : 'Mute'}</button>
      {!muted && audioState === 'BLOCKED' && <span className="text-red-200">Sound will retry after your next interaction.</span>}
    </div>
  </div>;
}
