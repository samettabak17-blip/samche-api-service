import express from 'express';
import { authenticateToken, requireTenantAccess } from '../middleware/auth.js';
import { isValidUUID } from '../middleware/validators.js';
import {
  appendAgentMessage,
  ConversationOperationError,
  listConversationEvents,
  operateConversation,
} from '../services/live-inbox-service.js';
import { startLiveEventListener, subscribeTenantEvents } from '../services/live-event-bus.js';

const router = express.Router();

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
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error(label, error?.code ?? error?.name ?? 'unknown');
  return res.status(500).json({ error: 'Server error' });
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
       latest.content AS last_message_preview,
       latest.created_at AS last_message_at
     FROM conversations c
     JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
     LEFT JOIN ai_assistants a ON a.id = tc.assistant_id AND a.tenant_id = tc.tenant_id
     LEFT JOIN users assigned ON assigned.id = c.assigned_agent_user_id
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
  return result.rows[0] ?? null;
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
  if (status && !['open', 'closed', 'archived'].includes(status)) return res.status(400).json({ error: 'Invalid conversation status' });
  if (handlingMode && !['AI', 'HUMAN', 'PAUSED'].includes(handlingMode)) return res.status(400).json({ error: 'Invalid handling mode' });

  try {
    const { query } = await import('../config/db.js');
    const result = await query(
      `SELECT
         c.*,
         tc.channel_type,
         tc.display_name AS channel_display_name,
         a.name AS assistant_name,
         assigned.email AS assigned_agent_email,
         latest.content AS last_message_preview,
         latest.created_at AS last_message_at
       FROM conversations c
       JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
       LEFT JOIN ai_assistants a ON a.id = tc.assistant_id AND a.tenant_id = tc.tenant_id
       LEFT JOIN users assigned ON assigned.id = c.assigned_agent_user_id
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
       ORDER BY c.last_activity_at DESC, c.created_at DESC
       LIMIT $4 OFFSET $5`,
      [currentTenantId, status ?? null, handlingMode ?? null, page.limit, page.offset]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('List tenant conversations error:', error?.code ?? error?.name ?? 'unknown');
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
       ORDER BY m.created_at ASC
       LIMIT $3 OFFSET $4`,
      [currentTenantId, req.params.conversationId, page.limit, page.offset]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('List conversation messages error:', error?.code ?? error?.name ?? 'unknown');
    return res.status(500).json({ error: 'Server error' });
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

export default router;
