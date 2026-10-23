-- Email notifications driven by alert history. Request handlers only INSERT a pending row (no network I/O);
-- a separate dispatcher sends mail, so a slow or failing mail server can never break an edit.
CREATE TABLE notification_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, email_enabled INTEGER NOT NULL DEFAULT 0,
  min_severity TEXT NOT NULL DEFAULT 'high' CHECK (min_severity IN ('info','warning','high','critical')), updated_at TEXT NOT NULL
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, alert_id TEXT NOT NULL UNIQUE REFERENCES alerts(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  severity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','skipped','failed')), note TEXT, created_at TEXT NOT NULL, processed_at TEXT
);
CREATE INDEX idx_notifications_status ON notifications(status, created_at);
CREATE TABLE notification_deliveries (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sent','outbox','failed')), attempts INTEGER NOT NULL DEFAULT 1, error TEXT, at TEXT NOT NULL,
  PRIMARY KEY (notification_id, user_id)
);
-- Used only when no SMTP server is configured: the rendered message is kept here instead of being sent.
CREATE TABLE mail_outbox (id TEXT PRIMARY KEY, to_email TEXT NOT NULL, subject TEXT NOT NULL, text_body TEXT NOT NULL, html_body TEXT, created_at TEXT NOT NULL);
CREATE INDEX idx_outbox_to ON mail_outbox(to_email, created_at);
