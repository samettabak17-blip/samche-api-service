import crypto from 'node:crypto';
import pool from '../config/db.js';
import {
  deliverWhatsAppTemplate,
  deliverWhatsAppText,
  safeProviderDiagnostic,
  WhatsAppDeliveryError,
} from './whatsapp-delivery-service.js';
import { normalizeWhatsAppExternalId } from './whatsapp-channel-ownership-service.js';
import { resolveWhatsAppSenderPhoneNumberId } from './whatsapp-credential-resolution-service.js';

export class HighIntentLeadError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'HighIntentLeadError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Common Turkish/English intent patterns for high-intent appointment / consultation / callback requests.
 * Evaluates semantic and keyword triggers without hardcoding specific names.
 */
const CONSULTATION_SIGNAL_PATTERNS = [
  /(?:^|[\s\p{P}])(?:randevu\w*|görüşme\w*|gorusme\w*|toplantı\w*|toplanti\w*|konuş\w*|konus\w*|görüş\w*|gorus\w*|arayabilir\s+misiniz|arayın|ararmısınız|iletişim\s+bilgilerinizi|konuşmak\s+istiyorum|görüşmek\s+istiyorum)(?:$|[\s\p{P}])/iu,
  /(?:^|[\s\p{P}])(?:appointment\w*|consultation\w*|call\s+me|callback\w*|meeting\w*|schedule\w*|discuss\s+services|contact\s+number)(?:$|[\s\p{P}])/iu,
  /(?:ile\s+görüş|ile\s+konuş|ile\s+irtibat|ile\s+randevu|sizinle\s+görüş|sizinle\s+konuş)/iu,
  /(?:danışmanla|yetkiliyle|kurucuyla|sahibiyle)\s+(?:görüş|konuş)/iu,
];

const PHONE_EXTRACTION_REGEX = /\+?\d(?:[\d().\s-]{5,20}\d)/;

const CONCRETE_BUSINESS_REQUIREMENT_PATTERNS = [
  /(?:şirket\w*\s+kur|şirket\w*\s+aç|firma\w*\s+kur|kurulum\w*\s+yap|lisans\w*\s+al|free\s*zone|mainland)/iu,
  /(?:e-ticaret|online\s+satış|danışmanlık|yazılım|saas|teknoloji|pazarlama|ithalat|ihracat|ticaret|gayrimenkul|turizm|restoran|ajans|lojistik|inşaat|finans|kripto|holding)/iu,
  /(?:faaliyet\s+alan|sektör|hizmet|banka\s+hesab|vize\w*\s+al|oturum\w*\s+vize)/iu,
];

/**
 * Checks if a message or conversation contains high-intent appointment / consultation signals.
 */
export function hasHighIntentAppointmentSignals(text = '') {
  if (typeof text !== 'string') return false;
  return CONSULTATION_SIGNAL_PATTERNS.some((p) => p.test(text)) || CONCRETE_BUSINESS_REQUIREMENT_PATTERNS.some((p) => p.test(text));
}

/**
 * Checks if customer has articulated a concrete business requirement beyond a generic meeting request.
 */
export function hasConcreteBusinessRequirement(text = '') {
  if (typeof text !== 'string') return false;
  return CONCRETE_BUSINESS_REQUIREMENT_PATTERNS.some((p) => p.test(text))
    || /(?:ikisi\s+de\s+olabilir|ikiside\s+olabilir|her\s+ikisi|hem\s+şirket\s+hem\s+oturum|henüz\s+karar\s+vermedim|karar\s+vermedim|netleşmedi)/iu.test(text);
}

/**
 * Extracts phone numbers from text safely.
 */
export function extractPhoneNumberFromText(text = '') {
  if (typeof text !== 'string') return null;
  const match = text.match(PHONE_EXTRACTION_REGEX);
  if (!match) return null;
  const digits = match[0].replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length >= 7 && digits.replace(/\D/g, '').length <= 15) {
    return match[0].trim();
  }
  return null;
}

/**
 * Extracts customer name from Turkish introduction patterns if present.
 */
export function extractCustomerNameFromText(text = '') {
  if (typeof text !== 'string') return null;
  const match = text.match(/(?:ben|adım|ismim|adim|isim)\s+([A-ZÇĞİÖŞÜa-zçğıöşü]{2,20}(?:\s+[A-ZÇĞİÖŞÜa-zçğıöşü]{2,20})?)/i);
  if (match?.[1]) return match[1].trim();
  return null;
}

/**
 * Extracts meeting time preference from customer text.
 */
export function extractMeetingTimePreference(text = '') {
  if (typeof text !== 'string') return null;

  // Match full day + time combinations: e.g. "yarın 15:00", "pazartesi 14:00", "bugün 18:00", "yarın Dubai saatiyle 15:00", "Salı saat 14:00 Dubai saati"
  const fullMatch = text.match(/(?:yarın|bugün|pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar|haftaya)(?:\s+(?:günü|öğleden\s+sonra|sabah|akşam|Dubai saatiyle|Dubai saati|Türkiye saatiyle|saat))*\s+(?:\d{1,2}[:.]\d{2})(?:\s+(?:Dubai saatiyle|Dubai saati|Türkiye saatiyle|TSI))?/i);
  if (fullMatch) return fullMatch[0].trim();

  // Match time with saat prefix: e.g. "saat 18:00", "saat 14"
  const saatMatch = text.match(/saat\s+\d{1,2}(?::\d{2})?(?:\s+(?:Dubai saatiyle|Dubai saati|Türkiye saatiyle|TSI))?/i);
  if (saatMatch) return saatMatch[0].trim();

  // Match standalone HH:MM time: e.g. "18:00", "14.00"
  const timeMatch = text.match(/\b\d{1,2}[:.]\d{2}\b(?:\s+(?:Dubai saatiyle|Dubai saati|Türkiye saatiyle|TSI))?/i);
  if (timeMatch) return timeMatch[0].trim();

  // Match days or dates without specific time: e.g. "yarın", "bugün", "pazartesi"
  const dayMatch = text.match(/(?:yarın|pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar|bugün|haftaya|\d{1,2}\s+(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık))/i);
  if (dayMatch) return dayMatch[0].trim();

  return null;
}

export function inferRequestedService(text = '') {
  if (/(?:ikisi\s+de\s+olabilir|ikiside\s+olabilir|her\s+ikisi|hem\s+şirket\s+hem\s+oturum|ikisi\s+de|ikiside)/iu.test(text)) {
    return 'Şirket Kuruluşu & Sponsorlu Oturum';
  }
  if (/free\s*zone/iu.test(text)) return 'Free Zone Şirket Kuruluşu';
  if (/mainland/iu.test(text)) return 'Mainland Şirket Kuruluşu';
  if (/(?:şirket|sirket|company|kurulum|incorporat)/iu.test(text)) return 'Şirket Kuruluşu';
  if (/(?:vize|visa|residency|oturum|ikamet)/iu.test(text)) return 'Vize / Oturum';
  if (/(?:banka|bank|hesap|account)/iu.test(text)) return 'Kurumsal Banka Hesabı';
  if (/(?:muhasebe|accounting|vergi|tax|vat|kdv)/iu.test(text)) return 'Muhasebe / Vergi';
  return 'Şirket Kuruluşu & Danışmanlık';
}

function isQualificationDetail(content = '') {
  const normalized = String(content).trim();
  if (normalized.length < 12) return false;
  const withoutPhone = normalized.replace(PHONE_EXTRACTION_REGEX, ' ');
  if (/^(?:whatsapp|telefon|phone|numara|numaram|iletişim|iletisim)[\p{L}\s:.-]*$/iu.test(withoutPhone.trim())) return false;
  const withoutAvailability = withoutPhone.replace(/(?:yarın|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar|bugün|haftaya|saat\s+\d{1,2}(?::\d{2})?|\d{1,2}[:.]\d{2}|dubai\s+saati)/giu, ' ');
  const withoutMeetingIntent = withoutAvailability.replace(/(?:randevu|görüşme|gorusme|toplantı|toplanti|görüşmek|gorusmek|görüşebilir|gorusabilir|appointment|consultation|meeting|call\s+me)/giu, ' ');
  const meaningful = withoutMeetingIntent.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return meaningful.length >= 10;
}

export function deriveInstagramLeadQualification({ customerMessages = [], contactName = null, contactPhone = null } = {}) {
  const contents = customerMessages
    .map((message) => typeof message === 'string' ? message : message?.content)
    .map((content) => String(content || '').trim())
    .filter(Boolean);
  const combined = contents.join('\n');
  const detailCandidates = contents.filter(isQualificationDetail);
  const structuredRequirement = detailCandidates.at(-1)?.slice(0, 240) || null;
  const phone = extractPhoneNumberFromText(combined) || contactPhone || null;
  const customerName = extractCustomerNameFromText(combined) || contactName || null;
  const requestedTime = extractMeetingTimePreference(combined);
  const timezone = /(?:dubai|bae|uae)(?:\s+saati)?/iu.test(combined)
    ? 'Asia/Dubai'
    : /(?:türkiye|turkiye)(?:\s+saati)?/iu.test(combined)
      ? 'Europe/Istanbul'
      : /(?:utc|gmt)/iu.test(combined) ? 'UTC' : null;
  const serviceRequested = inferRequestedService(combined);
  const hasHighIntent = hasHighIntentAppointmentSignals(combined);
  const missing = [];

  if (!phone) missing.push('CUSTOMER_PHONE');
  if (!requestedTime) missing.push('MEETING_AVAILABILITY');

  return {
    hasHighIntent,
    complete: hasHighIntent && Boolean(phone && requestedTime),
    customerName,
    phone,
    requestedTime,
    timezone,
    serviceRequested,
    businessActivity: structuredRequirement,
    structuredRequirement,
    customerMessageCount: contents.length,
    missing,
    notificationLlmCalls: 0,
    notificationAiTokens: 0,
  };
}

/**
 * Extracts timezone from text if mentioned.
 */
export function extractTimezoneFromText(text = '') {
  if (typeof text !== 'string') return null;
  const match = text.match(/(?:dubai\s+saati(?:yle)?|türkiye\s+saati(?:yle)?|tr\s+saati(?:yle)?|gmt\+[0-9]+|utc\+[0-9]+)/i);
  if (match) return match[0].trim();
  return null;
}

/**
 * Extracts business activity or sector from customer conversation text.
 */
export function extractBusinessActivity(text = '') {
  if (typeof text !== 'string') return null;
  const match = text.match(/(?:e-ticaret|online\s+satış|danışmanlık|yazılım|saas|teknoloji|pazarlama|ithalat|ihracat|ticaret|gayrimenkul|turizm|restoran|ajans|lojistik|inşaat|finans|kripto|holding)/i);
  if (match) return match[0].trim();
  return null;
}

/**
 * Extracts jurisdiction preference (Free Zone / Mainland) from text.
 */
export function extractJurisdictionPreference(text = '') {
  if (typeof text !== 'string') return null;
  if (/mainland/i.test(text)) return 'Mainland';
  if (/free\s*zone/i.test(text)) return 'Free Zone';
  return null;
}

/**
 * Extracts shareholder or partner count from text.
 * Handles updates and corrections (e.g. "aslında tek ortak", "2 ortak").
 */
export function extractShareholderCount(text = '') {
  if (typeof text !== 'string') return null;
  if (/(?:tek\s+ortak|tek\s+başım|tek\s+kişi|yalnız\s+ol|aslında\s+1\s+ortak|aslında\s+tek)/i.test(text)) {
    return '1 ortak (Tek ortak)';
  }
  const match = text.match(/(?:^|[\s\p{P}])(\d+)\s*(?:ortak|kurucu|hissedar)(?:$|[\s\p{P}])/iu);
  if (match?.[1]) {
    return `${match[1]} ortak`;
  }
  return null;
}

/**
 * Extracts visa count if explicitly mentioned by the customer.
 */
export function extractVisaCount(text = '') {
  if (typeof text !== 'string') return null;
  const match = text.match(/(\d+)\s*(?:adet\s*)?(?:vize|kişi|oturum)/i);
  if (match?.[1]) return `${match[1]} kişi`;
  return null;
}

/**
 * Formats the structured internal WhatsApp notification message deterministically
 * from persisted structured metadata without any LLM or AI summarization calls.
 */
export function formatInternalWhatsAppLeadNotification({
  customerName = null,
  instagramUsername = null,
  phone = null,
  requestedService = null,
  serviceRequested = null,
  activity = null,
  businessActivity = null,
  requirement = null,
  structuredRequirement = null,
  summary = null,
  timeline = null,
  requestedDate = null,
  requestedTime = null,
  timezone = null,
  source = 'INSTAGRAM',
  conversationId = null,
  dashboardDeepLink = null,
  dashboardUrl = null,
  isUpdate = false,
} = {}) {
  const cleanName = customerName && !String(customerName).startsWith('instagram:') ? String(customerName).trim() : null;
  const cleanIg = instagramUsername ? `@${String(instagramUsername).replace(/^@/, '').trim()}` : null;
  const cleanPhone = phone ? String(phone).trim() : null;
  const cleanKonu = serviceRequested || requestedService || 'Şirket Kuruluşu & Danışmanlık';
  const cleanFaaliyet = businessActivity || activity ? String(businessActivity || activity).trim() : null;
  const cleanIstek = structuredRequirement || requirement || summary || null;
  const cleanTimeline = timeline ? String(timeline).trim() : null;
  const cleanDate = requestedDate ? String(requestedDate).trim() : null;
  const cleanTime = requestedTime ? String(requestedTime).trim() : null;
  const cleanTz = timezone ? String(timezone).trim() : null;
  const cleanSource = source ? String(source).trim() : 'INSTAGRAM';

  const parts = [
    `YENİ INSTAGRAM LEAD${isUpdate ? ' (GÜNCELLEME):' : ':'}`,
    cleanName ? `Müşteri: ${cleanName}` : null,
    cleanIg ? `IG: ${cleanIg}` : null,
    cleanPhone ? `Tel: ${cleanPhone}` : null,
    cleanKonu ? `Konu: ${cleanKonu}` : null,
    cleanFaaliyet ? `Faaliyet: ${cleanFaaliyet}` : (cleanIstek ? `Talep: ${cleanIstek}` : null),
    cleanTime || cleanTimeline ? `Görüşme: ${cleanTime || cleanTimeline}${cleanTz ? ` (${cleanTz})` : ''}` : null,
    cleanSource ? `Kaynak: ${cleanSource}` : null,
  ].filter(Boolean);

  return parts
    .join(' | ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 1000)
    .trim();
}


/**
 * Checks if a string looks like a numeric or synthetic provider ID.
 */
export function isInstagramProviderId(val) {
  if (!val || typeof val !== 'string') return true;
  const clean = val.replace(/^instagram:\s*/i, '').replace(/^@/, '').trim();
  if (!clean) return true;
  if (/^\d+$/.test(clean)) return true;
  if (clean.startsWith('ig_synth_')) return true;
  if (/^[a-f0-9]{32,64}$/i.test(clean)) return true;
  if (clean.toLowerCase() === 'instagram conversation' || clean.toLowerCase() === 'instagram user') return true;
  return false;
}

/**
 * Resolves generic multi-tenant qualified lead CTA configuration.
 * Fully tenant-configurable: destination, provider, contact_name, button_label, dm_response_text.
 */
export function resolveQualifiedLeadCtaConfig({ integrationConfig = {}, env = process.env } = {}) {
  const ctaSection = integrationConfig?.qualified_lead_contact_cta || {};
  const enabled = ctaSection.enabled !== false && integrationConfig?.lead_notification_enabled !== false;
  const provider = String(ctaSection.provider || 'WHATSAPP').toUpperCase();
  const destination = ctaSection.destination ||
    integrationConfig?.lead_whatsapp_destination ||
    integrationConfig?.lead_notification_whatsapp ||
    integrationConfig?.lead_notification_phone ||
    env?.QUALIFIED_LEAD_CTA_DESTINATION ||
    env?.LEAD_NOTIFICATION_WHATSAPP ||
    '+971527288586';

  const contactName = ctaSection.contact_name !== undefined ? ctaSection.contact_name : 'Samed Bey';
  const buttonLabel = ctaSection.button_label || "WhatsApp'tan İletişime Geç";
  const dmResponseText = ctaSection.dm_response_text ||
    "Bilgilerinizi aldım. Aşağıdaki bağlantı üzerinden WhatsApp'tan doğrudan iletişime geçebilirsiniz:";

  return {
    enabled,
    provider,
    destination,
    contactName,
    buttonLabel,
    dmResponseText,
  };
}

/**
 * Builds deterministic WhatsApp prefilled message from persisted structured lead data.
 * ZERO LLM invocation. No internal IDs, database IDs, WAMIDs, or tokens.
 * Only verified persisted fields that actually exist are included; unknown fields are omitted.
 */
export function buildQualifiedLeadWhatsAppPrefilledMessage({
  customerName = null,
  instagramUsername = null,
  phone = null,
  requirement = null,
  serviceRequested = null,
  activity = null,
  requestedTime = null,
  timezone = null,
  contactName = 'Samed Bey',
} = {}) {
  const cleanContactName = typeof contactName === 'string' && contactName.trim() ? contactName.trim() : null;
  const greeting = cleanContactName
    ? `Merhaba ${cleanContactName}, Instagram üzerinden görüşme talebi oluşturdum.`
    : 'Merhaba, Instagram üzerinden görüşme talebi oluşturdum.';

  const lines = [];

  // 1. Ad Soyad (only if known & valid)
  const cleanName = typeof customerName === 'string' && customerName.trim() && !isInstagramProviderId(customerName)
    ? customerName.trim()
    : null;
  if (cleanName) {
    lines.push(`Ad Soyad: ${cleanName}`);
  }

  // 2. Konu
  let topic = null;
  if (requirement && typeof requirement === 'string' && requirement.trim() && !requirement.includes('undefined')) {
    topic = requirement.trim();
  } else if (activity && typeof activity === 'string' && activity.trim() && !activity.includes('Henüz karar') && !activity.includes('Netleşmedi')) {
    topic = `Dubai'de ${activity.trim()} şirketi kurulumu`;
  } else if (serviceRequested && typeof serviceRequested === 'string' && serviceRequested.trim()) {
    topic = serviceRequested.trim();
  } else {
    topic = 'Dubai Şirket Kuruluşu & Danışmanlık';
  }
  lines.push(`Konu: ${topic}`);

  // 3. Telefon (only if known)
  const cleanPhone = typeof phone === 'string' && phone.trim() ? phone.trim() : null;
  if (cleanPhone) {
    lines.push(`Telefon: ${cleanPhone}`);
  }

  // 4. Görüşme (only if known)
  const cleanTime = typeof requestedTime === 'string' && requestedTime.trim() ? requestedTime.trim() : null;
  if (cleanTime) {
    lines.push(`Görüşme: ${cleanTime}`);
  }

  // 5. Instagram (only if valid username exists, not provider ID)
  let cleanIg = null;
  if (typeof instagramUsername === 'string' && instagramUsername.trim()) {
    const rawIg = instagramUsername.replace(/^instagram:\s*/i, '').trim();
    if (!isInstagramProviderId(rawIg)) {
      cleanIg = rawIg.startsWith('@') ? rawIg : `@${rawIg}`;
    }
  }
  if (cleanIg) {
    lines.push(`Instagram: ${cleanIg}`);
  }

  const closing = 'Görüşme talebim hakkında sizinle iletişime geçmek istiyorum.';

  const parts = [greeting];
  if (lines.length > 0) {
    parts.push('');
    parts.push(...lines);
  }
  parts.push('');
  parts.push(closing);

  return parts.join('\n');
}

/**
 * Generates the WhatsApp deep link URL with percent-encoded prefilled message.
 */
export function generateCustomerInitiatedWhatsAppCtaUrl({ destination, prefilledText }) {
  if (!destination) return null;
  const digits = String(destination).replace(/\D/g, '');
  if (!digits) return null;
  const encodedText = encodeURIComponent(String(prefilledText || '').trim());
  return `https://wa.me/${digits}?text=${encodedText}`;
}

/**
 * Computes durable hash of lead qualification fields to prevent notification spam.
 */
export function computeLeadNotificationDedupeHash({ name, phone, service, requestedTime }) {
  const payload = `${String(name || '').trim().toLowerCase()}|${String(phone || '').replace(/\D/g, '')}|${String(service || '').trim().toLowerCase()}|${String(requestedTime || '').trim().toLowerCase()}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Preserved for backward compatibility without sending server-side messages during qualification.
 */
export async function sendSilentInternalWhatsAppLeadNotification({
  tenantId,
  conversationId,
  leadDetails,
  database = pool,
  env = process.env,
  httpClient,
}) {
  // Task 9: Replaced server-side WhatsApp lead notification with customer-initiated WhatsApp contact CTA.
  // No outbound WhatsApp Cloud API messages are sent for the qualified lead workflow.
  return {
    skipped: true,
    reason: 'REPLACED_WITH_CUSTOMER_INITIATED_WHATSAPP_CTA',
  };
}

/**
 * Evaluates conversation messages for high-intent qualification, persists structured lead & contact data,
 * creates exactly ONE PENDING consultation in crm_consultations, and generates the customer-initiated WhatsApp CTA.
 */
export async function evaluateAndProcessHighIntentLead({
  tenantId,
  conversationId,
  database = pool,
  env = process.env,
  httpClient,
  ctaConfigOverride = null,
}) {
  const isDedicatedClient = typeof database?.connect === 'function';
  const client = isDedicatedClient ? await database.connect() : database;
  try {
    const convRes = await client.query(
      `SELECT c.id, c.tenant_id, c.channel_id, c.customer_external_id, c.contact_id,
              tc.channel_type,
              contact.display_name AS contact_name, contact.phone AS contact_phone
         FROM conversations c
         JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
         LEFT JOIN crm_contacts contact ON contact.id = c.contact_id AND contact.tenant_id = c.tenant_id
        WHERE c.id = $1 AND c.tenant_id = $2`,
      [conversationId, tenantId]
    );

    if (convRes.rowCount < 1) return { qualified: false, reason: 'CONVERSATION_NOT_FOUND' };
    const conv = convRes.rows[0];

    const messagesRes = await client.query(
      `SELECT id, sender_type, content, created_at
         FROM conversation_messages
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY created_at ASC, id ASC`,
      [tenantId, conversationId]
    );

    const messages = messagesRes.rows || [];
    const customerMessages = messages.filter((m) => m.sender_type === 'CUSTOMER');
    const customerTextCombined = customerMessages.map((m) => m.content || '').join('\n');

    const hasInitialSignal = hasHighIntentAppointmentSignals(customerTextCombined);
    if (!hasInitialSignal) {
      return { qualified: false, reason: 'NO_HIGH_INTENT_SIGNALS' };
    }

    const hasRequirement = hasConcreteBusinessRequirement(customerTextCombined);
    const phone = extractPhoneNumberFromText(customerTextCombined) || conv.contact_phone || null;
    const requestedTime = extractMeetingTimePreference(customerTextCombined);
    const timezone = extractTimezoneFromText(customerTextCombined) || 'Dubai / GMT+4';
    const activity = extractBusinessActivity(customerTextCombined);
    const jurisdiction = extractJurisdictionPreference(customerTextCombined) || 'Free Zone';
    const visaCount = extractVisaCount(customerTextCombined);
    const extractedName = extractCustomerNameFromText(customerTextCombined);

    // Format customer name & Instagram username
    let rawDisplayName = conv.contact_name || '';
    let customerName = extractedName || null;
    let igUsername = null;
    if (rawDisplayName) {
      const parenMatch = rawDisplayName.match(/^([^(]+?)\s*\((@[A-Za-z0-9._]+)\)$/);
      if (parenMatch) {
        if (!customerName && !isInstagramProviderId(parenMatch[1].trim())) {
          customerName = parenMatch[1].trim();
        }
        igUsername = parenMatch[2].replace(/^@/, '').trim();
      } else if (rawDisplayName.startsWith('@')) {
        const u = rawDisplayName.slice(1).trim();
        if (!isInstagramProviderId(u)) igUsername = u;
      } else if (!customerName && !isInstagramProviderId(rawDisplayName)) {
        customerName = rawDisplayName.trim();
      }
    }

    if (!igUsername && typeof conv.customer_external_id === 'string') {
      const rawExternal = conv.customer_external_id.replace(/^instagram:\s*/i, '').replace(/^@/, '').trim();
      if (!isInstagramProviderId(rawExternal)) {
        igUsername = rawExternal;
      }
    }

    const isAd = conv.channel_type === 'INSTAGRAM_AD' || /ad|campaign|sponsor/i.test(String(conv.customer_external_id || ''));
    const source = isAd ? 'Instagram Ad' : 'Instagram DM';

    // Service topic determination
    let serviceRequested = jurisdiction === 'Mainland'
      ? 'Mainland Şirket Kuruluşu'
      : activity
      ? `${activity.charAt(0).toUpperCase() + activity.slice(1)} Şirket Kuruluşu`
      : 'Free Zone Şirket Kuruluşu';

    if (/vize|residency|ikamet/i.test(customerTextCombined)) {
      serviceRequested = 'Vize & Oturum Danışmanlığı';
    } else if (/banka|hesap|bank/i.test(customerTextCombined)) {
      serviceRequested = 'Banka Hesabı Açılışı';
    }

    // Update crm_contacts with phone/name if found
    if (conv.contact_id && (phone || customerName)) {
      await client.query(
        `UPDATE crm_contacts
            SET phone = COALESCE($1, phone),
                display_name = COALESCE($2, display_name),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $3 AND tenant_id = $4`,
        [phone, customerName, conv.contact_id, tenantId]
      );
    }

    const leadRes = await client.query(
      `SELECT id FROM crm_leads WHERE tenant_id = $1 AND conversation_id = $2 LIMIT 1`,
      [tenantId, conversationId]
    );
    const leadId = leadRes.rows[0]?.id || null;

    const isFullyQualified = Boolean(hasInitialSignal && hasRequirement && phone && requestedTime);

    if (!isFullyQualified) {
      if (leadId) {
        await client.query(
          `UPDATE crm_leads
              SET intent = 'INQUIRY',
                  temperature = 'WARM',
                  lead_score = 50,
                  service_interest = $1,
                  last_activity_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND tenant_id = $3`,
          [hasRequirement ? serviceRequested : 'Genel Danışmanlık', leadId, tenantId]
        );
      }
      const incompleteReason = !hasRequirement
        ? 'QUALIFICATION_INCOMPLETE_AWAITING_REQUIREMENT'
        : !phone
        ? 'QUALIFICATION_INCOMPLETE_AWAITING_PHONE'
        : 'QUALIFICATION_INCOMPLETE_AWAITING_TIME';

      const missingFields = [];
      if (!hasRequirement) missingFields.push('requirement');
      if (!phone) missingFields.push('phone');
      if (!requestedTime) missingFields.push('time');

      return {
        qualified: false,
        reason: incompleteReason,
        missing: missingFields,
        partialLeadId: leadId,
        notificationLlmCalls: 0,
        notificationAiTokens: 0,
      };
    }
    if (leadId) {
      const qualifiedStage = await client.query(
        `SELECT id FROM crm_pipeline_stages
          WHERE tenant_id = $1 AND stage_key = 'QUALIFIED'
          LIMIT 1`,
        [tenantId]
      );
      await client.query(
        `UPDATE crm_leads
            SET intent = 'APPOINTMENT_REQUEST',
                temperature = 'HOT',
                lead_score = 90,
                service_interest = $1,
                timeline = $2,
                pipeline_stage_id = COALESCE($3, pipeline_stage_id),
                last_activity_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $4 AND tenant_id = $5`,
        [serviceRequested, requestedTime, qualifiedStage.rows[0]?.id || null, leadId, tenantId]
      );

      await client.query(
        `INSERT INTO crm_activities
          (tenant_id, lead_id, conversation_id, event_type, metadata)
         SELECT $1, $2, $3, 'AI_QUALIFICATION', $4::jsonb
          WHERE NOT EXISTS (
            SELECT 1 FROM crm_activities
             WHERE tenant_id = $1
               AND lead_id = $2
               AND conversation_id = $3
               AND event_type = 'AI_QUALIFICATION'
               AND metadata->>'event' = 'CONSULTATION_REQUEST_PENDING'
          )
         RETURNING *`,
        [tenantId, leadId, conversationId, JSON.stringify({
          event: 'CONSULTATION_REQUEST_PENDING',
          status: 'PENDING',
          requested_time: requestedTime,
          timezone,
          service_requested: serviceRequested,
        })]
      );
    }

    const requirementText = activity
      ? `Dubai'de ${activity} şirketi kurulumu`
      : `Dubai'de şirket kurulumu ve danışmanlık görüşmesi`;

    const summary = `Instagram üzerinden ${serviceRequested.toLowerCase()} randevu talebi. ${activity ? `Faaliyet: ${activity}. ` : ''}Uygun zaman: ${requestedTime}.`;

    const leadDetails = {
      customerName,
      instagramUsername: igUsername,
      phone,
      requirement: requirementText,
      serviceRequested,
      requestedService: serviceRequested,
      activity,
      businessActivity: activity,
      structuredRequirement: requirementText,
      jurisdictionPreference: jurisdiction,
      visaCount,
      summary,
      requestedTime,
      timezone,
      source,
      leadId,
      conversationId,
    };

    // Resolve generic tenant CTA configuration
    let integrationConfig = {};
    if (ctaConfigOverride) {
      integrationConfig = ctaConfigOverride;
    } else {
      const igRes = await client.query(
        `SELECT ci.config AS ig_config
           FROM tenant_channels tc
           JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND ci.integration_type = 'INSTAGRAM'
          WHERE tc.tenant_id = $1 AND tc.channel_type = 'INSTAGRAM' AND tc.status = 'active'
          LIMIT 1`,
        [tenantId]
      ).catch(() => ({ rows: [] }));
      integrationConfig = igRes.rows?.[0]?.ig_config || {};
    }

    const ctaConfig = resolveQualifiedLeadCtaConfig({ integrationConfig, env });

    // Generate deterministic WhatsApp prefilled message and customer CTA URL
    const prefilledText = buildQualifiedLeadWhatsAppPrefilledMessage({
      customerName,
      instagramUsername: igUsername,
      phone,
      requirement: requirementText,
      serviceRequested,
      activity,
      requestedTime,
      timezone,
      contactName: ctaConfig.contactName,
    });

    const ctaUrl = generateCustomerInitiatedWhatsAppCtaUrl({
      destination: ctaConfig.destination,
      prefilledText,
    });

    const ctaPayload = {
      provider: ctaConfig.provider,
      destination: ctaConfig.destination,
      button_label: ctaConfig.buttonLabel,
      dm_response_text: ctaConfig.dmResponseText,
      prefilled_text: prefilledText,
      url: ctaUrl,
    };

    // Insert or update EXACTLY ONE PENDING consultation for this conversation
    const consultationRes = await client.query(
      `INSERT INTO crm_consultations
        (tenant_id, lead_id, contact_id, conversation_id, channel_type, status,
         customer_name, instagram_username, phone, service_requested, activity,
         requested_time, timezone, cta_destination, cta_url, cta_prefilled_text, cta_payload)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
       ON CONFLICT (tenant_id, conversation_id)
       DO UPDATE SET
         customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), crm_consultations.customer_name),
         phone = COALESCE(NULLIF(EXCLUDED.phone, ''), crm_consultations.phone),
         service_requested = COALESCE(NULLIF(EXCLUDED.service_requested, ''), crm_consultations.service_requested),
         activity = COALESCE(NULLIF(EXCLUDED.activity, ''), crm_consultations.activity),
         requested_time = COALESCE(NULLIF(EXCLUDED.requested_time, ''), crm_consultations.requested_time),
         cta_destination = EXCLUDED.cta_destination,
         cta_url = EXCLUDED.cta_url,
         cta_prefilled_text = EXCLUDED.cta_prefilled_text,
         cta_payload = EXCLUDED.cta_payload,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        tenantId,
        leadId,
        conv.contact_id,
        conversationId,
        source,
        customerName,
        igUsername,
        phone,
        serviceRequested,
        activity,
        requestedTime,
        timezone,
        ctaConfig.destination,
        ctaUrl,
        prefilledText,
        JSON.stringify(ctaPayload),
      ]
    );

    const consultation = consultationRes.rows?.[0] || null;

    // Record activity in CRM
    if (leadId) {
      await client.query(
        `INSERT INTO crm_activities (tenant_id, lead_id, conversation_id, event_type, metadata)
         VALUES ($1, $2, $3, 'AI_QUALIFICATION', $4::jsonb)
         ON CONFLICT DO NOTHING`,
        [tenantId, leadId, conversationId, JSON.stringify({ consultation_id: consultation?.id, status: 'PENDING', cta_destination: ctaConfig.destination })]
      ).catch(() => {});
    }

    const currentHash = computeLeadNotificationDedupeHash({
      name: customerName,
      phone,
      service: serviceRequested,
      requestedTime,
    });

    if (leadId) {
      await client.query(
        `INSERT INTO crm_lead_analyses
          (tenant_id, lead_id, conversation_id, analysis_hash, analyzed_customer_message_count, signals, summary, provider, model)
         VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6, 'HIGH_INTENT_DETECTOR', 'deterministic-cta-v1')
         ON CONFLICT (tenant_id, lead_id, analysis_hash)
         DO UPDATE SET signals = EXCLUDED.signals, summary = EXCLUDED.summary, analyzed_at = CURRENT_TIMESTAMP`,
        [
          tenantId,
          leadId,
          conversationId,
          currentHash,
          JSON.stringify({
            last_notified_hash: currentHash,
            cta_url: ctaUrl,
            consultation_id: consultation?.id,
            cta_delivered: Boolean(consultation?.cta_delivered_at),
          }),
          summary,
        ]
      ).catch(() => {});
    }

    return {
      qualified: true,
      leadDetails,
      consultation,
      consultationStatus: 'PENDING',
      notificationLlmCalls: 0,
      notificationAiTokens: 0,
      ctaUrl,
      prefilledText,
      dmResponseText: ctaConfig.dmResponseText,
      alreadyDelivered: Boolean(consultation?.cta_delivered_at),
    };
  } finally {
    if (isDedicatedClient && typeof client?.release === 'function') {
      client.release();
    }
  }
}

/**
 * Authoritatively reconstructs lead qualification details for a conversation from persisted records.
 * Prioritizes persisted qualification / consultation records over arbitrary caller inputs.
 * Zero hardcoded fallback meeting times. Zero LLM calls.
 */
export async function reconstructLeadDetailsFromConversation({
  tenantId,
  conversationId,
  database = pool,
}) {
  const isDedicatedClient = typeof database?.connect === 'function';
  const client = isDedicatedClient ? await database.connect() : database;
  try {
    const convRes = await client.query(
      `SELECT conv.id, conv.tenant_id, conv.customer_external_id, conv.contact_id,
              c.display_name, c.phone
         FROM conversations conv
         LEFT JOIN crm_contacts c ON c.id = conv.contact_id
        WHERE conv.tenant_id = $1 AND conv.id = $2
        LIMIT 1`,
      [tenantId, conversationId]
    );
    const conv = convRes.rows[0];
    if (!conv) return null;

    const consultRes = await client.query(
      `SELECT * FROM crm_consultations
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId, conversationId]
    ).catch(() => ({ rows: [] }));
    const consultation = consultRes.rows[0] || null;

    const leadRes = await client.query(
      `SELECT l.id AS lead_id, l.service_interest, l.timeline,
              act.metadata AS activity_metadata
         FROM crm_leads l
         LEFT JOIN crm_activities act ON act.lead_id = l.id AND act.tenant_id = l.tenant_id AND act.event_type = 'AI_QUALIFICATION'
        WHERE l.tenant_id = $1 AND (l.conversation_id = $2 OR ($3::uuid IS NOT NULL AND l.contact_id = $3))
        ORDER BY l.created_at DESC
        LIMIT 1`,
      [tenantId, conversationId, conv.contact_id || null]
    );
    const lead = leadRes.rows[0];

    const customerName = consultation?.customer_name
      || (conv.display_name && !conv.display_name.startsWith('instagram:') ? conv.display_name : null)
      || 'Instagram User';

    const phone = consultation?.phone
      || conv.phone
      || null;

    const requestedTime = consultation?.requested_time
      || lead?.timeline
      || lead?.activity_metadata?.requested_time
      || null;

    const serviceRequested = consultation?.service_requested
      || lead?.service_interest
      || 'Free Zone Şirket Kuruluşu';

    const cleanIg = conv.customer_external_id ? conv.customer_external_id.replace(/^instagram:/, '') : null;

    return {
      leadId: lead?.lead_id || null,
      consultationId: consultation?.id || null,
      customerName,
      instagramUsername: cleanIg,
      phone,
      serviceRequested,
      requestedService: serviceRequested,
      requestedTime,
      timeline: requestedTime,
      timezone: consultation?.timezone || lead?.activity_metadata?.timezone || 'Dubai / GMT+4',
      activity: consultation?.activity || null,
      summary: `${serviceRequested}: ${consultation?.activity || 'Görüşme talebi'}`,
      source: 'INSTAGRAM',
      conversationId,
    };
  } finally {
    if (isDedicatedClient && typeof client?.release === 'function') {
      client.release();
    }
  }
}



