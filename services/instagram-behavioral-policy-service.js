const DEFAULT_MAX_POLICY_LENGTH = 64_000;

export function resolveInstagramBehavioralPolicy({ persona, maxLength = DEFAULT_MAX_POLICY_LENGTH } = {}) {
  const configuredPolicy = persona?.configuration?.channel_adaptations?.instagram?.behavioral_prompt;
  if (typeof configuredPolicy !== 'string') {
    return { policy: '', configured: false };
  }

  if (!configuredPolicy.trim() || configuredPolicy.length > maxLength) {
    return { policy: '', configured: false };
  }

  return { policy: configuredPolicy, configured: true };
}
