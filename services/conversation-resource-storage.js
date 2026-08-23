import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const CONFIGURATION_FIELDS = [
  'CONVERSATION_STORAGE_DRIVER',
  'CONVERSATION_S3_BUCKET',
  'CONVERSATION_S3_REGION',
  'CONVERSATION_S3_ACCESS_KEY_ID',
  'CONVERSATION_S3_SECRET_ACCESS_KEY',
  'CONVERSATION_S3_ENDPOINT',
  'CONVERSATION_S3_FORCE_PATH_STYLE',
];

function bool(value) {
  return value ? 1 : 0;
}

function safeToken(value, maxLength = 128) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, maxLength);
  return normalized || null;
}

function stringShape(value) {
  const text = typeof value === 'string' ? value : '';
  return {
    present: bool(typeof value === 'string' && text.length > 0),
    length: text.length,
    leadingOrTrailingWhitespace: bool(/^\s|\s$/.test(text)),
    containsCR: bool(text.includes('\r')),
    containsLF: bool(text.includes('\n')),
    containsTAB: bool(text.includes('\t')),
    containsControlCharacter: bool(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)),
  };
}

function safeDiagnostic(value = {}) {
  const status = Number(value.httpStatus);
  return {
    providerErrorName: safeToken(value.providerErrorName),
    providerErrorCode: safeToken(value.providerErrorCode),
    providerMessage: safeProviderMessage(value.providerMessage),
    httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    requestId: safeToken(value.requestId),
  };
}

function safeProviderMessage(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 240) return null;
  if (!/^[A-Za-z0-9 .,:;()\[\]{}_'/-]+$/.test(normalized)) return null;
  if (/(authorization|credential|signature|secret|token|access[ _-]?key|https?:|x-amz|endpoint)/i.test(normalized)) return null;
  return normalized;
}

function describeEndpoint(value) {
  if (typeof value !== 'string') return { isHttps: 0, hasHost: 0, hasPathOrQuery: 0 };
  try {
    const url = new URL(value);
    return {
      isHttps: bool(url.protocol === 'https:'),
      hasHost: bool(Boolean(url.hostname)),
      hasPathOrQuery: bool(url.pathname !== '/' || Boolean(url.search) || Boolean(url.hash)),
    };
  } catch {
    return { isHttps: 0, hasHost: 0, hasPathOrQuery: 0 };
  }
}

function isVirtualHostCompatibleBucket(value) {
  return typeof value === 'string'
    && /^(?=.{3,63}$)(?!-)(?!.*\.\.)(?!.*\.$)[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value);
}

export function describeStorageConfiguration(env = process.env) {
  return CONFIGURATION_FIELDS.map((name) => ({ name, ...stringShape(env[name]) }));
}

export function describeStorageAddressing(env = process.env) {
  return {
    endpoint: describeEndpoint(env.CONVERSATION_S3_ENDPOINT),
    bucketVirtualHostCompatible: bool(isVirtualHostCompatibleBucket(env.CONVERSATION_S3_BUCKET)),
    regionIsAuto: bool(env.CONVERSATION_S3_REGION === 'auto'),
    forcePathStyle: bool(env.CONVERSATION_S3_FORCE_PATH_STYLE === 'true'),
  };
}

export function describeSafeHttpRequest(request, operation = null) {
  const headers = request?.headers && typeof request.headers === 'object' ? request.headers : {};
  return {
    operation: safeToken(operation),
    headers: Object.entries(headers)
      .map(([name, value]) => ({ name: safeToken(name), ...stringShape(value) }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  };
}

function sourceError(error) {
  return error?.cause ?? error;
}

export function getSafeStorageProviderDiagnostic(error) {
  if (error?.provider && typeof error.provider === 'object' && Object.hasOwn(error.provider, 'providerErrorName')) {
    return safeDiagnostic(error.provider);
  }

  const provider = sourceError(error);
  const metadata = provider?.$metadata && typeof provider.$metadata === 'object' ? provider.$metadata : {};
  return safeDiagnostic({
    providerErrorName: provider?.name,
    providerErrorCode: provider?.Code ?? provider?.code,
    providerMessage: provider?.message,
    httpStatus: metadata.httpStatusCode,
    requestId: metadata.requestId ?? metadata.extendedRequestId,
  });
}

export function getSafeStorageFailureDiagnostic(error) {
  return {
    provider: getSafeStorageProviderDiagnostic(error),
    configuration: Array.isArray(error?.diagnostics?.configuration) ? error.diagnostics.configuration : [],
    addressing: error?.diagnostics?.addressing ?? null,
    request: error?.diagnostics?.request ?? null,
    putObjectOptionNames: Array.isArray(error?.diagnostics?.putObjectOptionNames) ? error.diagnostics.putObjectOptionNames : [],
  };
}

export class ConversationResourceStorageError extends Error {
  constructor(code, message, cause = null, diagnostics = null) {
    super(message, cause ? { cause } : undefined);
    this.code = code;
    this.provider = cause ? getSafeStorageProviderDiagnostic(cause) : null;
    this.diagnostics = diagnostics;
  }
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new ConversationResourceStorageError('RESOURCE_STORAGE_UNAVAILABLE', `${name} is required for durable conversation storage`);
  return value;
}

export function buildS3ClientConfig({ region, endpoint, accessKeyId, secretAccessKey, forcePathStyle }) {
  return {
    region,
    endpoint,
    forcePathStyle,
    // R2 does not implement every optional S3 checksum extension. Preserve only
    // protocol-required integrity behavior; content hashes remain persisted by the app.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId, secretAccessKey },
  };
}

export function buildPutObjectInput({ bucket, key, body, mimeType }) {
  return {
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: mimeType,
  };
}

export function createConversationResourceStorage(env = process.env) {
  const driver = String(env.CONVERSATION_STORAGE_DRIVER ?? '').toLowerCase();
  if (driver !== 's3') {
    throw new ConversationResourceStorageError('RESOURCE_STORAGE_UNAVAILABLE', 'No durable conversation storage provider is configured');
  }

  const bucket = required(env, 'CONVERSATION_S3_BUCKET');
  const region = required(env, 'CONVERSATION_S3_REGION');
  const accessKeyId = required(env, 'CONVERSATION_S3_ACCESS_KEY_ID');
  const secretAccessKey = required(env, 'CONVERSATION_S3_SECRET_ACCESS_KEY');
  const endpoint = env.CONVERSATION_S3_ENDPOINT || undefined;
  const configuration = describeStorageConfiguration(env);
  const addressing = describeStorageAddressing(env);
  let request = null;
  const client = new S3Client(buildS3ClientConfig({
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: env.CONVERSATION_S3_FORCE_PATH_STYLE === 'true',
  }));

  client.middlewareStack.addRelativeTo(
    (next, context) => async (args) => {
      request = describeSafeHttpRequest(args.request, context.commandName);
      return next(args);
    },
    {
      relation: 'after',
      toMiddleware: 'awsAuthMiddleware',
      name: 'captureSafeConversationStorageRequest',
      step: 'finalizeRequest',
    }
  );

  const failureDiagnostics = (putObjectOptionNames = []) => ({
    configuration,
    addressing,
    request,
    putObjectOptionNames,
  });

  return {
    async put({ key, body, mimeType }) {
      const input = buildPutObjectInput({ bucket, key, body, mimeType });
      try {
        await client.send(new PutObjectCommand(input));
      } catch (error) {
        throw new ConversationResourceStorageError(
          'RESOURCE_STORAGE_WRITE_FAILED',
          'Unable to store attachment',
          error,
          failureDiagnostics(Object.keys(input).sort())
        );
      }
    },
    async get({ key }) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return response.Body;
      } catch (error) {
        throw new ConversationResourceStorageError(
          'RESOURCE_STORAGE_READ_FAILED',
          'Unable to read attachment',
          error,
          failureDiagnostics()
        );
      }
    },
    async head({ key }) {
      try {
        const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { mimeType: response.ContentType ?? null, sizeBytes: Number(response.ContentLength ?? 0) };
      } catch (error) {
        throw new ConversationResourceStorageError(
          'RESOURCE_STORAGE_METADATA_FAILED',
          'Unable to read attachment',
          error,
          failureDiagnostics()
        );
      }
    },
    async remove({ key }) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        throw new ConversationResourceStorageError(
          'RESOURCE_STORAGE_DELETE_FAILED',
          'Unable to delete attachment',
          error,
          failureDiagnostics()
        );
      }
    },
  };
}
