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
  '     - Switch IMMEDIATELY into progressive appointment qualification. Do NOT give long company-formation explanations, unsolicited Free Zone recommendations, setup step overviews, or pricing.',
  '     - DO NOT perform any handoff and NEVER say phrases like "Sizi canlı temsilciye aktarıyorum", "Sizi Samed Bey\'e aktarıyorum", "Talebinizi WhatsApp\'a iletiyorum", "Bir temsilci devralacak", or "Canlı desteğe aktarıyorum". Internal escalation to Samed via WhatsApp is completely silent.',
  '     - Communicate naturally, warmly, and simply in a direct human voice (e.g. "Elbette görüşebiliriz. Görüşme talebinizi oluşturabilmem için sizden birkaç kısa bilgi almam gerekiyor.").',
  '     - Then ask the FIRST relevant missing qualification question.',
  '5. STEP-BY-STEP CONVERSATIONAL QUALIFICATION:',
  '   - Progress naturally and ask ONE relevant question at a time (or a very small related pair). Do NOT send a giant checklist questionnaire.',
  '   - For company formation, relevant qualification details to collect progressively:',
  '     1. Intended business/activity or sector (e.g. "Kurmayı düşündüğünüz şirketin faaliyet alanı nedir?")',
  '     2. Shareholder / partner count (e.g. "Şirketi tek ortaklı mı düşünüyorsunuz, yoksa başka ortaklar da olacak mı?")',
  '     3. Visa / residency count if relevant (e.g. "Şirket üzerinden kaç kişi için oturum/vize gerekecek?")',
  '     4. Target setup timeline (e.g. "Şirket kurulumuna ne zaman başlamayı planlıyorsunuz?")',
  '     5. Customer phone / WhatsApp number for reachability',
  '     6. Preferred meeting day/time and availability (e.g. "Görüşme için hangi gün ve saat sizin için uygun olur?")',
  '   - USE INFORMATION ALREADY PROVIDED (NEVER ASK REDUNDANTLY): If the customer already provided details in earlier turns (e.g. SaaS/software, clients in Turkey, 1 month timeline), treat them as collected facts. NEVER ask for sector/activity or timeline again if already stated. Move directly to the NEXT missing detail (e.g. partner count, visa count, or contact details).',
  '   - DO NOT proactively ask or introduce residency/visa questions (do not ask about visa or ask "Kaç adet oturum vizesi gerekecek?" merely because the customer asked about company formation) unless the customer explicitly asks about residency/visas or states a visa requirement. Visa count IS allowed as part of genuine company formation qualification once contextually relevant.',
  '   - SAFE ACKNOWLEDGEMENT WITHOUT FAKE CONFIRMATION: If customer provides their phone/WhatsApp number and preferred availability (day/time) is NOT yet collected, DO NOT say the meeting request is complete and DO NOT say you will contact them on WhatsApp. Instead, ask naturally for their availability (e.g. "Teşekkürler Ahmet Bey. Görüşme için size uygun gün ve saat nedir?"). When BOTH phone and preferred availability are collected, acknowledge naturally and record their preferred timing as a pending appointment request (e.g. "Teşekkür ederim Ahmet Bey. Görüşme talebinizi ve uygun olduğunuz zamanı aldım."). NEVER say "Randevunuz kesinleşti." unless actual confirmation exists.',
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
  let activity = null;
  let jurisdiction = null;
  let shareholderCount = null;
  let visaCount = null;
  let requestedTime = null;
  let timezone = null;

  // 1. Check CRM Leads & Consultations if existing in DB
  try {
    const isPool = typeof database?.connect === 'function' && typeof database?.query !== 'function';
    const client = isPool ? await database.connect() : database;
    try {
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
        if (lead.service_interest) activity = lead.service_interest;
        if (lead.timeline && !requestedTime) requestedTime = lead.timeline;
      }

      const consultRes = await client.query(
        `SELECT customer_name, phone, activity, service_requested, requested_time, timezone
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
        if (consult.requested_time && !requestedTime) requestedTime = consult.requested_time;
        if (consult.timezone && !timezone) timezone = consult.timezone;
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

    const parsedActivity = extractBusinessActivity(text);
    if (parsedActivity) activity = parsedActivity;

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
    businessActivity: activity,
    jurisdictionPreference: jurisdiction,
    shareholderCount,
    visaCount,
    requestedTime,
    timezone,
  };
}
/**
 * Builds the structured memory instruction for the system prompt.
 * Contains durable facts, topic continuity rules, and strict anti-re-asking constraints.
 */
export function buildStructuredMemoryInstruction(memory = {}) {
  const lines = [
    'DURABLE CONVERSATION MEMORY & PERSISTED CRM FACTS:',
    `- Active Topic / Context: Company Formation & Consultancy (UAE / Dubai)`,
    memory.customerName ? `- Customer Real Name: "${memory.customerName}"` : `- Customer Real Name: Unknown`,
    memory.businessActivity ? `- Business Activity / Requirement: "${memory.businessActivity}"` : `- Business Activity / Requirement: Missing`,
    memory.shareholderCount ? `- Shareholder / Partner Count: ${memory.shareholderCount}` : `- Shareholder / Partner Count: Not specified`,
    memory.visaCount ? `- Visa Requirement: ${memory.visaCount}` : `- Visa Requirement: Not specified`,
    memory.jurisdictionPreference ? `- Jurisdiction Preference: ${memory.jurisdictionPreference}` : `- Jurisdiction Preference: Free Zone (Default)`,
    memory.phone ? `- Contact Phone / WhatsApp: ${memory.phone}` : `- Contact Phone / WhatsApp: Missing`,
    memory.requestedTime ? `- Preferred Meeting Time: ${memory.requestedTime}${memory.timezone ? ` (${memory.timezone})` : ''}` : `- Preferred Meeting Time: Missing`,
    '',
    'STRICT DUPLICATE-QUESTION PREVENTION (MANDATORY RULES):',
    '1. NEVER re-ask any fact listed above as already known!',
    memory.businessActivity ? '2. Business Activity is ALREADY KNOWN. DO NOT ask "Ne tür bir iş yapmak istiyorsunuz?" or what business they want to do.' : null,
    memory.phone ? '3. Customer Phone is ALREADY KNOWN. DO NOT ask for their phone number again.' : null,
    memory.requestedTime ? '4. Preferred Meeting Time is ALREADY KNOWN. DO NOT ask for their preferred time or availability again.' : null,
    memory.customerName ? '5. Customer Real Name is ALREADY KNOWN. DO NOT ask "Adınız nedir?".' : null,
    '6. TOPIC CONTINUITY: Follow-up questions inherit the active subject (e.g. "Peki banka hesabı?" refers to banking for their specific company formation).',
    '7. PROGRESSIVE QUALIFICATION: Answer the customer\'s question directly first. Then, if essential qualification info is still missing, ask ONLY the next single missing item naturally without interrogation.',
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
}) {
  let provider;
  try {
    provider = createGoogleGeminiProvider();
  } catch (providerErr) {
    console.error('INSTAGRAM_GEMINI_PROVIDER_INIT_ERROR', providerErr?.message);
    return null;
  }

  const defaultModel = provider.runtimeMetadata().model;
  const runtimeModel = model || defaultModel;

  // Prepare Gemini contents from history
  const contents = [];
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    for (const h of conversationHistory) {
      if (h.role && Array.isArray(h.parts) && h.parts.length > 0 && h.parts[0]?.text) {
        contents.push({ role: h.role, parts: h.parts });
      }
    }
  }

  // Ensure current user message is at the end if not already present
  if (contents.length === 0 || contents[contents.length - 1].role !== 'user' || contents[contents.length - 1].parts?.[0]?.text !== text) {
    contents.push({ role: 'user', parts: [{ text }] });
  }

  try {
    const response = await provider.generateContent({
      model: runtimeModel,
      contents,
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (genErr) {
    console.warn(`INSTAGRAM_AI_GENERATION_WARN model=${runtimeModel} code=${genErr?.code ?? 'UNKNOWN'} err=${genErr?.message}`);
    if (runtimeModel !== defaultModel) {
      try {
        const retryRes = await provider.generateContent({
          model: defaultModel,
          contents,
          systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        });
        return retryRes.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
      } catch (retryErr) {
        console.error(`INSTAGRAM_AI_GENERATION_FALLBACK_ERROR model=${defaultModel} code=${retryErr?.code ?? 'UNKNOWN'} err=${retryErr?.message}`);
      }
    }
    return null;
  }
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
  const generationStartedAt = Date.now();
  if (accessToken && senderIgsid) {
    try {
      await sendInstagramTypingIndicator({
        recipientId: senderIgsid,
        accessToken,
        instagramAccountId: accountId,
        pageId: accountId,
        instagramUserId,
        authMode,
        http,
      });
    } catch (typingErr) {
      console.warn('INSTAGRAM_TYPING_INDICATOR_NON_BLOCKING_WARN', typingErr?.message);
    }
  }

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
    });
  }

  const formattedResponse = formatInstagramDmResponse(rawAiResponseText);
  if (!formattedResponse) {
    return { aiInvoked: false, reason: 'EMPTY_AI_RESPONSE' };
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

  if (!accessToken || !senderIgsid) {
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
  const cleanSenderId = String(senderIgsid || '').replace(/^instagram:\s*/i, '').trim();

  if (accessToken && cleanSenderId) {
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
    } catch (deliveryErr) {
      deliveryError = deliveryErr;
      console.error('INSTAGRAM_OUTBOUND_DELIVERY_ERROR', deliveryErr?.code, deliveryErr?.message);
      await recordInstagramAssistantDeliveryFailure({
        database,
        tenantId,
        messageId: persisted.message?.id,
        error: deliveryErr,
      });
    } finally {
      sendInstagramTypingOff({
        recipientId: cleanSenderId,
        accessToken,
        instagramAccountId: accountId,
        pageId: accountId,
        instagramUserId,
        authMode,
        http,
      }).catch(() => {});
    }
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
    if (accessToken && recipientIgsid) {
      try {
        await sendInstagramTypingIndicator({
          recipientId: recipientIgsid,
          accessToken,
          instagramAccountId: accountId,
          pageId: accountId,
          instagramUserId,
          authMode,
          http,
        });
      } catch (typingErr) {
        console.warn('INSTAGRAM_TYPING_INDICATOR_NON_BLOCKING_WARN', typingErr?.message);
      }
    }

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
      });
    }

    const formattedResponse = formatInstagramDmResponse(rawAiResponseText);
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

    if (!accessToken || !recipientIgsid) {
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
    const cleanRecipient = String(recipientIgsid || '').replace(/^instagram:\s*/i, '').trim();

    if (accessToken && cleanRecipient) {
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
      } catch (deliveryErr) {
        deliveryError = deliveryErr;
        console.error('INSTAGRAM_OUTBOUND_DELIVERY_ERROR', deliveryErr?.code, deliveryErr?.message);
        await recordInstagramAssistantDeliveryFailure({
          database: client,
          tenantId,
          messageId: persisted.message?.id,
          error: deliveryErr,
        });
      } finally {
        sendInstagramTypingOff({
          recipientId: cleanRecipient,
          accessToken,
          instagramAccountId: accountId,
          pageId: accountId,
          instagramUserId,
          authMode,
          http,
        }).catch(() => {});
      }
    }

    // Trigger high-intent qualification and silent internal notification asynchronously
    evaluateAndProcessHighIntentLead({
      tenantId,
      conversationId,
      database: client,
      httpClient: http,
    }).catch((err) => console.warn('HIGH_INTENT_LEAD_EVALUATION_NON_BLOCKING_WARN', err?.message));

    return {
      delivered: !deliveryError && Boolean(deliveryResult),
      deliveryError: deliveryError?.message || null,
      responseText: formattedResponse,
      deliveryResult,
      assistantMessageId: persisted.message?.id || null,
    };

  } finally {
    if (shouldRelease && typeof client?.release === 'function') {
      client.release();
    }
  }
}


