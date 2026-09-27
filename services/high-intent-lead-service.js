import crypto from 'node:crypto';
import pool from '../config/db.js';
import { deliverWhatsAppTemplate } from './whatsapp-delivery-service.js';
import { normalizeWhatsAppExternalId } from './whatsapp-channel-ownership-service.js';

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
const APPOINTMENT_INTENT_PATTERNS = [
  /(?:^|[\s\p{P}])(?:randevu|görüşme|gorusme|toplantı|toplanti|konuşalım|konusalim|görüşelim|goruselim|görüşebilir|gorusabilir|arayabilir\s+misiniz|arayın|ararmısınız|iletişim\s+bilgilerinizi|görüşmek|konuşmak)(?:$|[\s\p{P}])/iu,
  /(?:^|[\s\p{P}])(?:appointment|consultation|call\s+me|callback|meeting|schedule|discuss\s+services|contact\s+number)(?:$|[\s\p{P}])/iu,
  /(?:ile\s+görüşmek|ile\s+konuşmak|ile\s+irtibat|ile\s+randevu|ile\s+görüşebilir|sizinle\s+görüş)/iu,
  /(?:danışmanla|yetkiliyle|kurucuyla|sahibiyle)\s+(?:görüşmek|konuşmak)/iu,
  /(?:şirket\s+kurmak\s+istiyorum|kurulum\s+yapmak\s+istiyorum|başlamak\s+istiyorum|teklif\s+almak\s+istiyorum)/iu,
];


const PHONE_EXTRACTION_REGEX = /\+?\d(?:[\d().\s-]{5,20}\d)/;

/**
 * Checks if a message or conversation contains high-intent appointment / consultation signals.
 */
export function hasHighIntentAppointmentSignals(text = '') {
  if (typeof text !== 'string') return false;
  return APPOINTMENT_INTENT_PATTERNS.some((pattern) => pattern.test(text));
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
  const match = text.match(/(?:(?:yarın|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar|bugün|haftaya)(?:\s+saat\s+\d{1,2}(?::\d{2})?)?(?:\s+(?:dubai|türkiye|turkiye|utc|gmt)(?:\s+saati)?)?|saat\s+\d{1,2}(?::\d{2})?|\d{1,2}\s+(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)|\d{1,2}[:.]\d{2})/i);
  if (match) return match[0].trim();
  return null;
}

function inferRequestedService(text = '') {
  if (/(?:şirket|sirket|company|free\s*zone|mainland|kurulum|incorporat)/iu.test(text)) return 'Şirket Kuruluşu';
  if (/(?:vize|visa|residency|oturum|ikamet)/iu.test(text)) return 'Vize / Oturum';
  if (/(?:banka|bank|hesap|account)/iu.test(text)) return 'Kurumsal Banka Hesabı';
  if (/(?:muhasebe|accounting|vergi|tax|vat|kdv)/iu.test(text)) return 'Muhasebe / Vergi';
  return null;
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
  const detailCandidates = contents.slice(1).filter(isQualificationDetail);
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

  if (!serviceRequested) missing.push('REQUESTED_SERVICE');
  if (!structuredRequirement) missing.push('CONCRETE_REQUIREMENT');
  if (!phone) missing.push('CUSTOMER_PHONE');
  if (!requestedTime) missing.push('MEETING_AVAILABILITY');

  return {
    hasHighIntent,
    complete: hasHighIntent && contents.length >= 2 && missing.length === 0,
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
 * Formats the concise structured internal WhatsApp notification message.
 */
export function formatInternalWhatsAppLeadNotification({
  customerName = null,
  instagramUsername = null,
  phone = null,
  serviceRequested = null,
  summary = null,
  requestedTime = null,
  businessActivity = null,
  structuredRequirement = null,
  timeline = null,
  timezone = null,
  source = 'Instagram DM',
  dashboardDeepLink = null,
  isUpdate = false,
}) {
  const lines = [`YENİ INSTAGRAM LEAD${isUpdate ? ' — GÜNCELLEME' : ''}`, ''];
  if (customerName) lines.push(`Müşteri: ${customerName}`);
  if (instagramUsername) lines.push(`Instagram: @${instagramUsername.replace(/^@/, '')}`);
  if (phone) lines.push(`Telefon / WhatsApp: ${phone}`);
  if (serviceRequested) lines.push(`Konu: ${serviceRequested}`);
  if (businessActivity) lines.push(`Faaliyet: ${businessActivity}`);
  if (structuredRequirement || summary) lines.push(`İstediği: ${structuredRequirement || summary}`);
  if (timeline) lines.push(`Başlama zamanı: ${timeline}`);
  if (requestedTime) {
    lines.push('', 'Görüşme:', requestedTime);
    if (timezone) lines.push(timezone);
  }
  if (source) lines.push('', `Kaynak: ${source}`);

  if (dashboardDeepLink) {
    lines.push(`Dashboard: ${dashboardDeepLink}`);
  }

  return lines.join('\n');
}


/**
 * Computes durable hash of lead qualification fields to prevent notification spam.
 */
export function computeLeadNotificationDedupeHash({ name, phone, service, requestedTime }) {
  const payload = `${String(name || '').trim().toLowerCase()}|${String(phone || '').replace(/\D/g, '')}|${String(service || '').trim().toLowerCase()}|${String(requestedTime || '').trim().toLowerCase()}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Sends a silent internal WhatsApp lead notification to the tenant-configured destination.
 * Zero customer-facing side effects. AI mode stays active.
 */
export async function sendSilentInternalWhatsAppLeadNotification({
  tenantId,
  conversationId,
  leadDetails,
  database = pool,
  env = process.env,
  httpClient,
}) {
  const isDedicatedClient = typeof database?.connect === 'function';
  const client = isDedicatedClient ? await database.connect() : database;
  try {


    // 1. Resolve tenant's Instagram channel integration configuration for lead notification settings
    const igRes = await client.query(
      `SELECT ci.config AS ig_config
         FROM tenant_channels tc
         JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND ci.integration_type = 'INSTAGRAM'
        WHERE tc.tenant_id = $1 AND tc.channel_type = 'INSTAGRAM' AND tc.status = 'active'
        LIMIT 1`,
      [tenantId]
    );

    const igConfig = igRes.rows[0]?.ig_config || {};
    const notificationEnabled = igConfig.lead_notification_enabled !== false;
    const destinationPhone = igConfig.lead_notification_whatsapp ||
      igConfig.lead_notification_phone ||
      env.LEAD_NOTIFICATION_WHATSAPP ||
      null;

    if (!notificationEnabled || !destinationPhone) {
      return { skipped: true, reason: 'LEAD_NOTIFICATION_NOT_CONFIGURED' };
    }

    // 2. Resolve WhatsApp sender channel / phone number ID for this tenant
    const waRes = await client.query(
      `SELECT tc.external_channel_id, ci.config AS wa_config
         FROM tenant_channels tc
         JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND ci.integration_type = 'WHATSAPP'
        WHERE tc.tenant_id = $1 AND tc.channel_type = 'WHATSAPP' AND tc.status = 'active'
        LIMIT 1`,
      [tenantId]
    );

    const waChannel = waRes.rows[0];
    const rawPhoneNumberId = waChannel?.external_channel_id || env.WHATSAPP_PHONE_NUMBER_ID || env.META_PHONE_NUMBER_ID;
    let phoneNumberId = null;
    try {
      phoneNumberId = normalizeWhatsAppExternalId(rawPhoneNumberId);
    } catch {
      phoneNumberId = String(rawPhoneNumberId || '').replace(/[^0-9]/g, '');
    }

    if (!phoneNumberId) {
      return { skipped: true, reason: 'WHATSAPP_SENDER_NOT_CONFIGURED' };
    }

    const approvedTemplate = igConfig.lead_notification_template || waChannel?.wa_config?.lead_notification_template || null;
    if (
      !approvedTemplate
      || String(approvedTemplate.status || '').toUpperCase() !== 'APPROVED'
      || !approvedTemplate.name
      || !approvedTemplate.language_code
    ) {
      return { skipped: true, reason: 'WHATSAPP_APPROVED_TEMPLATE_REQUIRED' };
    }

    const currentHash = computeLeadNotificationDedupeHash({
      name: leadDetails.customerName,
      phone: leadDetails.phone,
      service: leadDetails.serviceRequested,
      requestedTime: leadDetails.requestedTime,
    });

    // 3. Check existing lead dedupe state in crm_lead_analyses
    const leadCheck = await client.query(
      `SELECT l.id AS lead_id, a.analysis_hash, a.signals
       FROM crm_leads l
         LEFT JOIN crm_lead_analyses a ON a.lead_id = l.id AND a.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.conversation_id = $2
          AND a.signals ? 'last_notified_hash'
        ORDER BY a.analyzed_at DESC
        LIMIT 1`,
      [tenantId, conversationId]
    );

    const existingLead = leadCheck.rows[0];
    const previousNotificationHash = existingLead?.signals?.last_notified_hash || null;

    if (previousNotificationHash === currentHash) {
      return { skipped: true, reason: 'DEDUPE_IDENTICAL_NOTIFICATION_ALREADY_SENT' };
    }

    const isUpdate = Boolean(previousNotificationHash && previousNotificationHash !== currentHash);

    const dashboardBase = env.DASHBOARD_URL || env.APP_BASE_URL || 'https://dashboard.samche.co';
    const deepLink = `${dashboardBase.replace(/\/+$/, '')}/${tenantId}/conversations/${conversationId}`;

    const notificationText = formatInternalWhatsAppLeadNotification({
      customerName: leadDetails.customerName,
      instagramUsername: leadDetails.instagramUsername,
      phone: leadDetails.phone,
      serviceRequested: leadDetails.serviceRequested,
      summary: leadDetails.summary,
      businessActivity: leadDetails.businessActivity,
      structuredRequirement: leadDetails.structuredRequirement,
      timeline: leadDetails.timeline,
      requestedTime: leadDetails.requestedTime,
      timezone: leadDetails.timezone,
      source: leadDetails.source || 'Instagram DM',
      dashboardDeepLink: deepLink,
      isUpdate,
    });


    // 4. Deliver silent internal WhatsApp message
    const deliveryRes = await deliverWhatsAppTemplate({
      phoneNumberId,
      recipient: destinationPhone,
      templateName: approvedTemplate.name,
      languageCode: approvedTemplate.language_code,
      bodyParameters: [notificationText],
      env,
      httpClient,
      integrationConfig: waChannel?.wa_config || null,
    });

    // 5. Update lead signals with durable dedupe hash
    if (existingLead?.lead_id) {
      const updatedSignals = {
        ...(existingLead.signals || {}),
        last_notified_hash: currentHash,
        last_notified_at: new Date().toISOString(),
        notification_destination: destinationPhone,
      };

      await client.query(
        `INSERT INTO crm_lead_analyses
          (tenant_id, lead_id, conversation_id, analysis_hash, analyzed_customer_message_count, signals, summary, provider, model)
         VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6, 'HIGH_INTENT_DETECTOR', 'rule-based-v1')
         ON CONFLICT (tenant_id, lead_id, analysis_hash)
         DO UPDATE SET signals = EXCLUDED.signals, summary = EXCLUDED.summary, analyzed_at = CURRENT_TIMESTAMP`,
        [tenantId, existingLead.lead_id, conversationId, currentHash, JSON.stringify(updatedSignals), leadDetails.summary || 'High-intent Instagram appointment qualification']
      );
    }

    return {
      sent: true,
      recipient: destinationPhone,
      isUpdate,
      dedupeHash: currentHash,
      deliveryResult: deliveryRes,
    };
  } finally {
    if (isDedicatedClient && typeof client?.release === 'function') {
      client.release();
    }
  }
}

/**
 * Evaluates conversation messages for high-intent qualification, updates CRM records,
 * and triggers silent internal WhatsApp notification when qualified.
 */
export async function evaluateAndProcessHighIntentLead({
  tenantId,
  conversationId,
  database = pool,
  env = process.env,
  httpClient,
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

    const messages = messagesRes.rows;
    const customerMessages = messages.filter((m) => m.sender_type === 'CUSTOMER');
    const customerTextCombined = customerMessages.map((m) => m.content).join('\n');
    const qualification = deriveInstagramLeadQualification({
      customerMessages,
      contactName: conv.contact_name && !conv.contact_name.startsWith('instagram:') ? conv.contact_name : null,
      contactPhone: conv.contact_phone,
    });

    if (!qualification.hasHighIntent) {
      return { qualified: false, reason: 'NO_HIGH_INTENT_SIGNALS' };
    }

    const phone = qualification.phone;
    const customerName = qualification.customerName;
    const requestedTime = qualification.requestedTime;
    const serviceRequested = qualification.serviceRequested;
    const usernameMatch = String(conv.contact_name || '').match(/\(@([A-Za-z0-9._]+)\)$/);
    const igUsername = usernameMatch?.[1] || null;

    const leadRes = await client.query(
      `SELECT id FROM crm_leads WHERE tenant_id = $1 AND conversation_id = $2 LIMIT 1`,
      [tenantId, conversationId]
    );
    const leadId = leadRes.rows[0]?.id || null;

    if (leadId) {
      const checkpointSignals = {
        high_intent: true,
        qualification_complete: qualification.complete,
        missing: qualification.missing,
        customer_name: customerName,
        phone,
        requested_service: serviceRequested,
        structured_requirement: qualification.structuredRequirement,
        requested_time: requestedTime,
        timezone: qualification.timezone,
      };
      const checkpointHash = crypto.createHash('sha256').update(JSON.stringify(checkpointSignals)).digest('hex');
      await client.query(
        `INSERT INTO crm_lead_analyses
          (tenant_id, lead_id, conversation_id, analysis_hash, analyzed_customer_message_count, signals, summary, provider, model)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'HIGH_INTENT_DETECTOR', 'rule-based-v2')
         ON CONFLICT (tenant_id, lead_id, analysis_hash)
         DO UPDATE SET signals = EXCLUDED.signals, analyzed_at = CURRENT_TIMESTAMP`,
        [
          tenantId,
          leadId,
          conversationId,
          checkpointHash,
          customerMessages.length,
          JSON.stringify(checkpointSignals),
          qualification.complete ? 'Progressive Instagram qualification complete' : 'Progressive Instagram qualification in progress',
        ]
      );
    }

    if (!qualification.complete) {
      return {
        qualified: false,
        reason: 'QUALIFICATION_INCOMPLETE_NEEDS_MORE_INFO',
        qualification,
        notificationLlmCalls: 0,
        notificationAiTokens: 0,
      };
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
                lead_score = GREATEST(lead_score, 85),
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
          timezone: qualification.timezone,
          service_requested: serviceRequested,
        })]
      );
    }

    const summary = `${serviceRequested}: ${qualification.structuredRequirement}`;

    const leadDetails = {
      customerName,
      instagramUsername: igUsername,
      phone,
      serviceRequested,
      summary,
      businessActivity: qualification.businessActivity,
      structuredRequirement: qualification.structuredRequirement,
      requestedTime,
      timezone: qualification.timezone,
      source: 'INSTAGRAM',
    };

    // Trigger silent WhatsApp notification
    const notificationResult = await sendSilentInternalWhatsAppLeadNotification({
      tenantId,
      conversationId,
      leadDetails,
      database: client,
      env,
      httpClient,
    });

    return {
      qualified: true,
      leadDetails,
      notificationResult,
      consultationStatus: 'PENDING',
      notificationLlmCalls: 0,
      notificationAiTokens: 0,
    };
  } finally {
    if (isDedicatedClient && typeof client?.release === 'function') {
      client.release();
    }
  }
}


