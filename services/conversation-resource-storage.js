import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

function safeToken(value, maxLength = 128) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, maxLength);
  return normalized || null;
}

export function getSafeStorageProviderDiagnostic(error) {
  const provider = error?.provider ?? error?.cause ?? error;
  const metadata = provider?.$metadata && typeof provider.$metadata === 'object' ? provider.$metadata : {};
  const status = Number(metadata.httpStatusCode);
  return {
    providerErrorName: safeToken(provider?.name),
    providerErrorCode: safeToken(provider?.Code ?? provider?.code),
    httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    requestId: safeToken(metadata.requestId ?? metadata.extendedRequestId),
  };
}

export class ConversationResourceStorageError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.code = code;
    this.provider = cause ? getSafeStorageProviderDiagnostic(cause) : null;
  }
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new ConversationResourceStorageError('RESOURCE_STORAGE_UNAVAILABLE', `${name} is required for durable conversation storage`);
  return value;
}

export function buildPutObjectInput({ bucket, key, body, mimeType, checksum }) {
  return {
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: mimeType,
    ChecksumSHA256: checksum || undefined,
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
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: env.CONVERSATION_S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId, secretAccessKey },
  });

  return {
    async put({ key, body, mimeType, checksum }) {
      try {
        await client.send(new PutObjectCommand(buildPutObjectInput({ bucket, key, body, mimeType, checksum })));
      } catch (error) {
        throw new ConversationResourceStorageError('RESOURCE_STORAGE_WRITE_FAILED', 'Unable to store attachment', error);
      }
    },
    async get({ key }) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return response.Body;
      } catch (error) {
        throw new ConversationResourceStorageError('RESOURCE_STORAGE_READ_FAILED', 'Unable to read attachment', error);
      }
    },
    async head({ key }) {
      try {
        const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { mimeType: response.ContentType ?? null, sizeBytes: Number(response.ContentLength ?? 0) };
      } catch (error) {
        throw new ConversationResourceStorageError('RESOURCE_STORAGE_METADATA_FAILED', 'Unable to read attachment', error);
      }
    },
    async remove({ key }) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        throw new ConversationResourceStorageError('RESOURCE_STORAGE_DELETE_FAILED', 'Unable to delete attachment', error);
      }
    },
  };
}
