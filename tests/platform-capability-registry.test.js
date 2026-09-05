import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLATFORM_CAPABILITY_MANIFEST,
  PLATFORM_CAPABILITY_MANIFEST_VERSION,
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
    'escalation', 'notification', 'knowledge_intelligence', 'source_processing',
    'business_identity', 'business_profile', 'retrieval', 'guide', 'roadmap',
    'planning', 'guide_assistant', 'guide_shared_context', 'guide_persistence',
  ]) assert.ok(keys.includes(required), `missing ${required}`);

  for (const capability of PLATFORM_CAPABILITY_MANIFEST) {
    assert.match(capability.key, /^[a-z][a-z0-9_]+$/);
    assert.match(capability.introduced_by_task, /^TASK_[1-7]$/);
    assert.ok(capability.canonical_owner_service);
    assert.ok(capability.canonical_source_of_truth);
    assert.ok(capability.provisioning_ensure_function);
    assert.ok(capability.existing_tenant_repair_path);
    assert.ok(capability.golden_path_test);
    assert.ok(capability.entitlement_dependency);
    assert.ok(Array.isArray(capability.runtime_dependencies));
    assert.ok(['ALWAYS', 'ON_DEMAND', 'CHANNEL_ENABLED'].includes(capability.enablement));
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
