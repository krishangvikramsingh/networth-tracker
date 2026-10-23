-- Email verification, session details for the "where am I signed in" list, and encrypted two-factor secrets.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
-- Accounts that already exist were created by an operator who typed the address, so they count as verified.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
ALTER TABLE sessions ADD COLUMN ip TEXT;
CREATE TABLE email_verifications (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
);
