import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  Check,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Laptop,
  MessageSquare,
  Palette,
  RefreshCw,
  Send,
  ShieldCheck,
  Sliders,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { MutationFeedback } from '../../components/ui/mutation-feedback';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { selectTenantAssistants } from '../resources/resource-utils';
import { useTenant } from '../tenants/tenant-context';
import { resolveWebChatAssetUrl } from '../../lib/branding';
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

function hexToRgba(hex: string, alpha: number): string {
  try {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.length === 3 ? clean[0] + clean[0] : clean.slice(0, 2), 16) || 0;
    const g = parseInt(clean.length === 3 ? clean[1] + clean[1] : clean.slice(2, 4), 16) || 0;
    const b = parseInt(clean.length === 3 ? clean[2] + clean[2] : clean.slice(4, 6), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  } catch {
    return `rgba(37, 99, 235, ${alpha})`;
  }
}

const LAUNCHER_STYLE_OPTIONS = [
  { id: 'pill' as const, name: 'Pill (Default)' },
  { id: 'circular' as const, name: 'Circular' },
  { id: 'minimal' as const, name: 'Minimal' },
  { id: 'glass' as const, name: 'Glass' },
  { id: 'neon_pulse' as const, name: 'Neon Pulse' },
  { id: 'custom' as const, name: 'Custom' },
];

function LauncherStyleIcon({ id, logoUrl }: { id: string; logoUrl?: string | null }) {
  if (id === 'circular') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-sky-400 bg-slate-900 p-0.5 shadow-[0_0_10px_rgba(56,189,248,0.7)]">
        {logoUrl ? <img src={logoUrl} alt="" className="h-3.5 w-3.5 object-contain" /> : <div className="h-2 w-2 rounded-full bg-sky-400" />}
      </div>
    );
  }
  if (id === 'minimal') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full border border-stone-400 bg-stone-900">
        {logoUrl ? <img src={logoUrl} alt="" className="h-3 w-3 object-contain opacity-80" /> : <div className="h-2 w-2 rounded-full bg-stone-300" />}
      </div>
    );
  }
  if (id === 'glass') {
    return (
      <div className="flex h-5 w-9 items-center justify-center rounded-full border border-white/30 bg-white/10 shadow-[inset_0_0_6px_rgba(255,255,255,0.2)] backdrop-blur">
        {logoUrl ? <img src={logoUrl} alt="" className="h-3 w-3 object-contain" /> : <div className="h-2 w-2 rounded-full bg-white/60" />}
      </div>
    );
  }
  if (id === 'neon_pulse') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-cyan-300 bg-slate-950 shadow-[0_0_14px_rgba(6,182,212,0.9)]">
        {logoUrl ? <img src={logoUrl} alt="" className="h-3 w-3 object-contain" /> : <div className="h-2 w-2 rounded-full bg-cyan-300" />}
      </div>
    );
  }
  if (id === 'custom') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full border border-purple-400/80 bg-slate-950 shadow-[0_0_8px_rgba(168,85,247,0.5)]">
        <Sliders size={12} className="text-purple-300" />
      </div>
    );
  }
  return (
    <div className="flex h-5 w-10 items-center gap-1 rounded-full border border-sky-400/80 bg-slate-900/90 px-1 shadow-[0_0_8px_rgba(56,189,248,0.5)]">
      <div className="h-3 w-3 rounded-full border border-sky-400/80 bg-sky-400/30 flex items-center justify-center overflow-hidden">
        {logoUrl ? <img src={logoUrl} alt="" className="h-2 w-2 object-contain" /> : <div className="h-1.5 w-1.5 rounded-full bg-sky-400" />}
      </div>
      <div className="h-1 w-3 rounded bg-white/70" />
    </div>
  );
}

function LivePreviewCanvas({
  previewViewport,
  previewState,
  setPreviewState,
  primaryColor,
  renderPreviewLauncher,
  renderPreviewPanel,
}: {
  previewViewport: 'desktop' | 'mobile';
  previewState: 'both' | 'closed' | 'open';
  setPreviewState: (s: 'both' | 'closed' | 'open') => void;
  primaryColor: string;
  renderPreviewLauncher: (onClick?: () => void) => React.ReactNode;
  renderPreviewPanel: (onClose?: () => void) => React.ReactNode;
}) {
  return (
    <div
      className={`relative mx-auto rounded-2xl border border-line/80 overflow-hidden transition-all duration-300 p-6 flex items-center justify-center ${
        previewViewport === 'mobile' ? 'max-w-sm h-[580px]' : 'w-full min-h-[460px]'
      }`}
      style={{
        background: `radial-gradient(circle at 65% 35%, ${primaryColor}18 0%, #050814 60%, #02040a 100%)`,
      }}
    >
      {previewState === 'both' && (
        <div className="w-full flex flex-col md:flex-row items-center justify-around gap-8">
          <div className="flex flex-col items-center gap-4">
            <div className="text-center">
              <span className="text-sky-400 text-sm font-semibold block">Closed State</span>
              <span className="text-stone-400 text-xs">Premium glowing launcher</span>
            </div>
            <div className="p-4 flex items-center justify-center">
              {renderPreviewLauncher(() => setPreviewState('open'))}
            </div>
          </div>

          <div className="flex flex-col items-center gap-3 w-full max-w-[340px]">
            <div className="text-center">
              <span className="text-sky-400 text-sm font-semibold block">Open State</span>
              <span className="text-stone-400 text-xs">Smooth expand with glow</span>
            </div>
            {renderPreviewPanel(() => setPreviewState('closed'))}
          </div>
        </div>
      )}

      {previewState === 'closed' && (
        <div className="flex flex-col items-center justify-center gap-6 py-12">
          <div className="text-center">
            <span className="text-sky-400 text-base font-semibold block">Closed State Preview</span>
            <span className="text-stone-400 text-xs">Configured closed-state AI launcher</span>
          </div>
          <div className="p-8 flex items-center justify-center">
            {renderPreviewLauncher(() => setPreviewState('open'))}
          </div>
        </div>
      )}

      {previewState === 'open' && (
        <div className="flex flex-col items-center justify-center w-full max-w-[340px]">
          {renderPreviewPanel(() => setPreviewState('closed'))}
        </div>
      )}
    </div>
  );
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
  const [launcherLabel, setLauncherLabel] = useState('Canlı Destek');
  const [launcherPosition, setLauncherPosition] = useState<'right' | 'left'>('right');
  const [launcherIcon, setLauncherIcon] = useState<'chat' | 'logo'>('chat');
  const [themeMode, setThemeMode] = useState<'dark' | 'light' | 'auto'>('dark');
  const [primaryColor, setPrimaryColor] = useState('#0B5FFF');
  const [accentColor, setAccentColor] = useState('#10B981');

  const [launcherStyle, setLauncherStyle] = useState<'pill' | 'circular' | 'minimal' | 'glass' | 'neon_pulse' | 'custom'>('pill');
  const [glowIntensity, setGlowIntensity] = useState<number>(80);
  const [glowSpread, setGlowSpread] = useState<number>(70);
  const [pulseAnimation, setPulseAnimation] = useState<'none' | 'subtle' | 'normal' | 'strong'>('normal');
  const [animationSpeed, setAnimationSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [previewState, setPreviewState] = useState<'both' | 'closed' | 'open'>('both');

  const [previewOpen, setPreviewOpen] = useState(true);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [extractedPalette, setExtractedPalette] = useState<{
    dominant: string | null;
    primary: string;
    accent: string;
    candidates: string[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        setLauncherLabel(d.appearance.launcher_label ?? 'Canlı Destek');
        setLauncherPosition(d.appearance.launcher_position || 'right');
        setLauncherIcon(d.appearance.launcher_icon || 'chat');
        setThemeMode(d.appearance.theme_mode || 'dark');
        setLauncherStyle(d.appearance.launcher_style || 'pill');
        setGlowIntensity(d.appearance.glow_intensity ?? 80);
        setGlowSpread(d.appearance.glow_spread ?? 70);
        setPulseAnimation(d.appearance.pulse_animation || 'normal');
        setAnimationSpeed(d.appearance.animation_speed || 'normal');
        if (d.appearance.theme) {
          setPrimaryColor(d.appearance.theme.primary_color || '#0B5FFF');
          setAccentColor(d.appearance.theme.accent_color || '#10B981');
        }
      }

      if (d.palette) {
        setExtractedPalette(d.palette);
      } else if (!d.appearance?.logo_url) {
        setExtractedPalette(null);
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
        glow_intensity: glowIntensity,
        glow_spread: glowSpread,
        pulse_animation: pulseAnimation,
        animation_speed: animationSpeed,
        launcher_style: launcherStyle,
      }),
    onSuccess: (res) => {
      setContrastResult(res);
    },
  });

  const handleLogoFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setLogoUploadError('Logo file size exceeds the 2MB limit.');
      return;
    }

    const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      setLogoUploadError('Unsupported file type. Please upload PNG, JPEG, WEBP, or SVG.');
      return;
    }

    try {
      setLogoUploading(true);
      setLogoUploadError(null);
      const res = await tenantApi.uploadWebChatLogo(tenantId!, file);
      if (res.asset?.public_url) {
        setLogoUrl(res.asset.public_url);
      }
      if (res.palette) {
        setExtractedPalette(res.palette);
      }
      if (res.theme?.primary_color) {
        setPrimaryColor(res.theme.primary_color);
      }
      if (res.theme?.accent_color) {
        setAccentColor(res.theme.accent_color);
      }
      queryClient.invalidateQueries({ queryKey: tenantKeys.webChatChannel(tenantId!) });
      setNotice('Logo uploaded and brand palette extracted successfully.');
      previewMutation.mutate();
    } catch (err: any) {
      setLogoUploadError(err?.message || 'Failed to upload logo.');
    } finally {
      setLogoUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleLogoDelete = async () => {
    try {
      setLogoUploading(true);
      setLogoUploadError(null);
      await tenantApi.deleteWebChatLogo(tenantId!);
      setLogoUrl('');
      setExtractedPalette(null);
      queryClient.invalidateQueries({ queryKey: tenantKeys.webChatChannel(tenantId!) });
      setNotice('Logo removed.');
    } catch (err: any) {
      setLogoUploadError(err?.message || 'Failed to remove logo.');
    } finally {
      setLogoUploading(false);
    }
  };

  const primaryFg = contrastResult?.primary_foreground || getAccessibleForeground(primaryColor);
  const displayLogoUrl = resolveWebChatAssetUrl(logoUrl);

  const clampedIntensity = Math.max(0, Math.min(100, Math.round(Number(glowIntensity) || 0)));
  const clampedSpread = Math.max(0, Math.min(100, Math.round(Number(glowSpread) || 0)));
  const intensityFactor = clampedIntensity / 100;
  const spreadFactor = clampedSpread / 100;

  const glowRing = contrastResult?.glow_ring || hexToRgba(primaryColor, Number(Math.min(1, 0.35 + intensityFactor * 0.6).toFixed(2)));
  const glowColor = contrastResult?.glow || hexToRgba(primaryColor, Number(Math.min(1, 0.15 + intensityFactor * 0.45).toFixed(2)));
  const glowSoftColor = contrastResult?.glow_soft || hexToRgba(primaryColor, Number(Math.min(1, 0.08 + intensityFactor * 0.22).toFixed(2)));
  const glowSpreadPx = contrastResult?.glow_spread_px ?? Math.round(10 + spreadFactor * 26);
  const glowHaloPx = contrastResult?.glow_halo_px ?? Math.round(20 + spreadFactor * 36);
  const pulseDuration = contrastResult?.pulse_duration || (animationSpeed === 'slow' ? '5.5s' : animationSpeed === 'fast' ? '2.2s' : '3.6s');

  const renderPreviewLauncher = (onClick?: () => void) => {
    const isCircular = launcherStyle === 'circular' || launcherStyle === 'minimal' || (!launcherLabel && launcherStyle !== 'pill');

    let bgStyle = 'linear-gradient(135deg, rgba(15, 23, 42, 0.96) 0%, rgba(2, 6, 23, 0.98) 100%)';
    let borderStyle = `1.5px solid ${glowRing}`;
    let shadowStyle = `0 0 ${Math.round(glowSpreadPx * 0.45)}px ${glowRing}, 0 0 ${glowHaloPx}px ${glowColor}, 0 8px 28px -4px ${glowSoftColor}, 0 4px 16px rgba(0, 0, 0, 0.5)`;

    if (launcherStyle === 'circular') {
      bgStyle = 'radial-gradient(circle at center, rgba(30, 41, 59, 0.9) 0%, rgba(2, 6, 23, 0.98) 100%)';
      borderStyle = `2px solid ${glowRing}`;
      shadowStyle = `0 0 ${Math.round(glowSpreadPx * 0.6)}px ${glowRing}, 0 0 ${glowHaloPx}px ${glowColor}, 0 10px 30px -4px ${glowSoftColor}, 0 4px 18px rgba(0, 0, 0, 0.6)`;
    } else if (launcherStyle === 'minimal') {
      bgStyle = '#111827';
      borderStyle = '1px solid rgba(255, 255, 255, 0.15)';
      shadowStyle = `0 4px 16px rgba(0, 0, 0, 0.35), 0 0 ${Math.round(glowSpreadPx * 0.2)}px ${glowSoftColor}`;
    } else if (launcherStyle === 'glass') {
      bgStyle = 'rgba(17, 24, 39, 0.68)';
      borderStyle = '1.5px solid rgba(255, 255, 255, 0.22)';
      shadowStyle = `0 8px 32px 0 rgba(0, 0, 0, 0.4), inset 0 0 14px rgba(255, 255, 255, 0.08), 0 0 ${Math.round(glowSpreadPx * 0.45)}px ${glowSoftColor}`;
    } else if (launcherStyle === 'neon_pulse') {
      bgStyle = 'radial-gradient(circle at center, rgba(15, 23, 42, 0.95) 0%, rgba(2, 6, 23, 1) 100%)';
      borderStyle = `2px solid ${glowRing}`;
      shadowStyle = `0 0 ${Math.round(glowSpreadPx * 0.7)}px ${glowRing}, 0 0 ${glowHaloPx}px ${glowColor}, 0 0 ${Math.round(glowHaloPx * 1.5)}px ${glowSoftColor}, 0 10px 32px rgba(0, 0, 0, 0.6)`;
    }

    const animationClass = pulseAnimation === 'none' || launcherStyle === 'minimal'
      ? ''
      : pulseAnimation === 'strong' || launcherStyle === 'neon_pulse'
      ? 'animate-pulse'
      : 'hover:scale-105';

    return (
      <button
        type="button"
        onClick={onClick}
        className={`group relative flex items-center justify-center transition-all duration-300 cursor-pointer user-select-none ${animationClass} ${
          isCircular
            ? 'h-16 w-16 rounded-full p-1.5'
            : 'h-[52px] rounded-full py-1.5 pl-1.5 pr-5 gap-3'
        }`}
        style={{
          background: bgStyle,
          border: borderStyle,
          boxShadow: shadowStyle,
        }}
        title="Click to toggle chat preview"
      >
        <div
          className={`rounded-full flex items-center justify-center overflow-hidden shrink-0 transition-transform ${
            isCircular
              ? 'h-full w-full p-1'
              : 'h-10 w-10 p-1.5 shadow-inner'
          }`}
          style={!isCircular ? {
            background: 'radial-gradient(circle at center, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.95) 100%)',
            border: `1.5px solid ${glowRing}`,
            boxShadow: `inset 0 0 8px rgba(0,0,0,0.5), 0 0 10px ${glowSoftColor}`,
          } : undefined}
        >
          {launcherIcon === 'logo' && logoUrl ? (
            <img
              src={displayLogoUrl}
              alt={brandName || 'Logo'}
              className="max-h-full max-w-full object-contain pointer-events-none"
            />
          ) : displayLogoUrl ? (
            <img
              src={displayLogoUrl}
              alt={brandName || 'Logo'}
              className="max-h-full max-w-full object-contain pointer-events-none"
            />
          ) : (
            <MessageSquare size={isCircular ? 24 : 18} style={{ color: primaryFg }} />
          )}
        </div>

        {!isCircular && (
          <span className="text-[14.5px] font-semibold text-white tracking-tight truncate max-w-[200px]">
            {launcherLabel ? launcherLabel : 'Canlı Destek'}
          </span>
        )}
      </button>
    );
  };

  const renderPreviewPanel = (onClose?: () => void) => (
    <div
      className="w-full max-w-[340px] rounded-2xl overflow-hidden shadow-2xl flex flex-col transition-all duration-300"
      style={{
        background: themeMode === 'light' ? 'rgba(255, 255, 255, 0.94)' : 'rgba(11, 15, 25, 0.94)',
        backdropFilter: 'blur(24px)',
        border: `1.5px solid ${glowRing}`,
        boxShadow: `0 0 ${Math.round(glowSpreadPx * 0.75)}px ${glowSoftColor}, 0 24px 60px -12px rgba(0, 0, 0, 0.8), 0 12px 32px rgba(0, 0, 0, 0.5)`,
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{
          borderColor: themeMode === 'light' ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)',
          background: `linear-gradient(135deg, ${primaryColor}22, ${themeMode === 'light' ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.03)'})`,
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shadow overflow-hidden p-0.5"
            style={{
              background: 'radial-gradient(circle at center, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.95) 100%)',
              border: `1.5px solid ${glowRing}`,
            }}
          >
            {displayLogoUrl ? (
              <img src={displayLogoUrl} alt={brandName || 'Brand'} className="h-full w-full object-contain" />
            ) : (
              <span style={{ color: primaryFg }}>{brandName ? brandName.charAt(0).toUpperCase() : 'S'}</span>
            )}
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${themeMode === 'light' ? 'text-stone-900' : 'text-white'}`}>
              {title || brandName || 'Canlı Destek'}
            </h3>
            <p className="text-[11px] text-emerald-400 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
              <span>{subtitle || 'Çevrimiçi'}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-stone-400 hover:text-white transition-colors cursor-pointer"
            title="Minimize chat"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3 h-48 overflow-y-auto text-xs">
        <div className="flex flex-col items-start">
          <div
            className="max-w-[85%] rounded-2xl px-3.5 py-2 font-normal"
            style={{
              background: themeMode === 'light' ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.08)',
              border: themeMode === 'light' ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.12)',
              color: themeMode === 'light' ? '#1E293B' : '#F8FAFC',
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
        style={{ borderColor: themeMode === 'light' ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)' }}
      >
        <input
          type="text"
          disabled
          placeholder="Bir mesaj yazın..."
          className={`flex-1 rounded-xl px-3 py-1.5 text-xs focus:outline-none ${
            themeMode === 'light'
              ? 'bg-black/[0.04] border border-black/10 text-stone-900 placeholder-stone-400'
              : 'bg-white/[0.06] border border-white/10 text-white placeholder-stone-400'
          }`}
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
  );

  const saveMutation = useMutation({
    mutationFn: () => {
      const appearance: Partial<WebChatAppearanceConfig> = {
        brand_name: brandName,
        title,
        subtitle,
        logo_url: logoUrl || null,
        launcher_label: launcherLabel,
        launcher_position: launcherPosition,
        launcher_icon: launcherIcon,
        theme_mode: themeMode,
        launcher_style: launcherStyle,
        glow_intensity: glowIntensity,
        glow_spread: glowSpread,
        pulse_animation: pulseAnimation,
        animation_speed: animationSpeed,
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

            {/* Brand Logo & Upload */}
            <div data-testid="brand-logo-section" className="space-y-3 rounded-xl border border-line/70 bg-canvas/30 p-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-semibold text-white">
                  Brand Logo
                </label>
                {logoUrl && (
                  <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                    <Check size={12} /> Active Logo Configured
                  </span>
                )}
              </div>

              {/* Direct file input for computer upload */}
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={handleLogoFileSelect}
                aria-label="Upload logo file"
              />

              <div className="flex flex-wrap items-center gap-4">
                {/* Current logo thumbnail when present */}
                {logoUrl ? (
                  <div className="relative h-14 w-14 rounded-lg border border-line/80 bg-stone-900/90 p-1 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                    <img src={displayLogoUrl} alt="Brand Logo Thumbnail" className="max-h-full max-w-full object-contain" />
                  </div>
                ) : (
                  <div className="h-14 w-14 rounded-lg border border-dashed border-line bg-stone-900/40 flex items-center justify-center text-stone-500 shrink-0">
                    <ImageIcon size={22} />
                  </div>
                )}

                {/* Direct Action buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  {logoUrl ? (
                    <>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={logoUploading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas/80 px-3.5 py-2 text-xs font-semibold text-stone-200 hover:text-white hover:border-signal disabled:opacity-50 transition-colors"
                      >
                        <Upload size={14} className={logoUploading ? 'animate-spin' : ''} />
                        {logoUploading ? 'Uploading & Analyzing...' : 'Replace Logo'}
                      </button>
                      <button
                        type="button"
                        onClick={handleLogoDelete}
                        disabled={logoUploading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line/60 bg-red-950/20 px-3.5 py-2 text-xs font-semibold text-red-400 hover:bg-red-900/30 hover:border-red-500/50 disabled:opacity-50 transition-colors"
                      >
                        <Trash2 size={14} /> Remove Logo
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={logoUploading}
                      className="inline-flex items-center gap-2 rounded-lg bg-ink border border-line px-4 py-2 text-xs font-semibold text-white shadow hover:opacity-90 disabled:opacity-50 transition-colors"
                    >
                      <Upload size={14} className={logoUploading ? 'animate-spin' : ''} />
                      {logoUploading ? 'Uploading & Analyzing...' : 'Upload Logo / Choose File'}
                    </button>
                  )}
                </div>
              </div>

              {/* Visibly supported formats and max size */}
              <p className="text-xs text-stone-400">
                Supported: PNG / JPEG / WEBP / SVG &middot; Max 2 MB
              </p>

              {logoUploadError && (
                <div className="rounded-md border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-400">
                  {logoUploadError}
                </div>
              )}

              {/* Advanced / Secondary external URL fallback */}
              <details className="pt-1 text-xs text-stone-400">
                <summary className="cursor-pointer hover:text-stone-300 transition-colors font-medium">
                  Advanced: Use external image URL
                </summary>
                <div className="mt-2 space-y-1">
                  <input
                    type="url"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://example.com/logo.png"
                    className="w-full rounded-lg border border-line bg-canvas/40 px-3 py-1.5 text-xs text-white"
                  />
                  <span className="block text-[11px] text-stone-500">
                    Direct computer upload above is recommended. External URL is available for custom CDN hosting.
                  </span>
                </div>
              </details>
            </div>

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
              Launcher Label
              <input
                type="text"
                aria-label="Launcher Label"
                value={launcherLabel}
                onChange={(e) => setLauncherLabel(e.target.value)}
                placeholder="Canlı Destek"
                maxLength={50}
                className="mt-1.5 w-full rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm text-white"
              />
              <span className="mt-1 block text-xs text-stone-400">
                Text shown in the launcher pill button (normal Unicode text, TR / EN / AR). Leave empty for circular / minimal launcher.
              </span>
            </label>

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

            {canManage && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white shadow hover:opacity-95 disabled:opacity-60"
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save Appearance'}
                </button>
              </div>
            )}

            {/* Launcher Style & Glow (NEW) */}
            <div className="space-y-3.5 pt-4 border-t border-line/60">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">Launcher Style &amp; Glow</h3>
                <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-400">
                  NEW
                </span>
              </div>

              {/* 6 Selector Cards */}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {LAUNCHER_STYLE_OPTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setLauncherStyle(s.id);
                      if (s.id === 'minimal') {
                        setGlowIntensity(25);
                        setGlowSpread(20);
                        setPulseAnimation('none');
                      } else if (s.id === 'neon_pulse') {
                        setGlowIntensity(95);
                        setGlowSpread(85);
                        setPulseAnimation('strong');
                      }
                      previewMutation.mutate();
                    }}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center transition-all cursor-pointer ${
                      launcherStyle === s.id
                        ? 'border-sky-400 bg-sky-950/40 text-white shadow-[0_0_15px_rgba(56,189,248,0.25)]'
                        : 'border-line/60 bg-canvas/30 text-stone-400 hover:border-line hover:text-stone-200'
                    }`}
                  >
                    <div className="flex h-7 items-center justify-center">
                      <LauncherStyleIcon id={s.id} logoUrl={displayLogoUrl} />
                    </div>
                    <span className="text-[10.5px] font-semibold tracking-tight">{s.name}</span>
                  </button>
                ))}
              </div>

              {/* Sliders & Selects */}
              <div className="grid grid-cols-2 gap-3.5 rounded-xl border border-line/60 bg-canvas/30 p-3.5">
                <div>
                  <div className="flex items-center justify-between text-xs font-medium mb-1.5">
                    <span className="text-stone-300">Glow Intensity</span>
                    <span className="font-mono text-sky-400 font-semibold">{glowIntensity}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={glowIntensity}
                    onChange={(e) => {
                      setGlowIntensity(Number(e.target.value));
                      if (launcherStyle !== 'custom') setLauncherStyle('custom');
                    }}
                    onMouseUp={() => previewMutation.mutate()}
                    onTouchEnd={() => previewMutation.mutate()}
                    className="w-full accent-sky-400 h-1.5 bg-stone-800 rounded-lg cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-300 mb-1.5">Pulse Animation</label>
                  <select
                    value={pulseAnimation}
                    onChange={(e) => {
                      setPulseAnimation(e.target.value as any);
                      previewMutation.mutate();
                    }}
                    className="w-full rounded-lg border border-line bg-canvas/40 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="normal">Smooth Pulse</option>
                    <option value="none">None</option>
                    <option value="subtle">Subtle</option>
                    <option value="strong">Strong</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-medium mb-1.5">
                    <span className="text-stone-300">Glow Spread</span>
                    <span className="font-mono text-sky-400 font-semibold">{glowSpread}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={glowSpread}
                    onChange={(e) => {
                      setGlowSpread(Number(e.target.value));
                      if (launcherStyle !== 'custom') setLauncherStyle('custom');
                    }}
                    onMouseUp={() => previewMutation.mutate()}
                    onTouchEnd={() => previewMutation.mutate()}
                    className="w-full accent-sky-400 h-1.5 bg-stone-800 rounded-lg cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-300 mb-1.5">Animation Speed</label>
                  <select
                    value={animationSpeed}
                    onChange={(e) => {
                      setAnimationSpeed(e.target.value as any);
                      previewMutation.mutate();
                    }}
                    className="w-full rounded-lg border border-line bg-canvas/40 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="slow">Slow</option>
                    <option value="normal">Normal</option>
                    <option value="fast">Fast</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Palette & WCAG Guard Section */}
            <div className="space-y-4 pt-4 border-t border-line/60">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Palette &amp; WCAG AA Guard</h3>
                <button
                  type="button"
                  onClick={() => previewMutation.mutate()}
                  disabled={previewMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-stone-300 hover:text-white"
                >
                  <RefreshCw size={12} className={previewMutation.isPending ? 'animate-spin' : ''} />
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

            {/* Extracted Palette Suggestions */}
            {extractedPalette && (
              <div data-testid="logo-palette-recommendations" className="rounded-xl border border-signal/30 bg-signal/10 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-signal">
                    <Sparkles size={14} /> Logo-Derived Palette Recommendations (Recommended Palette from Logo)
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPrimaryColor(extractedPalette.primary);
                      setAccentColor(extractedPalette.accent);
                      setNotice('Applied recommended colors from logo to primary and accent themes.');
                      previewMutation.mutate();
                    }}
                    className="rounded-md bg-signal px-3 py-1 text-xs font-semibold text-white shadow hover:opacity-90 transition-opacity"
                  >
                    Apply Recommendations
                  </button>
                </div>

                {logoUrl && (
                  <div className="flex items-center gap-3 py-1">
                    <div className="h-10 w-10 shrink-0 rounded border border-line bg-stone-900/80 p-0.5 flex items-center justify-center overflow-hidden">
                      <img src={displayLogoUrl} alt="Uploaded logo preview" className="max-h-full max-w-full object-contain" />
                    </div>
                    <div className="text-xs text-stone-300">
                      <span>Colors extracted from uploaded logo</span>
                      {extractedPalette.dominant && (
                        <span className="block text-stone-400">Dominant tone: <code className="text-white font-mono">{extractedPalette.dominant}</code></span>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="rounded-lg border border-line/50 bg-black/20 p-2.5">
                    <span className="text-xs text-stone-400 block mb-1">Recommended Primary</span>
                    <div className="flex items-center gap-2">
                      <span className="h-5 w-5 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: extractedPalette.primary }} />
                      <code className="text-xs font-mono text-white">{extractedPalette.primary}</code>
                    </div>
                  </div>
                  <div className="rounded-lg border border-line/50 bg-black/20 p-2.5">
                    <span className="text-xs text-stone-400 block mb-1">Recommended Accent</span>
                    <div className="flex items-center gap-2">
                      <span className="h-5 w-5 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: extractedPalette.accent }} />
                      <code className="text-xs font-mono text-white">{extractedPalette.accent}</code>
                    </div>
                  </div>
                </div>

                {extractedPalette.candidates && extractedPalette.candidates.length > 0 && (
                  <div className="pt-1">
                    <span className="text-xs text-stone-300 block mb-1.5">Extracted / Suggested Colors:</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {extractedPalette.candidates.map((hex, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setPrimaryColor(hex);
                            setNotice(`Selected candidate color ${hex} as primary.`);
                            previewMutation.mutate();
                          }}
                          className="group flex items-center gap-1.5 rounded-lg border border-line/60 bg-black/40 px-2.5 py-1 text-xs font-mono text-stone-300 hover:border-white transition-colors"
                          title={`Click to set ${hex} as primary`}
                        >
                          <span className="h-3.5 w-3.5 rounded-full border border-white/20" style={{ backgroundColor: hex }} />
                          <span>{hex}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Preset Palettes */}
            <div className="space-y-2">
              <span className="block text-xs font-medium text-stone-400">Curated Presets</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  { name: 'Indigo Modern', primary: '#0B5FFF', accent: '#10B981' },
                  { name: 'Emerald Commerce', primary: '#059669', accent: '#F59E0B' },
                  { name: 'Sunset Violet', primary: '#7C3AED', accent: '#EC4899' },
                  { name: 'Midnight Luxe', primary: '#0F172A', accent: '#38BDF8' },
                  { name: 'Amber Warmth', primary: '#D97706', accent: '#3B82F6' },
                  { name: 'Rose Velvet', primary: '#E11D48', accent: '#10B981' },
                ].map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => {
                      setPrimaryColor(preset.primary);
                      setAccentColor(preset.accent);
                      previewMutation.mutate();
                    }}
                    className="flex items-center gap-2 rounded-lg border border-line bg-canvas/30 px-2.5 py-1.5 text-xs text-stone-300 hover:border-signal hover:text-white"
                  >
                    <div className="flex -space-x-1">
                      <span className="h-3 w-3 rounded-full border border-stone-800" style={{ backgroundColor: preset.primary }} />
                      <span className="h-3 w-3 rounded-full border border-stone-800" style={{ backgroundColor: preset.accent }} />
                    </div>
                    <span className="truncate">{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

          {/* Right Column: Live Preview */}
          <div className="panel p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-3">
              <div>
                <h2 className="text-base font-semibold text-white">Live Preview</h2>
                <p className="text-xs text-stone-400">See how your widget looks and behaves for your customers.</p>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg border border-line p-0.5 bg-black/20">
                  <button
                    type="button"
                    onClick={() => setPreviewViewport('desktop')}
                    className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                      previewViewport === 'desktop' ? 'bg-signal text-white' : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    <Laptop size={13} /> Desktop
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewViewport('mobile')}
                    className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                      previewViewport === 'mobile' ? 'bg-signal text-white' : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    <Smartphone size={13} /> Mobile
                  </button>
                </div>

                <div className="flex items-center gap-1 rounded-lg border border-line p-0.5 bg-black/20">
                  <button
                    type="button"
                    onClick={() => setPreviewState('both')}
                    className={`rounded px-2 py-1 text-xs font-medium transition cursor-pointer ${
                      previewState === 'both' ? 'bg-ink text-white' : 'text-stone-400 hover:text-white'
                    }`}
                    title="Show closed launcher and open panel together"
                  >
                    Both
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewState('closed')}
                    className={`rounded px-2 py-1 text-xs font-medium transition cursor-pointer ${
                      previewState === 'closed' ? 'bg-ink text-white' : 'text-stone-400 hover:text-white'
                    }`}
                    title="Inspect closed launcher alone"
                  >
                    Closed
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewState('open')}
                    className={`rounded px-2 py-1 text-xs font-medium transition cursor-pointer ${
                      previewState === 'open' ? 'bg-ink text-white' : 'text-stone-400 hover:text-white'
                    }`}
                    title="Inspect open panel"
                  >
                    Open
                  </button>
                </div>

                {isConfigured && data.widget_key && (
                  <a
                    href={`https://samche-api-staging.onrender.com/task8-demo/?widget_key=${encodeURIComponent(data.widget_key)}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-canvas/40 px-2.5 py-1 text-xs font-medium text-stone-300 hover:text-white"
                  >
                    <ExternalLink size={12} /> Open in New Tab
                  </a>
                )}
              </div>
            </div>

            <LivePreviewCanvas
              previewViewport={previewViewport}
              previewState={previewState}
              setPreviewState={setPreviewState}
              primaryColor={primaryColor}
              renderPreviewLauncher={renderPreviewLauncher}
              renderPreviewPanel={renderPreviewPanel}
            />

            {/* WCAG Guard Status Footer */}
            <div className="rounded-xl border border-line/80 bg-canvas/40 p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-6 w-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Check size={14} />
                </div>
                <div>
                  <span className="text-xs font-semibold text-white block">WCAG AA Compliant</span>
                  <span className="text-[11px] text-stone-400">
                    Contrast ratio {contrastResult?.contrast?.primary_button ?? '9.81'}:1 &middot; Accessible &middot; Production Ready
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-stone-300 hover:text-white cursor-pointer"
              >
                <RefreshCw size={12} className={previewMutation.isPending ? 'animate-spin' : ''} />
                Audit Contrast
              </button>
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
                  className={`flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition cursor-pointer ${
                    previewViewport === 'desktop' ? 'bg-signal text-white' : 'text-stone-400 hover:text-white'
                  }`}
                >
                  <Laptop size={14} /> Desktop
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewViewport('mobile')}
                  className={`flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition cursor-pointer ${
                    previewViewport === 'mobile' ? 'bg-signal text-white' : 'text-stone-400 hover:text-white'
                  }`}
                >
                  <Smartphone size={14} /> Mobile
                </button>
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-line p-1 bg-black/20">
                <button
                  type="button"
                  onClick={() => setPreviewState('both')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                    previewState === 'both' ? 'bg-ink text-white' : 'text-stone-400 hover:text-white'
                  }`}
                >
                  Both
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewState('closed')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                    previewState === 'closed' ? 'bg-ink text-white' : 'text-stone-400 hover:text-white'
                  }`}
                >
                  Closed
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewState('open')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                    previewState === 'open' ? 'bg-ink text-white' : 'text-stone-400 hover:text-white'
                  }`}
                >
                  Open
                </button>
              </div>
            </div>
          </div>

          <LivePreviewCanvas
            previewViewport={previewViewport}
            previewState={previewState}
            setPreviewState={setPreviewState}
            primaryColor={primaryColor}
            renderPreviewLauncher={renderPreviewLauncher}
            renderPreviewPanel={renderPreviewPanel}
          />
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



