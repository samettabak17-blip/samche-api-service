export class AssistantModelAccessError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function assertAssistantModelWriteAllowed({ systemRole, payload }) {
  if (systemRole === 'CUSTOMER' && Object.prototype.hasOwnProperty.call(payload ?? {}, 'model')) {
    throw new AssistantModelAccessError('ASSISTANT_MODEL_CUSTOMER_FORBIDDEN', 'Assistant model selection is managed by the SamChe platform');
  }
}

export function serializeAssistantForActor(assistant, systemRole) {
  if (systemRole !== 'CUSTOMER') return assistant;
  const { model: _model, provider: _provider, ...customerSafeAssistant } = assistant;
  return customerSafeAssistant;
}
