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

