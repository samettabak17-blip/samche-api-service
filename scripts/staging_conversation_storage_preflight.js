import crypto from 'node:crypto';
import { createConversationResourceStorage } from '../services/conversation-resource-storage.js';

const storage = createConversationResourceStorage();
const key = `conversation-resources-preflight/${crypto.randomUUID()}`;
const body = Buffer.from(`samche-storage-preflight:${crypto.randomUUID()}`, 'utf8');

async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
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
  console.error(`CONVERSATION_STORAGE_PREFLIGHT: FAIL (${error?.code ?? 'STORAGE_PREFLIGHT_FAILED'})`);
  process.exitCode = 1;
} finally {
  await storage.remove({ key }).catch(() => {});
}

