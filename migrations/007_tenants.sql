-- Multi-tenant isolation. Every user and client belongs to exactly one tenant; existing rows become the 'default' tenant,
-- which is also the platform operator (it owns the demo data and may write shared market data).
ALTER TABLE users ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE clients ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_clients_tenant ON clients(tenant_id);
CREATE INDEX idx_users_tenant ON users(tenant_id);
