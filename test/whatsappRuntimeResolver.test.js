import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getWhatsAppRuntimeDatabaseFingerprint,
  resolveWhatsAppIntegration,
  whatsappPhoneNumberFingerprint,
} from '../services/whatsapp-live-inbox-service.js';

function canonicalResolverClient(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes('FROM tenant_channels tc')) {
        assert.deepEqual(parameters, ['948536645017374']);
        return { rowCount: rows.length, rows };
      }
      if (sql.includes('INSERT INTO channel_integrations')) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

const activeCanonicalRow = {
  tenant_id: '11111111-1111-4111-8111-111111111111',
  channel_id: '22222222-2222-4222-8222-222222222222',
  assistant_id: '33333333-3333-4333-8333-333333333333',
  channel_assistant_id: '33333333-3333-4333-8333-333333333333',
  external_channel_id: '948536645017374',
  channel_type: 'WHATSAPP',
  channel_status: 'active',
  assistant_status: 'active',
};

test('resolves only one normalized active canonical tenant_channels owner and converges its integration projection', async () => {
  const client = canonicalResolverClient([activeCanonicalRow]);
  const integration = await resolveWhatsAppIntegration(client, 'whatsapp: 9485 3664-5017-374');

  assert.equal(integration.tenant_id, activeCanonicalRow.tenant_id);
  assert.equal(integration.external_channel_id, '948536645017374');
  const convergence = client.calls.find(({ sql }) => sql.includes('INSERT INTO channel_integrations'));
  assert.ok(convergence);
  assert.deepEqual(convergence.parameters.slice(0, 4), [
    'whatsapp:948536645017374',
    activeCanonicalRow.tenant_id,
    activeCanonicalRow.channel_id,
    activeCanonicalRow.assistant_id,
  ]);
});

test('fails closed when canonical ownership is absent instead of falling back to stale integration history', async () => {
  const client = canonicalResolverClient([]);
  const integration = await resolveWhatsAppIntegration(client, '948536645017374');

  assert.equal(integration, null);
  assert.ok(!client.calls.some(({ sql }) => sql.includes('FROM channel_integrations ci')));
});

test('fails closed when more than one canonical active owner is observed', async () => {
  const client = canonicalResolverClient([
    activeCanonicalRow,
    { ...activeCanonicalRow, tenant_id: '44444444-4444-4444-8444-444444444444', channel_id: '55555555-5555-4555-8555-555555555555' },
  ]);
  const integration = await resolveWhatsAppIntegration(client, '948536645017374');

  assert.equal(integration, null);
  assert.ok(!client.calls.some(({ sql }) => sql.includes('INSERT INTO channel_integrations')));
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
