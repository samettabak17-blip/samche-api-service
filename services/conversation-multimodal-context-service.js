import crypto from 'node:crypto';
import { createConversationResource } from './conversation-resource-service.js';
import { buildConversationStorageKey, validateConversationUpload } from './conversation-resource-validation.js';
import { extractDocumentText } from './conversation-document-extraction-service.js';
import { buildUntrustedDocumentContext, buildGeminiImagePart } from './whatsapp-multimodal-service.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ConversationMultimodalError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ConversationMultimodalError';
    this.code = code;
  }
}

export async function ingestConversationAttachment({
  database,
  storage,
  tenantId,
  conversationId,
  messageId = null,
  file,
  sourceType = 'UPLOAD',
}) {
  if (!database?.query) throw new ConversationMultimodalError('DATABASE_UNAVAILABLE', 'Database is unavailable.');
  if (!UUID_REGEX.test(String(tenantId || '')) || !UUID_REGEX.test(String(conversationId || ''))) {
    throw new ConversationMultimodalError('INVALID_IDENTIFIER', 'Valid tenant and conversation UUIDs are required.');
  }

  const validated = validateConversationUpload(file);
  const resourceId = crypto.randomUUID();
  const storageKey = buildConversationStorageKey({ tenantId, conversationId, resourceId });

  if (storage && typeof storage.put === 'function') {
    await storage.put({
      key: storageKey,
      body: file.buffer,
      mimeType: validated.mimeType,
      checksum: validated.contentHash,
    });
  }

  let extractedText = null;
  let processingMethod = null;
  let processingStatus = 'READY';
  let failureCode = null;

  if (validated.mediaCategory === 'DOCUMENT') {
    try {
      const extraction = await extractDocumentText({
        mimeType: validated.mimeType,
        bytes: file.buffer,
        contentHash: validated.contentHash,
      });
      extractedText = extraction.extractedText;
      processingMethod = extraction.method;
    } catch (err) {
      processingStatus = 'FAILED';
      failureCode = err?.code || 'RESOURCE_EXTRACTION_FAILED';
    }
  } else if (validated.mediaCategory === 'IMAGE') {
    processingMethod = 'IMAGE_ORIGINAL';
  }

  const resource = await createConversationResource(database, {
    tenantId,
    conversationId,
    messageId,
    sourceType,
    mediaCategory: validated.mediaCategory,
    originalFilename: validated.originalFilename,
    mimeType: validated.mimeType,
    sizeBytes: validated.sizeBytes,
    storageKey,
    contentHash: validated.contentHash,
    processingStatus,
    metadata: {
      extracted_length: extractedText ? extractedText.length : 0,
      processing_method: processingMethod,
      failure_code: failureCode,
    },
  });

  if (extractedText || processingStatus === 'READY') {
    await database.query(
      `UPDATE conversation_resources
          SET extracted_text = $1, processing_status = $2, processing_method = $3, processed_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND tenant_id = $5`,
      [extractedText, processingStatus, processingMethod, resource.id, tenantId]
    );
  }

  return {
    ...resource,
    extracted_text: extractedText,
    processing_status: processingStatus,
    processing_method: processingMethod,
  };
}

export async function resolveConversationMultimodalContext({
  database,
  storage,
  tenantId,
  conversationId,
  conversationIds = [],
  currentResourceIds = [],
  maxAttachments = 2,
  maxDocumentChars = 4000,
}) {
  if (!database?.query || !UUID_REGEX.test(String(tenantId || ''))) {
    return { documents: [], images: [], promptSection: '' };
  }

  const allConvIds = [...(Array.isArray(conversationIds) ? conversationIds : []), conversationId].filter((id) => UUID_REGEX.test(String(id || '')));
  const uniqueConvIds = Array.from(new Set(allConvIds));

  let querySql;
  let queryParams;

  const validResourceIds = (Array.isArray(currentResourceIds) ? currentResourceIds : []).filter((id) => UUID_REGEX.test(String(id || '')));

  if (validResourceIds.length > 0) {
    if (uniqueConvIds.length > 0) {
      querySql = `SELECT * FROM conversation_resources
        WHERE tenant_id = $1 AND (conversation_id = ANY($2::uuid[]) OR id = ANY($3::uuid[])) AND id = ANY($3::uuid[])
        ORDER BY created_at DESC LIMIT $4`;
      queryParams = [tenantId, uniqueConvIds, validResourceIds, maxAttachments];
    } else {
      querySql = `SELECT * FROM conversation_resources
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])
        ORDER BY created_at DESC LIMIT $3`;
      queryParams = [tenantId, validResourceIds, maxAttachments];
    }
  } else if (uniqueConvIds.length > 0) {
    querySql = `SELECT * FROM conversation_resources
      WHERE tenant_id = $1 AND conversation_id = ANY($2::uuid[]) AND processing_status = 'READY'
      ORDER BY created_at DESC LIMIT $3`;
    queryParams = [tenantId, uniqueConvIds, maxAttachments];
  } else {
    return { documents: [], images: [], promptSection: '' };
  }

  const result = await database.query(querySql, queryParams);
  const rows = result.rows || [];

  const documents = [];
  const images = [];
  const promptParts = [];

  for (const res of rows) {
    if (res.media_category === 'DOCUMENT' && res.extracted_text) {
      const excerpt = String(res.extracted_text).trim().slice(0, maxDocumentChars);
      const safeContext = buildUntrustedDocumentContext(excerpt);
      if (safeContext) {
        documents.push({
          id: res.id,
          filename: res.original_filename,
          mimeType: res.mime_type,
          text: excerpt,
          safeContextText: safeContext,
        });
        promptParts.push(safeContext);
      }
    } else if (res.media_category === 'IMAGE') {
      let buffer = null;
      if (storage && typeof storage.get === 'function' && res.storage_key) {
        try {
          const stream = await storage.get({ key: res.storage_key });
          if (Buffer.isBuffer(stream)) {
            buffer = stream;
          } else if (Array.isArray(stream)) {
            buffer = Buffer.concat(stream.map((b) => (Buffer.isBuffer(b) ? b : Buffer.from(b))));
          } else if (stream && typeof stream.transformToByteArray === 'function') {
            const bytes = await stream.transformToByteArray();
            buffer = Buffer.from(bytes);
          } else if (stream && (typeof stream[Symbol.asyncIterator] === 'function' || typeof stream[Symbol.iterator] === 'function')) {
            const chunks = [];
            for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            buffer = Buffer.concat(chunks);
          }
        } catch (storageErr) {
          console.warn('STORAGE_IMAGE_RETRIEVAL_WARN:', storageErr?.message || storageErr);
        }
      }
      images.push({
        id: res.id,
        filename: res.original_filename,
        mimeType: res.mime_type,
        buffer,
        base64: buffer ? buffer.toString('base64') : null,
      });
      promptParts.push(`[ATTACHED_IMAGE: ${res.original_filename} (${res.mime_type})]`);
    }
  }

  return {
    documents,
    images,
    promptSection: promptParts.join('\n\n'),
  };
}

export function formatOpenAiMultimodalContent({ text, images = [], documentContext = '' }) {
  const combinedText = [documentContext, text].filter(Boolean).join('\n\n');
  const validImages = images.filter((img) => img.base64 && img.mimeType);

  if (validImages.length === 0) {
    return combinedText;
  }

  const content = [{ type: 'text', text: combinedText }];
  for (const img of validImages) {
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${img.mimeType};base64,${img.base64}`,
      },
    });
  }
  return content;
}

export function formatGeminiMultimodalParts({ text, images = [], documentContext = '' }) {
  const combinedText = [documentContext, text].filter(Boolean).join('\n\n');
  const parts = [];
  if (combinedText) parts.push({ text: combinedText });

  for (const img of images) {
    const buffer = img.buffer || (img.base64 ? Buffer.from(img.base64, 'base64') : null);
    if (buffer && Buffer.isBuffer(buffer)) {
      parts.push(buildGeminiImagePart({ mimeType: img.mimeType, bytes: buffer }));
    }
  }
  return parts;
}
