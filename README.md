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
| `npm test` | 171 unit + API integration tests (engine, rules at/below/above thresholds, persistence, auth, import, reset) |
| `npm run typecheck` | `tsc --noEmit` over server, shared engine, UI and tests |
| `npm run build` | production UI bundle in `dist/web` |
| `npm run test:e2e` | Playwright/Chromium walkthrough against a running server (28 checks incl. mobile width) |
| `npm run seed` | not needed — seeding is automatic on an empty database |

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
