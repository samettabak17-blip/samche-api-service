import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const recommendationJobType = 'GENERATE_ASSISTANT_RECOMMENDATION';

test('recommendation job type fits the durable processing-job schema after migration', () => {
  assert.equal(recommendationJobType.length, 33);
  assert.throws(
    () => {
      if (recommendationJobType.length > 32) {
        throw Object.assign(new Error('value too long'), { code: '22001' });
      }
    },
    { code: '22001' },
  );
  const sql = fs.readFileSync(
    new URL('../migrations/054_assistant_recommendation_job_type_capacity.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /ALTER COLUMN job_type TYPE VARCHAR\(48\)/i);
  assert.ok(recommendationJobType.length <= 48);
});
