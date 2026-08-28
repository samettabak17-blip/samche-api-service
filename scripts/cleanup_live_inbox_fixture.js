import crypto from 'crypto';
import { readFileSync } from 'fs';
import pg from 'pg';

const rawDatabaseUrl = process.env.STAGING_DATABASE_URL;
const agentEmail = process.env.LIVE_INBOX_AGENT_EMAIL;

if (!rawDatabaseUrl || !agentEmail) {
  console.error('Required staging cleanup configuration is missing.');
  process.exit(1);
}

let sessionId;
try {
  sessionId = readFileSync('.live-inbox-public-session-id', 'utf8').trim();
} catch {
  console.error('FAIL | CLEANUP | issued public session id is unavailable');
  process.exit(1);
}

const externalConversationId = 'samcheguide:' + crypto.createHash('sha256').update(String(sessionId)).digest('hex');
const databaseUrl = new URL(rawDatabaseUrl);
const pool = new pg.Pool({
  host: databaseUrl.hostname,
  port: Number(databaseUrl.port || 5432),
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  database: decodeURIComponent(databaseUrl.pathname.replace(/^\//, '')),
  ssl: { rejectUnauthorized: true, servername: databaseUrl.hostname },
});

let client;
try {
  client = await pool.connect();
  const socket = client.connection.stream;
  if (socket?.encrypted !== true || socket?.authorized !== true) {
    throw new Error('TLS_VERIFICATION_FAILED');
  }
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
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error(error?.message === 'TLS_VERIFICATION_FAILED'
    ? 'TLS_VERIFICATION_FAILED'
    : 'FAIL | CLEANUP | live inbox fixture records could not be removed');
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
