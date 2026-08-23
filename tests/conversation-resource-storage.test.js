import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPutObjectInput,
  getSafeStorageProviderDiagnostic,
} from '../services/conversation-resource-storage.js';

test('R2 PutObject input omits unsupported SSE headers while retaining content metadata and checksum', () => {
  const input = buildPutObjectInput({
    bucket: 'staging-private-bucket',
    key: 'conversation-resources/tenant/conversation/resource',
    body: Buffer.from('safe'),
    mimeType: 'text/plain',
    checksum: 'checksum',
  });
  assert.deepEqual(input, {
    Bucket: 'staging-private-bucket',
    Key: 'conversation-resources/tenant/conversation/resource',
    Body: Buffer.from('safe'),
    ContentType: 'text/plain',
    ChecksumSHA256: 'checksum',
  });
  assert.equal(Object.hasOwn(input, 'ServerSideEncryption'), false);
});

test('provider diagnostics include only bounded safe identifiers and never the provider message', () => {
  const error = Object.assign(new Error('credential=never-log-this'), {
    name: 'NotImplemented',
    Code: 'NotImplemented',
    $metadata: {
      httpStatusCode: 501,
      requestId: 'r2-request-id_123',
    },
  });
  const diagnostic = getSafeStorageProviderDiagnostic(error);
  assert.deepEqual(diagnostic, {
    providerErrorName: 'NotImplemented',
    providerErrorCode: 'NotImplemented',
    httpStatus: 501,
    requestId: 'r2-request-id_123',
  });
  assert.equal(JSON.stringify(diagnostic).includes('never-log-this'), false);
});
