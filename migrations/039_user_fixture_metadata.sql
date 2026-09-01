BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test_fixture BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_users_assignable_customer
  ON users (email_normalized)
  WHERE system_role = 'CUSTOMER' AND status = 'ACTIVE' AND is_test_fixture = FALSE;

COMMIT;
