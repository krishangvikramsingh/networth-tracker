# Roadmap and improvement backlog

Working document for continuing development with Claude Code. Each task has a checkbox, the files involved, and acceptance criteria. Work top to bottom within a phase. Timelines are planning estimates, not commitments.

## How to work on this repo with Claude Code

```bash
cd networth-tracker
npm install
npm run typecheck && npm test        # must stay green (171 tests)
npm run build && npm run test:e2e    # e2e needs a running server: npm run serve (after build)
```

Ground rules for every change:

1. **Financial logic lives only in `src/shared/`.** No calculations in React components or route handlers.
2. **Money is integer paise.** Never use floats for currency; percentages are rounded by `pct()` in `src/shared/money.ts`.
3. **Unknown is not zero.** New metrics must return `null`/"Awaiting data" or a `[min,max]` range when inputs are missing. Add a test for the missing-data case.
4. **Every rule change needs tests at, below and above the threshold** (see `tests/engine.test.ts`, `ruleOf()` helper in `tests/helpers.ts`).
5. **Schema changes = a new numbered file in `migrations/`.** Never edit `001_init.sql` once data exists.
6. **Do not execute trades or move money.** Recommendations are options for review only.
7. Keep demo fixtures (`src/shared/fixtures.ts`) free of invented client data; illustrative values must carry `isIllustrative: true`.
8. Update `docs/ACCEPTANCE_REPORT.md` and the README test counts when tests change.

Orientation: `README.md`, `docs/ARCHITECTURE.md`, `docs/AUDIT.md`, `docs/SECURITY.md`, `docs/MARKET_DATA.md`.

---

## Phase 0: Correctness and foundation (do first)

### 0.1 Reconcile with the original specification
The workbook (`NETWORTH_TRACKER-TEAM_TAZEEN_CONSOLIDATED_SOLVED.xlsx`) and the two reference images were never available. Requirements came from the written brief.

- [ ] Obtain the workbook and images; add them under `docs/spec/` (or keep local and note the path).
- [ ] Inspect all four sheets (Dashboard, Category Allocation, Data Collection, Category Mappings); list fields, formulas, mappings and thresholds.
- [ ] Compare against `src/shared/classify.ts` (`defaultMappings`), `src/shared/rules.ts` (`RULE_DEFS`) and `docs/AUDIT.md`; fix differences and record deviations in `docs/AUDIT.md`.
- [ ] Add a workbook importer (or documented CSV conversion) in `src/server/importer.ts` for the Data Collection sheet.
- **Done when:** the traceability matrix in `docs/AUDIT.md` cites the real sheet/image for each row and no requirement is "derived from brief only".

### 0.2 Known engineering defects
- [ ] **Writes on GET.** `GET /api/clients/:cid/state` calls `buildState` -> `refresh` -> `syncAlerts` (`src/server/service.ts`, `src/server/app.ts`). Move alert reconciliation to mutation handlers and a scheduled job; make `GET` read-only. Test: two GETs produce no DB writes.
- [ ] **Module-level transaction depth.** `tx()` in `src/server/db.ts` uses a global counter. Replace with a per-connection mechanism (savepoints) so concurrent async work cannot corrupt nesting.
- [ ] **In-memory stores.** `loginThrottle` (`src/server/auth.ts`) and the idempotency map (`src/server/app.ts`) reset on restart and do not work across instances. Move to the database (new migration) with expiry cleanup.
- [ ] **Experimental SQLite.** `node:sqlite` is experimental. Abstract the repository (`src/server/repo.ts`) behind an interface so Postgres can replace it (see 0.3).
- [ ] **Single 0.9 MB JS bundle.** Add route-level code splitting (`React.lazy`) in `src/web/App.tsx`; target main chunk under 400 kB.
- [ ] **Inline hook call.** `Overview.tsx` calls `useApp().canWrite` inside JSX; hoist to the top of the component.
- **Done when:** all of the above have tests or a measured result, and `npm test` is green.

### 0.3 Platform
- [ ] Postgres support (keep SQLite for local demo): repository interface, SQL dialect differences, migrations runner, connection pooling.
- [ ] Dockerfile + `docker-compose.yml` (app + Postgres); health check on `/api/health`.
- [ ] CI (GitHub Actions): typecheck, tests, build, e2e, `npm audit`, secret scan.
- [ ] Linting/formatting (ESLint + Prettier or Biome) with a CI gate.
- [ ] OpenAPI spec generated from the zod schemas (`src/server/schemas.ts`); publish at `/api/docs`.
- [ ] Server-side pagination/search for large tables (holdings, transactions, audit).

### 0.4 Security hardening (before any real data)
- [ ] **Multi-tenant authorisation:** add `tenant_id` to `clients`/`users`; enforce on every query in `src/server/repo.ts` and `src/server/service.ts`. Test: user A cannot read or write tenant B (every route).
- [ ] MFA (TOTP), password reset by email, email verification, session list/revoke, account lockout.
- [ ] Remove default demo credentials outside development (`src/server/seed.ts`); fail startup in production if unset.
- [ ] Global rate limiting; request size limits per route; stricter upload validation.
- [ ] Encryption at rest (DB/volume) and a secrets manager; rotate session secrets.
- [ ] Immutable audit log (append-only table, hash chain or external sink).
- [ ] External penetration test; fix findings.
- **Done when:** two-tenant isolation tests pass and the pen test has no critical or high findings.

### 0.5 Quality
- [ ] Automated accessibility audit (axe/Lighthouse) in CI; fix findings; target WCAG 2.1 AA.
- [ ] Component tests for forms (`src/web/forms.tsx`) and tables (`src/web/ui.tsx`); visual regression screenshots for key pages.
- [ ] Property-based tests for the engine (aggregate reconciliation never changes gross assets; allocation percentages sum to 100 on the chosen denominator).
- [ ] Load test the evaluate path with 5,000 holdings; cache or incrementally update if p95 exceeds 300 ms.

---

## Phase 1: Real data in (private beta)

### 1.1 Market data
- [ ] Verify the AMFI NAV adapter against the live file from a networked machine (`src/server/market/providers.ts`, `parseAmfiNav`); capture a real sample as a test fixture.
- [ ] Scheduled refresh job (cron/worker) with logging, retries and alerting on repeated failures.
- [ ] Licensed provider for NIFTY 500, bonds, REITs/InvITs and S&P 500; implement `nse` and `sp500` adapters; store licence terms in `docs/MARKET_DATA.md`.
- [ ] FX: automatic USDINR observation; convert foreign holdings; show conversion source and timestamp.
- [ ] Instrument master: ISIN/scheme-code lookup in the holding form (autocomplete).

### 1.2 Data ingestion
- [ ] CAMS/KFintech consolidated statement import (CAS PDF/XLS parsing) -> holdings and transactions.
- [ ] Broker holdings import (CSV) for common Indian brokers.
- [ ] Bank statement import for cash-flow categorisation using `classifyCashflow`.
- [ ] Look-through templates for common PMS/AIF strategies; import of fund factsheet holdings.
- [ ] Document attachments per holding/policy/liability (object storage, virus scan, size limits).

### 1.3 Compliance and privacy
- [ ] Consent capture and privacy notice; data export and deletion flows (India DPDP Act obligations to be confirmed with counsel).
- [ ] Legal review of recommendation wording and disclaimers (possible SEBI RIA implications).
- [ ] Data retention policy and backups with a tested restore drill.

### 1.4 Operations
- [ ] Structured logging to a central sink, metrics, tracing, uptime and error alerts.
- [ ] Daily automated backups; documented RTO/RPO.
- [ ] Staging environment mirroring production.

**Phase 1 gate:** 5 advisors using real data weekly; no data-loss incident; restore drill passed.

---

## Phase 2: Product depth (paid launch)

### 2.1 Finance engine
- [ ] Tax and exit-load modelling in rebalancing (`src/shared/rebalance.ts`): capital gains by holding period and instrument, exit loads, lock-ins.
- [ ] Loan amortisation schedules and prepayment simulation (`src/shared/` new module); use in the forecast and EMI rules.
- [ ] Time-weighted return (TWR) and benchmark comparison (NIFTY 500, S&P 500) alongside XIRR.
- [ ] Realised vs unrealised gains with cost basis (FIFO/average) in `src/shared/portfolio.ts`.
- [ ] Insurance needs analysis replacing the simple multiple in `src/shared/score.ts`.
- [ ] Validate defaults (liquidity tiers in `taxonomy.ts`, score bands, diversification formula, 40% EMI limit) with a finance professional; record sign-off in `docs/METHODOLOGY.md`.
- [ ] Indian financial-year views (April to March) and timezone-correct dates (IST).

### 2.2 Advisor product
- [ ] Advisor console: many clients, search, portfolio-level alerts, task queue.
- [ ] Client invitations; household/family grouping; nominees.
- [ ] Roles beyond admin/viewer (advisor, analyst, client, auditor).
- [ ] White-label branded reports; server-side PDF generation (headless Chromium) with scheduled delivery.
- [ ] Email/SMS/push notifications driven by alert events; user notification preferences.
- [ ] Saved views, bulk edit, undo for destructive actions, onboarding wizard.

### 2.3 Commercial
- [ ] Subscription billing, GST invoices, plan limits by client count, free trial.
- [ ] In-app help centre, contextual tours, support tooling, status page.

**Phase 2 gate:** 25+ paying advisors, 90% month-two retention, no severity-1 incident open more than 24 hours.

---

## Phase 3: Scale and differentiation
- [ ] Account Aggregator integration for consented bank/investment data.
- [ ] Monte-Carlo goal planning and retirement drawdown scenarios (clearly labelled as scenarios).
- [ ] Public API with keys, webhooks, and CRM/planning-tool integrations.
- [ ] Mobile app (React Native or PWA).
- [ ] Multi-language and multi-currency support.
- [ ] SOC 2 / ISO 27001 readiness.
- [ ] Performance: background jobs, cached evaluations, read replicas, incremental recomputation.

---

## Target architecture (SaaS)
- Shared database with `tenant_id` and Postgres row-level security; dedicated databases for large customers.
- `src/shared/` stays a pure library used by the API, workers and tests.
- Background worker + queue for price refresh, alert evaluation, report generation and imports.
- Object storage for documents and exports; CDN for the UI.
- Observability: logs, metrics, traces, audit export. Infrastructure as code.

## Open decisions (need an owner)
- First customer segment: independent advisors vs self-directed investors.
- Pricing model and tiers (per client vs flat).
- Data vendor choice and budget.
- Regulatory position on recommendations.
- Whether to keep SQLite as the supported single-user edition.

## Suggested first Claude Code sessions
1. "Read docs/ROADMAP.md section 0.2 and fix the `GET /state` write side effect with tests."
2. "Implement 0.2 in-memory throttle and idempotency stores in the database with a migration and tests."
3. "Add tenant isolation (0.4) with a two-tenant test suite covering every route."
4. "Add route-level code splitting and report the bundle sizes before and after."
5. "Add GitHub Actions CI running typecheck, tests, build and e2e."

## Definition of done for any task
- Typecheck, unit/API tests and build pass; e2e passes for UI changes.
- New behaviour has tests, including missing-data and boundary cases.
- Docs updated (README, `docs/`), migrations added if the schema changed.
- No secrets committed; no invented client data in fixtures.
