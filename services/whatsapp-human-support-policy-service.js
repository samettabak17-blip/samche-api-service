import { parseCustomerHumanSupportRequest } from './human-support-intent.js';

function topicText(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255);
}

export function summarizeWhatsAppHumanSupportTopic({ text, conversationHistory = [], fallback }) {
  const current = topicText(text);
  const request = parseCustomerHumanSupportRequest(current);
  if (current && (!request.requested || request.hasMeaningfulContext)) return current;
  return topicText(fallback) || null;
}
