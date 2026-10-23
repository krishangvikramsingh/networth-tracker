# Security considerations

| Area | Implementation |
|---|---|
| Authentication | scrypt password hashes (salted); opaque 256-bit session token stored hashed (SHA-256); 12 h expiry; generic login error and equalised timing for unknown users; login throttling |
| Session cookie | `HttpOnly`, `SameSite=Strict`, `Secure` in production |
| Authorisation | Server-side: viewers can only read; all mutating routes require role `admin`. UI hiding is cosmetic |
| CSRF | SameSite=Strict **plus** a required custom header on every mutating `/api` request |
| Input validation | zod schemas on every entity, setting, rule, scenario; amounts are integer paise with bounds; SQL uses prepared statements only |
| Output | React escaping; strict CSP (`default-src 'self'`), `X-Frame-Options: DENY`, `nosniff`, no-referrer |
| CSV/Excel | formula-injection neutralisation on export; imports validated, size-limited, duplicates blocked |
| Secrets | none in source; `.env.example`; demo passwords are synthetic and overridable |
| Logging | structured JSON without bodies, cookies or passwords; request id on every response; generic 500 messages |
| Audit | create/update/archive/override/reconcile/import/export/reset/login events with before/after |
| Email alerts | Opt-in per user. Alerts are queued in the database inside the engine transaction; a separate job sends them, so a failing mail server cannot break an edit. Messages carry the rule name and record only (no figures or advice) unless `NOTIFY_INCLUDE_DETAILS=1`. HTML is escaped. SMTP credentials come from environment variables, never the database. Retries stop after 3 attempts and a recipient is never sent the same alert twice. Use an SMTP provider over TLS. |
| Installable app | The service worker caches the app shell and hashed JS/CSS only. It never intercepts `/api`, so no financial data or session is stored by the worker. `sw.js` and the manifest are served `no-cache` so a new release reaches installed copies. |
| Nominee data | Names, relationships and an optional contact line only. The page tells users not to enter passwords or PINs. Like all client data it is visible to every signed-in user (single-tenant). |
| Backup & recovery | SQLite file `data/networth.db` (WAL). Back up with `sqlite3 data/networth.db ".backup backup.db"` while running, or copy the file when stopped; restore by replacing the file. Demo state can be restored from the UI |

| Tenant isolation | Every user and client has a `tenant_id`. A single `app.param("cid")` guard runs before every client-scoped route, so a new route cannot forget it; a client in another tenant answers exactly like a nonexistent one (no id probing). Beyond the route guard: the client list, notification log, email recipients and the attention queue are tenant-scoped; demo reset and shared market data are operator-only. `tests/tenancy.test.ts` sweeps every `:cid` route, for every method, from other tenants (and from the operator) and asserts a 404 with no database writes. |
| Reads | GET handlers do not write (a SQL spy test covers every GET route). The one exception is CSV export, which records an audit entry. |
| Login throttle, idempotency | Stored in the database, so they survive restarts and apply across instances. Behind a proxy set `TRUST_PROXY`. |
| Transactions | Per-connection depth with savepoints; async callbacks are refused. |

**Not production-ready:** tenant isolation is application-level (a shared database, no row-level security); no MFA, password reset, email verification or account lockout beyond the login throttle; no encryption at rest; no automated backups; no TLS termination (put behind a reverse proxy); no external penetration test; shared market data is operator-only but not yet licensed (see `docs/MARKET_DATA.md`).
