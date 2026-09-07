import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { observeKnowledgeSourceBusinessIdentityRequest } from '../services/knowledge-source-business-identity-observability.js';

function response(statusCode) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  return res;
}

test('records only safe HTTP outcome stages for the explicit assignment endpoint', () => {
  const events = [];
  const res = response(403);
  let continued = false;
  observeKnowledgeSourceBusinessIdentityRequest(
    { method: 'PUT', path: '/tenant/knowledge-intelligence/sources/source/business-identity' },
    res,
    () => { continued = true; },
    (event) => events.push(event),
  );
  res.emit('finish');

  assert.equal(continued, true);
  assert.deepEqual(events, [{ stage: 'TENANT_AUTHORIZATION_FAILED', http_status: 403 }]);
});
