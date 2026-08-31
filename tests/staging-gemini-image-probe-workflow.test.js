import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Gemini image probe is manual, staging-only, least-privilege, and keeps its secret out of command arguments', async () => {
  const workflow = await readFile(new URL('../.github/workflows/staging-gemini-image-knowledge-probe.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+(push|pull_request|schedule):/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/staging'/);
  assert.match(workflow, /GEMINI_API_KEY: \$\{\{ secrets\.STAGING_GEMINI_API_KEY \}\}/);
  assert.match(workflow, /staging-gemini-image-knowledge-probe\.js/);
  assert.doesNotMatch(workflow, /set -x|printenv|env\s*\||\?key=|PRODUCTION|main\b/i);
});
