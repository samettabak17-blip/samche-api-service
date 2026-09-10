import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  Check,
  Copy,
  Laptop,
  MessageSquare,
  Palette,
  RefreshCw,
  Send,
  ShieldCheck,
  Sliders,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { MutationFeedback } from '../../components/ui/mutation-feedback';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { selectTenantAssistants } from '../resources/resource-utils';
import { useTenant } from '../tenants/tenant-context';
import type {
  WebChatAppearanceConfig,
  WebChatBehaviorConfig,
  WebChatChannelResponse,
  WebChatThemePreviewResponse,
} from '../../types/api';

type TabKey = 'general' | 'appearance' | 'behavior' | 'preview' | 'installation';

function getAccessibleForeground(bgColor: string): string {
  try {
    const hex = (bgColor || '').replace('#', '').trim();
    if (hex.length !== 6 && hex.length !== 3) return '#FFFFFF';
    const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2), 16);
    const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4), 16);
    const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6), 16);
    const sRGB = [r, g, b].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    const lum = 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
    const whiteRatio = (1.0 + 0.05) / (lum + 0.05);
    return whiteRatio >= 4.5 ? '#FFFFFF' : '#0F172A';
  } catch {
    return '#FFFFFF';
  }
}

export function WebChatManagement() {
  const { tenantId } = useParams();
  const { canManage } = useTenant();
  const { isOwner, selectedTenant, tenantRole } = useTenant();

  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>('general');
  const [notice, setNotice] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');

  const [displayName, setDisplayName] = useState('');
  const [assistantId, setAssistantId] = useState<string>('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');

  const [brandName, setBrandName] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [launcherPosition, setLauncherPosition] = useState<'right' | 'left'>('right');
  const [launcherIcon, setLauncherIcon] = useState<'chat' | 'logo'>('chat');
  const [themeMode, setThemeMode] = useState<'dark' | 'light' | 'auto'>('dark');
  const [primaryColor, setPrimaryColor] = useState('#0B5FFF');
  const [accentColor, setAccentColor] = useState('#10B981');

  const [proactiveEnabled, setProactiveEnabled] = useState(false);
  const [highIntentActivation, setHighIntentActivation] = useState(false);
  const [dwellThresholdSeconds, setDwellThresholdSeconds] = useState(15);
  const [cooldownSeconds, setCooldownSeconds] = useState(300);
  const [language, setLanguage] = useState<'auto' | 'tr' | 'en' | 'ar'>('auto');

  const [contrastResult, setContrastResult] = useState<WebChatThemePreviewResponse | null>(null);

  const webChatQuery = useQuery({
    queryKey: tenantKeys.webChatChannel(tenantId ?? ''),
    queryFn: () => tenantApi.getWebChatChannel(tenantId!),
    enabled: Boolean(tenantId),
  });

  const assistantsQuery = useQuery({
    queryKey: tenantKeys.assistants(tenantId ?? ''),
    queryFn: () => tenantApi.listAssistants(tenantId!),
    enabled: Boolean(tenantId),
  });

  const tenantAssistants = selectTenantAssistants(assistantsQuery.data ?? [], tenantId ?? '');

  useEffect(() => {
    if (webChatQuery.data) {
      const d: WebChatChannelResponse = webChatQuery.data;
      setDisplayName(d.channel?.display_name || 'Web Chat');
      const fallbackAssistantId = d.channel?.assistant_id || d.assistant?.id || (tenantAssistants.length > 0 ? tenantAssistants[0].id : '');
      setAssistantId(fallbackAssistantId);
      setStatus(d.configured ? (d.channel?.status || 'active') : 'active');

      if (d.appearance) {
        setBrandName(d.appearance.brand_name || '');
        setTitle(d.appearance.title || '');
        setSubtitle(d.appearance.subtitle || '');
        setLogoUrl(d.appearance.logo_url || '');
        setLauncherPosition(d.appearance.launcher_position || 'right');
        setLauncherIcon(d.appearance.launcher_icon || 'chat');
        setThemeMode(d.appearance.theme_mode || 'dark');
        if (d.appearance.theme) {
          setPrimaryColor(d.appearance.theme.primary_color || '#0B5FFF');
          setAccentColor(d.appearance.theme.accent_color || '#10B981');
        }
      }

      if (d.behavior) {
        setProactiveEnabled(Boolean(d.behavior.proactive_enabled));
        setHighIntentActivation(Boolean(d.behavior.high_intent_activation));
        setDwellThresholdSeconds(d.behavior.dwell_threshold_seconds || 15);
        setCooldownSeconds(d.behavior.cooldown_seconds || 300);
        setLanguage(d.behavior.language || 'auto');
      }
    }
  }, [webChatQuery.data]);

  const previewMutation = useMutation({
    mutationFn: () =>
      tenantApi.previewWebChatTheme(tenantId!, {
        primary_color: primaryColor,
        accent_color: accentColor,
        mode: themeMode === 'auto' ? 'dark' : themeMode,
      }),
    onSuccess: (res) => {
      setContrastResult(res);
    },
  });

  const primaryFg = contrastResult?.primary_foreground || getAccessibleForeground(primaryColor);

  const saveMutation = useMutation({
    mutationFn: () => {
      const appearance: Partial<WebChatAppearanceConfig> = {
        brand_name: brandName,
        title,
        subtitle,
        logo_url: logoUrl || null,
        launcher_position: launcherPosition,
        launcher_icon: launcherIcon,
        theme_mode: themeMode,
        theme: {
          primary_color: primaryColor,
          accent_color: accentColor,
        },
      };

      const behavior: Partial<WebChatBehaviorConfig> = {
        proactive_enabled: proactiveEnabled,
        high_intent_activation: highIntentActivation,
        dwell_threshold_seconds: Number(dwellThresholdSeconds),
        cooldown_seconds: Number(cooldownSeconds),
        language,
      };

      return tenantApi.updateWebChatChannel(tenantId!, {
        display_name: displayName,
        assistant_id: assistantId || null,
        status,
        appearance,
        behavior,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.webChatChannel(tenantId!) });
      queryClient.invalidateQueries({ queryKey: tenantKeys.channels(tenantId!) });
      setNotice('Web Chat configuration successfully updated.');
    },
  });

  const handleCopySnippet = () => {
    const snippet = webChatQuery.data?.embed_snippet || '';
    if (!snippet) return;
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (webChatQuery.isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonBlock className="h-14" />
        <SkeletonBlock className="h-96" />
      </div>
    );
  }

  if (webChatQuery.error) {
    return <QueryErrorState error={webChatQuery.error} onRetry={() => webChatQuery.refetch()} />;
  }

  const data = webChatQuery.data;
  if (!data) {
    return <EmptyState title="Web Chat not available" description="Please configure Web Chat channel." />;
  }

  const isConfigured = Boolean(data.configured && data.widget_key);
  const isChannelActive = status === 'active';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-stone-500">
            <Link to={`/app/${tenantId}/channels`} className="hover:text-stone-300">Channels</Link>
            <span>/</span>
            <span className="text-signal font-semibold">Web Chat Experience</span>
          </div>
          <h1 className="page-title mt-2 flex items-center gap-2">
            Web Chat Management
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              !isConfigured
                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                : isChannelActive
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-stone-500/10 text-stone-400 border border-stone-500/20'
            }`}>
              {!isConfigured ? 'Not Configured' : isChannelActive ? 'Active' : 'Inactive'}
            </span>
          </h1>
          <p className="mt-1 text-sm text-stone-400">
            Brand appearance, proactive behavior, contrast guard, and embed snippets.
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white shadow hover:opacity-95 disabled:opacity-60"
          >
            {saveMutation.isPending ? 'Saving...' : !isConfigured ? 'Save & Enable Web Chat' : 'Save changes'}
          </button>
        )}
      </div>

      {isOwner && (
        <div
          data-testid="platform-super-owner-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            <span>
              <strong>Platform Super Owner Mode:</strong> Managing Web Chat on behalf of tenant{' '}
              <strong className="underline underline-offset-2">{selectedTenant?.name ?? tenantId}</strong>.
            </span>
          </div>
          <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-200">
            Cross-Tenant Authority
          </span>
        </div>
      )}

      {!canManage && (
        <div
          data-testid="read-only-banner"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200"
        >
          <strong>Read-Only Mode:</strong> You are viewing Web Chat in read-only mode ({tenantRole ?? 'Workspace Access'}). Only tenant administrators and platform owners can modify configuration.
        </div>
      )}

      <MutationFeedback error={saveMutation.error} success={notice} />

      <div className="flex border-b border-line">
        {(
          [
            { key: 'general', label: 'General', icon: Sliders },
            { key: 'appearance', label: 'Appearance & Theme', icon: Palette },
            { key: 'behavior', label: 'Behavior & Proactive', icon: Sparkles },
            { key: 'preview', label: 'Live Preview', icon: MessageSquare },
            { key: 'installation', label: 'Embed & Installation', icon: ShieldCheck },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition ${
              activeTab === key
                ? 'border-signal text-white bg-white/[0.02]'
                : 'border-transparent text-stone-400 hover:text-stone-200'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'general' && (
        <div className="panel max-w-2xl p-6 space-y-5">
          {!isConfigured && (
            <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-4 text-blue-200">
              <div className="flex items-center gap-2 font-semibold text-blue-100">
                <Sparkles size={16} />
                <span>Web Chat Setup</span>
              </div>
              <p className="mt-1 text-xs text-blue-200/80">
                Web Chat is ready to be configured for this tenant. Select an AI Assistant and click &quot;Save &amp; Enable Web Chat&quot; to activate the channel and generate your live website embed code.
              </p>
            </div>
          )}

          <label className="block text-sm font-medium">
            Channel Display Name
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="block text-sm font-medium">
            Assigned Assistant
            <select
              value={assistantId}
              onChange={(e) => setAssistantId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
            >
              <option value="">No assistant assigned</option>
              {tenantAssistants.map((ast) => (
                <option key={ast.id} value={ast.id}>
                  {ast.name} ({ast.model || 'Default'})
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
              className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
            >
              <option value="active">Active (Widget accepts conversations)</option>
              <option value="inactive">Inactive (Widget is temporarily disabled)</option>
            </select>
          </label>

          <label className="block text-sm font-medium">
            Primary Language
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'auto' | 'tr' | 'en' | 'ar')}
              className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
            >
              <option value="auto">Auto-detect from visitor browser</option>
              <option value="tr">Turkish (Türkçe)</option>
              <option value="en">English</option>
              <option value="ar">Arabic (العربية - RTL layout enabled)</option>
            </select>
          </label>

          {canManage && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white shadow hover:opacity-95 disabled:opacity-60"
              >
                {saveMutation.isPending ? 'Saving...' : !isConfigured ? 'Save & Enable Web Chat' : 'Save changes'}
              </button>
            </div>
          )}
        </div>
      )}
      {activeTab === 'appearance' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="panel p-6 space-y-5">
            <h2 className="text-base font-semibold">Visual Branding</h2>

            <label className="block text-sm font-medium">
              Brand Name
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Acme Support"
                className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm font-medium">
                Panel Title
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Need assistance?"
                  className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
                />
              </label>

              <label className="block text-sm font-medium">
                Panel Subtitle
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="Instant AI & Team Support"
                  className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
                />
              </label>
            </div>

            <label className="block text-sm font-medium">
              Brand Logo URL (optional)
              <input
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://yourbrand.com/logo.png"
                className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm font-medium">
                Launcher Position
                <select
                  value={launcherPosition}
                  onChange={(e) => setLauncherPosition(e.target.value as 'right' | 'left')}
                  className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
                >
                  <option value="right">Bottom Right (Standard)</option>
                  <option value="left">Bottom Left</option>
                </select>
              </label>

              <label className="block text-sm font-medium">
                Launcher Icon
                <select
                  value={launcherIcon}
                  onChange={(e) => setLauncherIcon(e.target.value as 'chat' | 'logo')}
                  className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
                >
                  <option value="chat">Chat Bubble Icon</option>
                  <option value="logo">Brand Logo</option>
                </select>
              </label>
            </div>

            <label className="block text-sm font-medium">
              Theme Mode
              <select
                value={themeMode}
                onChange={(e) => setThemeMode(e.target.value as 'dark' | 'light' | 'auto')}
                className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
              >
                <option value="dark">Dark Glass (Premium frosted surface)</option>
                <option value="light">Light Glass</option>
                <option value="auto">Follow Visitor System Mode</option>
              </select>
            </label>
          </div>

          <div className="panel p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Palette & WCAG AA Contrast Guard</h2>
              <button
                type="button"
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-stone-300 hover:text-white"
              >
                <RefreshCw size={13} className={previewMutation.isPending ? 'animate-spin' : ''} />
                Audit Contrast
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-400">Primary Color</label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-9 w-9 cursor-pointer rounded border border-line bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-full rounded-lg border border-line bg-canvas/40 px-3 py-1.5 text-sm uppercase text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-400">Accent Color</label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="h-9 w-9 cursor-pointer rounded border border-line bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="w-full rounded-lg border border-line bg-canvas/40 px-3 py-1.5 text-sm uppercase text-white font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-line/80 bg-canvas/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-400">WCAG AA Compliance</span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                  <Check size={14} /> Auto-guarded
                </span>
              </div>
              <p className="text-xs text-stone-400">
                The widget dynamically computes relative luminance and normalizes button foregrounds to maintain readable 4.5:1 / 3:1 contrast.
              </p>

              {contrastResult && (
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-line/40 text-xs">
                  <div className="rounded bg-black/20 p-2">
                    <span className="text-stone-400">Primary button:</span>
                    <strong className="block text-sm text-white">{contrastResult.contrast.primary_button}:1</strong>
                  </div>
                  <div className="rounded bg-black/20 p-2">
                    <span className="text-stone-400">Surface text:</span>
                    <strong className="block text-sm text-white">{contrastResult.contrast.text_surface}:1</strong>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Behavior */}
      {activeTab === 'behavior' && (
        <div className="panel max-w-2xl p-6 space-y-6">
          <div>
            <h2 className="text-base font-semibold">Proactive Engagement Engine</h2>
            <p className="mt-1 text-sm text-stone-400">
              Engage high-intent shoppers automatically while honoring dismissal cooldowns and active chats.
            </p>
          </div>

          <div className="space-y-4">
            <label className="flex items-start gap-3 rounded-xl border border-line/60 bg-canvas/30 p-4 cursor-pointer hover:bg-canvas/50">
              <input
                type="checkbox"
                checked={proactiveEnabled}
                onChange={(e) => setProactiveEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line"
              />
              <div>
                <span className="text-sm font-semibold text-white">Enable Proactive Engagement</span>
                <p className="text-xs text-stone-400 mt-0.5">
                  Tracks visitor dwell time and activates a welcoming nudge on key conversion surfaces.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-line/60 bg-canvas/30 p-4 cursor-pointer hover:bg-canvas/50">
              <input
                type="checkbox"
                checked={highIntentActivation}
                onChange={(e) => setHighIntentActivation(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line"
              />
              <div>
                <span className="text-sm font-semibold text-white">High-Intent Auto-Open</span>
                <p className="text-xs text-stone-400 mt-0.5">
                  Automatically expands the chat panel on high-intent pages (checkout, pricing) instead of gentle launcher pulsing.
                </p>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <label className="block text-sm font-medium">
              Dwell Time Threshold (seconds)
              <input
                type="number"
                min={5}
                max={300}
                value={dwellThresholdSeconds}
                onChange={(e) => setDwellThresholdSeconds(Number(e.target.value))}
                className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
              />
            </label>

            <label className="block text-sm font-medium">
              Dismissal Cooldown (seconds)
              <input
                type="number"
                min={30}
                max={86400}
                value={cooldownSeconds}
                onChange={(e) => setCooldownSeconds(Number(e.target.value))}
                className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
        </div>
      )}

      {/* Tab 4: Live Preview */}
      {activeTab === 'preview' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-stone-400">
                Live preview rendered with active brand colors and frosted glass styling.
              </p>
              {isConfigured && data.widget_key ? (
                <p className="mt-1 text-xs text-emerald-400">
                  Canonical widget runtime active with key <code className="font-mono text-emerald-300">{data.widget_key}</code>
                </p>
              ) : (
                <p className="mt-1 text-xs text-amber-300">
                  Initial theme preview. Save &amp; enable Web Chat in General tab to activate live runtime.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isConfigured && data.widget_key && (
                <a
                  href={`https://samche-api-staging.onrender.com/task8-demo/?widget_key=${encodeURIComponent(data.widget_key)}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas/60 px-3 py-1 text-xs font-semibold text-stone-200 hover:text-white"
                >
                  <Laptop size={14} /> Open Live Storefront
                </a>
              )}
              <div className="flex items-center gap-1 rounded-lg border border-line p-1">
                <button
                  type="button"
                  onClick={() => setPreviewViewport('desktop')}
                  className={`flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition ${
                    previewViewport === 'desktop' ? 'bg-signal text-white' : 'text-stone-400 hover:text-white'
                  }`}
                >
                  <Laptop size={14} /> Desktop
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewViewport('mobile')}
                  className={`flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition ${
                    previewViewport === 'mobile' ? 'bg-signal text-white' : 'text-stone-400 hover:text-white'
                  }`}
                >
                  <Smartphone size={14} /> Mobile
                </button>
              </div>
            </div>
          </div>

          <div
            className={`relative mx-auto rounded-2xl border border-line bg-gradient-to-br from-stone-900 to-black p-6 overflow-hidden ${
              previewViewport === 'mobile' ? 'max-w-sm h-[600px]' : 'w-full h-[500px]'
            }`}
          >
            <div className="relative h-full flex flex-col justify-end items-end">
              <div
                className="w-full max-w-[340px] rounded-2xl overflow-hidden shadow-2xl flex flex-col mb-4"
                style={{
                  background: 'rgba(17, 24, 39, 0.88)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  boxShadow: `0 20px 45px -10px rgba(0, 0, 0, 0.7), 0 0 25px ${primaryColor}22`,
                }}
              >
                <div
                  className="flex items-center justify-between px-4 py-3 border-b"
                  style={{
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    background: `linear-gradient(135deg, ${primaryColor}22, rgba(255, 255, 255, 0.03))`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shadow"
                      style={{ background: primaryColor, color: primaryFg }}
                    >
                      {brandName ? brandName.charAt(0).toUpperCase() : 'S'}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">{title || brandName || 'Web Chat'}</h3>
                      <p className="text-[11px] text-stone-300">{subtitle || 'Online • Active now'}</p>
                    </div>
                  </div>
                </div>

                <div className="p-4 space-y-3 h-48 overflow-y-auto text-xs">
                  <div className="flex flex-col items-start">
                    <div
                      className="max-w-[85%] rounded-2xl px-3.5 py-2 font-normal"
                      style={{
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        color: '#F8FAFC',
                      }}
                    >
                      Merhaba! Size nasıl yardımcı olabilirim?
                    </div>
                  </div>

                  <div className="flex flex-col items-end">
                    <div
                      className="max-w-[85%] rounded-2xl px-3.5 py-2 font-medium"
                      style={{ background: primaryColor, color: primaryFg }}
                    >
                      Kargo ve teslimat süreleri hakkında bilgi alabilir miyim?
                    </div>
                  </div>
                </div>

                <div
                  className="p-3 border-t flex items-center gap-2"
                  style={{ borderColor: 'rgba(255, 255, 255, 0.08)' }}
                >
                  <input
                    type="text"
                    disabled
                    placeholder="Bir mesaj yazın..."
                    className="flex-1 bg-white/[0.06] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-stone-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    className="h-8 w-8 rounded-xl flex items-center justify-center shadow"
                    style={{ background: primaryColor, color: primaryFg }}
                  >
                    <Send size={13} />
                  </button>
                </div>
              </div>

              <div
                className="h-14 w-14 rounded-full flex items-center justify-center shadow-xl cursor-pointer"
                style={{
                  background: primaryColor,
                  color: primaryFg,
                  boxShadow: `0 10px 25px -4px ${primaryColor}77`,
                }}
              >
                <MessageSquare size={24} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Embed & Installation */}
      {activeTab === 'installation' && (
        <div className="panel max-w-3xl p-6 space-y-6">
          {!isConfigured ? (
            <div className="rounded-xl border border-amber-400/30 bg-amber-950/20 p-5 text-amber-200 space-y-3">
              <h3 className="font-semibold text-amber-100">Web Chat is not yet enabled</h3>
              <p className="text-sm text-amber-200/80">
                Configure your assistant and branding in the General tab, then enable Web Chat to generate your production embed snippet and public widget key.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('general')}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-black hover:bg-amber-300"
              >
                Go to General Setup
              </button>
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-base font-semibold">Production Embed Snippet</h2>
                <p className="mt-1 text-sm text-stone-400">
                  Deploy this single asynchronous script tag to your website or eCommerce store.
                </p>
              </div>

              <div className="relative">
                <pre className="overflow-x-auto rounded-xl border border-line/80 bg-black/60 p-4 font-mono text-xs text-stone-200">
                  <code>{data.embed_snippet}</code>
                </pre>
                <button
                  type="button"
                  onClick={handleCopySnippet}
                  className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg bg-ink/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink shadow"
                >
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  {copied ? 'Copied!' : 'Copy snippet'}
                </button>
              </div>

              <div className="rounded-xl border border-line/70 bg-canvas/30 p-4 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-300">Public Widget Key</h3>
                <p className="font-mono text-xs text-amber-200/90 break-all">{data.widget_key}</p>
              </div>
            </>
          )}

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Deployment Guidance</h3>
            <ul className="space-y-2 text-xs text-stone-400 list-disc pl-5">
              <li>
                <strong>Zero Secrets:</strong> Only the public <code className="text-stone-300">data-widget-key</code> is embedded. API tokens, database passwords, and tenant secrets remain strictly server-side.
              </li>
              <li>
                <strong>Shadow DOM Isolation:</strong> The widget runs in an isolated Shadow Root so host styles will never break the widget and widget styles will never bleed onto your website.
              </li>
              <li>
                <strong>Single Page Apps (SPA):</strong> The runtime automatically monitors HTML5 <code className="text-stone-300">pushState</code> and <code className="text-stone-300">popstate</code> events to sync live page context.
              </li>
              <li>
                <strong>WCAG AA Compliance:</strong> Contrast guards automatically normalize foreground texts to ensure accessibility compliance.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}



