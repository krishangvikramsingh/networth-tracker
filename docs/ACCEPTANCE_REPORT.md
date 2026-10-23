# Acceptance-test report

Run on 2026-10-23 (Node 26.5, Chromium 1234). Quick-win features added (risk profile, nominees, PWA, email alerts), then: read-only GETs, database-backed throttle/idempotency, savepoint transactions, escalation emails, nomination rule, tenant isolation, clients overview, OpenAPI, code splitting, Docker and CI. Commands: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.

| Gate | Result |
|---|---|
| Type check (`tsc --noEmit`) | pass, 0 errors |
| Unit + API tests (`vitest`) | **332 passed** across 17 files (engine 122 · property-based 7 · scale 2 · two-factor and reset 22 · API/integration 32 · features API 24 · read-only GETs 22 · tenant isolation 18 · runtime state 15 · risk profile 14 · Priya baseline 12 · nomination rule 10 · estate 8 · clients overview 8 · OpenAPI 7 · market 5 · escalation 4) |
| Production build | pass |
| Load (5,000 holdings) | engine evaluate **p95 5.5 ms**; full `GET /state` **median 83 ms, p95 100 ms** (budget 300 ms). Payload is 6.4 MB uncompressed, so gzip was added (asserted by a test). Run `node --import tsx scripts/load.ts` |
| Accessibility (axe-core, WCAG 2.1 A/AA) | **0 violations** on 18 pages × light/dark × 1440 px and 390 px (`npm run test:a11y`). First run found 26 distinct issues, fixed: button names missing their visible text, links distinguished by colour alone, scrollable tables not keyboard-reachable, badge contrast in dark mode |
| End-to-end browser walkthrough | **56 checks passed** (twice in a row on one database), no console errors |
| Launches from clean database | yes — migrations applied, fixtures seeded, demo users printed |

## Definition-of-done checklist

| Criterion | Evidence |
|---|---|
| Application launches | `npm start`; e2e logs in and drives it |
| Core pages implemented & persistent | 14 pages; SQLite persistence; durability test re-opens the DB file |
| Priya reconciles | `tests/priya.test.ts`: gross ₹8.63 Cr; expenses ₹2 L / ₹24 L; pension ₹80 L paid, ₹20 L remaining, ₹1 Cr total, ₹5 L receivable; monthly-equivalent ₹41,666.67 |
| Required metrics shown or “Awaiting data” | Overview KPIs; e2e asserts net worth/liabilities show *Awaiting data / Not yet assessed* |
| Nothing invented | tests: no liabilities, snapshots, transactions, bank balances in the Priya fixture; return/XIRR/net-worth-change unavailable |
| Every brief alert implemented | 8 core + 10 additional rules; each core rule tested below/at/above/missing/disabled/changed-threshold/resolved/duplicate-prevention |
| Allocation & rebalancing respond to edits | API test (targets → drift), e2e (threshold → alert resolves), scenario simulator test, illiquid-asset cap test |
| Health score transparent | weights re-normalisation test equals manual weighted mean; custom-weights test; no-data ⇒ null (not 100) |
| Case studies isolated | Case A: ₹10 Cr / ₹5 Cr / ₹5 Cr NW verified; B 50:50, C 70:30; separate clients; reset leaves user clients untouched |
| Forms, tables, charts, navigation work | e2e: add holding (with live classification), add liability, validation errors, alert acknowledge, drawer, all pages render |
| Core calculations tested | `tests/engine.test.ts` (see below) |
| Missing data handled honestly | `not_evaluable` states, `[min,max]` ranges, provisional labels, data notices |
| Responsive & polished | screenshots reviewed at 1440 px light/dark and 390 px; no horizontal scroll on /, /assets, /rules at 390 px |
| Setup instructions | README, `.env.example` |

### Calculations covered by tests
gross totals · aggregate vs underlying (remainder, exceed, archived) · liabilities & net worth (provisional/complete) · commitments & adjusted NW · absolute return (full/partial/missing) ·
XIRR (10 % exact, intermediate flows with NPV≈0, negative, six invalid-input cases, distributions) · allocation denominators · drift (6 pp, exactly-at-limit strict/inclusive) ·
single-stock concentration (direct, aggregate, look-through) · debt-to-NW · EMI-to-income (card exclusion, no double count, unverified income) · savings rate · emergency fund ·
monthly/annual NW change & attribution · maturity windows · forecast placement by actual dates · idle cash (duration from valuation history, reserves) · goals · rebalancing caps · simulation immutability · money formatting/parsing.

## Known gaps / honest caveats
1. **Workbook and reference images were not available**; see `AUDIT.md`. Rules/thresholds beyond the written brief (e.g. 40 % EMI default) are my assumptions and editable.
2. **Market data:** no live provider verified. Demo + manual CSV work; AMFI implemented but unverified; NSE / S&P need licences.
3. **No document attachments**; no tax / exit-load modelling; single-tenant.
4. PDF is produced via the browser’s *Print → Save as PDF* (print stylesheet), not server-side.
5. The JS bundle is ~0.9 MB (single chunk) — acceptable for a demo, not code-split.
6. Accessibility was checked by keyboard flow (dialog focus trap, Escape, labelled controls, table view for every chart) and contrast by design tokens, but no automated axe/Lighthouse audit was run.
