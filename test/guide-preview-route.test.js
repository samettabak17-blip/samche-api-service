import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../routes/guideExperienceRoutes.js', import.meta.url), 'utf8');

test('draft preview route is authenticated, admin-only, and selects an exact draft without publishing', () => {
  assert.match(source, /drafts\/:versionId\/preview/);
  assert.match(source, /requireTenantAccess, requireTenantAdmin/);
  assert.match(source, /status[^\n]*DRAFT/);
  assert.match(source, /issueGuidePreviewToken/);
  assert.match(source, /activeDomain/);
  assert.doesNotMatch(source, /publishGuideExperience\(.*preview/);
});
