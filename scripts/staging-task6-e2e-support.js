import { readFile, writeFile } from 'node:fs/promises';

import JSZip from 'jszip';

const SAFE_EVIDENCE_FIELDS = new Set([
  'assistant_id', 'chunk_count', 'format', 'gate', 'marker_hash', 'model',
  'provider', 'source_id', 'status', 'tenant_id', 'vector_count', 'version_id',
]);

function safeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

function safePdfText(value) {
  return String(value).replace(/([\\()])/g, '\\$1').replace(/[^\x20-\x7e]/g, '?');
}

export function createRunMarker(environment = process.env) {
  const runId = String(environment.GITHUB_RUN_ID ?? '');
  const attempt = String(environment.GITHUB_RUN_ATTEMPT ?? '');
  if (!/^\d{1,20}$/.test(runId) || !/^\d{1,6}$/.test(attempt)) throw new Error('TASK6_E2E_RUN_ID_INVALID');
  return `TASK6_E2E_${runId}_${attempt}`;
}

export function safeResultLine(result, gate, evidence = {}) {
  const safeResult = String(result).replace(/[^A-Z_]/g, '');
  const safeGate = String(gate).replace(/[^A-Z0-9_]/g, '');
  const fields = Object.entries(evidence).map(([key, value]) => {
    if (!SAFE_EVIDENCE_FIELDS.has(key)) throw new Error('TASK6_E2E_UNSAFE_EVIDENCE_FIELD');
    const safeValue = String(value).replace(/[\r\n|]/g, ' ').slice(0, 160);
    return `${key}=${safeValue}`;
  });
  return `${safeResult} | ${safeGate}${fields.length ? ` | ${fields.join(' ')}` : ''}`;
}

export function strictTlsConfig(connectionUrl) {
  const parsed = new URL(connectionUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('STAGING_DATABASE_URL_INVALID');
  if (!parsed.hostname || !parsed.username || !parsed.pathname.slice(1)) throw new Error('STAGING_DATABASE_URL_INVALID');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    ssl: { rejectUnauthorized: true, servername: parsed.hostname },
  };
}

export function assertVerifiedTls(client) {
  const stream = client?.connection?.stream;
  if (stream?.encrypted !== true || stream?.authorized !== true) throw new Error('TLS_VERIFICATION_FAILED');
}

export async function pollUntil({ operation, accept, reject, intervalMs, timeoutMs, timeoutCode }) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const result = await operation();
    if (accept(result)) return result;
    if (reject(result)) throw new Error(`${timeoutCode}_REJECTED`);
    if (Date.now() >= deadline) throw new Error(timeoutCode);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function writeFixtureState(path, state) {
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function readFixtureState(path) {
  const state = JSON.parse(await readFile(path, 'utf8'));
  if (!/^TASK6_E2E_\d{1,20}_\d{1,6}$/.test(String(state?.marker ?? ''))) throw new Error('TASK6_E2E_STATE_INVALID');
  return state;
}

export function createTxtFixture(marker) {
  const semanticMarker = `${marker}_TXT`;
  return {
    filename: 'task6-e2e.txt', mimeType: 'text/plain', semanticMarker,
    bytes: Buffer.from(`Task 6 staging acceptance fact: ${semanticMarker} identifies the cedar lighthouse protocol.\n`, 'utf8'),
  };
}

export function createPdfFixture(marker) {
  const semanticMarker = `${marker}_PDF`;
  const text = `Task 6 staging acceptance fact: ${semanticMarker} identifies the amber compass protocol.`;
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${safePdfText(text)}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return { filename: 'task6-e2e.pdf', mimeType: 'application/pdf', semanticMarker, bytes: Buffer.from(document, 'ascii') };
}

export async function createDocxFixture(marker) {
  const semanticMarker = `${marker}_DOCX`;
  const text = `Task 6 staging acceptance fact: ${semanticMarker} identifies the silver orchard protocol.`;
  const archive = new JSZip();
  archive.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  archive.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  archive.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${safeXml(text)}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
  const bytes = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { filename: 'task6-e2e.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', semanticMarker, bytes };
}
