import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPutObjectInput,
  buildS3ClientConfig,
  describeSafeHttpRequest,
  describeStorageConfiguration,
  getSafeStorageFailureDiagnostic,
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

test('safe configuration and signed-request diagnostics reveal shapes but never values', () => {
  const config = describeStorageConfiguration({
    CONVERSATION_STORAGE_DRIVER: 's3',
    CONVERSATION_S3_BUCKET: 'private-bucket',
    CONVERSATION_S3_REGION: 'auto',
    CONVERSATION_S3_ACCESS_KEY_ID: 'key\n',
    CONVERSATION_S3_SECRET_ACCESS_KEY: 'secret\tvalue',
    CONVERSATION_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    CONVERSATION_S3_FORCE_PATH_STYLE: 'false',
  });
  const key = config.find((item) => item.name === 'CONVERSATION_S3_ACCESS_KEY_ID');
  const secret = config.find((item) => item.name === 'CONVERSATION_S3_SECRET_ACCESS_KEY');
  assert.deepEqual(key, {
    name: 'CONVERSATION_S3_ACCESS_KEY_ID',
    present: true,
    length: 4,
    leadingOrTrailingWhitespace: true,
    containsCR: false,
    containsLF: true,
    containsTAB: false,
    containsControlCharacter: false,
  });
  assert.equal(secret.containsTAB, true);
  const request = describeSafeHttpRequest({
    headers: { authorization: 'AWS4-HMAC\ninvalid', host: 'account.r2.cloudflarestorage.com' },
  }, 'PutObject');
  assert.equal(request.operation, 'PutObject');
  assert.equal(request.headers.find((header) => header.name === 'authorization').containsLF, true);
  assert.equal(JSON.stringify({ config, request }).includes('secret\tvalue'), false);
  assert.equal(JSON.stringify({ config, request }).includes('AWS4-HMAC'), false);
});

test('provider diagnostics include only bounded safe identifiers and preserve wrapper diagnostics', () => {
  const error = Object.assign(new Error('credential=never-log-this'), {
    name: 'TypeError',
    code: 'ERR_INVALID_CHAR',
    $metadata: {
      httpStatusCode: 400,
      requestId: 'r2-request-id_123',
    },
  });
  const expected = {
    providerErrorName: 'TypeError',
    providerErrorCode: 'ERR_INVALID_CHAR',
    httpStatus: 400,
    requestId: 'r2-request-id_123',
  };
  assert.deepEqual(getSafeStorageProviderDiagnostic(error), expected);
  assert.deepEqual(getSafeStorageProviderDiagnostic({ provider: expected }), expected);
  const failure = getSafeStorageFailureDiagnostic({
    provider: expected,
    diagnostics: { configuration: [], request: { operation: 'PutObject', headers: [] } },
  });
  assert.deepEqual(failure.provider, expected);
  assert.equal(failure.request.operation, 'PutObject');
  assert.equal(JSON.stringify(getSafeStorageProviderDiagnostic(error)).includes('never-log-this'), false);
});
