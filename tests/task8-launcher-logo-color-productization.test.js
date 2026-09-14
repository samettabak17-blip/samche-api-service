import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveWebChatThemeTokens,
  contrastRatio,
  accessibleForegroundFor,
  isTransparent,
  normalizeColorToken,
} from '../services/web-chat-theme-service.js';
import {
  normalizeWebChatAppearance,
  DEFAULT_WEB_CHAT_APPEARANCE,
} from '../services/tenant-web-chat-provisioning-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const publicSource = fs.readFileSync(path.join(rootDir, 'public', 'web-chat.js'), 'utf8');
const dashboardContractSource = fs.readFileSync(
  path.join(rootDir, 'dashboard', 'src', 'features', 'channels', 'web-chat-canonical-contract.ts'),
  'utf8'
);

test('TASK 8: Pill style honors configured launcher background without forced dark gradient', () => {
  const customBg = '#4F46E5';
  const tokens = deriveWebChatThemeTokens({
    launcherStyle: 'pill',
    launcherThemeMode: 'custom',
    launcherBackground: customBg,
    launcherForeground: '#FFFFFF',
  });

  assert.equal(tokens.launcher_background, customBg);
  assert.equal(tokens.launcher_bg, customBg);
  assert.equal(tokens.launcher_foreground, '#FFFFFF');

  // Verify CSS in public and contract respects variable without overriding gradient
  assert.match(publicSource, /\.samche-launcher\.samche-style-pill\s*\{[^}]*background-color:\s*var\(--chat-launcher-bg,\s*#0F172A\)\s*!important/);
  assert.match(publicSource, /\.samche-launcher\.samche-style-pill\s*\{[^}]*background:\s*var\(--chat-launcher-bg,\s*#0F172A\)\s*!important/);
  assert.match(dashboardContractSource, /\.samche-launcher\.samche-style-pill\s*\{[^}]*background:\s*var\(--chat-launcher-bg,\s*#0F172A\)\s*!important/);
});

test('TASK 8: Glass style honors configured launcher background without forced dark fill', () => {
  const customBg = '#10B981';
  const tokens = deriveWebChatThemeTokens({
    launcherStyle: 'glass',
    launcherThemeMode: 'custom',
    launcherBackground: customBg,
  });

  assert.equal(tokens.launcher_background, customBg);
  assert.equal(tokens.launcher_bg, customBg);

  // Verify Glass CSS has backdrop-filter and honors --chat-launcher-bg
  assert.match(publicSource, /\.samche-launcher\.samche-style-glass\s*\{[^}]*background:\s*var\(--chat-launcher-bg/);
  assert.match(publicSource, /\.samche-launcher\.samche-style-glass\s*\{[^}]*backdrop-filter:\s*blur\(20px\)/);
  assert.match(dashboardContractSource, /\.samche-launcher\.samche-style-glass\s*\{[^}]*backdrop-filter:\s*blur\(20px\)/);
});

test('TASK 8: Neon Pulse style honors configured launcher background without forced dark gradient', () => {
  const customBg = '#7C3AED';
  const tokens = deriveWebChatThemeTokens({
    launcherStyle: 'neon_pulse',
    launcherThemeMode: 'custom',
    launcherBackground: customBg,
  });

  assert.equal(tokens.launcher_background, customBg);
  assert.equal(tokens.launcher_bg, customBg);

  // Verify Neon Pulse CSS honors --chat-launcher-bg and preserves strong pulse animation
  assert.match(publicSource, /\.samche-launcher\.samche-style-neon-pulse,\s*\.samche-launcher\.samche-style-neon_pulse\s*\{[^}]*background:\s*var\(--chat-launcher-bg/);
  assert.match(publicSource, /\.samche-launcher\.samche-style-neon-pulse,\s*\.samche-launcher\.samche-style-neon_pulse\s*\{[^}]*animation:\s*samche-glow-pulse-strong/);
  assert.match(dashboardContractSource, /\.samche-launcher\.samche-style-neon-pulse,\s*\.samche-launcher\.samche-style-neon_pulse\s*\{[^}]*animation:\s*samche-glow-pulse-strong/);
});

test('TASK 8: Circular style honors configured launcher background without forced radial gradient', () => {
  const customBg = '#EC4899';
  const tokens = deriveWebChatThemeTokens({
    launcherStyle: 'circular',
    launcherThemeMode: 'custom',
    launcherBackground: customBg,
  });

  assert.equal(tokens.launcher_background, customBg);
  assert.equal(tokens.launcher_bg, customBg);

  assert.match(publicSource, /\.samche-launcher\.samche-style-circular\s*\{[^}]*background:\s*var\(--chat-launcher-bg/);
  assert.match(dashboardContractSource, /\.samche-launcher\.samche-style-circular\s*\{[^}]*background:\s*var\(--chat-launcher-bg/);
});

test('TASK 8: Transparent launcher background persists canonically and flags contrast warning without fake fallback', () => {
  const tokens = deriveWebChatThemeTokens({
    launcherThemeMode: 'custom',
    launcherBackground: 'transparent',
    launcherForeground: '#10B981',
  });

  assert.equal(tokens.launcher_background, 'transparent');
  assert.equal(tokens.launcher_bg, 'transparent');
  assert.equal(tokens.launcher_foreground, '#10B981');
  assert.equal(tokens.contrast.launcher, null);
  assert.equal(tokens.contrast.launcher_transparent, true);
  assert.equal(tokens.is_accessible, false); // Does not claim WCAG AA pass based on fake fallback!
  assert.ok(tokens.contrast.launcher_warning);

  // Normalization persistence
  const norm = normalizeWebChatAppearance({
    launcher_theme_mode: 'custom',
    launcher_background: 'transparent',
    launcher_foreground: '#10B981',
    launcher_border_color: 'transparent',
    launcher_glow_color: 'transparent',
  });

  assert.equal(norm.launcher_background, 'transparent');
  assert.equal(norm.launcher_bg, 'transparent');
  assert.equal(norm.launcher_border_color, 'transparent');
  assert.equal(norm.launcher_glow_color, 'transparent');
  assert.equal(norm.theme.launcher_background, 'transparent');
  assert.equal(norm.theme.launcher_bg, 'transparent');
});

test('TASK 8: Logo background and border custom values persist canonically in appearance and theme', () => {
  const norm = normalizeWebChatAppearance({
    launcher_theme_mode: 'custom',
    launcher_logo_background: '#FFFFFF',
    launcher_logo_border_color: '#3B82F6',
  });

  assert.equal(norm.launcher_logo_background, '#FFFFFF');
  assert.equal(norm.launcher_logo_bg, '#FFFFFF');
  assert.equal(norm.launcher_logo_border_color, '#3B82F6');
  assert.equal(norm.launcher_logo_border, '#3B82F6');
  assert.equal(norm.theme.launcher_logo_background, '#FFFFFF');
  assert.equal(norm.theme.launcher_logo_bg, '#FFFFFF');
  assert.equal(norm.theme.launcher_logo_border_color, '#3B82F6');
  assert.equal(norm.theme.launcher_logo_border, '#3B82F6');
});

test('TASK 8: Transparent logo background and border persist canonically and allow transparent asset rendering', () => {
  const norm = normalizeWebChatAppearance({
    launcher_theme_mode: 'custom',
    launcher_logo_background: 'transparent',
    launcher_logo_border_color: 'transparent',
  });

  assert.equal(norm.launcher_logo_background, 'transparent');
  assert.equal(norm.launcher_logo_bg, 'transparent');
  assert.equal(norm.launcher_logo_border_color, 'transparent');
  assert.equal(norm.launcher_logo_border, 'transparent');
  assert.equal(norm.theme.launcher_logo_background, 'transparent');
  assert.equal(norm.theme.launcher_logo_border_color, 'transparent');

  // Verify launcher badge CSS consumes --chat-launcher-logo-bg and --chat-launcher-logo-border
  assert.match(publicSource, /\.samche-launcher-badge\s*\{[^}]*background:\s*var\(--chat-launcher-logo-bg,\s*transparent\)\s*!important/);
  assert.match(publicSource, /\.samche-launcher-badge\s*\{[^}]*border:\s*1\.5px solid var\(--chat-launcher-logo-border/);
  assert.match(dashboardContractSource, /\.samche-launcher-badge\s*\{[^}]*background:\s*var\(--chat-launcher-logo-bg,\s*transparent\)\s*!important/);
  assert.match(dashboardContractSource, /\.samche-launcher-badge\s*\{[^}]*border:\s*1\.5px solid var\(--chat-launcher-logo-border/);
});

test('TASK 8: Fresh tenant compatibility and historical config fallback', () => {
  // Fresh tenant empty config
  const freshAppearance = normalizeWebChatAppearance({}, 'Fresh Tenant');
  assert.equal(freshAppearance.launcher_theme_mode, 'follow_theme');
  assert.equal(freshAppearance.launcher_background, '#0F172A');
  assert.equal(freshAppearance.launcher_foreground, '#FFFFFF');
  assert.equal(freshAppearance.launcher_logo_background, 'transparent');
  assert.equal(freshAppearance.launcher_logo_border_color, 'transparent');

  // Historical config with only legacy keys (launcher_bg, launcher_text, launcher_border, launcher_glow)
  const historicalAppearance = normalizeWebChatAppearance({
    launcher_theme_mode: 'custom',
    launcher_bg: '#334155',
    launcher_text: '#F1F5F9',
    launcher_border: '#64748B',
    launcher_glow: '#475569',
  });

  assert.equal(historicalAppearance.launcher_background, '#334155');
  assert.equal(historicalAppearance.launcher_bg, '#334155');
  assert.equal(historicalAppearance.launcher_foreground, '#F1F5F9');
  assert.equal(historicalAppearance.launcher_text, '#F1F5F9');
  assert.equal(historicalAppearance.launcher_border_color, '#64748B');
  assert.equal(historicalAppearance.launcher_border, '#64748B');
  assert.equal(historicalAppearance.launcher_glow_color, '#475569');
  assert.equal(historicalAppearance.launcher_glow, '#475569');
  assert.equal(historicalAppearance.launcher_logo_background, 'transparent');
  assert.equal(historicalAppearance.launcher_logo_border_color, 'transparent');
});

test('TASK 8: Preview and Public Widget parity on all canonical tokens and CSS rules', () => {
  const canonicalTokens = [
    '--chat-launcher-bg',
    '--chat-launcher-text',
    '--chat-launcher-border',
    '--chat-launcher-glow',
    '--chat-launcher-logo-bg',
    '--chat-launcher-logo-border',
  ];

  for (const token of canonicalTokens) {
    assert.ok(publicSource.includes(token), `public/web-chat.js must contain ${token}`);
    assert.ok(dashboardContractSource.includes(token), `web-chat-canonical-contract.ts must contain ${token}`);
  }

  // Contract function must accept all canonical launcher and logo tokens
  const contractFnMatch = dashboardContractSource.includes('launcherBackground') &&
    dashboardContractSource.includes('launcherForeground') &&
    dashboardContractSource.includes('launcherBorderColor') &&
    dashboardContractSource.includes('launcherGlowColor') &&
    dashboardContractSource.includes('launcherLogoBackground') &&
    dashboardContractSource.includes('launcherLogoBorderColor');

  assert.ok(contractFnMatch, 'deriveCanonicalDesignTokens must accept all canonical tokens');
});
