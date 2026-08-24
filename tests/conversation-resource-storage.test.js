import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPutObjectInput,
  buildS3ClientConfig,
  describeSafeHttpRequest,
  describeStorageAddressing,
  describeStorageCompatibilityProfile,
  describeStorageConfiguration,
  describeStorageConfigurationIdentity,
  getSafeStorageFailureDiagnostic,
  getSafeStorageProviderDiagnostic,
} from '../services/conversation-resource-storage.js';

test('minimal R2 PutObject input has exactly bucket key and body, while adapter adds only ContentType', () => {
  const base = { bucket: 'staging-private-bucket', key: 'conversation-resources/tenant/conversation/resource', body: Buffer.from('safe') };
  const minimal = buildPutObjectInput(base);
  const application = buildPutObjectInput({ ...base, mimeType: 'text/plain' });
  assert.deepEqual(Object.keys(minimal).sort(), ['Body', 'Bucket', 'Key']);
  assert.deepEqual(Object.keys(application).sort(), ['Body', 'Bucket', 'ContentType', 'Key']);
  assert.equal(Object.hasOwn(application, 'ServerSideEncryption'), false);
  assert.equal(Object.hasOwn(application, 'ChecksumSHA256'), false);
});

test('R2 client configuration retains auto region, selected addressing, and required-only checksum behavior', () => {
  const config = buildS3ClientConfig({
    region: 'auto',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    forcePathStyle: true,
  });
  assert.equal(config.region, 'auto');
  assert.equal(config.forcePathStyle, true);
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
  assert.deepEqual(describeStorageAddressing(environment), {
    endpoint: { isHttps: 1, hasHost: 1, hasPathOrQuery: 0 },
    bucketVirtualHostCompatible: 1,
    regionIsAuto: 1,
    forcePathStyle: 0,
  });
  assert.deepEqual(describeStorageAddressing(environment, true).forcePathStyle, 1);
  const request = describeSafeHttpRequest({
    headers: { authorization: 'AWS4-HMAC\ninvalid', host: 'account.r2.cloudflarestorage.com' },
  }, 'HeadBucketCommand');
  assert.equal(request.operation, 'HeadBucketCommand');
  assert.equal(request.headers.find((header) => header.name === 'authorization').containsLF, 1);
  assert.equal(JSON.stringify({ config, request }).includes('secret\tvalue'), false);
  assert.equal(JSON.stringify({ config, request }).includes('AWS4-HMAC'), false);
});

test('provider diagnostics preserve safe XML-style error fields and exclude unsafe argument values', () => {
  const error = Object.assign(new Error('Invalid argument'), {
    name: 'InvalidArgument',
    code: 'InvalidArgument',
    Code: 'InvalidArgument',
    Message: 'Invalid argument',
    ArgumentName: 'max-keys',
    ArgumentValue: 'not-reported',
    $fault: 'client',
    $metadata: {
      httpStatusCode: 400,
      requestId: 'r2-request-id_123',
      extendedRequestId: 'r2-extended-id_456',
    },
  });
  const expected = {
    providerErrorName: 'InvalidArgument',
    providerErrorCode: 'InvalidArgument',
    providerMessage: 'Invalid argument',
    argumentName: 'max-keys',
    httpStatus: 400,
    requestId: 'r2-request-id_123',
    extendedRequestId: 'r2-extended-id_456',
    fault: 'client',
  };
  assert.deepEqual(getSafeStorageProviderDiagnostic(error), expected);
  const fallback = { configuration: [], addressing: null, request: { operation: 'ListObjectsV2Command', headers: [] }, putObjectOptionNames: [] };
  assert.deepEqual(getSafeStorageFailureDiagnostic(error, fallback).provider, expected);
  assert.equal(JSON.stringify(getSafeStorageProviderDiagnostic(error)).includes('not-reported'), false);
});
test('storage identity and R2 profile reveal only opaque configuration state', () => {
  const identity = describeStorageConfigurationIdentity({
    CONVERSATION_STORAGE_DRIVER: 's3',
    CONVERSATION_S3_BUCKET: 'staging-private-bucket',
    CONVERSATION_S3_REGION: 'auto',
    CONVERSATION_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    CONVERSATION_S3_FORCE_PATH_STYLE: 'false',
    CONVERSATION_S3_ACCESS_KEY_ID: 'access-key-material',
  });

  assert.deepEqual(describeStorageCompatibilityProfile(), {
    serverSideEncryption: 0,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  assert.equal(identity.driver, 's3');
  assert.match(identity.configurationFingerprint, /^[a-f0-9]{16}$/);
  assert.match(identity.accessKeyIdFingerprint, /^[a-f0-9]{16}$/);
  assert.equal(JSON.stringify(identity).includes('staging-private-bucket'), false);
  assert.equal(JSON.stringify(identity).includes('access-key-material'), false);
});
