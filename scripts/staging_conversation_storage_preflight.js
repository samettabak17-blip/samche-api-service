import crypto from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  buildPutObjectInput,
  createConversationResourceStorage,
  createConversationStorageClient,
  getSafeStorageFailureDiagnostic,
  getSafeStorageProviderDiagnostic,
} from '../services/conversation-resource-storage.js';

const prefix = `conversation-resources-preflight/${crypto.randomUUID()}`;
const minimalKey = `${prefix}/minimal`;
const applicationKey = `${prefix}/application`;
const body = Buffer.from(`samche-storage-preflight:${crypto.randomUUID()}`, 'utf8');
const connection = createConversationStorageClient();
const storage = createConversationResourceStorage(process.env, connection);

async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function shapeSummary({ name, present, length, leadingOrTrailingWhitespace, containsCR, containsLF, containsTAB, containsControlCharacter }) {
  return `${name}{present=${present};length=${length};edge_ws=${leadingOrTrailingWhitespace};cr=${containsCR};lf=${containsLF};tab=${containsTAB};control=${containsControlCharacter}}`;
}

function safeDiagnosticFields(error, optionNames = []) {
  const diagnostic = getSafeStorageFailureDiagnostic(error, connection.getDiagnostics(optionNames));
  const provider = diagnostic.provider;
  const fields = [
    ['provider_name', provider.providerErrorName],
    ['provider_code', provider.providerErrorCode],
    ['provider_message', provider.providerMessage],
    ['argument_name', provider.argumentName],
    ['http_status', provider.httpStatus],
    ['request_id', provider.requestId],
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

async function phase(name, operation, optionNames = []) {
  try {
    await operation();
    console.log(`CONVERSATION_STORAGE_PREFLIGHT: ${name}: PASS`);
    return true;
  } catch (error) {
    console.error(`CONVERSATION_STORAGE_PREFLIGHT: ${name}: FAIL (${safeDiagnosticFields(error, optionNames) || 'provider_name=UNKNOWN'})`);
    return false;
  }
}

let minimalStored = false;
let applicationStored = false;
let failed = false;

try {
  const connected = await phase('CLIENT_CONNECTIVITY', () => storage.connectivity(prefix));
  if (!connected) {
    failed = true;
  } else {
    const minimalInput = buildPutObjectInput({ bucket: connection.bucket, key: minimalKey, body });
    minimalStored = await phase('MINIMAL_PUT', () => connection.client.send(new PutObjectCommand(minimalInput)), Object.keys(minimalInput).sort());
    if (!minimalStored) {
      failed = true;
      console.error('CONVERSATION_STORAGE_PREFLIGHT: APPLICATION_PUT: SKIPPED (MINIMAL_PUT_FAILED)');
    } else {
      const minimalHead = await phase('MINIMAL_HEAD', () => connection.client.send(new HeadObjectCommand({ Bucket: connection.bucket, Key: minimalKey })));
      const minimalGet = await phase('MINIMAL_GET', async () => {
        const response = await connection.client.send(new GetObjectCommand({ Bucket: connection.bucket, Key: minimalKey }));
        const actual = await read(response.Body);
        if (!actual.equals(body)) throw new Error('MINIMAL_GET_BODY_MISMATCH');
      });
      if (!minimalHead || !minimalGet) failed = true;

      applicationStored = await phase('APPLICATION_PUT', () => storage.put({ key: applicationKey, body, mimeType: 'text/plain' }), ['Body', 'Bucket', 'ContentType', 'Key']);
      if (!applicationStored) {
        failed = true;
      } else {
        const applicationHead = await phase('HEAD', () => storage.head({ key: applicationKey }));
        const applicationGet = await phase('GET', async () => {
          const actual = await read(await storage.get({ key: applicationKey }));
          if (!actual.equals(body)) throw new Error('GET_BODY_MISMATCH');
        });
        if (!applicationHead || !applicationGet) failed = true;
      }
    }
  }
} finally {
  if (applicationStored) {
    const deleted = await phase('DELETE', () => storage.remove({ key: applicationKey }));
    if (!deleted) failed = true;
  }
  if (minimalStored) {
    const deleted = await phase('MINIMAL_DELETE', () => connection.client.send(new DeleteObjectCommand({ Bucket: connection.bucket, Key: minimalKey })));
    if (!deleted) failed = true;
  }
}
if (failed) process.exitCode = 1;
