-- Net worth tracker: initial schema. Money columns are INTEGER PAISE. Dates are ISO yyyy-mm-dd TEXT.
CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','viewer')), password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE clients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('live','case')), description TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE client_settings (client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE category_mappings (
  id TEXT PRIMARY KEY, client_id TEXT REFERENCES clients(id) ON DELETE CASCADE, domain TEXT NOT NULL CHECK (domain IN ('asset','cashflow')),
  match_type TEXT NOT NULL CHECK (match_type IN ('exact','instrument','keyword')), pattern TEXT NOT NULL, category TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 10, source TEXT NOT NULL DEFAULT 'user'
);
CREATE TABLE holdings (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL, original_description TEXT NOT NULL, instrument_type TEXT NOT NULL,
  asset_class TEXT, class_override TEXT, classification_method TEXT NOT NULL, classification_status TEXT NOT NULL, classification_reason TEXT NOT NULL DEFAULT '',
  geography TEXT, issuer TEXT, account TEXT, symbol TEXT, sector TEXT, quantity REAL,
  current_value INTEGER NOT NULL CHECK (current_value >= 0), invested_value INTEGER CHECK (invested_value IS NULL OR invested_value >= 0),
  acquisition_date TEXT, valuation_date TEXT, valuation_source TEXT NOT NULL DEFAULT 'manual',
  maturity_date TEXT, expected_maturity_value INTEGER,
  liquidity_tier INTEGER NOT NULL CHECK (liquidity_tier BETWEEN 1 AND 4), emergency_eligible INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT REFERENCES holdings(id) ON DELETE SET NULL, is_aggregate INTEGER NOT NULL DEFAULT 0,
  data_status TEXT NOT NULL DEFAULT 'collected', notes TEXT, archived INTEGER NOT NULL DEFAULT 0, is_illustrative INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_holdings_client ON holdings(client_id, archived);
CREATE TABLE valuations (
  id TEXT PRIMARY KEY, holding_id TEXT NOT NULL REFERENCES holdings(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date TEXT NOT NULL, value INTEGER NOT NULL, source TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_valuations_holding ON valuations(holding_id, date);
CREATE TABLE liabilities (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL, lender TEXT,
  outstanding INTEGER NOT NULL CHECK (outstanding >= 0), original_principal INTEGER, emi INTEGER, rate_bps INTEGER, remaining_months INTEGER, next_due_date TEXT, minimum_due INTEGER,
  data_status TEXT NOT NULL DEFAULT 'collected', notes TEXT, archived INTEGER NOT NULL DEFAULT 0, is_illustrative INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE cashflow_items (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind IN ('income','expense')), category TEXT NOT NULL, name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0), frequency TEXT NOT NULL, anchor_date TEXT, end_date TEXT, verified INTEGER NOT NULL DEFAULT 0, essential INTEGER NOT NULL DEFAULT 0,
  commitment_id TEXT, liability_id TEXT, data_status TEXT NOT NULL DEFAULT 'collected', notes TEXT, archived INTEGER NOT NULL DEFAULT 0, is_illustrative INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE commitments (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL,
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0), paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0), installment_amount INTEGER, frequency TEXT, next_due_date TEXT, end_date TEXT, annual_receivable INTEGER,
  data_status TEXT NOT NULL DEFAULT 'pending', notes TEXT, archived INTEGER NOT NULL DEFAULT 0, is_illustrative INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE transactions (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, holding_id TEXT REFERENCES holdings(id) ON DELETE SET NULL, date TEXT NOT NULL, type TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0), quantity REAL, notes TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_tx_client ON transactions(client_id, date);
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, date TEXT NOT NULL, gross_assets INTEGER NOT NULL, liabilities INTEGER, net_worth INTEGER,
  liabilities_complete INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'manual', note TEXT, created_at TEXT NOT NULL, UNIQUE (client_id, date)
);
CREATE TABLE insurance_policies (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, type TEXT NOT NULL, insurer TEXT, policy_no TEXT, sum_assured INTEGER, annual_premium INTEGER, premium_frequency TEXT,
  next_premium_date TEXT, renewal_date TEXT, maturity_date TEXT, expected_maturity_value INTEGER, data_status TEXT NOT NULL DEFAULT 'collected', archived INTEGER NOT NULL DEFAULT 0, is_illustrative INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE goals (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL, target_amount INTEGER NOT NULL CHECK (target_amount > 0), target_date TEXT NOT NULL,
  earmarked_amount INTEGER NOT NULL DEFAULT 0, monthly_contribution INTEGER NOT NULL DEFAULT 0, expected_return_bps INTEGER, notes TEXT, archived INTEGER NOT NULL DEFAULT 0, is_illustrative INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE allocation_targets (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, asset_class TEXT NOT NULL, target_bps INTEGER NOT NULL CHECK (target_bps BETWEEN 0 AND 10000), band_bps INTEGER, PRIMARY KEY (client_id, asset_class)
);
CREATE TABLE rules (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, value REAL NOT NULL, unit TEXT NOT NULL, severity TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}', last_evaluated_at TEXT, PRIMARY KEY (client_id, key)
);
CREATE TABLE alerts (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, rule_key TEXT NOT NULL, fingerprint TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('open','acknowledged','resolved')),
  severity TEXT NOT NULL, subject TEXT NOT NULL, current_label TEXT NOT NULL, threshold_label TEXT NOT NULL, why TEXT NOT NULL, action TEXT NOT NULL, effect TEXT, records TEXT NOT NULL DEFAULT '[]', provisional INTEGER NOT NULL DEFAULT 0,
  first_detected_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, resolved_at TEXT, acknowledged_at TEXT, acknowledged_by TEXT, change_count INTEGER NOT NULL DEFAULT 0
);
-- at most one live (unresolved) alert per condition: prevents duplicate alerts on every refresh
CREATE UNIQUE INDEX uq_alert_live ON alerts(client_id, fingerprint) WHERE status != 'resolved';
CREATE INDEX idx_alert_client ON alerts(client_id, status);
CREATE TABLE alert_events (id TEXT PRIMARY KEY, alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE, at TEXT NOT NULL, event TEXT NOT NULL, detail TEXT);
CREATE TABLE health_assessments (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, date TEXT NOT NULL, score REAL NOT NULL, coverage REAL NOT NULL, provisional INTEGER NOT NULL, detail TEXT NOT NULL, UNIQUE (client_id, date)
);
CREATE TABLE scenarios (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, name TEXT NOT NULL, trades TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL);
CREATE TABLE instruments (symbol TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', provider TEXT, provider_ref TEXT);
CREATE TABLE market_observations (
  id TEXT PRIMARY KEY, symbol TEXT NOT NULL, kind TEXT NOT NULL, value REAL NOT NULL, currency TEXT NOT NULL, as_of TEXT NOT NULL, fetched_at TEXT NOT NULL, source TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0, UNIQUE (symbol, as_of, source)
);
CREATE INDEX idx_obs_symbol ON market_observations(symbol, as_of);
CREATE TABLE market_refresh_log (id TEXT PRIMARY KEY, provider TEXT NOT NULL, at TEXT NOT NULL, ok INTEGER NOT NULL, message TEXT, count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY, client_id TEXT, user_id TEXT, at TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, action TEXT NOT NULL, summary TEXT NOT NULL, before_json TEXT, after_json TEXT
);
CREATE INDEX idx_audit_client ON audit_events(client_id, at);
CREATE TABLE import_log (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, kind TEXT NOT NULL, filename TEXT, checksum TEXT NOT NULL, at TEXT NOT NULL, accepted INTEGER NOT NULL, rejected INTEGER NOT NULL, unresolved INTEGER NOT NULL, UNIQUE (client_id, kind, checksum));
