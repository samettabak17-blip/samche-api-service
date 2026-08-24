import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { createConversationResource } from './conversation-resource-service.js';
import { createConversationResourceStorage } from './conversation-resource-storage.js';
import { extractDocumentText } from './conversation-document-extraction-service.js';
import { buildConversationStorageKey, validateConversationUpload } from './conversation-resource-validation.js';
import { buildGeminiImagePart, buildUntrustedDocumentContext, whatsappIntegrationKey } from './whatsapp-multimodal-service.js';
import { waitForReadyResource } from './whatsapp-resource-retry.js';

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

const EXPLICIT_RESOURCE_REFERENCE = /(az önce gönderdiğim|yukarıdaki|bu\s+(?:pdf|dosya|belge|görsel)|(?:pdf|dosya|belge|görsel)(?:deki|daki|yi|yı|nin|ın|in|un)|this\s+(?:pdf|file|document|image)|the\s+(?:previous|above)\s+(?:pdf|file|document|image))/i;
const IMAGE_RESOURCE_REFERENCE = /\b(görsel|resim|ekran görüntüsü|image|screenshot|photo)\b/i;
const DOCUMENT_RESOURCE_REFERENCE = /\b(pdf|dosya|belge|document|file)\b/i;
const FOLLOW_UP_RESOURCE_WINDOW_MINUTES = 10;
const EXPLICIT_RESOURCE_WINDOW_MINUTES = 60;
const MAX_FOLLOW_UP_RESOURCES = 1;
const MAX_EXPLICIT_RESOURCES = 2;
const MAX_DOCUMENT_CONTEXT_CHARS = 12_000;

function resourceCategoryForReference(content) {
  if (IMAGE_RESOURCE_REFERENCE.test(content)) return 'IMAGE';
  if (DOCUMENT_RESOURCE_REFERENCE.test(content)) return 'DOCUMENT';
  return null;
}

async function readResourceBytes(storage, key) {
  const body = await storage.get({ key });
  if (Buffer.isBuffer(body)) return body;
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function shouldSelectRecentWhatsAppResourceContext({ conversation, descriptor, customerText }) {
  return !descriptor &&
    Boolean(String(customerText ?? '').trim()) &&
    conversation?.status === 'open' &&
    conversation?.handling_mode === 'AI';
}

export async function selectRecentWhatsAppResourceContext({
  client,
  tenantId,
  conversationId,
  customerText,
  storage = null,
}) {
  const text = String(customerText ?? '').trim();
  if (!text) return { parts: [], resourceIds: [] };

  const explicitReference = EXPLICIT_RESOURCE_REFERENCE.test(text);
  const maxResources = explicitReference ? 1 : MAX_FOLLOW_UP_RESOURCES;
  const statusClause = explicitReference ? '' : "AND processing_status IN ('READY', 'PROCESSING')";
  const recentMinutes = explicitReference ? EXPLICIT_RESOURCE_WINDOW_MINUTES : FOLLOW_UP_RESOURCE_WINDOW_MINUTES;
  const category = explicitReference ? resourceCategoryForReference(text) : null;
  const result = await client.query(
    `SELECT id, storage_key, media_category, mime_type, extracted_text, processing_status
       FROM conversation_resources
      WHERE tenant_id = $1
        AND conversation_id = $2
        ${statusClause}
        AND created_at >= CURRENT_TIMESTAMP - ($5::integer * INTERVAL '1 minute')
        AND ($3::text IS NULL OR media_category = $3)
      ORDER BY created_at DESC, id DESC
      LIMIT $4`,
    [tenantId, conversationId, category, maxResources, recentMinutes]
  );

  const parts = [];
  const resourceIds = [];
  let processingResourceCount = 0;
  let latestResource = explicitReference ? (result.rows[0] ?? null) : null;
  let remainingDocumentChars = MAX_DOCUMENT_CONTEXT_CHARS;
  let resourceStorage = storage;
  for (let resource of result.rows.slice(0, maxResources)) {
    if (resource.processing_status === 'PROCESSING') {
      const waited = await waitForReadyResource({
        read: async () => {
          const refreshed = await client.query(
            `SELECT id, storage_key, media_category, mime_type, extracted_text, processing_status
               FROM conversation_resources
              WHERE id = $1 AND tenant_id = $2 AND conversation_id = $3`,
            [resource.id, tenantId, conversationId]
          );
          return refreshed.rows[0] ?? null;
        },
      });
      if (waited.status !== 'READY') {
        processingResourceCount += 1;
        continue;
      }
      resource = waited.resource;
      if (explicitReference) latestResource = resource;
    }
    if (resource.media_category === 'DOCUMENT') {
      const excerpt = String(resource.extracted_text ?? '').trim().slice(0, remainingDocumentChars);
      const context = buildUntrustedDocumentContext(excerpt);
      if (!context) continue;
      remainingDocumentChars -= excerpt.length;
      parts.push({ text: context });
      resourceIds.push(resource.id);
      if (remainingDocumentChars <= 0) break;
      continue;
    }
    if (resource.media_category === 'IMAGE') {
      try {
        resourceStorage ??= createConversationResourceStorage();
        const bytes = await readResourceBytes(resourceStorage, resource.storage_key);
        parts.push(buildGeminiImagePart({ mimeType: resource.mime_type, bytes }));
        resourceIds.push(resource.id);
      } catch {
        // A failed historic resource read is omitted rather than represented as understood.
      }
    }
  }
  return { parts, resourceIds, processingResourceCount, latestResource };
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
    let aiContextParts = [];
    let resourceContext = null;
    if (descriptor && bytes) {
      const resourceStorage = storage ?? createConversationResourceStorage();
      activeStorage = resourceStorage;
      const result = await persistResource(client, {
        tenantId: integration.tenant_id, conversationId, messageId: customerMessage.id, descriptor, bytes, storage: resourceStorage,
        onStored: (key) => { uploadedStorageKey = key; },
      });
      resource = result.resource;
      aiContextPart = result.aiContextPart;
      aiContextParts = aiContextPart ? [aiContextPart] : [];
      uploadedStorageKey = resource.storage_key;
    } else if (shouldSelectRecentWhatsAppResourceContext({
      conversation,
      descriptor,
      customerText: content,
    })) {
      const selected = await selectRecentWhatsAppResourceContext({
        client,
        tenantId: integration.tenant_id,
        conversationId,
        customerText: content,
      });
      aiContextParts = selected.parts;
      resourceContext = { processingResourceCount: selected.processingResourceCount, latestResource: selected.latestResource };
    }
    await client.query(
      'UPDATE conversations SET last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2',
      [conversationId, integration.tenant_id]
    );
    await notify(client, integration.tenant_id, conversationId, 'CUSTOMER_MESSAGE');
    await client.query('COMMIT');
    queueLeadQualification({ tenantId: integration.tenant_id, conversationId });
    return {
      integration, conversation, customerMessage, resource, aiContextPart, aiContextParts, resourceContext, duplicate: false,
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

