-- Why a notification was queued: 'opened' (new alert) or 'escalated' (an existing alert became more severe).
ALTER TABLE notifications ADD COLUMN reason TEXT NOT NULL DEFAULT 'opened';
