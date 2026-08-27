import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../routes/knowledgeIntelligenceRoutes.js', import.meta.url), 'utf8');

test('configuration review and activation endpoints remain tenant-admin scoped', () => {
  assert.match(source, /approveAssistantConfigurationVersion/);
  assert.match(source, /approveBusinessProfileVersion/);
  assert.match(source, /activateAssistantConfigurationVersion/);
  assert.match(source, /activateBusinessProfileVersion/);
  assert.match(source, /:tenantId\/knowledge-intelligence\/assistants\/:assistantId\/configurations/);
  assert.match(source, /:tenantId\/knowledge-intelligence\/profiles\/:versionId\/approve/);
  assert.match(source, /:tenantId\/knowledge-intelligence\/profiles\/generate/);
  assert.match(source, /:tenantId\/knowledge-intelligence\/profiles\/:versionId\/reject/);
  assert.match(source, /:tenantId\/knowledge-intelligence\/assistants\/:assistantId\/recommendations\/generate/);
  assert.match(source, /:tenantId\/knowledge-intelligence\/assistants\/:assistantId\/configurations\/generate/);
  assert.match(source, /:tenantId\/knowledge-intelligence\/overview/);
  assert.match(source, /:tenantId\/knowledge-intelligence\/assistants\/:assistantId\/retrieval-preview/);
  assert.match(source, /requireTenantAccess, requireTenantAdmin/);
});

