import express from 'express';
import multer from 'multer';
import { authenticateToken, requireTenantAccess } from '../middleware/auth.js';
import { isValidUUID } from '../middleware/validators.js';
import {
  appendAgentMessage,
  appendAgentMediaMessage,
  ConversationOperationError,
  getHumanDeliveryCapability,
  listConversationEvents,
  operateConversation,
} from '../services/live-inbox-service.js';
import { listHumanAttentionSummary } from '../services/human-support-service.js';
import { startLiveEventListener, subscribeTenantEvents } from '../services/live-event-bus.js';
import { createConversationResourceStorage } from '../services/conversation-resource-storage.js';
import { classifyConversationResourceAccessFailure, conversationResourceContentDisposition } from '../services/conversation-resource-service.js';

const router = express.Router();
const agentMediaUpload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 10 * 1024 * 1024 } });

router.use(authenticateToken);

function tenantId(req, res) {
  if (req.params.tenantId !== req.verified_tenant_id) {
    res.status(403).json({ error: 'Tenant access denied' });
    return null;
  }
  return req.verified_tenant_id;
}

function pagination(req, res) {
  const limit = Number.parseInt(String(req.query.limit ?? '25'), 10);
  const offset = Number.parseInt(String(req.query.offset ?? '0'), 10);
  if (!Number.isInteger(limit) || !Number.isInteger(offset) || limit < 1 || limit > 100 || offset < 0) {
    res.status(400).json({ error: 'Invalid pagination parameters' });
    return null;
  }
  return { limit, offset };
}

function actor(req) {
  return {
    userId: req.user.user_id,
    systemRole: req.user.system_role,
    tenantRole: req.verified_tenant_role,
  };
}

function operationError(res, error, label) {
  if (error instanceof ConversationOperationError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      retryable: error.status >= 500,
    });
  }
  const code = error?.code ?? error?.name ?? 'CONVERSATION_OPERATION_FAILED';
  console.error(label, code);
  return res.status(500).json({
    error: 'The conversation operation could not be completed. Please try again.',
    code: 'CONVERSATION_OPERATION_FAILED',
    retryable: true,
  });
}

async function conversationContext(tenantId, conversationId) {
  const { query } = await import('../config/db.js');
  const result = await query(
    `SELECT
       c.*,
       tc.channel_type,
       tc.display_name AS channel_display_name,
       tc.assistant_id,
       a.name AS assistant_name,
       assigned.email AS assigned_agent_email,
       contact.display_name AS contact_display_name,
       contact.phone AS contact_phone,
       contact.language AS contact_language,
       contact.country AS contact_country,
       latest.content AS last_message_preview,
       latest.created_at AS last_message_at
     FROM conversations c
     JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
     LEFT JOIN ai_assistants a ON a.id = tc.assistant_id AND a.tenant_id = tc.tenant_id
     LEFT JOIN users assigned ON assigned.id = c.assigned_agent_user_id
     LEFT JOIN crm_contacts contact ON contact.id = c.contact_id AND contact.tenant_id = c.tenant_id
     LEFT JOIN LATERAL (
       SELECT content, created_at
       FROM conversation_messages
       WHERE tenant_id = c.tenant_id AND conversation_id = c.id
       ORDER BY created_at DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE c.id = $1 AND c.tenant_id = $2`,
    [conversationId, tenantId]
  );
  const conversation = result.rows[0] ?? null;
  if (!conversation) return null;
  const humanDelivery = await getHumanDeliveryCapability({ tenantId, conversationId });
  return {
    ...conversation,
    human_delivery_configured: humanDelivery?.configured === true,
  };
}

router.get('/:tenantId/conversations/live', requireTenantAccess, async (req, res) => {
  const currentTenantId = tenantId(req, res);
  if (!currentTenantId) return;

  await startLiveEventListener();
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('event: connected\ndata: {}\n\n');

  const unsubscribe = subscribeTenantEvents(currentTenantId, (event) => {
    res.write(`event: conversation\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

router.get('/:tenantId/conversations', requireTenantAccess, async (req, res) => {
  const currentTenantId = tenantId(req, res);
  const page = pagination(req, res);
  if (!currentTenantId || !page) return;

  const status = req.query.status;
  const handlingMode = req.query.handling_mode;
  const channelType = req.query.channel_type;
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 160) : '';
  if (status && !['open', 'closed', 'archived'].includes(status)) return res.status(400).json({ error: 'Invalid conversation status' });
  if (handlingMode && !['AI', 'HUMAN', 'PAUSED'].includes(handlingMode)) return res.status(400).json({ error: 'Invalid handling mode' });
  if (channelType && !['WHATSAPP', 'WEB_CHAT', 'SAMCHEGUIDE'].includes(channelType)) return res.status(400).json({ error: 'Invalid conversation channel type' });

  try {
    const { query } = await import('../config/db.js');
    const result = await query(
      `SELECT
         c.*,
         tc.channel_type,
         tc.display_name AS channel_display_name,
         a.name AS assistant_name,
         assigned.email AS assigned_agent_email,
         contact.display_name AS contact_display_name,
         contact.phone AS contact_phone,
         contact.language AS contact_language,
         contact.country AS contact_country,
         latest.content AS last_message_preview,
         latest.created_at AS last_message_at
       FROM conversations c
       JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
       LEFT JOIN ai_assistants a ON a.id = tc.assistant_id AND a.tenant_id = tc.tenant_id
       LEFT JOIN users assigned ON assigned.id = c.assigned_agent_user_id
       LEFT JOIN crm_contacts contact ON contact.id = c.contact_id AND contact.tenant_id = c.tenant_id
       LEFT JOIN LATERAL (
         SELECT content, created_at
         FROM conversation_messages
         WHERE tenant_id = c.tenant_id AND conversation_id = c.id
         ORDER BY created_at DESC
         LIMIT 1
       ) latest ON TRUE
       WHERE c.tenant_id = $1
         AND ($2::text IS NULL OR c.status = $2)
         AND ($3::text IS NULL OR c.handling_mode = $3)
         AND ($4::text IS NULL OR tc.channel_type = $4)
         AND ($5::text IS NULL
              OR c.customer_external_id ILIKE '%' || $5 || '%'
              OR c.external_conversation_id ILIKE '%' || $5 || '%'
              OR contact.display_name ILIKE '%' || $5 || '%'
              OR contact.phone ILIKE '%' || $5 || '%'
              OR latest.content ILIKE '%' || $5 || '%'
              OR EXISTS (
                SELECT 1
                  FROM conversation_messages searchable
                 WHERE searchable.tenant_id = c.tenant_id
                   AND searchable.conversation_id = c.id
                   AND searchable.content ILIKE '%' || $5 || '%'
              ))
       ORDER BY c.last_activity_at DESC, c.created_at DESC
       LIMIT $6 OFFSET $7`,
      [currentTenantId, status ?? null, handlingMode ?? null, channelType ?? null, search || null, page.limit, page.offset]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('List tenant conversations error:', error?.code ?? error?.name ?? 'unknown');
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:tenantId/conversations/human-attention-summary', requireTenantAccess, async (req, res) => {
  const currentTenantId = tenantId(req, res);
  if (!currentTenantId) return;
  try {
    return res.json(await listHumanAttentionSummary({ tenantId: currentTenantId }));
  } catch (error) {
    console.error('Human attention summary error:', error?.code ?? error?.name ?? 'unknown');
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:tenantId/conversations/:conversationId/messages', requireTenantAccess, async (req, res) => {
  const currentTenantId = tenantId(req, res);
  const page = pagination(req, res);
  if (!currentTenantId || !page) return;
  if (!isValidUUID(req.params.conversationId)) return res.status(400).json({ error: 'Invalid conversation ID' });

  try {
    const details = await conversationContext(currentTenantId, req.params.conversationId);
    if (!details) return res.status(404).json({ error: 'Conversation not found' });

    const { query } = await import('../config/db.js');
    const result = await query(
      `SELECT m.*, u.email AS actor_email
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id AND c.tenant_id = m.tenant_id
       LEFT JOIN users u ON u.id = m.actor_user_id
       WHERE m.tenant_id = $1 AND m.conversation_id = $2
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $3 OFFSET $4`,
      [currentTenantId, req.params.conversationId, page.limit, page.offset]
    );
    const messageIds = result.rows.map((message) => message.id);
    const resources = messageIds.length ? await query(
      `SELECT id, tenant_id, conversation_id, message_id, source_type, media_category,
              original_filename, mime_type, size_bytes, processing_status, failure_code,
              created_at, processed_at, updated_at
         FROM conversation_resources
        WHERE tenant_id = $1 AND conversation_id = $2 AND message_id = ANY($3::uuid[])
        ORDER BY created_at ASC, id ASC`,
      [currentTenantId, req.params.conversationId, messageIds]
    ) : { rows: [] };
    const resourcesByMessage = new Map();
    for (const resource of resources.rows) {
      const items = resourcesByMessage.get(resource.message_id) ?? [];
      items.push(resource);
      resourcesByMessage.set(resource.message_id, items);
    }
    return res.json(result.rows.map((message) => ({ ...message, resources: resourcesByMessage.get(message.id) ?? [] })));
  } catch (error) {
    console.error('List conversation messages error:', error?.code ?? error?.name ?? 'unknown');
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:tenantId/conversations/:conversationId/resources/:resourceId', requireTenantAccess, async (req, res) => {
  const currentTenantId = tenantId(req, res);
  if (!currentTenantId) return;
  if (!isValidUUID(req.params.conversationId) || !isValidUUID(req.params.resourceId)) {
    return res.status(400).json({ error: 'Invalid resource request' });
  }
  let stage = 'RESOURCE_LOOKUP';
  try {
    const { query } = await import('../config/db.js');
    const found = await query(
      `SELECT r.id, r.conversation_id, r.media_category, r.original_filename, r.mime_type, r.storage_key
         FROM conversation_resources r
         JOIN conversations c ON c.id = r.conversation_id AND c.tenant_id = r.tenant_id
        WHERE r.id = $1 AND r.conversation_id = $2 AND r.tenant_id = $3`,
      [req.params.resourceId, req.params.conversationId, currentTenantId]
    );
    const resource = found.rows[0];
    if (!resource?.storage_key) {
      console.info('CONVERSATION_RESOURCE_ACCESS stage=RESOURCE_LOOKUP status=FAIL');
      return res.status(404).json({ error: 'Attachment unavailable', code: 'ATTACHMENT_NOT_FOUND' });
    }
    console.info('CONVERSATION_RESOURCE_ACCESS stage=RESOURCE_LOOKUP status=OK');
    stage = 'TENANT_AUTHORIZATION';
    console.info('CONVERSATION_RESOURCE_ACCESS stage=TENANT_AUTHORIZATION status=OK');
    stage = 'STORAGE_RESOLUTION';
    const storage = createConversationResourceStorage();
    console.info('CONVERSATION_RESOURCE_ACCESS stage=STORAGE_RESOLUTION status=OK');
    stage = 'BINARY_FETCH';
    const stream = await storage.get({ key: resource.storage_key });
    console.info('CONVERSATION_RESOURCE_ACCESS stage=BINARY_FETCH status=OK');
    stage = 'STREAM_RESPONSE';
    res.status(200);
    res.set({
      'Content-Type': resource.mime_type || 'application/octet-stream',
      'Content-Disposition': conversationResourceContentDisposition(resource, { download: req.query.download === '1' }),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    for await (const chunk of stream) res.write(chunk);
    console.info('CONVERSATION_RESOURCE_ACCESS stage=STREAM_RESPONSE status=OK');
    return res.end();
  } catch (error) {
    const failure = classifyConversationResourceAccessFailure(stage, error);
    console.info('CONVERSATION_RESOURCE_ACCESS stage=' + stage + ' status=FAIL code=' + failure.code);
    if (res.headersSent) return res.end();
    return res.status(failure.status).json({ error: 'Attachment unavailable', code: failure.code });
  }
});
router.get('/:tenantId/conversations/:conversationId/events', requireTenantAccess, async (req, res) => {
  const currentTenantId = tenantId(req, res);
  if (!currentTenantId) return;
  if (!isValidUUID(req.params.conversationId)) return res.status(400).json({ error: 'Invalid conversation ID' });

  try {
    const details = await conversationContext(currentTenantId, req.params.conversationId);
    if (!details) return res.status(404).json({ error: 'Conversation not found' });
    return res.json(await listConversationEvents({ tenantId: currentTenantId, conversationId: req.params.conversationId }));
  } catch (error) {
    return operationError(res, error, 'List conversation audit events error:');
  }
});

router.get('/:tenantId/conversations/:conversationId', requireTenantAccess, async (req, res) => {
  const currentTenantId = tenantId(req, res);
  if (!currentTenantId) return;
  if (!isValidUUID(req.params.conversationId)) return res.status(400).json({ error: 'Invalid conversation ID' });

  try {
    const details = await conversationContext(currentTenantId, req.params.conversationId);
    if (!details) return res.status(404).json({ error: 'Conversation not found' });
    return res.json(details);
  } catch (error) {
    console.error('Fetch tenant conversation error:', error?.code ?? error?.name ?? 'unknown');
    return res.status(500).json({ error: 'Server error' });
  }
});

for (const [path, action] of [
  ['takeover', 'takeover'],
  ['return-to-ai', 'return_to_ai'],
  ['pause', 'pause'],
  ['resume', 'resume'],
  ['close', 'close'],
]) {
  router.post(`/:tenantId/conversations/:conversationId/${path}`, requireTenantAccess, async (req, res) => {
    const currentTenantId = tenantId(req, res);
    if (!currentTenantId) return;
    if (!isValidUUID(req.params.conversationId)) return res.status(400).json({ error: 'Invalid conversation ID' });

    try {
      const conversation = await operateConversation({
        tenantId: currentTenantId,
        conversationId: req.params.conversationId,
        actor: actor(req),
        action,
      });
      return res.json({ conversation });
    } catch (error) {
      return operationError(res, error, 'Conversation operation error:');
    }
  });
}

router.post('/:tenantId/conversations/:conversationId/messages', requireTenantAccess, async (req, res) => {
  const currentTenantId = tenantId(req, res);
  if (!currentTenantId) return;
  if (!isValidUUID(req.params.conversationId)) return res.status(400).json({ error: 'Invalid conversation ID' });
  if (typeof req.body?.content !== 'string' || !req.body.content.trim() || req.body.content.trim().length > 8000) {
    return res.status(400).json({ error: 'Message content must be between 1 and 8000 characters' });
  }
  const idempotencyKey = req.get('Idempotency-Key') ?? null;
  if (idempotencyKey && (idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey))) {
    return res.status(400).json({ error: 'Invalid idempotency key' });
  }

  try {
    const result = await appendAgentMessage({
      tenantId: currentTenantId,
      conversationId: req.params.conversationId,
      actor: actor(req),
      content: req.body.content.trim(),
      idempotencyKey,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return operationError(res, error, 'Create human conversation message error:');
  }
});


router.post('/:tenantId/conversations/:conversationId/media', requireTenantAccess, agentMediaUpload.single('file'), async (req, res) => {
  const currentTenantId = tenantId(req, res);
  if (!currentTenantId) return;
  if (!isValidUUID(req.params.conversationId)) return res.status(400).json({ error: 'Invalid conversation ID' });
  if (!req.file) return res.status(400).json({ error: 'A single attachment file is required' });
  const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim().slice(0, 1024) : '';
  const idempotencyKey = req.get('Idempotency-Key') ?? null;
  if (idempotencyKey && (idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey))) {
    return res.status(400).json({ error: 'Invalid idempotency key' });
  }

  try {
    const result = await appendAgentMediaMessage({
      tenantId: currentTenantId,
      conversationId: req.params.conversationId,
      actor: actor(req),
      file: req.file,
      caption,
      idempotencyKey,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return operationError(res, error, 'Create human conversation media error:');
  }
});


export default router;
