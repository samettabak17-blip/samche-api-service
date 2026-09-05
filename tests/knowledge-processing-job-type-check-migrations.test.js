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

test('latest Business Profile job migration preserves all prior job types and adds its own', () => {
  const migration = fs.readFileSync(new URL('../migrations/066_business_profile_generation_jobs.sql', import.meta.url), 'utf8');
  for (const jobType of [...canonicalJobTypes, 'GENERATE_BUSINESS_PROFILE']) {
    assert.match(migration, new RegExp(`'${jobType}'`));
  }
});
