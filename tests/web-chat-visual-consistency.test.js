import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtimeSource = fs.readFileSync(new URL('../public/web-chat.js', import.meta.url), 'utf8');

test('public/web-chat.js implements appearance persistence in SamcheChatPersistence', () => {
  assert.match(runtimeSource, /getAppearanceStorageKey:\s*function/);
  assert.match(runtimeSource, /getStoredAppearance:\s*function/);
  assert.match(runtimeSource, /storeAppearance:\s*function/);
  assert.match(runtimeSource, /samche_webchat_appearance_/);
});

test('public/web-chat.js rehydrates stored appearance immediately on mount before network', () => {
  assert.match(runtimeSource, /var storedAppearance = SamcheChatPersistence\.getStoredAppearance\(widgetKey\);/);
  assert.match(runtimeSource, /var effectiveAppearance = options\.appearance \|\| storedAppearance \|\| null;/);
  assert.match(runtimeSource, /applyTheme\(effectiveAppearance\);/);
});

test('public/web-chat.js applies theme CSS custom properties to host, wrap, and launcher', () => {
  assert.match(runtimeSource, /var targets = \[host, wrap, launcher\];/);
  assert.match(runtimeSource, /target\.style\.setProperty\('--chat-glow'/);
  assert.match(runtimeSource, /target\.style\.setProperty\('--chat-glow-ring'/);
  assert.match(runtimeSource, /target\.style\.setProperty\('--chat-glow-spread'/);
  assert.match(runtimeSource, /target\.style\.setProperty\('--chat-glow-halo'/);
  assert.match(runtimeSource, /target\.style\.setProperty\('--chat-pulse-duration'/);
});

test('public/web-chat.js protects host container against clipping and duplicate elements', () => {
  assert.match(runtimeSource, /host\.style\.isolation = 'isolate';/);
  assert.match(runtimeSource, /host\.style\.overflow = 'visible';/);
  assert.match(runtimeSource, /document\.querySelectorAll\('#samche-webchat-container'\)/);
  assert.match(runtimeSource, /eh\.parentElement\.removeChild\(eh\)/);
});

test('public/web-chat.js remounts disconnected host and restores canonical appearance during SPA navigation', () => {
  assert.match(runtimeSource, /if \(!isInline && host && typeof document !== 'undefined' && document\.body && \(!host\.isConnected \|\| !document\.body\.contains\(host\)\)\)/);
  assert.match(runtimeSource, /document\.body\.appendChild\(host\);/);
  assert.match(runtimeSource, /var effApp = currentAppearance \|\| SamcheChatPersistence\.getStoredAppearance\(widgetKey\);/);
  assert.match(runtimeSource, /applyTheme\(effApp\);/);
});

test('public/web-chat.js bounds intent nudge pulse and preserves multi-layer glow', () => {
  // Keyframe preserves halo and ring
  assert.match(runtimeSource, /@keyframes samche-intent-pulse \{ 0% \{ transform: scale\(1\); box-shadow: 0 0 calc\(var\(--chat-glow-spread/);
  assert.match(runtimeSource, /var\(--chat-glow-ring,/);
  assert.match(runtimeSource, /var\(--chat-glow-halo,/);
  // Bounded timer removes nudge class
  assert.match(runtimeSource, /nudgeTimer = setTimeout\(function\(\) \{\s*launcher\.classList\.remove\('samche-intent-pulse'\);/);
});

test('public/web-chat.js supports pageshow event for back/forward cache restoration', () => {
  assert.match(runtimeSource, /window\.addEventListener\('pageshow', function\(\)/);
  assert.match(runtimeSource, /var pApp = currentAppearance \|\| SamcheChatPersistence\.getStoredAppearance\(widgetKey\);/);
});
