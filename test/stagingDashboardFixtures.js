import pg from 'pg';

const { Pool } = pg;
const args = process.argv.slice(2);

function value(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function required(name) {
  const result = value(name);
  if (!result) throw new Error('Missing required argument: ' + name);
  return result;
}

const operation = required('--operation');
const databaseUrl = process.env.STAGING_DATABASE_URL;
if (!databaseUrl) throw new Error('STAGING_DATABASE_URL is required');

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

try {
  if (operation === 'create') {
    const tenantId = required('--tenant-id');
    const channelId = required('--channel-id');
    const label = required('--label');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const channel = await client.query(
        'SELECT id FROM tenant_channels WHERE id = $1 AND tenant_id = $2',
        [channelId, tenantId]
      );
      if (channel.rowCount !== 1) throw new Error('Fixture channel is not scoped to the requested tenant');

      const conversation = await client.query(
        'INSERT INTO conversations (tenant_id, channel_id, external_conversation_id, customer_external_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [tenantId, channelId, 'ci-conversation-' + label, 'ci-customer-' + label, 'open']
      );
      const conversationId = conversation.rows[0].id;
      const message = await client.query(
        'INSERT INTO conversation_messages (tenant_id, conversation_id, external_message_id, sender_type, content) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [tenantId, conversationId, 'ci-message-' + label, 'CUSTOMER', 'Dashboard integration fixture']
      );
      await client.query('COMMIT');
      console.log(JSON.stringify({ conversationId, messageId: message.rows[0].id }));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } else if (operation === 'cleanup') {
    const tenantId = required('--tenant-id');
    const conversationId = required('--conversation-id');
    const messageId = required('--message-id');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM conversation_messages WHERE id = $1 AND conversation_id = $2 AND tenant_id = $3',
        [messageId, conversationId, tenantId]
      );
      await client.query(
        'DELETE FROM conversations WHERE id = $1 AND tenant_id = $2',
        [conversationId, tenantId]
      );
      await client.query('COMMIT');
      console.log(JSON.stringify({ cleaned: true }));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } else {
    throw new Error('Unsupported operation');
  }
} finally {
  await pool.end();
}
