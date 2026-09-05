export const PLATFORM_CAPABILITY_MANIFEST_VERSION = 1;

const GOLDEN_PATH = 'tests/fresh-tenant-golden-path.test.js';
const ENSURE = 'ensure_tenant_platform_capabilities';
const REPAIR = 'repairTenantPlatformCapabilities';

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
  });
}

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
    'entitlement_dependency', 'runtime_dependencies', 'enablement',
  ];
  for (const item of manifest) {
    if (!item || required.some((field) => item[field] === undefined || item[field] === '')) throw new TypeError('PLATFORM_CAPABILITY_METADATA_INCOMPLETE');
    if (!/^[a-z][a-z0-9_]+$/.test(item.key) || keys.has(item.key)) throw new TypeError('PLATFORM_CAPABILITY_KEY_INVALID');
    if (!/^TASK_[1-7]$/.test(item.introduced_by_task)) throw new TypeError('PLATFORM_CAPABILITY_TASK_INVALID');
    if (!Array.isArray(item.runtime_dependencies)) throw new TypeError('PLATFORM_CAPABILITY_DEPENDENCIES_INVALID');
    if (!['ALWAYS', 'ON_DEMAND', 'CHANNEL_ENABLED'].includes(item.enablement)) throw new TypeError('PLATFORM_CAPABILITY_ENABLEMENT_INVALID');
    keys.add(item.key);
  }
  return true;
}

validatePlatformCapabilityManifest();
