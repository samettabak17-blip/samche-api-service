import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crmContactIdentity,
  shouldCreateLeadForConversation,
} from '../services/crm-lead-service.js';

test('anonymous Samcheguide identity is deterministic and tenant-scoped without fabricated PII', () => {
  const first = crmContactIdentity({
    tenantId: 'tenant-a',
    source: 'SAMCHEGUIDE',
    externalCustomerId: 'samcheguide:opaque-session-reference',
  });
  const repeated = crmContactIdentity({
    tenantId: 'tenant-a',
    source: 'SAMCHEGUIDE',
    externalCustomerId: 'samcheguide:opaque-session-reference',
  });
  const otherTenant = crmContactIdentity({
    tenantId: 'tenant-b',
    source: 'SAMCHEGUIDE',
    externalCustomerId: 'samcheguide:opaque-session-reference',
  });

  assert.equal(first.kind, 'ANONYMOUS_SESSION');
  assert.equal(first.identityHash, repeated.identityHash);
  assert.notEqual(first.identityHash, otherTenant.identityHash);
  assert.equal(first.displayName, null);
  assert.equal(first.email, null);
  assert.equal(first.phone, null);
});

test('a conversation creates only one CRM lead relationship', () => {
  assert.equal(shouldCreateLeadForConversation({ existingLeadId: null }), true);
  assert.equal(shouldCreateLeadForConversation({ existingLeadId: 'lead-id' }), false);
});

