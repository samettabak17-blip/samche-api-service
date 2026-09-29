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
import { createGoogleGeminiProvider } from './google-gemini-provider.js';
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
} from './high-intent-lead-service.js';

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
  'INSTAGRAM DM PRESENTATION & NATURAL HUMAN CONVERSATION RULES:',
  '1. CHANNEL MEDIUM: You are conversing directly with a customer inside an Instagram Direct Message (DM). Keep responses concise, clear, and natural like a seasoned human business consultant.',
  '2. DIRECT ANSWERS & STRICT INTENT-FOCUSED SCOPE (NO OVER-ANSWERING):',
  '   - Answer ONLY what the customer explicitly asks. Do not add unnecessary filler greetings or generic pleasantries.',
  '   - Do NOT proactively volunteer unrequested information, including consultancy fees, company formation costs, license costs, package prices, visa prices, unrelated services, Free Zone/Mainland recommendations, long setup process explanations, banking information, tax information, or package comparisons UNLESS the customer actually asks about that subject.',
  '   - Knowledge is a factual reference library, NOT a checklist of services to cross-sell or a script to recite. Knowledge is a factual reference library, NOT a checklist of services to cross-sell. Use ONLY the excerpts relevant to the customer\'s specific question and intent.',
  '   - NEVER mention or introduce the 13.000 AED Sponsored Residency package when the customer asks about company formation. Sponsored Residency is a separate standalone service and must ONLY be discussed when the customer explicitly asks about residency, visas, or living/working in Dubai without establishing a company.',
  '3. PRICING IS STRICTLY REQUEST-DRIVEN (NO UNSOLICITED PRICE DISCLOSURE):',
  '   - If the customer does NOT ask for pricing (e.g. "fiyat nedir?", "ne kadar?", "maliyeti nedir?", "danışmanlık ücretiniz nedir?", "ücretler nasıl?"), DO NOT disclose the 8.000 AED consultancy fee or any other cost/pricing.',
  '   - If customer does NOT ask company cost, company/license cost MUST NOT appear.',
  '   - If customer does NOT ask visa cost, visa pricing MUST NOT appear.',
  '   - If customer does NOT ask for package comparison, package/pricing comparison MUST NOT appear.',
  '   - WHEN AND ONLY WHEN the customer explicitly asks about consultancy fee or pricing:',
  '     * "Danışmanlık ücretiniz ne kadar?": Answer directly and naturally according to authoritative Main policy: "Danışmanlık ücretimiz 8.000 AED\'dir. Şirket banka hesabı açılışı ve KYC desteği bu ücrete dahildir." Do NOT append unrelated visa packages or cross-sells.',
  '     * "Şirket kurulum maliyeti ne olur? / Toplam ne kadara kurulur?": Explain the main variables (Free Zone vs Mainland, sector/activity, visa requirements), state that the SamChe consultancy fee is 8.000 AED (which includes bank account opening and KYC support), and do NOT invent exact license costs without knowing jurisdiction or activity.',
  '4. MEETING / APPOINTMENT INTENT OVERRIDES SALES EXPLANATION (PROGRESSIVE QUALIFICATION):',
  '   - When an Instagram customer expresses intent to speak with Samed, schedule a consultation, arrange a meeting, be called, or discuss their case directly (e.g. "Samed Bey sizinle görüşebilir miyiz?", "Randevu alabilir miyiz?", "Müsait olduğunuzda görüşmek istiyorum", "Beni arayabilir misiniz?", "Samed Bey ile konuşmak istiyorum", "Şirket kurulumu için görüşme yapmak istiyorum", "Ne zaman görüşebiliriz?", "Telefonla konuşabilir miyiz?"):',
  '     - Switch IMMEDIATELY into natural appointment scheduling. Do NOT give long unsolicited lectures, pricing overviews, or Free Zone explanations.',
  '     - DO NOT perform any handoff and NEVER say phrases like "Sizi canlı temsilciye aktarıyorum", "Sizi Samed Bey\'e aktarıyorum", "Talebinizi WhatsApp\'a iletiyorum", "Bir temsilci devralacak", or "Canlı desteğe aktarıyorum". Internal escalation to Samed via WhatsApp is completely silent.',
  '     - Determine all currently missing required meeting information (phone/WhatsApp number, meeting topic/service if unknown, and preferred day/time availability).',
  '     - Ask for the missing required information together in ONE natural, friendly, concise message (e.g. "Elbette görüşebiliriz. Görüşme talebinizi oluşturabilmem için telefon numaranızı, görüşmek istediğiniz konuyu ve size uygun gün/saat bilgisini paylaşabilir misiniz? Şirket kurulumu düşünüyorsanız faaliyet alanınız netleştiyse onu da ekleyebilirsiniz; henüz net değilse sorun değil.").',
  '     - DO NOT force a slow one-question-per-turn interrogation form.',
  '     - USE INFORMATION ALREADY PROVIDED (NEVER ASK REDUNDANTLY): If the customer already provided details in earlier turns, treat them as collected facts. NEVER ask for already stated information again.',
  '     - If phone is already provided -> DO NOT ask for phone.',
  '     - If topic is already provided (or if customer says "İkisi de olabilir") -> accept both / do NOT ask topic again.',
  '     - If customer states business activity is undecided ("Henüz karar vermedim", "bilmiyorum", "emin değilim", "fark etmez", etc.) -> accept it as undecided; do NOT repeat the question and proceed with meeting availability (preferred day/time).',
  '     - DO NOT proactively ask or introduce residency/visa questions (do not ask about visa or ask "Kaç adet oturum vizesi gerekecek?" merely because the customer asked about company formation) unless the customer explicitly asks about residency/visas or states a visa requirement.',
  '5. SAFE ACKNOWLEDGEMENT WITHOUT FAKE CONFIRMATION:',
  '   - When both phone and preferred availability (day/time) are collected, acknowledge naturally and record their preferred timing as a pending appointment request (e.g. "Teşekkür ederim, görüşme talebinizi ve uygun olduğunuz zamanı aldım."). NEVER say "Randevunuz kesinleşti." unless actual booking confirmation exists.',
  '6. CUSTOMER CONTROLS THE TOPIC:',
  '   - If during appointment qualification the customer asks a question (e.g. pricing, banking, visas, process):',
  '     * Answer THAT specific question directly and factually according to authoritative policy.',
  '     * If they asked pricing: answer 8.000 AED Free Zone consultancy fee with bank/KYC included.',
  '     * Then smoothly and naturally continue collecting the missing appointment qualification details.',
  '7. STRICTLY FORBIDDEN CORPORATE & CALL-CENTER PHRASES (NEVER USE ANY OF THESE):',
  '   - DO NOT say "danışmanlarımız", "danışmanlarımızla görüşme", "temsilcilerimiz", "ekibimiz", "ekibimiz sizinle iletişime geçecek", "ilgili birimimiz", "danışmanlarımız sizi arayacak", "WhatsApp\'tan sizinle iletişime geçeceğiz", "ekibimize yönlendiriyorum".',
  '   - DO NOT say "görüşmeyi organize edebiliriz", "görüşmenizin daha verimli geçmesi için", "size özel bir yol haritası sunabilmemiz adına", "size özel bir ön çalışma ileterek süreci başlatabiliriz", "birkaç temel bilgiye ihtiyacımız var".',
  '   - DO NOT say "sizi ilgili kişiye aktaracağım", "sizi Samed Bey\'e aktarıyorum", "sizi canlı temsilciye aktarıyorum", "canlı temsilciye aktarıyorum", "bir temsilci devralacak", "talebinizi WhatsApp\'a iletiyorum". The customer initiates WhatsApp contact themselves via the CTA.',
  '   - DO NOT claim the appointment is confirmed unless a real calendar booking exists. The PENDING consultation is an internal request, not a confirmed appointment.',
  '   - DO NOT introduce yourself as an "AI", "AI Assistant", "bot", or "virtual assistant".',
  '   - Do NOT falsely explicitly claim "Ben Samed\'im" if identity is directly questioned. Speak directly, humanly, and professionally.',
  '8. LANGUAGE & CONVERSATION FLOW:',
  '   - Respond in the customer’s language. When the customer writes in Turkish, respond in natural, professional Turkish.',
  '   - Do not repeat "How can we help you?" or "Nasıl yardımcı olabilirim?" on every message.',
  '   - Use multi-turn conversation history: remember details provided earlier in the chat and never ask again for information the customer has already given.',
  '9. INSTAGRAM TEXT-ONLY & VISUAL AI RESTRICTION:',
  '   - Instagram Direct Messaging is strictly text-only. Never generate images or invoke visual generation.',
  '   - If the customer asks to generate or create an image, respond naturally in text explaining that image generation is not supported on direct messages, and assist them directly with their business inquiry.',
  '10. CUSTOMER DISPLAY-NAME & NATURAL ADDRESSING:',
  '    - If the customer\'s real display name is provided in Customer Identity Context (e.g. "Ahmet Yılmaz"), you may address them naturally and politely in Turkish (e.g. "Ahmet Bey" or natural conversational addressing).',
  '    - NEVER address the customer by their Instagram username (e.g. do NOT say "@ahmet34" or "@ahmetyilmaz").',
  '    - NEVER address the customer as "Instagram conversation", "Instagram User", or by an ID.',
  '    - Do NOT repeatedly use their name in every response; use it naturally where appropriate (greetings, acknowledgements, qualification).',
  '    - During appointment qualification, if the customer\'s real name is already known from context, do NOT redundantly ask "Adınız nedir?". Proceed directly to collecting missing contact details (phone/WhatsApp, service details).',
  '11. FORMATTING RULES (CRITICAL FOR READABILITY):',
  '    - Concise mobile DM answers: keep responses focused and mobile-friendly (typically under 800 characters).',
  '    - When presenting lists of 2 or more items (numbered 1., 2., 3. or bullet points •), EACH item MUST be placed on its own separate line.',
  '    - NEVER concatenate list items horizontally onto the same line.',
  '    - Separate distinct points with clean paragraph breaks so the message is effortless to read on mobile DM screens.',
  '    - Do not use markdown bolding (**) or markdown headers (###); write plain, beautifully spaced text with clean bullet points (• ).',
].join('\n'));




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
 * Strips unsupported automated contact promises from AI generated responses,
 * enforcing truthfulness in channel communications without mutating the Main business policy.
 */
export function sanitizeInstagramOutboundResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText;

  // Patterns for false contact promises (e.g. "telefon numarası üzerinden sizinle iletişime geçeceğiz", "ekibimiz sizi arayacak")
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

/**
 * Generates an intelligent, context-aware fallback response from conversation memory
 * ensuring no eligible customer turn is ever silently dropped and no fake contact promises are made.
 */
export function generateContextualConversationalFallback({ text = '', conversationHistory = [], memory = {} } = {}) {
  const cleanText = String(text || '').trim();
  const phone = memory.phone || extractPhoneNumberFromText(cleanText);
  const requestedTime = memory.requestedTime || extractMeetingTimePreference(cleanText);
  const isUndecided = extractUndecidedSignals(cleanText);
  const isQualified = Boolean(phone && requestedTime);

  if (isQualified && memory.ctaUrl) {
    return `Teşekkür ederim, görüşme talebinizi aldım. Aşağıdaki bağlantı üzerinden WhatsApp'tan doğrudan iletişime geçebilirsiniz:\n\n${memory.ctaUrl}`;
  }

  if (isUndecided) {
    if (!requestedTime) {
      return 'Anladım, faaliyet alanı netleşmediyse sorun değil; görüşme sırasında detayları birlikte değerlendirebiliriz. Görüşme için size uygun gün ve saat aralığını paylaşabilir misiniz?';
    }
    if (phone && memory.ctaUrl) {
      return `Anladım, detayları görüşmemizde birlikte netleştirebiliriz. Aşağıdaki bağlantı üzerinden WhatsApp'tan doğrudan iletişime geçebilirsiniz:\n\n${memory.ctaUrl}`;
    }
    return 'Anladım, detayları görüşmemizde birlikte netleştirebiliriz. Görüşme talebinizi aldım.';
  }

  if (hasHighIntentAppointmentSignals(cleanText)) {
    if (!phone && !requestedTime) {
      return 'Elbette görüşebiliriz. Görüşme talebinizi oluşturabilmem için telefon numaranızı, görüşmek istediğiniz konuyu ve size uygun gün/saat bilgisini iletebilir misiniz?';
    }
    if (phone && !requestedTime) {
      return 'Telefon numaranızı aldım. Görüşme için size uygun gün ve saat aralığını paylaşabilir misiniz?';
    }
    if (!phone && requestedTime) {
      return 'Uygun olduğunuz zamanı aldım. Sizinle iletişime geçebilmemiz için telefon numaranızı paylaşabilir misiniz?';
    }
  }

  if (phone && !requestedTime) {
    return 'Numaranızı kaydettim. Görüşme için size uygun gün ve saat aralığını paylaşabilir misiniz?';
  }

  return 'Mesajınızı aldım. Şirket kuruluşu veya oturum danışmanlığı ile ilgili sorularınızı yanıtlayabilir veya görüşme talebinizi planlayabilirim.';
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
 * Contains durable facts, topic continuity rules, and strict anti-re-asking constraints.
 */
export function buildStructuredMemoryInstruction(memory = {}) {
  const isQualified = Boolean(memory.phone && memory.requestedTime);
  const ctaInstruction = isQualified && memory.ctaUrl && !memory.ctaDelivered
    ? [
        '',
        'MEETING QUALIFICATION COMPLETED (PHONE & MEETING TIME PRESENT):',
        `- Both contact phone ("${memory.phone}") and preferred meeting time ("${memory.requestedTime}") have been collected.`,
        '- DO NOT say "Sizinle paylaştığınız numara üzerinden iletişime geçilecektir", "Numaranız üzerinden sizinle iletişime geçeceğiz", or that an agent/team will call them.',
        '- Acknowledge their meeting request warmly and present the customer-initiated WhatsApp contact link so the customer can initiate direct contact with Samed Bey on WhatsApp:',
        memory.ctaUrl,
      ]
    : [];

  const lines = [
    'DURABLE CONVERSATION MEMORY & PERSISTED CRM FACTS:',
    `- Active Topic / Context: ${memory.serviceRequested || 'Company Formation & Consultancy (UAE / Dubai)'}`,
    memory.customerName ? `- Customer Real Name: "${memory.customerName}"` : `- Customer Real Name: Unknown`,
    memory.serviceRequested ? `- Service / Consultation Topic: "${memory.serviceRequested}"` : `- Service / Consultation Topic: General Consultancy`,
    memory.businessActivity ? `- Business Activity / Sector: "${memory.businessActivity}"` : `- Business Activity / Sector: Not specified`,
    memory.activityState === 'NOT_DECIDED' ? `- Business Activity State: NOT_DECIDED (Customer stated they have not decided on the sector yet. Accept this; do NOT ask again)` : null,
    memory.shareholderCount ? `- Shareholder / Partner Count: ${memory.shareholderCount}` : `- Shareholder / Partner Count: Not specified`,
    memory.visaCount ? `- Visa Requirement: ${memory.visaCount}` : `- Visa Requirement: Not specified`,
    memory.jurisdictionPreference ? `- Jurisdiction Preference: ${memory.jurisdictionPreference}` : `- Jurisdiction Preference: Free Zone (Default)`,
    memory.phone ? `- Contact Phone / WhatsApp: ${memory.phone}` : `- Contact Phone / WhatsApp: Missing`,
    memory.requestedTime ? `- Preferred Meeting Time: ${memory.requestedTime}${memory.timezone ? ` (${memory.timezone})` : ''}` : `- Preferred Meeting Time: Missing`,
    memory.ctaDelivered ? `- Customer WhatsApp CTA: Already delivered in a previous turn (Do NOT resend CTA link)` : null,
    '',
    'STRICT ANTI-REDUNDANT-QUESTION & CONVERSATION RULES:',
    '1. NEVER re-ask any fact listed above as already known or answered!',
    memory.phone ? '2. Customer Phone is ALREADY KNOWN. DO NOT ask for their phone number again.' : null,
    memory.serviceRequested ? '3. Service / Consultation Topic is ALREADY KNOWN. DO NOT ask them what service or to choose between options again.' : null,
    memory.businessActivity || memory.activityState === 'NOT_DECIDED' ? '4. Business Activity is ALREADY ANSWERED (known or undecided). DO NOT ask for their business activity or sector again.' : null,
    memory.requestedTime ? '5. Preferred Meeting Time is ALREADY KNOWN. DO NOT ask for their preferred time or availability again.' : null,
    memory.customerName ? '6. Customer Real Name is ALREADY KNOWN. DO NOT ask "Adınız nedir?".' : null,
    '7. NATURAL MULTI-FIELD COLLECTION: When a customer requests a meeting, ask currently missing required details (phone, topic, preferred day/time) naturally in ONE response instead of interrogating one question per turn.',
    '8. UNDECIDED ANSWERS ARE VALID: If customer says "Henüz karar vermedim", "bilmiyorum", "fark etmez", etc., accept it smoothly, do not repeat the question, and proceed with scheduling the meeting.',
    '9. TOPIC CONTINUITY: Follow-up questions inherit the active subject.',
    '10. NO FALSE PROMISES: NEVER say "Sizinle paylaştığınız numara üzerinden iletişime geçilecektir" or that an automated call will happen.',
    ...ctaInstruction,
  ].filter((p) => p !== null);

  return lines.join('\n');
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
        `SELECT id, sender_type, content, created_at
           FROM conversation_messages
          WHERE tenant_id = $1 AND conversation_id = $2
          ORDER BY created_at DESC, id DESC
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
 * Invokes the canonical Google Gemini provider with active system instruction & history.
 */
async function defaultGenerateInstagramAiResponse({
  systemInstruction,
  text,
  conversationHistory = [],
  model = null,
  memory = {},
}) {
  let provider;
  try {
    provider = createGoogleGeminiProvider();
  } catch (providerErr) {
    console.error('INSTAGRAM_GEMINI_PROVIDER_INIT_ERROR', providerErr?.message);
    return generateContextualConversationalFallback({ text, conversationHistory, memory });
  }

  const defaultModel = provider.runtimeMetadata().model;
  const runtimeModel = model || defaultModel;

  // Prepare Gemini contents from history:
  // Gemini requires that the first turn has role 'user' and turns alternate strictly.
  const rawContents = [];
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    for (const h of conversationHistory) {
      const role = h.role === 'model' || h.role === 'assistant' ? 'model' : 'user';
      let turnText = '';
      if (Array.isArray(h.parts)) {
        turnText = h.parts.map((p) => p?.text || '').filter(Boolean).join('\n\n').trim();
      } else if (typeof h.content === 'string') {
        turnText = h.content.trim();
      }
      if (!turnText) continue;

      if (rawContents.length > 0 && rawContents[rawContents.length - 1].role === role) {
        rawContents[rawContents.length - 1].parts[0].text += '\n\n' + turnText;
      } else {
        rawContents.push({ role, parts: [{ text: turnText }] });
      }
    }
  }

  // Remove any leading 'model' turns so history begins with 'user'
  while (rawContents.length > 0 && rawContents[0].role === 'model') {
    rawContents.shift();
  }

  // Ensure current user message is at the end
  const currentPrompt = String(text || '').trim();
  if (currentPrompt) {
    if (rawContents.length === 0) {
      rawContents.push({ role: 'user', parts: [{ text: currentPrompt }] });
    } else if (rawContents[rawContents.length - 1].role === 'user') {
      // If the last turn in history is already the current user message, leave it; otherwise ensure currentPrompt
      if (rawContents[rawContents.length - 1].parts[0]?.text !== currentPrompt) {
        rawContents[rawContents.length - 1].parts[0].text = currentPrompt;
      }
    } else {
      rawContents.push({ role: 'user', parts: [{ text: currentPrompt }] });
    }
  }

  // Fallback to minimal contents if empty
  const contents = rawContents.length > 0
    ? rawContents
    : [{ role: 'user', parts: [{ text: currentPrompt || 'Merhaba' }] }];

  const extractResponseText = (response) => {
    if (!response) return null;
    if (typeof response.structured_text === 'string' && response.structured_text.trim()) {
      return response.structured_text.trim();
    }
    const candidates = Array.isArray(response.candidates) ? response.candidates : [];
    if (candidates.length > 0) {
      const parts = Array.isArray(candidates[0]?.content?.parts) ? candidates[0].content.parts : [];
      const textParts = parts.filter((p) => p?.thought !== true && typeof p?.text === 'string' && p.text.trim());
      if (textParts.length > 0) {
        return textParts.map((p) => p.text.trim()).join('\n\n');
      }
    }
    if (typeof response.text === 'string' && response.text.trim()) {
      return response.text.trim();
    }
    return null;
  };

  const genConfig = {
    thinkingConfig: {
      thinkingBudget: 0,
    },
  };

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 35000);

  try {
    const response = await provider.generateContent({
      model: runtimeModel,
      contents,
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
      generationConfig: genConfig,
      signal: abortController.signal,
    });
    const parsedText = extractResponseText(response);
    if (parsedText) return parsedText;
  } catch (genErr) {
    console.warn(`INSTAGRAM_AI_GENERATION_WARN model=${runtimeModel} code=${genErr?.code ?? 'UNKNOWN'} err=${genErr?.message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  // Fallback retry with default model if distinct from runtimeModel
  if (runtimeModel !== defaultModel) {
    const retryController = new AbortController();
    const retryTimeoutId = setTimeout(() => retryController.abort(), 35000);
    try {
      const retryRes = await provider.generateContent({
        model: defaultModel,
        contents,
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        generationConfig: genConfig,
        signal: retryController.signal,
      });
      const fallbackText = extractResponseText(retryRes);
      if (fallbackText) return fallbackText;
    } catch (retryErr) {
      console.error(`INSTAGRAM_AI_GENERATION_FALLBACK_ERROR model=${defaultModel} code=${retryErr?.code ?? 'UNKNOWN'} err=${retryErr?.message}`);
    } finally {
      clearTimeout(retryTimeoutId);
    }
  }

  // No-Silent-Turn Conversational Fallback
  return generateContextualConversationalFallback({ text, conversationHistory, memory });
}

const activeInstagramOrchestrations = new Set();

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
  if (activeInstagramOrchestrations.has(orchestrationKey)) {
    console.info('INSTAGRAM_AI_ORCHESTRATION_ALREADY_IN_FLIGHT conversationId=' + conversationId);
    return { aiInvoked: false, skipped: true, duplicate: true, reason: 'ORCHESTRATION_IN_FLIGHT' };
  }
  activeInstagramOrchestrations.add(orchestrationKey);

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
          const effective = (row.contact_override && row.contact_override !== 'UNDECIDED')
            ? row.contact_override
            : (row.conv_override && row.conv_override !== 'UNDECIDED')
            ? row.conv_override
            : null;
          if (effective) {
            conversation.ai_behavior_override = effective;
            conversation.contact_ai_behavior_override = effective;
          }
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

  if (!activationEvaluation.eligible) {
    console.info(
      `INSTAGRAM_AI_ACTIVATION_SUPPRESSED tenant=${tenantId ? tenantId.slice(0, 8) : 'unknown'}` +
      ` conversation=${conversationId ? conversationId.slice(0, 8) : 'unknown'}` +
      ` policy=${activationEvaluation.policy}` +
      ` reason=${activationEvaluation.reasonCode}`
    );
    return {
      aiInvoked: false,
      suppressed: true,
      activationEvaluation,
    };
  }

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
  const durableMemory = await resolveDurableConversationMemory({
    database,
    tenantId,
    conversationId,
    conversation,
    rawMessages: historyData.rawMessages || [],
  });

  // Evaluate / ensure high-intent lead qualification & CTA if qualified
  let qualResult = null;
  const isQualified = Boolean(durableMemory.phone && durableMemory.requestedTime);
  const rawTurnText = history.map((h) => h.parts?.[0]?.text || h.content || '').join('\n') + '\n' + text;

  if (isQualified || hasHighIntentAppointmentSignals(rawTurnText)) {
    try {
      qualResult = await evaluateAndProcessHighIntentLead({
        tenantId,
        conversationId,
        database,
        httpClient: http,
      });
      if (qualResult?.ctaUrl) {
        durableMemory.ctaUrl = qualResult.ctaUrl;
        durableMemory.prefilledText = qualResult.prefilledText;
      }
    } catch (qualErr) {
      console.warn('INSTAGRAM_QUAL_EVAL_WARN', qualErr?.message);
    }
  }

  const structuredMemoryContext = buildStructuredMemoryInstruction(durableMemory);

  // 7. Build System Instruction with Channel Presentation Rules and Structured Memory Context
  const rawCustomerName = durableMemory.customerName || conversation?.contact_display_name || conversation?.display_name || null;
  const reliableCustomerName = extractReliableCustomerName(rawCustomerName);
  const customerIdentityContext = reliableCustomerName
    ? `CUSTOMER IDENTITY CONTEXT:\n- Customer Real Display Name: "${reliableCustomerName}"\n- You may address the customer naturally as "${reliableCustomerName}" / in Turkish.\n- Do NOT treat their username as a real name.\n- During appointment qualification, since their name is already known, do NOT ask "Adınız nedir?".`
    : '';

  const channelRules = [
    INSTAGRAM_CHANNEL_PRESENTATION_RULES,
    customerIdentityContext,
    structuredMemoryContext,
  ].filter(Boolean).join('\n\n');

  const systemInstruction = persona?.available
    ? buildTenantRuntimeSystemInstruction({
        persona,
        knowledgeContext: knowledge?.knowledgeContext || '',
        channelRules,
      })
    : [
        'PLATFORM RUNTIME SAFETY: Enforce tenant isolation and channel delivery rules.',
        channelRules,
        knowledge?.knowledgeContext ? `APPROVED KNOWLEDGE:\n${knowledge.knowledgeContext}` : '',
      ].filter(Boolean).join('\n\n');




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
    let rawAiResponseText = '';
    if (typeof generateAiResponse === 'function') {
      rawAiResponseText = await generateAiResponse({
        systemInstruction,
        text,
        conversationHistory: history,
        model: assistantModel,
      });
    } else {
      rawAiResponseText = await defaultGenerateInstagramAiResponse({
        systemInstruction,
        text,
        conversationHistory: history,
        model: assistantModel,
        memory: durableMemory,
      });
    }

    const sanitizedResponse = sanitizeInstagramOutboundResponse(rawAiResponseText);
    let formattedResponse = formatInstagramDmResponse(sanitizedResponse);

    // Deterministic CTA Attachment:
    // If qualification is complete and consultation exists with CTA url, and CTA was not yet delivered:
    if (isQualified && qualResult?.ctaUrl && !durableMemory.ctaDelivered) {
      if (!formattedResponse.includes('wa.me')) {
        const ctaLeadText = qualResult.ctaPayload?.dm_response_text ||
          "Görüşme talebinizi WhatsApp üzerinden doğrudan iletmek için aşağıdaki bağlantıyı kullanabilirsiniz:";
        formattedResponse = `${formattedResponse}\n\n${ctaLeadText}\n${qualResult.ctaUrl}`.trim();
      }
    }

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
      database,
    });

    if (!persisted.delivered) {
      console.info('INSTAGRAM_AI_RESPONSE_DROPPED reason=HANDLING_MODE_CHANGED');
      return { delivered: false, dropped: true, reason: 'CONVERSATION_TAKEN_OVER' };
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

    return {
      aiInvoked: true,
      delivered: !deliveryError && Boolean(deliveryResult),
      deliveryError: deliveryError?.message || null,
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
    activeInstagramOrchestrations.delete(orchestrationKey);
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
    const durableMemory = await resolveDurableConversationMemory({
      database: client,
      tenantId,
      conversationId,
      conversation,
      rawMessages: historyData.rawMessages || [],
    });

    let qualResult = null;
    const isQualified = Boolean(durableMemory.phone && durableMemory.requestedTime);
    const rawTurnText = history.map((h) => h.parts?.[0]?.text || h.content || '').join('\n') + '\n' + textToAnswer;

    if (isQualified || hasHighIntentAppointmentSignals(rawTurnText)) {
      try {
        qualResult = await evaluateAndProcessHighIntentLead({
          tenantId,
          conversationId,
          database: client,
          httpClient: http,
        });
        if (qualResult?.ctaUrl) {
          durableMemory.ctaUrl = qualResult.ctaUrl;
          durableMemory.prefilledText = qualResult.prefilledText;
        }
      } catch (qualErr) {
        console.warn('INSTAGRAM_QUAL_EVAL_WARN', qualErr?.message);
      }
    }

    const structuredMemoryContext = buildStructuredMemoryInstruction(durableMemory);

    const rawCustomerName = durableMemory.customerName || conversation?.contact_display_name || conversation?.display_name || null;
    const reliableCustomerName = extractReliableCustomerName(rawCustomerName);
    const customerIdentityContext = reliableCustomerName
      ? `CUSTOMER IDENTITY CONTEXT:\n- Customer Real Display Name: "${reliableCustomerName}"\n- You may address the customer naturally as "${reliableCustomerName}" / in Turkish.\n- Do NOT treat their username as a real name.\n- During appointment qualification, since their name is already known, do NOT ask "Adınız nedir?".`
      : '';

    const channelRules = [
      INSTAGRAM_CHANNEL_PRESENTATION_RULES,
      customerIdentityContext,
      structuredMemoryContext,
    ].filter(Boolean).join('\n\n');

    const systemInstruction = persona?.available
      ? buildTenantRuntimeSystemInstruction({
          persona,
          knowledgeContext: knowledge?.knowledgeContext || '',
          channelRules,
        })
      : [
          'PLATFORM RUNTIME SAFETY: Enforce tenant isolation and channel delivery rules.',
          channelRules,
          knowledge?.knowledgeContext ? `APPROVED KNOWLEDGE:\n${knowledge.knowledgeContext}` : '',
        ].filter(Boolean).join('\n\n');


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
      let rawAiResponseText = '';
      if (typeof generateAiResponse === 'function') {
        rawAiResponseText = await generateAiResponse({
          systemInstruction,
          text: textToAnswer,
          conversationHistory: history,
          model: assistantModel,
        });
      } else {
        rawAiResponseText = await defaultGenerateInstagramAiResponse({
          systemInstruction,
          text: textToAnswer,
          conversationHistory: history,
          model: assistantModel,
          memory: durableMemory,
        });
      }

      const sanitizedResponse = sanitizeInstagramOutboundResponse(rawAiResponseText);
      let formattedResponse = formatInstagramDmResponse(sanitizedResponse);

      // Deterministic CTA Attachment:
      if (isQualified && qualResult?.ctaUrl && !durableMemory.ctaDelivered) {
        if (!formattedResponse.includes('wa.me')) {
          const ctaLeadText = qualResult.ctaPayload?.dm_response_text ||
            "Görüşme talebinizi WhatsApp üzerinden doğrudan iletmek için aşağıdaki bağlantıyı kullanabilirsiniz:";
          formattedResponse = `${formattedResponse}\n\n${ctaLeadText}\n${qualResult.ctaUrl}`.trim();
        }
      }

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
        database,
      });

      if (!persisted.delivered) {
        return { delivered: false, dropped: true, reason: 'CONVERSATION_TAKEN_OVER' };
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


