-- Nominee registry and per-asset nomination shares (basis points of one asset; a complete nomination totals 10,000).
CREATE TABLE nominees (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, name TEXT NOT NULL, relationship TEXT NOT NULL,
  contact TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_nominees_client ON nominees(client_id);
CREATE TABLE nominations (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, entity TEXT NOT NULL CHECK (entity IN ('holding','policy')), entity_id TEXT NOT NULL,
  nominee_id TEXT NOT NULL REFERENCES nominees(id) ON DELETE CASCADE, share_bps INTEGER NOT NULL CHECK (share_bps BETWEEN 1 AND 10000), created_at TEXT NOT NULL,
  UNIQUE (entity, entity_id, nominee_id)
);
CREATE INDEX idx_nominations_client ON nominations(client_id, entity, entity_id);
