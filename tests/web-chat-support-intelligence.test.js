import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyConversationIntent,
  evaluateSupportResolutionPlan,
  buildConversationIntelligencePromptSection,
  INTENT_TYPES,
  RESOLUTION_ACTIONS,
} from '../services/conversation-intelligence-service.js';
import {
  formatVisitorContextForHandoff,
  buildContextualIntelligencePromptSection,
} from '../services/contextual-intelligence-service.js';
import {
  buildTenantRuntimeSystemInstruction,
  TENANT_SUPPORT_RESOLUTION_POLICY,
  TENANT_FACTUAL_GROUNDING_POLICY,
} from '../services/tenant-runtime-persona-service.js';

// ============================================================================
// 1. MULTI-INDUSTRY INTENT CLASSIFICATION
// ============================================================================
test('SUPPORT INTELLIGENCE: Classifies support intents across diverse industries without brittle phrase matching', () => {
  // E-commerce support
  const ecomReturn = classifyConversationIntent({ message: 'What is your return policy and how do I send an item back?' });
  assert.equal(ecomReturn.isSupport, true);
  assert.equal(ecomReturn.primaryIntent, INTENT_TYPES.SUPPORT_INFORMATIONAL);

  const ecomTroubleshoot = classifyConversationIntent({ message: 'My AirPure purifier won\'t turn on and the filter light is blinking red' });
  assert.equal(ecomTroubleshoot.isSupport, true);
  assert.equal(ecomTroubleshoot.primaryIntent, INTENT_TYPES.SUPPORT_TROUBLESHOOTING);

  // SaaS support
  const saasLogin = classifyConversationIntent({ message: 'I cannot sign in to my workspace, my password reset link is invalid' });
  assert.equal(saasLogin.isSupport, true);
  assert.equal(saasLogin.primaryIntent, INTENT_TYPES.SUPPORT_ACCOUNT_ACCESS);

  const saasBug = classifyConversationIntent({ message: 'The analytics dashboard crashed with an error code 500 when exporting reports' });
  assert.equal(saasBug.isSupport, true);
  assert.equal(saasBug.primaryIntent, INTENT_TYPES.SUPPORT_TROUBLESHOOTING);

  // Real estate / hospitality support
  const propertyTrouble = classifyConversationIntent({ message: 'The central air conditioning unit is broken and leaking in unit 402' });
  assert.equal(propertyTrouble.isSupport, true);
  assert.equal(propertyTrouble.primaryIntent, INTENT_TYPES.SUPPORT_TROUBLESHOOTING);

  const hotelCancel = classifyConversationIntent({ message: 'What is your cancellation policy if I need to change my hotel reservation?' });
  assert.equal(hotelCancel.isSupport, true);
  assert.equal(hotelCancel.primaryIntent, INTENT_TYPES.SUPPORT_INFORMATIONAL);

  // Turkish language support
  const trIade = classifyConversationIntent({ message: 'Satın aldığım ürünü nasıl iade edebilirim, iade süresi kaç gün?' });
  assert.equal(trIade.isSupport, true);
  assert.equal(trIade.primaryIntent, INTENT_TYPES.SUPPORT_INFORMATIONAL);

  const trArıza = classifyConversationIntent({ message: 'Kulaklık telefona bağlanmıyor ve mavi ışık yanıp sönüyor, nasıl sıfırlanır?' });
  assert.equal(trArıza.isSupport, true);
  assert.equal(trArıza.primaryIntent, INTENT_TYPES.SUPPORT_TROUBLESHOOTING);
});

// ============================================================================
// 2. SALES + SUPPORT COEXISTENCE
// ============================================================================
test('SALES + SUPPORT COEXISTENCE: Successfully identifies hybrid queries containing both sales and support goals', () => {
  const hybrid = classifyConversationIntent({
    message: 'I want to buy the SAMCHE AirPure HEPA Purifier, but what is your return policy if it does not fit my room?',
  });

  assert.equal(hybrid.isSupport, true, 'Must detect support aspect (return policy)');
  assert.equal(hybrid.isSales, true, 'Must detect sales aspect (intent to buy)');
  assert.equal(hybrid.coexistence, true, 'Must flag coexistence');

  const plan = evaluateSupportResolutionPlan({ intentClassification: hybrid });
  assert.equal(plan.action, RESOLUTION_ACTIONS.COEXISTENCE_RESOLVE);
  assert.equal(plan.requiresHandoff, false, 'Must NOT handoff hybrid sales/support turn');
  assert.equal(plan.canResolveSafely, true);
});

// ============================================================================
// 3. AI-FIRST RESOLUTION CONTRACT (HUMAN HANDOFF IS NOT DEFAULT)
// ============================================================================
test('AI-FIRST RESOLUTION: Support intent does NOT automatically trigger human handoff', () => {
  const supportInquiries = [
    'What is your warranty period for electronic items?',
    'How do I clean the HEPA filter on the air purifier?',
    'When is the same-day delivery dispatch cutoff?',
    'Garanti süreniz ne kadar ve neleri kapsıyor?',
    'Cihazın fabrika ayarlarına sıfırlama adımları nelerdir?',
  ];

  for (const msg of supportInquiries) {
    const classification = classifyConversationIntent({ message: msg });
    assert.equal(classification.isSupport, true);
    assert.equal(classification.isHumanRequest, false);

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(plan.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE, `Expected AI_FIRST_RESOLVE for: "${msg}"`);
    assert.equal(plan.requiresHandoff, false, `Expected requiresHandoff=false for: "${msg}"`);
    assert.equal(plan.canResolveSafely, true);
  }
});

// ============================================================================
// 4. UNKNOWN PRIVATE STATE: NO FABRICATION & GUIDANCE ONLY
// ============================================================================
test('SUPPORT GROUNDING: Private customer record queries are recognized and bounded without fabrication', () => {
  const privateQueries = [
    'Where is my order #98214? Has it been shipped yet?',
    'Check tracking status for parcel TRK-882194',
    'Sipariş numaram #12345, kargom nerede?',
    'Can you refund my credit card for order #555?',
  ];

  for (const msg of privateQueries) {
    const classification = classifyConversationIntent({ message: msg });
    assert.equal(classification.isSupport, true);
    assert.equal(classification.isPrivateStateRequest, true, `Expected isPrivateStateRequest=true for: "${msg}"`);
    assert.equal(classification.primaryIntent, INTENT_TYPES.SUPPORT_PRIVATE_STATE);

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(plan.action, RESOLUTION_ACTIONS.EXPLAIN_LIMITATION_AND_GUIDE);
    assert.equal(plan.requiresHandoff, false, 'Do not automatically handoff private lookup queries');
    assert.match(plan.guidance, /live customer order\/account databases cannot be queried directly/i);

    const directive = buildConversationIntelligencePromptSection(plan);
    assert.match(directive, /Do NOT invent order status, delivery progress, or tracking numbers/i);
  }
});

// ============================================================================
// 5. EXPLICIT HUMAN ESCALATION
// ============================================================================
test('HUMAN ESCALATION: Explicit human requests trigger canonical escalation plan', () => {
  const explicitRequests = [
    'I want to speak with a human agent please',
    'Canlı destek temsilcisine bağlanmak istiyorum',
    'Connect me to an agent',
    'Müşteri temsilcisi ile görüşmek istiyorum',
    'Talk to a live person',
  ];

  for (const msg of explicitRequests) {
    const classification = classifyConversationIntent({ message: msg });
    assert.equal(classification.isHumanRequest, true, `Expected isHumanRequest=true for: "${msg}"`);
    assert.equal(classification.requiresHandoff, true);
    assert.equal(classification.primaryIntent, INTENT_TYPES.HUMAN_ESCALATION);

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(plan.action, RESOLUTION_ACTIONS.HUMAN_ESCALATION);
    assert.equal(plan.requiresHandoff, true);
    assert.equal(plan.stage, 'ESCALATE');
  }
});



// ============================================================================
// 6. CURRENT PAGE SITE INTELLIGENCE FOR SUPPORT
// ============================================================================
test('CURRENT PAGE SUPPORT: Correlates active page context to support resolution', () => {
  const browsingState = {
    currentPage: {
      url: 'https://demo.samchecompany.com/contact',
      path: '/contact',
      title: 'Contact Us & Return Hub',
      page_type: 'CONTACT',
    },
    currentEntity: {
      entity_type: 'SUPPORT_PAGE',
      entity_name: 'Customer Care & Returns',
      canonical_url: 'https://demo.samchecompany.com/contact',
      attributes: {
        return_center: 'Dubai Central Fulfillment Hub, UAE',
        support_hours: '08:00 - 22:00 GST Daily',
      },
    },
  };

  const classification = classifyConversationIntent({
    message: 'Where do I drop off my package for return?',
    browsingState,
  });

  assert.equal(classification.isSupport, true);
  assert.equal(classification.primaryIntent, INTENT_TYPES.SUPPORT_CURRENT_PAGE);
  assert.ok(classification.signals.includes('CURRENT_PAGE_SUPPORT_PAGE_CORRELATION'));

  const plan = evaluateSupportResolutionPlan({ intentClassification: classification, browsingState });
  assert.equal(plan.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE);
  assert.ok(plan.groundingSources.includes('CURRENT_PAGE_VISIBLE_FACT'));
});

// ============================================================================
// 7. LIVE INBOX VISITOR CONTEXT PRESERVATION
// ============================================================================
test('LIVE INBOX HANDOFF: Preserves page, entity, browsing history, and support context', () => {
  const browsingState = {
    currentPage: {
      url: 'https://demo.samchecompany.com/samche-airpure-hepa-desktop-purifier',
      path: '/samche-airpure-hepa-desktop-purifier',
      title: 'SAMCHE AirPure HEPA Desktop Purifier',
      page_type: 'PRODUCT',
    },
    currentEntity: {
      entity_name: 'SAMCHE AirPure HEPA Desktop Purifier',
      entity_type: 'PRODUCT',
      canonical_url: 'https://demo.samchecompany.com/samche-airpure-hepa-desktop-purifier',
      attributes: { price: '219.00', filter_type: 'H13 HEPA' },
    },
    previousEntities: [
      {
        entity_name: 'Wireless Noise-Cancelling Headphones',
        entity_type: 'PRODUCT',
        canonical_url: 'https://demo.samchecompany.com/wireless-headphones',
      },
    ],
  };

  const handoffContext = {
    supportTopic: 'Hardware Malfunction / Power Issue',
    lastIntent: INTENT_TYPES.SUPPORT_TROUBLESHOOTING,
    resolutionAttempts: ['DIAGNOSED_SENSOR_RESET_STEPS'],
  };

  const formatted = formatVisitorContextForHandoff(browsingState, handoffContext);

  assert.ok(formatted.current_page);
  assert.equal(formatted.current_page.title, 'SAMCHE AirPure HEPA Desktop Purifier');
  assert.ok(formatted.current_entity);
  assert.equal(formatted.current_entity.name, 'SAMCHE AirPure HEPA Desktop Purifier');
  assert.equal(formatted.previous_entities.length, 1);
  assert.equal(formatted.support_context, 'Hardware Malfunction / Power Issue');
  assert.equal(formatted.last_intent, INTENT_TYPES.SUPPORT_TROUBLESHOOTING);
  assert.deepEqual(formatted.ai_resolution_attempts, ['DIAGNOSED_SENSOR_RESET_STEPS']);
  assert.match(formatted.summary_text, /SAMCHE AirPure HEPA Desktop Purifier/);
  assert.match(formatted.summary_text, /Wireless Noise-Cancelling Headphones/);
});

// ============================================================================
// 8. ACTION-READY PIPELINE ARCHITECTURE (TASK 10 COMPATIBILITY)
// ============================================================================
test('ACTION-READY ARCHITECTURE: Emits structured plans compatible with Task 10 execution chain', () => {
  const troubleshootClassification = classifyConversationIntent({
    message: 'My device won\'t turn on, is there a reset button?',
  });

  const plan = evaluateSupportResolutionPlan({ intentClassification: troubleshootClassification });

  // Plan must expose all structured slots required by future Task 10 tool executor
  assert.ok(plan.action);
  assert.ok(plan.intent);
  assert.ok(plan.stage);
  assert.equal(typeof plan.canResolveSafely, 'boolean');
  assert.equal(typeof plan.requiresHandoff, 'boolean');
  assert.ok(Array.isArray(plan.groundingSources));
  assert.ok(plan.reason);
});

// ============================================================================
// 9. TENANT RUNTIME PERSONA INTEGRATION & GROUNDING INVARIANTS
// ============================================================================
test('TENANT PERSONA GROUNDING: System instruction contains AI-First Support Policy & Grounding Invariants', () => {
  const mockPersona = {
    available: true,
    companyIdentity: 'SAMCHE COMPANY LLC',
    assistantIdentity: 'SAMCHE Support AI',
    profile: {
      company_identity: 'SAMCHE COMPANY LLC',
      operating_hours: '08:00 - 22:00 GST',
      policies: '14-day return window at Dubai Central Fulfillment Hub',
    },
    configuration: {
      assistant_identity: 'SAMCHE Support AI',
      instructions: 'Provide courteous, grounded customer support and sales guidance.',
    },
  };

  const prompt = buildTenantRuntimeSystemInstruction({
    persona: mockPersona,
    knowledgeContext: 'AirPure filter reset: hold power button for 5 seconds.',
    channelRules: 'Return safe HTML.',
    contextualIntelligence: 'Current Page: /samche-airpure-hepa-desktop-purifier',
    conversationIntelligence: 'PRIMARY INTENT: SUPPORT_TROUBLESHOOTING\nACTION: AI_FIRST_RESOLVE',
  });

  assert.match(prompt, /AI-FIRST CUSTOMER SUPPORT RESOLUTION POLICY/);
  assert.match(prompt, /Human handoff is NOT the default resolution path/);
  assert.match(prompt, /Never invent or hallucinate private customer-specific records/);
  assert.match(prompt, /PRIMARY INTENT: SUPPORT_TROUBLESHOOTING/);
  assert.match(prompt, /AirPure filter reset: hold power button for 5 seconds/);
});

// ============================================================================
// 10. ZERO HARDCODED CUSTOMER NAMES IN PRODUCTION SERVICES
// ============================================================================
test('NO_HARDCODED_CUSTOMER_CODE: Production conversation-intelligence-service has zero customer UUIDs or hardcoded demo policies', () => {
  const serviceSource = fs.readFileSync(new URL('../services/conversation-intelligence-service.js', import.meta.url), 'utf8');

  // Verify no hardcoded UUIDs in production service
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  assert.doesNotMatch(serviceSource, uuidRegex, 'conversation-intelligence-service.js must not contain hardcoded UUIDs');

  // Verify generic multi-industry taxonomy
  assert.match(serviceSource, /SUPPORT_INFORMATIONAL/);
  assert.match(serviceSource, /SUPPORT_CURRENT_PAGE/);
  assert.match(serviceSource, /SUPPORT_TROUBLESHOOTING/);
  assert.match(serviceSource, /SALES_DISCOVERY/);
  assert.match(serviceSource, /COEXISTENCE_RESOLVE/);
});

// ============================================================================
// 11. PRODUCT-AWARE SUPPORT & FIRST-LINE AI CUSTOMER SERVICE CONTRACT
// ============================================================================
test('PRODUCT-AWARE FIRST-LINE SUPPORT: Common support phrases do not deflect to external support and correlate active product', () => {
  const browsingState = {
    currentPage: {
      url: 'https://demo.samchecompany.com/wireless-noise-cancelling-headphones',
      path: '/wireless-noise-cancelling-headphones',
      title: 'Wireless Noise-Cancelling Headphones',
      page_type: 'PRODUCT',
    },
    currentEntity: {
      entity_name: 'Wireless Noise-Cancelling Headphones',
      entity_type: 'PRODUCT',
      canonical_url: 'https://demo.samchecompany.com/wireless-headphones',
      attributes: { bluetooth: '5.2', anc: 'Active Noise Cancellation' },
    },
    previousEntities: [],
  };

  // A) "I need customer service with this problem"
  const turnA = classifyConversationIntent({
    message: 'I need customer service with this problem.',
    browsingState,
  });
  assert.equal(turnA.isHumanRequest, false, 'Must NOT be classified as explicit human escalation');
  assert.equal(turnA.isSupport, true, 'Must be classified as support');
  const planA = evaluateSupportResolutionPlan({ intentClassification: turnA, browsingState });
  assert.equal(planA.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE, 'Must be AI-first resolved');
  assert.equal(planA.requiresHandoff, false, 'Must NOT trigger human handoff');

  // B) "I have a problem with this." on known product page
  const turnB = classifyConversationIntent({
    message: 'I have a problem with this.',
    browsingState,
  });
  assert.equal(turnB.isHumanRequest, false);
  assert.equal(turnB.isSupport, true);
  const planB = evaluateSupportResolutionPlan({ intentClassification: turnB, browsingState });
  assert.equal(planB.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE);
  assert.equal(planB.requiresHandoff, false);

  // C) Ambiguous product (no active browsing state entity, no attachment)
  const turnC = classifyConversationIntent({
    message: 'I have a problem with a product I bought.',
    browsingState: null,
  });
  assert.equal(turnC.isHumanRequest, false);
  assert.equal(turnC.isSupport, true);
  const planC = evaluateSupportResolutionPlan({ intentClassification: turnC, browsingState: null });
  assert.equal(planC.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE);
  assert.equal(planC.requiresHandoff, false);

  // D) Explicit non-AI human insistence: "I don't want AI. Connect me to a real person."
  const turnD = classifyConversationIntent({
    message: "I don't want AI. Connect me to a real person.",
  });
  assert.equal(turnD.isHumanRequest, true, 'Must detect explicit human refusal of AI');
  const planD = evaluateSupportResolutionPlan({ intentClassification: turnD });
  assert.equal(planD.action, RESOLUTION_ACTIONS.HUMAN_ESCALATION);
  assert.equal(planD.requiresHandoff, true);

  // E) Explicit contact details query
  const turnE = classifyConversationIntent({
    message: 'What is your customer support email and phone number?',
  });
  assert.equal(turnE.isHumanRequest, false);
  assert.equal(turnE.primaryIntent, INTENT_TYPES.SUPPORT_CONTACT_INFO);
  const planE = evaluateSupportResolutionPlan({ intentClassification: turnE });
  assert.equal(planE.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE);
});

// ============================================================================
// 12. INTERACTIVE DIAGNOSTIC CONTINUATION (NO PREMATURE DEFLECTION / CONTACT INFO)
// ============================================================================
test('INTERACTIVE DIAGNOSTIC SUPPORT: Product troubleshooting keeps conversation in interactive resolution loop', () => {
  const headphoneIssue = classifyConversationIntent({
    message: 'Kulaklıklarım çalışmıyor, telefona bağlanmıyor.',
  });
  assert.equal(headphoneIssue.isSupport, true);
  assert.equal(headphoneIssue.primaryIntent, INTENT_TYPES.SUPPORT_TROUBLESHOOTING);

  const plan = evaluateSupportResolutionPlan({ intentClassification: headphoneIssue });
  assert.equal(plan.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE);
  assert.equal(plan.requiresHandoff, false);

  const promptSection = buildConversationIntelligencePromptSection(plan);
  assert.match(promptSection, /INTERACTIVE DIAGNOSTIC ENGAGEMENT/);
  assert.match(promptSection, /Treat troubleshooting as an active conversation/);
  assert.match(promptSection, /Do NOT automatically append support phone\/email unless troubleshooting is exhausted/);
});

test('CONTACT DISCLOSURE GATES: Contact details policy only permits phone/email disclosure under explicit gates', () => {
  const mockPersona = {
    available: true,
    companyIdentity: 'SamChe LLC',
    assistantIdentity: 'SamChe AI',
    profile: {
      company_identity: 'SamChe LLC',
      support_email: 'support@samche.com',
      support_phone: '+971 50 694 1372',
    },
    configuration: {
      assistant_identity: 'SamChe AI',
    },
  };

  const prompt = buildTenantRuntimeSystemInstruction({
    persona: mockPersona,
  });

  assert.match(prompt, /INTERACTIVE DIAGNOSIS & CONTACT DISCLOSURE GATES/);
  assert.match(prompt, /You MUST ONLY disclose support contact information \(support email\/phone\) when/);
  assert.match(prompt, /\(A\) the customer explicitly asks for contact details/i);
});


