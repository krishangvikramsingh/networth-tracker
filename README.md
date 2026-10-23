# Wealth Intelligence — Net Worth Tracker

A working personal wealth-management platform built for the **Design Experience** subject at NMIMS MPSTME.
It tracks assets and liabilities, analyses an investment portfolio, plans cash flow, scores financial health,
evaluates configurable rules/alerts, and proposes (never executes) rebalancing — for the live client
**Priya Ramanathan** plus three isolated investor case studies.

> Educational tool with synthetic data. Not investment, tax or legal advice. Not a credit-bureau score.

## Quick start

Requires **Node ≥ 22.13** (uses the built-in `node:sqlite`; no native build step).

```bash
cd networth-tracker
npm install
npm start            # builds the UI, then serves app + API on http://127.0.0.1:8787
```

Development with hot reload: `npm run dev` → http://localhost:5173 (API on :8787).

First run creates the database (`data/networth.db`), applies migrations, seeds Priya + 3 case studies and prints
two **synthetic demo accounts**:

| Role | Email | Password | Access |
|---|---|---|---|
| Advisor | `advisor@demo.local` | `Demo@2026-Advisor` | read / write |
| Viewer | `viewer@demo.local` | `Demo@2026-Viewer` | read-only (enforced on the server) |

Override with the `DEMO_*` variables in `.env.example`. In production mode random passwords are generated and printed once.

### Commands

| Command | What it does |
|---|---|
| `npm test` | 332 unit + API integration tests (engine, property-based invariants, two-factor and password reset, 5,000-holding scale + gzip, rules at/below/above thresholds, persistence, auth, import, reset, risk profile, nominees, email alerts, read-only GETs, tenant isolation, OpenAPI) |
| `npm run typecheck` | `tsc --noEmit` over server, shared engine, UI and tests |
| `npm run lint` | Biome lint (correctness and suspicious-code rules; formatting is not enforced) |
| `npm run build` | production UI bundle in `dist/web` |
| `npm run test:e2e:auth` | Browser walkthrough of two-factor sign-in, recovery codes and password reset (uses the demo viewer; throwaway database only) |
| `npm run test:a11y` | axe-core (WCAG 2.1 A/AA) on all 18 pages in light and dark, at desktop and phone width. Read-only; 0 violations at the last run |
| `npm run test:e2e` | Playwright/Chromium walkthrough against a running server (56 checks incl. mobile width, service worker and offline). It edits data, so point it at a throwaway database (see below) |
| `npm run seed` | not needed — seeding is automatic on an empty database |

End-to-end run on a throwaway database (never against data you care about):

```bash
npm run build
DATABASE_PATH=/tmp/e2e.db PORT=8799 NOTIFY_INTERVAL_SECONDS=0 npm run serve &
BASE=http://127.0.0.1:8799 npm run test:e2e
```

## Features added in the quick-wins round

| Feature | Where | Notes |
|---|---|---|
| **Risk profile** | `/risk`, `src/shared/riskprofile.ts` | 8 questions score *willingness* and *ability* to take risk; the profile is the lower of the two, capped by guard-rails (horizon under 3 years, reserve under 3 months). Unanswered questions give a range, never a default. A profile maps to an **illustrative** model allocation that can be applied as the target allocation; the policy stays "not validated". |
| **Nominees & estate readiness** | `/nominees`, `src/shared/estate.ts` | Nominee registry plus per-asset shares that must total 100%. "Not recorded" is shown as unknown, not as "no nominee". No passwords or credentials are stored. |
| **Installable app (PWA)** | `src/web/public/` | Manifest, icons, service worker. The worker caches the app shell only and **never `/api`**, so no financial data is stored on the device. Offline, the app says it cannot reach the server instead of showing a sign-in form. Regenerate icons with `node scripts/make-icons.mjs`. |
| **Email alerts** | `/notifications`, `src/server/notify.ts` | Opt-in per user, minimum severity, one digest per client. New alerts are queued in the database and sent by a background job, never inside a request. Without `SMTP_HOST` the messages go to a local outbox. Emails omit figures unless `NOTIFY_INCLUDE_DETAILS=1`. |

### More features

| Feature | Where | Notes |
|---|---|---|
| **All clients** | `/clients`, `src/server/overview.ts` | One row per client: gross assets, net worth (or "Awaiting data"), health score, open alerts by severity, nomination coverage, risk profile; plus an attention queue of the most severe open alerts. Read-only. |
| **Nomination-gap alert** | rule `nomination_gap` | Triggers when fully-nominated value falls below a threshold (default 100%, info severity). Shows "Awaiting data" until any nominee information exists. |
| **Escalation emails** | `src/server/alerts.ts` | When an existing alert becomes more severe it is emailed again (including to people who got the milder one). Never on a decrease. |
| **Organisations (tenants)** | migration 007 | Every user and client belongs to a tenant. One guard on every `:cid` route; other tenants get the same 404 as a nonexistent client. Create a user in a tenant: `NEW_USER_PASSWORD=... npm run user:create -- you@firm.com "Your Name" admin firm-a`. The `default` tenant is the platform operator (owns demo data and shared market prices). |
| **API reference** | `/api/docs`, `/api/docs/openapi.json` | OpenAPI 3.1 generated from the live route table and the zod validators, so it cannot drift. |

### Operations

* **Reads never write.** `GET /api/clients/:id/state` only evaluates and reports. Alert history is reconciled by mutations and by a background job (`RECONCILE_INTERVAL_SECONDS`, default 300; also at start-up).
* **Docker:** `docker compose up --build` (SQLite on a volume, bound to localhost). Put a TLS-terminating proxy in front and set `TRUST_PROXY=1`.
* **CI:** `.github/workflows/ci.yml` runs typecheck, tests, build, e2e, `npm audit`, a secret scan and a Docker build on every push.

## Demonstration

Open **Guided demo** in the sidebar: 15 steps (dashboard → add MF scheme → auto-categorise → liability → net-worth recalculation →
income → forecast → allocation alert → change threshold → rebalancing scenario → health score → case studies → pension commitment → export).
Data-entry steps use values labelled `DEMO entry`. **Reset demo data** restores Priya and the case studies without touching clients you created.

## What is where

```
src/shared/     Pure domain engine (no I/O): money, classification, portfolio, XIRR, net worth, cash-flow forecast,
                rules, health score, rebalancing, goals, fixtures.  Used by server, UI and tests.
src/server/     Express API, SQLite repository, auth, alert history, import/export, market-data adapters
src/web/        React UI (pages, charts, forms, design system in styles.css)
migrations/     SQL migrations (applied in order, each in a transaction)
tests/          Vitest suites
docs/           Architecture, methodology, audit/traceability, market data, security, acceptance report,
                roadmap, competitive analysis, project report (.docx)
```

## Important notes

* **Input files were not available.** The brief refers to `NETWORTH_TRACKER-TEAM_TAZEEN_CONSOLIDATED_SOLVED.xlsx` and two reference images. None were present in
  the build environment, so requirements were taken from the written brief. `docs/AUDIT.md` lists exactly what was derived, what to re-verify against the originals,
  and how to import the workbook's data (the import tool accepts CSV/XLSX with flexible headers).
* **Integrations:** only the demo provider and manual CSV upload are working. AMFI NAV parsing is implemented and tested but was not verified against the live endpoint;
  NSE and S&P 500 are credential-gated adapter slots. See `docs/MARKET_DATA.md`.
* **Not production-ready:** single-tenant, demo credentials, no backups scheduled, no document storage. See `docs/SECURITY.md` and Limitations.
