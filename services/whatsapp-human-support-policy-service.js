import { parseCustomerHumanSupportRequest } from './human-support-intent.js';

function topicText(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255);
}

export function summarizeWhatsAppHumanSupportTopic({ text, conversationHistory = [], fallback }) {
  const current = topicText(text);
  const request = parseCustomerHumanSupportRequest(current);
  if (current && (!request.requested || request.hasMeaningfulContext)) return current;
  for (const message of [...conversationHistory].reverse()) {
    if (!['CUSTOMER', 'USER'].includes(String(message?.sender_type ?? message?.role ?? '').toUpperCase())) continue;
    const candidate = topicText(message?.content ?? message?.text);
    if (candidate && !parseCustomerHumanSupportRequest(candidate).requested) return candidate;
  }
  return topicText(fallback) || null;
}
