import test from 'node:test';
import assert from 'node:assert/strict';
import { formatVisualAiWorkerStartup } from '../services/visual-ai-runtime-observability-service.js';

test('formats visual worker startup without secrets or tenant data', () => {
  const line = formatVisualAiWorkerStartup({
    enabled: true,
    provider: { getProviderIdentity: () => ({ provider: 'MOCK', model: 'mock-visual-v1' }), getCapabilities: () => ({ imageConditionedGeneration: true, referenceImages: true }) },
  });
  assert.equal(line, 'VISUAL_AI_WORKER_RUNTIME enabled=1 started=1 provider=MOCK model=mock-visual-v1 image_conditioned=1 reference_images=1');
  assert.doesNotMatch(line, /token|secret|password|tenant/i);
});

test('formats disabled visual worker without selecting a provider', () => {
  assert.equal(formatVisualAiWorkerStartup({ enabled: false }), 'VISUAL_AI_WORKER_RUNTIME enabled=0 started=0 provider=UNSELECTED model=NONE image_conditioned=0 reference_images=0');
});
