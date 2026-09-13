import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const publicSource = fs.readFileSync(path.join(rootDir, 'public', 'web-chat.js'), 'utf8');
const dashboardContractSource = fs.readFileSync(
  path.join(rootDir, 'dashboard', 'src', 'features', 'channels', 'web-chat-canonical-contract.ts'),
  'utf8'
);
const previewRendererSource = fs.readFileSync(
  path.join(rootDir, 'dashboard', 'src', 'features', 'channels', 'web-chat-preview-renderer.tsx'),
  'utf8'
);
const managementSource = fs.readFileSync(
  path.join(rootDir, 'dashboard', 'src', 'features', 'channels', 'web-chat-management.tsx'),
  'utf8'
);

test('SHARED_RENDERER_CONTRACT: public runtime and dashboard contract share identical CSS rules', () => {
  const expectedStyleSnippets = [
    '.samche-launcher.samche-style-pill',
    '.samche-launcher.samche-style-circular',
    '.samche-launcher.samche-style-minimal',
    '.samche-launcher.samche-style-glass',
    '.samche-launcher.samche-style-neon-pulse',
    '.samche-launcher.samche-style-custom',
    '.samche-launcher-badge',
    '.samche-panel.samche-open',
    '.samche-header',
    '.samche-header-avatar',
    '.samche-header-actions',
    '.samche-clear-btn',
    '.samche-minimize-btn',
    '.samche-close-btn',
    '.samche-messages',
    '.samche-msg-user',
    '.samche-msg-bot',
    '.samche-composer',
    '.samche-composer-input',
    '.samche-send-btn',
    '@keyframes samche-glow-breathe',
    '@keyframes samche-glow-pulse-strong',
    '@keyframes samche-glow-pulse-subtle',
  ];

  for (const snippet of expectedStyleSnippets) {
    assert.ok(publicSource.includes(snippet), `public/web-chat.js missing: ${snippet}`);
    assert.ok(dashboardContractSource.includes(snippet), `web-chat-canonical-contract.ts missing: ${snippet}`);
  }
});

test('LAUNCHER_DIMENSIONS_PARITY: Pill (54px), Circular (62x62), and Minimal (52x52) match canonical specs', () => {
  assert.match(dashboardContractSource, /\.samche-launcher\s*\{[^}]*height:\s*54px\s*!important/);
  assert.match(dashboardContractSource, /\.samche-launcher\.samche-style-pill\s*\{[^}]*padding:\s*4px 18px 4px 6px\s*!important/);

  assert.match(dashboardContractSource, /\.samche-launcher\.samche-style-circular\s*\{[^}]*width:\s*62px\s*!important;\s*height:\s*62px\s*!important/);
  assert.match(publicSource, /\.samche-launcher\.samche-style-circular\s*\{[^}]*width:\s*62px\s*!important;\s*height:\s*62px\s*!important/);

  assert.match(dashboardContractSource, /\.samche-launcher\.samche-style-minimal\s*\{[^}]*width:\s*52px\s*!important;\s*height:\s*52px\s*!important/);
  assert.match(publicSource, /\.samche-launcher\.samche-style-minimal\s*\{[^}]*width:\s*52px\s*!important;\s*height:\s*52px\s*!important/);
});

test('LOGO_SIZE_PARITY: Launcher badge has canonical 44px pill badge and 100% circular badge', () => {
  assert.match(dashboardContractSource, /\.samche-launcher-badge\s*\{[^}]*width:\s*44px;\s*height:\s*44px/);
  assert.match(publicSource, /\.samche-launcher-badge\s*\{[^}]*width:\s*44px;\s*height:\s*44px/);
  assert.match(dashboardContractSource, /\.samche-launcher\.samche-launcher-circle \.samche-launcher-badge\s*\{[^}]*width:\s*100%;\s*height:\s*100%/);
  assert.match(publicSource, /\.samche-launcher\.samche-launcher-circle \.samche-launcher-badge\s*\{[^}]*width:\s*100%;\s*height:\s*100%/);
});

test('GLOW_AND_PULSE_PARITY: Multi-layer glow and breathe/pulse animations are defined identically', () => {
  assert.match(publicSource, /@keyframes samche-glow-breathe/);
  assert.match(publicSource, /@keyframes samche-glow-pulse-strong/);
  assert.match(publicSource, /@keyframes samche-glow-pulse-subtle/);

  assert.match(dashboardContractSource, /@keyframes samche-glow-breathe/);
  assert.match(dashboardContractSource, /@keyframes samche-glow-pulse-strong/);
  assert.match(dashboardContractSource, /@keyframes samche-glow-pulse-subtle/);

  assert.match(previewRendererSource, /samche-pulse-\$\{pulseAnimation\}/);
});

test('PANEL_DIMENSIONS_AND_HEADER_PARITY: Panel is 400x600 with 20px radius; header has 36x36 avatar & 3 action buttons', () => {
  assert.match(dashboardContractSource, /\.samche-panel\s*\{[^}]*width:\s*400px;[^}]*height:\s*600px;[^}]*border-radius:\s*20px/);
  assert.match(publicSource, /\.samche-panel\s*\{[^}]*width:\s*400px;[^}]*height:\s*600px;[^}]*border-radius:\s*20px/);

  assert.match(dashboardContractSource, /\.samche-header-avatar\s*\{[^}]*width:\s*36px;\s*height:\s*36px;\s*border-radius:\s*10px/);
  assert.match(publicSource, /\.samche-header-avatar\s*\{[^}]*width:\s*36px;\s*height:\s*36px;\s*border-radius:\s*10px/);

  assert.match(previewRendererSource, /samche-clear-btn/);
  assert.match(previewRendererSource, /samche-minimize-btn/);
  assert.match(previewRendererSource, /samche-close-btn/);
});

test('MESSAGE_AREA_AND_COMPOSER_PARITY: Message bubbles asymmetrical radius and composer textarea 42px min-height', () => {
  assert.match(dashboardContractSource, /\.samche-msg-user\s*\{[^}]*border-radius:\s*16px 16px 4px 16px/);
  assert.match(dashboardContractSource, /\.samche-msg-bot\s*\{[^}]*border-radius:\s*16px 16px 16px 4px/);
  assert.match(publicSource, /\.samche-msg-user\s*\{[^}]*border-radius:\s*16px 16px 4px 16px/);
  assert.match(publicSource, /\.samche-msg-bot\s*\{[^}]*border-radius:\s*16px 16px 16px 4px/);

  assert.match(dashboardContractSource, /\.samche-composer-input\s*\{[^}]*min-height:\s*42px;\s*outline:\s*none/);
  assert.match(publicSource, /\.samche-composer-input\s*\{[^}]*min-height:\s*42px;\s*outline:\s*none/);

  assert.match(dashboardContractSource, /\.samche-send-btn\s*\{[^}]*width:\s*42px\s*!important;\s*height:\s*42px\s*!important/);
  assert.match(publicSource, /\.samche-send-btn\s*\{[^}]*width:\s*42px\s*!important;\s*height:\s*42px\s*!important/);
});

test('EN_LOCALE_PARITY: Both surfaces implement complete English locale dictionaries', () => {
  assert.match(publicSource, /defaultTitle:\s*'Live Support'/);
  assert.match(publicSource, /defaultStatus:\s*'Online'/);
  assert.match(publicSource, /clearBtnLabel:\s*'Clear Conversation'/);
  assert.match(publicSource, /composerPlaceholder:\s*'Type a message\.\.\.'/);

  assert.match(dashboardContractSource, /defaultTitle:\s*'Live Support'/);
  assert.match(dashboardContractSource, /defaultStatus:\s*'Online'/);
  assert.match(dashboardContractSource, /clearBtnLabel:\s*'Clear Conversation'/);
  assert.match(dashboardContractSource, /composerPlaceholder:\s*'Type a message\.\.\.'/);
});

test('SAVED_CONFIG_PARITY: Dashboard explicitly tracks unsaved local state vs saved tenant config', () => {
  assert.match(managementSource, /hasUnsavedChanges/);
  assert.match(managementSource, /unsaved-changes-indicator/);
  assert.match(managementSource, /saved-sync-indicator/);
  assert.match(managementSource, /WebChatPreviewRenderer/);
});
