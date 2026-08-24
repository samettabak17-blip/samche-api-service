import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { createConversationResource } from './conversation-resource-service.js';
import { createConversationResourceStorage } from './conversation-resource-storage.js';
import { extractDocumentText } from './conversation-document-extraction-service.js';
import { buildConversationStorageKey, validateConversationUpload } from './conversation-resource-validation.js';
import { buildGeminiImagePart, buildUntrustedDocumentContext, whatsappIntegrationKey } from './whatsapp-multimodal-service.js';

export class WhatsAppInboxError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function customerReference(customerPhone) {
  return `whatsapp:${String(customerPhone).replace(/[^0-9]/g, '')}`;
}

function externalConversationId(customerPhone) {
  return `whatsapp:${crypto.createHash('sha256').update(customerReference(customerPhone)).digest('hex')}`;
}

export function whatsappPhoneNumberFingerprint(phoneNumberId) {
  return crypto.createHash('sha256').update(String(phoneNumberId ?? '')).digest('hex').slice(0, 16);
}

export async function getWhatsAppRuntimeDatabaseFingerprint(client) {
  try {
    const result = await client.query(
      `SELECT current_database() AS database_name, current_schema() AS schema_name,
              COALESCE(inet_server_addr()::text, 'local') AS server_address,
              COALESCE(inet_server_port()::text, '0') AS server_port`
    );
    const identity = result.rows[0];
    return crypto.createHash('sha256')
      .update([identity.database_name, identity.schema_name, identity.server_address, identity.server_port].join('|'))
      .digest('hex')
      .slice(0, 16);
  } catch {
    return 'unavailable';
  }
}

async function notify(client, tenantId, conversationId, type) {
  await client.query('SELECT pg_notify($1, $2)', [
    'samche_live_events', JSON.stringify({ tenant_id: tenantId, conversation_id: conversationId, type }),
  ]);
}

export async function resolveWhatsAppIntegration(client, phoneNumberId) {
  const result = await client.query(
    `SELECT ci.tenant_id, ci.channel_id, ci.assistant_id, tc.channel_type, tc.status AS channel_status, a.status AS assistant_status
       FROM channel_integrations ci
       JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
       JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
      WHERE ci.integration_key = $1
        AND ci.integration_type = 'WHATSAPP'
        AND ci.enabled = TRUE
      LIMIT 2`,
    [whatsappIntegrationKey(phoneNumberId)]
  );
  if (result.rowCount !== 1) return null;
  const integration = result.rows[0];
  if (integration.channel_type !== 'WHATSAPP' || integration.channel_status !== 'active' || integration.assistant_status !== 'active') return null;
  return integration;
}

async function insertCustomerMessage(client, { tenantId, conversationId, externalMessageId, content }) {
  const result = await client.query(
    `INSERT INTO conversation_messages
      (tenant_id, conversation_id, external_message_id, sender_type, content, idempotency_key)
     VALUES ($1, $2, $3, 'CUSTOMER', $4, $5)
     ON CONFLICT (conversation_id, external_message_id) DO NOTHING
     RETURNING *`,
    [tenantId, conversationId, externalMessageId, content, `whatsapp:${externalMessageId}`]
  );
  return result.rows[0] ?? null;
}

async function persistResource(client, {
  tenantId, conversationId, messageId, descriptor, bytes, storage, extract = extractDocumentText, onStored,
}) {
  const validated = validateConversationUpload({
    buffer: bytes,
    size: bytes.length,
    mimetype: descriptor.declaredMimeType,
    originalname: descriptor.originalFilename,
  });
  const resourceId = randomUUID();
  const storageKey = buildConversationStorageKey({ tenantId, conversationId, resourceId });
  await storage.put({ key: storageKey, body: bytes, mimeType: validated.mimeType, checksum: validated.contentHash });
  onStored?.(storageKey);
  const resource = await createConversationResource(client, {
    tenantId,
    conversationId,
    messageId,
    sourceType: 'WHATSAPP_MEDIA',
    mediaCategory: validated.mediaCategory,
    originalFilename: validated.originalFilename,
    mimeType: validated.mimeType,
    sizeBytes: validated.sizeBytes,
    storageKey,
    sourceReference: descriptor.sourceReference,
    contentHash: validated.contentHash,
    metadata: { external_media_id: descriptor.externalMediaId },
    processingStatus: 'PROCESSING',
  });

  if (validated.mediaCategory === 'IMAGE') {
    const updated = await client.query(
      `UPDATE conversation_resources
          SET processing_status = 'READY', processing_method = 'IMAGE_ORIGINAL', processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [resource.id, tenantId]
    );
    return { resource: updated.rows[0], aiContextPart: buildGeminiImagePart({ mimeType: validated.mimeType, bytes }) };
  }

  try {
    const extraction = await extract({ mimeType: validated.mimeType, bytes, contentHash: validated.contentHash });
    const updated = await client.query(
      `UPDATE conversation_resources
          SET processing_status = 'READY', processing_method = $1, extracted_text = $2, extraction_hash = $3,
              processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND tenant_id = $5 RETURNING *`,
      [extraction.method, extraction.extractedText, extraction.extractionHash, resource.id, tenantId]
    );
    return { resource: updated.rows[0], aiContextPart: { text: buildUntrustedDocumentContext(extraction.extractedText) } };
  } catch (error) {
    const updated = await client.query(
      `UPDATE conversation_resources
          SET processing_status = 'FAILED', failure_code = $1, processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [error?.code ?? 'RESOURCE_EXTRACTION_FAILED', resource.id, tenantId]
    );
    return { resource: updated.rows[0], aiContextPart: null };
  }
}

export async function persistWhatsAppInbound({
  pool,
  phoneNumberId,
  customerPhone,
  externalMessageId,
  content = '',
  descriptor = null,
  bytes = null,
  ensureConversationCrmIdentity,
  queueLeadQualification,
  storage = null,
}) {
  if (!pool?.connect || !ensureConversationCrmIdentity || !queueLeadQualification) {
    throw new WhatsAppInboxError('WHATSAPP_INBOX_CONFIG_REQUIRED', 'WhatsApp inbox persistence is not configured');
  }
  if (!customerPhone || !externalMessageId) {
    throw new WhatsAppInboxError('WHATSAPP_MESSAGE_IDENTITY_REQUIRED', 'WhatsApp customer and message identities are required');
  }
  const client = await pool.connect();
  let uploadedStorageKey = null;
  let activeStorage = storage;
  try {
    await client.query('BEGIN');
    const integration = await resolveWhatsAppIntegration(client, phoneNumberId);
    if (!integration) {
      const runtimeDbIdentity = await getWhatsAppRuntimeDatabaseFingerprint(client);
      await client.query('COMMIT');
      return {
        unmapped: true,
        runtimeDbIdentity,
        phoneNumberFingerprint: whatsappPhoneNumberFingerprint(phoneNumberId),
      };
    }
    const conversationResult = await client.query(
      `INSERT INTO conversations
        (tenant_id, channel_id, external_conversation_id, customer_external_id, last_activity_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (channel_id, external_conversation_id)
       DO UPDATE SET last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [integration.tenant_id, integration.channel_id, externalConversationId(customerPhone), customerReference(customerPhone)]
    );
    const conversationId = conversationResult.rows[0].id;
    const locked = await client.query(
      'SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [conversationId, integration.tenant_id]
    );
    const conversation = locked.rows[0];
    await ensureConversationCrmIdentity(client, {
      tenantId: integration.tenant_id, conversationId, source: 'WHATSAPP', externalCustomerId: conversation.customer_external_id,
    });
    const customerMessage = await insertCustomerMessage(client, {
      tenantId: integration.tenant_id, conversationId, externalMessageId, content: content || '',
    });
    if (!customerMessage) {
      await client.query('COMMIT');
      return { integration, conversation, duplicate: true, shouldInvokeAi: false, resource: null, aiContextPart: null };
    }
    let resource = null;
    let aiContextPart = null;
    if (descriptor && bytes) {
      const resourceStorage = storage ?? createConversationResourceStorage();
      activeStorage = resourceStorage;
      const result = await persistResource(client, {
        tenantId: integration.tenant_id, conversationId, messageId: customerMessage.id, descriptor, bytes, storage: resourceStorage,
        onStored: (key) => { uploadedStorageKey = key; },
      });
      resource = result.resource;
      aiContextPart = result.aiContextPart;
      uploadedStorageKey = resource.storage_key;
    }
    await client.query(
      'UPDATE conversations SET last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2',
      [conversationId, integration.tenant_id]
    );
    await notify(client, integration.tenant_id, conversationId, 'CUSTOMER_MESSAGE');
    await client.query('COMMIT');
    queueLeadQualification({ tenantId: integration.tenant_id, conversationId });
    return {
      integration, conversation, customerMessage, resource, aiContextPart, duplicate: false,
      shouldInvokeAi: conversation.status === 'open' && conversation.handling_mode === 'AI',
      handlingVersion: conversation.handling_version,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (uploadedStorageKey && activeStorage) await activeStorage.remove({ key: uploadedStorageKey }).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

