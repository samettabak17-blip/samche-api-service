import React, { useState } from 'react';
import { resolveWebChatAssetUrl } from '../../lib/branding';
import {
  CANONICAL_WIDGET_CSS,
  CANONICAL_I18N,
  CHAT_ICON_SVG,
  CLOSE_ICON_SVG,
  MINIMIZE_ICON_SVG,
  SEND_ICON_SVG,
  TRASH_ICON_SVG,
  deriveCanonicalDesignTokens,
  getEffectiveLocale,
} from './web-chat-canonical-contract';

export interface WebChatPreviewRendererProps {
  viewport: 'desktop' | 'mobile';
  state: 'both' | 'closed' | 'open';
  onStateChange?: (s: 'both' | 'closed' | 'open') => void;
  brandName?: string;
  title?: string;
  subtitle?: string;
  logoUrl?: string | null;
  launcherLabel?: string;
  launcherPosition?: 'right' | 'left';
  launcherIcon?: 'chat' | 'logo';
  themeMode?: 'dark' | 'light' | 'auto';
  launcherStyle?: 'pill' | 'circular' | 'minimal' | 'glass' | 'neon_pulse' | 'custom';
  glowIntensity?: number;
  glowSpread?: number;
  pulseAnimation?: 'none' | 'subtle' | 'normal' | 'strong';
  animationSpeed?: 'slow' | 'normal' | 'fast';
  primaryColor?: string;
  accentColor?: string;
  language?: string;
  launcherThemeMode?: 'auto_brand' | 'follow_theme' | 'custom';
  launcherBg?: string | null;
  launcherText?: string | null;
  launcherBorder?: string | null;
  launcherGlow?: string | null;
}

export function WebChatPreviewRenderer({
  viewport,
  state,
  onStateChange,
  brandName = 'SamChe Teknoloji',
  title = '',
  subtitle = '',
  logoUrl = null,
  launcherLabel = 'Canlı Destek',
  launcherPosition = 'right',
  themeMode = 'dark',
  launcherStyle = 'pill',
  glowIntensity = 80,
  glowSpread = 70,
  pulseAnimation = 'normal',
  animationSpeed = 'normal',
  primaryColor = '#0B5FFF',
  accentColor = '#10B981',
  language = 'auto',
  launcherThemeMode = 'follow_theme',
  launcherBg = null,
  launcherText = null,
  launcherBorder = null,
  launcherGlow = null,
}: WebChatPreviewRendererProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const tokens = deriveCanonicalDesignTokens({
    primaryColor,
    accentColor,
    mode: themeMode,
    glowIntensity,
    glowSpread,
    pulseAnimation,
    animationSpeed,
    launcherStyle,
    launcherThemeMode,
    launcherBg,
    launcherText,
    launcherBorder,
    launcherGlow,
  });

  const locale = getEffectiveLocale(language);
  const dict = CANONICAL_I18N[locale] || CANONICAL_I18N.tr;
  const isRtl = locale === 'ar';

  const displayTitle = title || dict.defaultTitle;
  const displaySubtitle = subtitle || dict.defaultStatus;
  const displayLabel = launcherLabel !== undefined ? launcherLabel : dict.defaultLauncherLabel;
  const displayLogoUrl = logoUrl ? resolveWebChatAssetUrl(logoUrl) : null;
  const isCircular = launcherStyle === 'circular' || launcherStyle === 'minimal' || (!displayLabel && launcherStyle !== 'pill');

  const cssVars = {
    '--chat-primary': tokens.primary,
    '--chat-primary-foreground': tokens.primary_foreground,
    '--chat-accent': tokens.accent,
    '--chat-surface-tint': tokens.surface_tint,
    '--chat-surface-solid': tokens.surface_solid,
    '--chat-surface-glass': tokens.surface_glass,
    '--chat-glow': tokens.glow,
    '--chat-glow-soft': tokens.glow_soft,
    '--chat-glow-ring': tokens.glow_ring,
    '--chat-glow-spread': `${tokens.glow_spread_px}px`,
    '--chat-glow-halo': `${tokens.glow_halo_px}px`,
    '--chat-pulse-duration': tokens.pulse_duration,
    '--chat-launcher-text': tokens.launcher_text,
    '--chat-launcher-bg': tokens.launcher_bg,
    '--chat-launcher-border': tokens.launcher_border,
    '--chat-launcher-glow': tokens.launcher_glow,
    '--chat-text': tokens.text,
    '--chat-muted': tokens.muted,
    '--chat-border': tokens.border,
    '--chat-input-bg': tokens.input_bg,
    '--chat-input-border': tokens.input_border,
    '--chat-bot-bubble-bg': tokens.bot_bubble_bg,
    '--chat-bot-bubble-border': tokens.bot_bubble_border,
  } as React.CSSProperties;

  const renderLauncher = () => (
    <button
      type="button"
      data-testid="preview-canonical-launcher"
      onClick={() => onStateChange?.('open')}
      className={`samche-launcher samche-style-${launcherStyle.replace(/_/g, '-')} samche-style-${launcherStyle}${isCircular ? ' samche-launcher-circle' : ''} samche-pulse-${pulseAnimation}`}
      aria-label={!isCircular && displayLabel ? displayLabel : displayTitle}
      title="Click to preview open chat"
    >
      <span className="samche-launcher-badge">
        {displayLogoUrl ? (
          <img className="samche-launcher-logo" src={displayLogoUrl} alt={brandName || 'Logo'} />
        ) : (
          <span className="samche-launcher-icon" dangerouslySetInnerHTML={{ __html: CHAT_ICON_SVG }} />
        )}
      </span>
      {!isCircular && displayLabel && (
        <span className="samche-launcher-label">{displayLabel}</span>
      )}
    </button>
  );

  const renderPanel = () => (
    <div
      data-testid="preview-canonical-panel"
      className="samche-panel samche-open"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="samche-header">
        <div className="samche-header-info">
          <div className="samche-header-avatar">
            {displayLogoUrl ? (
              <img src={displayLogoUrl} alt={brandName || 'Brand'} />
            ) : (
              <span className="samche-avatar-icon" dangerouslySetInnerHTML={{ __html: CHAT_ICON_SVG }} />
            )}
          </div>
          <div className="samche-header-titles">
            <span className="samche-header-title">{displayTitle}</span>
            <span className="samche-header-status">
              <span className="samche-status-dot" />
              <span className="samche-status-text">{displaySubtitle}</span>
            </span>
          </div>
        </div>
        <div className="samche-header-actions">
          <button
            type="button"
            className="samche-clear-btn"
            aria-label={dict.clearBtnLabel}
            title={dict.clearBtnLabel}
            onClick={() => setShowConfirm(true)}
            dangerouslySetInnerHTML={{ __html: TRASH_ICON_SVG }}
          />
          <button
            type="button"
            className="samche-minimize-btn"
            aria-label={dict.minimizeBtnLabel}
            title={dict.minimizeBtnLabel}
            onClick={() => onStateChange?.('closed')}
            dangerouslySetInnerHTML={{ __html: MINIMIZE_ICON_SVG }}
          />
          <button
            type="button"
            className="samche-close-btn"
            aria-label={dict.closeBtnLabel}
            title={dict.closeBtnLabel}
            onClick={() => onStateChange?.('closed')}
            dangerouslySetInnerHTML={{ __html: CLOSE_ICON_SVG }}
          />
        </div>
      </div>

      {showConfirm && (
        <div className="samche-confirm-dialog" role="alertdialog">
          <div className="samche-confirm-content">
            <p className="samche-confirm-message">{dict.confirmText}</p>
            <div className="samche-confirm-buttons">
              <button
                type="button"
                className="samche-confirm-btn samche-confirm-cancel"
                onClick={() => setShowConfirm(false)}
              >
                {dict.cancelBtn}
              </button>
              <button
                type="button"
                className="samche-confirm-btn samche-confirm-proceed"
                onClick={() => setShowConfirm(false)}
              >
                {dict.clearBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="samche-messages">
        <div className="samche-msg samche-msg-bot">
          <span>{dict.botGreeting}</span>
        </div>
        <div className="samche-msg samche-msg-user">
          <span>{dict.userSample}</span>
        </div>
      </div>

      <div className="samche-composer">
        <textarea
          className="samche-composer-input"
          rows={1}
          placeholder={dict.composerPlaceholder}
          disabled
        />
        <button
          type="button"
          className="samche-send-btn"
          aria-label={dict.sendLabel}
          title={dict.sendLabel}
          dangerouslySetInnerHTML={{ __html: SEND_ICON_SVG }}
        />
      </div>
    </div>
  );

  const renderMobileDevice = (mode: 'closed' | 'open') => (
    <div className="relative mx-auto w-[360px] h-[640px] rounded-[38px] border-4 border-stone-700 bg-slate-950 shadow-2xl overflow-hidden flex flex-col shrink-0">
      <div className="h-6 w-full bg-black/60 flex items-center justify-between px-6 text-[10px] text-stone-400 select-none shrink-0 z-30">
        <span>9:41</span>
        <div className="h-2 w-16 bg-stone-800 rounded-full" />
        <span>5G 100%</span>
      </div>

      <div className="relative flex-1 w-full overflow-hidden bg-gradient-to-b from-slate-900 to-slate-950 p-4 select-none pointer-events-none opacity-80">
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-[10px] text-sky-400 font-bold">
              {displayLogoUrl ? <img src={displayLogoUrl} alt="logo" className="w-4 h-4 object-contain" /> : 'S'}
            </div>
            <span className="text-xs font-semibold text-stone-200 tracking-tight">{brandName || 'SamChe Teknoloji'}</span>
          </div>
          <div className="flex flex-col gap-1 w-3.5 text-stone-400">
            <span className="h-0.5 w-full bg-stone-400 rounded" />
            <span className="h-0.5 w-full bg-stone-400 rounded" />
          </div>
        </div>
        <div className="rounded-xl bg-gradient-to-r from-sky-950/40 to-slate-800/40 border border-white/5 p-3 mb-3">
          <div className="h-2 w-16 bg-sky-400/40 rounded mb-1.5" />
          <div className="h-3 w-4/5 bg-white/25 rounded mb-1" />
          <div className="h-2 w-2/3 bg-white/10 rounded" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-stone-900/60 border border-white/5 p-2 flex flex-col justify-between h-24">
            <div className="w-full h-12 bg-white/5 rounded-md" />
            <div className="h-2 w-3/4 bg-white/20 rounded mt-1" />
            <div className="h-2 w-1/2 bg-sky-400/30 rounded" />
          </div>
          <div className="rounded-lg bg-stone-900/60 border border-white/5 p-2 flex flex-col justify-between h-24">
            <div className="w-full h-12 bg-white/5 rounded-md" />
            <div className="h-2 w-3/4 bg-white/20 rounded mt-1" />
            <div className="h-2 w-1/2 bg-sky-400/30 rounded" />
          </div>
        </div>
      </div>

      <div
        className="samche-preview-mount samche-preview-mobile absolute inset-0 w-full h-full pointer-events-none"
        style={cssVars}
      >
        <div className="samche-wrap h-full w-full">
          {mode === 'closed' && (
            <div
              className="absolute bottom-4 right-4 z-10 pointer-events-auto"
              style={launcherPosition === 'left' ? { left: '16px', right: 'auto' } : {}}
            >
              {renderLauncher()}
            </div>
          )}
          {mode === 'open' && (
            <div
              className="absolute bottom-4 right-4 left-4 z-20 pointer-events-auto flex justify-end"
              style={launcherPosition === 'left' ? { justifyContent: 'flex-start' } : {}}
            >
              {renderPanel()}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="samche-preview-root relative w-full rounded-2xl border border-line/80 overflow-hidden p-6 flex items-center justify-center transition-all duration-300"
      style={{
        ...cssVars,
        background: `radial-gradient(circle at 65% 35%, ${tokens.primary}18 0%, #050814 60%, #02040a 100%)`,
      }}
    >
      <style>{CANONICAL_WIDGET_CSS}</style>

      {viewport === 'desktop' ? (
        <div className="samche-preview-mount w-full min-h-[660px] flex items-center justify-center p-4">
          <div className="samche-wrap w-full flex flex-col md:flex-row items-center justify-around gap-8">
            {state === 'both' && (
              <>
                <div className="flex flex-col items-center gap-4">
                  <div className="text-center">
                    <span className="text-sky-400 text-sm font-semibold block">Closed State</span>
                    <span className="text-stone-400 text-xs">Canonical launcher with live glow</span>
                  </div>
                  <div className="p-4 flex items-center justify-center min-h-[100px]">
                    {renderLauncher()}
                  </div>
                </div>

                <div className="flex flex-col items-center gap-3 w-full max-w-[420px]">
                  <div className="text-center">
                    <span className="text-sky-400 text-sm font-semibold block">Open State</span>
                    <span className="text-stone-400 text-xs">Canonical 400x600 glass panel</span>
                  </div>
                  {renderPanel()}
                </div>
              </>
            )}

            {state === 'closed' && (
              <div className="flex flex-col items-center justify-center gap-6 py-12">
                <div className="text-center">
                  <span className="text-sky-400 text-base font-semibold block">Closed State Preview</span>
                  <span className="text-stone-400 text-xs">Configured closed-state AI launcher</span>
                </div>
                <div className="p-8 flex items-center justify-center min-h-[140px]">
                  {renderLauncher()}
                </div>
              </div>
            )}

            {state === 'open' && (
              <div className="flex flex-col items-center justify-center w-full max-w-[420px]">
                {renderPanel()}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Mobile Device Simulation */
        <div className="w-full flex flex-col xl:flex-row items-center justify-around gap-8 py-4">
          {(state === 'both' || state === 'closed') && (
            <div className="flex flex-col items-center gap-3">
              <div className="text-center">
                <span className="text-sky-400 text-sm font-semibold block">Closed Launcher State</span>
                <span className="text-stone-400 text-xs">Compact non-blocking floating button</span>
              </div>
              {renderMobileDevice('closed')}
            </div>
          )}

          {(state === 'both' || state === 'open') && (
            <div className="flex flex-col items-center gap-3">
              <div className="text-center">
                <span className="text-sky-400 text-sm font-semibold block">Open Floating Card</span>
                <span className="text-stone-400 text-xs">Bounded floating card over website</span>
              </div>
              {renderMobileDevice('open')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
