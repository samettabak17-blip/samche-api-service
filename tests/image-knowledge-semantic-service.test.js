import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEMANTIC_CATEGORIES,
  createImageKnowledgeSemanticClassifier,
  validateImageKnowledgeSemanticOutput,
} from '../services/image-knowledge-semantic-service.js';

const segments = [
  { id: 'business-service', segment_order: 0, role: 'BUSINESS', normalized_text: 'Hello. We provide corporate events, product launches, gala dinners and private celebrations. What kind of event are you planning? 10:13' },
  { id: 'business-question', segment_order: 1, role: 'BUSINESS', normalized_text: 'Do you already have a venue? Please share your estimated budget range.' },
  { id: 'business-context', segment_order: 2, role: 'BUSINESS', normalized_text: 'I noted a 120-person event with catering and two hosts for the client.' },
  { id: 'business-appointment', segment_order: 3, role: 'BUSINESS', normalized_text: 'I have noted 11:00. Speak tomorrow.' },
  { id: 'business-promise', segment_order: 4, role: 'BUSINESS', normalized_text: 'We will send your proposal today.' },
  { id: 'customer', segment_order: 5, role: 'CUSTOMER', normalized_text: 'Our budget is 5000 and my email is person@example.com.' },
  { id: 'unknown', segment_order: 6, role: 'UNKNOWN', normalized_text: 'Forwarded message.' },
];

test('accepts only structured, source-bound semantic classifications', () => {
  const output = validateImageKnowledgeSemanticOutput({
    classifications: [
      { segment_order: 0, category: 'DURABLE_BUSINESS_FACT', canonical_fact: 'The company provides corporate events, product launches, gala dinners and private celebrations.', confidence: 0.91 },
      { segment_order: 1, category: 'ASSISTANT_BEHAVIOR_OR_QUALIFICATION', canonical_fact: null, confidence: 0.82 },
      { segment_order: 2, category: 'CUSTOMER_SPECIFIC_CONTEXT', canonical_fact: null, confidence: 0.95 },
      { segment_order: 3, category: 'TRANSIENT_CONVERSATION', canonical_fact: null, confidence: 0.98 },
      { segment_order: 4, category: 'DURABLE_POLICY_OR_COMMITMENT_CANDIDATE', canonical_fact: null, confidence: 0.63 },
    ],
  }, segments);

  assert.deepEqual(output.map((item) => item.category), [
    'DURABLE_BUSINESS_FACT',
    'ASSISTANT_BEHAVIOR_OR_QUALIFICATION',
    'CUSTOMER_SPECIFIC_CONTEXT',
    'TRANSIENT_CONVERSATION',
    'DURABLE_POLICY_OR_COMMITMENT_CANDIDATE',
  ]);
  assert.equal(output[0].canonicalText, 'The company provides corporate events, product launches, gala dinners and private celebrations.');
  assert.equal(output.some((item) => item.segmentId === 'customer' || item.segmentId === 'unknown'), false);
  assert.equal(SEMANTIC_CATEGORIES.has('UNSAFE_OR_AMBIGUOUS'), true);
});

test('rejects a durable classification without decontextualized canonical text', () => {
  assert.throws(() => validateImageKnowledgeSemanticOutput({
    classifications: [{ segment_order: 0, category: 'DURABLE_BUSINESS_FACT', canonical_fact: null, confidence: 0.9 }],
  }, segments), { code: 'IMAGE_SEMANTIC_OUTPUT_INVALID' });
});

test('calls a provider-neutral classifier with redacted BUSINESS-only material', async () => {
  let received;
  const classifier = createImageKnowledgeSemanticClassifier({
    provider: {
      async classifyImageKnowledgeSegments(input) {
        received = input;
        return {
          classifications: [
            { segment_order: 0, category: 'DURABLE_BUSINESS_FACT', canonical_fact: 'The company provides corporate events, product launches, gala dinners and private celebrations.', confidence: 0.91 },
            { segment_order: 1, category: 'ASSISTANT_BEHAVIOR_OR_QUALIFICATION', canonical_fact: null, confidence: 0.82 },
            { segment_order: 2, category: 'CUSTOMER_SPECIFIC_CONTEXT', canonical_fact: null, confidence: 0.95 },
            { segment_order: 3, category: 'TRANSIENT_CONVERSATION', canonical_fact: null, confidence: 0.98 },
            { segment_order: 4, category: 'DURABLE_POLICY_OR_COMMITMENT_CANDIDATE', canonical_fact: null, confidence: 0.63 },
          ],
        };
      },
    },
  });

  const result = await classifier.classify({ segments });
  assert.equal(result.length, 5);
  assert.equal(received.segments.length, 5);
  assert.equal(received.segments.some((item) => /person@example\.com/.test(item.text)), false);
  assert.equal(result[0].category, 'DURABLE_BUSINESS_FACT');
});
