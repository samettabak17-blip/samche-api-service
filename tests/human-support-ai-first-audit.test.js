import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyConversationIntent,
  evaluateSupportResolutionPlan,
  INTENT_TYPES,
  RESOLUTION_ACTIONS,
} from '../services/conversation-intelligence-service.js';

test('AI-FIRST AUDIT: Ordinary support inquiries must NOT automatically trigger human handoff', () => {
  const normalSupportInquiries = [
    'I need support with my recent order delivery.',
    'I need customer service to help me choose the right product.',
    'I have a problem with my air purifier filter.',
    'Can someone help me understand how to setup this device?',
    'Yardım eder misiniz, cihaz çalışmıyor.',
    'Siparişimle ilgili destek almak istiyorum.',
    'I need customer service with this problem.',
    'I need support',
    'help me with this product',
    'I have a problem',
    'destek istiyorum',
    'müşteri hizmetlerine ihtiyacım var',
    'bununla ilgili yardıma ihtiyacım var',
  ];

  for (const query of normalSupportInquiries) {
    const classification = classifyConversationIntent({ message: query });
    assert.equal(
      classification.isHumanRequest,
      false,
      `Query "${query}" must NOT be classified as an explicit human request.`
    );

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(
      plan.requiresHandoff,
      false,
      `Query "${query}" must NOT require human handoff.`
    );
    assert.equal(plan.canResolveSafely, true);
  }
});

test('AI-FIRST AUDIT: Explicit human insistence triggers canonical human handoff flow', () => {
  const explicitHumanRequests = [
    'I want to speak to a human agent, not AI.',
    'Please connect me to a real person.',
    'Talk to a human please.',
    'Bot istemiyorum, bir insanla görüşmek istiyorum.',
    'Beni gerçek bir müşteri temsilcisine aktarın.',
    'Canlı bir temsilciye bağlanmak istiyorum.',
    "I don't want AI. Connect me to a real person.",
  ];

  for (const query of explicitHumanRequests) {
    const classification = classifyConversationIntent({ message: query });
    assert.equal(
      classification.isHumanRequest,
      true,
      `Query "${query}" MUST be recognized as an explicit human request.`
    );
    assert.equal(classification.primaryIntent, INTENT_TYPES.HUMAN_ESCALATION);

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(
      plan.requiresHandoff,
      true,
      `Query "${query}" MUST require canonical human handoff.`
    );
    assert.equal(plan.action, RESOLUTION_ACTIONS.HUMAN_ESCALATION);
  }
});
