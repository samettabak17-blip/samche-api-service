export const PLATFORM_CAPABILITY_MANIFEST_VERSION = 1;

const GOLDEN_PATH = 'tests/fresh-tenant-golden-path.test.js';
const ENSURE = 'ensure_tenant_platform_capabilities';
const REPAIR = 'repairTenantPlatformCapabilities';

function lifecycleFor(enablement, key) {
  if (enablement === 'ALWAYS') {
    return {
      canonical_creator: 'PLATFORM_ENSURE',
      historical_convergence_path: 'IDEMPOTENT_ENSURE',
      fresh_tenant_path: 'BASELINE_PROVISIONING',
    };
  }
  if (enablement === 'CHANNEL_ENABLED') {
    return {
      canonical_creator: key === 'guide_persistence' ? 'RUNTIME_RESOLUTION' : 'CHANNEL_FLOW',
      historical_convergence_path: 'RUNTIME_VALIDATION',
      fresh_tenant_path: 'NORMAL_CHANNEL_FLOW',
    };
  }
  return {
    canonical_creator: key === 'retrieval' ? 'RUNTIME_RESOLUTION' : 'DOMAIN_FLOW',
    historical_convergence_path: 'DOMAIN_OPERATION',
    fresh_tenant_path: 'NORMAL_DOMAIN_FLOW',
  };
}

function capability(key, task, owner, authority, enablement, runtimeDependencies = [], entitlement = 'NONE') {
  return Object.freeze({
    key,
    introduced_by_task: `TASK_${task}`,
    canonical_owner_service: owner,
    canonical_source_of_truth: authority,
    provisioning_ensure_function: ENSURE,
    existing_tenant_repair_path: REPAIR,
    golden_path_test: GOLDEN_PATH,
    entitlement_dependency: entitlement,
    runtime_dependencies: Object.freeze([...runtimeDependencies]),
    enablement,
    ...lifecycleFor(enablement, key),
  });
}

function relationship(key, canonicalCreator, canonicalOwner, tenantAuthority, idempotency, historicalRepairPath, freshTenantPath) {
  return Object.freeze({
    key,
    canonical_creator: canonicalCreator,
    canonical_owner: canonicalOwner,
    tenant_authority: tenantAuthority,
    idempotency,
    historical_repair_path: historicalRepairPath,
    fresh_tenant_path: freshTenantPath,
  });
}

export const PLATFORM_RELATIONSHIP_OWNERSHIP = Object.freeze([
  relationship('tenant_user', 'customer-onboarding-service', 'tenant_users', 'authenticated owner/customer administration', 'owner onboarding idempotency key', 'existing tenant membership constraints', 'normal onboarding'),
  relationship('tenant_platform_capability', 'tenant-platform-provisioning-service', 'tenant_platform_provisioning', 'tenant id in caller transaction', 'ensure_tenant_platform_capabilities', 'repairTenantPlatformCapabilities', 'createTenantWithPlatformCapabilities'),
  relationship('tenant_business_identity', 'knowledge-intelligence tenant-admin route', 'business_identities', 'authenticated tenant admin', 'tenant normalized identity uniqueness', 'none; explicit domain intent required', 'normal Business Identity creation'),
  relationship('tenant_assistant', 'assistant domain operation', 'ai_assistants', 'authenticated tenant administration', 'tenant-scoped assistant operation', 'existing tenant-scoped assistant data', 'normal assistant creation'),
  relationship('channel_assistant', 'channel domain operation', 'tenant_channels + channel_integrations', 'same-tenant channel/assistant validation', 'tenant-scoped channel binding', 'runtime scope validation', 'normal channel enablement'),
  relationship('source_business_identity', 'assignKnowledgeSourceBusinessIdentity', 'knowledge_source_business_identities + assignment events', 'authenticated tenant admin', 'same identity assignment converges', 'unambiguous explicit assignment convergence', 'normal explicit assignment'),
  relationship('source_assistant', 'knowledge source scope operation', 'knowledge_source_assistants', 'same-tenant source/assistant validation', 'tenant/source/assistant uniqueness', 'migration 067 + normal scope operation', 'normal source scope assignment'),
  relationship('candidate_source', 'candidate generation service', 'knowledge_candidates + evidence', 'tenant-scoped source ownership', 'candidate fingerprint/domain idempotency', 'candidate evidence migration path', 'normal candidate generation'),
  relationship('materialized_source_provenance', 'candidate approval service', 'knowledge_materialized_source_provenance', 'approved tenant candidate provenance', 'candidate materialization idempotency', 'historical provenance migrations', 'normal approval materialization'),
  relationship('materialized_source_assistant_scope', 'candidate approval service', 'knowledge_source_assistants', 'same-tenant original source scope or active profile identity', 'tenant/source/assistant uniqueness', 'migration 067 + 069', 'normal materialization inheritance'),
  relationship('chunk_source', 'knowledge source indexing service', 'knowledge_chunks', 'tenant-owned indexed source', 'source/chunk index uniqueness', 'normal reindex job only', 'normal indexing'),
  relationship('embedding_chunk', 'knowledge source indexing service', 'knowledge_chunks.embedding', 'tenant-owned indexed chunk', 'chunk index replacement semantics', 'normal reindex job only', 'normal indexing'),
  relationship('business_profile_identity', 'business profile lifecycle service', 'business_profiles + versions', 'tenant-scoped canonical identity', 'version/run idempotency', 'durable profile generation job', 'normal profile generation'),
  relationship('recommendation_profile', 'assistant recommendation lifecycle service', 'assistant_recommendation_versions', 'tenant-scoped approved profile', 'generation job idempotency', 'durable recommendation generation job', 'normal recommendation generation'),
  relationship('configuration_assistant_profile', 'assistant configuration lifecycle service', 'assistant_configuration_versions', 'tenant-scoped assistant and active profile', 'generation job idempotency', 'durable configuration generation job', 'normal configuration generation'),
  relationship('conversation_tenant_channel_assistant', 'live inbox ingress service', 'conversations + messages', 'resolved enabled channel integration', 'external message id/idempotency key', 'durable conversation state', 'normal channel ingress'),
  relationship('push_subscription_user_device', 'push notification subscription service', 'push_subscriptions', 'authenticated tenant user', 'tenant/user/endpoint uniqueness', 'opt-in subscription convergence', 'explicit device subscription'),
]);

export const PLATFORM_CAPABILITY_MANIFEST = Object.freeze([
  capability('platform_foundation', 1, 'tenant-platform-provisioning-service', 'tenants + tenant_users', 'ALWAYS', ['PostgreSQL']),
  capability('language_defaults', 1, 'conversation-communication-language', 'persisted conversation language + platform locale policy', 'ALWAYS', ['conversations']),
  capability('assistant_core', 2, 'assistant-runtime-resolution-service', 'tenant-owned ai_assistants', 'ON_DEMAND', ['ai_assistants']),
  capability('channel_core', 2, 'assistant-runtime-resolution-service', 'tenant_channels + channel_integrations', 'ON_DEMAND', ['tenant_channels']),
  capability('webchat', 2, 'public-web-chat-integration-service', 'enabled WEB_CHAT channel integration', 'CHANNEL_ENABLED', ['tenant_channels', 'channel_integrations'], 'CHANNEL_ENABLEMENT'),
  capability('whatsapp', 2, 'whatsapp-live-inbox-service', 'enabled WHATSAPP channel integration', 'CHANNEL_ENABLED', ['tenant_channels', 'channel_integrations'], 'CHANNEL_ENABLEMENT'),
  capability('crm_contacts', 3, 'crm-read-service', 'tenant-scoped contacts', 'ALWAYS', ['contacts']),
  capability('deals_pipeline', 4, 'crm-deal-read-service', 'tenant-scoped deals and pipeline stages', 'ALWAYS', ['deals', 'pipeline_stages']),
  capability('conversations', 5, 'live-inbox-service', 'tenant-scoped conversations and messages', 'ALWAYS', ['conversations', 'conversation_messages']),
  capability('fallback', 5, 'assistant-runtime-resolution-service', 'platform deterministic fallback policy', 'ALWAYS', ['resolved tenant runtime']),
  capability('contextual_followup', 5, 'durable-follow-up-service', 'conversation_scheduled_jobs', 'ON_DEMAND', ['active conversation', 'active tenant persona'], 'FEATURE_ENABLEMENT'),
  capability('durable_scheduling', 5, 'durable-follow-up-service', 'conversation_scheduled_jobs', 'ALWAYS', ['PostgreSQL']),
  capability('human_support', 5, 'human-support-service', 'conversations handling state + platform lifecycle templates', 'ALWAYS', ['conversations', 'platform_lifecycle_message_templates']),
  capability('live_inbox', 5, 'live-inbox-service', 'tenant-scoped conversations and durable events', 'ALWAYS', ['conversations', 'conversation_audit_events']),
  capability('escalation', 5, 'human-support-service', 'human_support_escalation_policies + levels + instances', 'ALWAYS', ['human_support_escalations']),
  capability('notification', 5, 'human-support-notification-outbox-service', 'human_support_notification_outbox', 'ALWAYS', ['external transport when configured']),
  capability('push_notifications', 7, 'push-notification-service', 'tenant/user/device scoped push intents, subscriptions, and outbox', 'ALWAYS', ['PostgreSQL', 'Web Push transport when configured']),
  capability('knowledge_intelligence', 6, 'knowledge-intelligence-service', 'tenant-scoped Knowledge tables', 'ALWAYS', ['PostgreSQL', 'pgvector']),
  capability('source_processing', 6, 'knowledge-source-processing-service', 'knowledge_base_documents + knowledge_processing_jobs', 'ON_DEMAND', ['enabled source']),
  capability('business_identity', 6, 'business-identity-service', 'business_identities + source identity evidence', 'ON_DEMAND', ['eligible Knowledge source']),
  capability('business_profile', 6, 'knowledge-profile-lifecycle', 'business_profiles + versioned lifecycle', 'ON_DEMAND', ['resolved Business Identity', 'eligible source']),
  capability('knowledge_candidates', 6, 'knowledge-candidate-service', 'knowledge_candidates + evidence', 'ON_DEMAND', ['eligible Knowledge source']),
  capability('retrieval', 6, 'knowledge-runtime-context-service', 'ACTIVE approved tenant Knowledge authority', 'ON_DEMAND', ['active profile', 'active assistant configuration']),
  capability('guide', 7, 'guide-domain-service', 'enabled SAMCHEGUIDE integration + active domain', 'CHANNEL_ENABLED', ['tenant_channels', 'channel_integrations', 'guide_domains'], 'CHANNEL_ENABLEMENT'),
  capability('roadmap', 7, 'guide-conversation-service', 'durable Guide session roadmap state', 'CHANNEL_ENABLED', ['guide'], 'GUIDE_ENABLEMENT'),
  capability('planning', 7, 'guide-session-context-service', 'durable Guide planning context', 'CHANNEL_ENABLED', ['guide'], 'GUIDE_ENABLEMENT'),
  capability('guide_assistant', 7, 'samcheguide-runtime', 'scoped Guide conversation messages', 'CHANNEL_ENABLED', ['guide', 'active tenant runtime'], 'GUIDE_ENABLEMENT'),
  capability('guide_shared_context', 7, 'guide-session-context-service', 'server-scoped Guide session context', 'CHANNEL_ENABLED', ['guide_public_sessions'], 'GUIDE_ENABLEMENT'),
  capability('guide_persistence', 7, 'guide-conversation-service', 'guide_public_sessions + conversations + messages', 'CHANNEL_ENABLED', ['PostgreSQL'], 'GUIDE_ENABLEMENT'),
]);

export function validatePlatformCapabilityManifest(manifest = PLATFORM_CAPABILITY_MANIFEST) {
  if (!Array.isArray(manifest) || !manifest.length) throw new TypeError('PLATFORM_CAPABILITY_MANIFEST_INVALID');
  const keys = new Set();
  const required = [
    'key', 'introduced_by_task', 'canonical_owner_service', 'canonical_source_of_truth',
    'provisioning_ensure_function', 'existing_tenant_repair_path', 'golden_path_test',
    'entitlement_dependency', 'runtime_dependencies', 'enablement', 'canonical_creator',
    'historical_convergence_path', 'fresh_tenant_path',
  ];
  for (const item of manifest) {
    if (!item || required.some((field) => item[field] === undefined || item[field] === '')) throw new TypeError('PLATFORM_CAPABILITY_METADATA_INCOMPLETE');
    if (!/^[a-z][a-z0-9_]+$/.test(item.key) || keys.has(item.key)) throw new TypeError('PLATFORM_CAPABILITY_KEY_INVALID');
    if (!/^TASK_[1-7]$/.test(item.introduced_by_task)) throw new TypeError('PLATFORM_CAPABILITY_TASK_INVALID');
    if (!Array.isArray(item.runtime_dependencies)) throw new TypeError('PLATFORM_CAPABILITY_DEPENDENCIES_INVALID');
    if (!['ALWAYS', 'ON_DEMAND', 'CHANNEL_ENABLED'].includes(item.enablement)) throw new TypeError('PLATFORM_CAPABILITY_ENABLEMENT_INVALID');
    if (!['PLATFORM_ENSURE', 'DOMAIN_FLOW', 'CHANNEL_FLOW', 'RUNTIME_RESOLUTION'].includes(item.canonical_creator)) throw new TypeError('PLATFORM_CAPABILITY_CREATOR_INVALID');
    if (!['IDEMPOTENT_ENSURE', 'REPLAY_SAFE_MIGRATION', 'DOMAIN_OPERATION', 'RUNTIME_VALIDATION'].includes(item.historical_convergence_path)) throw new TypeError('PLATFORM_CAPABILITY_CONVERGENCE_INVALID');
    if (!['BASELINE_PROVISIONING', 'NORMAL_DOMAIN_FLOW', 'NORMAL_CHANNEL_FLOW'].includes(item.fresh_tenant_path)) throw new TypeError('PLATFORM_CAPABILITY_FRESH_PATH_INVALID');
    keys.add(item.key);
  }
  return true;
}

validatePlatformCapabilityManifest();
