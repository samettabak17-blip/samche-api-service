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
  repairEligibleGuideDomains,
  resolveActiveGuideDomain,
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
    const hostname = managedGuideHostnameFromSlug(slug, { NODE_ENV: 'staging' });
    const domain = await createGuideDomain({
      client,
      tenantId,
      assistantId,
      channelId: ensuredChannel.channelId,
      hostname,
      domainMode: 'MANAGED',
      actorUserId: null,
      ingressTarget: 'ingress.samchecompany.com',
    });
    assert.equal(domain.status, 'ACTIVE');
    assert.equal(domain.hostname, hostname);
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

    // 8. Resolve public Guide via hostname request
    const resolvedScope = await resolveGuideRuntimeScopeFromRequest({
      database: client,
      req: { headers: { host: hostname } },
    });
    assert.ok(resolvedScope);
    assert.equal(resolvedScope.tenant_id, tenantId);
    assert.equal(resolvedScope.assistant_id, assistantId);
    assert.equal(resolvedScope.channel_id, ensuredChannel.channelId);
    assert.equal(resolvedScope.channel_type, 'SAMCHEGUIDE');

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

    const hostA = `tenant-a-${runId}.guide.staging.samchecompany.com`;
    await createGuideDomain({
      client,
      tenantId: tenantA,
      assistantId: assistantA,
      channelId: channelA.channelId,
      hostname: hostA,
      domainMode: 'MANAGED',
      actorUserId: null,
      ingressTarget: 'ingress.samchecompany.com',
    });

    // 1. Tenant B cannot attach Tenant A's domain (unique hostname conflict)
    await client.query('SAVEPOINT sp_unique');
    await assert.rejects(
      createGuideDomain({
        client,
        tenantId: tenantB,
        assistantId: assistantB,
        channelId: channelB.channelId,
        hostname: hostA,
        domainMode: 'MANAGED',
        actorUserId: null,
        ingressTarget: 'ingress.samchecompany.com',
      }),
      (err) => err?.code === '23505',
    );
    await client.query('ROLLBACK TO SAVEPOINT sp_unique');

    // 2. Hostname A resolves Tenant A ONLY, never Tenant B
    const resolvedA = await resolveActiveGuideDomain({ database: client, hostname: hostA });
    assert.equal(resolvedA?.tenant_id, tenantA);
    assert.notEqual(resolvedA?.tenant_id, tenantB);

    // 3. Tenant B cannot fetch Tenant A's draft
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


test('E. Slug normalization, rejection, and full hostname handling', () => {
  // Normal slug
  assert.equal(
    managedGuideHostnameFromSlug('yesil-vadi', { NODE_ENV: 'staging' }),
    'yesil-vadi.guide.staging.samchecompany.com',
  );

  // Full hostname entered instead of slug: normalizes without double suffix
  assert.equal(
    managedGuideHostnameFromSlug('yesil-vadi.guide.staging.samchecompany.com', { NODE_ENV: 'staging' }),
    'yesil-vadi.guide.staging.samchecompany.com',
  );

  // Repeated suffix: normalizes safely
  assert.equal(
    managedGuideHostnameFromSlug('yesil-vadi.guide.staging.samchecompany.com.guide.staging.samchecompany.com', { NODE_ENV: 'staging' }),
    'yesil-vadi.guide.staging.samchecompany.com',
  );

  // Invalid characters / dots in base slug rejected
  assert.throws(
    () => managedGuideHostnameFromSlug('yesil..vadi', { NODE_ENV: 'staging' }),
    (err) => err instanceof GuideDomainError && err.code === 'GUIDE_DOMAIN_INVALID_SLUG',
  );

  assert.throws(
    () => managedGuideHostnameFromSlug('-invalid-', { NODE_ENV: 'staging' }),
    (err) => err instanceof GuideDomainError && err.code === 'GUIDE_DOMAIN_INVALID_SLUG',
  );

  assert.throws(
    () => managedGuideHostnameFromSlug('otherdomain.org', { NODE_ENV: 'staging' }),
    (err) => err instanceof GuideDomainError && err.code === 'GUIDE_DOMAIN_INVALID_SLUG',
  );
});

test('F. repairEligibleGuideDomains converges multiple tenants idempotently', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const runId = crypto.randomUUID().slice(0, 8);

    const t1 = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`Repair T1 ${runId}`]);
    const a1 = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant 1', 'active') RETURNING id`, [t1.rows[0].id]);

    const t2 = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`Repair T2 ${runId}`]);
    const a2 = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Assistant 2', 'active') RETURNING id`, [t2.rows[0].id]);

    // Run repair across all active assistants
    const repaired1 = await repairEligibleGuideDomains({ database: client });
    assert.ok(repaired1.length >= 2);

    // Verify both have active guide domains
    const d1 = await listGuideDomains({ database: client, tenantId: t1.rows[0].id, assistantId: a1.rows[0].id });
    const d2 = await listGuideDomains({ database: client, tenantId: t2.rows[0].id, assistantId: a2.rows[0].id });
    assert.equal(d1.length, 1);
    assert.equal(d2.length, 1);
    assert.equal(d1[0].status, 'ACTIVE');
    assert.equal(d2[0].status, 'ACTIVE');
    assert.notEqual(d1[0].hostname, d2[0].hostname);

    // Rerun repair: should be idempotent and not create duplicate domains
    await repairEligibleGuideDomains({ database: client });
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
