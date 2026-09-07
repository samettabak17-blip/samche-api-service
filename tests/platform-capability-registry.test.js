import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLATFORM_CAPABILITY_MANIFEST,
  PLATFORM_CAPABILITY_MANIFEST_VERSION,
  PLATFORM_RELATIONSHIP_OWNERSHIP,
  validatePlatformCapabilityManifest,
} from '../services/platform-capability-registry.js';

test('cumulative manifest has unique stable keys and complete release-gate ownership metadata', () => {
  assert.equal(PLATFORM_CAPABILITY_MANIFEST_VERSION, 1);
  assert.equal(validatePlatformCapabilityManifest(PLATFORM_CAPABILITY_MANIFEST), true);

  const keys = PLATFORM_CAPABILITY_MANIFEST.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const required of [
    'platform_foundation', 'language_defaults', 'assistant_core', 'channel_core',
    'crm_contacts', 'deals_pipeline', 'conversations', 'fallback',
    'contextual_followup', 'durable_scheduling', 'human_support', 'live_inbox',
    'escalation', 'notification', 'push_notifications', 'knowledge_intelligence', 'source_processing',
    'business_identity', 'business_profile', 'retrieval', 'guide', 'roadmap',
    'planning', 'guide_assistant', 'guide_shared_context', 'guide_persistence',
  ]) assert.ok(keys.includes(required), `missing ${required}`);

  for (const capability of PLATFORM_CAPABILITY_MANIFEST) {
    assert.match(capability.key, /^[a-z][a-z0-9_]+$/);
    assert.match(capability.introduced_by_task, /^TASK_[1-7]$/);
    assert.ok(capability.canonical_owner_service);
    assert.ok(capability.canonical_source_of_truth);
    assert.ok(capability.canonical_creator);
    assert.ok(capability.historical_convergence_path);
    assert.ok(capability.fresh_tenant_path);
    assert.ok(capability.provisioning_ensure_function);
    assert.ok(capability.existing_tenant_repair_path);
    assert.ok(capability.golden_path_test);
    assert.ok(capability.entitlement_dependency);
    assert.ok(Array.isArray(capability.runtime_dependencies));
    assert.ok(['ALWAYS', 'ON_DEMAND', 'CHANNEL_ENABLED'].includes(capability.enablement));
  }
});

test('manifest explicitly preserves on-demand domain creation and one relationship authority', () => {
  const onDemand = PLATFORM_CAPABILITY_MANIFEST.filter((capability) => capability.enablement !== 'ALWAYS');
  assert.ok(onDemand.length > 0);
  for (const capability of PLATFORM_CAPABILITY_MANIFEST) {
    assert.ok(['PLATFORM_ENSURE', 'DOMAIN_FLOW', 'CHANNEL_FLOW', 'RUNTIME_RESOLUTION'].includes(capability.canonical_creator));
    assert.ok(['IDEMPOTENT_ENSURE', 'REPLAY_SAFE_MIGRATION', 'DOMAIN_OPERATION', 'RUNTIME_VALIDATION'].includes(capability.historical_convergence_path));
    assert.ok(['BASELINE_PROVISIONING', 'NORMAL_DOMAIN_FLOW', 'NORMAL_CHANNEL_FLOW'].includes(capability.fresh_tenant_path));
  }
  for (const capability of onDemand) {
    assert.notEqual(capability.fresh_tenant_path, 'BASELINE_PROVISIONING');
  }
});

test('critical tenant relationships have one documented canonical creator and convergence path', () => {
  const expected = [
    'tenant_user', 'tenant_platform_capability', 'tenant_business_identity',
    'tenant_assistant', 'channel_assistant', 'source_business_identity',
    'source_assistant', 'candidate_source', 'materialized_source_provenance',
    'materialized_source_assistant_scope', 'chunk_source', 'embedding_chunk',
    'business_profile_identity', 'recommendation_profile',
    'configuration_assistant_profile', 'conversation_tenant_channel_assistant',
    'push_subscription_user_device',
  ];
  assert.deepEqual(PLATFORM_RELATIONSHIP_OWNERSHIP.map((relation) => relation.key), expected);
  for (const relation of PLATFORM_RELATIONSHIP_OWNERSHIP) {
    assert.ok(relation.canonical_creator);
    assert.ok(relation.canonical_owner);
    assert.ok(relation.tenant_authority);
    assert.ok(relation.idempotency);
    assert.ok(relation.historical_repair_path);
    assert.ok(relation.fresh_tenant_path);
  }
});

test('manifest is customer-neutral and has no competing authority field', () => {
  const serialized = JSON.stringify(PLATFORM_CAPABILITY_MANIFEST);
  assert.doesNotMatch(serialized, /Blue\s*Dune|Ye[sş]il\s*Vadi|bluedune/i);
  for (const capability of PLATFORM_CAPABILITY_MANIFEST) {
    assert.equal('legacy_source_of_truth' in capability, false);
    assert.equal('duplicate_authority' in capability, false);
  }
});
