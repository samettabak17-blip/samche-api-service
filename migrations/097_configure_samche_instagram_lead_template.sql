-- Migration 097: Reserve the Instagram lead-template migration slot.
--
-- Provider-approved template names and employee destinations are tenant data.
-- They must be configured through the normal tenant-scoped Instagram channel
-- configuration path after provider approval, never embedded in a migration.
SELECT 1;
