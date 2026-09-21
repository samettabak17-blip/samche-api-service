import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('migration 087 exists and defines visual AI tables, constraints and indexes', () => {
  const migrationPath = path.join(__dirname, '../migrations/087_canonical_visual_ai_foundation.sql');
  assert.ok(fs.existsSync(migrationPath), 'Migration 087 file must exist');

  const content = fs.readFileSync(migrationPath, 'utf8');

  // 1. conversation_resources source_type check constraint update
  assert.match(content, /VISUAL_AI_GENERATED/);
  assert.match(content, /ck_conversation_resources_source_type/);

  // 2. visual_ai_generation_jobs table
  assert.match(content, /CREATE TABLE IF NOT EXISTS visual_ai_generation_jobs/);
  assert.match(content, /uq_visual_ai_jobs_tenant_idempotency/);
  assert.match(content, /fk_visual_ai_jobs_target_resource/);
  assert.match(content, /fk_visual_ai_jobs_conversation/);

  // 3. tenant_visual_ai_config table
  assert.match(content, /CREATE TABLE IF NOT EXISTS tenant_visual_ai_config/);

  // 4. indexes
  assert.match(content, /idx_visual_ai_jobs_claim/);
  assert.match(content, /idx_visual_ai_jobs_conversation/);
});

test('migration 088 adds durable generated-message and WhatsApp delivery correlation', () => {
  const migrationPath = path.join(__dirname, '../migrations/088_visual_ai_phase3_delivery_orchestration.sql');
  const content = fs.readFileSync(migrationPath, 'utf8');
  assert.match(content, /output_message_id/);
  assert.match(content, /provider_message_id/);
  assert.match(content, /uq_visual_ai_jobs_generated_resource/);
});
