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

export function mixColors(colorA: string, colorB: string, ratio = 0.5): string {
  const rgbA = hexToRgb(colorA);
  const rgbB = hexToRgb(colorB);
  const r = rgbA[0] * (1 - ratio) + rgbB[0] * ratio;
  const g = rgbA[1] * (1 - ratio) + rgbB[1] * ratio;
  const b = rgbA[2] * (1 - ratio) + rgbB[2] * ratio;
  return rgbToHex([r, g, b]);
}

export function deriveCanonicalDesignTokens(params: {
  primaryColor?: string;
  accentColor?: string | null;
  mode?: 'dark' | 'light' | 'auto';
  glowIntensity?: number;
  glowSpread?: number;
  pulseAnimation?: string;
  animationSpeed?: string;
  launcherStyle?: string;
}) {
  const effectiveMode = params.mode === 'light' ? 'light' : 'dark';
  const rawPrimary = normalizeHex(params.primaryColor, '#2563EB');
  const safePrimary = rawPrimary;

  const rawAccent = params.accentColor
    ? normalizeHex(params.accentColor, safePrimary)
    : mixColors(safePrimary, effectiveMode === 'dark' ? '#FFFFFF' : '#000000', 0.18);
  const safeAccent = rawAccent;

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

  const normSpeed = String(params.animationSpeed || 'normal').toLowerCase();
  const pulseDuration = normSpeed === 'slow' ? '5.5s' : normSpeed === 'fast' ? '2.2s' : '3.6s';

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
    launcher_text: primaryForeground,
    text: textColor,
    muted: mutedColor,
    border: borderColor,
    input_bg: inputBg,
    input_border: inputBorder,
    bot_bubble_bg: botBubbleBg,
    bot_bubble_border: botBubbleBorder,
  };
}
