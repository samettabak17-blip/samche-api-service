export interface LocaleDict {
  defaultTitle: string;
  defaultStatus: string;
  defaultLauncherLabel: string;
  clearBtnLabel: string;
  minimizeBtnLabel: string;
  closeBtnLabel: string;
  composerPlaceholder: string;
  sendLabel: string;
  confirmText: string;
  cancelBtn: string;
  clearBtn: string;
  clearingText: string;
  cannotClearHuman: string;
  cannotClearSending: string;
  browsingPrefix: string;
  botGreeting: string;
  userSample: string;
}

export const CANONICAL_I18N: Record<'tr' | 'en' | 'ar', LocaleDict> = {
  tr: {
    defaultTitle: 'Canlı Destek',
    defaultStatus: 'Çevrimiçi',
    defaultLauncherLabel: 'Canlı Destek',
    clearBtnLabel: 'Sohbeti Temizle',
    minimizeBtnLabel: 'Küçült',
    closeBtnLabel: 'Kapat',
    composerPlaceholder: 'Bir mesaj yazın...',
    sendLabel: 'Mesaj Gönder',
    confirmText: 'Sohbet geçmişini temizlemek istediğinize emin misiniz?',
    cancelBtn: 'İptal',
    clearBtn: 'Temizle',
    clearingText: 'Temizleniyor...',
    cannotClearHuman: 'Canlı destek temsilcisi görüşmesinde sohbet temizlenemez.',
    cannotClearSending: 'Mesaj iletilirken sohbet temizlenemez.',
    browsingPrefix: 'Gözatılan: ',
    botGreeting: 'Merhaba! Size nasıl yardımcı olabilirim?',
    userSample: 'Kargo ve teslimat süreleri hakkında bilgi alabilir miyim?',
  },
  en: {
    defaultTitle: 'Live Support',
    defaultStatus: 'Online',
    defaultLauncherLabel: 'Live Support',
    clearBtnLabel: 'Clear Conversation',
    minimizeBtnLabel: 'Minimize',
    closeBtnLabel: 'Close',
    composerPlaceholder: 'Type a message...',
    sendLabel: 'Send message',
    confirmText: 'Are you sure you want to clear this conversation?',
    cancelBtn: 'Cancel',
    clearBtn: 'Clear',
    clearingText: 'Clearing...',
    cannotClearHuman: 'Cannot clear conversation while human support is active.',
    cannotClearSending: 'Cannot clear conversation while sending a message.',
    browsingPrefix: 'Viewing: ',
    botGreeting: 'Hello! How can I help you today?',
    userSample: 'Can I get information about shipping and delivery times?',
  },
  ar: {
    defaultTitle: 'الدعم المباشر',
    defaultStatus: 'متصل',
    defaultLauncherLabel: 'الدعم المباشر',
    clearBtnLabel: 'مسح المحادثة',
    minimizeBtnLabel: 'تصغير',
    closeBtnLabel: 'إغلاق',
    composerPlaceholder: 'اكتب رسالة...',
    sendLabel: 'إرسال',
    confirmText: 'هل أنت متأكد أنك تريد مسح هذه المحادثة؟',
    cancelBtn: 'إلغاء',
    clearBtn: 'مسح',
    clearingText: 'جارٍ المسح...',
    cannotClearHuman: 'لا يمكن مسح المحادثة أثناء اتصال الدعم البشري.',
    cannotClearSending: 'لا يمكن مسح المحادثة أثناء إرسال الرسالة.',
    browsingPrefix: 'المعروض: ',
    botGreeting: 'مرحباً! كيف يمكنني مساعدتك اليوم؟',
    userSample: 'هل يمكنني الحصول على معلومات حول أوقات الشحن والتسليم؟',
  },
};

export function getEffectiveLocale(language?: string): 'tr' | 'en' | 'ar' {
  if (!language) return 'tr';
  const l = language.toLowerCase().trim();
  if (l === 'auto') {
    if (typeof navigator !== 'undefined' && navigator.language) {
      const nav = navigator.language.toLowerCase();
      if (nav.startsWith('ar')) return 'ar';
      if (nav.startsWith('en')) return 'en';
    }
    return 'tr';
  }
  if (l.startsWith('ar')) return 'ar';
  if (l.startsWith('en')) return 'en';
  return 'tr';
}

export function normalizeHex(color?: string | null, fallback = '#2563EB'): string {
  if (!color || typeof color !== 'string') return fallback.toUpperCase();
  const trimmed = color.trim();
  const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  if (!hexMatch.test(trimmed)) return fallback.toUpperCase();
  if (trimmed.length === 4) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return trimmed.toUpperCase();
}

export function hexToRgb(hex: string): [number, number, number] {
  const norm = normalizeHex(hex);
  const r = parseInt(norm.slice(1, 3), 16);
  const g = parseInt(norm.slice(3, 5), 16);
  const b = parseInt(norm.slice(5, 7), 16);
  return [r, g, b];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const clamp = (val: number) => Math.max(0, Math.min(255, Math.round(val)));
  const toHex = (val: number) => clamp(val).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(colorA: string, colorB: string): number {
  const lumA = relativeLuminance(colorA);
  const lumB = relativeLuminance(colorB);
  const high = Math.max(lumA, lumB);
  const low = Math.min(lumA, lumB);
  return Number(((high + 0.05) / (low + 0.05)).toFixed(2));
}

export function hexToRgba(hex: string, alpha = 1): string {
  try {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  } catch {
    return `rgba(37, 99, 235, ${alpha})`;
  }
}

export function getAccessibleForeground(backgroundColor: string): string {
  const whiteRatio = contrastRatio(backgroundColor, '#FFFFFF');
  const darkRatio = contrastRatio(backgroundColor, '#0F172A');
  if (whiteRatio >= 4.5) return '#FFFFFF';
  if (darkRatio >= 4.5) return '#0F172A';
  return whiteRatio >= darkRatio ? '#FFFFFF' : '#0F172A';
}

export function isTransparent(val?: string | null): boolean {
  return typeof val === 'string' && val.trim().toLowerCase() === 'transparent';
}

export function normalizeColorToken(color?: string | null, fallback = '#2563EB', options: { allowTransparent?: boolean } = {}): string {
  if (typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  if (options.allowTransparent && trimmed.toLowerCase() === 'transparent') {
    return 'transparent';
  }
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    return normalizeHex(trimmed, fallback);
  }
  if (trimmed.startsWith('rgba(') || trimmed.startsWith('rgb(')) {
    return trimmed;
  }
  return fallback;
}

export function mixColors(colorA: string, colorB: string, ratio = 0.5): string {
  const rgbA = hexToRgb(colorA);
  const rgbB = hexToRgb(colorB);
  const r = rgbA[0] * (1 - ratio) + rgbB[0] * ratio;
  const g = rgbA[1] * (1 - ratio) + rgbB[1] * ratio;
  const b = rgbA[2] * (1 - ratio) + rgbB[2] * ratio;
  return rgbToHex([r, g, b]);
}

export function normalizePrimaryForMode(primaryHex: string, mode: 'dark' | 'light'): string {
  const lum = relativeLuminance(primaryHex);
  if (mode === 'dark') {
    if (lum < 0.08) return mixColors(primaryHex, '#FFFFFF', 0.28);
    if (lum > 0.85) return mixColors(primaryHex, '#1E293B', 0.20);
  } else {
    if (lum > 0.70) return mixColors(primaryHex, '#0F172A', 0.28);
  }
  return primaryHex;
}

export function deriveCanonicalDesignTokens(params: {
  primaryColor?: string;
  accentColor?: string | null;
  mode?: 'dark' | 'light' | 'auto';
  glowIntensity?: number;
  glowSpread?: number;
  pulseAnimation?: string;
  pulseMode?: string;
  animationSpeed?: string;
  pulseSpeed?: string;
  launcherStyle?: string;
  launcherThemeMode?: 'auto_brand' | 'follow_theme' | 'custom';
  launcherBackground?: string | null;
  launcherBg?: string | null;
  launcherForeground?: string | null;
  launcherText?: string | null;
  launcherBorderColor?: string | null;
  launcherBorder?: string | null;
  launcherGlowColor?: string | null;
  launcherGlow?: string | null;
  launcherLogoBackground?: string | null;
  launcherLogoBg?: string | null;
  launcherLogoBorderColor?: string | null;
  launcherLogoBorder?: string | null;
  launcherLogoScale?: number;
  panelLogoScale?: number;
}) {
  const effectiveMode = params.mode === 'light' ? 'light' : 'dark';
  const rawPrimary = normalizeHex(params.primaryColor, '#2563EB');
  const safePrimary = normalizePrimaryForMode(rawPrimary, effectiveMode);

  const rawAccent = params.accentColor
    ? normalizeHex(params.accentColor, safePrimary)
    : mixColors(safePrimary, effectiveMode === 'dark' ? '#FFFFFF' : '#000000', 0.18);
  const safeAccent = normalizePrimaryForMode(rawAccent, effectiveMode);

  const rawLauncherLogoScale = Number(params.launcherLogoScale ?? (params as any).launcher_logo_scale);
  const clampedLauncherLogoScale = Number.isFinite(rawLauncherLogoScale)
    ? Math.max(50, Math.min(200, Math.round(rawLauncherLogoScale)))
    : 100;

  const rawPanelLogoScale = Number(params.panelLogoScale ?? (params as any).panel_logo_scale);
  const clampedPanelLogoScale = Number.isFinite(rawPanelLogoScale)
    ? Math.max(50, Math.min(200, Math.round(rawPanelLogoScale)))
    : 100;

  const isDark = effectiveMode === 'dark';
  const surfaceSolid = isDark ? '#111827' : '#FFFFFF';
  const surfaceTint = isDark
    ? mixColors('#0F172A', safePrimary, 0.10)
    : mixColors('#F8FAFC', safePrimary, 0.04);
  const surfaceGlass = isDark
    ? hexToRgba(mixColors('#0B0F19', safePrimary, 0.08), 0.82)
    : hexToRgba(mixColors('#FFFFFF', safePrimary, 0.03), 0.90);

  const textColor = isDark ? '#F8FAFC' : '#0F172A';
  const mutedColor = isDark ? '#94A3B8' : '#64748B';
  const borderColor = isDark
    ? 'rgba(255, 255, 255, 0.12)'
    : 'rgba(15, 23, 42, 0.10)';

  const primaryForeground = getAccessibleForeground(safePrimary);
  const accentForeground = getAccessibleForeground(safeAccent);

  const clampedIntensity = Math.max(0, Math.min(100, Math.round(Number(params.glowIntensity ?? 80) || 0)));
  const clampedSpread = Math.max(0, Math.min(100, Math.round(Number(params.glowSpread ?? 70) || 0)));
  const intensityFactor = clampedIntensity / 80;
  const spreadFactor = clampedSpread / 70;

  const glowRing = hexToRgba(safePrimary, Number(Math.min(1, Math.max(0, intensityFactor * 0.65)).toFixed(2)));
  const glowColor = hexToRgba(safePrimary, Number(Math.min(1, Math.max(0, intensityFactor * 0.35)).toFixed(2)));
  const glowSoftColor = hexToRgba(safePrimary, Number(Math.min(1, Math.max(0, intensityFactor * 0.18)).toFixed(2)));
  const glowSpreadPx = Math.round(Math.max(4, spreadFactor * 24));
  const glowHaloPx = Math.round(Math.max(10, spreadFactor * 42));

  const effectivePulseSpeed = params.pulseSpeed || params.animationSpeed;
  const normSpeed = String(effectivePulseSpeed || 'normal').toLowerCase();
  const pulseDuration = normSpeed === 'slow' ? '5.5s' : normSpeed === 'fast' ? '2.2s' : '3.6s';

  const effectivePulseMode = params.pulseMode || params.pulseAnimation;
  const normPulse = ['none', 'subtle', 'normal', 'strong'].includes(String(effectivePulseMode || '').toLowerCase())
    ? String(effectivePulseMode).toLowerCase()
    : 'normal';

  const effectiveLauncherThemeMode = ['auto_brand', 'follow_theme', 'custom'].includes(String(params.launcherThemeMode || '').toLowerCase())
    ? String(params.launcherThemeMode).toLowerCase()
    : 'follow_theme';

  const rawLauncherBg = params.launcherBackground ?? params.launcherBg ?? null;
  const rawLauncherText = params.launcherForeground ?? params.launcherText ?? null;
  const rawLauncherBorder = params.launcherBorderColor ?? params.launcherBorder ?? null;
  const rawLauncherGlow = params.launcherGlowColor ?? params.launcherGlow ?? null;
  const rawLauncherLogoBg = params.launcherLogoBackground ?? params.launcherLogoBg ?? null;
  const rawLauncherLogoBorder = params.launcherLogoBorderColor ?? params.launcherLogoBorder ?? null;

  let computedLauncherLogoBg: string;
  let computedLauncherLogoBorder: string;

  if (isTransparent(rawLauncherLogoBg)) {
    computedLauncherLogoBg = 'transparent';
  } else if (rawLauncherLogoBg && String(rawLauncherLogoBg).trim()) {
    computedLauncherLogoBg = normalizeColorToken(rawLauncherLogoBg, 'transparent', { allowTransparent: true });
  } else {
    computedLauncherLogoBg = 'transparent';
  }

  if (isTransparent(rawLauncherLogoBorder)) {
    computedLauncherLogoBorder = 'transparent';
  } else if (rawLauncherLogoBorder && String(rawLauncherLogoBorder).trim()) {
    computedLauncherLogoBorder = normalizeColorToken(rawLauncherLogoBorder, 'transparent', { allowTransparent: true });
  } else {
    computedLauncherLogoBorder = 'transparent';
  }

  let computedLauncherBg: string;
  let computedLauncherText: string;
  let computedLauncherBorder: string;
  let computedLauncherGlow: string;

  if (effectiveLauncherThemeMode === 'auto_brand') {
    computedLauncherBg = safePrimary;
    computedLauncherText = getAccessibleForeground(safePrimary);
    computedLauncherBorder = glowRing;
    computedLauncherGlow = glowColor;
  } else if (effectiveLauncherThemeMode === 'custom') {
    if (isTransparent(rawLauncherBg)) {
      computedLauncherBg = 'transparent';
    } else if (rawLauncherBg && String(rawLauncherBg).trim()) {
      computedLauncherBg = normalizeColorToken(rawLauncherBg, isDark ? '#0F172A' : '#FFFFFF', { allowTransparent: true });
    } else {
      computedLauncherBg = isDark ? '#0F172A' : '#FFFFFF';
    }

    if (isTransparent(rawLauncherText)) {
      computedLauncherText = 'transparent';
    } else if (computedLauncherBg === 'transparent') {
      if (rawLauncherText && String(rawLauncherText).trim()) {
        computedLauncherText = normalizeColorToken(rawLauncherText, isDark ? '#FFFFFF' : '#0F172A', { allowTransparent: true });
      } else {
        computedLauncherText = isDark ? '#FFFFFF' : '#0F172A';
      }
    } else {
      if (rawLauncherText && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(rawLauncherText).trim())) {
        const normText = normalizeHex(rawLauncherText);
        const ratio = contrastRatio(computedLauncherBg, normText);
        computedLauncherText = ratio >= 4.5 ? normText : getAccessibleForeground(computedLauncherBg);
      } else {
        computedLauncherText = getAccessibleForeground(computedLauncherBg);
      }
    }

    if (isTransparent(rawLauncherBorder)) {
      computedLauncherBorder = 'transparent';
    } else if (rawLauncherBorder && String(rawLauncherBorder).trim()) {
      computedLauncherBorder = normalizeColorToken(rawLauncherBorder, glowRing, { allowTransparent: true });
    } else {
      computedLauncherBorder = glowRing;
    }

    if (isTransparent(rawLauncherGlow)) {
      computedLauncherGlow = 'transparent';
    } else if (rawLauncherGlow && String(rawLauncherGlow).trim()) {
      computedLauncherGlow = normalizeColorToken(rawLauncherGlow, glowColor, { allowTransparent: true });
    } else {
      computedLauncherGlow = glowColor;
    }
  } else {
    // follow_theme: panel-matched launcher mode
    if (isDark) {
      computedLauncherBg = '#0F172A';
      computedLauncherText = '#FFFFFF';
      computedLauncherBorder = glowRing;
      computedLauncherGlow = glowColor;
    } else {
      computedLauncherBg = '#FFFFFF';
      computedLauncherText = '#0F172A';
      computedLauncherBorder = 'rgba(15, 23, 42, 0.12)';
      computedLauncherGlow = glowColor;
    }
  }

  const isLauncherTransparent = computedLauncherBg === 'transparent';
  let contrastLauncher: number | null = null;
  let launcherAccessible = true;
  let launcherWarning: string | null = null;

  if (isLauncherTransparent) {
    contrastLauncher = null;
    launcherAccessible = false;
    launcherWarning = 'Launcher background is transparent; host page contrast cannot be mathematically verified.';
  } else {
    contrastLauncher = contrastRatio(computedLauncherBg, computedLauncherText);
    launcherAccessible = contrastLauncher >= 4.5;
  }

  const inputBg = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.04)';
  const inputBorder = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(15, 23, 42, 0.12)';
  const botBubbleBg = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(15, 23, 42, 0.05)';
  const botBubbleBorder = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)';

  return {
    mode: effectiveMode,
    primary: safePrimary,
    primary_foreground: primaryForeground,
    accent: safeAccent,
    accent_foreground: accentForeground,
    surface_tint: surfaceTint,
    surface_solid: surfaceSolid,
    surface_glass: surfaceGlass,
    glow: glowColor,
    glow_soft: glowSoftColor,
    glow_ring: glowRing,
    glow_spread_px: glowSpreadPx,
    glow_halo_px: glowHaloPx,
    pulse_duration: pulseDuration,
    pulse_animation: normPulse,
    pulse_mode: normPulse,
    animation_speed: normSpeed,
    pulse_speed: normSpeed,
    launcher_text: computedLauncherText,
    launcher_foreground: computedLauncherText,
    launcher_theme_mode: effectiveLauncherThemeMode,
    launcher_bg: computedLauncherBg,
    launcher_background: computedLauncherBg,
    launcher_border: computedLauncherBorder,
    launcher_border_color: computedLauncherBorder,
    launcher_glow: computedLauncherGlow,
    launcher_glow_color: computedLauncherGlow,
    launcher_logo_bg: computedLauncherLogoBg,
    launcher_logo_background: computedLauncherLogoBg,
    launcher_logo_border: computedLauncherLogoBorder,
    launcher_logo_border_color: computedLauncherLogoBorder,
    launcher_logo_scale: clampedLauncherLogoScale,
    panel_logo_scale: clampedPanelLogoScale,
    text: textColor,
    muted: mutedColor,
    border: borderColor,
    input_bg: inputBg,
    input_border: inputBorder,
    bot_bubble_bg: botBubbleBg,
    bot_bubble_border: botBubbleBorder,
    contrast: {
      launcher: contrastLauncher,
      launcher_transparent: isLauncherTransparent,
      launcher_warning: launcherWarning,
      launcher_accessible: launcherAccessible,
    },
    is_accessible: isLauncherTransparent ? false : launcherAccessible,
  };
}

export function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatAssistantHtml(rawText: any): string {
  if (rawText === null || rawText === undefined) return '';
  let str = String(rawText);
  if (!str.trim()) return '';

  str = str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  str = str.replace(/<a\s+(?:[^>]*?\s+)?href=["']((?:https?:\/\/|\/)[^"'>\s]+)["'][^>]*?>([\s\S]*?)<\/a>/gi, (_match, href, label) => {
    const cleanLabel = label.replace(/<[^>]+>/g, '').trim() || href;
    return '[' + cleanLabel + '](' + href + ')';
  });

  str = str.replace(/<br\s*\/?>/gi, '\n');
  str = str.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  str = str.replace(/<\/?p[^>]*>/gi, '\n');

  const rawLines = str.split('\n');
  const blocks: Array<{ type: 'p'; lines: string[] } | { type: 'ol' | 'ul'; items: string[] }> = [];
  let currentBlock: { type: 'p'; lines: string[] } | { type: 'ol' | 'ul'; items: string[] } | null = null;

  function closeCurrentBlock() {
    if (currentBlock) {
      blocks.push(currentBlock);
      currentBlock = null;
    }
  }

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      closeCurrentBlock();
      continue;
    }

    const headerMatch = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (headerMatch) {
      closeCurrentBlock();
      blocks.push({ type: 'p', lines: ['**' + headerMatch[1].trim() + '**'] });
      continue;
    }

    const numMatch = trimmed.match(/^(\d+)[\.\)]\s+(.*)$/);
    if (numMatch) {
      if (!currentBlock || currentBlock.type !== 'ol') {
        closeCurrentBlock();
        currentBlock = { type: 'ol', items: [] };
      }
      (currentBlock as { type: 'ol'; items: string[] }).items.push(numMatch[2]);
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      if (!currentBlock || currentBlock.type !== 'ul') {
        closeCurrentBlock();
        currentBlock = { type: 'ul', items: [] };
      }
      (currentBlock as { type: 'ul'; items: string[] }).items.push(bulletMatch[1]);
      continue;
    }

    if (!currentBlock || currentBlock.type !== 'p') {
      closeCurrentBlock();
      currentBlock = { type: 'p', lines: [] };
    }
    (currentBlock as { type: 'p'; lines: string[] }).lines.push(trimmed);
  }
  closeCurrentBlock();

  function formatInline(text: string): string {
    if (!text) return '';

    const linkPlaceholders: string[] = [];

    // 1. Markdown links: [Label](https://...) or [Label](/path)
    let intermediate = text.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s\)\"'>]+)\)/g, (_match, label, url) => {
      const idx = linkPlaceholders.length;
      const cleanLabel = escapeHtml(label)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>');
      const cleanUrl = escapeHtml(url);
      const linkHtml = `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanLabel}</a>`;
      linkPlaceholders.push(linkHtml);
      return `@@SAMCHELINK${idx}TOKEN@@`;
    });

    // 2. Standalone raw URLs: https://... or http://...
    intermediate = intermediate.replace(/(^|[\s(])(https?:\/\/[^\s)<>"']+)/g, (_match, prefix, url) => {
      let trailing = '';
      const punctMatch = url.match(/[.,;:!?]+$/);
      if (punctMatch) {
        trailing = punctMatch[0];
        url = url.slice(0, -trailing.length);
      }
      const idx = linkPlaceholders.length;
      const cleanUrl = escapeHtml(url);
      const linkHtml = `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>`;
      linkPlaceholders.push(linkHtml);
      return `${prefix}@@SAMCHELINK${idx}TOKEN@@${trailing}`;
    });

    // 3. HTML Escape remaining text
    let escaped = escapeHtml(intermediate);

    // 4. Bold formatting
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // 5. Restore link placeholders
    for (let j = 0; j < linkPlaceholders.length; j++) {
      escaped = escaped.replace(`@@SAMCHELINK${j}TOKEN@@`, linkPlaceholders[j]);
    }

    return escaped;
  }

  const htmlParts: string[] = [];
  for (let b = 0; b < blocks.length; b++) {
    const blk = blocks[b];
    if (blk.type === 'p') {
      const pContent = blk.lines.map(formatInline).join('<br>');
      htmlParts.push(`<p>${pContent}</p>`);
    } else if (blk.type === 'ol') {
      const olItems = blk.items.map((item) => `<li>${formatInline(item)}</li>`).join('');
      htmlParts.push(`<ol>${olItems}</ol>`);
    } else if (blk.type === 'ul') {
      const ulItems = blk.items.map((item) => `<li>${formatInline(item)}</li>`).join('');
      htmlParts.push(`<ul>${ulItems}</ul>`);
    }
  }

  return htmlParts.join('');
}

export function renderAssistantMessage(targetNode: any, rawText: any): void {
  if (!targetNode) return;
  const html = formatAssistantHtml(rawText);
  targetNode.innerHTML = html;
  if (!targetNode.textContent && typeof rawText === 'string') {
    targetNode.textContent = rawText;
  }
}

