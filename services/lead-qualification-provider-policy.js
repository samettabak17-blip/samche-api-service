const DEFAULT_LEAD_QUALIFICATION_TIMEOUT_MS = 30_000;
const DEFAULT_LEAD_QUALIFICATION_MAX_OUTPUT_TOKENS = 512;
const DEFAULT_LEAD_QUALIFICATION_THINKING_LEVEL = 'low';

export function getLeadQualificationProviderPolicy(env = process.env) {
  const configuredTimeout = Number(env.LEAD_QUALIFICATION_TIMEOUT_MS ?? DEFAULT_LEAD_QUALIFICATION_TIMEOUT_MS);
  const timeoutMs = Number.isInteger(configuredTimeout) && configuredTimeout >= 5_000 && configuredTimeout <= 60_000
    ? configuredTimeout
    : DEFAULT_LEAD_QUALIFICATION_TIMEOUT_MS;
  return Object.freeze({
    model: String(env.LEAD_QUALIFICATION_MODEL || 'gemini-3-flash-preview').trim(),
    timeoutMs,
    maxOutputTokens: DEFAULT_LEAD_QUALIFICATION_MAX_OUTPUT_TOKENS,
    thinkingLevel: DEFAULT_LEAD_QUALIFICATION_THINKING_LEVEL,
    // Deferred qualification is non-critical. One bounded attempt avoids retrying
    // deterministic provider/schema failures and never delays a WhatsApp reply.
    maxAttempts: 1,
  });
}
