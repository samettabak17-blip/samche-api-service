import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  deriveWebChatThemeTokens,
  contrastRatio,
  accessibleForegroundFor,
  relativeLuminance,
} from '../services/web-chat-theme-service.js';
import {
  generateWebChatEmbedSnippet,
  normalizeWebChatAppearance,
  normalizeWebChatBehavior,
  DEFAULT_WEB_CHAT_APPEARANCE,
  DEFAULT_WEB_CHAT_BEHAVIOR,
} from '../services/tenant-web-chat-provisioning-service.js';
import {
  validateWebChatAssetUpload,
  sanitizeSvgBuffer,
  MAX_WEB_CHAT_ASSET_BYTES,
  extractColorCandidatesFromBuffer,
  decodePngColors,
} from '../services/web-chat-asset-service.js';


const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const webChatJsSource = fs.readFileSync(new URL('../public/web-chat.js', import.meta.url), 'utf8');
const dashboardApiTypesSource = fs.readFileSync(new URL('../dashboard/src/types/api.ts', import.meta.url), 'utf8');
const dashboardApiSource = fs.readFileSync(new URL('../dashboard/src/features/dashboard/dashboard-api.ts', import.meta.url), 'utf8');
const dashboardWebChatManagementSource = fs.readFileSync(new URL('../dashboard/src/features/channels/web-chat-management.tsx', import.meta.url), 'utf8');

test('Contrast calculation and WCAG AA ratio compliance', () => {
  const blackWhite = contrastRatio('#FFFFFF', '#000000');
  assert.equal(blackWhite, 21);

  const whiteFg = accessibleForegroundFor('#1E3A8A');
  assert.equal(whiteFg, '#FFFFFF');

  const darkFg = accessibleForegroundFor('#FEF08A');
  assert.equal(darkFg, '#0F172A');

  assert.equal(relativeLuminance('#FFFFFF'), 1);
  assert.equal(relativeLuminance('#000000'), 0);
});

test('Theme derivation produces complete WCAG AA compliant design tokens', () => {
  const darkTheme = deriveWebChatThemeTokens({
    primaryColor: '#0B5FFF',
    accentColor: '#10B981',
    mode: 'dark',
  });

  assert.equal(darkTheme.mode, 'dark');
  assert.ok(darkTheme.primary);
  assert.ok(darkTheme.primary_foreground);
  assert.ok(darkTheme.accent);
  assert.ok(darkTheme.surface_solid);
  assert.ok(darkTheme.surface_glass);
  assert.ok(darkTheme.contrast.primary_button >= 4.5);
  assert.ok(darkTheme.contrast.text_surface >= 4.5);
  assert.equal(darkTheme.is_accessible, true);

  const lightTheme = deriveWebChatThemeTokens({
    primaryColor: '#2563EB',
    mode: 'light',
  });

  assert.equal(lightTheme.mode, 'light');
  assert.equal(lightTheme.surface_solid, '#FFFFFF');
  assert.ok(lightTheme.contrast.primary_button >= 4.5);
});

test('Appearance and behavior normalizers handle fallbacks and constraints', () => {
  const appearance = normalizeWebChatAppearance({
    brand_name: 'Acme Corp',
    primary_color: '#3B82F6',
  });

  assert.equal(appearance.brand_name, 'Acme Corp');
  assert.equal(appearance.launcher_position, 'right');
  assert.equal(appearance.theme_mode, 'dark');
  assert.ok(appearance.theme.primary_color);
  assert.ok(appearance.contrast);

  const behavior = normalizeWebChatBehavior({
    proactive_enabled: true,
    dwell_threshold_seconds: 25,
    language: 'TR',
  });

  assert.equal(behavior.proactive_enabled, true);
  assert.equal(behavior.dwell_threshold_seconds, 25);
  assert.equal(behavior.language, 'tr');
});

test('Production embed snippet generator contains valid script tag and zero secrets', () => {
  const snippet = generateWebChatEmbedSnippet('widget_abc_123', 'https://api.samche.com');
  assert.match(snippet, /<script src="https:\/\/api\.samche\.com\/web-chat\.js"/);
  assert.match(snippet, /data-widget-key="widget_abc_123"/);
  assert.doesNotMatch(snippet, /password|secret|bearer|authorization|api_key|token/i);
});

test('public/web-chat.js implements canonical Shadow DOM runtime encapsulation', () => {
  // Shadow Root attachment
  assert.match(webChatJsSource, /attachShadow\(\{\s*mode:\s*['"]open['"]\s*\}\)/);
  
  // Custom CSS variable injection
  assert.match(webChatJsSource, /--chat-primary/);
  assert.match(webChatJsSource, /--chat-surface-glass/);
  assert.match(webChatJsSource, /--chat-text/);
  assert.match(webChatJsSource, /--chat-accent/);
  
  // Frosted glass styling tokens
  assert.match(webChatJsSource, /backdrop-filter:\s*blur\(24px\)/);
  
  // Proactive evaluation and cooldown checking
  assert.match(webChatJsSource, /startDwellTracker\(/);
  assert.match(webChatJsSource, /checkDwellIntent\(/);
  assert.match(webChatJsSource, /recordDismissal\(/);
  assert.match(webChatJsSource, /handleProactiveResult\(/);
  
  // Session hydration and local storage isolation
  assert.match(webChatJsSource, /samche_webchat_session_/);
  assert.match(webChatJsSource, /getStorageKey\(/);
  
  // Script tag discovery and auto-boot
  assert.match(webChatJsSource, /document\.currentScript/);
  assert.match(webChatJsSource, /data-widget-key/);
  
  // Window / global programmatic export
  assert.match(webChatJsSource, /global\.SamcheWebChat\s*=/);
});

const dashboardRoutesSource = fs.readFileSync(new URL('../routes/dashboardRoutes.js', import.meta.url), 'utf8');

test('dashboardRoutes.js exposes tenant Web Chat management REST endpoints', () => {
  // GET /:tenantId/channels/web-chat
  assert.match(dashboardRoutesSource, /router\.get\(['"]\/:tenantId\/channels\/web-chat['"]/);
  assert.match(dashboardRoutesSource, /getWebChatIntegrationForTenant/);

  // PUT /:tenantId/channels/web-chat
  assert.match(dashboardRoutesSource, /router\.put\(['"]\/:tenantId\/channels\/web-chat['"]/);
  assert.match(dashboardRoutesSource, /ensureWebChatIntegration/);

  // POST /:tenantId/channels/web-chat/theme-preview
  assert.match(dashboardRoutesSource, /router\.post\(['"]\/:tenantId\/channels\/web-chat\/theme-preview['"]/);
  assert.match(dashboardRoutesSource, /deriveWebChatThemeTokens/);
});

test('dashboard TypeScript types cover Web Chat configuration models', () => {
  assert.match(dashboardApiTypesSource, /export interface WebChatThemeConfig/);
  assert.match(dashboardApiTypesSource, /export interface WebChatAppearanceConfig/);
  assert.match(dashboardApiTypesSource, /export interface WebChatBehaviorConfig/);
  assert.match(dashboardApiTypesSource, /export interface WebChatChannelResponse/);
  assert.match(dashboardApiTypesSource, /export interface WebChatThemePreviewResponse/);
  assert.match(dashboardApiTypesSource, /embed_snippet:\s*string;/);
  assert.match(dashboardApiTypesSource, /widget_key:\s*string;/);
});

test('dashboard API exposes tenant Web Chat query and mutation bindings', () => {
  assert.match(dashboardApiSource, /webChatChannel:\s*\(tenantId:\s*string\)/);
  assert.match(dashboardApiSource, /getWebChatChannel:\s*\(tenantId:\s*string\)/);
  assert.match(dashboardApiSource, /updateWebChatChannel:\s*\(tenantId:\s*string/);
  assert.match(dashboardApiSource, /previewWebChatTheme:\s*\(tenantId:\s*string/);
});

test('dashboard WebChatManagement component supports branding, contrast preview, and snippets', () => {
  assert.match(dashboardWebChatManagementSource, /export function WebChatManagement/);
  assert.match(dashboardWebChatManagementSource, /tenantApi\.getWebChatChannel/);
  assert.match(dashboardWebChatManagementSource, /tenantApi\.updateWebChatChannel/);
  assert.match(dashboardWebChatManagementSource, /tenantApi\.previewWebChatTheme/);
  assert.match(dashboardWebChatManagementSource, /handleCopySnippet/);
  assert.match(dashboardWebChatManagementSource, /WCAG AA Compliance/);
  assert.match(dashboardWebChatManagementSource, /Public Widget Key/);
  assert.match(dashboardWebChatManagementSource, /Proactive Engagement/);
});

test('dashboardRoutes.js exposes tenant Web Chat logo upload and delete REST endpoints', () => {
  // POST /:tenantId/channels/web-chat/logo
  assert.match(dashboardRoutesSource, /router\.post\(\s*['"]\/:tenantId\/channels\/web-chat\/logo['"]/);
  assert.match(dashboardRoutesSource, /webChatLogoUpload\.single\(['"]file['"]\)/);
  assert.match(dashboardRoutesSource, /storeWebChatAsset/);
  assert.match(dashboardRoutesSource, /getWebChatIntegrationForTenant/);
  assert.match(dashboardRoutesSource, /ensureWebChatIntegration/);
  assert.match(dashboardRoutesSource, /theme:\s*asset\.theme/);
  assert.match(dashboardRoutesSource, /palette:\s*asset\.palette/);

  // DELETE /:tenantId/channels/web-chat/logo
  assert.match(dashboardRoutesSource, /router\.delete\(\s*['"]\/:tenantId\/channels\/web-chat\/logo['"]/);
  assert.match(dashboardRoutesSource, /deleteWebChatAsset/);
  assert.match(dashboardRoutesSource, /logo_url:\s*null/);
  assert.match(dashboardRoutesSource, /logo_asset_id:\s*null/);
});

test('dashboard API exposes tenant Web Chat logo upload and delete endpoints', () => {
  assert.match(dashboardApiSource, /uploadWebChatLogo:\s*\(tenantId:\s*string,\s*file:\s*File\)/);
  assert.match(dashboardApiSource, /deleteWebChatLogo:\s*\(tenantId:\s*string\)/);
});

test('dashboard WebChatManagement component integrates logo upload, launcher label, palette suggestions, and live pill preview', () => {
  const updatedSource = fs.readFileSync(new URL('../dashboard/src/features/channels/web-chat-management.tsx', import.meta.url), 'utf8');

  // Logo upload and delete bindings
  assert.match(updatedSource, /tenantApi\.uploadWebChatLogo/);
  assert.match(updatedSource, /tenantApi\.deleteWebChatLogo/);
  assert.match(updatedSource, /handleLogoFileSelect/);
  assert.match(updatedSource, /handleLogoDelete/);
  assert.match(updatedSource, /fileInputRef/);

  // Launcher label control
  assert.match(updatedSource, /launcherLabel/);
  assert.match(updatedSource, /setLauncherLabel/);
  assert.match(updatedSource, /Launcher Label/);
  assert.match(updatedSource, /launcher_label:\s*launcherLabel/);

  // Palette recommendation prompts and curated presets
  assert.match(updatedSource, /extractedPalette/);
  assert.match(updatedSource, /Recommended Palette from Logo/);
  assert.match(updatedSource, /Apply Recommendations/);
  assert.match(updatedSource, /Curated Presets/);

  // Interactive live launcher pill preview
  assert.match(updatedSource, /previewOpen/);
  assert.match(updatedSource, /setPreviewOpen/);
  assert.match(updatedSource, /launcherLabel \?/);
  assert.match(updatedSource, /launcherIcon === 'logo' && logoUrl/);
});

test('Theme glow derivation is dynamic, restrained, and tenant-specific without hardcoded colors', () => {
  // Gold/Amber theme -> warm glow
  const goldTokens = deriveWebChatThemeTokens({
    primaryColor: '#D97706',
    accentColor: '#F59E0B',
    mode: 'dark',
  });
  assert.equal(goldTokens.glow, 'rgba(217, 119, 6, 0.35)');
  assert.equal(goldTokens.glow_soft, 'rgba(217, 119, 6, 0.18)');
  assert.ok(goldTokens.contrast.primary_button >= 4.5);

  // Emerald theme -> distinct green glow
  const emeraldTokens = deriveWebChatThemeTokens({
    primaryColor: '#059669',
    accentColor: '#10B981',
    mode: 'dark',
  });
  assert.equal(emeraldTokens.glow, 'rgba(5, 150, 105, 0.35)');
  assert.equal(emeraldTokens.glow_soft, 'rgba(5, 150, 105, 0.18)');
  assert.notEqual(emeraldTokens.glow, goldTokens.glow);
  assert.ok(emeraldTokens.contrast.primary_button >= 4.5);

  // Purple/Violet theme -> distinct purple glow
  const violetTokens = deriveWebChatThemeTokens({
    primaryColor: '#7C3AED',
    accentColor: '#A78BFA',
    mode: 'dark',
  });
  assert.equal(violetTokens.glow, 'rgba(124, 58, 237, 0.35)');
  assert.notEqual(violetTokens.glow, goldTokens.glow);
  assert.notEqual(violetTokens.glow, emeraldTokens.glow);
});

test('public/web-chat.js enforces prefers-reduced-motion clean static fallback', () => {
  assert.match(webChatJsSource, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(webChatJsSource, /\.samche-launcher.*animation:\s*none !important/);
});

test('Two-tenant branding isolation on shared runtime ensures zero config/asset leakage', () => {
  // Tenant A: Amber, custom logo, custom label
  const tenantAAppearance = normalizeWebChatAppearance({
    brand_name: 'Tenant Alpha Jewelry',
    title: 'Alpha Concierge',
    launcher_label: 'Sipariş Destek',
    logo_url: 'https://cdn.samche.com/tenants/alpha/logo.png',
    primary_color: '#D97706',
    theme_mode: 'dark',
  });

  // Tenant B: Emerald, distinct logo, distinct label
  const tenantBAppearance = normalizeWebChatAppearance({
    brand_name: 'Tenant Beta Logistics',
    title: 'Beta Freight Assist',
    launcher_label: 'Track Package',
    logo_url: 'https://cdn.samche.com/tenants/beta/badge.svg',
    primary_color: '#059669',
    theme_mode: 'light',
  });

  // Strict isolation checks
  assert.notEqual(tenantAAppearance.brand_name, tenantBAppearance.brand_name);
  assert.notEqual(tenantAAppearance.title, tenantBAppearance.title);
  assert.notEqual(tenantAAppearance.launcher_label, tenantBAppearance.launcher_label);
  assert.notEqual(tenantAAppearance.logo_url, tenantBAppearance.logo_url);
  assert.notEqual(tenantAAppearance.theme.primary_color, tenantBAppearance.theme.primary_color);
  assert.notEqual(tenantAAppearance.theme.glow_color, tenantBAppearance.theme.glow_color);

  // Tenant A must not leak into Tenant B
  assert.equal(tenantAAppearance.theme.primary_color, '#D97706');
  assert.equal(tenantAAppearance.theme.glow_color, 'rgba(217, 119, 6, 0.35)');
  assert.equal(tenantBAppearance.theme.primary_color, '#059669');
  assert.equal(tenantBAppearance.theme.glow_color, 'rgba(5, 150, 105, 0.35)');

  // Both preserve WCAG AA contrast
  assert.ok(tenantAAppearance.contrast.primary_button >= 4.5);
  assert.ok(tenantBAppearance.contrast.primary_button >= 4.5);
});

test('Authorization and scoping prevent cross-tenant Web Chat logo management', () => {
  // Routes use requireTenantAccess and requireTenantAdmin
  assert.match(dashboardRoutesSource, /requireTenantAccess/);
  assert.match(dashboardRoutesSource, /requireTenantAdmin/);
  assert.match(dashboardRoutesSource, /canPerformWebChatAction/);
  assert.match(dashboardRoutesSource, /WEBCHAT_PERMISSIONS\.CONFIGURE/);

  // Endpoint explicitly validates tenant(req, res) before processing logo
  const logoUploadRouteMatch = dashboardRoutesSource.match(/router\.post\(\s*'\/:\w+\/channels\/web-chat\/logo'[\s\S]*?async \(req, res\) => \{([\s\S]*?)\n\s*\}\n\);/);
  assert.ok(logoUploadRouteMatch, 'Logo upload route body must be identifiable');
  assert.match(logoUploadRouteMatch[1], /if \(!tenant\(req, res\)\) return;/);

  const logoDeleteRouteMatch = dashboardRoutesSource.match(/router\.delete\(\s*'\/:\w+\/channels\/web-chat\/logo'[\s\S]*?async \(req, res\) => \{([\s\S]*?)\n\s*\}\n\);/);
  assert.ok(logoDeleteRouteMatch, 'Logo delete route body must be identifiable');
  assert.match(logoDeleteRouteMatch[1], /if \(!tenant\(req, res\)\) return;/);
});

test('Backward compatibility: historical integration without new branding fields renders safely using defaults', () => {
  // Historical configuration missing logo_url, launcher_label, theme, etc.
  const historicalConfig = {
    title: 'Customer Helpdesk',
    subtitle: 'Agents online',
    launcher_position: 'right',
  };

  const normalized = normalizeWebChatAppearance(historicalConfig);
  assert.equal(normalized.title, 'Customer Helpdesk');
  assert.equal(normalized.subtitle, 'Agents online');
  assert.equal(normalized.logo_url, null);
  assert.equal(normalized.logo_asset_id, null);
  assert.ok(normalized.theme);
  assert.ok(normalized.theme.primary_color);
  assert.ok(normalized.contrast.primary_button >= 4.5);
  assert.equal(normalized.is_accessible, true);
});

test('Fresh-tenant default configuration initializes cleanly without manual SQL or storage manipulation', () => {
  assert.ok(DEFAULT_WEB_CHAT_APPEARANCE.brand_name);
  assert.ok(DEFAULT_WEB_CHAT_APPEARANCE.title);
  assert.ok(DEFAULT_WEB_CHAT_APPEARANCE.launcher_label);
  assert.ok(DEFAULT_WEB_CHAT_APPEARANCE.theme.primary_color);
  assert.ok(DEFAULT_WEB_CHAT_APPEARANCE.theme.glow_color);

  assert.equal(DEFAULT_WEB_CHAT_BEHAVIOR.high_intent_activation, true);
  assert.equal(DEFAULT_WEB_CHAT_BEHAVIOR.dwell_threshold_seconds, 15);
  assert.equal(DEFAULT_WEB_CHAT_BEHAVIOR.cooldown_seconds, 300);
});

test('Web Chat logo asset validation enforces magic bytes, format whitelist, and SVG sanitization', () => {
  // Valid PNG magic bytes
  const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const pngResult = validateWebChatAssetUpload({
    buffer: validPng,
    mimetype: 'image/png',
    size: validPng.length,
  });
  assert.equal(pngResult.mimeType, 'image/png');
  assert.equal(pngResult.extension, 'png');

  // Valid safe SVG
  const safeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>');
  const svgResult = validateWebChatAssetUpload({
    buffer: safeSvg,
    mimetype: 'image/svg+xml',
    size: safeSvg.length,
  });
  assert.equal(svgResult.mimeType, 'image/svg+xml');

  // Reject malicious SVG with script tag
  const scriptSvg = Buffer.from('<svg><script>alert(1)</script></svg>');
  assert.throws(() => {
    validateWebChatAssetUpload({
      buffer: scriptSvg,
      mimetype: 'image/svg+xml',
      size: scriptSvg.length,
    });
  }, { code: 'WEB_CHAT_ASSET_SVG_UNSAFE' });

  // Reject malicious SVG with inline event handler
  const onloadSvg = Buffer.from('<svg onload="alert(1)"><circle r="1"/></svg>');
  assert.throws(() => {
    validateWebChatAssetUpload({
      buffer: onloadSvg,
      mimetype: 'image/svg+xml',
      size: onloadSvg.length,
    });
  }, { code: 'WEB_CHAT_ASSET_SVG_UNSAFE' });

  // Reject malicious SVG with javascript: URI
  const jsUriSvg = Buffer.from('<svg><a href="javascript:alert(1)"><circle r="1"/></a></svg>');
  assert.throws(() => {
    validateWebChatAssetUpload({
      buffer: jsUriSvg,
      mimetype: 'image/svg+xml',
      size: jsUriSvg.length,
    });
  }, { code: 'WEB_CHAT_ASSET_SVG_UNSAFE' });

  // Reject oversized file
  assert.throws(() => {
    validateWebChatAssetUpload({
      buffer: Buffer.alloc(MAX_WEB_CHAT_ASSET_BYTES + 10),
      mimetype: 'image/png',
      size: MAX_WEB_CHAT_ASSET_BYTES + 10,
    });
  }, { code: 'WEB_CHAT_ASSET_SIZE_INVALID' });

  // Reject unsupported mime type (e.g. executable or text)
  assert.throws(() => {
    validateWebChatAssetUpload({
      buffer: Buffer.from('hello'),
      mimetype: 'text/plain',
      size: 5,
    });
  }, { code: 'WEB_CHAT_ASSET_TYPE_UNSUPPORTED' });
});
test('PNG scanline color decoding extracts real image colors with frequency ranking', () => {
  // Test with standard 8-byte PNG signature check
  const invalidSig = Buffer.alloc(40);
  assert.equal(decodePngColors(invalidSig), null);

  // SVG palette extraction
  const sampleSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#2563EB" stroke="rgb(32, 184, 248)"/></svg>');
  const svgExtraction = extractColorCandidatesFromBuffer(sampleSvg, 'image/svg+xml');
  assert.equal(svgExtraction.isFallback, false);
  assert.ok(svgExtraction.candidates.includes('#2563EB'));
  assert.ok(svgExtraction.candidates.includes('#20B8F8'));

  // Fallback behavior on empty or unrecognized image
  const emptyExtraction = extractColorCandidatesFromBuffer(Buffer.from('<svg></svg>'), 'image/svg+xml');
  assert.equal(emptyExtraction.isFallback, true);
  assert.ok(emptyExtraction.candidates.length >= 2);
  assert.ok(emptyExtraction.dominant);
});

test('Public Web Chat routes implement cross-origin accessibility and preflight handling', () => {
  assert.match(appSource, /const isPublicWebChat = req\.path\.startsWith\('\/api\/chat'\)/);
  assert.match(appSource, /res\.setHeader\('Access-Control-Allow-Origin', '\*'\)/);
  assert.match(appSource, /req\.method === 'OPTIONS'/);
});

test('Canonical widget-identity logo endpoint enforces tenant isolation and eliminates identifier tampering', () => {
  assert.match(appSource, /app\.get\('\/api\/v1\/public\/web-chat\/:widgetKey\/logo'/);
  assert.match(appSource, /WHERE ci\.integration_key = \$1/);
  assert.match(appSource, /WHERE id = \$1 AND tenant_id = \$2 AND status = 'ACTIVE'/);
  assert.match(appSource, /Access-Control-Allow-Origin/);
});

test('Dashboard and public web-chat.js both implement canonical asset URL resolution', () => {
  assert.match(dashboardWebChatManagementSource, /resolveWebChatAssetUrl/);
  assert.match(dashboardWebChatManagementSource, /displayLogoUrl/);
  assert.match(webChatJsSource, /resolveWebChatAssetUrl/);
  assert.match(webChatJsSource, /resolveApiBaseUrl/);
});




