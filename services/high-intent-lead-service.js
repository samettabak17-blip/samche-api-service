import crypto from 'node:crypto';
import pool from '../config/db.js';
import { deliverWhatsAppText, WhatsAppDeliveryError } from './whatsapp-delivery-service.js';
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


const PHONE_EXTRACTION_REGEX = /(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/;

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
  const match = text.match(/(?:yarın|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar|bugün|haftaya|saat\s+\d{1,2}(?::\d{2})?|\d{1,2}\s+(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)|\d{1,2}[:.]\d{2})/i);
  if (match) return match[0].trim();
  return null;
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
  dashboardDeepLink = null,
  isUpdate = false,
}) {
  const lines = [
    `🔥 Yüksek Niyetli Instagram Lead${isUpdate ? ' [GÜNCELLEME]' : ''}`,
    '',
    `Ad: ${customerName || 'Belirtilmedi'}`,
    `Instagram: ${instagramUsername ? '@' + instagramUsername.replace(/^@/, '') : 'Belirtilmedi'}`,
    `Telefon/WhatsApp: ${phone || 'Belirtilmedi'}`,
    `Talep: ${serviceRequested || 'Danışmanlık / Şirket Kuruluşu'}`,
    `Detay: ${summary || 'Instagram üzerinden yüksek niyetli randevu/bilgi talebi'}`,
    `Randevu Talebi: ${requestedTime || 'Zaman belirtilmedi'}`,
    'Kaynak: Instagram DM',
  ];

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
      requestedTime: leadDetails.requestedTime,
      dashboardDeepLink: deepLink,
      isUpdate,
    });

    // 4. Deliver silent internal WhatsApp message
    const deliveryRes = await deliverWhatsAppText({
      phoneNumberId,
      recipient: destinationPhone,
      content: notificationText,
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

    if (!hasHighIntentAppointmentSignals(customerTextCombined)) {
      return { qualified: false, reason: 'NO_HIGH_INTENT_SIGNALS' };
    }

    // Extract fields
    const phone = extractPhoneNumberFromText(customerTextCombined) || conv.contact_phone || null;
    const extractedName = extractCustomerNameFromText(customerTextCombined);
    const customerName = extractedName || (conv.contact_name && !conv.contact_name.startsWith('instagram:') ? conv.contact_name : null);
    const requestedTime = extractMeetingTimePreference(customerTextCombined);
    const rawIg = String(conv.customer_external_id || '').replace(/^instagram:\s*/i, '');
    const igUsername = conv.contact_name && !conv.contact_name.startsWith('instagram:') ? conv.contact_name : rawIg;

    // Service topic determination
    let serviceRequested = 'Şirket Kuruluşu & Danışmanlık';
    if (/free\s*zone/i.test(customerTextCombined)) {
      serviceRequested = 'Free Zone Şirket Kuruluşu';
    } else if (/mainland/i.test(customerTextCombined)) {
      serviceRequested = 'Mainland Şirket Kuruluşu';
    } else if (/vize|residency|ikamet/i.test(customerTextCombined)) {
      serviceRequested = 'Vize & Oturum Danışmanlığı';
    } else if (/banka|hesap|bank/i.test(customerTextCombined)) {
      serviceRequested = 'Banka Hesabı Açılışı';
    }

    // Lead is sufficiently qualified when we have phone OR (customerName + appointment intent)
    const isSufficientlyQualified = Boolean(phone || (customerName && customerMessages.length >= 2));
    if (!isSufficientlyQualified) {
      return { qualified: false, reason: 'QUALIFICATION_INCOMPLETE_NEEDS_MORE_INFO' };
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

    // Upsert crm_leads with hot temperature & appointment intent
    const leadRes = await client.query(
      `SELECT id FROM crm_leads WHERE tenant_id = $1 AND conversation_id = $2 LIMIT 1`,
      [tenantId, conversationId]
    );

    let leadId = leadRes.rows[0]?.id;
    if (leadId) {
      await client.query(
        `UPDATE crm_leads
            SET intent = 'APPOINTMENT_REQUEST',
                temperature = 'HOT',
                lead_score = GREATEST(lead_score, 85),
                service_interest = $1,
                timeline = $2,
                last_activity_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $3 AND tenant_id = $4`,
        [serviceRequested, requestedTime, leadId, tenantId]
      );
    }

    const summary = `Instagram üzerinden ${serviceRequested.toLowerCase()} randevu talebi. Müşteri bilgileri toplandı.`;

    const leadDetails = {
      customerName,
      instagramUsername: igUsername,
      phone,
      serviceRequested,
      summary,
      requestedTime: requestedTime || 'Zaman belirtilmedi',
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
    };
  } finally {
    if (isDedicatedClient && typeof client?.release === 'function') {
      client.release();
    }
  }
}


