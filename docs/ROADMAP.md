# Roadmap and improvement backlog

Working document for continuing development with Claude Code. Each task has a checkbox, the files involved, and acceptance criteria. Work top to bottom within a phase. Timelines are planning estimates, not commitments.

## How to work on this repo with Claude Code

```bash
cd networth-tracker
npm install
npm run typecheck && npm test        # must stay green (379 tests)
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
- [x] **Writes on GET.** DONE: reads are write-free (SQL-spy test over every GET), reconciliation moved to mutations and `jobs.ts`.
- [x] **Module-level transaction depth.** DONE: per-connection depth with savepoints (`tests/runtime.test.ts`).
- [x] **In-memory stores.** DONE: login throttle and idempotency keys live in the database (migration 005).
- [ ] **Experimental SQLite.** `node:sqlite` is experimental. Abstract the repository (`src/server/repo.ts`) behind an interface so Postgres can replace it (see 0.3).
- [x] **Single 0.9 MB JS bundle.** DONE: route-level `React.lazy`; main chunk 295 kB (charts 425 kB load on demand).
- [x] **Inline hook call.** DONE: `canWrite` is read at the top of `Overview`.
- **Done when:** all of the above have tests or a measured result, and `npm test` is green.

### 0.3 Platform
- [ ] Postgres support (keep SQLite for local demo): repository interface, SQL dialect differences, migrations runner, connection pooling.
- [x] Dockerfile + `docker-compose.yml` (SQLite on a volume) with a health check. Postgres is still open. The image build is verified by CI, not locally.
- [x] CI (GitHub Actions): typecheck, tests, build, e2e, `npm audit`, secret scan, Docker build.
- [x] Linting with a CI gate (Biome: correctness, suspicious code, accessibility). Formatting is intentionally not enforced; the code uses a dense style.
- [x] OpenAPI spec generated from the live routes and zod schemas; served at `/api/docs`.
- [ ] Server-side pagination/search for large tables (holdings, transactions, audit).

### 0.4 Security hardening (before any real data)
- [x] **Multi-tenant authorisation (application level):** DONE with an exhaustive route sweep. Still open: Postgres row-level security as defence in depth.
- [x] MFA (TOTP) with recovery codes, password reset by email, password change (`/security`; `tests/mfa.test.ts` 22 tests, mutation-checked; `npm run test:e2e:auth`).
- [x] Email verification, session list and revoke, mandatory-MFA policy for advisors (`REQUIRE_MFA_FOR_ADMINS`), TOTP secrets encrypted at rest (`tests/account.test.ts`, mutation-checked).
- [ ] Per-account lockout after repeated failures (only per-address throttles exist), password breach check, key rotation for `DATA_ENCRYPTION_KEY`.
- [ ] Remove default demo credentials outside development (`src/server/seed.ts`); fail startup in production if unset.
- [ ] Global rate limiting; request size limits per route; stricter upload validation.
- [ ] Encryption at rest (DB/volume) and a secrets manager; rotate session secrets.
- [ ] Immutable audit log (append-only table, hash chain or external sink).
- [ ] External penetration test; fix findings.
- **Done when:** two-tenant isolation tests pass and the pen test has no critical or high findings.

### 0.5 Quality
- [x] Automated accessibility audit (axe-core, `npm run test:a11y`, in CI); findings fixed; 0 violations against WCAG 2.1 AA.
- [x] Lighthouse run on the signed-in app: accessibility, best practices and SEO 100; performance 99 desktop, 82 to 83 on a simulated slow phone.
- [x] Component tests for tables, dialogs, fields, money input, KPI tiles (`tests/components/ui.test.tsx`, jsdom, mutation-checked) and visual regression screenshots (`npm run test:visual`, local). Entity forms (`src/web/forms.tsx`) are not yet component-tested.
- [x] Property-based tests for the engine (`tests/properties.test.ts`, fast-check, 200 random portfolios per property): gross assets is the plain sum regardless of order; allocation shares sum to 100%; splitting an aggregate never changes gross; net worth = gross − liabilities; not-assessed stays null; evaluation is deterministic. Mutation-checked.
- [x] Load test with 5,000 holdings (`scripts/load.ts`, `tests/scale.test.ts`): evaluate p95 5.5 ms; the whole `/state` request p95 about 100 ms (budget 300 ms), so no caching is needed. It found a 6.4 MB payload, so responses are now gzip-compressed. Pagination of the state payload is still open for much larger books.

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
- [x] Advisor console (first version): `/clients` with search, portfolio-level view and attention queue. Task queue with assignment, due dates, status and alert links shipped (`/tasks`, `tests/tasks.test.ts`). Still open: bulk actions, task comments, notifications on assignment.
- [ ] Client invitations; household/family grouping. (Nominee registry and per-asset nominations done: `/nominees`.)
- [ ] Roles beyond admin/viewer (advisor, analyst, client, auditor).
- [ ] White-label branded reports; server-side PDF generation (headless Chromium) with scheduled delivery.
- [x] Email notifications driven by alert events with per-user preferences (`src/server/notify.ts`). Still open: SMS/push, escalation emails when severity rises, quiet hours, a real SMTP provider verified in staging.
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
- [x] PWA: installable, offline shell, no private data cached. Still open: push notifications, native wrapper if needed, test on real iOS and Android hardware.
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
