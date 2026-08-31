import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../routes/knowledgeIntelligenceRoutes.js', import.meta.url), 'utf8');

test('image candidate generation is an explicit tenant-admin source action', () => {
  assert.match(source, /sources\/:sourceId\/candidates\/generate', requireTenantAccess, requireTenantAdmin/);
  assert.match(source, /createImageKnowledgeCandidates/);
  assert.match(source, /extractionHash: req\.body\?\.extraction_hash/);
});

test('candidate evidence response exposes conversation and image provenance safely', () => {
  assert.match(source, /knowledge_candidate_image_evidence/);
  assert.match(source, /evidence_type/);
  assert.match(source, /role_confidence/);
  assert.match(source, /normalized_text/);
  assert.match(source, /source_title/);
  assert.match(source, /extraction_version/);
  assert.match(source, /segment_order/);
});

test('source response exposes only safe image extraction summary metadata', () => {
  assert.match(source, /extraction_hash, extraction_method/);
  assert.match(source, /image_segment_count/);
  assert.match(source, /image_role_summary/);
  assert.match(source, /knowledge_source_extraction_segments/);
});
