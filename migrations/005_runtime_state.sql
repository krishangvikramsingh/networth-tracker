-- Login throttling and duplicate-submit protection used to live in process memory: they reset on restart and did not work
-- across instances. They now live in the database. Times are epoch milliseconds.
CREATE TABLE login_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_start INTEGER NOT NULL);
CREATE INDEX idx_login_window ON login_attempts(window_start);
CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, status INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX idx_idem_created ON idempotency_keys(created_at);
