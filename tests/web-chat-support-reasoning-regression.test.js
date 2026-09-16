import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyConversationIntent,
  classifySupportCase,
  evaluatePolicyApplicability,
  evaluateSupportResolutionPlan,
  buildConversationIntelligencePromptSection,
  INTENT_TYPES,
  RESOLUTION_ACTIONS,
  SUPPORT_CASES,
  POLICY_SUBJECTS,
} from '../services/conversation-intelligence-service.js';
import {
  buildTenantRuntimeSystemInstruction,
  TENANT_SUPPORT_RESOLUTION_POLICY,
  TENANT_FACTUAL_GROUNDING_POLICY,
} from '../services/tenant-runtime-persona-service.js';
import {
  formatTenantSiteIntelligencePromptSection,
} from '../services/tenant-site-retrieval-service.js';

// ============================================================================
// TASK 8 — SUPPORT REASONING REGRESSION TEST SUITE:
// DEFECTIVE PRODUCT ≠ NORMAL RETURN
// ============================================================================

// ----------------------------------------------------------------------------
// CASE 1: Normal unopened return request -> applicable verified normal-return policy may be used
// ----------------------------------------------------------------------------
test('CASE 1: Normal unopened return request -> applicable verified normal-return policy may be used', () => {
  const query = 'How do I return an unopened item I purchased last week? What is the return window?';
  const classification = classifyConversationIntent({ message: query });

  assert.equal(classification.isSupport, true);
  assert.equal(classification.supportCase, SUPPORT_CASES.NORMAL_RETURN);
  assert.equal(classification.isHumanRequest, false);

  const policyEvaluation = evaluatePolicyApplicability({
    supportCase: classification.supportCase,
    policySubject: POLICY_SUBJECTS.NORMAL_RETURN,
    policyText: '14-day return window from delivery date for unopened products in original packaging.',
  });

  assert.equal(policyEvaluation.isApplicable, true);
  assert.equal(policyEvaluation.reason, 'NORMAL_RETURN_POLICY_APPLIES');

  const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
  assert.equal(plan.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE);
  assert.equal(plan.supportCase, SUPPORT_CASES.NORMAL_RETURN);
  assert.equal(plan.stage, 'RESOLVE');
  assert.equal(plan.canResolveSafely, true);
  assert.equal(plan.requiresHandoff, false);
});

// ----------------------------------------------------------------------------
// CASE 2: Opened defective product -> unopened-return policy is NOT falsely presented as applicable
// ----------------------------------------------------------------------------
test('CASE 2: Opened defective product -> unopened-return policy is NOT falsely presented as applicable', () => {
  const realHumanScenario = 'I received my order today, but the product is not working properly. I’m frustrated because I needed it urgently and I don’t want a generic answer telling me to contact support. What can you actually do to help me resolve this? Can I get a replacement or return it, and what exactly should I do next?';
  const classification = classifyConversationIntent({ message: realHumanScenario });

  assert.equal(classification.isSupport, true);
  assert.equal(classification.supportCase, SUPPORT_CASES.DEFECTIVE_OR_MALFUNCTION);
  assert.notEqual(classification.supportCase, SUPPORT_CASES.NORMAL_RETURN, 'Defective product must NOT be collapsed into NORMAL_RETURN');
  assert.equal(classification.isHumanRequest, false, 'Do not prematurely hand off to human without explicit request');

  // Grounding check: unopened return policy must NOT apply to an opened defective product
  const policyEvaluation = evaluatePolicyApplicability({
    supportCase: classification.supportCase,
    policySubject: POLICY_SUBJECTS.NORMAL_RETURN,
    policyText: '14-day return window from delivery date for unopened products in original packaging.',
  });

  assert.equal(policyEvaluation.isApplicable, false, 'Unopened return policy must NOT apply to opened defective item');
  assert.equal(policyEvaluation.reason, 'UNOPENED_RESTRICTION_INAPPLICABLE_TO_DEFECTIVE_PRODUCT');
  assert.match(policyEvaluation.directive, /DO NOT present the unopened return policy as applicable/i);

  const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
  assert.equal(plan.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE);
  assert.equal(plan.supportCase, SUPPORT_CASES.DEFECTIVE_OR_MALFUNCTION);
  assert.equal(plan.stage, 'DIAGNOSE_AND_RESOLVE');
  assert.equal(plan.policyApplicability.normalUnopenedReturnApplies, false);

  const promptDirective = buildConversationIntelligencePromptSection(plan);
  assert.match(promptDirective, /SUPPORT CASE: DEFECTIVE_OR_MALFUNCTION/);
  assert.match(promptDirective, /CRITICAL POLICY APPLICABILITY INVARIANTS FOR DEFECTIVE PRODUCTS/);
  assert.match(promptDirective, /A normal return policy requiring unopened items in original packaging does NOT apply/);
  assert.match(promptDirective, /NEVER promise a replacement or exchange unless an approved replacement policy is explicitly verified/);
  assert.match(promptDirective, /NEVER tell the customer to visit a fulfillment hub or warehouse in person/);
});

// ----------------------------------------------------------------------------
// CASE 3: Damaged-on-arrival product -> not automatically treated as normal return
// ----------------------------------------------------------------------------
test('CASE 3: Damaged-on-arrival product -> not automatically treated as normal return', () => {
  const queries = [
    'My package arrived crushed today and the device inside has a cracked screen',
    'Kargoda paket ezilmiş ve ürün kırık geldi, ne yapmam gerekiyor?',
    'The box was damaged in transit and the unit is shattered',
  ];

  for (const q of queries) {
    const classification = classifyConversationIntent({ message: q });
    assert.equal(classification.isSupport, true);
    assert.equal(classification.supportCase, SUPPORT_CASES.DAMAGED_ON_ARRIVAL, `Failed for query: "${q}"`);
    assert.notEqual(classification.supportCase, SUPPORT_CASES.NORMAL_RETURN);

    const policyEvaluation = evaluatePolicyApplicability({
      supportCase: classification.supportCase,
      policySubject: POLICY_SUBJECTS.NORMAL_RETURN,
      policyText: '14-day return window for unopened products in original packaging.',
    });
    assert.equal(policyEvaluation.isApplicable, false);
    assert.equal(policyEvaluation.reason, 'TRANSIT_DAMAGE_NOT_NORMAL_RETURN');

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(plan.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE);
    assert.equal(plan.supportCase, SUPPORT_CASES.DAMAGED_ON_ARRIVAL);
    assert.equal(plan.stage, 'ASSESS_AND_GUIDE');
    assert.equal(plan.policyApplicability.normalUnopenedReturnApplies, false);

    const promptDirective = buildConversationIntelligencePromptSection(plan);
    assert.match(promptDirective, /DAMAGED ARRIVAL/);
    assert.match(promptDirective, /Transit damage is NOT a standard change-of-mind return/);
  }
});

// ----------------------------------------------------------------------------
// CASE 4: Wrong item received -> not automatically treated as defective or normal return
// ----------------------------------------------------------------------------
test('CASE 4: Wrong item received -> not automatically treated as defective or normal return', () => {
  const queries = [
    'You sent me the wrong product, I ordered the 500W model but received the 250W model',
    'Sipariş ettiğim ürün yerine tamamen farklı bir model geldi',
    'I received the wrong item in my delivery',
  ];

  for (const q of queries) {
    const classification = classifyConversationIntent({ message: q });
    assert.equal(classification.isSupport, true);
    assert.equal(classification.supportCase, SUPPORT_CASES.WRONG_ITEM, `Failed for query: "${q}"`);
    assert.notEqual(classification.supportCase, SUPPORT_CASES.NORMAL_RETURN);
    assert.notEqual(classification.supportCase, SUPPORT_CASES.DEFECTIVE_OR_MALFUNCTION);

    const policyEvaluation = evaluatePolicyApplicability({
      supportCase: classification.supportCase,
      policySubject: POLICY_SUBJECTS.NORMAL_RETURN,
      policyText: '14-day return window for unopened products in original packaging.',
    });
    assert.equal(policyEvaluation.isApplicable, false);
    assert.equal(policyEvaluation.reason, 'FULFILLMENT_ERROR_NOT_NORMAL_RETURN');

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(plan.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE);
    assert.equal(plan.supportCase, SUPPORT_CASES.WRONG_ITEM);
    assert.equal(plan.stage, 'ASSESS_AND_GUIDE');

    const promptDirective = buildConversationIntelligencePromptSection(plan);
    assert.match(promptDirective, /WRONG ITEM RECEIVED/);
    assert.match(promptDirective, /Fulfillment error is NOT a normal return/);
  }
});


// ----------------------------------------------------------------------------
// CASE 5: Replacement requested but no verified replacement policy -> AI does NOT promise replacement
// ----------------------------------------------------------------------------
test('CASE 5: Replacement requested but no verified replacement policy -> AI does NOT promise replacement', () => {
  const query = 'My vacuum won\'t turn on. Can I get an immediate replacement shipped today?';
  const classification = classifyConversationIntent({ message: query });
  assert.equal(classification.supportCase, SUPPORT_CASES.DEFECTIVE_OR_MALFUNCTION);

  const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
  assert.equal(plan.policyApplicability.replacementRequiresVerification, true);

  const mockPersona = {
    available: true,
    companyIdentity: 'TechVibe Electronics',
    assistantIdentity: 'TechVibe Support AI',
    profile: {
      company_identity: 'TechVibe Electronics',
      policies: '14-day return policy for unopened items. No replacement policy published.',
    },
    configuration: {
      assistant_identity: 'TechVibe Support AI',
    },
  };

  const instruction = buildTenantRuntimeSystemInstruction({
    persona: mockPersona,
    conversationIntelligence: buildConversationIntelligencePromptSection(plan),
  });

  assert.match(instruction, /NO INVENTED OPERATIONAL STEPS OR PROMISES/);
  assert.match(instruction, /Never promise replacement or exchange eligibility unless an explicit replacement policy is verified/);
  assert.match(instruction, /clarify that replacement eligibility must be confirmed with the support team/);
});

// ----------------------------------------------------------------------------
// CASE 6: Verified defective/replacement policy exists -> AI can correctly use it
// ----------------------------------------------------------------------------
test('CASE 6: Verified defective/replacement policy exists -> AI can correctly use it', () => {
  const verifiedPolicyText = 'DEFECTIVE PRODUCT POLICY: Items found defective within 30 days of delivery are eligible for free exchange or replacement upon diagnostic verification.';
  
  const policyEvaluation = evaluatePolicyApplicability({
    supportCase: SUPPORT_CASES.DEFECTIVE_OR_MALFUNCTION,
    policySubject: POLICY_SUBJECTS.WARRANTY,
    policyText: verifiedPolicyText,
  });

  assert.equal(policyEvaluation.isApplicable, true);
  assert.equal(policyEvaluation.reason, 'VERIFIED_DEFECTIVE_OR_WARRANTY_POLICY_APPLIES');
  assert.match(policyEvaluation.directive, /Apply verified warranty\/defective terms directly/);
});


// ----------------------------------------------------------------------------
// CASE 7: No verified physical return location -> AI does NOT invent one
// ----------------------------------------------------------------------------
test('CASE 7: No verified physical return location -> AI does NOT invent one', () => {
  const mockPersona = {
    available: true,
    companyIdentity: 'Apex Appliances',
    assistantIdentity: 'Apex Support Bot',
    profile: {
      company_identity: 'Apex Appliances',
      policies: 'Returns are processed through our central distribution depot via courier pickup.',
    },
    configuration: {
      assistant_identity: 'Apex Support Bot',
    },
  };

  const instruction = buildTenantRuntimeSystemInstruction({ persona: mockPersona });

  assert.match(instruction, /Never instruct a customer to physically visit a fulfillment hub, warehouse, or office in person unless verified tenant knowledge explicitly confirms public walk-in customer drop-offs are accepted there/);
  assert.match(instruction, /Operational logistics hubs are not walk-in customer counters/);
});

// ----------------------------------------------------------------------------
// CASE 8: Verified support location exists -> AI may provide it
// ----------------------------------------------------------------------------
test('CASE 8: Verified support location exists -> AI may provide it', () => {
  const mockPages = [
    {
      title: 'Customer Service Center',
      url: 'https://example.com/contact',
      page_type: 'CONTACT',
      contact_info: {
        fulfillment_hub: 'Dubai Central Fulfillment Hub, Al Quoz Industrial 3',
        operating_hours: '09:00 - 18:00 Daily',
        phone: '+971 4 123 4567',
      },
    },
  ];

  const formattedSiteContext = formatTenantSiteIntelligencePromptSection(mockPages);
  assert.match(formattedSiteContext, /Fulfillment Hub: Dubai Central Fulfillment Hub, Al Quoz Industrial 3/);
  assert.match(formattedSiteContext, /Operating Hours: 09:00 - 18:00 Daily/);
  assert.match(formattedSiteContext, /LOGISTICS BOUNDARIES/);
});


// ----------------------------------------------------------------------------
// CASE 9: Private order state unavailable -> no hallucinated order status
// ----------------------------------------------------------------------------
test('CASE 9: Private order state unavailable -> no hallucinated order status', () => {
  const privateQueries = [
    'Where is my order #99281? Has it shipped?',
    'What is the delivery status of package #55122?',
    'Sipariş numaram #12345, kargom şu an nerede?',
  ];

  for (const q of privateQueries) {
    const classification = classifyConversationIntent({ message: q });
    assert.equal(classification.isSupport, true);
    assert.equal(classification.isPrivateStateRequest, true);
    assert.equal(classification.supportCase, SUPPORT_CASES.ORDER_STATUS);

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(plan.action, RESOLUTION_ACTIONS.EXPLAIN_LIMITATION_AND_GUIDE);
    assert.equal(plan.requiresHandoff, false);

    const directive = buildConversationIntelligencePromptSection(plan);
    assert.match(directive, /CRITICAL CONTRACT \(NO PRIVATE DATA FABRICATION\)/);
    assert.match(directive, /Do NOT invent order status, delivery progress, or tracking numbers/);
  }
});

// ----------------------------------------------------------------------------
// CASE 10: Explicit human request -> existing deterministic handoff remains functional
// ----------------------------------------------------------------------------
test('CASE 10: Explicit human request -> existing deterministic handoff remains functional', () => {
  const humanQueries = [
    'I want to speak with a human agent please',
    'Talk to a live person',
    'Canlı destek temsilcisine bağlanmak istiyorum',
    'أريد التحدث مع موظف',
  ];

  for (const q of humanQueries) {
    const classification = classifyConversationIntent({ message: q });
    assert.equal(classification.isHumanRequest, true);
    assert.equal(classification.requiresHandoff, true);
    assert.equal(classification.supportCase, SUPPORT_CASES.EXPLICIT_HUMAN_REQUEST);
    assert.equal(classification.primaryIntent, INTENT_TYPES.HUMAN_ESCALATION);

    const plan = evaluateSupportResolutionPlan({ intentClassification: classification });
    assert.equal(plan.action, RESOLUTION_ACTIONS.HUMAN_ESCALATION);
    assert.equal(plan.requiresHandoff, true);
    assert.equal(plan.stage, 'ESCALATE');
  }
});

// ----------------------------------------------------------------------------
// MULTI-INDUSTRY PURITY & ZERO SITE-SPECIFIC HARDCODING
// ----------------------------------------------------------------------------
test('MULTI-INDUSTRY PURITY: Zero hardcoded tenant IDs, demo domains, or product names in services', () => {
  const convIntelSource = fs.readFileSync(new URL('../services/conversation-intelligence-service.js', import.meta.url), 'utf8');
  const personaSource = fs.readFileSync(new URL('../services/tenant-runtime-persona-service.js', import.meta.url), 'utf8');

  // Verify no demo-specific terms hardcoded in production services
  assert.doesNotMatch(convIntelSource, /demo\.samchecompany\.com/i);
  assert.doesNotMatch(convIntelSource, /HydroClean/i);
  assert.doesNotMatch(convIntelSource, /Dubai Central Fulfillment/i);
  assert.doesNotMatch(personaSource, /HydroClean/i);
  assert.doesNotMatch(personaSource, /demo\.samchecompany\.com/i);

  // Verify generic support cases exist
  assert.ok(SUPPORT_CASES.NORMAL_RETURN);
  assert.ok(SUPPORT_CASES.DEFECTIVE_OR_MALFUNCTION);
  assert.ok(SUPPORT_CASES.DAMAGED_ON_ARRIVAL);
  assert.ok(SUPPORT_CASES.WRONG_ITEM);
  assert.ok(SUPPORT_CASES.MISSING_ITEM);
  assert.ok(SUPPORT_CASES.DELIVERY_ISSUE);
  assert.ok(SUPPORT_CASES.ORDER_STATUS);
});

