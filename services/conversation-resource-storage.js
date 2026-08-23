import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export class ConversationResourceStorageError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.code = code;
  }
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new ConversationResourceStorageError('RESOURCE_STORAGE_UNAVAILABLE', `${name} is required for durable conversation storage`);
  return value;
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
        await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: mimeType,
          ChecksumSHA256: checksum || undefined,
          ServerSideEncryption: 'AES256',
        }));
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
    async remove({ key }) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        throw new ConversationResourceStorageError('RESOURCE_STORAGE_DELETE_FAILED', 'Unable to delete attachment', error);
      }
    },
  };
}
