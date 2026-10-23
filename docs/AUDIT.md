# Phase 1 — Requirements & data-quality audit

## 1. Inputs inspected

| Input | Status |
|---|---|
| `NETWORTH_TRACKER-TEAM_TAZEEN_CONSOLIDATED_SOLVED.xlsx` (Dashboard, Category Allocation, Data Collection, Category Mappings) | **Not present** in the build environment (searched the repository, home directories, `/mnt`). Not inspected. |
| Reference image 1 (alerts & rules) | **Not present.** Requirements taken from §7 of the brief, which lists the eight rules. |
| Reference image 2 (wealth metrics) | **Not present.** Metrics taken from §5 Page 1 and §6 of the brief. |
| Repository | `/claude-code` is an unrelated CLI project; this app was added as a self-contained `networth-tracker/` package. Nothing in the existing project was modified. |

### What this means
* Category mappings were rebuilt from the mapping rules **described in the brief** (stocks/equity MF/SIF/equity-PMS → Equity; FD/bond/debt MF → Debt; gold → Commodities;
  property → Real estate; REIT/InvIT → Listed real assets; AIF → Alternatives; income and expense groupings). Seed rows carry `source = "brief"`.
* Workbook formulas/thresholds that are *not* in the brief (for example any extra alert thresholds, the “Category Allocation” sheet layout, spreadsheet bugs) could not be audited.
* **To close the gap:** open the workbook, compare against the tables below, and either edit mappings in *Data collection → Category mappings* or import its data tables as CSV
  (*Data collection → Import*; headers such as Scheme / Units / NAV date / Folio are recognised).

## 2. Traceability matrix — alerts (brief §7)

| # | Alert | Source data | Formula | Default threshold | Severity | UI location | Tests |
|---|---|---|---|---|---|---|---|
| 1 | Equity allocation | holdings (Indian+global equity) | equity ÷ denominator ×100, as [min,max] when holdings are unclassified | > 60 % | High | Overview alerts · Alerts · Rules | below/at/above, inclusive, changed threshold, disabled, missing, denominator |
| 2 | Single-stock concentration | direct stock holdings (+look-through) | stock ÷ concentration denominator ×100; aggregates excluded | > 10 % | High | Portfolio · Alerts | below/at/above, aggregate ⇒ data gap, look-through, disabled, changed |
| 3 | Debt allocation floor | debt class incl. cash | debt ÷ denominator ×100 | < 20 % | Warning | Alerts · Rules | below/at (strict & inclusive)/above, missing |
| 4 | Net worth falls | snapshots + net worth | (cur − prev) ÷ |prev| ×100, like-for-like snapshots only; attribution | fall > 5 % | Critical | Alerts · Overview KPI | no snapshot, −4.9/−5/−5.1 %, incomparable basis, stale snapshot, new liability, annual window |
| 5 | EMI-to-income | liabilities EMI, verified income | Σ EMI ÷ verified monthly gross income ×100 | > 40 % | High | Alerts · Cases | below/at/above, missing income, unverified income, card excluded, no double count |
| 6 | Allocation drift | targets + actual | actual % − target % (pp) | > 5 pp | Warning | Rules · Portfolio | 4.9/5.0/5.1 pp, tolerance change, no targets |
| 7 | Idle cash | bank/cash holdings, valuations, expenses, commitments | cash − emergency fund − next-90-day outflows vs max(% of investable, floor) for ≥ N days | 10 % / ₹5 L / 30 d | Warning | Alerts · Rules | small, none recorded, long idle, short history, emergency reserve, upcoming obligations |
| 8 | Maturity / renewal | FD/bond/policy dates | days to date ≤ window | 60 d | Warning | Alerts | boundary 60/61 d, overdue, missing date ⇒ data notice, policy renewal, lead-time change |
| + | Credit-card balance, debt-to-NW, negative cash flow, emergency fund, pension premium due, missing valuation, unclassified holdings, stale data, goal shortfall, health-score drop | see `src/shared/rules.ts` | | | | | covered in `tests/engine.test.ts` |

## 3. Traceability matrix — dashboard metrics (brief §5 Page 1, §6)

| Metric | Source | Formula | Location | State for Priya |
|---|---|---|---|---|
| Gross assets | holdings | Σ unique positions | Overview | ₹8.63 Cr ✔ |
| Confirmed liabilities | liabilities | Σ outstanding | Overview | Not yet assessed |
| Net worth | | assets − liabilities | Overview | Awaiting data (upper bound shown) |
| Change in net worth | snapshots | see rule 4 | Overview | Awaiting data |
| Absolute return / invested capital / XIRR | holdings.invested, transactions | §6 B, C | Overview · Portfolio | Awaiting data |
| Monthly income / expenses / surplus | cash-flow items | monthly equivalents | Overview · Cash-flow | ₹41,666.67 / ₹2 L / −₹1.58 L (provisional) |
| Liquid assets | liquidity tiers 1–2 | Σ | Overview | ₹3.33 Cr |
| Emergency-fund coverage | emergency-eligible ÷ essential expenses | months | Overview | 30.0 months |
| Health score | six components | weighted, re-normalised | Overview · Health | provisional, 35 % coverage |

## 4. Data-quality findings on the supplied brief

1. **Mutual funds ₹1.83 Cr** have no equity/debt split ⇒ equity, debt and drift results are ranges until supplied (design decision, surfaced everywhere).
2. **Direct equity ₹1.5 Cr** has no stock list ⇒ single-stock rule cannot run (data notice, not a number).
3. **PMS ₹70 L / AIF ₹1.3 Cr** are products, not asset classes ⇒ held provisionally as Indian equity / Alternatives pending look-through.
4. **Gold form** (physical/ETF/SGB) not stated ⇒ treated as physical (liquidity tier 3); flagged in the holding’s notes.
5. **No valuation dates** for any asset ⇒ “missing valuation date” notice; freshness cannot be judged.
6. **Pension premium schedule** missing ⇒ ₹20 L shown as an *unscheduled commitment*; annual ₹5 L pension receipt has no date ⇒ unscheduled inflow (shown at ₹41,666.67/month for analysis only).
7. **No liabilities, income (beyond pension), bank balances, history** were supplied ⇒ nothing invented; completeness checklist lists each gap.
8. The 50/20/10/10/5/5 allocation is a **sample**, labelled as not validated for Priya.

## 5. Decisions where the brief was ambiguous

| Topic | Decision |
|---|---|
| Cash & bank balances | Counted in “Debt & fixed income” for allocation (cash equivalents), but tracked by instrument type for idle-cash and emergency logic. |
| Default allocation denominator | Investable financial assets (gross − direct property); selectable per client and per rule. |
| EMI threshold | Not in the brief ⇒ 40 % default, editable. |
| Case B/C | Growth = Indian & global equity, REITs/InvITs, alternatives; Defensive = debt, commodities; direct real estate excluded from the split. ₹10 Cr base is illustrative. |
| Percentage precision | Percentages are rounded to 9 decimals before comparison so a value exactly at a limit is not tipped over by binary float noise. |
