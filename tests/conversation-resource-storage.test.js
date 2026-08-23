import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPutObjectInput,
  buildS3ClientConfig,
  describeSafeHttpRequest,
  describeStorageAddressing,
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

test('safe configuration and signed-request diagnostics reveal 0/1 shapes but never values', () => {
  const environment = {
    CONVERSATION_STORAGE_DRIVER: 's3',
    CONVERSATION_S3_BUCKET: 'private-bucket',
    CONVERSATION_S3_REGION: 'auto',
    CONVERSATION_S3_ACCESS_KEY_ID: 'key\n',
    CONVERSATION_S3_SECRET_ACCESS_KEY: 'secret\tvalue',
    CONVERSATION_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    CONVERSATION_S3_FORCE_PATH_STYLE: 'false',
  };
  const config = describeStorageConfiguration(environment);
  const key = config.find((item) => item.name === 'CONVERSATION_S3_ACCESS_KEY_ID');
  const secret = config.find((item) => item.name === 'CONVERSATION_S3_SECRET_ACCESS_KEY');
  assert.deepEqual(key, {
    name: 'CONVERSATION_S3_ACCESS_KEY_ID',
    present: 1,
    length: 4,
    leadingOrTrailingWhitespace: 1,
    containsCR: 0,
    containsLF: 1,
    containsTAB: 0,
    containsControlCharacter: 0,
  });
  assert.equal(secret.containsTAB, 1);
  assert.deepEqual(describeStorageAddressing(environment), {
    endpoint: { isHttps: 1, hasHost: 1, hasPathOrQuery: 0 },
    bucketVirtualHostCompatible: 1,
    regionIsAuto: 1,
    forcePathStyle: 0,
  });
  const request = describeSafeHttpRequest({
    headers: { authorization: 'AWS4-HMAC\ninvalid', host: 'account.r2.cloudflarestorage.com' },
  }, 'PutObjectCommand');
  assert.equal(request.operation, 'PutObjectCommand');
  assert.equal(request.headers.find((header) => header.name === 'authorization').containsLF, 1);
  assert.equal(JSON.stringify({ config, request }).includes('secret\tvalue'), false);
  assert.equal(JSON.stringify({ config, request }).includes('AWS4-HMAC'), false);
});

test('provider diagnostics preserve only a safe R2 error message', () => {
  const error = Object.assign(new Error('Invalid argument'), {
    name: 'InvalidArgument',
    code: 'InvalidArgument',
    $metadata: { httpStatusCode: 400, requestId: 'r2-request-id_123' },
  });
  const expected = {
    providerErrorName: 'InvalidArgument',
    providerErrorCode: 'InvalidArgument',
    providerMessage: 'Invalid argument',
    httpStatus: 400,
    requestId: 'r2-request-id_123',
  };
  assert.deepEqual(getSafeStorageProviderDiagnostic(error), expected);
  assert.deepEqual(getSafeStorageProviderDiagnostic({ provider: expected }), expected);
  const failure = getSafeStorageFailureDiagnostic({
    provider: expected,
    diagnostics: {
      configuration: [],
      addressing: null,
      request: { operation: 'PutObjectCommand', headers: [] },
      putObjectOptionNames: ['Body', 'Bucket', 'ContentType', 'Key'],
    },
  });
  assert.deepEqual(failure.provider, expected);
  assert.deepEqual(failure.putObjectOptionNames, ['Body', 'Bucket', 'ContentType', 'Key']);
});
