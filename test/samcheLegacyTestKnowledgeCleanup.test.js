import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyKnowledgeItem,
  auditAndCleanSamcheStagingKnowledge,
} from '../scripts/cleanup_samche_legacy_test_knowledge.js';
import {
  SAMCHE_KNOWLEDGE_SOURCES,
  SAMCHE_STAGING_BUSINESS_PROFILE,
  SAMCHE_STAGING_ASSISTANT_CONFIG,
} from '../services/samche-canonical-knowledge-data.js';
import {
  buildTenantRuntimeSystemInstruction,
} from '../services/tenant-runtime-persona-service.js';

const stagingTenantId = '11111111-1111-4111-8111-111111111111';

test('Knowledge Item Classification: Correctly categorizes real, migration, legacy and unknown data', () => {
  // Real Authoritative
  assert.equal(
    classifyKnowledgeItem({
      title: 'samche-whatsapp-master-business-policy.tr.txt',
      content: 'c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58',
    }),
    'REAL SAMCHE AUTHORITATIVE'
  );

  // New Migration
  assert.equal(
    classifyKnowledgeItem({
      title: 'SamChe Company Kurumsal Profil, İletişim ve Banka Bilgileri',
      content: 'SamChe Company LLC Kurumsal Bilgileri...',
    }),
    'NEW SAMCHE MAIN MIGRATION'
  );

  assert.equal(
    classifyKnowledgeItem({
      schema_version: 2,
      profile_data: SAMCHE_STAGING_BUSINESS_PROFILE,
    }),
    'NEW SAMCHE MAIN MIGRATION'
  );

  // Legacy Test / Fixture
  assert.equal(
    classifyKnowledgeItem({
      title: 'Technology Services & Pricing',
      content: 'Foundation Launch Package: 18,900 AED. Growth Accelerator Package: 31,200 AED.',
    }),
    'LEGACY TEST / FIXTURE'
  );

  assert.equal(
    classifyKnowledgeItem({
      title: 'Enterprise Architecture & Cloud',
      content: 'Enterprise Architecture Review: 22,750 AED with Silver Bridge Protocol.',
    }),
    'LEGACY TEST / FIXTURE'
  );

  assert.equal(
    classifyKnowledgeItem({
      schema_version: 1,
      profile_data: {
        company_identity: 'SamChe Company LLC',
        industry: 'Technology Consultancy',
        packages: ['Foundation Launch Package: 18,900 AED', 'Growth Accelerator Package: 31,200 AED'],
      },
    }),
    'LEGACY TEST / FIXTURE'
  );

  // Unknown / Needs Review
  assert.equal(
    classifyKnowledgeItem({
      title: 'Custom Client Note 2026',
      content: 'Special operational guidelines for European trade delegation.',
    }),
    'UNKNOWN / NEEDS REVIEW'
  );
});

test('Staging Knowledge Audit & Cleanup: Safely removes legacy fixtures and preserves real intelligence', async () => {
  const documentsStore = [
    {
      id: 'doc-1',
      tenant_id: stagingTenantId,
      title: 'SamChe Company Kurumsal Profil, İletişim ve Banka Bilgileri',
      content: 'SamChe Company LLC Kurumsal Bilgileri...',
      content_hash: 'hash-1',
      source_type: 'MANUAL',
      status: 'active',
      processing_status: 'READY',
      indexing_status: 'READY',
    },
    {
      id: 'doc-2',
      tenant_id: stagingTenantId,
      title: 'Legacy Tech Consulting Pricing',
      content: 'Foundation Launch Package: 18,900 AED. Growth Accelerator Package: 31,200 AED.',
      content_hash: 'hash-2',
      source_type: 'MANUAL',
      status: 'active',
      processing_status: 'READY',
      indexing_status: 'READY',
    },
    {
      id: 'doc-3',
      tenant_id: stagingTenantId,
      title: 'Custom Undetermined Document',
      content: 'Generic procedural observation for internal review.',
      content_hash: 'hash-3',
      source_type: 'MANUAL',
      status: 'active',
      processing_status: 'READY',
      indexing_status: 'READY',
    },
  ];

  const profileVersionsStore = [
    {
      id: 'bpv-1',
      tenant_id: stagingTenantId,
      profile_id: 'bp-1',
      schema_version: 2,
      profile_data: SAMCHE_STAGING_BUSINESS_PROFILE,
      status: 'APPROVED',
    },
    {
      id: 'bpv-2',
      tenant_id: stagingTenantId,
      profile_id: 'bp-1',
      schema_version: 1,
      profile_data: {
        industry: 'Technology Consultancy',
        packages: ['Foundation Launch Package: 18,900 AED', 'Growth Accelerator Package: 31,200 AED'],
      },
      status: 'SUPERSEDED',
    },
  ];

  const configVersionsStore = [
    {
      id: 'acv-1',
      tenant_id: stagingTenantId,
      assistant_id: 'ast-1',
      schema_version: 2,
      configuration_data: SAMCHE_STAGING_ASSISTANT_CONFIG,
      status: 'ACTIVE',
    },
    {
      id: 'acv-2',
      tenant_id: stagingTenantId,
      assistant_id: 'ast-1',
      schema_version: 1,
      configuration_data: {
        assistant_identity: 'SamChe Test Bot',
        pricing_guidance: 'Quote Foundation Launch Package at 18,900 AED and Growth Accelerator at 31,200 AED.',
      },
      status: 'SUPERSEDED',
    },
  ];

  const chunksStore = [
    {
      id: 'chk-1',
      tenant_id: stagingTenantId,
      source_id: 'doc-1',
      chunk_index: 0,
      section_title: 'SamChe Corporate',
      normalized_text: 'SamChe Company LLC Kurumsal Bilgileri...',
      is_active: true,
    },
    {
      id: 'chk-2',
      tenant_id: stagingTenantId,
      source_id: 'doc-2',
      chunk_index: 0,
      section_title: 'Legacy Tech Consulting Pricing',
      normalized_text: 'Foundation Launch Package: 18,900 AED. Growth Accelerator Package: 31,200 AED. Silver Bridge Protocol.',
      is_active: true,
    },
  ];

  const mockDb = {
    async query(sql, params = []) {
      if (sql.includes('SELECT') && sql.includes('FROM knowledge_base_documents')) {
        return { rows: documentsStore.filter((d) => d.tenant_id === params[0]) };
      }
      if (sql.includes('SELECT') && sql.includes('FROM knowledge_candidates')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT') && sql.includes('FROM business_profile_versions')) {
        return { rows: profileVersionsStore.filter((p) => p.tenant_id === params[0]) };
      }
      if (sql.includes('SELECT') && sql.includes('FROM assistant_configuration_versions')) {
        return { rows: configVersionsStore.filter((c) => c.tenant_id === params[0]) };
      }
      if (sql.includes('SELECT') && sql.includes('FROM knowledge_chunks')) {
        return { rows: chunksStore.filter((c) => c.tenant_id === params[0]) };
      }
      if (sql.includes('DELETE FROM knowledge_chunks')) {
        const ids = params[1];
        const initial = chunksStore.length;
        const remaining = chunksStore.filter((c) => !ids.includes(c.source_id));
        chunksStore.length = 0;
        chunksStore.push(...remaining);
        return { rowCount: initial - remaining.length };
      }
      if (sql.includes('DELETE FROM knowledge_source_assistants') || sql.includes('DELETE FROM knowledge_source_business_identities')) {
        return { rowCount: 1 };
      }
      if (sql.includes('DELETE FROM knowledge_base_documents')) {
        const ids = params[1];
        const initial = documentsStore.length;
        const remaining = documentsStore.filter((d) => !ids.includes(d.id));
        documentsStore.length = 0;
        documentsStore.push(...remaining);
        return { rowCount: initial - remaining.length };
      }
      if (sql.includes('DELETE FROM assistant_configuration_versions')) {
        const ids = params[1];
        const remaining = configVersionsStore.filter((c) => !ids.includes(c.id));
        configVersionsStore.length = 0;
        configVersionsStore.push(...remaining);
        return { rowCount: 1 };
      }
      if (sql.includes('DELETE FROM business_profile_versions')) {
        const ids = params[1];
        const remaining = profileVersionsStore.filter((p) => !ids.includes(p.id));
        profileVersionsStore.length = 0;
        profileVersionsStore.push(...remaining);
        return { rowCount: 1 };
      }
      if (sql.includes('UPDATE')) return { rowCount: 1 };
      if (sql.includes('BEGIN') || sql.includes('COMMIT')) return {};
      return { rows: [] };
    },
  };

  const dryRun = await auditAndCleanSamcheStagingKnowledge({
    database: mockDb,
    tenantId: stagingTenantId,
    execute: false,
  });

  assert.equal(dryRun.mode, 'DRY_RUN');
  assert.equal(dryRun.legacyTestSourcesFound, 1);
  assert.equal(dryRun.legacyBusinessProfileFieldsFound, 1);
  assert.equal(dryRun.unknownItemsPreserved, 1);
  assert.equal(dryRun.itemsRemoved, 0);

  const executed = await auditAndCleanSamcheStagingKnowledge({
    database: mockDb,
    tenantId: stagingTenantId,
    execute: true,
  });

  assert.equal(executed.mode, 'EXECUTED');
  assert.equal(executed.legacyTestSourcesFound, 1);
  assert.equal(executed.itemsRemoved, 3);
  assert.equal(executed.unknownItemsPreserved, 1);
  assert.equal(executed.staleChunksRemaining, 0);
  assert.equal(executed.staleEmbeddingsRemaining, 0);
  assert.equal(executed.staleConfigurationRemaining, 0);

  assert.equal(documentsStore.some((d) => d.id === 'doc-2'), false);
  assert.equal(documentsStore.some((d) => d.id === 'doc-1'), true);
  assert.equal(documentsStore.some((d) => d.id === 'doc-3'), true);
});

test('Non-Contamination Retrieval Test: Proves active SamChe runtime cannot retrieve legacy test fixtures', () => {
  const activePersona = {
    available: true,
    companyIdentity: SAMCHE_STAGING_BUSINESS_PROFILE.company_identity,
    assistantIdentity: SAMCHE_STAGING_ASSISTANT_CONFIG.assistant_identity,
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
    profileVersionId: 'bp-v2-active',
    configurationVersionId: 'cfg-v2-active',
  };

  const activeKnowledgeContext = SAMCHE_KNOWLEDGE_SOURCES
    .map((s) => `[Source: ${s.title}]\n${s.content}`)
    .join('\n\n');

  const systemInstruction = buildTenantRuntimeSystemInstruction({
    persona: activePersona,
    knowledgeContext: activeKnowledgeContext,
    channelRules: 'Instagram natural conversation format',
  });

  const legacyProhibitedPhrases = [
    'Foundation Launch Package',
    'Growth Accelerator Package',
    'Enterprise Architecture Review',
    'Silver Bridge Protocol',
    'Additional team member onboarding',
    '18,900 AED',
    '31,200 AED',
    '22,750 AED',
    '4,450 AED',
    'Technology Consultancy',
  ];

  for (const phrase of legacyProhibitedPhrases) {
    assert.equal(
      systemInstruction.includes(phrase),
      false,
      `Legacy fixture phrase "${phrase}" must NOT be present in active SamChe runtime context`
    );
  }

  assert.ok(systemInstruction.includes('Meydan Free Zone Company Setup'));
  assert.ok(systemInstruction.includes('13.000 AED'));
  assert.ok(systemInstruction.includes('16.800 AED'));
  assert.ok(systemInstruction.includes('8.000 AED'));
  assert.ok(systemInstruction.includes('Management Consulting & Corporate Services'));
});

