import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AssistantModelAccessError,
  assertAssistantModelWriteAllowed,
  serializeAssistantForActor,
} from '../services/assistant-model-access-policy.js';

test('CUSTOMER cannot submit a model when creating or updating an assistant', () => {
  for (const payload of [{ model: 'gpt-4o-mini' }, { model: 'gemini-3-flash-preview' }]) {
    assert.throws(
      () => assertAssistantModelWriteAllowed({ systemRole: 'CUSTOMER', payload }),
      (error) => error instanceof AssistantModelAccessError && error.code === 'ASSISTANT_MODEL_CUSTOMER_FORBIDDEN',
    );
  }
});

test('OWNER retains model management and customer responses omit implementation model details', () => {
  const assistant = { id: 'assistant-1', tenant_id: 'tenant-a', name: 'Blue Dune', model: 'gpt-4o-mini', status: 'active' };
  assert.doesNotThrow(() => assertAssistantModelWriteAllowed({ systemRole: 'OWNER', payload: { model: 'gemini-3-flash-preview' } }));
  assert.equal(serializeAssistantForActor(assistant, 'CUSTOMER').model, undefined);
  assert.equal(serializeAssistantForActor(assistant, 'CUSTOMER').name, 'Blue Dune');
  assert.equal(serializeAssistantForActor(assistant, 'OWNER').model, 'gpt-4o-mini');
});

test('tenant assistant API applies the customer model policy on create and update and serializes customer responses', () => {
  const source = fs.readFileSync(new URL('../routes/tenantRoutes.js', import.meta.url), 'utf8');
  assert.match(source, /router\.post\([\s\S]*?\/:tenantId\/assistants[\s\S]*?assertAssistantModelWriteAllowed/s);
  assert.match(source, /router\.put\([\s\S]*?\/:tenantId\/assistants\/:assistantId[\s\S]*?assertAssistantModelWriteAllowed/s);
  assert.match(source, /result\.rows\.map\(\(assistant\) => serializeAssistantForActor\(assistant, req\.user\.system_role\)\)/);
});
