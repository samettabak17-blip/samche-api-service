import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updateSessionBrowsingState,
  buildContextualIntelligencePromptSection,
  formatVisitorContextForHandoff,
} from '../services/contextual-intelligence-service.js';

test('Generic Service website: service page awareness, scope, and verified pricing only', () => {
  let sessionState = null;

  // Visitor views Dental Implant Service Page
  sessionState = updateSessionBrowsingState({
    currentState: sessionState,
    rawPageContext: {
      url: 'https://clinic.example.com/treatments/dental-implants',
      path: '/treatments/dental-implants',
      title: 'Titanium Dental Implants | Specialist Clinic',
      entity_type: 'SERVICE',
      entity_id: 'srv_dental_implants',
      entity_name: 'Titanium Dental Implants',
      summary: 'Permanent tooth restoration procedure using medical-grade titanium implants.',
      attributes: {
        procedure_duration: '60-90 minutes',
        recovery_time: '3-7 days',
        anesthesia: 'Local or Sedation',
        consultation_required: true,
        // Price is intentionally omitted here because exact quote depends on consultation
      },
    },
  });

  assert.equal(sessionState.currentEntity.entity_name, 'Titanium Dental Implants');
  assert.equal(sessionState.currentEntity.entity_type, 'SERVICE');

  const promptSection = buildContextualIntelligencePromptSection({
    currentEntity: sessionState.currentEntity,
    previousEntities: sessionState.previousEntities,
    locale: 'en',
    channelType: 'WEB_CHAT',
  });

  assert.match(promptSection, /Titanium Dental Implants/);
  assert.match(promptSection, /60-90 minutes/);
  assert.match(promptSection, /Local or Sedation/);
  assert.match(promptSection, /FACT vs RECOMMENDATION/);
  assert.match(promptSection, /NEVER invent or hallucinate missing facts/);

  const handoff = formatVisitorContextForHandoff(sessionState);
  assert.match(handoff.summary_text, /Titanium Dental Implants \(SERVICE\)/);
});
