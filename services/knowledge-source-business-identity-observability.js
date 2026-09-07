const ASSIGNMENT_PATH = /^\/[^/]+\/knowledge-intelligence\/sources\/[^/]+\/business-identity$/;

function defaultDiagnostic(event) {
  console.info('KNOWLEDGE_SOURCE_IDENTITY_ASSIGNMENT_HTTP', JSON.stringify(event));
}

function outcomeStage(statusCode) {
  if (statusCode === 401) return 'AUTHENTICATION_FAILED';
  if (statusCode === 403) return 'TENANT_AUTHORIZATION_FAILED';
  if (statusCode >= 400 && statusCode < 500) return 'REQUEST_VALIDATION_FAILED';
  return statusCode >= 500 ? 'REQUEST_FAILED' : 'HTTP_SUCCESS';
}

export function observeKnowledgeSourceBusinessIdentityRequest(req, res, next, emit = defaultDiagnostic) {
  if (req.method !== 'PUT' || !ASSIGNMENT_PATH.test(String(req.path ?? ''))) return next();
  res.once('finish', () => emit({
    stage: outcomeStage(res.statusCode),
    http_status: res.statusCode,
  }));
  return next();
}
