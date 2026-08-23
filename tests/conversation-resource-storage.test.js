import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPutObjectInput,
  buildS3ClientConfig,
  getSafeStorageProviderDiagnostic,
} from '../services/conversation-resource-storage.js';

test('R2 PutObject input omits optional SSE and checksum headers while retaining content metadata', () => {
  const input = buildPutObjectInput({
    bucket: 'staging-private-bucket',
    key: 'conversation-resources/tenant/conversation/resource',
    body: Buffer.from('safe'),
    mimeType: 'text/plain',
  });
  assert.deepEqual(input, {
    Bucket: 'staging-private-bucket',
    Key: 'conversation-resources/tenant/conversation/resource',
    Body: Buffer.from('safe'),
    ContentType: 'text/plain',
  });
  assert.equal(Object.hasOwn(input, 'ServerSideEncryption'), false);
  assert.equal(Object.hasOwn(input, 'ChecksumSHA256'), false);
});

test('R2 client configuration retains only protocol-required SDK checksum behavior', () => {
  const config = buildS3ClientConfig({
    region: 'auto',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    forcePathStyle: false,
  });
  assert.equal(config.region, 'auto');
  assert.equal(config.forcePathStyle, false);
  assert.equal(config.requestChecksumCalculation, 'WHEN_REQUIRED');
  assert.equal(config.responseChecksumValidation, 'WHEN_REQUIRED');
});

test('provider diagnostics include only bounded safe identifiers and preserve wrapped diagnostics', () => {
  const error = Object.assign(new Error('credential=never-log-this'), {
    name: 'NotImplemented',
    Code: 'NotImplemented',
    $metadata: {
      httpStatusCode: 501,
      requestId: 'r2-request-id_123',
    },
  });
  const expected = {
    providerErrorName: 'NotImplemented',
    providerErrorCode: 'NotImplemented',
    httpStatus: 501,
    requestId: 'r2-request-id_123',
  };
  assert.deepEqual(getSafeStorageProviderDiagnostic(error), expected);
  assert.deepEqual(getSafeStorageProviderDiagnostic({ provider: expected }), expected);
  assert.equal(JSON.stringify(getSafeStorageProviderDiagnostic(error)).includes('never-log-this'), false);
});
