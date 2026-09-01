import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('semantic worker starts only after database migrations complete', () => {
  const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const migration = source.indexOf('await runMigrations()');
  const workerBootstrap = source.lastIndexOf('startKnowledgeWorkers();');
  assert.ok(migration >= 0);
  assert.ok(workerBootstrap > migration);
});
