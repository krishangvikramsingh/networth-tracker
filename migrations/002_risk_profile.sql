-- Risk-profile questionnaire results. Only complete assessments are stored; history is kept so changes can be reviewed.
CREATE TABLE risk_assessments (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, date TEXT NOT NULL,
  answers TEXT NOT NULL, tolerance_score INTEGER NOT NULL, capacity_score INTEGER NOT NULL, profile TEXT NOT NULL, limited_by TEXT NOT NULL,
  created_by TEXT, created_at TEXT NOT NULL, applied_at TEXT
);
CREATE INDEX idx_risk_client ON risk_assessments(client_id, created_at);
