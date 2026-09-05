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
  assert.match(source, /\/guide\/bootstrap/);
  assert.match(source, /X-Samcheguide-Preview/);
  assert.match(source, /preview:/);
});

test('bootstrap resumes an established opaque session before relying on a preview ticket', () => {
  const bootstrap = source.slice(source.indexOf("fetch('/guide/bootstrap'"));
  assert.match(bootstrap, /X-Samcheguide-Session/);
});

test('Guide handoff renders a generic structured context summary and persists it without a provider call', () => {
  assert.match(source, /guide-context-summary/);
  assert.match(source, /renderGuideContextSummary/);
  assert.match(source, /\/guide\/session-context/);
  assert.match(source, /Discuss this plan with the assistant/);
  assert.match(source, /async function handoffToAssistant\(\)[\s\S]*await persistGuideContext\(\)[\s\S]*guideState\.active_module = MODULES\.AI_ASSISTANT/);
});

test('Guide runtime uses concise module labels and premium readable interaction primitives', () => {
  const css = fs.readFileSync(new URL('../public-guide/guide.css', import.meta.url), 'utf8');
  assert.match(source, /navigation_label/);
  assert.match(css, /--guide-muted/);
  assert.match(css, /guide-context-summary/);
  assert.match(css, /guide-navigation__item\.is-active/);
  assert.match(css, /width:min\(100%,35rem\)/);
});

test('Roadmap review has an explicit deterministic state and a structured assistant handoff prefill', () => {
  assert.match(source, /roadmap_reviewed/);
  assert.match(source, /validateRoadmapForReview/);
  assert.match(source, /renderRoadmapReview/);
  assert.match(source, /buildAssistantPrefill/);
  assert.match(source, /assistant_draft_origin/);
  assert.match(source, /Discuss this plan with the assistant/);
});

test('Guide renders only the current Experience assets and keeps a missing avatar slot empty', () => {
  assert.match(source, /if \(!value\) return;/);
  assert.match(source, /experience\.avatar_url/);
  assert.match(source, /if \(experience\.avatar_url\)/);
  assert.doesNotMatch(source, /historical.*avatar|previous.*avatar/i);
});

test('Guide exposes one localized Thinking indicator rather than two ellipsis systems', () => {
  const css = fs.readFileSync(new URL('../public-guide/guide.css', import.meta.url), 'utf8');
  assert.match(source, /Düşünüyorum' : 'Thinking'/);
  assert.doesNotMatch(source, /Düşünüyorum…|Thinking…/);
  assert.match(css, /\.guide-thinking::after\{[^}]*content:'\.\.\.'/);
  assert.equal((css.match(/\.guide-thinking::after\{/g) ?? []).length, 1, 'one canonical Thinking selector');
});

test('Guide review uses stable field ids and focuses the actual missing field', () => {
  assert.match(source, /data-guide-field-id/);
  assert.match(source, /\[data-guide-field-id="\$\{invalid\.id\}"\]/);
  assert.match(source, /missingControl\?\.focus/);
});

test('Guide theme consumes explicit accessible tokens without filtering logo pixels', () => {
  const css = fs.readFileSync(new URL('../public-guide/guide.css', import.meta.url), 'utf8');
  assert.match(source, /--guide-button-foreground/);
  assert.doesNotMatch(css, /\.guide-logo[^}]*filter\s*:/i);
  assert.doesNotMatch(css, /mix-blend-mode/i);
});

test('conversational Roadmap is primary and shares visible progressive response semantics with Assistant', () => {
  assert.match(source, /renderConversationalRoadmap/);
  assert.match(source, /suggestedRoadmapIntents/);
  assert.match(source, /guide-thinking/);
  assert.match(source, /playGuideResponseEvents/);
  assert.match(source, /TEXT_DELTA/);
  assert.match(source, /prefers-reduced-motion/);
  assert.match(source, /guide_module/);
  assert.match(source, /guide-roadmap-composer/);
});

test('Guide safely formats progressive content, resumes opaque sessions, and shows a conversation reminder', () => {
  assert.match(source, /guide-response__section/);
  assert.match(source, /guide-response__list/);
  assert.match(source, /event\.text \|\| event\.title/);
  assert.match(source, /event\.actions/);
  assert.match(source, /Continue your conversation/);
  assert.match(source, /localStorage/);
  assert.match(source, /\/chat\/history/);
  assert.match(source, /\/guide\/session-context/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('Guide uses compact reusable pacing and consistent keyboard submission semantics', () => {
  assert.match(source, /PRESENTATION_TIMING/);
  assert.match(source, /sentence_pause_ms/);
  assert.match(source, /bindEnterToSubmit/);
  assert.match(source, /event\.shiftKey \|\| event\.isComposing/);
  assert.match(source, /guide-roadmap-composer/);
});

test('Roadmap actions keep refinement in the conversation instead of routing it to another module', () => {
  assert.match(source, /refine\|roadmap\|plan/i);
  assert.match(source, /guide-roadmap-composer'\)\?\.focus/);
});
