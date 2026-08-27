import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicWebChatIntegration } from '../services/public-web-chat-integration-service.js';

test('resolves only an enabled WEB_CHAT integration server-side from an opaque widget key', async () => {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rowCount: 1,
        rows: [{
          tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          channel_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          assistant_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          channel_type: 'WEB_CHAT',
          channel_status: 'active',
          assistant_status: 'active',
        }],
      };
    },
  };

  const integration = await resolvePublicWebChatIntegration({ database, widgetKey: 'widget_public_opaque_key' });

  assert.equal(integration.assistant_id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.equal(calls[0].params[0], 'widget_public_opaque_key');
  assert.match(calls[0].sql, /ci\.integration_type = 'WEB_CHAT'/);
  assert.match(calls[0].sql, /ci\.enabled = TRUE/);
  assert.doesNotMatch(calls[0].sql, /\$2/);
});

test('does not resolve disabled or wrong-channel public identity', async () => {
  const integration = await resolvePublicWebChatIntegration({
    database: { query: async () => ({ rowCount: 1, rows: [{ channel_type: 'WHATSAPP', channel_status: 'active', assistant_status: 'active' }] }) },
    widgetKey: 'widget_public_opaque_key',
  });
  assert.equal(integration, null);
});

