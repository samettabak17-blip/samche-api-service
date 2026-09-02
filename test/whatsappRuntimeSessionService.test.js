import assert from 'node:assert/strict';
import test from 'node:test';
import { whatsappRuntimeSessionKey } from '../services/whatsapp-runtime-session-service.js';

test('scopes in-memory WhatsApp runtime state by tenant, Assistant, and customer phone', () => {
  const blue = whatsappRuntimeSessionKey({
    tenantId: '11111111-1111-4111-8111-111111111111',
    assistantId: '22222222-2222-4222-8222-222222222222',
    customerPhone: '971500000001',
  });
  const otherTenant = whatsappRuntimeSessionKey({
    tenantId: '33333333-3333-4333-8333-333333333333',
    assistantId: '22222222-2222-4222-8222-222222222222',
    customerPhone: '971500000001',
  });
  const otherAssistant = whatsappRuntimeSessionKey({
    tenantId: '11111111-1111-4111-8111-111111111111',
    assistantId: '44444444-4444-4444-8444-444444444444',
    customerPhone: '971500000001',
  });

  assert.notEqual(blue, otherTenant);
  assert.notEqual(blue, otherAssistant);
  assert.match(blue, /^[a-f0-9]{64}$/);
});
