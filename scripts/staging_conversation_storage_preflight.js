import crypto from 'node:crypto';
import {
  createConversationResourceStorage,
  getSafeStorageFailureDiagnostic,
} from '../services/conversation-resource-storage.js';

const storage = createConversationResourceStorage();
const key = `conversation-resources-preflight/${crypto.randomUUID()}`;
const body = Buffer.from(`samche-storage-preflight:${crypto.randomUUID()}`, 'utf8');

async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function shapeSummary({ name, present, length, leadingOrTrailingWhitespace, containsCR, containsLF, containsTAB, containsControlCharacter }) {
  return `${name}{present=${present};length=${length};edge_ws=${leadingOrTrailingWhitespace};cr=${containsCR};lf=${containsLF};tab=${containsTAB};control=${containsControlCharacter}}`;
}

function safeDiagnosticFields(error) {
  const diagnostic = getSafeStorageFailureDiagnostic(error);
  const provider = diagnostic.provider;
  const fields = [
    ['operation', error?.code],
    ['provider_name', provider.providerErrorName],
    ['provider_code', provider.providerErrorCode],
    ['http_status', provider.httpStatus],
    ['request_id', provider.requestId],
    ['sdk_operation', diagnostic.request?.operation],
  ].filter(([, value]) => value !== null && value !== undefined)
    .map(([name, value]) => `${name}=${value}`);

  if (diagnostic.configuration.length) {
    fields.push(`config_shape=${diagnostic.configuration.map(shapeSummary).join(',')}`);
  }
  if (diagnostic.request?.headers?.length) {
    fields.push(`request_header_shape=${diagnostic.request.headers.map(shapeSummary).join(',')}`);
  }
  return fields.join('; ');
}

try {
  await storage.put({ key, body, mimeType: 'text/plain', checksum: crypto.createHash('sha256').update(body).digest('base64') });
  const metadata = await storage.head({ key });
  const actual = await read(await storage.get({ key }));
  if (!actual.equals(body) || metadata.sizeBytes !== body.length || metadata.mimeType !== 'text/plain') {
    throw new Error('STORAGE_PREFLIGHT_VERIFICATION_FAILED');
  }
  console.log('CONVERSATION_STORAGE_PREFLIGHT: PASS');
} catch (error) {
  console.error(`CONVERSATION_STORAGE_PREFLIGHT: FAIL (${safeDiagnosticFields(error) || 'operation=STORAGE_PREFLIGHT_FAILED'})`);
  process.exitCode = 1;
} finally {
  await storage.remove({ key }).catch(() => {});
}
