# Market-data integration

Architecture: `src/server/market/` — `MarketProvider` interface → `refreshProvider()` (rate-limit, timeout, validation, store, log) → `market_observations` (symbol, value, currency, as-of, fetched-at, source, `is_demo`) → *proposed* holding valuations (quantity × price × FX) that the user confirms.

| Provider | Covers | Status in this build | To make it live |
|---|---|---|---|
| `demo` | NIFTY 500, S&P 500, USD/INR, sample MF/gold/REIT/InvIT/G-Sec | **Working — sample data, labelled “sample”** | n/a |
| `manual` | any symbol | **Working** — CSV `symbol,date,value[,currency,kind]` | n/a |
| `amfi` | all Indian MF NAVs | Implemented against AMFI’s documented `NAVAll.txt`; parser unit-tested; **not verified live** (endpoint unreachable from the build sandbox) | Run with internet access; put AMFI scheme code or ISIN in a holding’s *Symbol* and its *Quantity*; check AMFI terms of use |
| `nse` | NIFTY 500, REITs, InvITs, bonds | Adapter slot; **needs licensed data** | Set `NSE_DATA_API_KEY`; implement the vendor request in `providers.ts` |
| `sp500` | S&P 500 | Adapter slot; **needs licensed data** | Set `SP500_DATA_API_KEY`; implement vendor request |

Behaviour guarantees (tested): validated values only (positive, not future-dated, no >50 % jump vs previous); provider failure keeps the previous valid observation and logs the error;
requests are rate-limited (`MARKET_MIN_INTERVAL_SECONDS`) and cached; every value shows source + as-of + staleness (>5 days); manual valuations are protected from automatic overwrite;
foreign holdings need a USDINR observation, otherwise the proposal is skipped with a reason; user-entered transactions are never modified by a refresh.
No scraping of restricted data is performed.
