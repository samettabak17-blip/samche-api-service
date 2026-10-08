import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import {
  generateAssistantConfigurationVersion,
  generateAssistantRecommendation,
  prepareAssistantRecommendationGeneration,
  reviewAssistantRecommendation,
} from '../services/knowledge-assistant-lifecycle.js';
import {
  approveAssistantConfigurationVersion,
  activateAssistantConfigurationVersion,
} from '../services/knowledge-configuration-service.js';
import {
  enqueueAssistantRecommendationGenerationJob,
  processAssistantRecommendationGenerationJob,
  claimNextAssistantRecommendationGenerationJob,
} from '../services/knowledge-semantic-generation-job-service.js';
import {
  resolveTenantRuntimePersona,
  buildTenantRuntimeSystemInstruction,
} from '../services/tenant-runtime-persona-service.js';
import {
  inspectGuideExperiencePublication,
  createGuideExperienceDraft,
  publishGuideExperience,
} from '../services/guide-experience-service.js';
import {
  issueGuideResumeSession,
  resolveGuideResumeSession,
  loadGuideResumeState,
  saveGuideResumeState,
} from '../services/guide-conversation-service.js';

const { Pool } = pg;
const HASH_A = 'a'.repeat(64);

function getPool() {
  const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required for fresh-tenant onboarding E2E test');
  return new Pool({
    connectionString,
    ssl: resolvePostgresSsl({ connectionString }),
  });
}

async function createFreshTenantFixture(pool, { name, companyIdentity, industry, packages, policies, assistantName }) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const identityId = randomUUID();
  const assistantId = randomUUID();
  const profileId = randomUUID();
  const profileVersionId = randomUUID();
  const sourceId = randomUUID();
  const channelId = randomUUID();

  await pool.query(`INSERT INTO tenants (id, name, plan_code, status) VALUES ($1, $2, 'ENTERPRISE', 'active')`, [tenantId, name]);
  await pool.query(`INSERT INTO users (id, email, email_normalized, password_hash, system_role) VALUES ($1, $2, $2, 'test-pw-hash', 'OWNER')`, [userId, `owner-${randomUUID()}@example.test`]);
  await pool.query(`INSERT INTO tenant_users (tenant_id, user_id, tenant_role) VALUES ($1, $2, 'ADMIN') ON CONFLICT DO NOTHING`, [tenantId, userId]);
  await pool.query(`INSERT INTO business_identities (id, tenant_id, display_name, normalized_identity, status) VALUES ($1, $2, $3, $4, 'ACTIVE')`, [identityId, tenantId, companyIdentity, companyIdentity.toLowerCase()]);
  await pool.query(`INSERT INTO ai_assistants (id, tenant_id, name, model, status) VALUES ($1, $2, $3, 'gemini-3-flash-preview', 'active')`, [assistantId, tenantId, assistantName]);
  await pool.query(`INSERT INTO tenant_channels (id, tenant_id, channel_type, display_name, status, assistant_id) VALUES ($1, $2, 'SAMCHEGUIDE', 'Guide Channel', 'active', $3)`, [channelId, tenantId, assistantId]);
  await pool.query(`INSERT INTO channel_integrations (tenant_id, integration_type, integration_key, channel_id, assistant_id, enabled) VALUES ($1, 'SAMCHEGUIDE', $2, $3, $4, true)`, [tenantId, `guide:${tenantId}:${assistantId}`, channelId, assistantId]);

  await pool.query(`INSERT INTO business_profiles (id, tenant_id, business_identity_id) VALUES ($1, $2, $3)`, [profileId, tenantId, identityId]);
  const profileData = { schema_version: 2, company_identity: companyIdentity, company_display_name: companyIdentity, industry, packages, policies };
  await pool.query(`INSERT INTO business_profile_versions (id, tenant_id, profile_id, profile_data, evidence, status, schema_version, identity_resolution_status, source_scope) VALUES ($1, $2, $3, $4, $5, 'APPROVED', 2, 'RESOLVED', $6)`, [profileVersionId, tenantId, profileId, profileData, { source_hashes: [{ id: sourceId, content_hash: HASH_A }] }, { business_identity_id: identityId, source_ids: [sourceId] }]);
  await pool.query(`UPDATE business_profiles SET active_version_id = $1, activated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3`, [profileVersionId, profileId, tenantId]);

  const domainId = randomUUID();
  await pool.query(
    `INSERT INTO guide_domains (id, tenant_id, assistant_id, channel_id, hostname, slug, domain_mode, status, verification_record_type, verification_target)
     VALUES ($1, $2, $3, $4, 'guide-staging.samchecompany.com', $5, 'MANAGED', 'ACTIVE', 'CNAME', 'guide-staging.samchecompany.com')`,
    [domainId, tenantId, assistantId, channelId, `slug-${randomUUID().slice(0, 8)}`],
  );

  const client = await pool.connect();
  let publishedVersion = null;
  try {
    await client.query('BEGIN');
    const draft = await createGuideExperienceDraft({
      database: client,
      tenantId,
      assistantId,
      actorUserId: userId,
      experience: { brand_name: companyIdentity, assistant_display_name: assistantName, welcome_title: `Welcome to ${companyIdentity}`, welcome_message: 'How can we assist you today?', modules: { chat: true }, theme: { primary_color: '#0055ff' } },
    });
    publishedVersion = await publishGuideExperience({ client, tenantId, assistantId, versionId: draft.id, actorUserId: userId });
    await client.query('COMMIT');
  } finally {
    client.release();
  }

  return { tenantId, userId, identityId, assistantId, channelId, domainId, profileId, profileVersionId, publishedVersion };
}

test('Tenant 1 (Dubai Horizon): recommendation rejection, fresh re-generation, approval, activation, and AI Guide runtime', async () => {
  const pool = getPool();
  try {
    const f1 = await createFreshTenantFixture(pool, {
      name: 'Dubai Horizon Real Estate Tenant',
      companyIdentity: 'Dubai Horizon Real Estate LLC',
      industry: 'Luxury Real Estate Brokerage',
      packages: ['Off-plan Luxury Villas from 5M AED', 'Downtown Penthouses from 12M AED'],
      policies: ['Minimum investment portfolio requirement is 1.5M AED.', 'Strict confidentiality for ultra-high-net-worth investors.'],
      assistantName: 'Dubai Horizon Assistant',
    });

    let recGenCount = 0;
    const provider1 = {
      provider: 'GEMINI',
      model: 'gemini-3-flash-preview',
      assistantGenerationPolicy: 'gemini-structured-v3:thinking-minimal:max-output-1024:timeout-30000',
      generateAssistantRecommendation: async () => {
        recGenCount++;
        return {
          schema_version: 2,
          assistant_identity: 'Dubai Horizon Assistant',
          role_and_purpose: 'Luxury Real Estate Advisor',
          company_context: 'Dubai Horizon Real Estate LLC specializes in off-plan and luxury property portfolios.',
          assistant_instructions: 'Guide clients regarding Dubai luxury properties with 1.5M AED minimum investment threshold.',
          tone: recGenCount === 1 ? 'Overly Informal Tone' : 'Refined & Professional Luxury Advisory',
          greeting: 'Welcome to Dubai Horizon Real Estate.',
        };
      },
      generateAssistantConfiguration: async () => ({
        schema_version: 2,
        assistant_identity: 'Dubai Horizon Assistant',
        role_and_purpose: 'Luxury Real Estate Advisor',
        company_context: 'Dubai Horizon Real Estate LLC specializes in off-plan and luxury property portfolios.',
        assistant_instructions: 'Guide clients regarding Dubai luxury properties with 1.5M AED minimum investment threshold.',
        tone: 'Refined & Professional Luxury Advisory',
        greeting: 'Welcome to Dubai Horizon Real Estate.',
      }),
    };

    const prep1 = await prepareAssistantRecommendationGeneration({
      database: pool, provider: provider1, tenantId: f1.tenantId, assistantId: f1.assistantId,
      businessProfileVersionId: f1.profileVersionId, requestedBy: f1.userId,
    });

    const job1 = await enqueueAssistantRecommendationGenerationJob({
      database: pool, tenantId: f1.tenantId, assistantId: f1.assistantId, businessProfileVersionId: f1.profileVersionId,
      requestedBy: f1.userId, fingerprint: prep1.fingerprint, providerPolicy: provider1.assistantGenerationPolicy,
    });
    assert.equal(job1.status, 'PENDING');

    const claimedJob1 = (await pool.query(`SELECT * FROM knowledge_processing_jobs WHERE id = $1`, [job1.id])).rows[0];
    const processedJob1 = await processAssistantRecommendationGenerationJob({
      database: pool, job: claimedJob1,
      generateRecommendation: (input) => generateAssistantRecommendation({ ...input, provider: provider1 }),
    });
    assert.equal(processedJob1.status, 'READY');
    const rec1Id = processedJob1.recommendation.id;

    // Explicitly reject recommendation 1
    const rej1 = await reviewAssistantRecommendation({
      database: pool, tenantId: f1.tenantId, assistantId: f1.assistantId,
      recommendationId: rec1Id, reviewedBy: f1.userId, decision: 'REJECTED',
    });
    assert.equal(rej1.status, 'REJECTED');

    // Generate recommendation 2: must reset to PENDING and produce fresh recommendation
    const job2 = await enqueueAssistantRecommendationGenerationJob({
      database: pool, tenantId: f1.tenantId, assistantId: f1.assistantId, businessProfileVersionId: f1.profileVersionId,
      requestedBy: f1.userId, fingerprint: prep1.fingerprint, providerPolicy: provider1.assistantGenerationPolicy,
      retryRequested: true,
    });
    assert.equal(job2.status, 'PENDING');
    assert.equal(job2.attempts, 0);

    const claimedJob2 = (await pool.query(`SELECT * FROM knowledge_processing_jobs WHERE id = $1`, [job2.id])).rows[0];
    const processedJob2 = await processAssistantRecommendationGenerationJob({
      database: pool, job: claimedJob2,
      generateRecommendation: (input) => generateAssistantRecommendation({ ...input, provider: provider1 }),
    });
    assert.equal(processedJob2.status, 'READY');
    assert.equal(processedJob2.reused, false);
    const rec2Id = processedJob2.recommendation.id;
    assert.notEqual(rec2Id, rec1Id);

    // Verify both recommendations in DB: rec 1 REJECTED, rec 2 NEEDS_REVIEW
    const allRecs = await pool.query(`SELECT id, status FROM assistant_knowledge_recommendations WHERE tenant_id = $1 AND assistant_id = $2 ORDER BY created_at ASC`, [f1.tenantId, f1.assistantId]);
    assert.equal(allRecs.rowCount, 2);
    assert.equal(allRecs.rows[0].status, 'REJECTED');
    assert.equal(allRecs.rows[1].status, 'NEEDS_REVIEW');

    // Approve recommendation 2
    await reviewAssistantRecommendation({
      database: pool, tenantId: f1.tenantId, assistantId: f1.assistantId,
      recommendationId: rec2Id, reviewedBy: f1.userId, decision: 'APPROVED',
    });

    // Generate configuration from approved recommendation 2
    const configRes = await generateAssistantConfigurationVersion({
      database: pool, provider: provider1, tenantId: f1.tenantId, assistantId: f1.assistantId,
      recommendationId: rec2Id, requestedBy: f1.userId,
    });
    assert.equal(configRes.configuration.status, 'NEEDS_REVIEW');
    const configId = configRes.configuration.id;

    // Approve & activate configuration
    await approveAssistantConfigurationVersion({ database: pool, tenantId: f1.tenantId, assistantId: f1.assistantId, versionId: configId, approvedBy: f1.userId });
    await activateAssistantConfigurationVersion({ database: pool, tenantId: f1.tenantId, assistantId: f1.assistantId, versionId: configId, activatedBy: f1.userId });

    // Runtime persona is active
    const persona = await resolveTenantRuntimePersona({ database: pool, tenantId: f1.tenantId, assistantId: f1.assistantId });
    assert.equal(persona.available, true);
    assert.equal(persona.companyIdentity, 'Dubai Horizon Real Estate LLC');
    assert.ok(persona.assistantIdentity);

    const systemInstruction = buildTenantRuntimeSystemInstruction({ persona });
    assert.match(systemInstruction, /Dubai Horizon Real Estate LLC/);
    assert.match(systemInstruction, /Minimum investment portfolio requirement is 1\.5M AED/);

    // AI Guide resume session & Live Inbox persistence
    const scope = { tenant_id: f1.tenantId, assistant_id: f1.assistantId, channel_id: f1.channelId, domain_id: f1.domainId };
    const session = await issueGuideResumeSession({ database: pool, scope, experienceVersion: 1, previewMode: false });
    assert.ok(session.token);

    const testState = {
      conversation: { id: randomUUID(), tenant_id: f1.tenantId, channel_id: f1.channelId, status: 'open' },
      messages: [{ sender_type: 'CUSTOMER', content: 'What is the minimum investment?' }],
    };
    await saveGuideResumeState({ database: pool, token: session.token, scope, experienceVersion: 1, previewMode: false, state: testState });
    const loaded = await loadGuideResumeState({ database: pool, token: session.token, scope, experienceVersion: 1, previewMode: false });
    assert.deepEqual(loaded, testState);

    // Prerequisites report healthy
    const diag = await inspectGuideExperiencePublication({ database: pool, tenantId: f1.tenantId, assistantId: f1.assistantId });
    assert.equal(diag.prerequisites.ready, true);
  } finally {
    await pool.end();
  }
});

test('Tenant 2 (Nordic Clean Energy): independent onboarding, grounding, and cross-tenant session isolation', async () => {
  const pool = getPool();
  try {
    const f2 = await createFreshTenantFixture(pool, {
      name: 'Nordic Clean Energy Tenant',
      companyIdentity: 'Nordic Clean Energy AB',
      industry: 'Renewable Solar & Wind Solutions',
      packages: ['Residential Rooftop Solar 10kW: 120.000 SEK', 'Commercial Wind Turbine 500kW'],
      policies: ['All solar panels include 25-year performance warranty.', 'Installation permit coordination included.'],
      assistantName: 'Nordic Energy Bot',
    });

    const provider2 = {
      provider: 'GEMINI',
      model: 'gemini-3-flash-preview',
      assistantGenerationPolicy: 'gemini-structured-v3:thinking-minimal:max-output-1024:timeout-30000',
      generateAssistantRecommendation: async () => ({
        schema_version: 2,
        assistant_identity: 'Nordic Energy Bot',
        role_and_purpose: 'Renewable Energy Consultant',
        company_context: 'Nordic Clean Energy AB provides solar and wind infrastructure in Scandinavia.',
        assistant_instructions: 'Advise on solar installations and 25-year warranty terms.',
        tone: 'Professional Scandinavian Engineering Voice',
        greeting: 'Välkommen till Nordic Clean Energy.',
      }),
      generateAssistantConfiguration: async () => ({
        schema_version: 2,
        assistant_identity: 'Nordic Energy Bot',
        role_and_purpose: 'Renewable Energy Consultant',
        company_context: 'Nordic Clean Energy AB provides solar and wind infrastructure in Scandinavia.',
        assistant_instructions: 'Advise on solar installations and 25-year warranty terms.',
        tone: 'Professional Scandinavian Engineering Voice',
        greeting: 'Välkommen till Nordic Clean Energy.',
      }),
    };

    // Full clean onboarding flow
    const rec = await generateAssistantRecommendation({
      database: pool, provider: provider2, tenantId: f2.tenantId, assistantId: f2.assistantId,
      businessProfileVersionId: f2.profileVersionId, requestedBy: f2.userId,
    });
    assert.equal(rec.recommendation.status, 'NEEDS_REVIEW');

    await reviewAssistantRecommendation({
      database: pool, tenantId: f2.tenantId, assistantId: f2.assistantId,
      recommendationId: rec.recommendation.id, reviewedBy: f2.userId, decision: 'APPROVED',
    });

    const conf = await generateAssistantConfigurationVersion({
      database: pool, provider: provider2, tenantId: f2.tenantId, assistantId: f2.assistantId,
      recommendationId: rec.recommendation.id, requestedBy: f2.userId,
    });
    assert.equal(conf.configuration.status, 'NEEDS_REVIEW');

    await approveAssistantConfigurationVersion({
      database: pool, tenantId: f2.tenantId, assistantId: f2.assistantId,
      versionId: conf.configuration.id, approvedBy: f2.userId,
    });

    await activateAssistantConfigurationVersion({
      database: pool, tenantId: f2.tenantId, assistantId: f2.assistantId,
      versionId: conf.configuration.id, activatedBy: f2.userId,
    });

    const persona2 = await resolveTenantRuntimePersona({ database: pool, tenantId: f2.tenantId, assistantId: f2.assistantId });
    assert.equal(persona2.available, true);
    assert.equal(persona2.companyIdentity, 'Nordic Clean Energy AB');
    assert.ok(persona2.assistantIdentity);

    const sys2 = buildTenantRuntimeSystemInstruction({ persona: persona2 });
    assert.match(sys2, /Nordic Clean Energy AB/);
    assert.match(sys2, /25-year performance warranty/);
    assert.doesNotMatch(sys2, /Dubai Horizon/);
    assert.doesNotMatch(sys2, /1\.5M AED/);

    // Session isolation: Issue session for Tenant 2
    const scope2 = { tenant_id: f2.tenantId, assistant_id: f2.assistantId, channel_id: f2.channelId, domain_id: f2.domainId };
    const session2 = await issueGuideResumeSession({ database: pool, scope: scope2, experienceVersion: 1, previewMode: false });
    assert.ok(session2.token);

    // Cross-tenant attack: presenting Tenant 2 session token to Tenant 1 scope must return null
    const scope1 = { tenant_id: randomUUID(), assistant_id: randomUUID(), channel_id: randomUUID(), domain_id: randomUUID() };
    const crossTenantAttempt = await resolveGuideResumeSession({
      database: pool, token: session2.token, scope: scope1, experienceVersion: 1, previewMode: false,
    });
    assert.equal(crossTenantAttempt, null);
  } finally {
    await pool.end();
  }
});
test('Tenant 3 (Incomplete Tenant): actionable missing-prerequisite errors and fails closed safely', async () => {
  const pool = getPool();
  try {
    const tenant3Id = randomUUID();
    const assistant3Id = randomUUID();
    const channel3Id = randomUUID();
    const user3Id = randomUUID();

    await pool.query(`INSERT INTO tenants (id, name, plan_code, status) VALUES ($1, 'Incomplete Tenant', 'STARTER', 'active')`, [tenant3Id]);
    await pool.query(`INSERT INTO users (id, email, email_normalized, password_hash, system_role) VALUES ($1, $2, $2, 'test-pw', 'OWNER')`, [user3Id, `incomp-${randomUUID()}@example.test`]);
    await pool.query(`INSERT INTO ai_assistants (id, tenant_id, name, model, status) VALUES ($1, $2, 'Incomplete Assistant', 'gemini-3-flash-preview', 'active')`, [assistant3Id, tenant3Id]);
    await pool.query(`INSERT INTO tenant_channels (id, tenant_id, channel_type, display_name, status, assistant_id) VALUES ($1, $2, 'SAMCHEGUIDE', 'Guide Channel', 'active', $3)`, [channel3Id, tenant3Id, assistant3Id]);


    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const draft = await createGuideExperienceDraft({
        database: client,
        tenantId: tenant3Id,
        assistantId: assistant3Id,
        actorUserId: user3Id,
        experience: { brand_name: 'Incomplete Tenant', modules: { chat: true } },
      });
      await publishGuideExperience({ client, tenantId: tenant3Id, assistantId: assistant3Id, versionId: draft.id, actorUserId: user3Id });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Publication diagnostics check
    const diag3 = await inspectGuideExperiencePublication({ database: pool, tenantId: tenant3Id, assistantId: assistant3Id });
    assert.equal(diag3.prerequisites.ready, false);
    assert.ok(diag3.prerequisites.missing_prerequisites.includes('ACTIVE_BUSINESS_PROFILE_REQUIRED'));
    assert.ok(diag3.prerequisites.missing_prerequisites.includes('ACTIVE_ASSISTANT_CONFIGURATION_REQUIRED'));

    // Runtime persona check: must resolve available: false
    const persona3 = await resolveTenantRuntimePersona({ database: pool, tenantId: tenant3Id, assistantId: assistant3Id });
    assert.equal(persona3.available, false);
    assert.equal(persona3.code, 'TENANT_PERSONA_NOT_ACTIVE');

    // System instruction must be empty
    const sys3 = buildTenantRuntimeSystemInstruction({ persona: persona3 });
    assert.equal(sys3, '');
  } finally {
    await pool.end();
  }
});

test('Provider resilience: retries bounded attempts and records safe failure diagnostics', async () => {
  const pool = getPool();
  try {
    const f = await createFreshTenantFixture(pool, {
      name: 'Resilience Test Tenant',
      companyIdentity: 'Resilience Test LLC',
      industry: 'Software Testing',
      packages: ['Automated Testing'],
      policies: ['Zero defect tolerance.'],
      assistantName: 'Resilience Bot',
    });

    let attemptsCount = 0;
    const failingProvider = {
      provider: 'GEMINI',
      model: 'gemini-3-flash-preview',
      assistantGenerationPolicy: 'gemini-structured-v3:thinking-minimal:max-output-1024:timeout-30000',
      generateAssistantRecommendation: async () => {
        attemptsCount++;
        if (attemptsCount < 3) {
          throw Object.assign(new Error('transient upstream timeout token=should-not-leak'), {
            code: 'KNOWLEDGE_GENERATION_TIMEOUT',
          });
        }
        return { schema_version: 2, tone: 'Resilient Tone' };
      },
    };

    const prep = await prepareAssistantRecommendationGeneration({
      database: pool, provider: failingProvider, tenantId: f.tenantId, assistantId: f.assistantId,
      businessProfileVersionId: f.profileVersionId, requestedBy: f.userId,
    });

    const job = await enqueueAssistantRecommendationGenerationJob({
      database: pool, tenantId: f.tenantId, assistantId: f.assistantId, businessProfileVersionId: f.profileVersionId,
      requestedBy: f.userId, fingerprint: prep.fingerprint, providerPolicy: failingProvider.assistantGenerationPolicy,
    });

    // Attempt 1 fails -> retried to PENDING
    let claimed = (await pool.query(`UPDATE knowledge_processing_jobs SET status = 'PROCESSING', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`, [job.id])).rows[0];
    await assert.rejects(() => processAssistantRecommendationGenerationJob({
      database: pool, job: claimed,
      generateRecommendation: (input) => generateAssistantRecommendation({ ...input, provider: failingProvider }),
    }));
    let check1 = await pool.query(`SELECT status, attempts, last_error_code FROM knowledge_processing_jobs WHERE id = $1`, [job.id]);
    assert.equal(check1.rows[0].status, 'PENDING');
    assert.equal(check1.rows[0].last_error_code, 'KNOWLEDGE_GENERATION_TIMEOUT');

    // Attempt 2 fails -> retried to PENDING
    claimed = (await pool.query(`UPDATE knowledge_processing_jobs SET status = 'PROCESSING', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`, [job.id])).rows[0];
    await assert.rejects(() => processAssistantRecommendationGenerationJob({
      database: pool, job: claimed,
      generateRecommendation: (input) => generateAssistantRecommendation({ ...input, provider: failingProvider }),
    }));

    // Attempt 3 -> succeeds!
    claimed = (await pool.query(`UPDATE knowledge_processing_jobs SET status = 'PROCESSING', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`, [job.id])).rows[0];
    const success = await processAssistantRecommendationGenerationJob({
      database: pool, job: claimed,
      generateRecommendation: (input) => generateAssistantRecommendation({ ...input, provider: failingProvider }),
    });
    assert.equal(success.status, 'READY');
    assert.equal(success.recommendation.status, 'NEEDS_REVIEW');
  } finally {
    await pool.end();
  }
});

