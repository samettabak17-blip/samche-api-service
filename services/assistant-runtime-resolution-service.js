export class AssistantRuntimeResolutionError extends Error {
  constructor(code, message = 'Assistant runtime is unavailable') {
    super(message);
    this.name = 'AssistantRuntimeResolutionError';
    this.code = code;
  }
}

function requiredId(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function validateChannelRuntimeScope(scope, { channelType = null } = {}) {
  if (!scope || scope.channel_status !== 'active' || scope.assistant_status !== 'active') {
    return { status: 'INTEGRATION_DISABLED' };
  }
  if (
    !requiredId(scope.tenant_id)
    || !requiredId(scope.assistant_id)
    || !requiredId(scope.channel_id)
    || scope.channel_assistant_id !== scope.assistant_id
    || (channelType && scope.channel_type !== channelType)
  ) {
    return { status: 'CHANNEL_TENANT_ASSISTANT_MISMATCH' };
  }
  return { status: 'HEALTHY' };
}

function assertHealthyScope(scope, options) {
  const health = validateChannelRuntimeScope(scope, options);
  if (health.status !== 'HEALTHY') throw new AssistantRuntimeResolutionError(health.status);
  return health;
}

function normalizeModel(providerRuntime) {
  const model = typeof providerRuntime?.model === 'string' ? providerRuntime.model.trim() : '';
  if (!model) throw new AssistantRuntimeResolutionError('RUNTIME_MODEL_UNAVAILABLE');
  return {
    provider: typeof providerRuntime?.provider === 'string' ? providerRuntime.provider : 'UNKNOWN',
    mode: typeof providerRuntime?.mode === 'string' ? providerRuntime.mode : 'unknown',
    model,
  };
}

export async function resolveChannelAssistantRuntime({
  database,
  embed,
  scope,
  query,
  channelType = null,
  resolvePersona,
  resolveKnowledge,
  resolveModel,
}) {
  assertHealthyScope(scope, { channelType });
  if (typeof resolvePersona !== 'function' || typeof resolveKnowledge !== 'function' || typeof resolveModel !== 'function') {
    throw new AssistantRuntimeResolutionError('RUNTIME_RESOLVER_CONFIGURATION_INVALID');
  }

  const persona = await resolvePersona({
    database,
    tenantId: scope.tenant_id,
    assistantId: scope.assistant_id,
  });
  if (!persona?.available) {
    throw new AssistantRuntimeResolutionError(channelType === 'SAMCHEGUIDE' ? 'GUIDE_RUNTIME_UNAVAILABLE' : 'ACTIVE_CONFIGURATION_UNAVAILABLE');
  }

  const knowledge = await resolveKnowledge({
    database,
    embed,
    tenantId: scope.tenant_id,
    assistantId: scope.assistant_id,
    query,
  });
  const configuration = knowledge?.activeConfiguration;
  if (!configuration?.id || configuration.id !== persona.configurationVersionId) {
    throw new AssistantRuntimeResolutionError('ACTIVE_CONFIGURATION_UNAVAILABLE');
  }
  if (!configuration.active_business_profile_version_id || configuration.active_business_profile_version_id !== persona.profileVersionId) {
    throw new AssistantRuntimeResolutionError('ACTIVE_PROFILE_UNAVAILABLE');
  }

  const providerRuntime = normalizeModel(resolveModel());
  const health = {
    status: 'HEALTHY',
    provider: providerRuntime.provider,
    mode: providerRuntime.mode,
    model: providerRuntime.model,
    activeProfileVersionId: persona.profileVersionId,
    activeConfigurationVersionId: persona.configurationVersionId,
    retrievalAvailable: knowledge?.retrievalAvailable === true,
  };
  return {
    scope,
    persona,
    knowledge,
    health,
    ...providerRuntime,
  };
}
