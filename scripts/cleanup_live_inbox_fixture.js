import crypto from 'crypto';
import pg from 'pg';

const databaseUrl = process.env.STAGING_DATABASE_URL;
const sessionId = process.env.LIVE_INBOX_SESSION_ID;
const agentEmail = process.env.LIVE_INBOX_AGENT_EMAIL;

if (!databaseUrl || !sessionId || !agentEmail) {
  console.error('Required staging cleanup configuration is missing.');
  process.exit(1);
}

const externalConversationId = 'samcheguide:' + crypto.createHash('sha256').update(String(sessionId)).digest('hex');
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const conversations = await client.query(
    'SELECT id, tenant_id FROM conversations WHERE external_conversation_id = $1 FOR UPDATE',
    [externalConversationId]
  );

  for (const conversation of conversations.rows) {
    await client.query(
      'DELETE FROM conversation_audit_events WHERE tenant_id = $1 AND conversation_id = $2',
      [conversation.tenant_id, conversation.id]
    );
    await client.query(
      'DELETE FROM conversation_messages WHERE tenant_id = $1 AND conversation_id = $2',
      [conversation.tenant_id, conversation.id]
    );
    await client.query(
      'DELETE FROM conversations WHERE tenant_id = $1 AND id = $2',
      [conversation.tenant_id, conversation.id]
    );
  }

  await client.query(
    `DELETE FROM tenant_users
      WHERE user_id IN (SELECT id FROM users WHERE email = $1)`,
    [agentEmail]
  );
  await client.query('DELETE FROM users WHERE email = $1', [agentEmail]);

  await client.query('COMMIT');
  console.log('PASS | CLEANUP | live inbox fixture records removed');
} catch (error) {
  await client.query('ROLLBACK');
  console.error('FAIL | CLEANUP | live inbox fixture records could not be removed');
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
