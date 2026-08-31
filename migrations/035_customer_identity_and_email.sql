-- Slice 1: canonical customer identity and email invariants.
-- This migration intentionally fails closed on canonical-email collisions.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_normalized VARCHAR(255);

-- Preserve explicit disabled rows; legacy active values become canonical ACTIVE.
UPDATE users SET status = 'ACTIVE' WHERE lower(status) = 'active';
UPDATE users SET status = 'DISABLED' WHERE lower(status) IN ('disabled', 'inactive');

UPDATE users
SET email_normalized = lower(trim(email))
WHERE email_normalized IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT email_normalized
        FROM users
        GROUP BY email_normalized
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'users email_normalized collision detected; resolve duplicate/case-variant emails manually before applying uniqueness';
    END IF;
END $$;

ALTER TABLE users ALTER COLUMN email_normalized SET NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ALTER COLUMN status SET DEFAULT 'ACTIVE';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users
    ADD CONSTRAINT users_status_check
    CHECK (status IN ('INVITED', 'ACTIVE', 'DISABLED'));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_password_status_check;
ALTER TABLE users
    ADD CONSTRAINT users_password_status_check
    CHECK (status = 'INVITED' OR password_hash IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_unique
    ON users(email_normalized);

CREATE INDEX IF NOT EXISTS idx_users_email_normalized
    ON users(email_normalized);

COMMIT;
