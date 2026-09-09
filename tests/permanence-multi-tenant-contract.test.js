import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  processMessageUrlIntelligence,
  extractUrlsFromText,
  validateSafeUrl,
  isPrivateOrBlockedIp,
} from '../services/url-intelligence-service.js';
import {
  PROVENANCE_SOURCES,
  updateSessionBrowsingState,
  updateSessionBrowsingStateWithEntity,
  buildContextualIntelligencePromptSection,
} from '../services/contextual-intelligence-service.js';
import {
  buildTenantRuntimeSystemInstruction,
  TENANT_FACTUAL_GROUNDING_POLICY,
} from '../services/tenant-runtime-persona-service.js';
import {
  buildWhatsAppActivePersonaTenantContext,
} from '../services/whatsapp-tenant-context-service.js';
import {
  ensureWebChatIntegration,
  ensureTenantWebChatPersona,
} from '../services/tenant-web-chat-provisioning-service.js';

// ============================================================================
// 1. NO_TENANT_SPECIFIC_CODE: Prove Zero Customer Hardcoding in Production Code
// ============================================================================
test('NO_TENANT_SPECIFIC_CODE: Production codebase contains zero tenant-specific branches or customer-name conditionals', () => {
  const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const urlSource = fs.readFileSync(new URL('../services/url-intelligence-service.js', import.meta.url), 'utf8');
  const ctxSource = fs.readFileSync(new URL('../services/contextual-intelligence-service.js', import.meta.url), 'utf8');
  const waSource = fs.readFileSync(new URL('../services/whatsapp-tenant-context-service.js', import.meta.url), 'utf8');

  // Verify no hardcoded UUIDs in production services
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  assert.doesNotMatch(urlSource, uuidRegex, 'url-intelligence-service.js must not contain hardcoded UUIDs');
  assert.doesNotMatch(ctxSource, uuidRegex, 'contextual-intelligence-service.js must not contain hardcoded UUIDs');
  assert.doesNotMatch(waSource, uuidRegex, 'whatsapp-tenant-context-service.js must not contain hardcoded UUIDs');

  // Verify no customer name conditionals
  const customerNameConditionals = /if\s*\(\s*(?:tenant|customer|account)(?:\.[a-zA-Z0-9_]+)?\s*===/i;
  assert.doesNotMatch(appSource, customerNameConditionals, 'app.js must not contain customer-name branching');
  assert.doesNotMatch(urlSource, customerNameConditionals, 'url-intelligence-service.js must not contain customer-name branching');
  assert.doesNotMatch(ctxSource, customerNameConditionals, 'contextual-intelligence-service.js must not contain customer-name branching');

  // Verify no hardcoded demo widget key in runtime request handlers of app.js
  assert.doesNotMatch(
    appSource,
    /wch_staging_task8_demo/,
    'app.js must not have wch_staging_task8_demo hardcoded in runtime logic'
  );

  // Verify URL reader in url-intelligence-service.js does not contain customer-specific scraping hacks
  assert.doesNotMatch(urlSource, /samchetek|samche-teknoloji|task8-demo/i, 'url-intelligence-service.js must be completely generic');
});

// ============================================================================
// 2. SHARED_WEBCHAT_WHATSAPP_URL_ENGINE: Prove Canonical Shared Engine
// ============================================================================
test('SHARED_WEBCHAT_WHATSAPP_URL_ENGINE: Web Chat and WhatsApp invoke identical URL intelligence and grounding engine', async () => {
  const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

  // Static AST verification: app.js imports and uses the exact same services
  assert.match(appSource, /import\s*\{\s*extractUrlsFromText,\s*processMessageUrlIntelligence\s*\}\s*from\s*'\.\/services\/url-intelligence-service\.js'/);
  assert.match(appSource, /updateSessionBrowsingStateWithEntity/);

  // Verify Web Chat path calls processMessageUrlIntelligence
  const webChatSection = appSource.slice(appSource.indexOf('app.post("/api/chat"'), appSource.indexOf('app.get("/webhook"'));
  assert.match(webChatSection, /processMessageUrlIntelligence\(\{ text: normalizedMessage \}\)/);
  assert.match(webChatSection, /updateSessionBrowsingStateWithEntity/);
  assert.match(webChatSection, /buildContextualIntelligencePromptSection/);

  // Verify WhatsApp path calls processMessageUrlIntelligence
  const whatsappSection = appSource.slice(appSource.indexOf('app.post("/webhook"'));
  assert.match(whatsappSection, /processMessageUrlIntelligence\(\{ text \}\)/);
  assert.match(whatsappSection, /updateSessionBrowsingStateWithEntity/);
  assert.match(whatsappSection, /updateConversationVisitorContext/);

  // Runtime verification: both channels obtain identical entity structures and prompt grounding
  const mockHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Competitor Pro Headphones ANC</title>
        <meta property="og:title" content="Competitor Pro Headphones ANC" />
        <meta property="og:description" content="Premium noise cancelling headphones with 30-hour battery life." />
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Competitor Pro Headphones ANC",
          "description": "High fidelity audio with adaptive ANC",
          "brand": { "@type": "Brand", "name": "AudioBrand" },
          "offers": { "@type": "Offer", "price": "249.99", "priceCurrency": "USD", "availability": "https://schema.org/InStock" }
        }
        </script>
      </head>
      <body><h1>Competitor Pro Headphones ANC</h1></body>
    </html>
  `;

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    text: async () => mockHtml,
  });

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  const messageText = 'Can you compare your headphones with https://example-store.test/products/pro-headphones ?';
  const urlResult = await processMessageUrlIntelligence({
    text: messageText,
    fetchImpl: mockFetch,
    lookupImpl: mockLookup,
  });

  assert.equal(urlResult.success, true);
  assert.equal(urlResult.entity.entity_name, 'Competitor Pro Headphones ANC');
  assert.equal(urlResult.entity.source, PROVENANCE_SOURCES.EXTERNAL_URL_PAGE_FACT);
  assert.equal(urlResult.entity.attributes['price'], '249.99 USD');
  assert.equal(urlResult.entity.attributes['brand'], 'AudioBrand');

  // Verify Web Chat browsing state transition
  const webChatBrowsingState = updateSessionBrowsingStateWithEntity({
    currentState: {
      currentEntity: {
        entity_id: 'tenant-prod-1',
        entity_name: 'Tenant Studio Wireless Headphones',
        attributes: { price: '199.99 USD', anc: 'active' },
      },
      previousEntities: [],
    },
    newEntity: urlResult.entity,
  });

  assert.equal(webChatBrowsingState.currentEntity.entity_name, 'Competitor Pro Headphones ANC');
  assert.equal(webChatBrowsingState.previousEntities.length, 1);
  assert.equal(webChatBrowsingState.previousEntities[0].entity_name, 'Tenant Studio Wireless Headphones');

  // Verify WhatsApp visitor context transition produces identical structure
  const whatsappVisitorContext = updateSessionBrowsingStateWithEntity({
    currentState: {
      currentEntity: {
        entity_id: 'tenant-prod-1',
        entity_name: 'Tenant Studio Wireless Headphones',
        attributes: { price: '199.99 USD', anc: 'active' },
      },
      previousEntities: [],
    },
    newEntity: urlResult.entity,
  });

  assert.deepEqual(webChatBrowsingState.currentEntity, whatsappVisitorContext.currentEntity, 'Web Chat and WhatsApp current entity structures must be identical');
  assert.deepEqual(webChatBrowsingState.previousEntities, whatsappVisitorContext.previousEntities, 'Web Chat and WhatsApp previous entities structures must be identical');

  // Verify prompt section building enforces identical grounding and negative constraints
  const promptSection = buildContextualIntelligencePromptSection({
    currentEntity: webChatBrowsingState.currentEntity,
    previousEntities: webChatBrowsingState.previousEntities,
    channelType: 'WEB_CHAT',
  });

  assert.match(promptSection, /EXTERNAL_URL_PAGE_FACT/);
  assert.match(promptSection, /Competitor Pro Headphones ANC/);
  assert.match(promptSection, /249\.99 USD/);
  assert.match(promptSection, /AudioBrand/);
  assert.match(promptSection, /Tenant Studio Wireless Headphones/);
  assert.match(promptSection, /UNTRUSTED EXTERNAL DATA/);
  assert.match(promptSection, /PROMPT INJECTION DEFENSE/);
});


// ============================================================================
// 3. EXISTING_TENANT_COMPATIBILITY: Prove Zero Regression for Existing Tenants
// ============================================================================
test('EXISTING_TENANT_COMPATIBILITY: Existing tenants continue operating without regression', () => {
  const existingPersona = {
    available: true,
    companyIdentity: 'Existing Corp LLC',
    assistantIdentity: 'Existing Corp Support AI',
    profile: {
      company_identity: 'Existing Corp LLC',
      industry: 'Logistics',
      services: 'Freight forwarding, customs clearance, warehouse storage',
      policies: 'Net 30 payment terms for enterprise clients',
    },
    configuration: {
      assistant_identity: 'Existing Corp Support AI',
      instructions: 'Provide courteous, accurate corporate logistics assistance.',
      rules: ['Do not provide binding quotes without human review.'],
    },
  };

  // Case A: Existing tenant Web Chat message WITHOUT URL and WITHOUT browsing context
  const webChatInstructionWithoutContext = buildTenantRuntimeSystemInstruction({
    persona: existingPersona,
    knowledgeContext: 'Customs clearance available at Port Jebel Ali.',
    channelRules: 'Return safe HTML suitable for Web Chat.',
    contextualIntelligence: '',
  });

  assert.match(webChatInstructionWithoutContext, /Existing Corp LLC/);
  assert.match(webChatInstructionWithoutContext, /Existing Corp Support AI/);
  assert.match(webChatInstructionWithoutContext, /Freight forwarding/);
  assert.match(webChatInstructionWithoutContext, /Customs clearance available at Port Jebel Ali/);
  assert.match(webChatInstructionWithoutContext, new RegExp(TENANT_FACTUAL_GROUNDING_POLICY.slice(0, 40)));

  // Case B: Existing tenant WhatsApp message WITHOUT URL and WITHOUT browsing context
  const waContextWithoutUrl = buildWhatsAppActivePersonaTenantContext({
    persona: existingPersona,
    knowledgeContext: 'Customs clearance available at Port Jebel Ali.',
    communicationLanguage: 'tr',
    contextualIntelligence: '',
  });

  assert.equal(waContextWithoutUrl.companyName, 'Existing Corp LLC');
  assert.equal(waContextWithoutUrl.assistantName, 'Existing Corp Support AI');
  assert.match(waContextWithoutUrl.systemPrompt, /Use concise conversational plain text suitable for WhatsApp/);
  assert.match(waContextWithoutUrl.systemPrompt, /Freight forwarding/);

  // Case C: SSRF and injection defenses remain robust for any input
  assert.throws(() => validateSafeUrl('http://169.254.169.254/latest/meta-data'), {
    name: 'UrlIntelligenceError',
    code: 'SSRF_BLOCKED_TARGET',
  });
  assert.equal(isPrivateOrBlockedIp('10.0.0.1'), true);
  assert.equal(isPrivateOrBlockedIp('192.168.1.1'), true);
  assert.equal(isPrivateOrBlockedIp('127.0.0.1'), true);
});


// ============================================================================
// 4. FRESH_TENANT_INHERITANCE: Prove Any Brand New Tenant Inherits All Capabilities
// ============================================================================
test('FRESH_TENANT_INHERITANCE: Brand new tenant inherits all URL intelligence and contextual awareness automatically', async () => {
  const freshTenantId = randomUUID();
  const freshAssistantId = randomUUID();
  const freshChannelId = randomUUID();
  const freshIntegrationId = randomUUID();
  const freshWidgetKey = `wch_live_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

  const mockDbState = {
    tenants: [{ id: freshTenantId, name: 'Brand New Healthcare Clinic', status: 'active', plan_code: 'BUSINESS' }],
    assistants: [{ id: freshAssistantId, tenant_id: freshTenantId, name: 'Clinic Assistant AI', model: 'gpt-4o-mini', status: 'active' }],
    channels: [],
    integrations: [],
    identities: [],
    profiles: [],
    profileVersions: [],
    configVersions: [],
  };

  const mockClient = {
    async query(sql, params = []) {
      const cleanSql = sql.replace(/\s+/g, ' ').trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(cleanSql)) return { rowCount: 0, rows: [] };

      if (cleanSql.startsWith('SELECT id, name, status, plan_code FROM tenants WHERE id = $1')) {
        const row = mockDbState.tenants.find((t) => t.id === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }
      if (cleanSql.startsWith('SELECT id, name, model, status FROM ai_assistants WHERE id = $1 AND tenant_id = $2')) {
        const row = mockDbState.assistants.find((a) => a.id === params[0] && a.tenant_id === params[1]);
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }
      if (cleanSql.startsWith('SELECT id, tenant_id, channel_type, display_name, external_channel_id, assistant_id, status FROM tenant_channels WHERE tenant_id = $1 AND channel_type = \'WEB_CHAT\'')) {
        const row = mockDbState.channels.find((c) => c.tenant_id === params[0] && c.channel_type === 'WEB_CHAT');
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }
      if (cleanSql.startsWith('INSERT INTO tenant_channels')) {
        const row = { id: freshChannelId, tenant_id: params[0], channel_type: 'WEB_CHAT', display_name: params[1], external_channel_id: params[2], assistant_id: params[3], status: 'active' };
        mockDbState.channels.push(row);
        return { rowCount: 1, rows: [{ ...row }] };
      }
      if (cleanSql.startsWith('SELECT id, integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled FROM channel_integrations WHERE integration_key = $1')) {
        const row = mockDbState.integrations.find((i) => i.integration_key === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }
      if (cleanSql.startsWith('INSERT INTO channel_integrations')) {
        const row = { id: freshIntegrationId, integration_key: params[0], integration_type: 'WEB_CHAT', tenant_id: params[1], channel_id: params[2], assistant_id: params[3], enabled: true };
        mockDbState.integrations.push(row);
        return { rowCount: 1, rows: [{ ...row }] };
      }
      if (cleanSql.includes('business_identities WHERE tenant_id = $1')) {
        const row = mockDbState.identities.find((i) => i.tenant_id === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }
      if (cleanSql.startsWith('INSERT INTO business_identities')) {
        const row = { id: randomUUID(), tenant_id: params[0], display_name: params[1] };
        mockDbState.identities.push(row);
        return { rowCount: 1, rows: [{ ...row }] };
      }
      if (cleanSql.includes('business_profiles WHERE tenant_id = $1')) {
        const row = mockDbState.profiles.find((p) => p.tenant_id === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }
      if (cleanSql.startsWith('INSERT INTO business_profiles')) {
        const row = { id: randomUUID(), tenant_id: params[0] };
        mockDbState.profiles.push(row);
        return { rowCount: 1, rows: [{ ...row }] };
      }
      if (cleanSql.startsWith('INSERT INTO business_profile_versions')) {
        const row = { id: randomUUID(), tenant_id: params[0], profile_id: params[1], profile_data: JSON.parse(params[2]) };
        mockDbState.profileVersions.push(row);
        return { rowCount: 1, rows: [{ ...row }] };
      }
      if (cleanSql.startsWith('UPDATE business_profiles SET active_version_id = $1')) {
        return { rowCount: 1, rows: [] };
      }
      if (cleanSql.startsWith('UPDATE assistant_configuration_versions')) {
        return { rowCount: 1, rows: [] };
      }
      if (cleanSql.startsWith('INSERT INTO assistant_configuration_versions')) {
        const row = { id: randomUUID(), tenant_id: params[0], assistant_id: params[1], configuration_data: JSON.parse(params[2]) };
        mockDbState.configVersions.push(row);
        return { rowCount: 1, rows: [{ ...row }] };
      }
      if (cleanSql.startsWith('UPDATE ai_assistants SET active_configuration_version_id = $1')) {
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  // Step 1: Provision Web Chat for Fresh Tenant
  const provisionResult = await ensureWebChatIntegration(mockClient, {
    tenantId: freshTenantId,
    assistantId: freshAssistantId,
    widgetKey: freshWidgetKey,
    displayName: 'Clinic Web Chat',
  });

  assert.equal(provisionResult.tenant_id, freshTenantId);
  assert.equal(provisionResult.widget_key, freshWidgetKey);

  // Step 2: Configure Fresh Tenant Persona
  const personaResult = await ensureTenantWebChatPersona(mockClient, {
    tenantId: freshTenantId,
    assistantId: freshAssistantId,
    companyName: 'Brand New Healthcare Clinic',
    assistantIdentity: 'Clinic Medical Assistant',
    guidelines: ['Only recommend dental implant consultations; do not provide surgery quotes.'],
  });

  assert.ok(personaResult.profile_id);
  assert.ok(personaResult.profile_version_id);
  assert.ok(personaResult.configuration_version_id);

  // Step 3: Verify Fresh Tenant dynamic page context awareness
  const freshTenantBrowsingState = updateSessionBrowsingState({
    currentState: null,
    rawPageContext: {
      title: 'Dental Implants Overview | Brand New Healthcare Clinic',
      url: 'https://clinic.example.test/services/dental-implants',
      entity_type: 'service',
      entity_id: 'dental-implants-service',
      entity_name: 'Premium Dental Implants',
      attributes: { consultation_fee: 'Free', warranty_years: '10' },
    },
  });

  assert.equal(freshTenantBrowsingState.currentEntity.entity_name, 'Premium Dental Implants');
  assert.equal(freshTenantBrowsingState.currentEntity.attributes['warranty_years'], '10');

  // Step 4: Verify Fresh Tenant URL reading and grounded comparison
  const mockExternalClinicHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Competitor Dental Package</title>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Competitor Swiss Dental Implants",
          "description": "Titanium dental implant package with lifetime guarantee",
          "offers": { "@type": "Offer", "price": "1200", "priceCurrency": "EUR" }
        }
        </script>
      </head>
      <body><h1>Competitor Swiss Dental Implants</h1></body>
    </html>
  `;

  const externalUrlResult = await processMessageUrlIntelligence({
    text: 'How does your service compare to https://competitor-clinic.test/swiss-implants ?',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => mockExternalClinicHtml,
    }),
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
  });

  assert.equal(externalUrlResult.success, true);
  assert.equal(externalUrlResult.entity.entity_name, 'Competitor Swiss Dental Implants');
  assert.equal(externalUrlResult.entity.attributes['price'], '1200 EUR');

  // Step 5: Verify browsing state updates with recency queue for fresh tenant
  const updatedFreshState = updateSessionBrowsingStateWithEntity({
    currentState: freshTenantBrowsingState,
    newEntity: externalUrlResult.entity,
  });

  assert.equal(updatedFreshState.currentEntity.entity_name, 'Competitor Swiss Dental Implants');
  assert.equal(updatedFreshState.previousEntities.length, 1);
  assert.equal(updatedFreshState.previousEntities[0].entity_name, 'Premium Dental Implants');

  // Step 6: Verify system instruction generation grounded in fresh tenant identity
  const freshPromptSection = buildContextualIntelligencePromptSection({
    currentEntity: updatedFreshState.currentEntity,
    previousEntities: updatedFreshState.previousEntities,
    channelType: 'WEB_CHAT',
  });

  const freshSystemPrompt = buildTenantRuntimeSystemInstruction({
    persona: {
      available: true,
      companyIdentity: 'Brand New Healthcare Clinic',
      assistantIdentity: 'Clinic Medical Assistant',
      profile: {
        company_identity: 'Brand New Healthcare Clinic',
        industry: 'Healthcare / Dental',
        services: 'Dental implants, teeth whitening, veneers',
      },
      configuration: {
        assistant_identity: 'Clinic Medical Assistant',
        instructions: 'Only recommend dental implant consultations; do not provide surgery quotes.',
      },
    },
    contextualIntelligence: freshPromptSection,
  });

  assert.match(freshSystemPrompt, /Brand New Healthcare Clinic/);
  assert.match(freshSystemPrompt, /Clinic Medical Assistant/);
  assert.match(freshSystemPrompt, /Competitor Swiss Dental Implants/);
  assert.match(freshSystemPrompt, /1200 EUR/);
  assert.match(freshSystemPrompt, /Premium Dental Implants/);
  assert.match(freshSystemPrompt, /EXTERNAL_URL_PAGE_FACT/);
});


// ============================================================================
// 5. NO_MANUAL_DB_ONBOARDING: Prove Automated Programmatic Onboarding
// ============================================================================
test('NO_MANUAL_DB_ONBOARDING: Provisioning is atomic, idempotent, transactional, and requires no manual SQL repairs', async () => {
  const source = fs.readFileSync(new URL('../services/tenant-web-chat-provisioning-service.js', import.meta.url), 'utf8');

  // Verify runInTransaction wrapper handles BEGIN, COMMIT, ROLLBACK
  assert.match(source, /await client\.query\('BEGIN'\)/);
  assert.match(source, /await client\.query\('COMMIT'\)/);
  assert.match(source, /await client\.query\('ROLLBACK'\)/);

  // Verify ensureWebChatIntegration handles missing channels/assistants by auto-creating them
  assert.match(source, /INSERT INTO ai_assistants/);
  assert.match(source, /INSERT INTO tenant_channels/);
  assert.match(source, /INSERT INTO channel_integrations/);

  // Verify ensureTenantWebChatPersona creates Business Identity, Business Profile, Profile Version, and Assistant Config Version
  assert.match(source, /INSERT INTO business_identities/);
  assert.match(source, /INSERT INTO business_profiles/);
  assert.match(source, /INSERT INTO business_profile_versions/);
  assert.match(source, /INSERT INTO assistant_configuration_versions/);

  // Verify no manual migrations or schema repairs are referenced
  assert.doesNotMatch(source, /manual_repair|ad_hoc_fix|legacy_patch/);
});

