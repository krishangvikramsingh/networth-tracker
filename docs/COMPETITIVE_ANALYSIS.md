# Competitive analysis and improvement ideas

Desk research done on 23 Oct 2026 from public web sources. Most sources are comparison blogs and affiliate-style reviews, so **treat feature and pricing claims as indicative and verify on each vendor's own site before quoting them**. Items marked *(unverified)* were not confirmed by the search results.

## 1. The market in six groups

| Group | Examples | What they do well | Where they stop |
|---|---|---|---|
| Free US aggregators | Empower | Free dashboard linking investment, retirement, cash, credit, loan and mortgage accounts | Advisor sales outreach; US-centred |
| Paid household apps | Monarch | Budgeting (rollover budgets, rules, recurring expenses), couples/household collaboration; roughly $100–200 per year | Weak on complex or alternative assets |
| Complex-balance-sheet trackers | Kubera | Crypto across chains/exchanges/wallets, private holdings, real estate, a "Dead Man's Switch" for estate planning; roughly $150–2,500 per year (sources disagree) | Tracking only; no rules engine or advice workflow |
| India investment trackers | INDmoney, Kuvera, Groww, MFCentral | CAS import (CAMS/KFintech), Account Aggregator, SMS parsing, goals, tax reports | Mostly mutual-fund or broker centred; Groww and Kuvera tracking is strongest for assets bought on the platform |
| Advisor platforms | Addepar, Morningstar Direct, Orion, Black Diamond, Tamarac, Nitrogen (formerly Riskalyze), eMoney, MoneyGuidePro | Multi-custodian aggregation, performance reporting, risk profiling, planning, client portals | Enterprise pricing; complex; US-centred |
| Open source / self-hosted | Ghostfolio, Maybe (fork: Sure), Actual Budget, Firefly III | Privacy, no subscription | Ghostfolio is investments only; Actual Budget and Firefly III do not track portfolios |

## 2. Where this project already differs

- **Explainable, configurable rules** with alerts and history, rather than a static dashboard.
- **"Unknown is not zero":** missing data shows as "Awaiting data" or a range, never a silent zero.
- **Proposals only:** rebalancing is shown as options for review; no trades are executed.
- **Integer-paise money handling** and a pure, tested finance engine (217 tests).
- **India-first taxonomy** (AMFI NAV, INR, EMI-to-income rule) with an advisor/viewer role split enforced on the server.
- Three isolated case studies alongside a live client, which suits teaching and demos.

## 3. Gaps against the market

Ranked by value to an Indian advisor or investor against build effort.

| # | Gap | Seen in | Effort | Notes |
|---|---|---|---|---|
| 1 | **CAS import** (CAMS/KFintech PDF/XLS) -> holdings and transactions | INDmoney, Kuvera, Groww | M | Biggest single time saver; replaces manual entry. Roadmap 1.2 |
| 2 | **Benchmark comparison and TWR** next to XIRR | Addepar, Morningstar | M | NIFTY 500 / S&P 500. Roadmap 2.1 |
| 3 | **Tax awareness** (capital gains by holding period, exit loads, tax-aware rebalancing) | Kuvera | M-L | Roadmap 2.1 |
| 4 | **Account Aggregator** consented data | INDmoney | L | Needs FIU/TSP partner and compliance. Roadmap Phase 3 |
| 5 | **Household/family grouping and nominee view** | Monarch (couples), Kubera (estate) | M | A nominee/"what happens if I am unavailable" page is a good India-relevant answer to Kubera's Dead Man's Switch |
| 6 | **Notifications** (email/SMS/push) driven by alerts | Most apps | M | Alerts exist in-app only today |
| 7 | **Advisor console** (many clients, search, task queue) | Addepar, Orion, eMoney | L | Roadmap 2.2 |
| 8 | **Alternative assets** (gold, real estate, crypto, PMS/AIF look-through) | Kubera | M | Partly present via look-through; add crypto and property valuation history |
| 9 | **Goal projections with Monte Carlo**, labelled as scenarios | eMoney, MoneyGuidePro, Maybe | M | Roadmap Phase 3 |
| 10 | **Mobile/PWA** | Monarch, INDmoney | M | Layout already works at mobile width; add installable PWA |
| 11 | **Client-facing PDF reports**, white-label | Addepar, Orion | M | Roadmap 2.2 |
| 12 | **Risk profiling questionnaire** feeding the target allocation | Nitrogen | S-M | Simple scored questionnaire mapped to model portfolios |

## 4. Status of the quick wins (23 Oct 2026)

Done: risk-profile questionnaire (12), PWA install and offline shell (10), nominee page (5), email alerts (6). See the README "Features added" table. Not yet verified on real iPhone/Android hardware or against a live SMTP server.

## 5. Recommended order

1. **Quick wins:** risk questionnaire (12), PWA install (10), nominee page (5), email alerts (6).
2. **Core value:** CAS import (1), then benchmark/TWR (2), then tax-aware rebalancing (3).
3. **Platform:** make `GET` read-only, DB-backed throttle/idempotency, tenant isolation, CI (roadmap 0.2-0.4). These unlock the advisor console (7) and any real data.
4. **Later:** Account Aggregator (4), Monte Carlo (9), white-label PDFs (11).

## 6. Positioning suggestion

Do not compete with INDmoney on breadth of connectors. Position as **the explainable advisor workbench**: every number traceable to a rule, no hidden assumptions, and recommendations that a human reviews. That is the one area the consumer apps and the enterprise platforms both under-serve.

## 7. Sources

- [8 Best Net Worth Trackers in 2026](https://www.mexc.com/news/1018291)
- [Best Net Worth Tracker Apps: 7 Options Compared for 2026](https://www.knowyourdosh.com/blog/best-net-worth-trackers/)
- [Kubera vs. Empower [2026]](https://financebuzz.com/kubera-vs-personal-capital)
- [Monarch vs. Empower](https://marriagekidsandmoney.com/empower-vs-monarch/)
- [Best Portfolio Tracker Apps / Money Management Apps in India 2026](https://www.soleblogger.com/best-portfolio-tracking-apps-in-india/)
- [Best Mutual Fund Apps in India 2026](https://wibest.in/finance/best-mutual-fund-app/)
- [Best Free Portfolio Tracker for India 2026](https://agnifolio.com/blog/best-free-portfolio-tracker-india-2026)
- [Addepar competitors (Kubera)](https://kubera.com/blog/addepar-competitors)
- [Addepar alternatives (G2)](https://www.g2.com/products/addepar/competitors/alternatives)
- [Top 10 Best Advisor Financial Software of 2026](https://gitnux.org/best/advisor-financial-software/)
- [Firefly III alternatives (Beancount)](https://beancount.io/compare/firefly-iii-alternatives)
- [Firefly III alternatives (OpenAlternative)](https://openalternative.co/alternatives/firefly-iii)
