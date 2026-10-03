import pool from '../config/db.js';
import { parseCustomerHumanSupportRequest } from './human-support-intent.js';
import { resolvePlatformHumanSupportPolicy } from './platform-lifecycle-message-service.js';
import { requestCustomerHumanSupport, triggerImmediateHumanSupportNotificationPipeline } from './human-support-service.js';
import { persistAssistantResponseIfCurrent } from './live-inbox-service.js';
import { deliverInstagramText, sendInstagramTypingIndicator, sendInstagramTypingOff } from './instagram-delivery-service.js';
import { resolveTenantRuntimePersona, buildTenantRuntimeSystemInstruction } from './tenant-runtime-persona-service.js';
import { resolveAssistantRuntimeKnowledgeContext } from './knowledge-runtime-context-service.js';
import { resolveCommunicationLanguage } from './conversation-communication-language.js';
import { evaluateChannelAiActivationPolicy } from './channel-ai-activation-policy-service.js';
import { applyWhatsAppAdaptivePacing } from './whatsapp-response-pacing-service.js';
import { resolveInstagramBehavioralPolicy } from './instagram-behavioral-policy-service.js';
import { createGoogleGeminiProvider } from './google-gemini-provider.js';
import { canonicalSharedAiRuntime } from './shared-ai-provider-resilience.js';
import {
  evaluateAndProcessHighIntentLead,
  hasHighIntentAppointmentSignals,
  extractBusinessActivity,
  extractPhoneNumberFromText,
  extractMeetingTimePreference,
  extractTimezoneFromText,
  extractJurisdictionPreference,
  extractVisaCount,
  extractShareholderCount,
  extractCustomerNameFromText,
  deriveInstagramLeadQualification,
} from './high-intent-lead-service.js';

const INSTAGRAM_BEHAVIORAL_CHANNEL_RULES_LIMIT = 80_000;

async function recordInstagramAssistantDeliverySuccess({ database, tenantId, messageId, providerMessageId }) {
  if (!messageId || !providerMessageId) return;
  const isPool = typeof database?.connect === 'function' && typeof database?.query !== 'function';
  const client = isPool ? await database.connect() : database;
  try {
    await client.query(
      `UPDATE conversation_messages
          SET external_message_id = $1,
              delivery_status = 'SENT',
              delivery_status_updated_at = CURRENT_TIMESTAMP,
              delivery_failure_code = NULL
        WHERE id = $2 AND tenant_id = $3 AND sender_type = 'ASSISTANT'`,
      [providerMessageId, messageId, tenantId]
    );
  } finally {
    if (isPool && typeof client?.release === 'function') client.release();
  }
}

async function recordInstagramAssistantDeliveryFailure({ database, tenantId, messageId, error }) {
  if (!messageId) return;
  const failureCode = String(error?.code || 'INSTAGRAM_DELIVERY_FAILED').slice(0, 80);
  const isPool = typeof database?.connect === 'function' && typeof database?.query !== 'function';
  const client = isPool ? await database.connect() : database;
  try {
    await client.query(
      `UPDATE conversation_messages
          SET delivery_status = 'FAILED',
              delivery_status_updated_at = CURRENT_TIMESTAMP,
              delivery_failure_code = $1
        WHERE id = $2 AND tenant_id = $3 AND sender_type = 'ASSISTANT'`,
      [failureCode, messageId, tenantId]
    );
  } finally {
    if (isPool && typeof client?.release === 'function') client.release();
  }
}


export const INSTAGRAM_CHANNEL_PRESENTATION_RULES = Object.freeze([
  'INSTAGRAM CHANNEL PRESENTATION & FORMATTING RULES:',
  '1. CHANNEL MEDIUM: You are conversing directly with a customer inside an Instagram Direct Message (DM). Present concise, clear, and natural responses suitable for mobile screens.',
  '2. PLAIN TEXT FORMATTING & READABILITY (CRITICAL):',
  '   - Keep responses mobile-friendly (typically under 800 characters).',
  '   - When presenting lists of items (numbered 1., 2. or bullet points •), EACH item MUST be placed on its own separate line.',
  '   - NEVER concatenate list items horizontally onto the same line.',
  '   - Separate distinct points or paragraphs with clean line breaks for effortless mobile reading.',
  '   - Do NOT use markdown bolding (**) or markdown headers (###); write plain, cleanly spaced text with bullet points (• ).',
  '3. INSTAGRAM TEXT-ONLY & NO VISUAL GENERATION:',
  '   - Instagram Direct Messaging is strictly text-only. Never generate images or invoke visual generation.',
  '   - If the customer asks to generate or create an image, respond naturally in text explaining that direct messages are text-only, and assist them directly with their business inquiry.',
  '4. CUSTOMER IDENTITY & ADDRESSING:',
  '   - If the customer\'s real display name is known (e.g. "Ahmet Yılmaz"), you may address them naturally and politely in Turkish (e.g. "Ahmet Bey" or natural conversational addressing).',
  '   - NEVER address the customer by their Instagram username (e.g. do NOT say "@ahmet34" or "@ahmetyilmaz").',
  '   - NEVER address the customer as "Instagram conversation", "Instagram User", or by an ID.',
  '   - Do NOT repeatedly use their name on every message; use it naturally where appropriate.',
  '5. NATURAL BRAND VOICE & IDENTITY:',
  '   - Do NOT introduce yourself as an "AI", "AI Assistant", "bot", or "virtual assistant".',
  '   - Do NOT falsely claim to be a physical human employee if identity is explicitly questioned, but speak naturally, humanly, and professionally.',
  '   - Respond in the customer’s language (e.g. natural, professional Turkish).',
  '6. ACCURACY & NO FALSE BOOKING CLAIMS:',
  '   - When meeting information is noted or collected, do NOT claim a calendar booking/appointment is definitively confirmed unless a real calendar booking exists. Clearly distinguish "görüşme talebinizi not ettim / aldım" from a confirmed calendar appointment.',
  '   - Do NOT append wa.me links, raw URLs, or URL-encoded payloads.',
  '7. INSTAGRAM DM MEDIA + TEXT INTENT PRIORITY (META ADS & SHARED MEDIA):',
  '   - Priority Hierarchy in Instagram DM: (1) Current user text message, (2) Previous conversation context, (3) Approved tenant knowledge / profile, (4) Media understanding.',
  '   - WRITTEN QUESTION HAS HIGHEST PRIORITY: When a customer sends an advertisement video, image, story mention, reel, post, or document accompanied by a written question or statement (e.g. "Dubai oturum ücretleri nedir?", "Nasıl oturum alırım?", "Bu hizmet nasıl çalışıyor?", "Peki fiyat nedir?"):',
  '     * You MUST directly and thoroughly answer the customer\'s written question grounded strictly in approved tenant knowledge.',
  '     * You MUST NOT ask "Videoyla/görselle ilgili nasıl yardımcı olabilirim?" or ask what the video is about when a written question is present.',
  '     * You MUST NOT explain, describe, or summarize the advertisement/media first instead of answering their question.',
  '     * You MUST NOT treat advertisement text/visuals as the user\'s question or assume unstated intent.',
  '     * Media serves solely as optional supporting context if the text is ambiguous, but NEVER overrides or delays answering the written question.',
  '   - MEDIA CONTENT IS NEVER AN AUTHORITATIVE BUSINESS SOURCE: Never extract prices, policies, guarantees, or service details from unverified advertisement media or user images. All factual claims must come strictly from approved tenant knowledge, business profile, and conversation memory.',
  '8. ONLY MEDIA WITHOUT TEXT INBOUND:',
  '   - If the user sends ONLY a media attachment (video, image, reel, story mention, or PDF/document) with NO written question or text:',
  '     * Ask: "Bu içerikle ilgili size nasıl yardımcı olabilirim?" (or in the customer\'s language).',
  '     * Do NOT automatically assume intent or make ungrounded assertions about unverified media.',
  '9. CONVERSATION CONTINUITY ACROSS TURNS:',
  '   - When a customer asks follow-up questions after sending media (e.g. Turn 1: [Ad video] "Bu hizmet nasıl oluyor?" -> Turn 2: "Peki fiyat nedir?"):',
  '     * Maintain seamless conversation context on the established topic.',
  '     * Do NOT restart the conversation, do NOT re-interrogate, and do NOT re-describe the media.',
].join('\n'));






export function buildInstagramBehavioralInstruction({
  currentIntent = '',
  conversationContext = '',
  behavioralPolicy = '',
} = {}) {
  const intent = String(currentIntent || '').trim();
  const context = String(conversationContext || '').trim();
  const policy = typeof behavioralPolicy === 'string' ? behavioralPolicy : '';

  return [
    intent ? `CURRENT CUSTOMER MESSAGE / HIGHEST PRIORITY INTENT:\n${intent}` : '',
    context ? `PERSISTED INSTAGRAM CONVERSATION CONTEXT:\n${context}` : '',
    policy.trim()
      ? [
          'INSTAGRAM BEHAVIORAL POLICY (MANDATORY BEHAVIORAL AUTHORITY):',
          'Execute these tenant-approved response rules, triggers, prepared answers, prohibitions, continuity rules, and formatting requirements before generating a response.',
          'When the policy defines a prepared answer or response behavior, preserve it exactly. Do not invent alternative procedures, legal requirements, prices, summaries, or workflows.',
          'This behavioral authority must not be overridden by general model knowledge or advertisement media. Approved tenant knowledge remains factual reference only.',
          policy,
        ].join('\n')
      : '',
  ].filter(Boolean).join('\n\n');
}

export function buildInstagramChannelRules({
  persona,
  currentIntent = '',
  conversationContext = '',
  customerIdentityContext = '',
} = {}) {
  const behavioralPolicy = resolveInstagramBehavioralPolicy({ persona }).policy;
  return [
    buildInstagramBehavioralInstruction({
      currentIntent,
      conversationContext,
      behavioralPolicy,
    }),
    INSTAGRAM_CHANNEL_PRESENTATION_RULES,
    customerIdentityContext,
  ].filter(Boolean).join('\n\n');
}

function logInstagramBehavioralPolicyDiagnostics({ assistantId, persona }) {
  const behavioralPolicy = resolveInstagramBehavioralPolicy({ persona });
  const policyVersion = persona?.configuration?.channel_adaptations?.instagram?.behavioral_policy_version;
  const safeAssistantId = assistantId ? String(assistantId).slice(0, 64) : 'unknown';
  const safeConfigurationId = persona?.configurationVersionId ? String(persona.configurationVersionId).slice(0, 64) : 'none';
  const safePolicyVersion = typeof policyVersion === 'string' && policyVersion.trim()
    ? policyVersion.trim().slice(0, 64)
    : 'none';

  console.info(
    `INSTAGRAM_AI_GENERATION_START` +
    ` assistant=${safeAssistantId}` +
    ` activeConfiguration=${safeConfigurationId}` +
    ` behavioralPromptPresent=${behavioralPolicy.configured ? '1' : '0'}` +
    ` behavioralPromptLength=${behavioralPolicy.policy.length}` +
    ` behavioralPolicyVersion=${safePolicyVersion}`,
  );
}

function logInstagramRuntimeContextDiagnostics({ systemInstruction, persona, knowledge, sharedContentContext = null }) {
  const behavioralPolicy = resolveInstagramBehavioralPolicy({ persona });
  const activeConfigurationId = persona?.configurationVersionId
    ? String(persona.configurationVersionId).slice(0, 64)
    : 'none';
  const tenantContext = typeof knowledge?.knowledgeContext === 'string' ? knowledge.knowledgeContext : '';

  console.info(
    `INSTAGRAM_AI_RUNTIME_CONTEXT` +
    ` finalSystemInstructionLength=${String(systemInstruction || '').length}` +
    ` behavioralPromptPresent=${behavioralPolicy.configured ? '1' : '0'}` +
    ` behavioralPromptLength=${behavioralPolicy.policy.length}` +
    ` tenantContextLength=${tenantContext.length}` +
    ` sharedContentContextPresent=${sharedContentContext?.present ? '1' : '0'}` +
    ` activeConfiguration=${activeConfigurationId}`,
  );
}

function logInstagramAppointmentStateDiagnostics({ appointmentState }) {
  if (!appointmentState?.hasHighIntent) return;
  const missingFields = Array.isArray(appointmentState.missing) ? appointmentState.missing.join(',') : 'none';
  console.info(
    `APPOINTMENT_STATE channel=INSTAGRAM` +
    ` intent=${appointmentState.hasHighIntent ? 'true' : 'false'}` +
    ` purposeKnown=${appointmentState.purposeKnown ? 'true' : 'false'}` +
    ` dateKnown=${appointmentState.preferredDate ? 'true' : 'false'}` +
    ` timeKnown=${appointmentState.preferredTime ? 'true' : 'false'}` +
    ` timePrecision=${appointmentState.timePrecision || 'NONE'}` +
    ` missingFields=${missingFields}` +
    ` status=${appointmentState.status || 'COLLECTING'}`,
  );
}

function logInstagramSharedContentDiagnostics({ sharedContentContext, explicitTextPresent = false }) {
  if (!sharedContentContext?.present) return;
  const item = (sharedContentContext.instruction.match(/Shared content type: ([^\n]+)/i)?.[1] || 'UNKNOWN').replace(/[^A-Z0-9_]/gi, '_');
  console.info(
    `INSTAGRAM_SHARED_CONTENT_CONTEXT type=${item.slice(0, 32)}` +
    ` explicitTextPresent=${explicitTextPresent ? 'true' : 'false'}` +
    ` captionPresent=${sharedContentContext.instruction.includes('- Caption:') ? 'true' : 'false'}` +
    ` referralPresent=${sharedContentContext.instruction.includes('- Referral text:') ? 'true' : 'false'}` +
    ` topicContextPresent=${sharedContentContext.topicContextPresent ? 'true' : 'false'}` +
    ` primaryIntentSource=${explicitTextPresent ? 'USER_TEXT' : sharedContentContext.topicContextPresent ? 'SHARED_CONTENT_METADATA' : 'NONE'}`,
  );
}

function resolveInstagramAppointmentState({ rawMessages = [], currentText = '', contactPhone = null, activeConversationTopic = null } = {}) {
  const messages = [...(Array.isArray(rawMessages) ? rawMessages : [])];
  if (currentText && !messages.some((message) => message?.sender_type === 'CUSTOMER' && message?.content === currentText)) {
    messages.push({ sender_type: 'CUSTOMER', content: currentText });
  }
  return deriveInstagramLeadQualification({
    customerMessages: messages,
    currentMessage: currentText,
    activeConversationTopic,
    contactPhone,
  });
}

function logInstagramAppointmentContextResolution({ appointmentState, activeTopicPresent = false }) {
  if (!appointmentState?.hasHighIntent) return;
  console.info(
    `APPOINTMENT_CONTEXT_RESOLUTION` +
    ` purposeKnown=${appointmentState.purposeKnown ? 'true' : 'false'}` +
    ` purposeSource=${appointmentState.purposeSource || 'UNKNOWN'}` +
    ` activeTopicPresent=${activeTopicPresent ? 'true' : 'false'}` +
    ` dateKnown=${appointmentState.preferredDate ? 'true' : 'false'}` +
    ` timeKnown=${appointmentState.preferredTime ? 'true' : 'false'}` +
    ` missingFields=${Array.isArray(appointmentState.missing) ? appointmentState.missing.join(',') : 'none'}`,
  );
}

function resolveActiveInstagramConversationTopic({ durableMemory, rawMessages = [], sharedContentContext, currentText = '' } = {}) {
  if (durableMemory?.serviceRequested) return durableMemory.serviceRequested;
  if (!sharedContentContext?.topicText) return null;

  const hasPriorExplicitCustomerTurn = (Array.isArray(rawMessages) ? rawMessages : []).some((message) => {
    if (message?.sender_type !== 'CUSTOMER') return false;
    const content = String(message.content || '').trim();
    return content
      && content !== String(currentText || '').trim()
      && !isMediaOnlyInbound(content);
  });

  return hasPriorExplicitCustomerTurn ? sharedContentContext.topicText : null;
}

export function extractReliableCustomerName(rawDisplayName) {
  if (!rawDisplayName || typeof rawDisplayName !== 'string') return null;
  const trimmed = rawDisplayName.trim();
  if (trimmed.startsWith('instagram:') || trimmed === 'Instagram conversation' || trimmed === 'Instagram User') {
    return null;
  }
  const match = trimmed.match(/^([^(]+)(?:\s*\(@[^)]+\))?$/);
  const nameCandidate = (match?.[1] || trimmed).trim();
  if (!nameCandidate || nameCandidate.startsWith('@') || nameCandidate.toLowerCase() === 'instagram user') {
    return null;
  }
  return nameCandidate;
}

/**
 * Strips unsupported automated contact promises and unwanted URLs/CTAs from AI generated responses,
 * enforcing truthfulness in channel communications without mutating the Main business policy.
 */
export function sanitizeInstagramOutboundResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText;

  // 1. Strip any wa.me links, WhatsApp CTA links, and raw URL-encoded URLs
  text = text.replace(/https?:\/\/wa\.me\/\S+/gi, '');
  text = text.replace(/\bwa\.me\/\S+/gi, '');
  text = text.replace(/https?:\/\/[^\s]*%[0-9A-Fa-f]{2}[^\s]*/g, '');

  // 2. Strip CTA lead sentences if present
  text = text.replace(/[^.!?\n]*\b(?:Aşağıdaki\s+bağlantı|bağlantı\s+üzerinden\s+WhatsApp|WhatsApp'tan\s+doğrudan\s+iletişime)[^.!?\n]*[.!?]?/giu, '');

  // 3. Patterns for false contact promises (e.g. "telefon numarası üzerinden sizinle iletişime geçeceğiz", "ekibimiz sizi arayacak")
  const sentencePatterns = [
    /[^.!?\n]*\b(?:iletişime\s+geç\w*|arayacağ\w*|ulaşacağ\w*|ulaşılacak\w*|aranacak\w*)[^.!?\n]*[.!?]?/giu,
    /[^.!?\n]*\b(?:numara\w*\s+üzerinden)[^.!?\n]*[.!?]?/giu,
    /[^.!?\n]*\b(?:görüşmek\s+üzere)[^.!?\n]*[.!?]?/giu,
  ];

  for (const pattern of sentencePatterns) {
    text = text.replace(pattern, '');
  }

  // Clean up leftover phrases cleanly
  text = text
    .replace(/(?:için\s+)?notumu\s+aldım\s*\.?/giu, 'için görüşme talebinizi kaydettim.')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return text;
}


/**
 * Normalizes and formats AI response text for optimal readability in Instagram Direct Messages.

 * Guarantees vertical separation of list items, strips raw markdown fences, and formats clean paragraph breaks.
 */
export function formatInstagramDmResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText.trim();

  // 1. Strip markdown headers like ### or ## or # at line starts
  text = text.replace(/^#{1,6}\s*(.+)$/gm, '$1');

  // 2. Separate inline bold titles before colons: e.g. "Item. **Mainland:** * ..." -> "Item.\n\n**Mainland:** * ..."
  text = text.replace(/([^\n])\s+(\*\*[^\*\n]+:\*\*)/g, '$1\n\n$2');

  // 3. Strip bold wrappers like **text** or __text__
  text = text.replace(/\*\*(.*?)\*\*/g, '$1');
  text = text.replace(/__(.*?)__/g, '$1');

  // 4. Strip code backticks: `code` -> code
  text = text.replace(/`([^`]+)`/g, '$1');

  // 5. Put paragraph break between heading with colon and first bullet or numbered item:
  // e.g. "Free Zone:\n* Item 1" or "Free Zone: * Item 1" -> "Free Zone:\n\n• Item 1"
  text = text.replace(/([^\n]+:)\s*([•\-\*]\s+)/g, '$1\n\n$2');
  text = text.replace(/([^\n]+:)\s*(\d+\.\s+)/g, '$1\n\n$2');

  // 6. Put each bullet point on its own line if concatenated inline:
  // e.g. "• Item 1 • Item 2" or "* Item 1 * Item 2" -> "• Item 1\n• Item 2"
  text = text.replace(/([^\n])\s+([•\-\*]\s+)/g, '$1\n$2');

  // 7. Put each numbered list item on its own paragraph if concatenated inline:
  // e.g. "1. First 2. Second" -> "1. First\n\n2. Second"
  text = text.replace(/([^\n])\s+(\d+\.\s+)/g, '$1\n\n$2');

  // 8. Standardize bullet list markers (*, -, +) at line start to •
  text = text.replace(/^[\t ]*[\*\-\+]\s+/gm, '• ');

  // 9. Strip single-asterisk italic markdown when not a bullet marker
  text = text.replace(/(^|[^\*])\*([^\*\n]+)\*([^\*]|$)/g, '$1$2$3');

  // 10. Ensure clean separation between bullet lists and following headings
  text = text.replace(/(•[^\n]+)\n([A-Za-z0-9ÇĞİÖŞÜçğıöşü\s]+:)/g, '$1\n\n$2');

  // 11. Normalize excessive blank lines (more than 2 consecutive newlines -> 2)
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Merges consecutive same-role messages so that chunked transport messages (or burst messages)
 * are represented as exactly one logical conversational turn.
 */
export function mergeConsecutiveConversationTurns(rawMessages = []) {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return [];
  const merged = [];
  for (const msg of rawMessages) {
    const role = msg.sender_type === 'CUSTOMER' ? 'user' : 'model';
    const text = String(msg.content || '').trim();
    if (!text) continue;
    if (merged.length > 0 && merged[merged.length - 1].role === role) {
      merged[merged.length - 1].parts[0].text += '\n\n' + text;
      merged[merged.length - 1].content += '\n\n' + text;
    } else {
      merged.push({
        role,
        parts: [{ text }],
        sender_type: msg.sender_type,
        content: text,
      });
    }
  }
  return merged;
}

function normalizeTrText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .normalize('NFKC')
    .toLowerCase()
    .trim();
}

export function isGreetingOnly(text = '') {
  if (typeof text !== 'string') return false;
  const clean = text.trim();
  const normalized = normalizeTrText(clean)
    .replace(/[!.,?:;()\[\]{}…~*_\-—–"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return false;

  const greetingPattern = /^(?:merhaba|merhabalar|selam|selamlar|selamun\s+aleykum|selamün\s+aleyküm|sa|slm|mrb|iyi\s+gunler|iyi\s+aksamlar|gunaydin|tekrar\s+merhaba|merhaba\s+samed\s+bey|merhaba\s+samed|selam\s+samed\s+bey|selam\s+samed|hello|hi|hey|good\s+morning|good\s+afternoon|good\s+evening)$/i;

  return greetingPattern.test(normalized);
}

export function hasCurrentTurnMeetingIntent(text = '') {
  if (typeof text !== 'string') return false;
  return /(?:görüşmek\s+istiyorum|gorusmek\s+istiyorum|görüşme\s+yapmak|gorusme\s+yapmak|telefonla\s+görüş|telefonla\s+gorus|randevu\s+alabilir\s+miyim|randevu\s+almak\s+istiyorum|randevu\s+istiyorum|randevu\s+talebi|arayabilir\s+misiniz|arar\s+misiniz|arayın|ararmisiniz|sizinle\s+görüş|sizinle\s+gorus|sizinle\s+konuş|sizinle\s+konus|samed\s+bey\s+ile\s+görüş|samed\s+bey\s+ile\s+gorus|samed\s+beyle\s+görüş|samed\s+beyle\s+gorus|konuşmak\s+istiyorum|konusmak\s+istiyorum|ne\s+zaman\s+görüş|ne\s+zaman\s+gorus|müsait\s+olduğunuzda\s+görüş|musait\s+oldugunuzda\s+gorus|yarın\s+\d{1,2}[:.]\d{2}\s+görüş|yarin\s+\d{1,2}[:.]\d{2}\s+gorus|yarın\s+\d{1,2}[:.]\d{2}\s+görüşebilir|yarin\s+\d{1,2}[:.]\d{2}\s+gorusebilir)/iu.test(text)
    || /(?:görüşebilir\s+miyiz|gorusebilir\s+miyiz|toplantı\s+yapabilir|toplanti\s+yapabilir|görüşme\s+ayarlayabilir|gorusme\s+ayarlayabilir)/iu.test(text)
    || /(?:appointment|schedule\s+a\s+call|meeting\s+with|call\s+me|discuss\s+over\s+phone)/i.test(text);
}

export function extractUndecidedSignals(text = '') {
  if (typeof text !== 'string') return false;
  const norm = normalizeTrText(text);
  return /(?:henuz\s+karar\s+vermedim|karar\s+vermedim|bilmiyorum|emin\s+degilim|daha\s+netlesmedi|netlesmedi|fark\s+etmez|sonra\s+karar|belli\s+degil|henuz\s+belli|kararsizim|not\s+sure|undecided|haven't\s+decided)/i.test(norm)
    || /(?:henüz\s+karar\s+vermedim|karar\s+vermedim|bilmiyorum|emin\s+değilim|daha\s+netleşmedi|netleşmedi|fark\s+etmez|sonra\s+karar|belli\s+değil|henüz\s+belli|kararsızım)/iu.test(text);
}

export function extractBothTopicsSignals(text = '') {
  if (typeof text !== 'string') return false;
  const norm = normalizeTrText(text);
  return /(?:ikisi\s+de\s+olabilir|ikiside\s+olabilir|her\s+ikisi|hem\s+sirket\s+hem\s+oturum|ikisi\s+de|ikiside|fark\s+etmez|both)/i.test(norm)
    || /(?:ikisi\s+de\s+olabilir|ikiside\s+olabilir|her\s+ikisi|hem\s+şirket\s+hem\s+oturum|ikisi\s+de|ikiside)/iu.test(text);
}

export function isMediaOnlyInbound(text = '') {
  if (typeof text !== 'string') return false;
  const clean = text.trim();
  if (!clean) return true;
  return /^\[(?:attachment|attached_image|attached_document):\s*[^\]]+\]$/i.test(clean);
}

/**
 * Generates an intelligent, context-aware fallback response from conversation memory
 * ensuring no eligible customer turn is ever silently dropped and no fake contact promises are made.
 */
export function generateContextualConversationalFallback({ text = '', conversationHistory = [], memory = {} } = {}) {
  const cleanText = String(text || '').trim();
  const phone = memory.phone || extractPhoneNumberFromText(cleanText);
  const requestedTime = memory.requestedTime || extractMeetingTimePreference(cleanText);
  const isUndecided = extractUndecidedSignals(cleanText);
  const isGreeting = isGreetingOnly(cleanText);
  const hasMeeting = hasCurrentTurnMeetingIntent(cleanText);
  const isMediaOnly = isMediaOnlyInbound(cleanText);
  const appointmentState = memory.appointmentState;
  const sharedContentContext = memory.sharedContentContext;
  const appointmentPurposeUnknown = Boolean(appointmentState?.hasHighIntent && !appointmentState?.purposeKnown);

  if (!isGreeting && !isMediaOnly && appointmentPurposeUnknown && appointmentState.missing?.includes('MEETING_PURPOSE')) {
    if (!requestedTime) {
      return 'Görüşmenin hangi konu veya amaç hakkında olacağını paylaşabilir misiniz?';
    }
    const date = appointmentState.preferredDate || 'uygun olduğunuz gün';
    const timeMatch = appointmentState.preferredTime?.match(/^(\d{1,2})(?::(\d{2})|\.(\d{2}))?(?:\s*(?:gibi|civarı|civari|around|about))?$/i);
    const normalizedTime = timeMatch
      ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2] || timeMatch[3] || '00'}`
      : appointmentState.preferredTime;
    const time = normalizedTime
      ? (appointmentState.timePrecision === 'APPROXIMATE'
        ? `${normalizedTime.replace(/\s*(?:gibi|civarı|civari|around|about)/i, '')} civarı`
        : normalizedTime)
      : 'uygun olduğunuz saat';
    return `${date} ${time} tercihinizi not ettim. Görüşmenin hangi konu veya amaç hakkında olacağını da paylaşabilir misiniz?`;
  }

  if (isMediaOnly && sharedContentContext?.topicContextPresent && sharedContentContext.topicText) {
    return `Paylaşılan içeriğin konu bilgisi: ${sharedContentContext.topicText}. Bu konu hakkında hangi konuda yardımcı olabilirim?`;
  }

  // 0. If customer sends ONLY media without written text (Case 2):
  if (isMediaOnly) {
    return 'Bu içerikle ilgili size nasıl yardımcı olabilirim?';
  }

  // 1. If customer sends a greeting / re-entry:
  if (isGreeting) {
    if (memory.serviceRequested || memory.businessActivity) {
      return 'Merhaba, tekrar hoş geldiniz. Size nasıl yardımcı olabilirim?';
    }
    return 'Merhaba, hoş geldiniz. Size nasıl yardımcı olabilirim?';
  }

  // 2. If customer is undecided:
  if (isUndecided) {
    return 'Anladım, faaliyet alanı veya detaylar henüz netleşmediyse sorun değil; süreci ve seçenekleri birlikte değerlendirebiliriz. Size nasıl yardımcı olabilirim?';
  }

  // 3. If CURRENT turn explicitly asks for a meeting / call:
  if (hasMeeting) {
    if (phone && requestedTime) {
      return 'Bilgilerinizi aldım. Görüşme talebinizi not ettim, size en kısa sürede dönüş sağlayacağız.';
    }
    if (phone && !requestedTime) {
      return 'Görüşme talebiniz için size uygun gün ve saat aralığını paylaşabilir misiniz?';
    }
    if (!phone && requestedTime) {
      return 'Görüşme talebiniz için size ulaşabileceğimiz telefon numaranızı paylaşabilir misiniz?';
    }
    return 'Görüşme talebinizi planlayabilmemiz için telefon numaranızı ve size uygun gün/saat aralığını iletebilir misiniz?';
  }

  // 4. Default safe fallback
  return 'Mesajınızı aldım, en kısa sürede size dönüş sağlayacağız.';
}

/**
 * Resolves durable conversation memory and qualification state across CRM tables and message history.
 * Supports chronological customer corrections (e.g. latest shareholder count, phone, or time wins).
 */
export async function resolveDurableConversationMemory({
  database,
  tenantId,
  conversationId,
  conversation = {},
  rawMessages = [],
}) {
  let customerName = extractReliableCustomerName(conversation?.contact_display_name || conversation?.display_name);
  let phone = conversation?.contact_phone || null;
  let serviceRequested = null;
  let activity = null;
  let activityState = null;
  let jurisdiction = null;
  let shareholderCount = null;
  let visaCount = null;
  let requestedTime = null;
  let timezone = null;
  let ctaDelivered = false;
  let ctaUrl = null;

  // 1. Check CRM Contacts, Leads & Consultations if existing in DB
  try {
    const isPool = typeof database?.connect === 'function' && typeof database?.query !== 'function';
    const client = isPool ? await database.connect() : database;
    try {
      // 1a. Check CRM Contact directly
      if (conversation?.contact_id) {
        const contactRes = await client.query(
          `SELECT display_name, phone FROM crm_contacts WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          [conversation.contact_id, tenantId]
        ).catch(() => ({ rowCount: 0, rows: [] }));
        if (contactRes.rowCount > 0) {
          const c = contactRes.rows[0];
          if (c.phone && !phone) phone = c.phone;
          if (c.display_name && !customerName) customerName = extractReliableCustomerName(c.display_name);
        }
      }

      // 1b. Check CRM Leads
      const leadRes = await client.query(
        `SELECT contact_name, phone, service_interest, timeline, custom_fields
           FROM crm_leads
          WHERE tenant_id = $1 AND conversation_id = $2
          ORDER BY updated_at DESC
          LIMIT 1`,
        [tenantId, conversationId]
      );
      if (leadRes.rowCount > 0) {
        const lead = leadRes.rows[0];
        if (lead.contact_name && !customerName) customerName = lead.contact_name;
        if (lead.phone && !phone) phone = lead.phone;
        if (lead.service_interest && !serviceRequested) serviceRequested = lead.service_interest;
        if (lead.timeline && !requestedTime) requestedTime = lead.timeline;
      }

      // 1c. Check CRM Consultations
      const consultRes = await client.query(
        `SELECT customer_name, phone, activity, service_requested, requested_time, timezone, cta_url, cta_delivered_at
           FROM crm_consultations
          WHERE tenant_id = $1 AND conversation_id = $2
          ORDER BY updated_at DESC
          LIMIT 1`,
        [tenantId, conversationId]
      );
      if (consultRes.rowCount > 0) {
        const consult = consultRes.rows[0];
        if (consult.customer_name && !customerName) customerName = consult.customer_name;
        if (consult.phone && !phone) phone = consult.phone;
        if (consult.activity && !activity) activity = consult.activity;
        if (consult.service_requested && !serviceRequested) serviceRequested = consult.service_requested;
        if (consult.requested_time && !requestedTime) requestedTime = consult.requested_time;
        if (consult.timezone && !timezone) timezone = consult.timezone;
        if (consult.cta_url) ctaUrl = consult.cta_url;
        if (consult.cta_delivered_at) ctaDelivered = true;
      }
    } finally {
      if (isPool && typeof client?.release === 'function') client.release();
    }
  } catch (err) {
    // Non-blocking in mock environments
  }

  // 2. Scan customer messages chronologically for durable facts & corrections
  const customerMsgs = (rawMessages || []).filter((m) => m.sender_type === 'CUSTOMER');
  for (const msg of customerMsgs) {
    const text = String(msg.content || '').trim();
    if (!text) continue;

    const parsedName = extractCustomerNameFromText(text);
    if (parsedName) customerName = parsedName;

    const parsedPhone = extractPhoneNumberFromText(text);
    if (parsedPhone) phone = parsedPhone;

    if (extractBothTopicsSignals(text)) {
      serviceRequested = 'Şirket Kuruluşu ve Sponsorlu Oturum';
    } else if (/sponsorlu\s+oturum|oturum\s+izni|residency|ikamet/i.test(text)) {
      serviceRequested = 'Sponsorlu Oturum';
    } else if (/şirket\s+kur|şirket\s+aç|firma\s+kur|free\s*zone|mainland|şirket/i.test(text)) {
      serviceRequested = 'Şirket Kuruluşu';
    }

    const parsedActivity = extractBusinessActivity(text);
    if (parsedActivity) {
      activity = parsedActivity;
      activityState = 'KNOWN';
    } else if (extractUndecidedSignals(text)) {
      activity = 'Henüz karar verilmedi / Netleşmedi';
      activityState = 'NOT_DECIDED';
    }

    const parsedJurisdiction = extractJurisdictionPreference(text);
    if (parsedJurisdiction) jurisdiction = parsedJurisdiction;

    const parsedShareholders = extractShareholderCount(text);
    if (parsedShareholders) shareholderCount = parsedShareholders;

    const parsedVisas = extractVisaCount(text);
    if (parsedVisas) visaCount = parsedVisas;

    const parsedTime = extractMeetingTimePreference(text);
    if (parsedTime) requestedTime = parsedTime;

    const parsedTz = extractTimezoneFromText(text);
    if (parsedTz) timezone = parsedTz;
  }

  return {
    customerName,
    phone,
    serviceRequested,
    businessActivity: activity,
    activityState,
    jurisdictionPreference: jurisdiction,
    shareholderCount,
    visaCount,
    requestedTime,
    timezone,
    ctaDelivered,
    ctaUrl,
  };
}
/**
 * Builds the structured memory instruction for the system prompt.
 * Contains durable facts, topic continuity rules, current-turn intent priority, and strict anti-re-asking constraints.
 */
export function buildStructuredMemoryInstruction(memory = {}) {
  const appointmentPurposeUnknown = memory.appointmentState?.hasHighIntent && !memory.appointmentState?.purposeKnown;
  const lines = [
    'DURABLE CONVERSATION CONTEXT & PERSISTED CRM FACTS:',
    `- Active Topic / Context: ${memory.serviceRequested || (appointmentPurposeUnknown ? 'Appointment request (purpose unknown)' : 'Company Formation & Consultancy (UAE / Dubai)')}`,
    memory.customerName ? `- Customer Real Name: "${memory.customerName}"` : `- Customer Real Name: Unknown`,
    memory.serviceRequested
      ? `- Service / Consultation Topic: "${memory.serviceRequested}"`
      : appointmentPurposeUnknown ? '- Service / Consultation Topic: Unknown (meeting purpose required)' : '- Service / Consultation Topic: General Consultancy',
    memory.businessActivity ? `- Business Activity / Sector: "${memory.businessActivity}"` : `- Business Activity / Sector: Not specified`,
    memory.activityState === 'NOT_DECIDED' ? `- Business Activity State: NOT_DECIDED (Customer stated they have not decided on the sector yet. Accept this; do NOT ask again)` : null,
    memory.shareholderCount ? `- Shareholder / Partner Count: ${memory.shareholderCount}` : `- Shareholder / Partner Count: Not specified`,
    memory.visaCount ? `- Visa Requirement: ${memory.visaCount}` : `- Visa Requirement: Not specified`,
    memory.jurisdictionPreference ? `- Jurisdiction Preference: ${memory.jurisdictionPreference}` : `- Jurisdiction Preference: Free Zone (Default)`,
    memory.phone ? `- Contact Phone / WhatsApp: ${memory.phone}` : `- Contact Phone / WhatsApp: Missing`,
    memory.requestedTime ? `- Preferred Meeting Time: ${memory.requestedTime}${memory.timezone ? ` (${memory.timezone})` : ''}` : `- Preferred Meeting Time: Missing`,
    memory.appointmentState?.hasHighIntent ? '' : null,
    memory.appointmentState?.hasHighIntent ? 'APPOINTMENT QUALIFICATION STATE (CANONICAL, PROVIDER-INDEPENDENT):' : null,
    memory.appointmentState?.hasHighIntent ? '- Appointment intent: TRUE' : null,
    memory.appointmentState?.hasHighIntent
      ? `- Known fields: ${[
          memory.appointmentState.purposeKnown ? `meeting_reason=${memory.appointmentState.meetingReason}` : null,
          memory.appointmentState.serviceInterest ? `service_interest=${memory.appointmentState.serviceInterest}` : null,
          memory.appointmentState.preferredDate ? `preferred_date=${memory.appointmentState.preferredDate}` : null,
          memory.appointmentState.preferredTime ? `preferred_time=${memory.appointmentState.preferredTime}` : null,
          memory.appointmentState.timePrecision ? `time_precision=${memory.appointmentState.timePrecision}` : null,
        ].filter(Boolean).join(', ') || 'none'}`
      : null,
    memory.appointmentState?.hasHighIntent
      ? `- Missing required fields: ${memory.appointmentState.missing?.map((field) => field === 'MEETING_PURPOSE' ? 'meeting_reason' : field).join(', ') || 'none'}`
      : null,
    memory.appointmentState?.hasHighIntent ? `- Qualification status: ${memory.appointmentState.status || 'COLLECTING'}` : null,
    memory.appointmentState?.hasHighIntent && memory.appointmentState.status !== 'READY_FOR_REQUEST'
      ? '- Qualification is incomplete while any required field is missing. Ask only for the missing field(s); do not close the appointment flow.'
      : null,
    memory.appointmentState?.hasHighIntent ? '- A request/preference is not a confirmed calendar appointment. Never claim confirmation without a real calendar result.' : null,
    memory.appointmentState?.hasHighIntent
      ? `- Slot contract: preferred_date=${memory.appointmentState.preferredDate || 'UNKNOWN'}, preferred_time=${memory.appointmentState.preferredTime || 'UNKNOWN'}, calendarAvailabilityVerified=${memory.appointmentState.calendarAvailabilityVerified === true ? 'true' : 'false'}, timeSource=${memory.appointmentState.timeSource || 'NONE'}`
      : null,
    memory.appointmentState?.hasHighIntent
      ? '- SLOT INVENTION GUARD: If preferred date or preferred time is UNKNOWN and calendar availability is not verified, never propose, invent, assume, or claim a specific day, date, time, time range, appointment slot, or availability. Ask for the missing user-provided preference; if meeting purpose is also missing, ask for purpose first.'
      : null,
    memory.sharedContentContext?.present ? '' : null,
    memory.sharedContentContext?.present ? memory.sharedContentContext.instruction : null,
    '',
    'CONVERSATION CONTINUITY & CURRENT-TURN INTENT RULES:',
    '1. CURRENT-TURN INTENT HAS HIGHEST PRIORITY:',
    '   - The customer\'s CURRENT message governs the intent and purpose of this conversational turn.',
    '   - Durable facts provide historical context and continuity; they MUST NEVER replace or hijack the meaning of the current message.',
    '   - Past workflows or historical qualification states MUST NOT force an unwanted action onto a new turn.',
    '2. GREETINGS & RE-ENTRIES:',
    '   - If the customer sends a greeting or re-entry message (e.g. "Merhaba", "Selam", "Merhaba Samed Bey", "İyi günler", "Tekrar merhaba"), respond naturally as a greeting.',
    '   - A greeting is a greeting. It must NOT automatically become a meeting request, appointment confirmation, qualification questionnaire, or "görüşme talebinizi aldım".',
    '   - If helpful and natural, you may briefly reference prior context without forcing it into every greeting.',
    '3. NEVER RE-ASK KNOWN FACTS (ANTI-INTERROGATION):',
    '   - Never re-ask any fact listed above as already known or answered!',
    memory.phone ? '   - Customer Phone is ALREADY KNOWN. DO NOT ask for their phone number again.' : null,
    memory.serviceRequested ? '   - Service / Consultation Topic is ALREADY KNOWN. DO NOT ask them what service or to choose between options again.' : null,
    memory.businessActivity || memory.activityState === 'NOT_DECIDED' ? '   - Business Activity is ALREADY ANSWERED (known or undecided). DO NOT ask for their business activity or sector again.' : null,
    memory.requestedTime ? '   - Preferred Meeting Time is ALREADY KNOWN. DO NOT ask for their preferred time or availability again.' : null,
    memory.customerName ? '   - Customer Real Name is ALREADY KNOWN. DO NOT ask "Adınız nedir?".' : null,
    '   - If customer asks a follow-up question (e.g. "Peki banka hesabı nasıl olacak?"), answer it within the established context without asking what topic they mean.',
    '4. UNDECIDED ANSWERS ARE VALID:',
    '   - If customer says "Henüz karar vermedim", "bilmiyorum", "fark etmez", etc., accept it smoothly without repeating the question.',
    '5. EXPLICIT MEETING INTENT (CURRENT TURN ONLY):',
    '   - Activate meeting/consultation scheduling ONLY if the CURRENT customer message explicitly requests a meeting, call, or appointment (e.g. "Sizinle görüşmek istiyorum", "Telefonla görüşebilir miyiz?", "Randevu alabilir miyim?", "Yarın 14:00 görüşebilir miyiz?").',
    '   - Collect genuinely missing information naturally without rigid interrogation.',
    '   - When sufficient meeting information is received, acknowledge and note the request naturally (e.g. "Bilgilerinizi aldım. Görüşme talebinizi not ettim, size en kısa sürede dönüş sağlayacağız.").',
    '   - DO NOT append wa.me links, WhatsApp CTA links, or raw URL payloads.',
    '   - DO NOT claim a calendar booking is definitively confirmed unless there is a real booking.',
  ].filter((p) => p !== null);

  return lines.join('\n');
}

function boundedSharedContentText(value, maxLength = 1200) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean ? clean.slice(0, maxLength) : null;
}

export function buildInstagramSharedContentContext(rawMessages = []) {
  const items = [];
  for (const message of Array.isArray(rawMessages) ? rawMessages : []) {
    for (const resource of Array.isArray(message?.resources) ? message.resources : []) {
      const metadata = resource?.metadata && typeof resource.metadata === 'object' ? resource.metadata : {};
      const shared = metadata.shared_content || metadata.sharedContent;
      if (!shared || typeof shared !== 'object') continue;
      const type = boundedSharedContentText(shared.type || metadata.attachment_type, 32);
      const caption = boundedSharedContentText(shared.caption);
      const description = boundedSharedContentText(shared.description);
      const referralText = boundedSharedContentText(shared.referral_text || shared.referralText);
      const source = boundedSharedContentText(shared.source, 80);
      const topicText = caption || description || referralText || null;
      items.push({ type, caption, description, referralText, source, topicText });
    }
  }

  const uniqueItems = [];
  const seen = new Set();
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueItems.push(item);
  }
  const topicText = uniqueItems.map((item) => item.topicText).filter(Boolean).join('\n').slice(0, 2400) || null;
  const instruction = uniqueItems.length > 0
    ? [
        'SHARED CONTENT CONTEXT (TRUSTED META METADATA, CONVERSATION-SCOPED):',
        ...uniqueItems.map((item) => [
          item.type ? `- Shared content type: ${item.type}` : null,
          item.source ? `- Shared content source: ${item.source}` : null,
          item.caption ? `- Caption: ${item.caption}` : null,
          item.description ? `- Description: ${item.description}` : null,
          item.referralText ? `- Referral text: ${item.referralText}` : null,
        ].filter(Boolean).join('\n')),
        '- CURRENT USER TEXT ALWAYS OVERRIDES shared-content metadata and older attachment context.',
        '- Shared-content metadata is contextual only, not tenant business truth or Knowledge. Do not claim to have watched, seen, or analyzed the media.',
      ].join('\n')
    : '';

  return {
    present: uniqueItems.length > 0,
    topicContextPresent: Boolean(topicText),
    topicText,
    instruction,
  };
}

/**
 * Loads recent chronological conversation history for multi-turn AI context.
 */
async function loadRecentConversationHistory(database, tenantId, conversationId, limit = 20) {
  try {
    const isPool = typeof database?.connect === 'function' && typeof database?.query !== 'function';
    const client = isPool ? await database.connect() : database;
    try {
      const res = await client.query(
        `SELECT m.id, m.sender_type, m.content, m.created_at,
                COALESCE(json_agg(json_build_object(
                  'metadata', r.metadata,
                  'media_category', r.media_category,
                  'mime_type', r.mime_type,
                  'original_filename', r.original_filename
                )) FILTER (WHERE r.id IS NOT NULL), '[]'::json) AS resources
           FROM conversation_messages m
           LEFT JOIN conversation_resources r
             ON r.message_id = m.id
            AND r.tenant_id = m.tenant_id
          WHERE m.tenant_id = $1 AND m.conversation_id = $2
          GROUP BY m.id, m.sender_type, m.content, m.created_at
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT $3`,
        [tenantId, conversationId, limit]
      );
      const chronological = (res.rows || []).reverse();
      return {
        rawMessages: chronological,
        mergedTurns: mergeConsecutiveConversationTurns(chronological),
      };
    } finally {
      if (isPool && typeof client?.release === 'function') {
        client.release();
      }
    }
  } catch (err) {
    console.warn('INSTAGRAM_LOAD_HISTORY_WARN', err?.message);
    return { rawMessages: [], mergedTurns: [] };
  }
}


/**
 * Invokes the canonical Shared AI Runtime with active system instruction & history.
 */
async function defaultGenerateInstagramAiResponse({
  systemInstruction,
  text,
  conversationHistory = [],
  model = null,
  memory = {},
}) {
  const result = await canonicalSharedAiRuntime.generateAiResponse({
    systemInstruction,
    text,
    conversationHistory,
    model,
    channel: 'INSTAGRAM',
  });
  return {
    text: result.text,
    model: result.model,
    provider: result.provider,
    canonicalSharedRuntime: true,
    providerSuccess: true,
    fallbackUsed: false,
    fallbackReason: null,
  };
}

const activeInstagramOrchestrations = new Map();

function resolveInstagramTriggerType(text = '') {
  return isMediaOnlyInbound(text) ? 'REEL' : 'TEXT';
}

function trackInstagramOrchestration({ key, triggerId }) {
  const active = activeInstagramOrchestrations.get(key) || new Set();
  if (active.has(triggerId)) return false;
  active.add(triggerId);
  activeInstagramOrchestrations.set(key, active);
  return true;
}

function untrackInstagramOrchestration({ key, triggerId }) {
  const active = activeInstagramOrchestrations.get(key);
  if (!active) return;
  active.delete(triggerId);
  if (active.size === 0) activeInstagramOrchestrations.delete(key);
}

export async function orchestrateInstagramInboundAiResponse({
  database = pool,
  inboundState,
  senderIgsid,
  text = '',
  http,
  embed = null,
  generateAiResponse,
  generateAiClassification,
  applyPacing = true,
}) {
  if (!inboundState || inboundState.duplicate || !inboundState.integration || !inboundState.conversation) {
    return { skipped: true, reason: 'INVALID_INBOUND_STATE' };
  }

  const rawInboundText = String(text || inboundState.customerMessage?.content || '').trim();
  if (!rawInboundText) {
    return { skipped: true, reason: 'EMPTY_INBOUND_TEXT' };
  }

  const { integration, conversation, handlingVersion } = inboundState;
  const tenantId = integration.tenant_id;
  const conversationId = conversation.id;
  const assistantId = integration.assistant_id;
  const assistantModel = integration.assistant_model || null;

  const orchestrationKey = `${tenantId}:${conversationId}`;
  const triggerType = resolveInstagramTriggerType(rawInboundText);
  const triggerId = String(inboundState.customerMessage?.id || `${triggerType}:${rawInboundText}`);
  if (!trackInstagramOrchestration({ key: orchestrationKey, triggerId })) {
    console.info(`INSTAGRAM_AI_ORCHESTRATION_ALREADY_IN_FLIGHT conversationId=${conversationId} triggerType=${triggerType}`);
    return { aiInvoked: false, skipped: true, duplicate: true, reason: 'ORCHESTRATION_IN_FLIGHT' };
  }

  try {
    const accessToken = integration.config?.access_token || process.env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
    const accountId = integration.config?.instagram_account_id || integration.config?.instagram_business_account_id || integration.config?.page_id || integration.external_channel_id;
    const instagramUserId = integration.config?.instagram_user_id || null;
    const authMode = integration.config?.auth_mode || null;

  // 1. Human Support Intent check (Appointments qualify conversationally without visible transfer)
  const humanSupport = parseCustomerHumanSupportRequest(text);
  const isAppointmentRequest = hasHighIntentAppointmentSignals(text);
  if (humanSupport.requested && !isAppointmentRequest) {
    const lang = resolveCommunicationLanguage({
      currentLanguage: conversation.communication_language || 'en',
      content: text,
    });

    let handoffPolicy;
    try {
      handoffPolicy = await resolvePlatformHumanSupportPolicy({ database, locale: lang });
    } catch {
      handoffPolicy = {
        defaultTopic: 'Customer Support Request',
        acknowledgement: () => lang === 'tr'
          ? 'Canlı temsilcimize aktarıyorum, lütfen beklemede kalın.'
          : 'Connecting you to a representative, please hold on.',
      };
    }

    const acknowledgement = typeof handoffPolicy.acknowledgement === 'function'
      ? handoffPolicy.acknowledgement(humanSupport.topic || handoffPolicy.defaultTopic)
      : 'Connecting you to a representative, please hold on.';

    const handoff = await requestCustomerHumanSupport({
      tenantId,
      conversationId,
      acknowledgement,
      topicSummary: handoffPolicy.defaultTopic,
      database,
    });

    if (!handoff.duplicate && accessToken) {
      try {
        await deliverInstagramText({
          recipientId: senderIgsid,
          content: acknowledgement,
          accessToken,
          instagramAccountId: accountId,
          pageId: accountId,
          instagramUserId,
          authMode,
          http,
        });
      } catch (err) {
        console.warn('INSTAGRAM_HANDOFF_ACK_DELIVERY_WARN', err?.message);
      }
    }

    await triggerImmediateHumanSupportNotificationPipeline({
      database,
      tenantId,
      conversationId,
    }).catch((err) => {
      console.error('INSTAGRAM_PUSH_NOTIFICATION_TRIGGER_ERROR', err?.message);
    });

    return { handoff: true, handoffOutcome: handoff };
  }

  // 2. Check AI eligibility (must be in AI handling mode and conversation open)
  if (!inboundState.shouldInvokeAi) {
    return { aiInvoked: false, reason: 'NOT_IN_AI_MODE' };
  }

  // 2b. Resolve durable contact-level AI behavior override from CRM contact
  if (conversation?.contact_id || conversation?.id) {
    try {
      const isPool = typeof database?.connect === 'function' && typeof database?.query !== 'function';
      const dbClient = isPool ? await database.connect() : database;
      try {
        const contactCheck = await dbClient.query(
          `SELECT c.ai_behavior_override AS contact_override, conv.ai_behavior_override AS conv_override
             FROM conversations conv
             LEFT JOIN crm_contacts c ON c.id = conv.contact_id AND c.tenant_id = conv.tenant_id
            WHERE conv.id = $1 AND conv.tenant_id = $2
            LIMIT 1`,
          [conversationId, tenantId]
        );
        const row = contactCheck.rows?.[0];
        if (row) {
          const isExplicitOverride = (v) => v === 'AI_ONLY' || v === 'ALWAYS_AI' || v === 'NEVER_AI';
          const effective = isExplicitOverride(row.contact_override)
            ? row.contact_override
            : isExplicitOverride(row.conv_override)
            ? row.conv_override
            : 'AUTOMATIC';
          conversation.ai_behavior_override = effective;
          conversation.contact_ai_behavior_override = effective;
        }
      } finally {
        if (isPool && typeof dbClient?.release === 'function') {
          dbClient.release();
        }
      }
    } catch {
      // Non-fatal if unmigrated test mock client
    }
  }

  // 3. Evaluate generic Channel AI Activation Policy & Contact/Conversation Overrides
  const activationEvaluation = await evaluateChannelAiActivationPolicy({
    messageText: text,
    conversation,
    channelConfig: integration.config,
    tenantContext: {
      tenantId,
      assistantId,
    },
    generateAiClassification,
  });

  console.info(
    `INSTAGRAM_AI_POLICY_RESOLVED decision=${activationEvaluation.decision}` +
    ` reason=${activationEvaluation.reasonCode}` +
    ` policy=${activationEvaluation.policy}` +
    ` tenant=${tenantId ? tenantId.slice(0, 8) : 'unknown'}`
  );

  if (!activationEvaluation.eligible) {
    const outcome = `SUPPRESSED_${activationEvaluation.reasonCode || 'UNKNOWN'}`;
    console.info(
      `INSTAGRAM_ORCHESTRATION_SUPPRESSED reason=${activationEvaluation.reasonCode || 'UNKNOWN'}` +
      ` policy=${activationEvaluation.policy}` +
      ` tenant=${tenantId ? tenantId.slice(0, 8) : 'unknown'}` +
      ` conversation=${conversationId ? conversationId.slice(0, 8) : 'unknown'}`
    );
    console.info(
      `INSTAGRAM_AI_TERMINAL_OUTCOME outcome=${outcome}` +
      ` tenant=${tenantId ? tenantId.slice(0, 8) : 'unknown'}` +
      ` conversation=${conversationId ? conversationId.slice(0, 8) : 'unknown'}` +
      ` inboundMid=${inboundState.customerMessage?.id ? String(inboundState.customerMessage.id).slice(0, 8) : 'none'}` +
      ` orchestrationId=${orchestrationKey.slice(0, 8)}` +
      ` policy=${activationEvaluation.policy}`
    );
    return {
      aiInvoked: false,
      suppressed: true,
      outcome,
      activationEvaluation,
    };
  }

  console.info(
    `INSTAGRAM_ORCHESTRATION_STARTED tenant=${tenantId ? tenantId.slice(0, 8) : 'unknown'}` +
    ` conversation=${conversationId ? conversationId.slice(0, 8) : 'unknown'}` +
    ` inboundMid=${inboundState.customerMessage?.id ? String(inboundState.customerMessage.id).slice(0, 8) : 'none'}`
  );

  // 4. Verify Latest Message is CUSTOMER and Unanswered (guards against duplicates/races)
  try {
    const isPool = typeof database?.connect === 'function' && typeof database?.query !== 'function';
    const client = isPool ? await database.connect() : database;
    try {
      const msgCheck = await client.query(
        `SELECT id, sender_type, content, created_at
           FROM conversation_messages
          WHERE tenant_id = $1 AND conversation_id = $2
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [tenantId, conversationId]
      );
      const latest = msgCheck.rows?.[0];
      if (latest && latest.sender_type !== 'CUSTOMER') {
        return { skipped: true, reason: 'ALREADY_ANSWERED' };
      }

      const customerMsgId = inboundState.customerMessage?.id;
      if (customerMsgId) {
        const existingAssistantMsg = await client.query(
          `SELECT id FROM conversation_messages
            WHERE tenant_id = $1 AND conversation_id = $2 AND sender_type = 'ASSISTANT' AND idempotency_key = $3
            LIMIT 1`,
          [tenantId, conversationId, `instagram-ai:${customerMsgId}`]
        );
        if (existingAssistantMsg.rowCount > 0) {
          return { skipped: true, duplicate: true, reason: 'ASSISTANT_REPLY_ALREADY_EXISTS' };
        }
      }
    } finally {
      if (isPool && typeof client?.release === 'function') {
        client.release();
      }
    }
  } catch (chkErr) {
    console.warn('INSTAGRAM_MSG_CHECK_WARN', chkErr?.message);
  }


  // 5. Resolve Active Persona and Knowledge context
  let persona = null;
  let knowledge = null;

  try {
    persona = await resolveTenantRuntimePersona({
      database,
      tenantId,
      assistantId,
    });
  } catch (personaErr) {
    console.warn('INSTAGRAM_AI_PERSONA_WARN', personaErr?.message);
  }

  try {
    knowledge = await resolveAssistantRuntimeKnowledgeContext({
      database,
      embed,
      tenantId,
      assistantId,
      query: text,
    });
  } catch (knowledgeErr) {
    console.warn('INSTAGRAM_AI_KNOWLEDGE_WARN', knowledgeErr?.message);
  }

  // 6. Load Recent Conversation History & Resolve Durable Memory
  const historyData = await loadRecentConversationHistory(database, tenantId, conversationId, 20);
  const history = historyData.mergedTurns || [];
  const sharedContentContext = buildInstagramSharedContentContext(historyData.rawMessages || []);
  const durableMemory = await resolveDurableConversationMemory({
    database,
    tenantId,
    conversationId,
    conversation,
    rawMessages: historyData.rawMessages || [],
  });
  const activeConversationTopic = resolveActiveInstagramConversationTopic({
    durableMemory,
    rawMessages: historyData.rawMessages || [],
    sharedContentContext,
    currentText: text,
  });
  const appointmentState = resolveInstagramAppointmentState({
    rawMessages: historyData.rawMessages || [],
    currentText: text,
    contactPhone: durableMemory.phone,
    activeConversationTopic,
  });

  // Evaluate high-intent lead qualification in CRM (records PENDING consultation and leads in DB)
  let qualResult = null;
  const isQualified = appointmentState.complete;
  const isGreeting = isGreetingOnly(text);
  const hasMeetingIntent = hasCurrentTurnMeetingIntent(text);

  if (!isGreeting && (hasMeetingIntent || isQualified)) {
    try {
      qualResult = await evaluateAndProcessHighIntentLead({
        tenantId,
        conversationId,
        database,
        httpClient: http,
      });
    } catch (qualErr) {
      console.warn('INSTAGRAM_QUAL_EVAL_WARN', qualErr?.message);
    }
  }

  logInstagramAppointmentStateDiagnostics({ appointmentState });
  logInstagramAppointmentContextResolution({ appointmentState, activeTopicPresent: Boolean(activeConversationTopic) });
  logInstagramSharedContentDiagnostics({ sharedContentContext, explicitTextPresent: Boolean(text.trim()) && !isMediaOnlyInbound(text) });
  const structuredMemoryContext = buildStructuredMemoryInstruction({ ...durableMemory, appointmentState, sharedContentContext });

  // 7. Build System Instruction with Channel Presentation Rules and Structured Memory Context
  const rawCustomerName = durableMemory.customerName || conversation?.contact_display_name || conversation?.display_name || null;
  const reliableCustomerName = extractReliableCustomerName(rawCustomerName);
  const customerIdentityContext = reliableCustomerName
    ? `CUSTOMER IDENTITY CONTEXT:\n- Customer Real Display Name: "${reliableCustomerName}"\n- You may address the customer naturally as "${reliableCustomerName}" / in Turkish.\n- Do NOT treat their username as a real name.\n- During appointment qualification, since their name is already known, do NOT ask "Adınız nedir?".`
    : '';

  const channelRules = buildInstagramChannelRules({
    persona,
    currentIntent: text,
    conversationContext: structuredMemoryContext,
    customerIdentityContext,
  });

  const systemInstruction = persona?.available
    ? buildTenantRuntimeSystemInstruction({
        persona,
        knowledgeContext: knowledge?.knowledgeContext || '',
        channelRules,
        channelRulesLimit: INSTAGRAM_BEHAVIORAL_CHANNEL_RULES_LIMIT,
      })
    : [
        'PLATFORM RUNTIME SAFETY: Enforce tenant isolation and channel delivery rules.',
        channelRules,
        knowledge?.knowledgeContext ? `APPROVED KNOWLEDGE:\n${knowledge.knowledgeContext}` : '',
      ].filter(Boolean).join('\n\n');

  logInstagramRuntimeContextDiagnostics({ systemInstruction, persona, knowledge, sharedContentContext });




  // 8. Start Instagram Typing Indicator (non-blocking)
  const cleanSenderId = String(senderIgsid || '').replace(/^instagram:\s*/i, '').trim();
  let typingActive = false;
  const generationStartedAt = Date.now();

  if (accessToken && cleanSenderId) {
    try {
      const typingRes = await sendInstagramTypingIndicator({
        recipientId: cleanSenderId,
        accessToken,
        instagramAccountId: accountId,
        pageId: accountId,
        instagramUserId,
        authMode,
        http,
      });
      if (typingRes?.ok) typingActive = true;
    } catch (typingErr) {
      console.warn('INSTAGRAM_TYPING_INDICATOR_NON_BLOCKING_WARN', typingErr?.message);
    }
  }

  try {
    // 9. Generate AI response
    logInstagramBehavioralPolicyDiagnostics({ assistantId, persona });
    let genResult = { text: '', model: assistantModel || 'default', fallbackUsed: false, fallbackReason: null };
    if (typeof generateAiResponse === 'function') {
      const generated = await generateAiResponse({
        systemInstruction,
        text,
        conversationHistory: history,
        model: assistantModel,
      });
      if (typeof generated === 'string') {
        genResult.text = generated;
      } else if (generated && typeof generated.text === 'string') {
        genResult = { ...genResult, ...generated };
      }
    } else {
      genResult = await defaultGenerateInstagramAiResponse({
        systemInstruction,
        text,
        conversationHistory: history,
        model: assistantModel,
        memory: { ...durableMemory, appointmentState, sharedContentContext },
      });
    }

    const rawAiResponseText = typeof genResult === 'string' ? genResult : genResult.text;
    const sanitizedResponse = sanitizeInstagramOutboundResponse(rawAiResponseText);
    const formattedResponse = formatInstagramDmResponse(sanitizedResponse);

    const durationMs = Date.now() - generationStartedAt;
    console.info(
      `INSTAGRAM_PROVIDER_COMPLETED` +
      ` tenant=${tenantId ? tenantId.slice(0, 8) : 'unknown'}` +
      ` conversation=${conversationId ? conversationId.slice(0, 8) : 'unknown'}` +
      ` duration_ms=${durationMs}` +
      ` fallback_used=${genResult.fallbackUsed ? '1' : '0'}` +
      ` chars=${(formattedResponse || '').length}`
    );
    console.info(
      `INSTAGRAM_AI_GENERATION` +
      ` tenant=${tenantId ? tenantId.slice(0, 8) : 'unknown'}` +
      ` conversation=${conversationId ? conversationId.slice(0, 8) : 'unknown'}` +
      ` inboundMid=${inboundState.customerMessage?.id ? String(inboundState.customerMessage.id).slice(0, 8) : 'none'}` +
      ` model=${genResult.model || assistantModel || 'default'}` +
      ` durationMs=${durationMs}` +
      ` fallbackUsed=${genResult.fallbackUsed ? '1' : '0'}` +
      ` fallbackReason=${genResult.fallbackReason || 'none'}` +
      ` chars=${(formattedResponse || '').length}`
    );

    if (!formattedResponse) {
      return { aiInvoked: true, delivered: false, reason: 'EMPTY_AI_RESPONSE' };
    }

    // 10. Bounded Human-Like Adaptive Pacing
    if (applyPacing !== false) {
      await applyWhatsAppAdaptivePacing({
        generationStartedAt,
        content: formattedResponse,
      });
    }

    // 11. Persist Assistant response atomically (guards against operator takeover race)
    const persisted = await persistAssistantResponseIfCurrent({
      tenantId,
      conversationId,
      content: formattedResponse,
      handlingVersion,
      idempotencyKey: inboundState.customerMessage?.id ? `instagram-ai:${inboundState.customerMessage.id}` : null,
      deliveryStatus: 'SENDING',
      sourceCustomerMessageId: inboundState.customerMessage?.id || null,
      suppressIfNewerExplicitCustomerMessage: triggerType === 'REEL',
      database,
    });

    console.info(
      `INSTAGRAM_AI_TURN_VALIDITY` +
      ` triggerType=${triggerType}` +
      ` triggerMid=${inboundState.customerMessage?.id ? String(inboundState.customerMessage.id).slice(0, 64) : 'none'}` +
      ` newerExplicitUserMessage=${persisted.newerExplicitUserMessage ? 'true' : 'false'}` +
      ` turnStillCurrent=${persisted.turnStillCurrent !== false ? 'true' : 'false'}` +
      ` responseSuppressedReason=${persisted.reason === 'STALE_SHARED_CONTENT_TURN' ? 'STALE_SHARED_CONTENT_TURN' : 'none'}`,
    );

    if (!persisted.delivered) {
      console.info(`INSTAGRAM_AI_RESPONSE_DROPPED reason=${persisted.reason || 'HANDLING_MODE_CHANGED'}`);
      return { delivered: false, dropped: true, reason: persisted.reason || 'CONVERSATION_TAKEN_OVER' };
    }

    if (persisted.duplicate) {
      console.info('INSTAGRAM_AI_RESPONSE_DROPPED reason=DUPLICATE_IDEMPOTENCY_KEY');
      return {
        aiInvoked: false,
        delivered: false,
        duplicate: true,
        reason: 'DUPLICATE_PERSIST_SKIPPED',
        assistantMessageId: persisted.message?.id || null,
      };
    }

    if (!accessToken || !cleanSenderId) {
      const transportError = Object.assign(new Error('Instagram delivery transport is not configured'), {
        code: 'INSTAGRAM_DELIVERY_NOT_CONFIGURED',
      });
      await recordInstagramAssistantDeliveryFailure({
        database,
        tenantId,
        messageId: persisted.message?.id,
        error: transportError,
      });
      return {
        aiInvoked: true,
        delivered: false,
        reason: transportError.code,
        responseText: formattedResponse,
        assistantMessageId: persisted.message?.id || null,
      };
    }

    // 12. Deliver outbound message to Instagram
    let deliveryResult = null;
    let deliveryError = null;

    try {
      deliveryResult = await deliverInstagramText({
        recipientId: cleanSenderId,
        content: formattedResponse,
        accessToken,
        instagramAccountId: accountId,
        pageId: accountId,
        instagramUserId,
        authMode,
        http,
      });
      await recordInstagramAssistantDeliverySuccess({
        database,
        tenantId,
        messageId: persisted.message?.id,
        providerMessageId: deliveryResult?.providerMessageId,
      });

      if (qualResult?.qualified || durableMemory.ctaUrl) {
        const isPool = typeof database?.connect === 'function' && typeof database?.query !== 'function';
        const client = isPool ? await database.connect() : database;
        try {
          await client.query(
            `UPDATE crm_consultations
                SET cta_delivered_at = CURRENT_TIMESTAMP
              WHERE tenant_id = $1 AND conversation_id = $2 AND cta_delivered_at IS NULL`,
            [tenantId, conversationId]
          ).catch(() => {});
        } finally {
          if (isPool && typeof client?.release === 'function') client.release();
        }
      }
    } catch (deliveryErr) {
      deliveryError = deliveryErr;
      console.error('INSTAGRAM_OUTBOUND_DELIVERY_ERROR', deliveryErr?.code, deliveryErr?.message);
      await recordInstagramAssistantDeliveryFailure({
        database,
        tenantId,
        messageId: persisted.message?.id,
        error: deliveryErr,
      });
    }

    // Trigger high-intent qualification and silent internal notification asynchronously
    evaluateAndProcessHighIntentLead({
      tenantId,
      conversationId,
      database,
      httpClient: http,
    }).catch((err) => console.warn('HIGH_INTENT_LEAD_EVALUATION_NON_BLOCKING_WARN', err?.message));

    const outcome = (!deliveryError && Boolean(deliveryResult))
      ? 'RESPONDED'
      : (deliveryError ? `DELIVERY_FAILED_${String(deliveryError?.code || 'UNKNOWN').slice(0, 32)}` : 'GENERATION_FAILED_NO_DELIVERY');

    console.info(
      `INSTAGRAM_AI_TERMINAL_OUTCOME outcome=${outcome}` +
      ` tenant=${tenantId ? tenantId.slice(0, 8) : 'unknown'}` +
      ` conversation=${conversationId ? conversationId.slice(0, 8) : 'unknown'}` +
      ` inboundMid=${inboundState.customerMessage?.id ? String(inboundState.customerMessage.id).slice(0, 8) : 'none'}` +
      ` orchestrationId=${orchestrationKey.slice(0, 8)}`
    );

    return {
      aiInvoked: true,
      delivered: !deliveryError && Boolean(deliveryResult),
      deliveryError: deliveryError?.message || null,
      outcome,
      responseText: formattedResponse,
      deliveryResult,
      assistantMessageId: persisted.message?.id || null,
    };
  } finally {
    if (typingActive && accessToken && cleanSenderId) {
      try {
        await sendInstagramTypingOff({
          recipientId: cleanSenderId,
          accessToken,
          instagramAccountId: accountId,
          pageId: accountId,
          instagramUserId,
          authMode,
          http,
        });
      } catch (typingOffErr) {
        console.warn('INSTAGRAM_TYPING_OFF_WARN', typingOffErr?.message);
      }
    }
  }
  } finally {
    untrackInstagramOrchestration({ key: orchestrationKey, triggerId });
  }
}

/**
 * Generates and immediately delivers an AI response to the latest unanswered customer message
 * in an Instagram conversation (used when an operator activates AI_ONLY).
 */
export async function generateAndDeliverInstagramAssistantResponse({
  database = pool,
  tenantId,
  conversationId,
  messageText = '',
  http,
  embed = null,
  generateAiResponse,
  applyPacing = true,
}) {
  const shouldRelease = typeof database?.connect === 'function';
  const client = shouldRelease ? await database.connect() : database;
  try {
    const convRes = await client.query(
      `SELECT c.id, c.tenant_id, c.channel_id, c.customer_external_id, c.handling_mode,
              c.handling_version, c.status, c.communication_language,
              tc.channel_type, tc.assistant_id,
              a.model AS assistant_model,
              ci.config AS integration_config
         FROM conversations c
         JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
         LEFT JOIN ai_assistants a ON a.id = tc.assistant_id AND a.tenant_id = tc.tenant_id
         LEFT JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND ci.integration_type = 'INSTAGRAM'
        WHERE c.id = $1 AND c.tenant_id = $2`,
      [conversationId, tenantId]
    );
    if (convRes.rowCount < 1) return { skipped: true, reason: 'CONVERSATION_NOT_FOUND' };
    const conversation = convRes.rows[0];

    if (conversation.status !== 'open' || conversation.handling_mode === 'HUMAN') {
      return { skipped: true, reason: 'HUMAN_MODE_ACTIVE' };
    }

    // Atomically verify latest message is CUSTOMER and unanswered
    const msgRes = await client.query(
      `SELECT id, sender_type, content, created_at
         FROM conversation_messages
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [tenantId, conversationId]
    );
    const latestMsg = msgRes.rows[0];
    if (!latestMsg || latestMsg.sender_type !== 'CUSTOMER') {
      return { skipped: true, reason: 'ALREADY_ANSWERED' };
    }

    const textToAnswer = String(messageText || latestMsg.content || '').trim();
    const assistantId = conversation.assistant_id;
    const assistantModel = conversation.assistant_model || null;
    const config = conversation.integration_config || {};
    const accessToken = config.access_token || process.env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
    const accountId = config.instagram_account_id || config.instagram_business_account_id || config.page_id || 'me';
    const instagramUserId = config.instagram_user_id || null;
    const authMode = config.auth_mode || null;
    const recipientIgsid = String(conversation.customer_external_id || '').replace(/^instagram:\s*/i, '');

    // Resolve Persona & Knowledge
    let persona = null;
    let knowledge = null;
    try {
      persona = await resolveTenantRuntimePersona({ database: client, tenantId, assistantId });
    } catch {}
    try {
      knowledge = await resolveAssistantRuntimeKnowledgeContext({ database: client, embed, tenantId, assistantId, query: textToAnswer });
    } catch {}

    const historyData = await loadRecentConversationHistory(client, tenantId, conversationId, 20);
    const history = historyData.mergedTurns || [];
    const sharedContentContext = buildInstagramSharedContentContext(historyData.rawMessages || []);
    const durableMemory = await resolveDurableConversationMemory({
      database: client,
      tenantId,
      conversationId,
      conversation,
      rawMessages: historyData.rawMessages || [],
    });
    const activeConversationTopic = resolveActiveInstagramConversationTopic({
      durableMemory,
      rawMessages: historyData.rawMessages || [],
      sharedContentContext,
      currentText: textToAnswer,
    });
    const appointmentState = resolveInstagramAppointmentState({
      rawMessages: historyData.rawMessages || [],
      currentText: textToAnswer,
      contactPhone: durableMemory.phone,
      activeConversationTopic,
    });

    let qualResult = null;
    const isQualified = appointmentState.complete;
    const isGreeting = isGreetingOnly(textToAnswer);
    const hasMeetingIntent = hasCurrentTurnMeetingIntent(textToAnswer);

    if (!isGreeting && (hasMeetingIntent || isQualified)) {
      try {
        qualResult = await evaluateAndProcessHighIntentLead({
          tenantId,
          conversationId,
          database: client,
          httpClient: http,
        });
      } catch (qualErr) {
        console.warn('INSTAGRAM_QUAL_EVAL_WARN', qualErr?.message);
      }
    }

    logInstagramAppointmentStateDiagnostics({ appointmentState });
    logInstagramAppointmentContextResolution({ appointmentState, activeTopicPresent: Boolean(activeConversationTopic) });
    logInstagramSharedContentDiagnostics({ sharedContentContext, explicitTextPresent: Boolean(textToAnswer) && !isMediaOnlyInbound(textToAnswer) });
    const structuredMemoryContext = buildStructuredMemoryInstruction({ ...durableMemory, appointmentState, sharedContentContext });

    const rawCustomerName = durableMemory.customerName || conversation?.contact_display_name || conversation?.display_name || null;
    const reliableCustomerName = extractReliableCustomerName(rawCustomerName);
    const customerIdentityContext = reliableCustomerName
      ? `CUSTOMER IDENTITY CONTEXT:\n- Customer Real Display Name: "${reliableCustomerName}"\n- You may address the customer naturally as "${reliableCustomerName}" / in Turkish.\n- Do NOT treat their username as a real name.\n- During appointment qualification, since their name is already known, do NOT ask "Adınız nedir?".`
      : '';

    const channelRules = buildInstagramChannelRules({
      persona,
      currentIntent: textToAnswer,
      conversationContext: structuredMemoryContext,
      customerIdentityContext,
    });

    const systemInstruction = persona?.available
      ? buildTenantRuntimeSystemInstruction({
          persona,
          knowledgeContext: knowledge?.knowledgeContext || '',
          channelRules,
          channelRulesLimit: INSTAGRAM_BEHAVIORAL_CHANNEL_RULES_LIMIT,
        })
      : [
          'PLATFORM RUNTIME SAFETY: Enforce tenant isolation and channel delivery rules.',
          channelRules,
          knowledge?.knowledgeContext ? `APPROVED KNOWLEDGE:\n${knowledge.knowledgeContext}` : '',
        ].filter(Boolean).join('\n\n');

    logInstagramRuntimeContextDiagnostics({ systemInstruction, persona, knowledge, sharedContentContext });


    const generationStartedAt = Date.now();
    const cleanRecipient = String(recipientIgsid || '').replace(/^instagram:\s*/i, '').trim();
    let typingActive = false;

    if (accessToken && cleanRecipient) {
      try {
        const typingRes = await sendInstagramTypingIndicator({
          recipientId: cleanRecipient,
          accessToken,
          instagramAccountId: accountId,
          pageId: accountId,
          instagramUserId,
          authMode,
          http,
        });
        if (typingRes?.ok) typingActive = true;
      } catch (typingErr) {
        console.warn('INSTAGRAM_TYPING_INDICATOR_NON_BLOCKING_WARN', typingErr?.message);
      }
    }

    try {
      let genResult = { text: '', model: assistantModel || 'default', fallbackUsed: false, fallbackReason: null };
      logInstagramBehavioralPolicyDiagnostics({ assistantId, persona });
      if (typeof generateAiResponse === 'function') {
        const generated = await generateAiResponse({
          systemInstruction,
          text: textToAnswer,
          conversationHistory: history,
          model: assistantModel,
        });
        if (typeof generated === 'string') {
          genResult.text = generated;
        } else if (generated && typeof generated.text === 'string') {
          genResult = { ...genResult, ...generated };
        }
      } else {
        genResult = await defaultGenerateInstagramAiResponse({
          systemInstruction,
          text: textToAnswer,
          conversationHistory: history,
          model: assistantModel,
          memory: { ...durableMemory, appointmentState, sharedContentContext },
        });
      }

      const rawAiResponseText = typeof genResult === 'string' ? genResult : genResult.text;
      const sanitizedResponse = sanitizeInstagramOutboundResponse(rawAiResponseText);
      const formattedResponse = formatInstagramDmResponse(sanitizedResponse);

      const durationMs = Date.now() - generationStartedAt;
      console.info(
        `INSTAGRAM_AI_GENERATION` +
        ` tenant=${tenantId ? tenantId.slice(0, 8) : 'unknown'}` +
        ` conversation=${conversationId ? conversationId.slice(0, 8) : 'unknown'}` +
        ` mode=OPERATOR_AI_ONLY` +
        ` model=${genResult.model || assistantModel || 'default'}` +
        ` durationMs=${durationMs}` +
        ` fallbackUsed=${genResult.fallbackUsed ? '1' : '0'}` +
        ` fallbackReason=${genResult.fallbackReason || 'none'}` +
        ` chars=${(formattedResponse || '').length}`
      );

      if (!formattedResponse) return { skipped: true, reason: 'EMPTY_AI_RESPONSE' };

      if (applyPacing !== false) {
        await applyWhatsAppAdaptivePacing({
          generationStartedAt,
          content: formattedResponse,
        });
      }

      const persisted = await persistAssistantResponseIfCurrent({
        tenantId,
        conversationId,
        content: formattedResponse,
        handlingVersion: conversation.handling_version,
        idempotencyKey: latestMsg.id ? `instagram-ai:${latestMsg.id}` : null,
        deliveryStatus: 'SENDING',
        sourceCustomerMessageId: latestMsg.id || null,
        suppressIfNewerExplicitCustomerMessage: isMediaOnlyInbound(textToAnswer),
        database,
      });

      const triggerType = resolveInstagramTriggerType(textToAnswer);
      console.info(
        `INSTAGRAM_AI_TURN_VALIDITY` +
        ` triggerType=${triggerType}` +
        ` triggerMid=${latestMsg.id ? String(latestMsg.id).slice(0, 64) : 'none'}` +
        ` newerExplicitUserMessage=${persisted.newerExplicitUserMessage ? 'true' : 'false'}` +
        ` turnStillCurrent=${persisted.turnStillCurrent !== false ? 'true' : 'false'}` +
        ` responseSuppressedReason=${persisted.reason === 'STALE_SHARED_CONTENT_TURN' ? 'STALE_SHARED_CONTENT_TURN' : 'none'}`,
      );

      if (!persisted.delivered) {
        return { delivered: false, dropped: true, reason: persisted.reason || 'CONVERSATION_TAKEN_OVER' };
      }

      if (!accessToken || !cleanRecipient) {
        const transportError = Object.assign(new Error('Instagram delivery transport is not configured'), {
          code: 'INSTAGRAM_DELIVERY_NOT_CONFIGURED',
        });
        await recordInstagramAssistantDeliveryFailure({
          database: client,
          tenantId,
          messageId: persisted.message?.id,
          error: transportError,
        });
        return {
          delivered: false,
          reason: transportError.code,
          responseText: formattedResponse,
          assistantMessageId: persisted.message?.id || null,
        };
      }

      let deliveryResult = null;
      let deliveryError = null;

      try {
        deliveryResult = await deliverInstagramText({
          recipientId: cleanRecipient,
          content: formattedResponse,
          accessToken,
          instagramAccountId: accountId,
          pageId: accountId,
          instagramUserId,
          authMode,
          http,
        });
        await recordInstagramAssistantDeliverySuccess({
          database: client,
          tenantId,
          messageId: persisted.message?.id,
          providerMessageId: deliveryResult?.providerMessageId,
        });

        if (qualResult?.qualified || durableMemory.ctaUrl) {
          await client.query(
            `UPDATE crm_consultations
                SET cta_delivered_at = CURRENT_TIMESTAMP
              WHERE tenant_id = $1 AND conversation_id = $2 AND cta_delivered_at IS NULL`,
            [tenantId, conversationId]
          ).catch(() => {});
        }
      } catch (deliveryErr) {
        deliveryError = deliveryErr;
        console.error('INSTAGRAM_OUTBOUND_DELIVERY_ERROR', deliveryErr?.code, deliveryErr?.message);
        await recordInstagramAssistantDeliveryFailure({
          database: client,
          tenantId,
          messageId: persisted.message?.id,
          error: deliveryErr,
        });
      }

      // Trigger high-intent qualification and silent internal notification asynchronously
      evaluateAndProcessHighIntentLead({
        tenantId,
        conversationId,
        database: client,
        httpClient: http,
      }).catch((err) => console.warn('HIGH_INTENT_LEAD_EVALUATION_NON_BLOCKING_WARN', err?.message));

      return {
        aiInvoked: true,
        delivered: !deliveryError && Boolean(deliveryResult),
        deliveryError: deliveryError?.message || null,
        responseText: formattedResponse,
        deliveryResult,
        assistantMessageId: persisted.message?.id || null,
      };
    } finally {
      if (typingActive && accessToken && cleanRecipient) {
        try {
          await sendInstagramTypingOff({
            recipientId: cleanRecipient,
            accessToken,
            instagramAccountId: accountId,
            pageId: accountId,
            instagramUserId,
            authMode,
            http,
          });
        } catch (typingOffErr) {
          console.warn('INSTAGRAM_TYPING_OFF_WARN', typingOffErr?.message);
        }
      }
    }

  } finally {
    if (shouldRelease && typeof client?.release === 'function') {
      client.release();
    }
  }
}


