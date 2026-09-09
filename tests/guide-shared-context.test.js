import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAndNormalizePageContext,
  resolvePageEntity,
  updateSessionBrowsingState,
  buildContextualIntelligencePromptSection,
  buildGuidePageContextSummary,
} from '../services/contextual-intelligence-service.js';
import { buildTenantRuntimeSystemInstruction } from '../services/tenant-runtime-persona-service.js';

test('Guide and Web Chatbot consume the same canonical contextual-intelligence service without duplicated logic', () => {
  const sharedPagePayload = {
    url: 'https://example.com/programs/executive-mba',
    path: '/programs/executive-mba',
    title: 'Executive MBA Program | Global Business School',
    entity_type: 'PROGRAM',
    entity_id: 'prog_emba_2026',
    entity_name: 'Executive MBA Program',
    summary: 'Part-time executive MBA for senior professionals.',
    attributes: {
      duration: '18 Months',
      format: 'Hybrid / Weekend',
      credits: 60,
      intake: 'September 2026',
    },
  };

  // 1. Web Chatbot pipeline
  const webChatBrowsingState = updateSessionBrowsingState({
    rawPageContext: sharedPagePayload,
  });
  const webChatContextSection = buildContextualIntelligencePromptSection({
    currentEntity: webChatBrowsingState.currentEntity,
    previousEntities: webChatBrowsingState.previousEntities,
    channelType: 'WEB_CHAT',
  });

  // 2. AI Guide pipeline
  const guideContextSection = buildGuidePageContextSummary(sharedPagePayload);

  // Both generate grounded context containing the exact canonical facts
  assert.match(webChatContextSection, /Executive MBA Program/);
  assert.match(webChatContextSection, /18 Months/);
  assert.match(webChatContextSection, /September 2026/);

  assert.match(guideContextSection, /Executive MBA Program/);
  assert.match(guideContextSection, /18 Months/);
  assert.match(guideContextSection, /September 2026/);

  // Both inject into the canonical buildTenantRuntimeSystemInstruction
  const mockPersona = {
    available: true,
    companyIdentity: 'Global Business School',
    assistantIdentity: 'Admissions Advisor',
    profile: {
      company_identity: 'Global Business School',
    },
    configuration: {
      assistant_identity: 'Admissions Advisor',
    },
  };

  const webChatInstruction = buildTenantRuntimeSystemInstruction({
    persona: mockPersona,
    channelRules: 'Web Chat presentation rules',
    contextualIntelligence: webChatContextSection,
  });

  const guideInstruction = buildTenantRuntimeSystemInstruction({
    persona: mockPersona,
    channelRules: 'Guide presentation rules',
    contextualIntelligence: guideContextSection,
  });

  assert.match(webChatInstruction, /Admissions Advisor/);
  assert.match(webChatInstruction, /Executive MBA Program/);
  assert.match(webChatInstruction, /Web Chat presentation rules/);

  assert.match(guideInstruction, /Admissions Advisor/);
  assert.match(guideInstruction, /Executive MBA Program/);
  assert.match(guideInstruction, /Guide presentation rules/);
});
