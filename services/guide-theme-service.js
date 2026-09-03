const COLOR = /^#[0-9A-F]{6}$/;

export class GuideThemeError extends Error { constructor(code) { super('Guide theme recommendation is invalid.'); this.code = code; } }

function rgb(hex) { return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)); }
function hex(values) { return `#${values.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('').toUpperCase()}`; }
function luminance(color) { return rgb(color).map((value) => value / 255).map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0); }
function contrast(a, b) { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + .05) / (low + .05); }
function saturation(color) { const values = rgb(color).map((value) => value / 255); return Math.max(...values) - Math.min(...values); }
function mix(a, b, ratio) { const left = rgb(a); const right = rgb(b); return hex(left.map((value, index) => value * (1 - ratio) + right[index] * ratio)); }
function normalizeCandidate(value) { return typeof value === 'string' && COLOR.test(value.toUpperCase()) ? value.toUpperCase() : null; }

export function deriveAccessibleGuideTheme({ candidates = [] } = {}) {
  if (!Array.isArray(candidates) || candidates.length > 64) throw new GuideThemeError('GUIDE_THEME_CANDIDATES_INVALID');
  const colors = [...new Set(candidates.map(normalizeCandidate).filter(Boolean))];
  const meaningful = colors.filter((color) => saturation(color) >= .18 && luminance(color) > .03 && luminance(color) < .95);
  const primary = meaningful.sort((a, b) => saturation(b) - saturation(a) || contrast(b, '#FFFFFF') - contrast(a, '#FFFFFF'))[0] ?? '#1F4B99';
  const accent = meaningful.find((color) => color !== primary && contrast(color, primary) >= 1.25) ?? mix(primary, '#FFFFFF', .22);
  const foreground = contrast(primary, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#101828';
  const background = luminance(primary) < .45 ? mix(primary, '#0B1020', .82) : '#F7F8FA';
  const surface = luminance(background) < .25 ? mix(background, '#FFFFFF', .08) : '#FFFFFF';
  const surfaceForeground = contrast(surface, '#101828') >= 4.5 ? '#101828' : '#FFFFFF';
  return { primary_color: primary, accent_color: accent, background_color: background, foreground_color: surfaceForeground, surface_color: surface, border_color: mix(surface, primary, .28), foreground_on_primary: foreground, foreground_on_accent: contrast(accent, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#101828', contrast: { primary: Number(contrast(primary, foreground).toFixed(2)), accent: Number(contrast(accent, contrast(accent, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#101828').toFixed(2)), surface: Number(contrast(surface, surfaceForeground).toFixed(2)) } };
}
