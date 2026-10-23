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
| Backup & recovery | SQLite file `data/networth.db` (WAL). Back up with `sqlite3 data/networth.db ".backup backup.db"` while running, or copy the file when stopped; restore by replacing the file. Demo state can be restored from the UI |

**Not production-ready:** single-tenant (every user sees every client), demo credentials, no MFA, no rate limit beyond login, no encryption at rest, no automated backups, no TLS termination (put behind a reverse proxy).
