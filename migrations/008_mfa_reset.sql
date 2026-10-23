-- Two-factor sign-in (TOTP) and password reset. Tokens and recovery codes are stored only as SHA-256 hashes.
ALTER TABLE users ADD COLUMN totp_secret TEXT;                       -- base32; set while enrolling, live once totp_enabled = 1
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_last_step INTEGER;                 -- last accepted 30-second step: a code cannot be replayed
CREATE TABLE recovery_codes (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL, used_at TEXT
);
CREATE INDEX idx_recovery_user ON recovery_codes(user_id);
-- A correct password for a user with 2FA earns a short-lived challenge, not a session.
CREATE TABLE login_challenges (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
);
