import { HeadBucketCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { Transform } from 'node:stream';
import {
  buildS3ClientConfig,
  describeSafeHttpRequest,
  describeStorageAddressing,
  describeStorageConfiguration,
} from '../services/conversation-resource-storage.js';

const LIMIT = 4096;

function safeToken(value, maxLength = 128) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, maxLength);
  return normalized || null;
}

function safeMessage(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 240) return null;
  if (!/^[A-Za-z0-9 .,:;()\[\]{}_'/-]+$/.test(normalized)) return null;
  if (/(authorization|credential|signature|secret|token|access[ _-]?key|https?:|x-amz|endpoint)/i.test(normalized)) return null;
  return normalized;
}

function xmlField(text, name, sanitizer) {
  const match = new RegExp(`<${name}>([\\s\\S]{0,512}?)</${name}>`, 'i').exec(text);
  return match ? sanitizer(match[1]) : null;
}

function safeError(error, responseText = '') {
  const metadata = error?.$metadata ?? {};
  return {
    providerName: safeToken(error?.name),
    providerCode: safeToken(error?.Code ?? error?.code),
    providerMessage: safeMessage(error?.Message ?? error?.message) ?? xmlField(responseText, 'Message', safeMessage),
    argumentName: safeToken(error?.ArgumentName ?? error?.argumentName) ?? xmlField(responseText, 'ArgumentName', safeToken),
    httpStatus: Number.isInteger(metadata.httpStatusCode) ? metadata.httpStatusCode : null,
    requestId: safeToken(metadata.requestId) ?? xmlField(responseText, 'RequestId', safeToken),
    extendedRequestId: safeToken(metadata.extendedRequestId ?? metadata.cfId),
    fault: safeToken(error?.$fault),
  };
}

function shapeSummary({ name, present, length, leadingOrTrailingWhitespace, containsCR, containsLF, containsTAB, containsControlCharacter }) {
  return `${name}{present=${present};length=${length};edge_ws=${leadingOrTrailingWhitespace};cr=${containsCR};lf=${containsLF};tab=${containsTAB};control=${containsControlCharacter}}`;
}

function fields(error, connection, responseText) {
  const provider = safeError(error, responseText);
  const request = connection.request;
  const values = [
    ['provider_name', provider.providerName],
    ['provider_code', provider.providerCode],
    ['provider_message', provider.providerMessage],
    ['argument_name', provider.argumentName],
    ['http_status', provider.httpStatus],
    ['request_id', provider.requestId],
    ['extended_request_id', provider.extendedRequestId],
    ['fault', provider.fault],
    ['sdk_operation', request?.operation],
  ].filter(([, value]) => value !== null && value !== undefined)
    .map(([name, value]) => `${name}=${value}`);

  values.push(`config_shape=${connection.configuration.map(shapeSummary).join(',')}`);
  const { endpoint, bucketVirtualHostCompatible, regionIsAuto, forcePathStyle } = connection.addressing;
  values.push(`addressing={endpoint_https=${endpoint.isHttps};endpoint_host=${endpoint.hasHost};endpoint_path_or_query=${endpoint.hasPathOrQuery};bucket_virtual_host_compatible=${bucketVirtualHostCompatible};region_auto=${regionIsAuto};force_path_style=${forcePathStyle}}`);
  if (request?.headers?.length) {
    values.push(`request_header_shape=${request.headers.map(shapeSummary).join(',')}`);
  }
  return values.join('; ');
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function createProbe(forcePathStyle) {
  const bucket = required('CONVERSATION_S3_BUCKET');
  const configuration = describeStorageConfiguration(process.env);
  const addressing = describeStorageAddressing(process.env, forcePathStyle);
  let request = null;
  const client = new S3Client(buildS3ClientConfig({
    region: required('CONVERSATION_S3_REGION'),
    endpoint: required('CONVERSATION_S3_ENDPOINT'),
    accessKeyId: required('CONVERSATION_S3_ACCESS_KEY_ID'),
    secretAccessKey: required('CONVERSATION_S3_SECRET_ACCESS_KEY'),
    forcePathStyle,
  }));

  client.middlewareStack.addRelativeTo(
    (next, context) => async (args) => {
      request = describeSafeHttpRequest(args.request, context.commandName);
      return next(args);
    },
    {
      relation: 'after',
      toMiddleware: 'awsAuthMiddleware',
      name: 'captureSafeR2AuthProbeRequest',
      step: 'finalizeRequest',
    }
  );

  client.middlewareStack.add(
    (next) => async (args) => {
      let captured = '';
      const response = args.response;
      if (response?.body && typeof response.body.pipe === 'function') {
        const tap = new Transform({
          transform(chunk, encoding, callback) {
            if (captured.length < LIMIT) {
              captured += Buffer.from(chunk).subarray(0, LIMIT - captured.length).toString('utf8');
            }
            callback(null, chunk);
          },
        });
        response.body = response.body.pipe(tap);
      }
      try {
        return await next(args);
      } catch (error) {
        error.__samcheSafeR2Xml = captured;
        throw error;
      }
    },
    { step: 'deserialize', priority: 'high', name: 'captureSafeR2AuthProbeErrorXml' }
  );

  return {
    client,
    bucket,
    configuration,
    addressing,
    get request() {
      return request;
    },
  };
}

async function phase(name, connection, operation) {
  try {
    await operation();
    console.log(`CONVERSATION_STORAGE_AUTH_PROBE: ${name}: PASS`);
    return true;
  } catch (error) {
    console.error(`CONVERSATION_STORAGE_AUTH_PROBE: ${name}: FAIL (${fields(error, connection, error.__samcheSafeR2Xml)})`);
    return false;
  }
}

async function run(label, forcePathStyle) {
  const connection = createProbe(forcePathStyle);
  const headBucket = await phase(`${label}_HEAD_BUCKET`, connection, () => connection.client.send(new HeadBucketCommand({ Bucket: connection.bucket })));
  const listObjects = await phase(`${label}_LIST_OBJECTS`, connection, () => connection.client.send(new ListObjectsV2Command({ Bucket: connection.bucket, MaxKeys: 1 })));
  return { headBucket, listObjects };
}

console.log('CONVERSATION_STORAGE_AUTH_PROBE: START');
await run('VIRTUAL_HOST', false);
await run('PATH_STYLE', true);
