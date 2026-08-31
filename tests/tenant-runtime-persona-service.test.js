import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantRuntimeSystemInstruction, resolveTenantRuntimePersona } from '../services/tenant-runtime-persona-service.js';

const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assistantA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function activeRow(company, assistant, service, price) {
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    configuration_schema_version: 2,
    configuration_data: { schema_version: 2, assistant_identity: assistant, role_and_purpose: `Represent ${company}`, fallback_guidance: 'Say that approved information is unavailable.', supported_languages: ['English'] },
    active_business_profile_version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    profile_schema_version: 2,
    active_business_profile: { schema_version: 2, company_identity: company, company_display_name: company, services: [service], pricing_information: [price] },
  };
}

test('resolves a non-SamChe ACTIVE tenant persona scoped by tenant and Assistant', async () => {
  const calls = [];
  const database = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [activeRow('Meridian Arc Technologies LLC', 'Meridian Client Advisor', 'Enterprise support', '35,650 AED')] }; } };
  const persona = await resolveTenantRuntimePersona({ database, tenantId: tenantA, assistantId: assistantA });
  assert.equal(persona.available, true);
  assert.equal(persona.companyIdentity, 'Meridian Arc Technologies LLC');
  assert.equal(persona.assistantIdentity, 'Meridian Client Advisor');
  assert.deepEqual(calls[0].params, [assistantA, tenantA]);
});

test('mapped runtime fails closed when both ACTIVE V2 artifacts are not proven', async () => {
  const database = { query: async () => ({ rows: [{ id: null, active_business_profile_version_id: null }] }) };
  assert.deepEqual(await resolveTenantRuntimePersona({ database, tenantId: tenantA, assistantId: assistantA }), { available: false, code: 'TENANT_PERSONA_NOT_ACTIVE' });
});

test('fails closed when active configuration copies untrusted platform Assistant metadata', async () => {
  const contaminated = {
    ...activeRow('Northstar Labs Ltd', 'SamChe AI', 'Research automation', 'USD 900'),
    assistant_metadata_name: 'SamChe AI',
  };
  const database = { query: async () => ({ rows: [contaminated] }) };
  assert.deepEqual(
    await resolveTenantRuntimePersona({ database, tenantId: tenantA, assistantId: assistantA }),
    { available: false, code: 'TENANT_PERSONA_NOT_ACTIVE' },
  );
});

test('system instruction contains only resolved tenant business data plus platform safety', async () => {
  const database = { query: async () => ({ rows: [activeRow('Meridian Arc Technologies LLC', 'Meridian Client Advisor', 'Enterprise support', '35,650 AED')] }) };
  const persona = await resolveTenantRuntimePersona({ database, tenantId: tenantA, assistantId: assistantA });
  const instruction = buildTenantRuntimeSystemInstruction({ persona, knowledgeContext: 'Approved marker: SAPPHIRE-7319', channelRules: 'Use plain text.' });
  assert.match(instruction, /Meridian Arc Technologies LLC/);
  assert.match(instruction, /Meridian Client Advisor/);
  assert.match(instruction, /SAPPHIRE-7319/);
  assert.match(instruction, /tenant isolation/i);
  assert.doesNotMatch(instruction, /SamChe|Dubai|company formation/i);
});

test('resolving Tenant B cannot reuse Tenant A identity, service, or price', async () => {
  const database = { query: async (_sql, params) => ({ rows: [params[1] === tenantA ? activeRow('Meridian Arc Technologies LLC', 'Meridian Advisor', 'Enterprise support', '35,650 AED') : activeRow('Northstar Labs Ltd', 'Northstar Advisor', 'Research automation', 'USD 900')] }) };
  const a = await resolveTenantRuntimePersona({ database, tenantId: tenantA, assistantId: assistantA });
  const b = await resolveTenantRuntimePersona({ database, tenantId: tenantB, assistantId: assistantA });
  const bInstruction = buildTenantRuntimeSystemInstruction({ persona: b });
  assert.equal(a.companyIdentity, 'Meridian Arc Technologies LLC');
  assert.match(bInstruction, /Northstar Labs Ltd/);
  assert.doesNotMatch(bInstruction, /Meridian|35,650|Enterprise support/);
});

test('SamChe remains valid only when present in resolved ACTIVE tenant data', async () => {
  const database = { query: async () => ({ rows: [activeRow('SamChe Company LLC', 'SamChe AI', 'Company formation consulting', 'Reviewed tenant pricing')] }) };
  const persona = await resolveTenantRuntimePersona({ database, tenantId: tenantA, assistantId: assistantA });
  const instruction = buildTenantRuntimeSystemInstruction({ persona });
  assert.match(instruction, /SamChe Company LLC/);
  assert.match(instruction, /SamChe AI/);
});

test('AI Guide and Web Chat channel presentation rules cannot inject another business persona', async () => {
  const database = { query: async () => ({ rows: [activeRow('Northstar Labs Ltd', 'Northstar Advisor', 'Research automation', 'USD 900')] }) };
  const persona = await resolveTenantRuntimePersona({ database, tenantId: tenantB, assistantId: assistantA });
  for (const channelRules of ['Return safe HTML for AI Guide.', 'Return safe HTML for Web Chat.']) {
    const instruction = buildTenantRuntimeSystemInstruction({ persona, channelRules });
    assert.match(instruction, /Northstar Labs Ltd/);
    assert.doesNotMatch(instruction, /SamChe|Dubai|company formation|35,650/);
  }
});
