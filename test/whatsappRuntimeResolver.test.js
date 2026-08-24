import assert from 'node:assert/strict';
import test from 'node:test';
import { getWhatsAppRuntimeDatabaseFingerprint, resolveWhatsAppIntegration, whatsappPhoneNumberFingerprint } from '../services/whatsapp-live-inbox-service.js';

function resolverClient(row) {
  return {
    async query(sql, parameters) {
      assert.match(sql, /WHERE ci\.integration_key = \$1/);
      assert.deepEqual(parameters, ['WHATSAPP:948536645017374']);
      return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
    },
  };
}

test('resolves only the exact enabled active WhatsApp integration key used by inbound routing', async () => {
  const integration = await resolveWhatsAppIntegration(resolverClient({
    tenant_id: '11111111-1111-4111-8111-111111111111',
    channel_id: '22222222-2222-4222-8222-222222222222',
    assistant_id: '33333333-3333-4333-8333-333333333333',
    channel_type: 'WHATSAPP',
    channel_status: 'active',
    assistant_status: 'active',
  }), '948536645017374');

  assert.equal(integration.tenant_id, '11111111-1111-4111-8111-111111111111');
});

test('does not resolve an inactive exact WhatsApp integration', async () => {
  const integration = await resolveWhatsAppIntegration(resolverClient({
    tenant_id: '11111111-1111-4111-8111-111111111111',
    channel_id: '22222222-2222-4222-8222-222222222222',
    assistant_id: '33333333-3333-4333-8333-333333333333',
    channel_type: 'WHATSAPP',
    channel_status: 'inactive',
    assistant_status: 'active',
  }), '948536645017374');

  assert.equal(integration, null);
});

test('derives a safe stable runtime database identity without exposing connection settings', async () => {
  const first = await getWhatsAppRuntimeDatabaseFingerprint({
    async query() {
      return { rows: [{ database_name: 'staging_db', schema_name: 'public', server_address: '10.0.0.8', server_port: '5432' }] };
    },
  });
  const second = await getWhatsAppRuntimeDatabaseFingerprint({
    async query() {
      return { rows: [{ database_name: 'staging_db', schema_name: 'public', server_address: '10.0.0.8', server_port: '5432' }] };
    },
  });

  assert.match(first, /^[a-f0-9]{16}$/);
  assert.equal(first, second);
});

test('uses a stable opaque fingerprint for the inbound WhatsApp phone identifier', () => {
  const known = whatsappPhoneNumberFingerprint('948536645017374');

  assert.match(known, /^[a-f0-9]{16}$/);
  assert.equal(known, whatsappPhoneNumberFingerprint('948536645017374'));
  assert.notEqual(known, whatsappPhoneNumberFingerprint('948536645017375'));
});
