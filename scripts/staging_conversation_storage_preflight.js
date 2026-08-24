import crypto from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  buildPutObjectInput,
  createConversationResourceStorage,
  createConversationStorageClient,
  getSafeStorageFailureDiagnostic,
  describeStorageCompatibilityProfile,
  describeStorageConfigurationIdentity,
} from '../services/conversation-resource-storage.js';

const prefix = `conversation-resources-preflight/${crypto.randomUUID()}`;
const minimalKey = `${prefix}/minimal`;
const applicationKey = `${prefix}/application`;
const body = Buffer.from(`samche-storage-preflight:${crypto.randomUUID()}`, 'utf8');

const configuredConnection = createConversationStorageClient();
const virtualHostConnection = createConversationStorageClient(process.env, { forcePathStyle: false });
const pathStyleConnection = createConversationStorageClient(process.env, { forcePathStyle: true });
const storage = createConversationResourceStorage(process.env, configuredConnection);

async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function shapeSummary({ name, present, length, leadingOrTrailingWhitespace, containsCR, containsLF, containsTAB, containsControlCharacter }) {
  return `${name}{present=${present};length=${length};edge_ws=${leadingOrTrailingWhitespace};cr=${containsCR};lf=${containsLF};tab=${containsTAB};control=${containsControlCharacter}}`;
}

function safeDiagnosticFields(error, connection, optionNames = []) {
  const diagnostic = getSafeStorageFailureDiagnostic(error, connection.getDiagnostics(optionNames));
  const provider = diagnostic.provider;
  const fields = [
    ['provider_name', provider.providerErrorName],
    ['provider_code', provider.providerErrorCode],
    ['provider_message', provider.providerMessage],
    ['argument_name', provider.argumentName],
    ['http_status', provider.httpStatus],
    ['request_id', provider.requestId],
    ['extended_request_id', provider.extendedRequestId],
    ['fault', provider.fault],
    ['sdk_operation', diagnostic.request?.operation],
  ].filter(([, value]) => value !== null && value !== undefined)
    .map(([name, value]) => `${name}=${value}`);

  if (diagnostic.configuration.length) {
    fields.push(`config_shape=${diagnostic.configuration.map(shapeSummary).join(',')}`);
  }
  if (diagnostic.addressing) {
    const { endpoint, bucketVirtualHostCompatible, regionIsAuto, forcePathStyle } = diagnostic.addressing;
    fields.push(`addressing={endpoint_https=${endpoint.isHttps};endpoint_host=${endpoint.hasHost};endpoint_path_or_query=${endpoint.hasPathOrQuery};bucket_virtual_host_compatible=${bucketVirtualHostCompatible};region_auto=${regionIsAuto};force_path_style=${forcePathStyle}}`);
  }
  if (diagnostic.putObjectOptionNames.length) {
    fields.push(`put_object_options=${diagnostic.putObjectOptionNames.join(',')}`);
  }
  if (diagnostic.request?.headers?.length) {
    fields.push(`request_header_shape=${diagnostic.request.headers.map(shapeSummary).join(',')}`);
  }
  return fields.join('; ');
}

async function phase(name, connection, operation, optionNames = []) {
  try {
    await operation();
    console.log(`CONVERSATION_STORAGE_PREFLIGHT: ${name}: PASS`);
    return true;
  } catch (error) {
    console.error(`CONVERSATION_STORAGE_PREFLIGHT: ${name}: FAIL (${safeDiagnosticFields(error, connection, optionNames) || 'provider_name=UNKNOWN'})`);
    return false;
  }
}

async function runAuthenticationProbes(label, connection) {
  const headBucket = await phase(
    `AUTH_${label}_HEAD_BUCKET`,
    connection,
    () => connection.client.send(new HeadBucketCommand({ Bucket: connection.bucket }))
  );
  const listObjects = await phase(
    `AUTH_${label}_LIST_OBJECTS`,
    connection,
    () => connection.client.send(new ListObjectsV2Command({ Bucket: connection.bucket, MaxKeys: 1 }))
  );
  return { headBucket, listObjects };
}

let minimalStored = false;
let applicationStored = false;
let failed = false;

try {
  const storageIdentity = describeStorageConfigurationIdentity(process.env);
  console.log(`CONVERSATION_STORAGE_PREFLIGHT: RUNTIME_STORAGE driver=${storageIdentity.driver}; config_fingerprint=${storageIdentity.configurationFingerprint}; access_key_id_fingerprint=${storageIdentity.accessKeyIdFingerprint ?? 'missing'}`);
  console.log(`CONVERSATION_STORAGE_PREFLIGHT: R2_COMPATIBILITY server_side_encryption=${describeStorageCompatibilityProfile().serverSideEncryption}; request_checksum=${describeStorageCompatibilityProfile().requestChecksumCalculation}; response_checksum=${describeStorageCompatibilityProfile().responseChecksumValidation}`);
  console.log(`CONVERSATION_STORAGE_PREFLIGHT: AUTH_CONFIGURED_MODE: force_path_style=${configuredConnection.addressing.forcePathStyle}`);

  const virtualHost = await runAuthenticationProbes('VIRTUAL_HOST', virtualHostConnection);
  const pathStyle = await runAuthenticationProbes('PATH_STYLE', pathStyleConnection);
  const configuredAuthentication = configuredConnection.addressing.forcePathStyle ? pathStyle : virtualHost;

  if (!configuredAuthentication.headBucket && !configuredAuthentication.listObjects) {
    failed = true;
    console.error('CONVERSATION_STORAGE_PREFLIGHT: MINIMAL_PUT: SKIPPED (CONFIGURED_AUTHENTICATION_FAILED)');
    console.error('CONVERSATION_STORAGE_PREFLIGHT: APPLICATION_PUT: SKIPPED (CONFIGURED_AUTHENTICATION_FAILED)');
  } else {
    const minimalInput = buildPutObjectInput({ bucket: configuredConnection.bucket, key: minimalKey, body });
    minimalStored = await phase(
      'MINIMAL_PUT',
      configuredConnection,
      () => configuredConnection.client.send(new PutObjectCommand(minimalInput)),
      Object.keys(minimalInput).sort()
    );
    if (!minimalStored) {
      failed = true;
      console.error('CONVERSATION_STORAGE_PREFLIGHT: APPLICATION_PUT: SKIPPED (MINIMAL_PUT_FAILED)');
    } else {
      const minimalHead = await phase(
        'MINIMAL_HEAD',
        configuredConnection,
        () => configuredConnection.client.send(new HeadObjectCommand({ Bucket: configuredConnection.bucket, Key: minimalKey }))
      );
      const minimalGet = await phase('MINIMAL_GET', configuredConnection, async () => {
        const response = await configuredConnection.client.send(new GetObjectCommand({ Bucket: configuredConnection.bucket, Key: minimalKey }));
        const actual = await read(response.Body);
        if (!actual.equals(body)) throw new Error('MINIMAL_GET_BODY_MISMATCH');
      });
      if (!minimalHead || !minimalGet) failed = true;

      applicationStored = await phase(
        'APPLICATION_PUT',
        configuredConnection,
        () => storage.put({ key: applicationKey, body, mimeType: 'text/plain' }),
        ['Body', 'Bucket', 'ContentType', 'Key']
      );
      if (!applicationStored) {
        failed = true;
      } else {
        const applicationHead = await phase('HEAD', configuredConnection, () => storage.head({ key: applicationKey }));
        const applicationGet = await phase('GET', configuredConnection, async () => {
          const actual = await read(await storage.get({ key: applicationKey }));
          if (!actual.equals(body)) throw new Error('GET_BODY_MISMATCH');
        });
        if (!applicationHead || !applicationGet) failed = true;
      }
    }
  }
} finally {
  if (applicationStored) {
    const deleted = await phase('DELETE', configuredConnection, () => storage.remove({ key: applicationKey }));
    if (!deleted) failed = true;
  }
  if (minimalStored) {
    const deleted = await phase(
      'MINIMAL_DELETE',
      configuredConnection,
      () => configuredConnection.client.send(new DeleteObjectCommand({ Bucket: configuredConnection.bucket, Key: minimalKey }))
    );
    if (!deleted) failed = true;
  }
}

if (failed) process.exitCode = 1;