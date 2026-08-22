export const SAMCHEGUIDE_RUNTIME = Object.freeze({
  name: 'Samcheguide Runtime',
  provider: 'GEMINI',
  model: 'gemini-3-flash-preview',
});

export function isCompatibleSamcheguideRuntimeAssistant(assistant) {
  return assistant?.status === 'active' && assistant?.model === SAMCHEGUIDE_RUNTIME.model;
}
