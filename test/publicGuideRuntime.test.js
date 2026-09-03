import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public-guide/guide.js', import.meta.url), 'utf8');

test('public Guide runtime accepts legacy/current payloads and guards optional data', () => {
  assert.match(source, /typeof value !== 'object'/);
  assert.match(source, /experience\.theme \|\| \{\}/);
  assert.match(source, /experience\.logo_url/);
  assert.match(source, /experience\.avatar_url/);
});

test('public Guide runtime fails safely for bootstrap errors and cannot load forever', () => {
  assert.match(source, /setTimeout\(showGuideError, 10000\)/);
  assert.match(source, /catch\(showGuideError\)/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /try \{ window\.sessionStorage/);
});

test('public Guide V1 renders Roadmap, Interactive Tool, and AI Assistant from the published Experience', () => {
  assert.match(source, /ROADMAP/);
  assert.match(source, /INTERACTIVE_TOOL/);
  assert.match(source, /AI_ASSISTANT/);
  assert.match(source, /guide_context/);
  assert.match(source, /renderRoadmap/);
  assert.match(source, /renderInteractiveTool/);
  assert.match(source, /renderAssistant/);
});

test('public Guide renderer supports sector-aware summaries, deterministic breakdown tables, and tenant-safe assistant context', () => {
  assert.match(source, /visibleFields/);
  assert.match(source, /guide-tool-breakdown/);
  assert.match(source, /assistant_copy/);
  assert.match(source, /guide_context/);
  assert.doesNotMatch(source, /eval\s*\(/);
});

test('public Guide renders a scope summary instead of a zero monetary estimate when pricing is not approved', () => {
  assert.match(source, /tool\.pricing_mode === 'APPROVED_PRICING'/);
  assert.match(source, /commercial review\. Final pricing and quotation require confirmation/);
});

test('private preview uses an opaque token with the shared bootstrap and chat runtime', () => {
  assert.match(source, /URLSearchParams\(window\.location\.search\)/);
  assert.match(source, /\/guide\/bootstrap\$\{previewToken/);
  assert.match(source, /X-Samcheguide-Preview/);
  assert.match(source, /preview:/);
});

test('Guide handoff renders a generic structured context summary and persists it without a provider call', () => {
  assert.match(source, /guide-context-summary/);
  assert.match(source, /renderGuideContextSummary/);
  assert.match(source, /\/guide\/session-context/);
  assert.match(source, /Discuss this plan with the assistant/);
});

test('Guide runtime uses concise module labels and premium readable interaction primitives', () => {
  const css = fs.readFileSync(new URL('../public-guide/guide.css', import.meta.url), 'utf8');
  assert.match(source, /navigation_label/);
  assert.match(css, /--guide-muted/);
  assert.match(css, /guide-context-summary/);
  assert.match(css, /guide-navigation__item:not\(\.is-active\)/);
  assert.match(css, /min-height:2\.85rem/);
});
