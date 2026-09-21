export function formatVisualAiWorkerStartup({ enabled, provider = null }) {
  if (!enabled) return 'VISUAL_AI_WORKER_RUNTIME enabled=0 started=0 provider=UNSELECTED model=NONE image_conditioned=0 reference_images=0';
  const identity = provider?.getProviderIdentity?.() || {};
  const capabilities = provider?.getCapabilities?.() || {};
  const providerName = String(identity.provider || provider?.provider || 'UNAVAILABLE').replace(/[^A-Z0-9_-]/gi, '').slice(0, 64) || 'UNAVAILABLE';
  const model = String(identity.model || provider?.model || 'NONE').replace(/[^A-Z0-9._-]/gi, '').slice(0, 128) || 'NONE';
  return `VISUAL_AI_WORKER_RUNTIME enabled=1 started=1 provider=${providerName} model=${model} image_conditioned=${capabilities.imageConditionedGeneration ? 1 : 0} reference_images=${capabilities.referenceImages ? 1 : 0}`;
}
