import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(new URL('../migrations/016_knowledge_intelligence.sql', import.meta.url));

test('knowledge intelligence migration enables pgvector and keeps every knowledge entity tenant scoped', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/i);
  assert.match(sql, /ALTER TABLE knowledge_base_documents[\s\S]*ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS knowledge_source_assistants/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS knowledge_chunks/i);
  assert.match(sql, /tenant_id UUID NOT NULL REFERENCES tenants\(id\)/i);
  assert.match(sql, /embedding vector\(1536\)/i);
  assert.match(sql, /knowledge_chunks_embedding_hnsw/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS knowledge_candidates/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS business_profile_versions/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS assistant_knowledge_recommendations/i);
});