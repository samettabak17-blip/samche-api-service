import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { extractDocumentText } from '../services/conversation-document-extraction-service.js';

import {
  assertVerifiedTls,
  createDocxFixture,
  createPdfFixture,
  createRunMarker,
  createTxtFixture,
  pollUntil,
  safeResultLine,
  strictTlsConfig,
  writeFixtureState,
} from '../scripts/staging-task6-e2e-support.js';

test('creates a bounded marker from GitHub run identity', () => {
  assert.equal(createRunMarker({ GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '2' }), 'TASK6_E2E_12345_2');
  assert.throws(() => createRunMarker({ GITHUB_RUN_ID: '../bad', GITHUB_RUN_ATTEMPT: '1' }), /TASK6_E2E_RUN_ID_INVALID/);
});

test('safe result lines allow only non-secret evidence fields', () => {
  assert.equal(safeResultLine('PASS', 'PDF_READY', { status: 'READY', chunk_count: 2 }), 'PASS | PDF_READY | status=READY chunk_count=2');
  assert.throws(() => safeResultLine('PASS', 'BAD', { token: 'secret' }), /TASK6_E2E_UNSAFE_EVIDENCE_FIELD/);
  assert.throws(() => safeResultLine('PASS', 'BAD', { database_url: 'hidden' }), /TASK6_E2E_UNSAFE_EVIDENCE_FIELD/);
});

test('strict TLS config parses URL fields and requires certificate verification', () => {
  const config = strictTlsConfig('postgresql://user:p%40ss@db.example.test:5432/staging');
  assert.deepEqual(config, {
    host: 'db.example.test', port: 5432, user: 'user', password: 'p@ss', database: 'staging',
    ssl: { rejectUnauthorized: true, servername: 'db.example.test' },
  });
  assert.equal('connectionString' in config, false);
  assert.doesNotThrow(() => assertVerifiedTls({ connection: { stream: { encrypted: true, authorized: true } } }));
  assert.throws(() => assertVerifiedTls({ connection: { stream: { encrypted: true, authorized: false } } }), /TLS_VERIFICATION_FAILED/);
});

test('polling is bounded and returns only when the predicate is satisfied', async () => {
  let calls = 0;
  const result = await pollUntil({
    operation: async () => ({ status: ++calls === 3 ? 'READY' : 'PROCESSING' }),
    accept: (value) => value.status === 'READY',
    reject: () => false,
    intervalMs: 1,
    timeoutMs: 100,
    timeoutCode: 'SOURCE_TIMEOUT',
  });
  assert.equal(result.status, 'READY');
  await assert.rejects(pollUntil({ operation: async () => ({ status: 'PROCESSING' }), accept: () => false, reject: () => false, intervalMs: 1, timeoutMs: 2, timeoutCode: 'SOURCE_TIMEOUT' }), /SOURCE_TIMEOUT/);
});

test('fixture state is written with owner-only permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'task6-e2e-'));
  const path = join(directory, 'state.json');
  try {
    await writeFixtureState(path, { marker: 'TASK6_E2E_1_1', tenantIds: [] });
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { marker: 'TASK6_E2E_1_1', tenantIds: [] });
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('generates distinct in-memory PDF DOCX and TXT fixtures', async () => {
  const marker = 'TASK6_E2E_123_1';
  const fixtures = [createPdfFixture(marker), await createDocxFixture(marker), createTxtFixture(marker)];
  assert.deepEqual(fixtures.map((fixture) => fixture.filename), ['task6-e2e.pdf', 'task6-e2e.docx', 'task6-e2e.txt']);
  assert.deepEqual(fixtures.map((fixture) => fixture.mimeType), ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']);
  assert.equal(new Set(fixtures.map((fixture) => fixture.semanticMarker)).size, 3);
  assert.ok(fixtures.every((fixture) => Buffer.isBuffer(fixture.bytes) && fixture.bytes.length > 40));
  assert.match(fixtures[0].bytes.subarray(0, 5).toString('ascii'), /^%PDF-/);
  assert.match(fixtures[2].bytes.toString('utf8'), /TASK6_E2E_123_1_TXT/);

  for (const fixture of fixtures) {
    const extracted = await extractDocumentText({ mimeType: fixture.mimeType, bytes: fixture.bytes });
    assert.match(extracted.extractedText, new RegExp(fixture.semanticMarker));
  }
});
