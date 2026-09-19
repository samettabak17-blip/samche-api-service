-- Migration 088: Make conversation_resources.message_id nullable
-- When attachments are uploaded via WebChat or Guide prior to message submission,
-- the resource record is persisted before a message ID exists.
-- This migration ensures message_id can safely be NULL during initial upload,
-- and later associated when the message is created.

DO $$
BEGIN
  ALTER TABLE conversation_resources ALTER COLUMN message_id DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;
