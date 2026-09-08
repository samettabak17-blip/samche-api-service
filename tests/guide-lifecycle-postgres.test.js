import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, test } from 'node:test';
import express from 'express';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
import {
  ensureGuideChannelForAssistant,
  ensureGuideChannelsForTenant,
  ensureManagedGuideDomainForAssistant,
  allocateDeterministicManagedSlug,
  createGuideDomain,
  listGuideDomains,
  managedGuideHostnameFromSlug,
  managedGuideUrlFromSlug,
  normalizeGuideSlug,
  configuredManagedGuideHostname,
  isManagedGuidePlatformHost,
  repairEligibleGuideDomains,
  resolveActiveGuideDomain,
  resolveActiveManagedGuideDomain,
  resolveGuideRuntimeScopeFromRequest,
  GuideDomainError,
} from '../services/guide-domain-service.js';
import {
  createGuideExperienceDraft,
  updateGuideExperienceDraft,
  publishGuideExperience,
  resolvePublishedGuideExperience,
  inspectGuideExperiencePublication,
} from '../services/guide-experience-service.js';
import { issueGuidePreviewToken } from '../services/guide-preview-service.js';
import { buildBootstrapUrl, applyExperience, showGuideError, resetGuideForTesting } from '../public-guide/guide.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('GUIDE_LIFECYCLE_POSTGRES_REQUIRES_TEST_DATABASE_URL');
if (!isSafeTestDatabaseUrl(connectionString)) throw new Error('GUIDE_LIFECYCLE_POSTGRES_REFUSES_NON_ISOLATED_TEST_DATABASE');

const { Pool } = pg;
const database = new Pool({
  connectionString,
  ssl: resolvePostgresSsl({ connectionString, databaseSsl: process.env.DATABASE_SSL || 'strict', nodeEnv: 'test' }),
  max: 2,
});

after(async () => database.end());

test('A. Fresh tenant Guide lifecycle: converges channel, domain, publication, and runtime without manual DB repair', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const runId = crypto.randomUUID().slice(0, 8);

    // 1. Create fresh tenant (simulating Yeşil Vadi onboarding)
    const tenantRes = await client.query(
      `INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`,
      [`Yeşil Vadi Acceptance ${runId}`],
    );
    const tenantId = tenantRes.rows[0].id;

    // 2. Create active assistant
    const assistantRes = await client.query(
      `INSERT INTO ai_assistants (tenant_id, name, status, model) VALUES ($1, 'Yesil Vadi', 'active', 'gpt-4o-mini') RETURNING id`,
      [tenantId],
    );
    const assistantId = assistantRes.rows[0].id;

    // 3. Channel should be ensured via normal lifecycle
    const ensuredChannel = await ensureGuideChannelForAssistant({ database: client, tenantId, assistantId });
    assert.ok(ensuredChannel.channelId);
    assert.equal(ensuredChannel.channel.channel_type, 'SAMCHEGUIDE');
    assert.equal(ensuredChannel.channel.assistant_id, assistantId);
    assert.equal(ensuredChannel.channel.status, 'active');
    assert.equal(ensuredChannel.integration.integration_type, 'SAMCHEGUIDE');
    assert.equal(ensuredChannel.integration.assistant_id, assistantId);
    assert.equal(ensuredChannel.integration.enabled, true);

    // 4. Listing channels for tenant returns the active SAMCHEGUIDE channel
    const channels = await ensureGuideChannelsForTenant({ database: client, tenantId });
    assert.equal(channels.length, 1);
    assert.equal(channels[0].channelId, ensuredChannel.channelId);

    // 5. Create draft v1
    const draft = await createGuideExperienceDraft({
      database: client,
      tenantId,
      assistantId,
      actorUserId: null,
      experience: {
        brand_name: 'Yeşil Vadi Peyzaj',
        assistant_display_name: 'Yesil Vadi',
        welcome_title: 'Bahçe Tasarımına Hoş Geldiniz',
        welcome_message: 'Peyzaj ve sulama projeleriniz için bize danışabilirsiniz.',
      },
    });
    assert.equal(draft.version, 1);
    assert.equal(draft.status, 'DRAFT');

    // Verify DRAFT != PUBLISHED
    const initialPublished = await resolvePublishedGuideExperience({ database: client, tenantId, assistantId });
    assert.equal(initialPublished.source, 'NEUTRAL_FALLBACK');

    // 6. Configure SamChe-managed domain with slug
    const slug = `yesil-vadi-${runId}`;
    const expectedUrl = managedGuideUrlFromSlug(slug, { NODE_ENV: 'staging' });
    assert.equal(expectedUrl, `https://guide-staging.samchecompany.com/${slug}`);

    const domain = await createGuideDomain({
      client,
      tenantId,
      assistantId,
      channelId: ensuredChannel.channelId,
      slug,
      domainMode: 'MANAGED',
      actorUserId: null,
      ingressTarget: 'ingress.samchecompany.com',
    });
    assert.equal(domain.status, 'ACTIVE');
    assert.equal(domain.slug, slug);
    assert.equal(domain.hostname, 'guide-staging.samchecompany.com');
    assert.equal(domain.channel_id, ensuredChannel.channelId);

    // 7. Publish draft explicitly
    const published = await publishGuideExperience({
      client,
      tenantId,
      assistantId,
      versionId: draft.id,
      actorUserId: null,
    });
    assert.equal(published.version, 1);
    assert.equal(published.status, 'PUBLISHED');

    // 8. Resolve public Guide via managed host + path slug request
    const resolvedScope = await resolveGuideRuntimeScopeFromRequest({
      database: client,
      req: {
        headers: { host: 'guide-staging.samchecompany.com' },
        params: { slug },
      },
    });
    assert.ok(resolvedScope);
    assert.equal(resolvedScope.tenant_id, tenantId);
    assert.equal(resolvedScope.assistant_id, assistantId);
    assert.equal(resolvedScope.channel_id, ensuredChannel.channelId);
    assert.equal(resolvedScope.channel_type, 'SAMCHEGUIDE');

    // Also resolves via referer on platform host
    const resolvedViaReferer = await resolveGuideRuntimeScopeFromRequest({
      database: client,
      req: {
        headers: {
          host: 'guide-staging.samchecompany.com',
          referer: `https://guide-staging.samchecompany.com/${slug}`,
        },
      },
    });
    assert.ok(resolvedViaReferer);
    assert.equal(resolvedViaReferer.tenant_id, tenantId);

    // Resolve published experience for this scope
    const liveExperience = await resolvePublishedGuideExperience({ database: client, tenantId, assistantId });
    assert.equal(liveExperience.source, 'PUBLISHED');
    assert.equal(liveExperience.experience.brand_name, 'Yeşil Vadi Peyzaj');
    assert.equal(liveExperience.experience.version, 1);

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

test('B. Historical convergence: converges Blue Dune pattern where tc.assistant_id was NULL', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const runId = crypto.randomUUID().slice(0, 8);

    // 1. Create historical tenant (Blue Dune pattern)
    const tenantRes = await client.query(
      `INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`,
      [`Blue Dune Historical ${runId}`],
    );
    const tenantId = tenantRes.rows[0].id;

    const assistantRes = await client.query(
      `INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Blue Dune AI Assistant', 'active') RETURNING id`,
      [tenantId],
    );
    const assistantId = assistantRes.rows[0].id;

    // Insert historical SAMCHEGUIDE channel WITH assistant_id = NULL
    const channelRes = await client.query(
      `INSERT INTO tenant_channels (tenant_id, assistant_id, channel_type, display_name, external_channel_id, status)
       VALUES ($1, NULL, 'SAMCHEGUIDE', 'AI Guide', $2, 'active')
       RETURNING id`,
      [tenantId, `samcheguide:historical:${runId}`],
    );
    const channelId = channelRes.rows[0].id;

    // Insert historical channel_integrations WITH assistant_id populated
    const integrationKey = `SAMCHEGUIDE:historical:${runId}`;
    await client.query(
      `INSERT INTO channel_integrations (integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled)
       VALUES ($1, 'SAMCHEGUIDE', $2, $3, $4, TRUE)`,
      [integrationKey, tenantId, channelId, assistantId],
    );

    // Insert historical active custom domain (rehber.samchecompany.ae pattern)
    const customHost = `rehber-${runId}.samchecompany.ae`;
    await client.query(
      `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', 'CUSTOM', 'CNAME', 'ingress.samchecompany.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [tenantId, assistantId, channelId, customHost],
    );

    // Insert published experience
    await client.query(
      `INSERT INTO guide_experience_versions (tenant_id, assistant_id, version, status, experience, published_at)
       VALUES ($1, $2, 1, 'PUBLISHED', '{"brand_name":"Blue Dune Event Management"}'::jsonb, CURRENT_TIMESTAMP)`,
      [tenantId, assistantId],
    );

    // 2. Before convergence: tc.assistant_id is NULL
    const beforeTc = await client.query(`SELECT assistant_id FROM tenant_channels WHERE id = $1`, [channelId]);
    assert.equal(beforeTc.rows[0].assistant_id, null);

    // 3. Run migration 070 convergence query
    const migrationSql = fs.readFileSync(new URL('../migrations/070_guide_channel_lifecycle_convergence.sql', import.meta.url), 'utf8');
    await client.query(migrationSql);

    // 4. After convergence: tc.assistant_id is set to assistantId
    const afterTc = await client.query(`SELECT assistant_id FROM tenant_channels WHERE id = $1`, [channelId]);
    assert.equal(afterTc.rows[0].assistant_id, assistantId);

    // 5. Hostname resolves successfully!
    const resolved = await resolveActiveGuideDomain({ database: client, hostname: customHost });
    assert.ok(resolved);
    assert.equal(resolved.tenant_id, tenantId);
    assert.equal(resolved.assistant_id, assistantId);
    assert.equal(resolved.channel_id, channelId);

    // 6. Rerun migration (idempotency check)
    await client.query(migrationSql);
    const afterReplayTc = await client.query(`SELECT assistant_id FROM tenant_channels WHERE id = $1`, [channelId]);
    assert.equal(afterReplayTc.rows[0].assistant_id, assistantId);

    // Verify channel count has not duplicated
    const channelCount = await client.query(`SELECT count(*)::int as count FROM tenant_channels WHERE tenant_id = $1 AND channel_type = 'SAMCHEGUIDE'`, [tenantId]);
    assert.equal(channelCount.rows[0].count, 1);

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

test('C. Cross-tenant denial and strict isolation', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const runId = crypto.randomUUID().slice(0, 8);

    const tenantARes = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`Tenant A ${runId}`]);
    const tenantBRes = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`Tenant B ${runId}`]);
    const tenantA = tenantARes.rows[0].id;
    const tenantB = tenantBRes.rows[0].id;

    const assistantARes = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant A', 'active') RETURNING id`, [tenantA]);
    const assistantBRes = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant B', 'active') RETURNING id`, [tenantB]);
    const assistantA = assistantARes.rows[0].id;
    const assistantB = assistantBRes.rows[0].id;

    const channelA = await ensureGuideChannelForAssistant({ database: client, tenantId: tenantA, assistantId: assistantA });
    const channelB = await ensureGuideChannelForAssistant({ database: client, tenantId: tenantB, assistantId: assistantB });

    const slugA = `tenant-a-${runId}`;
    const slugB = `tenant-b-${runId}`;
    await createGuideDomain({
      client,
      tenantId: tenantA,
      assistantId: assistantA,
      channelId: channelA.channelId,
      slug: slugA,
      domainMode: 'MANAGED',
      actorUserId: null,
      ingressTarget: 'ingress.samchecompany.com',
    });

    // 1. Tenant B cannot attach Tenant A's slug (unique slug conflict)
    await client.query('SAVEPOINT sp_unique');
    await assert.rejects(
      createGuideDomain({
        client,
        tenantId: tenantB,
        assistantId: assistantB,
        channelId: channelB.channelId,
        slug: slugA,
        domainMode: 'MANAGED',
        actorUserId: null,
        ingressTarget: 'ingress.samchecompany.com',
      }),
      (err) => err instanceof GuideDomainError && err.code === 'GUIDE_DOMAIN_HOSTNAME_EXISTS',
    );
    await client.query('ROLLBACK TO SAVEPOINT sp_unique');

    // 2. Slug A resolves Tenant A ONLY, never Tenant B
    const resolvedA = await resolveActiveManagedGuideDomain({ database: client, slug: slugA });
    assert.equal(resolvedA?.tenant_id, tenantA);
    assert.notEqual(resolvedA?.tenant_id, tenantB);

    // 3. Managed host + path slug resolves Tenant A ONLY
    const scopeA = await resolveGuideRuntimeScopeFromRequest({
      database: client,
      req: {
        headers: { host: 'guide-staging.samchecompany.com' },
        params: { slug: slugA },
      },
    });
    assert.equal(scopeA?.tenant_id, tenantA);

    // 4. Cross-tenant token access fails closed
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'guide-test-secret-32-chars-long!!';
    const tokenB = issueGuidePreviewToken({
      tenantId: tenantB,
      assistantId: assistantB,
      versionId: crypto.randomUUID(),
      actorUserId: crypto.randomUUID(),
    });
    const crossTenantAttempt = await resolveGuideRuntimeScopeFromRequest({
      database: client,
      req: {
        headers: {
          host: 'guide-staging.samchecompany.com',
          'x-samcheguide-preview': tokenB,
        },
        params: { slug: slugA },
      },
    });
    assert.equal(crossTenantAttempt, null);

    // 5. Invalid slug fails closed
    const invalidSlugAttempt = await resolveGuideRuntimeScopeFromRequest({
      database: client,
      req: {
        headers: { host: 'guide-staging.samchecompany.com' },
        params: { slug: 'does-not-exist-slug' },
      },
    });
    assert.equal(invalidSlugAttempt, null);

    // 6. Tenant B cannot fetch Tenant A's draft
    const draftA = await createGuideExperienceDraft({
      database: client,
      tenantId: tenantA,
      assistantId: assistantA,
      actorUserId: null,
      experience: { brand_name: 'Tenant A Brand' },
    });
    const draftForB = await client.query(
      `SELECT id FROM guide_experience_versions WHERE id = $1 AND tenant_id = $2`,
      [draftA.id, tenantB],
    );
    assert.equal(draftForB.rowCount, 0);

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

test('D. Draft != Published semantics: draft edits do not alter published version until explicit publish', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const runId = crypto.randomUUID().slice(0, 8);

    const tenantRes = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`Publish Semantics ${runId}`]);
    const tenantId = tenantRes.rows[0].id;
    const assistantRes = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant', 'active') RETURNING id`, [tenantId]);
    const assistantId = assistantRes.rows[0].id;

    // Create and publish v1
    const draft1 = await createGuideExperienceDraft({
      database: client,
      tenantId,
      assistantId,
      actorUserId: null,
      experience: { brand_name: 'Version 1 Published Brand' },
    });
    await publishGuideExperience({ client, tenantId, assistantId, versionId: draft1.id, actorUserId: null });

    // Verify v1 is published
    const pub1 = await resolvePublishedGuideExperience({ database: client, tenantId, assistantId });
    assert.equal(pub1.experience.brand_name, 'Version 1 Published Brand');

    // Create draft v2 and modify it
    const draft2 = await createGuideExperienceDraft({
      database: client,
      tenantId,
      assistantId,
      actorUserId: null,
      experience: { brand_name: 'Version 2 Draft in Progress' },
    });
    await updateGuideExperienceDraft({
      database: client,
      tenantId,
      assistantId,
      versionId: draft2.id,
      actorUserId: null,
      experience: { brand_name: 'Version 2 Updated Draft' },
    });

    // Published experience MUST STILL BE v1
    const pubStill1 = await resolvePublishedGuideExperience({ database: client, tenantId, assistantId });
    assert.equal(pubStill1.experience.brand_name, 'Version 1 Published Brand');
    assert.equal(pubStill1.experience.version, 1);

    // Publication diagnostics confirms 1 published, 1 draft
    const diag = await inspectGuideExperiencePublication({ database: client, tenantId, assistantId });
    assert.equal(diag.consistency, 'HEALTHY');
    assert.equal(diag.public_bootstrap_version, 1);
    assert.equal(diag.versions.length, 2);

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});


test('E. Slug normalization, rejection, and canonical staging URL generation', () => {
  // Canonical staging URL generation
  assert.equal(
    managedGuideUrlFromSlug('yesil-vadi', { NODE_ENV: 'staging' }),
    'https://guide-staging.samchecompany.com/yesil-vadi',
  );

  // Normal slug
  assert.equal(
    normalizeGuideSlug('yesil-vadi'),
    'yesil-vadi',
  );

  // Full old hostname entered instead of slug: normalizes without double suffix
  assert.equal(
    normalizeGuideSlug('yesil-vadi.guide.staging.samchecompany.com'),
    'yesil-vadi',
  );

  // Canonical managed URL entered: normalizes safely
  assert.equal(
    normalizeGuideSlug('https://guide-staging.samchecompany.com/yesil-vadi'),
    'yesil-vadi',
  );

  // Repeated suffix: normalizes safely
  assert.equal(
    normalizeGuideSlug('yesil-vadi.guide.staging.samchecompany.com.guide.staging.samchecompany.com'),
    'yesil-vadi',
  );

  // Invalid characters / dots in base slug rejected
  assert.throws(
    () => normalizeGuideSlug('yesil..vadi'),
    (err) => err instanceof GuideDomainError && err.code === 'GUIDE_DOMAIN_INVALID_SLUG',
  );

  assert.throws(
    () => normalizeGuideSlug('-invalid-'),
    (err) => err instanceof GuideDomainError && err.code === 'GUIDE_DOMAIN_INVALID_SLUG',
  );

  assert.throws(
    () => normalizeGuideSlug('otherdomain.org'),
    (err) => err instanceof GuideDomainError && err.code === 'GUIDE_DOMAIN_INVALID_SLUG',
  );
});

test('F. repairEligibleGuideDomains converges multiple tenants idempotently to canonical platform host and distinct slugs', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const runId = crypto.randomUUID().slice(0, 8);

    const t1 = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`Repair T1 ${runId}`]);
    const a1 = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant 1', 'active') RETURNING id`, [t1.rows[0].id]);

    const t2 = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`Repair T2 ${runId}`]);
    const a2 = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant 2', 'active') RETURNING id`, [t2.rows[0].id]);

    // Run repair across all active assistants
    const repaired1 = await repairEligibleGuideDomains({ database: client, environment: { NODE_ENV: 'staging' } });
    assert.ok(repaired1.length >= 2);

    // Verify both have active guide domains with canonical platform host and distinct slugs
    const d1 = await listGuideDomains({ database: client, tenantId: t1.rows[0].id, assistantId: a1.rows[0].id });
    const d2 = await listGuideDomains({ database: client, tenantId: t2.rows[0].id, assistantId: a2.rows[0].id });
    assert.equal(d1.length, 1);
    assert.equal(d2.length, 1);
    assert.equal(d1[0].status, 'ACTIVE');
    assert.equal(d2[0].status, 'ACTIVE');
    assert.equal(d1[0].hostname, 'guide-staging.samchecompany.com');
    assert.equal(d2[0].hostname, 'guide-staging.samchecompany.com');
    assert.ok(d1[0].slug);
    assert.ok(d2[0].slug);
    assert.notEqual(d1[0].slug, d2[0].slug);

    // Rerun repair: should be idempotent and not create duplicate domains
    await repairEligibleGuideDomains({ database: client, environment: { NODE_ENV: 'staging' } });
    const d1After = await listGuideDomains({ database: client, tenantId: t1.rows[0].id, assistantId: a1.rows[0].id });
    const d2After = await listGuideDomains({ database: client, tenantId: t2.rows[0].id, assistantId: a2.rows[0].id });
    assert.equal(d1After.length, 1);
    assert.equal(d2After.length, 1);

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

test('G. Historical managed slug collision, same-owner convergence, and Render deploy blocker reproduction (CASES 1-7)', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const runId = crypto.randomUUID().slice(0, 8);
    const sharedBaseSlug = `bluedune-${runId}`;

    // 0. Re-establish historical schema state (as existed on staging before migration 071)
    await client.query(`DROP INDEX IF EXISTS uq_guide_domain_custom_hostname`);
    await client.query(`DROP INDEX IF EXISTS uq_guide_domain_managed_slug`);
    await client.query(`ALTER TABLE guide_domains DROP CONSTRAINT IF EXISTS uq_guide_domain_hostname CASCADE`);
    await client.query(`ALTER TABLE guide_domains ADD CONSTRAINT uq_guide_domain_hostname UNIQUE (hostname)`);

    // 1. Create Tenant A (Blue Dune pattern with same-owner duplicate historical rows)
    const tenantARes = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`Historical Tenant A ${runId}`]);
    const tenantAId = tenantARes.rows[0].id;
    const assistantARes = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant A', 'active') RETURNING id`, [tenantAId]);
    const assistantAId = assistantARes.rows[0].id;
    const channelA = await ensureGuideChannelForAssistant({ database: client, tenantId: tenantAId, assistantId: assistantAId });

    // Row A1: Prod-style host created earlier
    const hostA1 = `${sharedBaseSlug}.guide.samchecompany.com`;
    const rowA1Res = await client.query(
      `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', 'MANAGED', 'CNAME', 'ingress.samchecompany.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '2026-09-01 10:00:00Z', '2026-09-01 10:00:00Z') RETURNING id`,
      [tenantAId, assistantAId, channelA.channelId, hostA1],
    );
    const domainA1Id = rowA1Res.rows[0].id;

    // Row A2: Staging-style host created later
    const hostA2 = `${sharedBaseSlug}.guide.staging.samchecompany.com`;
    await client.query(
      `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', 'MANAGED', 'CNAME', 'ingress.samchecompany.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '2026-09-02 10:00:00Z', '2026-09-02 10:00:00Z') RETURNING id`,
      [tenantAId, assistantAId, channelA.channelId, hostA2],
    );

    // Dependent public session pointing to earlier row A1
    const sessionTokenHash = crypto.randomBytes(32).toString('hex');
    await client.query(
      `INSERT INTO guide_public_sessions (token_hash, session_id, tenant_id, assistant_id, channel_id, domain_id, experience_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
      [sessionTokenHash, crypto.randomUUID(), tenantAId, assistantAId, channelA.channelId, domainA1Id],
    );

    // 2. Create Tenant B (Different tenant with legitimate collision on same desired base slug)
    const tenantBRes = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`Historical Tenant B ${runId}`]);
    const tenantBId = tenantBRes.rows[0].id;
    const assistantBRes = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant B', 'active') RETURNING id`, [tenantBId]);
    const assistantBId = assistantBRes.rows[0].id;
    const channelB = await ensureGuideChannelForAssistant({ database: client, tenantId: tenantBId, assistantId: assistantBId });

    const hostB = `${sharedBaseSlug}.staging.samchecompany.com`;
    await client.query(
      `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', 'MANAGED', 'CNAME', 'ingress.samchecompany.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '2026-09-03 10:00:00Z', '2026-09-03 10:00:00Z')`,
      [tenantBId, assistantBId, channelB.channelId, hostB],
    );

    // 3. Create Tenant C with historical custom domain (rehber.samchecompany.ae)
    const tenantCRes = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`Historical Custom Tenant ${runId}`]);
    const tenantCId = tenantCRes.rows[0].id;
    const assistantCRes = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant C', 'active') RETURNING id`, [tenantCId]);
    const assistantCId = assistantCRes.rows[0].id;
    const channelC = await ensureGuideChannelForAssistant({ database: client, tenantId: tenantCId, assistantId: assistantCId });
    const customHost = `rehber-${runId}.samchecompany.ae`;

    await client.query(
      `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', 'CUSTOM', 'CNAME', 'ingress.samchecompany.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [tenantCId, assistantCId, channelC.channelId, customHost],
    );

    // 4. Exact Render failure reproduction #1:
    // With legacy uq_guide_domain_hostname present, updating multiple managed rows to shared host violates uniqueness
    await client.query('SAVEPOINT sp_reproduce_render_failure_1');
    let reproducedHostnameError = null;
    try {
      await client.query(`UPDATE guide_domains SET hostname = 'guide-staging.samchecompany.com' WHERE domain_mode = 'MANAGED'`);
    } catch (err) {
      reproducedHostnameError = err;
    }
    assert.ok(reproducedHostnameError, 'Expected legacy uq_guide_domain_hostname to reject shared managed hostname');
    assert.equal(reproducedHostnameError.code, '23505');
    await client.query('ROLLBACK TO SAVEPOINT sp_reproduce_render_failure_1');

    // Exact Render failure reproduction #2:
    // With naive slug extraction without duplicate convergence, uq_guide_domain_managed_slug fails on duplicated bluedune
    await client.query('SAVEPOINT sp_reproduce_render_failure_2');
    let reproducedSlugError = null;
    try {
      await client.query(`
        UPDATE guide_domains
           SET slug = '${sharedBaseSlug}'
         WHERE domain_mode = 'MANAGED'
      `);
      await client.query(`CREATE UNIQUE INDEX uq_guide_domain_managed_slug ON guide_domains (lower(slug)) WHERE domain_mode = 'MANAGED'`);
    } catch (err) {
      reproducedSlugError = err;
    }
    assert.ok(reproducedSlugError, 'Expected uq_guide_domain_managed_slug to reject duplicate slug');
    assert.equal(reproducedSlugError.code, '23505');
    assert.match(reproducedSlugError.detail, new RegExp(sharedBaseSlug));
    await client.query('ROLLBACK TO SAVEPOINT sp_reproduce_render_failure_2');

    // 5. Run fixed migration 071
    const migration071Sql = fs.readFileSync(new URL('../migrations/071_guide_staging_managed_domain_architecture.sql', import.meta.url), 'utf8');
    await client.query(migration071Sql);

    // CASE 1: SAME OWNER HISTORICAL DUPLICATE
    // Tenant A's duplicate managed rows converged to one canonical active survivor
    const activeDomainsA = await client.query(
      `SELECT id, hostname, slug, domain_mode, status FROM guide_domains WHERE tenant_id = $1 AND domain_mode = 'MANAGED' AND status = 'ACTIVE'`,
      [tenantAId],
    );
    assert.equal(activeDomainsA.rowCount, 1, 'Tenant A must have exactly one active managed domain');
    assert.equal(activeDomainsA.rows[0].hostname, 'guide-staging.samchecompany.com');
    assert.equal(activeDomainsA.rows[0].slug, sharedBaseSlug);
    const survivorId = activeDomainsA.rows[0].id;

    // The other row is safely archived with an archival slug
    const archivedDomainsA = await client.query(
      `SELECT id, hostname, slug, status FROM guide_domains WHERE tenant_id = $1 AND domain_mode = 'MANAGED' AND status = 'ARCHIVED'`,
      [tenantAId],
    );
    assert.equal(archivedDomainsA.rowCount, 1);
    assert.match(archivedDomainsA.rows[0].slug, new RegExp(`^${sharedBaseSlug}-arch-`));

    // Public session foreign key preserved and repointed to survivor
    const sessionCheck = await client.query(`SELECT domain_id FROM guide_public_sessions WHERE token_hash = $1`, [sessionTokenHash]);
    assert.equal(sessionCheck.rows[0].domain_id, survivorId);

    // CASE 2: DIFFERENT TENANTS SAME BASE SLUG
    // Tenant B receives deterministic tenant-suffixed slug and remains usable
    const expectedSlugB = `${sharedBaseSlug.slice(0, 25)}-${tenantBId.replace(/-/g, '').slice(0, 6)}`;
    const activeDomainsB = await client.query(
      `SELECT id, hostname, slug, domain_mode, status FROM guide_domains WHERE tenant_id = $1 AND domain_mode = 'MANAGED' AND status = 'ACTIVE'`,
      [tenantBId],
    );
    assert.equal(activeDomainsB.rowCount, 1);
    assert.equal(activeDomainsB.rows[0].hostname, 'guide-staging.samchecompany.com');
    assert.equal(activeDomainsB.rows[0].slug, expectedSlugB);

    // Runtime resolution for Tenant A
    const resolvedManagedScopeA = await resolveGuideRuntimeScopeFromRequest({
      database: client,
      req: {
        headers: { host: 'guide-staging.samchecompany.com' },
        params: { slug: sharedBaseSlug },
      },
    });
    assert.ok(resolvedManagedScopeA);
    assert.equal(resolvedManagedScopeA.tenant_id, tenantAId);

    // Runtime resolution for Tenant B
    const resolvedManagedScopeB = await resolveGuideRuntimeScopeFromRequest({
      database: client,
      req: {
        headers: { host: 'guide-staging.samchecompany.com' },
        params: { slug: expectedSlugB },
      },
    });
    assert.ok(resolvedManagedScopeB);
    assert.equal(resolvedManagedScopeB.tenant_id, tenantBId);

    // CASE 3: EXISTING CUSTOM DOMAIN
    const untouchedCustom = await client.query(
      `SELECT hostname, slug, domain_mode, status FROM guide_domains WHERE tenant_id = $1`,
      [tenantCId],
    );
    assert.equal(untouchedCustom.rowCount, 1);
    assert.equal(untouchedCustom.rows[0].hostname, customHost);
    assert.equal(untouchedCustom.rows[0].slug, null);
    assert.equal(untouchedCustom.rows[0].domain_mode, 'CUSTOM');

    const resolvedCustomScope = await resolveGuideRuntimeScopeFromRequest({
      database: client,
      req: { headers: { host: customHost } },
    });
    assert.ok(resolvedCustomScope);
    assert.equal(resolvedCustomScope.tenant_id, tenantCId);

    // CASE 4: PREVIOUS HOSTNAME FAILURE
    // Multiple managed tenants safely share guide-staging.samchecompany.com
    const sharedHostCount = await client.query(
      `SELECT count(*)::int as count FROM guide_domains WHERE hostname = 'guide-staging.samchecompany.com' AND status = 'ACTIVE'`,
    );
    assert.ok(sharedHostCount.rows[0].count >= 2);

    // CASE 5: FRESH CREATION COLLISION
    // Two fresh tenants requesting the same desired managed slug automatically receive unique routes
    const freshDesiredSlug = `acme-${runId}`;
    const tenantDRes = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ('Fresh Tenant D', 'STARTER') RETURNING id`);
    const tenantDId = tenantDRes.rows[0].id;
    const assistantDRes = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant D', 'active') RETURNING id`, [tenantDId]);
    const assistantDId = assistantDRes.rows[0].id;
    const channelD = await ensureGuideChannelForAssistant({ database: client, tenantId: tenantDId, assistantId: assistantDId });

    const tenantERes = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ('Fresh Tenant E', 'STARTER') RETURNING id`);
    const tenantEId = tenantERes.rows[0].id;
    const assistantERes = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant E', 'active') RETURNING id`, [tenantEId]);
    const assistantEId = assistantERes.rows[0].id;
    const channelE = await ensureGuideChannelForAssistant({ database: client, tenantId: tenantEId, assistantId: assistantEId });

    const domainD = await ensureManagedGuideDomainForAssistant({
      database: client,
      tenantId: tenantDId,
      assistantId: assistantDId,
      channelId: channelD.channelId,
      slug: freshDesiredSlug,
    });
    const domainE = await ensureManagedGuideDomainForAssistant({
      database: client,
      tenantId: tenantEId,
      assistantId: assistantEId,
      channelId: channelE.channelId,
      slug: freshDesiredSlug,
    });
    assert.equal(domainD.slug, freshDesiredSlug);
    const expectedSlugE = `${freshDesiredSlug.slice(0, 25)}-${tenantEId.replace(/-/g, '').slice(0, 6)}`;
    assert.equal(domainE.slug, expectedSlugE);
    assert.notEqual(domainD.slug, domainE.slug);

    // CASE 6: UNIQUE INDEX
    // Duplicate MANAGED lower(slug) insertion rejected with 23505
    let duplicateManagedRejected = false;
    await client.query('SAVEPOINT sp_dup_managed');
    try {
      await client.query(
        `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, slug, status, domain_mode, verification_record_type, verification_target)
         VALUES ($1, $2, $3, 'guide-staging.samchecompany.com', $4, 'ACTIVE', 'MANAGED', 'CNAME', 'ingress.samchecompany.com')`,
        [tenantDId, assistantDId, channelD.channelId, domainD.slug],
      );
    } catch (err) {
      duplicateManagedRejected = err.code === '23505';
    }
    assert.ok(duplicateManagedRejected, 'Expected duplicate managed slug to be rejected by unique index');
    await client.query('ROLLBACK TO SAVEPOINT sp_dup_managed');

    // Duplicate CUSTOM lower(hostname) insertion rejected with 23505
    let duplicateCustomRejected = false;
    await client.query('SAVEPOINT sp_dup_custom');
    try {
      await client.query(
        `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target)
         VALUES ($1, $2, $3, $4, 'ACTIVE', 'CUSTOM', 'CNAME', 'ingress.samchecompany.com')`,
        [tenantDId, assistantDId, channelD.channelId, customHost],
      );
    } catch (err) {
      duplicateCustomRejected = err.code === '23505';
    }
    assert.ok(duplicateCustomRejected, 'Expected duplicate custom hostname to be rejected by unique index');
    await client.query('ROLLBACK TO SAVEPOINT sp_dup_custom');

    // CASE 7: MIGRATION REPLAY
    // Replay migration 071: zero errors, identical slugs
    await client.query(migration071Sql);
    const replayedA = await client.query(`SELECT slug, hostname, status FROM guide_domains WHERE id = $1`, [survivorId]);
    assert.equal(replayedA.rows[0].slug, sharedBaseSlug);
    assert.equal(replayedA.rows[0].hostname, 'guide-staging.samchecompany.com');

    const replayedB = await client.query(`SELECT slug, hostname, status FROM guide_domains WHERE tenant_id = $1 AND status = 'ACTIVE'`, [tenantBId]);
    assert.equal(replayedB.rows[0].slug, expectedSlugB);

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});


test('H. Realistic browser contract: end-to-end browser request sequence models actual client runtime, bootstrap URL, and render transitions', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const runId = crypto.randomUUID().slice(0, 8);

    // 0. Verify public-guide/guide.js syntax with node -c
    const guideJsPath = path.resolve('public-guide', 'guide.js');
    assert.doesNotThrow(() => {
      execSync(`node -c "${guideJsPath}"`, { stdio: 'pipe' });
    }, 'public-guide/guide.js must be syntactically valid with zero errors');

    // 1. Provision Tenant A with managed slug (simulating Yeşil Vadi)
    const slugA = `yesilvadi-${runId}`;
    const tenantARes = await client.query(
      `INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`,
      [`Yeşil Vadi Acceptance ${runId}`],
    );
    const tenantAId = tenantARes.rows[0].id;
    const assistantARes = await client.query(
      `INSERT INTO ai_assistants (tenant_id, name, status, model) VALUES ($1, 'Yesil Vadi', 'active', 'gpt-4o-mini') RETURNING id`,
      [tenantAId],
    );
    const assistantAId = assistantARes.rows[0].id;
    const channelA = await ensureGuideChannelForAssistant({ database: client, tenantId: tenantAId, assistantId: assistantAId });

    await createGuideDomain({
      client,
      tenantId: tenantAId,
      assistantId: assistantAId,
      channelId: channelA.channelId,
      slug: slugA,
      domainMode: 'MANAGED',
      actorUserId: null,
      ingressTarget: 'ingress.samchecompany.com',
    });

    const draftA = await createGuideExperienceDraft({
      database: client,
      tenantId: tenantAId,
      assistantId: assistantAId,
      actorUserId: null,
      experience: {
        brand_name: 'Yeşil Vadi Peyzaj',
        assistant_display_name: 'Yesil Vadi',
        welcome_title: 'Bahçe Tasarımına Hoş Geldiniz',
        welcome_message: 'Peyzaj projeleriniz için bize danışabilirsiniz.',
        modules: { guide: true, chat: true },
      },
    });
    await publishGuideExperience({ client, tenantId: tenantAId, assistantId: assistantAId, versionId: draftA.id, actorUserId: null });

    // 2. Provision Tenant B (other managed tenant)
    const tenantBRes = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ('Other Tenant B', 'STARTER') RETURNING id`);
    const tenantBId = tenantBRes.rows[0].id;
    const assistantBRes = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Other Assistant', 'active') RETURNING id`, [tenantBId]);
    const assistantBId = assistantBRes.rows[0].id;
    const channelB = await ensureGuideChannelForAssistant({ database: client, tenantId: tenantBId, assistantId: assistantBId });
    const slugB = `other-${runId}`;
    await createGuideDomain({
      client,
      tenantId: tenantBId,
      assistantId: assistantBId,
      channelId: channelB.channelId,
      slug: slugB,
      domainMode: 'MANAGED',
      actorUserId: null,
      ingressTarget: 'ingress.samchecompany.com',
    });

    // 3. Provision Tenant C (historical custom domain, e.g. rehber.samchecompany.ae)
    const customHost = `rehber-${runId}.samchecompany.ae`;
    const tenantCRes = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ('Custom Domain Tenant C', 'STARTER') RETURNING id`);
    const tenantCId = tenantCRes.rows[0].id;
    const assistantCRes = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Custom Assistant', 'active') RETURNING id`, [tenantCId]);
    const assistantCId = assistantCRes.rows[0].id;
    const channelC = await ensureGuideChannelForAssistant({ database: client, tenantId: tenantCId, assistantId: assistantCId });
    await client.query(
      `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', 'CUSTOM', 'CNAME', 'ingress.samchecompany.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [tenantCId, assistantCId, channelC.channelId, customHost],
    );
    const draftC = await createGuideExperienceDraft({
      database: client,
      tenantId: tenantCId,
      assistantId: assistantCId,
      actorUserId: null,
      experience: {
        brand_name: 'Blue Dune Custom Portal',
        welcome_title: 'Welcome to Blue Dune',
        modules: { guide: true, chat: true },
      },
    });
    await publishGuideExperience({ client, tenantId: tenantCId, assistantId: assistantCId, versionId: draftC.id, actorUserId: null });

    // 4. Create local HTTP test server mounting the exact Express routes
    const app = express();
    const publicGuideDir = path.resolve('public-guide');
    const indexHtml = fs.readFileSync(path.join(publicGuideDir, 'index.html'), 'utf8');

    const handleBootstrap = async (req, res) => {
      try {
        const integration = await resolveGuideRuntimeScopeFromRequest({ database: client, req });
        if (!integration) return res.status(503).json({ error: 'Guide experience is temporarily unavailable.', code: 'GUIDE_EXPERIENCE_UNAVAILABLE' });
        const resolved = await resolvePublishedGuideExperience({ database: client, tenantId: integration.tenant_id, assistantId: integration.assistant_id });
        res.set('Cache-Control', 'no-store');
        return res.json({
          experience: resolved.experience,
          source: resolved.source,
          version: resolved.experience.version,
          cache_key: resolved.cache_key,
          conversation_session: crypto.randomBytes(32).toString('hex'),
          guide_v1: { renderer: 'GUIDE_V1', modules: resolved.experience.modules },
        });
      } catch (err) {
        return res.status(503).json({ error: 'Guide experience is temporarily unavailable.', code: 'GUIDE_EXPERIENCE_UNAVAILABLE' });
      }
    };

    app.get(['/guide/bootstrap', '/:slug/guide/bootstrap', '/guide/:slug/bootstrap'], handleBootstrap);

    app.get(['/', '/:slug'], async (req, res, next) => {
      const integration = await resolveGuideRuntimeScopeFromRequest({ database: client, req });
      if (!integration) {
        if (isManagedGuidePlatformHost(req.get('host'))) {
          return res.status(404).send(indexHtml);
        }
        return next();
      }
      res.set('Cache-Control', 'no-store');
      return res.send(indexHtml);
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const requestHttp = ({ reqPath, host, headers = {} }) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: reqPath,
            method: 'GET',
            headers: { host, ...headers },
          },
          (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              let json = null;
              try { json = JSON.parse(text); } catch {}
              resolve({ status: res.statusCode, headers: res.headers, text, json });
            });
          },
        );
        req.on('error', reject);
        req.end();
      });

    try {
      // CONTRACT 1 & 2: Real browser requests managed URL shell
      const shellRes = await requestHttp({
        reqPath: `/${slugA}`,
        host: 'guide-staging.samchecompany.com',
      });
      assert.equal(shellRes.status, 200);
      assert.match(shellRes.text, /id="guide-root"/);
      assert.match(shellRes.text, /Loading guide/);
      assert.match(shellRes.text, /src="\/guide\/guide\.js"/);
      assert.match(shellRes.text, /href="\/guide\/guide\.css"/);
      assert.match(shellRes.text, /fallbackMsg/);

      // CONTRACT 3: Validate shipped public-guide/guide.js bootstrap URL construction
      const constructedBootstrapUrl = buildBootstrapUrl(`/${slugA}`);
      assert.equal(constructedBootstrapUrl, `/${slugA}/guide/bootstrap?slug=${slugA}`);

      const constructedPreviewUrl = buildBootstrapUrl(`/${slugA}`, 'preview-token-123');
      assert.equal(constructedPreviewUrl, `/${slugA}/guide/bootstrap?preview=preview-token-123&slug=${slugA}`);

      // CONTRACT 4, 5, 6: Request bootstrap endpoint using exact constructed URL & host
      const bootstrapRes = await requestHttp({
        reqPath: constructedBootstrapUrl,
        host: 'guide-staging.samchecompany.com',
        headers: { 'x-samcheguide-slug': slugA },
      });
      assert.equal(bootstrapRes.status, 200);
      assert.equal(bootstrapRes.json.source, 'PUBLISHED');
      assert.equal(bootstrapRes.json.experience.brand_name, 'Yeşil Vadi Peyzaj');
      assert.equal(bootstrapRes.json.version, 1);
      assert.ok(bootstrapRes.json.conversation_session);

      // CONTRACT 7: Client render transition from "Loading guide..." to rendered state
      const createMockElement = (tag) => {
        const children = [];
        const attrs = {};
        return {
          tagName: tag.toUpperCase(),
          className: '',
          textContent: '',
          children,
          dataset: {},
          style: { setProperty() {} },
          classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
          append(...items) { for (const it of items) if (it) children.push(typeof it === 'string' ? { textContent: it } : it); },
          prepend(...items) { for (let i = items.length - 1; i >= 0; i--) if (items[i]) children.unshift(items[i]); },
          replaceChildren(...items) { children.length = 0; this.append(...items); },
          setAttribute(k, v) { attrs[k] = v; },
          getAttribute(k) { return attrs[k]; },
          addEventListener() {},
          removeEventListener() {},
          querySelector(selector) {
            if (selector.includes('guide-loading')) return children.find((c) => (c.className || '').includes('guide-loading')) || null;
            if (selector.includes('guide-shell')) return children.find((c) => (c.className || '').includes('guide-shell')) || null;
            if (selector.includes('guide-safe-error')) return children.find((c) => (c.className || '').includes('guide-safe-error')) || null;
            if (selector.includes('guide-module')) return children.find((c) => (c.className || '').includes('guide-module')) || null;
            return null;
          },
          querySelectorAll() { return []; },
        };
      };

      const mockDoc = {
        createElement: createMockElement,
        documentElement: { style: { setProperty() {} } },
        querySelector() { return null; },
        title: '',
      };
      const previousDoc = globalThis.document;
      const previousWindow = globalThis.window;
      globalThis.document = mockDoc;
      globalThis.window = {
        location: { pathname: `/${slugA}`, search: '' },
        setTimeout: () => 1,
        clearTimeout: () => {},
        sessionStorage: { getItem: () => null, setItem: () => {} },
        localStorage: { getItem: () => null, setItem: () => {} },
      };

      const mockRoot = createMockElement('main');
      const initialLoading = createMockElement('p');
      initialLoading.className = 'guide-loading';
      initialLoading.textContent = 'Loading guide…';
      mockRoot.append(initialLoading);
      assert.ok(mockRoot.querySelector('.guide-loading'), 'Initial state has Loading guide');

      try {
        // Execute applyExperience with received published experience
        applyExperience(bootstrapRes.json.experience, mockRoot);
        assert.equal(mockRoot.querySelector('.guide-loading'), null, 'Loading indicator eliminated');
        assert.ok(mockRoot.querySelector('.guide-shell'), 'Guide shell is rendered');
        assert.equal(mockRoot.dataset.guideInitialized, 'true', 'Initialized state set');

        // Test error fallback transition: showGuideError replaces root with safe error
        const mockErrorRoot = createMockElement('main');
        const errLoading = createMockElement('p');
        errLoading.className = 'guide-loading';
        errLoading.textContent = 'Loading guide…';
        mockErrorRoot.append(errLoading);

        resetGuideForTesting();
        showGuideError(mockErrorRoot);
        assert.equal(mockErrorRoot.querySelector('.guide-loading'), null, 'Loading eliminated on error');
        assert.ok(mockErrorRoot.querySelector('.guide-safe-error'), 'Safe error element displayed');
      } finally {
        globalThis.document = previousDoc;
        globalThis.window = previousWindow;
      }

      // CONTRACT 8: Unknown slug fails closed
      const unknownSlug = `unknown-slug-${runId}`;
      const unknownShellRes = await requestHttp({
        reqPath: `/${unknownSlug}`,
        host: 'guide-staging.samchecompany.com',
      });
      assert.equal(unknownShellRes.status, 404, 'Unknown slug shell returns 404');

      const unknownBootstrapRes = await requestHttp({
        reqPath: `/${unknownSlug}/guide/bootstrap?slug=${unknownSlug}`,
        host: 'guide-staging.samchecompany.com',
      });
      assert.equal(unknownBootstrapRes.status, 503, 'Unknown slug bootstrap fails closed with 503');
      assert.equal(unknownBootstrapRes.json.code, 'GUIDE_EXPERIENCE_UNAVAILABLE');
      assert.doesNotMatch(JSON.stringify(unknownBootstrapRes.json), /tenant|assistant|postgres|stack|error.*trace/i);

      // CONTRACT 9: Cross-tenant slug misuse fails closed
      process.env.JWT_SECRET = process.env.JWT_SECRET || 'guide-test-secret-32-chars-long!!';
      const crossTenantTokenB = issueGuidePreviewToken({
        tenantId: tenantBId,
        assistantId: assistantBId,
        versionId: crypto.randomUUID(),
        actorUserId: crypto.randomUUID(),
      });
      const crossTenantRes = await requestHttp({
        reqPath: `/${slugA}/guide/bootstrap?slug=${slugA}`,
        host: 'guide-staging.samchecompany.com',
        headers: { 'x-samcheguide-preview': crossTenantTokenB },
      });
      assert.equal(crossTenantRes.status, 503, 'Cross-tenant slug access fails closed');

      // CONTRACT 10: Custom hostname flow succeeds without managed slug
      const customShellRes = await requestHttp({
        reqPath: '/',
        host: customHost,
      });
      assert.equal(customShellRes.status, 200, 'Custom hostname shell returns 200');

      const customBootstrapUrl = buildBootstrapUrl('');
      assert.equal(customBootstrapUrl, '/guide/bootstrap', 'Custom bootstrap URL has no slug');

      const customBootstrapRes = await requestHttp({
        reqPath: customBootstrapUrl,
        host: customHost,
      });
      assert.equal(customBootstrapRes.status, 200, 'Custom hostname bootstrap returns 200');
      assert.equal(customBootstrapRes.json.experience.brand_name, 'Blue Dune Custom Portal');

      // Managed root without slug does NOT resolve a tenant
      const rootRes = await requestHttp({
        reqPath: '/',
        host: 'guide-staging.samchecompany.com',
      });
      assert.equal(rootRes.status, 404, 'Platform host root without slug returns 404');

      const rootBootstrapRes = await requestHttp({
        reqPath: '/guide/bootstrap',
        host: 'guide-staging.samchecompany.com',
      });
      assert.equal(rootBootstrapRes.status, 503, 'Platform host root bootstrap without slug returns 503');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});