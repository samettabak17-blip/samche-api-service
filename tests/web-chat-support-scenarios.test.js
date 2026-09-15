import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyConversationIntent,
  evaluateSupportResolutionPlan,
  buildConversationIntelligencePromptSection,
  INTENT_TYPES,
  RESOLUTION_ACTIONS,
} from '../services/conversation-intelligence-service.js';
import {
  formatTenantSiteIntelligencePromptSection,
} from '../services/tenant-site-retrieval-service.js';

// ============================================================================
// SUPPORT SCENARIOS 1-7 ACCEPTANCE SUITE
// ============================================================================

test('SCENARIO 1: Product information question -> AI-First sales engagement without deflection', () => {
  const query = 'What are the main features of the HydroClean Robot Vacuum?';
  const classification = classifyConversationIntent({ message: query });

  assert.equal(classification.isSales, true);
  assert.equal(classification.isHumanRequest, false);

  const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
  assert.equal(plan.action, RESOLUTION_ACTIONS.SALES_ENGAGE);
  assert.equal(plan.requiresHandoff, false);

  const directive = buildConversationIntelligencePromptSection(plan);
  assert.match(directive, /ACTIVE SALES CONSULTANT CONTRACT/);
  assert.match(directive, /Do NOT behave as a passive answering machine/);
  assert.match(directive, /Proactively offer relevant next steps/);
});

test('SCENARIO 2: Product comparison question -> AI-First comparison without deflection', () => {
  const query = 'How does this vacuum cleaner compare to the handheld model I looked at earlier?';
  const classification = classifyConversationIntent({ message: query });

  assert.equal(classification.isSales, true);
  assert.equal(classification.primaryIntent, INTENT_TYPES.SALES_COMPARISON);

  const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
  assert.equal(plan.action, RESOLUTION_ACTIONS.SALES_ENGAGE);
  assert.equal(plan.requiresHandoff, false);
});

test('SCENARIO 3: Delivery/shipping support question -> AI-First direct resolution using site-wide intelligence', () => {
  const queries = [
    'How long does delivery take?',
    'What is your same-day delivery dispatch cutoff time?',
    'Teslimat süresi ne kadar ve kargo ne zaman çıkar?',
  ];

  for (const q of queries) {
    const classification = classifyConversationIntent({ message: q });
    assert.equal(classification.isSupport, true);
    assert.equal(classification.isHumanRequest, false);

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(plan.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE);
    assert.equal(plan.requiresHandoff, false);

    const directive = buildConversationIntelligencePromptSection(plan);
    assert.match(directive, /AI-FIRST SUPPORT RESOLUTION CONTRACT/);
    assert.match(directive, /Under NO circumstances should you deflect this resolvable support request/);
  }
});

test('SCENARIO 4: Return/refund support question -> AI-First direct resolution with step-by-step guidance', () => {
  const queries = [
    'How can I return this product if I change my mind?',
    'What is your return window and refund procedure?',
    'Satın aldığım ürünü nasıl iade edebilirim?',
  ];

  for (const q of queries) {
    const classification = classifyConversationIntent({ message: q });
    assert.equal(classification.isSupport, true);
    assert.equal(classification.isHumanRequest, false);

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(plan.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE);
    assert.equal(plan.requiresHandoff, false);

    const directive = buildConversationIntelligencePromptSection(plan);
    assert.match(directive, /Provide concrete, step-by-step instructions/);
  }
});

test('SCENARIO 5: Site/navigation & troubleshooting support -> AI-First resolution', () => {
  const queries = [
    'How do I cancel my order before it ships?',
    'Payment failed during checkout, what should I do?',
    'How do I use and clean the HEPA filter?',
    'Where is your fulfillment center located?',
  ];

  for (const q of queries) {
    const classification = classifyConversationIntent({ message: q });
    assert.equal(classification.isSupport, true);
    assert.equal(classification.isHumanRequest, false);

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(plan.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE);
    assert.equal(plan.requiresHandoff, false);
  }
});

test('SCENARIO 6: Private order-status request WITHOUT connector -> Explains limitation, gives safe guidance, zero hallucination, no handoff', () => {
  const queries = [
    'Where is my order #84920?',
    'Can you check the delivery status of package #99231?',
    'Sipariş numaram #48192, kargom şu an nerede?',
  ];

  for (const q of queries) {
    const classification = classifyConversationIntent({ message: q });
    assert.equal(classification.isSupport, true);
    assert.equal(classification.isPrivateStateRequest, true);
    assert.equal(classification.primaryIntent, INTENT_TYPES.SUPPORT_PRIVATE_STATE);

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(plan.action, RESOLUTION_ACTIONS.EXPLAIN_LIMITATION_AND_GUIDE);
    assert.equal(plan.requiresHandoff, false, 'Private status query must NOT automatically trigger human handoff');

    const directive = buildConversationIntelligencePromptSection(plan);
    assert.match(directive, /CRITICAL CONTRACT \(NO PRIVATE DATA FABRICATION\)/);
    assert.match(directive, /Do NOT invent order status, delivery progress, or tracking numbers/);
    assert.match(directive, /checking their confirmation email link or contacting support with their order ID/);
  }
});

test('SCENARIO 7: Explicit human request -> Honors explicit request and triggers human escalation plan', () => {
  const queries = [
    'I want a human',
    'I want to speak to a human',
    'Connect me to an agent please',
    'Canlı destek temsilcisine bağlanmak istiyorum',
    'Talk to a live person',
    'أريد موظف',
  ];

  for (const q of queries) {
    const classification = classifyConversationIntent({ message: q });
    assert.equal(classification.isHumanRequest, true, `Failed for query: "${q}"`);
    assert.equal(classification.requiresHandoff, true);
    assert.equal(classification.primaryIntent, INTENT_TYPES.HUMAN_ESCALATION);

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(plan.action, RESOLUTION_ACTIONS.HUMAN_ESCALATION);
    assert.equal(plan.stage, 'ESCALATE');
  }
});

test('SITE-WIDE INTELLIGENCE FORMATTING: Injects verified FAQs, policies, and reviews for cross-page resolution', () => {
  const mockPages = [
    {
      title: 'Customer Care & Shipping Policy',
      url: 'https://example.com/shipping',
      page_type: 'POLICY',
      policies: [
        { title: 'Standard Delivery', text: '1-2 business days across UAE. Free over 500 AED.' },
        { title: 'Same-Day Dispatch', text: 'Orders placed before 2:00 PM are dispatched same-day.' },
      ],
      faqs: [
        { question: 'How do I cancel my order?', answer: 'Orders can be cancelled before 2:00 PM cutoff by emailing support.' },
      ],
      contact_info: { email: 'support@example.com', phone: '+971 50 123 4567' },
    },
  ];

  const section = formatTenantSiteIntelligencePromptSection(mockPages);
  assert.match(section, /RELEVANT TENANT SITE-WIDE PAGES/);
  assert.match(section, /Standard Delivery: 1-2 business days/);
  assert.match(section, /Same-Day Dispatch/);
  assert.match(section, /Verified FAQs & Answers/);
  assert.match(section, /How do I cancel my order\?/);
  assert.match(section, /support@example\.com/);
});

