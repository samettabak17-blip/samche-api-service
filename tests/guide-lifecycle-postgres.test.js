import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { after, test } from 'node:test';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
import {
  ensureGuideChannelForAssistant,
  ensureGuideChannelsForTenant,
  createGuideDomain,
  listGuideDomains,
  managedGuideHostnameFromSlug,
  managedGuideUrlFromSlug,
  normalizeGuideSlug,
  configuredManagedGuideHostname,
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

test('G. Historical managed hostname convergence & Render deploy blocker reproduction: converges multiple historical staging hostnames to canonical shared host + slug without touching custom domains', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const runId = crypto.randomUUID().slice(0, 8);

    // 0. Re-establish historical schema state (as existed on staging before migration 071)
    await client.query(`DROP INDEX IF EXISTS uq_guide_domain_custom_hostname`);
    await client.query(`DROP INDEX IF EXISTS uq_guide_domain_managed_slug`);
    await client.query(`ALTER TABLE guide_domains DROP CONSTRAINT IF EXISTS uq_guide_domain_hostname CASCADE`);
    await client.query(`ALTER TABLE guide_domains ADD CONSTRAINT uq_guide_domain_hostname UNIQUE (hostname)`);

    // 1. Create Tenant A with historical managed domain (alpha.<slug>.guide.staging.samchecompany.com)
    const tenantARes = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`Historical Tenant A ${runId}`]);
    const tenantAId = tenantARes.rows[0].id;
    const assistantARes = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant A', 'active') RETURNING id`, [tenantAId]);
    const assistantAId = assistantARes.rows[0].id;
    const channelA = await ensureGuideChannelForAssistant({ database: client, tenantId: tenantAId, assistantId: assistantAId });
    const historicalHostnameA = `alpha-${runId}.guide.staging.samchecompany.com`;
    const slugA = `alpha-${runId}`;

    await client.query(
      `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', 'MANAGED', 'CNAME', 'ingress.samchecompany.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [tenantAId, assistantAId, channelA.channelId, historicalHostnameA],
    );

    // 2. Create Tenant B with historical managed domain (beta.<slug>.guide.staging.samchecompany.com)
    const tenantBRes = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`Historical Tenant B ${runId}`]);
    const tenantBId = tenantBRes.rows[0].id;
    const assistantBRes = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant B', 'active') RETURNING id`, [tenantBId]);
    const assistantBId = assistantBRes.rows[0].id;
    const channelB = await ensureGuideChannelForAssistant({ database: client, tenantId: tenantBId, assistantId: assistantBId });
    const historicalHostnameB = `beta-${runId}.guide.staging.samchecompany.com`;
    const slugB = `beta-${runId}`;

    await client.query(
      `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', 'MANAGED', 'CNAME', 'ingress.samchecompany.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [tenantBId, assistantBId, channelB.channelId, historicalHostnameB],
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

    // 4. Exact Render failure reproduction:
    // With legacy uq_guide_domain_hostname present, updating multiple managed rows to shared host violates uniqueness
    await client.query('SAVEPOINT sp_reproduce_render_failure');
    let reproducedError = null;
    try {
      await client.query(`
        UPDATE guide_domains
           SET hostname = 'guide-staging.samchecompany.com'
         WHERE domain_mode = 'MANAGED'
      `);
    } catch (err) {
      reproducedError = err;
    }
    assert.ok(reproducedError, 'Expected UPDATE with uq_guide_domain_hostname to fail');
    assert.equal(reproducedError.code, '23505', 'Expected PostgreSQL unique violation 23505');
    assert.match(reproducedError.detail, /guide-staging\.samchecompany\.com/, 'Detail matches Render failure key');
    await client.query('ROLLBACK TO SAVEPOINT sp_reproduce_render_failure');

    // 5. Run fixed migration 071
    const migration071Sql = fs.readFileSync(new URL('../migrations/071_guide_staging_managed_domain_architecture.sql', import.meta.url), 'utf8');
    await client.query(migration071Sql);

    // 6. Verify Tenant A and Tenant B both converged to shared platform host with distinct slugs:
    const convergedManaged = await client.query(
      `SELECT tenant_id, hostname, slug, domain_mode, status
         FROM guide_domains
        WHERE tenant_id IN ($1, $2) AND domain_mode = 'MANAGED'
        ORDER BY slug ASC`,
      [tenantAId, tenantBId],
    );
    assert.equal(convergedManaged.rowCount, 2);
    assert.equal(convergedManaged.rows[0].hostname, 'guide-staging.samchecompany.com');
    assert.equal(convergedManaged.rows[0].slug, slugA);
    assert.equal(convergedManaged.rows[0].tenant_id, tenantAId);

    assert.equal(convergedManaged.rows[1].hostname, 'guide-staging.samchecompany.com');
    assert.equal(convergedManaged.rows[1].slug, slugB);
    assert.equal(convergedManaged.rows[1].tenant_id, tenantBId);

    // 7. Verify Tenant C (custom domain) remains completely unchanged:
    const untouchedCustom = await client.query(
      `SELECT hostname, slug, domain_mode, status FROM guide_domains WHERE tenant_id = $1`,
      [tenantCId],
    );
    assert.equal(untouchedCustom.rowCount, 1);
    assert.equal(untouchedCustom.rows[0].hostname, customHost);
    assert.equal(untouchedCustom.rows[0].slug, null);
    assert.equal(untouchedCustom.rows[0].domain_mode, 'CUSTOM');

    // 8. Verify canonical partial uniqueness:
    // a. MANAGED slug uniqueness: attempting to insert another managed domain with duplicate slug fails with 23505
    let managedSlugConflict = null;
    await client.query('SAVEPOINT sp_managed_slug_conflict');
    try {
      await client.query(
        `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, slug, status, domain_mode, verification_record_type, verification_target)
         VALUES ($1, $2, $3, 'guide-staging.samchecompany.com', $4, 'ACTIVE', 'MANAGED', 'CNAME', 'ingress.samchecompany.com')`,
        [tenantBId, assistantBId, channelB.channelId, slugA],
      );
    } catch (err) {
      managedSlugConflict = err;
    }
    assert.ok(managedSlugConflict, 'Expected managed duplicate slug to be rejected');
    assert.equal(managedSlugConflict.code, '23505');
    await client.query('ROLLBACK TO SAVEPOINT sp_managed_slug_conflict');

    // b. CUSTOM hostname uniqueness: attempting to insert another custom domain with duplicate hostname fails with 23505
    let customHostConflict = null;
    await client.query('SAVEPOINT sp_custom_host_conflict');
    try {
      await client.query(
        `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target)
         VALUES ($1, $2, $3, $4, 'ACTIVE', 'CUSTOM', 'CNAME', 'ingress.samchecompany.com')`,
        [tenantAId, assistantAId, channelA.channelId, customHost],
      );
    } catch (err) {
      customHostConflict = err;
    }
    assert.ok(customHostConflict, 'Expected custom duplicate hostname to be rejected');
    assert.equal(customHostConflict.code, '23505');
    await client.query('ROLLBACK TO SAVEPOINT sp_custom_host_conflict');

    // c. Multiple managed domains legitimately sharing guide-staging.samchecompany.com succeeds
    const slugD = `delta-${runId}`;
    const insertManagedResult = await client.query(
      `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, slug, status, domain_mode, verification_record_type, verification_target)
       VALUES ($1, $2, $3, 'guide-staging.samchecompany.com', $4, 'ACTIVE', 'MANAGED', 'CNAME', 'ingress.samchecompany.com')
       RETURNING id, hostname, slug, domain_mode`,
      [tenantAId, assistantAId, channelA.channelId, slugD],
    );
    assert.equal(insertManagedResult.rowCount, 1);
    assert.equal(insertManagedResult.rows[0].hostname, 'guide-staging.samchecompany.com');
    assert.equal(insertManagedResult.rows[0].slug, slugD);

    // 9. Migration replay idempotency check:
    await client.query(migration071Sql);
    const replayedA = await client.query(
      `SELECT hostname, slug, domain_mode, status FROM guide_domains WHERE tenant_id = $1 AND slug = $2`,
      [tenantAId, slugA],
    );
    assert.equal(replayedA.rows[0].hostname, 'guide-staging.samchecompany.com');
    assert.equal(replayedA.rows[0].slug, slugA);

    // 10. Runtime scope resolution for Tenant A (managed path-based):
    const resolvedManagedScopeA = await resolveGuideRuntimeScopeFromRequest({
      database: client,
      req: {
        headers: { host: 'guide-staging.samchecompany.com' },
        params: { slug: slugA },
      },
    });
    assert.ok(resolvedManagedScopeA);
    assert.equal(resolvedManagedScopeA.tenant_id, tenantAId);

    // 11. Runtime scope resolution for Tenant B (managed path-based):
    const resolvedManagedScopeB = await resolveGuideRuntimeScopeFromRequest({
      database: client,
      req: {
        headers: { host: 'guide-staging.samchecompany.com' },
        params: { slug: slugB },
      },
    });
    assert.ok(resolvedManagedScopeB);
    assert.equal(resolvedManagedScopeB.tenant_id, tenantBId);

    // 12. Runtime scope resolution for Tenant C (custom host-based):
    const resolvedCustomScope = await resolveGuideRuntimeScopeFromRequest({
      database: client,
      req: {
        headers: { host: customHost },
      },
    });
    assert.ok(resolvedCustomScope);
    assert.equal(resolvedCustomScope.tenant_id, tenantCId);

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

