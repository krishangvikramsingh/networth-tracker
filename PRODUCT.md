# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Two audiences of equal weight.
- **Advisors / relationship managers** who prepare for and run client reviews. They move between several clients, need to know what changed and what needs action, and must be able to defend every number to the client.
- **Investors (clients)** who want one honest picture of what they own, owe and are committed to, and who are nudged by alerts and email when something drifts.
Some users read on a phone (the app is an installable PWA); advisors also work at a desk.

## Product Purpose
Wealth Intelligence is a net worth tracker and advisor workbench for Indian households. It turns assets, liabilities, commitments, cash flow, goals and estate details into one evaluated picture: net worth, allocation versus target, financial-health score, rule-based alerts with recommended actions, and exportable reports. Success is a user who can say "I know where I stand, what is missing, and what to do next" without trusting a figure they cannot explain.

## Positioning
Three things together that a neighbouring app (INDmoney, Kuvera, Sharesight and similar) does not do:
1. **Honest about unknowns.** Missing data is shown as "Awaiting data", a `[min, max]` range, or "Not yet assessed", never as zero. A net worth is not calculated until liabilities have been assessed; the gross total is labelled an upper bound.
2. **A transparent rules and alerts engine.** Allocation, concentration, liquidity, cash-flow, estate and other rules are configurable by the advisor; each alert says why it fired and what action follows. Nothing is executed automatically.
3. **India-specific completeness.** Rupee-native (integer paise, lakh/crore formatting), Indian asset classes and instruments, nominee and estate gap checks, AMFI-based fund data, risk-profile questionnaire with model portfolios.

## Operating Context
Advisor-client reviews and self-review at month-end. Data is entered by hand or CSV/Excel import; market data is optional and operator-managed. Alerts reach users in the app and, if opted in, by email (without figures unless the operator enables details). Reports and CSV/Excel exports leave the app. Multiple organisations (tenants) share one deployment; the `default` tenant is the platform operator.

## Capabilities and Constraints
- Money is integer paise throughout; all financial logic lives in one shared engine used by both server and UI.
- Reads never write; every mutation re-evaluates and reconciles alerts.
- Roles: admin (advisor, can edit) and viewer (read-only). Optional TOTP two-factor sign-in, password reset by email.
- Educational positioning: not investment advice, not a credit score. Recommendation wording has not had legal review (possible SEBI RIA implications).
- Open product decisions: LICENSE (not yet chosen), production hosting, licensed market-data provider, whether Account Aggregator or CAS import will be pursued.

## Brand Commitments
Name: "Wealth Intelligence" (subtitle "Net worth tracker"). Built by a student group at NMIMS MPSTME for the Design Experience subject. No other binding brand constraint has been stated.

## Evidence on Hand
All data in the repository is synthetic: one live demo client (Priya Ramanathan) and three illustrative case studies. There are no real customers, testimonials, press, benchmarks or licensed market data, and none may be implied. The original team spreadsheet (`NETWORTH_TRACKER-TEAM_TAZEEN_CONSOLIDATED_SOLVED.xlsx`) and two design reference images have not been supplied to the project.

## Product Principles
- Never present an unknown as a number; show what is missing and how to supply it.
- Every figure and every alert must be explainable in one click.
- The advisor decides; the app recommends and never acts on its own.
- Plain language over finance jargon where both are accurate; keep amount types (market value, invested capital, outstanding principal, commitment) visibly distinct so they are never mixed.
- Treat client financial data as sensitive: least exposure by default, in the UI, in email and in logs.

## Accessibility & Inclusion
Target WCAG 2.1 AA; an automated axe-core audit runs in CI. Keyboard operable throughout, reduced-motion respected, usable at phone width and in light and dark modes. Numbers use tabular figures and Indian digit grouping. Users are expected to read English only at present.
