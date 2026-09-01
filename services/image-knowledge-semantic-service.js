import { redactConversationCandidate } from './knowledge-intelligence-service.js';

export const SEMANTIC_CATEGORIES = new Set([
  'DURABLE_BUSINESS_FACT',
  'ASSISTANT_BEHAVIOR_OR_QUALIFICATION',
  'CUSTOMER_SPECIFIC_CONTEXT',
  'TRANSIENT_CONVERSATION',
  'DURABLE_POLICY_OR_COMMITMENT_CANDIDATE',
  'UNSAFE_OR_AMBIGUOUS',
]);

export class ImageKnowledgeSemanticError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function boundedText(value, maximum, code) {
  const normalized = String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > maximum) {
    throw new ImageKnowledgeSemanticError(code, 'Image semantic classification output is invalid');
  }
  return normalized;
}

function businessSegments(segments) {
  if (!Array.isArray(segments)) throw new ImageKnowledgeSemanticError('IMAGE_SEMANTIC_INPUT_INVALID', 'Image semantic input is invalid');
  return segments.filter((segment) => segment?.role === 'BUSINESS');
}

export function validateImageKnowledgeSemanticOutput(value, segments) {
  const business = businessSegments(segments);
  const byOrder = new Map(business.map((segment) => [Number(segment.segment_order), segment]));
  const classifications = value?.classifications;
  if (!Array.isArray(classifications) || classifications.length !== business.length) {
    throw new ImageKnowledgeSemanticError('IMAGE_SEMANTIC_OUTPUT_INVALID', 'Image semantic classification output is invalid');
  }
  const seen = new Set();
  return classifications.map((item) => {
    const segmentOrder = Number(item?.segment_order);
    const segment = byOrder.get(segmentOrder);
    const category = String(item?.category ?? '').toUpperCase();
    if (!segment || seen.has(segmentOrder) || !SEMANTIC_CATEGORIES.has(category)) {
      throw new ImageKnowledgeSemanticError('IMAGE_SEMANTIC_OUTPUT_INVALID', 'Image semantic classification output is invalid');
    }
    seen.add(segmentOrder);
    const confidence = Number(item?.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new ImageKnowledgeSemanticError('IMAGE_SEMANTIC_OUTPUT_INVALID', 'Image semantic classification output is invalid');
    }
    const rawCanonical = item?.canonical_fact;
    const canonicalText = rawCanonical === null || rawCanonical === undefined || rawCanonical === ''
      ? null
      : boundedText(redactConversationCandidate(String(rawCanonical)), 2000, 'IMAGE_SEMANTIC_OUTPUT_INVALID');
    if ((category === 'DURABLE_BUSINESS_FACT' || category === 'ASSISTANT_BEHAVIOR_OR_QUALIFICATION') !== Boolean(canonicalText)) {
      throw new ImageKnowledgeSemanticError('IMAGE_SEMANTIC_OUTPUT_INVALID', 'Image semantic classification output is invalid');
    }
    return Object.freeze({
      segmentId: segment.id,
      segmentOrder,
      category,
      canonicalText,
      confidence,
    });
  });
}

export function createImageKnowledgeSemanticClassifier({ provider } = {}) {
  if (typeof provider?.classifyImageKnowledgeSegments !== 'function') {
    throw new ImageKnowledgeSemanticError('IMAGE_SEMANTIC_CLASSIFIER_UNAVAILABLE', 'Image semantic classification is unavailable');
  }
  return Object.freeze({
    async classify({ segments }) {
      const business = businessSegments(segments);
      if (!business.length) return [];
      const output = await provider.classifyImageKnowledgeSegments({
        segments: business.map((segment) => ({
          segment_order: Number(segment.segment_order),
          text: boundedText(redactConversationCandidate(String(segment.normalized_text ?? '')), 12000, 'IMAGE_SEMANTIC_INPUT_INVALID'),
        })),
      });
      return validateImageKnowledgeSemanticOutput(output, segments);
    },
  });
}
