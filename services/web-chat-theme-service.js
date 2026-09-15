/**
 * Canonical Web Chat Design Tokens & Accessibility Guard
 * Generates mathematically validated, WCAG AA compliant design tokens
 * for the shared Web Chat runtime without per-tenant custom CSS.
 */

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export class WebChatThemeError extends Error {
  constructor(code, message = 'Web Chat theme configuration is invalid') {
    super(message);
    this.name = 'WebChatThemeError';
    this.code = code;
  }
}

export function isTransparent(val) {
  return typeof val === 'string' && val.trim().toLowerCase() === 'transparent';
}

export function normalizeColorToken(color, fallback = '#2563EB', { allowTransparent = false } = {}) {
  if (typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  if (allowTransparent && trimmed.toLowerCase() === 'transparent') {
    return 'transparent';
  }
  if (HEX_COLOR_REGEX.test(trimmed)) {
    return normalizeHex(trimmed, fallback);
  }
  if (trimmed.startsWith('rgba(') || trimmed.startsWith('rgb(')) {
    return trimmed;
  }
  return fallback;
}

export function normalizeHex(color, fallback = '#2563EB') {
  if (typeof color !== 'string') return fallback.toUpperCase();
  const trimmed = color.trim();
  if (!HEX_COLOR_REGEX.test(trimmed)) return fallback.toUpperCase();
  if (trimmed.length === 4) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return trimmed.toUpperCase();
}

export function hexToRgb(hex) {
  const normalized = normalizeHex(hex);
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return [r, g, b];
}

export function rgbToHex([r, g, b]) {
  const clamp = (val) => Math.max(0, Math.min(255, Math.round(val)));
  const toHex = (val) => clamp(val).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(colorA, colorB) {
  const lumA = relativeLuminance(colorA);
  const lumB = relativeLuminance(colorB);
  const high = Math.max(lumA, lumB);
  const low = Math.min(lumA, lumB);
  return Number(((high + 0.05) / (low + 0.05)).toFixed(2));
}

export function saturation(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

export function mixColors(colorA, colorB, ratio = 0.5) {
  const rgbA = hexToRgb(colorA);
  const rgbB = hexToRgb(colorB);
  const r = rgbA[0] * (1 - ratio) + rgbB[0] * ratio;
  const g = rgbA[1] * (1 - ratio) + rgbB[1] * ratio;
  const b = rgbA[2] * (1 - ratio) + rgbB[2] * ratio;
  return rgbToHex([r, g, b]);
}

export function hexToRgba(hex, alpha = 1) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function accessibleForegroundFor(backgroundColor, minContrast = 4.5) {
  const whiteContrast = contrastRatio(backgroundColor, '#FFFFFF');
  const darkContrast = contrastRatio(backgroundColor, '#0F172A');
  if (whiteContrast >= minContrast) return '#FFFFFF';
  if (darkContrast >= minContrast) return '#0F172A';
  return whiteContrast >= darkContrast ? '#FFFFFF' : '#0F172A';
}

function normalizePrimaryForMode(primaryHex, mode) {
  const lum = relativeLuminance(primaryHex);
  if (mode === 'dark') {
    if (lum < 0.08) return mixColors(primaryHex, '#FFFFFF', 0.28);
    if (lum > 0.85) return mixColors(primaryHex, '#1E293B', 0.20);
  } else {
    if (lum > 0.70) return mixColors(primaryHex, '#0F172A', 0.28);
  }
  return primaryHex;
}

export function deriveWebChatThemeTokens({
  primaryColor = '#2563EB',
  accentColor = null,
  mode = 'dark',
  glowIntensity = 80,
  glowSpread = 70,
  pulseAnimation = 'normal',
  pulseMode = null,
  animationSpeed = 'normal',
  pulseSpeed = null,
  launcherStyle = 'pill',
  launcherThemeMode = 'follow_theme',
  launcherBackground = null,
  launcherBg = null,
  launcherForeground = null,
  launcherText = null,
  launcherBorderColor = null,
  launcherBorder = null,
  launcherGlowColor = null,
  launcherGlow = null,
  launcherLogoBackground = null,
  launcherLogoBg = null,
  launcherLogoBorderColor = null,
  launcherLogoBorder = null,
  launcherLogoScale = 100,
  panelLogoScale = 100,
} = {}) {
  const effectiveMode = ['dark', 'light'].includes(String(mode).toLowerCase())
    ? String(mode).toLowerCase()
    : 'dark';

  const rawLauncherLogoScale = Number(launcherLogoScale);
  const clampedLauncherLogoScale = Number.isFinite(rawLauncherLogoScale)
    ? Math.max(50, Math.min(200, Math.round(rawLauncherLogoScale)))
    : 100;

  const rawPanelLogoScale = Number(panelLogoScale);
  const clampedPanelLogoScale = Number.isFinite(rawPanelLogoScale)
    ? Math.max(50, Math.min(200, Math.round(rawPanelLogoScale)))
    : 100;

  const rawPrimary = normalizeHex(primaryColor, '#2563EB');
  const safePrimary = normalizePrimaryForMode(rawPrimary, effectiveMode);

  const rawAccent = accentColor
    ? normalizeHex(accentColor, safePrimary)
    : mixColors(safePrimary, effectiveMode === 'dark' ? '#FFFFFF' : '#000000', 0.18);
  const safeAccent = normalizePrimaryForMode(rawAccent, effectiveMode);

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

  const primaryForeground = accessibleForegroundFor(safePrimary, 4.5);
  const accentForeground = accessibleForegroundFor(safeAccent, 4.5);

  const clampedIntensity = Math.max(0, Math.min(100, Math.round(Number(glowIntensity ?? 80) || 0)));
  const clampedSpread = Math.max(0, Math.min(100, Math.round(Number(glowSpread ?? 70) || 0)));
  const intensityFactor = clampedIntensity / 80;
  const spreadFactor = clampedSpread / 70;

  const glowRing = hexToRgba(safePrimary, Number(Math.min(1, Math.max(0, intensityFactor * 0.65)).toFixed(2)));
  const glowColor = hexToRgba(safePrimary, Number(Math.min(1, Math.max(0, intensityFactor * 0.35)).toFixed(2)));
  const glowSoftColor = hexToRgba(safePrimary, Number(Math.min(1, Math.max(0, intensityFactor * 0.18)).toFixed(2)));
  const glowSpreadPx = Math.round(Math.max(4, spreadFactor * 24));
  const glowHaloPx = Math.round(Math.max(10, spreadFactor * 42));

  const effectivePulseSpeed = pulseSpeed || animationSpeed;
  const normSpeed = ['slow', 'fast'].includes(String(effectivePulseSpeed).toLowerCase())
    ? String(effectivePulseSpeed).toLowerCase()
    : 'normal';
  const pulseDuration = normSpeed === 'slow' ? '5.5s' : normSpeed === 'fast' ? '2.2s' : '3.6s';

  const effectivePulseMode = pulseMode || pulseAnimation;
  const normPulse = ['none', 'subtle', 'normal', 'strong'].includes(String(effectivePulseMode).toLowerCase())
    ? String(effectivePulseMode).toLowerCase()
    : 'normal';

  const effectiveLauncherThemeMode = ['auto_brand', 'follow_theme', 'custom'].includes(String(launcherThemeMode || '').toLowerCase())
    ? String(launcherThemeMode).toLowerCase()
    : 'follow_theme';

  const rawLauncherBg = launcherBackground ?? launcherBg ?? null;
  const rawLauncherText = launcherForeground ?? launcherText ?? null;
  const rawLauncherBorder = launcherBorderColor ?? launcherBorder ?? null;
  const rawLauncherGlow = launcherGlowColor ?? launcherGlow ?? null;
  const rawLauncherLogoBg = launcherLogoBackground ?? launcherLogoBg ?? null;
  const rawLauncherLogoBorder = launcherLogoBorderColor ?? launcherLogoBorder ?? null;

  let computedLauncherLogoBg;
  let computedLauncherLogoBorder;

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

  let computedLauncherBg;
  let computedLauncherText;
  let computedLauncherBorder;
  let computedLauncherGlow;

  if (effectiveLauncherThemeMode === 'auto_brand') {
    computedLauncherBg = safePrimary;
    computedLauncherText = accessibleForegroundFor(safePrimary, 4.5);
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
      if (rawLauncherText && HEX_COLOR_REGEX.test(String(rawLauncherText).trim())) {
        const normText = normalizeHex(rawLauncherText);
        const ratio = contrastRatio(computedLauncherBg, normText);
        computedLauncherText = ratio >= 4.5 ? normText : accessibleForegroundFor(computedLauncherBg, 4.5);
      } else {
        computedLauncherText = accessibleForegroundFor(computedLauncherBg, 4.5);
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
  let contrastLauncher = null;
  let launcherAccessible = true;
  let launcherWarning = null;

  if (isLauncherTransparent) {
    contrastLauncher = null;
    launcherAccessible = false;
    launcherWarning = 'Launcher background is transparent; host page contrast cannot be mathematically verified.';
  } else {
    contrastLauncher = contrastRatio(computedLauncherBg, computedLauncherText);
    launcherAccessible = contrastLauncher >= 4.5;
  }

  const launcherTextToken = computedLauncherText;

  const inputBg = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.04)';
  const inputBorder = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(15, 23, 42, 0.12)';
  const botBubbleBg = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(15, 23, 42, 0.05)';
  const botBubbleBorder = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)';

  const contrastPrimaryBtn = contrastRatio(safePrimary, primaryForeground);
  const contrastAccentBtn = contrastRatio(safeAccent, accentForeground);
  const contrastTextSurface = contrastRatio(surfaceSolid, textColor);
  const contrastMutedSurface = contrastRatio(surfaceSolid, mutedColor);

  const isAccessible =
    contrastPrimaryBtn >= 4.5 &&
    contrastTextSurface >= 4.5 &&
    contrastMutedSurface >= 3.0 &&
    (isLauncherTransparent ? false : launcherAccessible);

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
    launcher_text: launcherTextToken,
    launcher_foreground: launcherTextToken,
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
      primary_button: contrastPrimaryBtn,
      accent_button: contrastAccentBtn,
      text_surface: contrastTextSurface,
      muted_surface: contrastMutedSurface,
      launcher: contrastLauncher,
      launcher_transparent: isLauncherTransparent,
      launcher_warning: launcherWarning,
      launcher_accessible: launcherAccessible,
    },
    is_accessible: isAccessible,
  };
}

export function analyzeLogoPalette({
  candidates = [],
  baseColor = null,
  mode = 'dark',
  glowIntensity = 80,
  glowSpread = 70,
  pulseAnimation = 'normal',
  pulseMode = null,
  animationSpeed = 'normal',
  pulseSpeed = null,
  launcherStyle = 'pill',
  launcherThemeMode = 'auto_brand',
  launcherBackground = null,
  launcherBg = null,
  launcherForeground = null,
  launcherText = null,
  launcherBorderColor = null,
  launcherBorder = null,
  launcherGlowColor = null,
  launcherGlow = null,
  launcherLogoBackground = null,
  launcherLogoBg = null,
  launcherLogoBorderColor = null,
  launcherLogoBorder = null,
} = {}) {
  const sampled = (Array.isArray(candidates) ? candidates : [])
    .map((c) => (HEX_COLOR_REGEX.test(String(c || '').trim()) ? normalizeHex(c) : null))
    .filter(Boolean);

  if (baseColor && HEX_COLOR_REGEX.test(String(baseColor).trim())) {
    sampled.unshift(normalizeHex(baseColor));
  }

  const unique = [...new Set(sampled)];
  const meaningful = unique.filter((c) => {
    const sat = saturation(c);
    const lum = relativeLuminance(c);
    return sat >= 0.15 && lum > 0.04 && lum < 0.92;
  });

  const primaryCandidate = meaningful.length > 0
    ? meaningful.sort((a, b) => saturation(b) - saturation(a))[0]
    : (sampled[0] || (mode === 'dark' ? '#3B82F6' : '#2563EB'));

  const accentCandidate = meaningful.find((c) => c !== primaryCandidate && contrastRatio(c, primaryCandidate) >= 1.25)
    || mixColors(primaryCandidate, mode === 'dark' ? '#FFFFFF' : '#000000', 0.22);

  return deriveWebChatThemeTokens({
    primaryColor: primaryCandidate,
    accentColor: accentCandidate,
    mode,
    glowIntensity,
    glowSpread,
    pulseAnimation,
    pulseMode,
    animationSpeed,
    pulseSpeed,
    launcherStyle,
    launcherThemeMode,
    launcherBackground,
    launcherBg,
    launcherForeground,
    launcherText,
    launcherBorderColor,
    launcherBorder,
    launcherGlowColor,
    launcherGlow,
    launcherLogoBackground,
    launcherLogoBg,
    launcherLogoBorderColor,
    launcherLogoBorder,
  });
}
