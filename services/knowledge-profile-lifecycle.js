import {
  advanceKnowledgeGenerationRun,
  beginKnowledgeGenerationRun,
  completeKnowledgeGenerationRun,
  failKnowledgeGenerationRun,
  KnowledgeGenerationPersistenceError,
} from './knowledge-generation-persistence.js';
import crypto from 'node:crypto';
import { analyzeBusinessIdentityScope, normalizeBusinessIdentity, summarizeBusinessIdentityEvidence } from './business-identity-service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class KnowledgeProfileLifecycleError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function uuid(value, code) {
  if (!UUID_PATTERN.test(String(value ?? ''))) throw new KnowledgeProfileLifecycleError(code, 'Business Profile identifier is invalid');
  return String(value);
}

const IDENTITY_ANALYSIS_SCHEMA_VERSION = 1;
const BUSINESS_PROFILE_SCHEMA_VERSION = 2;

async function loadBusinessProfileSourceScope({ database, tenantId, businessIdentityId, sourceIds }) {
  uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  uuid(businessIdentityId, 'KNOWLEDGE_BUSINESS_IDENTITY_INVALID');
  if (!Array.isArray(sourceIds) || !sourceIds.length || new Set(sourceIds).size !== sourceIds.length) {
    throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_SOURCE_SCOPE_INVALID', 'Business Profile source scope is invalid');
  }
  sourceIds.forEach((id) => uuid(id, 'KNOWLEDGE_PROFILE_SOURCE_SCOPE_INVALID'));
  if (!database?.query) {
    throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_GENERATION_UNAVAILABLE', 'Business Profile generation is unavailable');
  }
  const identity = await database.query(
    `SELECT id, display_name, normalized_identity FROM business_identities
      WHERE id = $1 AND tenant_id = $2 AND status = 'ACTIVE'`,
    [businessIdentityId, tenantId],
  );
  if (!identity.rows[0]) throw new KnowledgeProfileLifecycleError('KNOWLEDGE_BUSINESS_IDENTITY_NOT_FOUND', 'Business Identity was not found');
  const sources = await database.query(
    `SELECT source.id, source.title, source.content, source.content_hash,
            COALESCE((
              SELECT array_agg(DISTINCT identity_link.business_identity_id)
                FROM (
                  SELECT direct_identity.business_identity_id
                    FROM knowledge_source_business_identities direct_identity
                   WHERE direct_identity.tenant_id = source.tenant_id
                     AND direct_identity.source_id = source.id
                  UNION
                  SELECT provenance_identity.business_identity_id
                    FROM knowledge_candidates candidate
                    JOIN knowledge_candidate_image_evidence image_evidence
                      ON image_evidence.tenant_id = candidate.tenant_id
                     AND image_evidence.candidate_id = candidate.id
                    JOIN knowledge_source_business_identities provenance_identity
                      ON provenance_identity.tenant_id = image_evidence.tenant_id
                     AND provenance_identity.source_id = image_evidence.source_id
                   WHERE candidate.tenant_id = source.tenant_id
                     AND (candidate.approved_source_id = source.id OR image_evidence.source_id = source.id)
                ) AS identity_link
            ), ARRAY[]::uuid[]) AS trusted_identity_ids
       FROM knowledge_base_documents source
      WHERE source.tenant_id = $1 AND source.id = ANY($2::uuid[]) AND source.enabled = TRUE AND source.status = 'active'
        AND processing_status = 'READY' AND indexing_status = 'READY' AND content_hash IS NOT NULL
      ORDER BY source.id`,
    [tenantId, sourceIds],
  );
  if (sources.rows.length !== sourceIds.length) throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_SOURCE_SCOPE_INVALID', 'One or more selected sources are unavailable or ineligible');
  return { business_identity: identity.rows[0], source_ids: sourceIds, sources: sources.rows };
}

function uniqueTrustedIdentityIds(source) {
  return [...new Set(Array.isArray(source.trusted_identity_ids) ? source.trusted_identity_ids.filter(Boolean).map(String) : [])];
}

function trustedProvenance(scope, businessIdentityId) {
  const inherited = [];
  const conflicting = [];
  const unresolved = [];
  for (const source of scope.sources) {
    const identities = uniqueTrustedIdentityIds(source);
    if (!identities.length) {
      unresolved.push(source);
    } else if (identities.length === 1 && identities[0] === String(businessIdentityId)) {
      inherited.push({
        source_id: source.id,
        source_title: source.title,
        content_hash: source.content_hash ?? null,
        detected_identity: scope.business_identity.display_name,
        normalized_identity: scope.business_identity.normalized_identity || normalizeBusinessIdentity(scope.business_identity.display_name),
        confidence: 1,
        safe_evidence: 'Trusted source provenance',
        resolution_origin: 'PROVENANCE_INHERITED',
      });
    } else {
      conflicting.push({
        source_id: source.id,
        source_title: source.title,
        content_hash: source.content_hash ?? null,
        detected_identity: 'conflicting trusted provenance',
        normalized_identity: null,
        confidence: 0,
        safe_evidence: 'Selected source is linked to a different or ambiguous Business Identity.',
        resolution_origin: 'CONFLICTING_PROVENANCE',
      });
    }
  }
  return { inherited, conflicting, unresolved };
}

async function resolveBusinessIdentityAnalysis({ database, provider, tenantId, businessIdentityId, scope }) {
  const provenance = trustedProvenance(scope, businessIdentityId);
  if (provenance.conflicting.length) {
    return {
      status: 'IDENTITY_RESOLUTION_REQUIRED',
      identities: [],
      evidence: [...provenance.inherited, ...provenance.conflicting],
      persistable_evidence: [],
    };
  }
  if (!provenance.unresolved.length) {
    return {
      status: 'RESOLVED',
      identities: [{ detected_identity: scope.business_identity.display_name, normalized_identity: scope.business_identity.normalized_identity || normalizeBusinessIdentity(scope.business_identity.display_name), source_ids: provenance.inherited.map((item) => item.source_id) }],
      evidence: provenance.inherited,
      persistable_evidence: [],
    };
  }
  const existing = await database.query(
    `SELECT evidence.source_id, source.title AS source_title, evidence.content_hash, evidence.detected_identity,
            evidence.normalized_detected_identity AS normalized_identity, evidence.confidence, evidence.safe_evidence
       FROM business_identity_source_evidence evidence
       JOIN knowledge_base_documents source ON source.id = evidence.source_id AND source.tenant_id = evidence.tenant_id
      WHERE evidence.tenant_id = $1 AND evidence.business_identity_id = $2
        AND evidence.source_id = ANY($3::uuid[]) AND evidence.provider = $4 AND evidence.model = $5
        AND evidence.analysis_schema_version = $6`,
    [tenantId, businessIdentityId, provenance.unresolved.map((source) => source.id), provider.provider, provider.model, IDENTITY_ANALYSIS_SCHEMA_VERSION],
  );
  const exact = existing.rows.filter((item) => provenance.unresolved.some((source) => source.id === item.source_id && source.content_hash === item.content_hash));
  let analysis;
  if (exact.length === provenance.unresolved.length) {
    analysis = summarizeBusinessIdentityEvidence(exact);
  } else {
    analysis = await analyzeBusinessIdentityScope({ provider, sources: provenance.unresolved });
  }
  const combined = summarizeBusinessIdentityEvidence([...provenance.inherited, ...analysis.evidence]);
  combined.evidence = combined.evidence.map((item) => ({
    ...item,
    resolution_origin: provenance.inherited.some((inherited) => inherited.source_id === item.source_id)
      ? 'PROVENANCE_INHERITED'
      : 'SEMANTIC_INFERRED',
  }));
  combined.persistable_evidence = analysis.evidence;
  for (const item of combined.persistable_evidence) {
    await database.query(
      `INSERT INTO business_identity_source_evidence
         (tenant_id, business_identity_id, source_id, content_hash, detected_identity, normalized_detected_identity, confidence, safe_evidence, provider, model, analysis_schema_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (tenant_id, business_identity_id, source_id, content_hash)
       DO UPDATE SET detected_identity = EXCLUDED.detected_identity, normalized_detected_identity = EXCLUDED.normalized_detected_identity,
                     confidence = EXCLUDED.confidence, safe_evidence = EXCLUDED.safe_evidence, provider = EXCLUDED.provider, model = EXCLUDED.model,
                     analysis_schema_version = EXCLUDED.analysis_schema_version, updated_at = CURRENT_TIMESTAMP`,
      [tenantId, businessIdentityId, item.source_id, item.content_hash, item.detected_identity, item.normalized_identity, item.confidence, item.safe_evidence, provider.provider, provider.model, IDENTITY_ANALYSIS_SCHEMA_VERSION],
    );
  }
  return combined;
}

function requestFingerprint({ tenantId, businessIdentityId, sources, provider }) {
  const canonical = {
    tenant_id: tenantId,
    business_identity_id: businessIdentityId,
    sources: sources.map(({ id, content_hash }) => ({ id, content_hash })).sort((a, b) => a.id.localeCompare(b.id)),
    schema_version: BUSINESS_PROFILE_SCHEMA_VERSION,
    provider: provider.provider,
    model: provider.model,
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function advisoryKey(fingerprint) {
  return BigInt.asIntN(64, BigInt(`0x${fingerprint.slice(0, 16)}`)).toString();
}

async function withGenerationFingerprintLock(database, fingerprint, operation) {
  if (typeof database?.connect !== 'function') return operation(database);
  const client = await database.connect();
  const key = advisoryKey(fingerprint);
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [key]);
    return await operation(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [key]).catch(() => {});
    client.release();
  }
}

async function existingSuccessfulProfile({ database, tenantId, fingerprint }) {
  const result = await database.query(
    `SELECT version.id, version.profile_id, version.schema_version, version.profile_data,
            version.evidence, version.source_scope, version.status, version.identity_resolution_status,
            version.created_at, profile.business_identity_id, identity.display_name AS business_identity_name,
            profile.active_version_id, run.id AS run_id
       FROM knowledge_generation_runs run
       JOIN business_profile_versions version ON version.id = run.target_id AND version.tenant_id = run.tenant_id
       JOIN business_profiles profile ON profile.id = version.profile_id AND profile.tenant_id = version.tenant_id
       LEFT JOIN business_identities identity ON identity.id = profile.business_identity_id AND identity.tenant_id = profile.tenant_id
      WHERE run.tenant_id = $1 AND run.target_type = 'BUSINESS_PROFILE'
        AND run.request_fingerprint = $2 AND run.status = 'SUCCEEDED'
      LIMIT 1`,
    [tenantId, fingerprint],
  );
  return result.rows[0] ?? null;
}

export async function analyzeBusinessProfileSourceScope({ database, provider, tenantId, businessIdentityId, sourceIds }) {
  if (typeof provider?.generateBusinessIdentityAnalysis !== 'function') throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_GENERATION_UNAVAILABLE', 'Business Profile generation is unavailable');
  const scope = await loadBusinessProfileSourceScope({ database, tenantId, businessIdentityId, sourceIds });
  const analysis = await resolveBusinessIdentityAnalysis({ database, provider, tenantId, businessIdentityId, scope });
  const selectedIdentity = scope.business_identity.normalized_identity || normalizeBusinessIdentity(scope.business_identity.display_name);
  const status = analysis.status === 'RESOLVED' && analysis.identities[0]?.normalized_identity === selectedIdentity ? 'RESOLVED' : 'IDENTITY_RESOLUTION_REQUIRED';
  return { status, business_identity: scope.business_identity, source_ids: sourceIds, identities: analysis.identities, evidence: analysis.evidence, sources: scope.sources };
}

export async function generateBusinessProfileVersion({ database, provider, tenantId, requestedBy, businessIdentityId, sourceIds }) {
  uuid(requestedBy, 'KNOWLEDGE_REQUESTER_INVALID');
  if (typeof provider?.generateBusinessProfile !== 'function') throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_GENERATION_UNAVAILABLE', 'Business Profile generation is unavailable');
  const baseScope = await loadBusinessProfileSourceScope({ database, tenantId, businessIdentityId, sourceIds });
  const fingerprint = requestFingerprint({ tenantId, businessIdentityId, sources: baseScope.sources, provider });
  return withGenerationFingerprintLock(database, fingerprint, async (generationDatabase) => {
    const successful = await existingSuccessfulProfile({ database: generationDatabase, tenantId, fingerprint });
    if (successful) {
      const { run_id: runId, ...profile } = successful;
      return { profile, reused: true, run_id: runId };
    }
    const active = await generationDatabase.query(
      `SELECT id FROM knowledge_generation_runs
        WHERE tenant_id = $1 AND target_type = 'BUSINESS_PROFILE' AND request_fingerprint = $2 AND status = 'RUNNING'
        LIMIT 1`,
      [tenantId, fingerprint],
    );
    if (active.rows[0]) throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_GENERATION_IN_PROGRESS', 'An identical Business Profile generation attempt is already running');

    const startedAt = Date.now();
    let run;
    let runStage = 'IDENTITY_ANALYSIS';
    const baseProvenance = { business_identity_id: businessIdentityId, source_ids: sourceIds, source_hashes: baseScope.sources.map(({ id, content_hash }) => ({ id, content_hash })) };
    run = await beginKnowledgeGenerationRun({ database: generationDatabase, tenantId, requestedBy, targetType: 'BUSINESS_PROFILE', provider: provider.provider, model: provider.model,
      prompt: `generation-attempt:${fingerprint}`, provenance: baseProvenance, businessIdentityId, requestFingerprint: fingerprint,
      stage: runStage, promptCharacterCount: 0, sourceCount: baseScope.sources.length });
    try {
    const analysis = await resolveBusinessIdentityAnalysis({ database: generationDatabase, provider, tenantId, businessIdentityId, scope: baseScope });
    const selectedIdentity = baseScope.business_identity.normalized_identity || normalizeBusinessIdentity(baseScope.business_identity.display_name);
    const status = analysis.status === 'RESOLVED' && analysis.identities[0]?.normalized_identity === selectedIdentity ? 'RESOLVED' : 'IDENTITY_RESOLUTION_REQUIRED';
    if (status !== 'RESOLVED') {
      throw new KnowledgeProfileLifecycleError('IDENTITY_RESOLUTION_REQUIRED', 'Selected sources contain unresolved or conflicting company identities', { identities: analysis.identities, evidence: analysis.evidence });
    }
    const provenance = { ...baseProvenance, sources: analysis.evidence };
  const prompt = [
    'Create Business Profile schema_version 2 from the current tenant approved knowledge only.',
    `The resolved Business Identity is "${baseScope.business_identity.display_name}". Do not merge, rename, or import another company identity.`,
    'Never use SamChe or any other company, persona, service, price, geography, or behavior as a default.',
    'Extract factual business data only. If evidence is insufficient, use the literal value "unknown"; do not invent a company policy or behavior.',
    'Keep source-derived facts distinct from later AI recommendations. Return only the requested structured fields.',
    ...baseScope.sources.map((source) => `SOURCE ${source.id} — ${source.title}\n${String(source.content).slice(0, 12000)}`),
  ].join('\n\n');
    runStage = 'PROFILE_GENERATION';
    await advanceKnowledgeGenerationRun({ database: generationDatabase, tenantId, runId: run.id, stage: runStage, promptCharacterCount: prompt.length, sourceCount: baseScope.sources.length, elapsedMs: Date.now() - startedAt });
    const profileData = await provider.generateBusinessProfile({ prompt });
    runStage = 'PERSISTENCE';
    await advanceKnowledgeGenerationRun({ database: generationDatabase, tenantId, runId: run.id, stage: runStage, promptCharacterCount: prompt.length, sourceCount: baseScope.sources.length, elapsedMs: Date.now() - startedAt });
    await generationDatabase.query('BEGIN');
    try {
    const profile = await generationDatabase.query(
    `INSERT INTO business_profiles (tenant_id, business_identity_id) VALUES ($1, $2)
       ON CONFLICT (tenant_id, business_identity_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING id, active_version_id`,
      [tenantId, businessIdentityId],
    );
    for (const sourceId of sourceIds) {
      await generationDatabase.query(`INSERT INTO knowledge_source_business_identities (tenant_id, source_id, business_identity_id)
        VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [tenantId, sourceId, businessIdentityId]);
    }
    const version = await generationDatabase.query(
      `INSERT INTO business_profile_versions
         (profile_id, tenant_id, profile_data, evidence, generation_run_id, schema_version, identity_resolution_status, source_scope, generated_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'AI', 'NEEDS_REVIEW')
       RETURNING id, profile_id, schema_version, profile_data, evidence, source_scope,
                 status, identity_resolution_status, created_at`,
      [profile.rows[0].id, tenantId, profileData, provenance, run.id, BUSINESS_PROFILE_SCHEMA_VERSION, 'RESOLVED', { business_identity_id: businessIdentityId, source_ids: sourceIds }],
    );
    await completeKnowledgeGenerationRun({ database: generationDatabase, tenantId, runId: run.id, targetId: version.rows[0].id, output: profileData, elapsedMs: Date.now() - startedAt });
    await generationDatabase.query('COMMIT');
    return {
      profile: {
        ...version.rows[0],
        business_identity_id: businessIdentityId,
        business_identity_name: baseScope.business_identity.display_name,
        active_version_id: profile.rows[0].active_version_id,
      },
      reused: false,
      run_id: run.id,
    };
    } catch (persistenceError) {
      await generationDatabase.query('ROLLBACK').catch(() => {});
      throw persistenceError;
    }
  } catch (error) {
    const errorCode = /^[A-Z][A-Z0-9_]{2,63}$/.test(String(error?.code ?? '')) ? error.code : 'KNOWLEDGE_PROFILE_GENERATION_FAILED';
    await failKnowledgeGenerationRun({ database: generationDatabase, tenantId, runId: run.id, errorCode, stage: runStage, elapsedMs: Date.now() - startedAt }).catch(() => {});
    throw error;
  }
  });
}

export async function rejectBusinessProfileVersion({ database, tenantId, versionId, reviewedBy }) {
  const result = await database.query(
    `UPDATE business_profile_versions
        SET status = 'REJECTED', reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2 AND status IN ('DRAFT', 'NEEDS_REVIEW')
      RETURNING id, status`,
    [uuid(versionId, 'KNOWLEDGE_PROFILE_VERSION_INVALID'), uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'), uuid(reviewedBy, 'KNOWLEDGE_REVIEWER_INVALID')],
  );
  if (!result.rows[0]) throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_NOT_REVIEWABLE', 'Business Profile is not available for rejection');
  return result.rows[0];
}

export async function updateBusinessProfileReview({ database, tenantId, versionId, profileData }) {
  uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  uuid(versionId, 'KNOWLEDGE_PROFILE_VERSION_INVALID');
  if (!profileData || typeof profileData !== 'object' || Array.isArray(profileData) || !Object.keys(profileData).length) {
    throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_DATA_INVALID', 'Business Profile review data is invalid');
  }
  const result = await database.query(
    `UPDATE business_profile_versions
        SET profile_data = $3
      WHERE id = $1 AND tenant_id = $2 AND status = 'NEEDS_REVIEW'
      RETURNING id, status, profile_data`,
    [versionId, tenantId, profileData],
  );
  if (!result.rows[0]) throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_NOT_REVIEWABLE', 'Business Profile is not available for editing');
  return result.rows[0];
}

export { KnowledgeGenerationPersistenceError };
