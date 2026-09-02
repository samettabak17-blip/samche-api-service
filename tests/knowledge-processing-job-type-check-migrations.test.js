import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrations = [
  '043_image_semantic_generation_jobs.sql',
  '052_assistant_recommendation_generation_jobs.sql',
  '055_assistant_configuration_generation_jobs.sql',
];

const canonicalJobTypes = [
  'INDEX_SOURCE',
  'GENERATE_IMAGE_CANDIDATES',
  'GENERATE_ASSISTANT_RECOMMENDATION',
  'GENERATE_ASSISTANT_CONFIGURATION',
];

test('rerunnable processing-job constraint migrations preserve every canonical job type', () => {
  for (const migrationName of migrations) {
    const migration = fs.readFileSync(new URL(`../migrations/${migrationName}`, import.meta.url), 'utf8');
    for (const jobType of canonicalJobTypes) {
      assert.match(migration, new RegExp(`'${jobType}'`), `${migrationName} must accept ${jobType}`);
    }
  }
});
