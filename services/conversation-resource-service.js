export async function createConversationResource(client, {
  tenantId,
  conversationId,
  messageId,
  sourceType,
  mediaCategory,
  originalFilename = null,
  mimeType = null,
  sizeBytes = null,
  storageKey = null,
  sourceReference = null,
  sourceUrl = null,
  contentHash = null,
  metadata = {},
  processingStatus = 'UPLOADING',
}) {
  const result = await client.query(
    `INSERT INTO conversation_resources
      (tenant_id, conversation_id, message_id, source_type, media_category,
       original_filename, mime_type, size_bytes, storage_key, source_reference,
       source_url, content_hash, metadata, processing_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
     RETURNING *`,
    [tenantId, conversationId, messageId, sourceType, mediaCategory, originalFilename,
      mimeType, sizeBytes, storageKey, sourceReference, sourceUrl, contentHash,
      JSON.stringify(metadata), processingStatus]
  );
  return result.rows[0];
}

export async function listConversationResources(queryFn, { tenantId, conversationId, messageId = null }) {
  const result = await queryFn(
    `SELECT id, tenant_id, conversation_id, message_id, source_type, media_category,
            original_filename, mime_type, size_bytes, processing_status,
            failure_code, created_at, processed_at, updated_at
       FROM conversation_resources
      WHERE tenant_id = $1
        AND conversation_id = $2
        AND ($3::uuid IS NULL OR message_id = $3)
      ORDER BY created_at ASC, id ASC`,
    [tenantId, conversationId, messageId]
  );
  return result.rows;
}


export function conversationResourceContentDisposition(resource, { download = false } = {}) {
  const fallback = resource?.media_category === 'IMAGE' ? 'image-attachment' : 'document-attachment';
  const filename = String(resource?.original_filename ?? fallback)
    .replace(/[\\/\r\n"]/g, '_')
    .trim()
    .slice(0, 180) || fallback;
  return `${download ? 'attachment' : 'inline'}; filename="${filename}"`;
}
