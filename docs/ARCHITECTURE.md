# Architecture

## Layers
```mermaid
flowchart LR
  subgraph Browser
    UI[React pages / charts / forms]
  end
  subgraph Server[Node 22 · Express]
    API[HTTP API + auth + CSRF guard]
    SVC[service.ts - validated mutations, audit, tx]
    ALR[alerts.ts - persistent alert history]
    MKT[market adapters]
    IO[import / export]
  end
  subgraph Shared[src/shared - pure TypeScript]
    ENG[evaluate.ts]
    CALC[money · classify · portfolio · xirr · cashflow · networth · rules · score · rebalance · goals]
  end
  DB[(SQLite via node:sqlite\nmigrations/*.sql)]
  UI -->|JSON| API --> SVC --> DB
  SVC --> ENG --> CALC
  UI -. imports types + simulation .-> Shared
  SVC --> ALR --> DB
  API --> MKT --> DB
  API --> IO
```
Financial logic lives **only** in `src/shared`. The server evaluates after every mutation and persists alert history; the UI renders the server’s evaluation
(and uses the same module for local formatting/what-if types). Scenario simulation runs on a *copy* of the data on the server.

## Data flow (a single edit)
```mermaid
sequenceDiagram
  participant U as User
  participant A as API
  participant V as zod schemas
  participant R as repo (tx)
  participant E as evaluateClient
  participant H as alert history
  U->>A: PATCH /holdings/:id
  A->>V: validate (422 with field errors)
  A->>R: classify, update row, valuation row, audit event (one transaction)
  A->>E: evaluate whole client (no cached totals)
  E-->>A: metrics, rules, score, plan
  A->>H: start / change / resolve alerts
  A-->>U: 200
  U->>A: GET /state  → data + evaluation + alerts
```

## ER diagram
```mermaid
erDiagram
  clients ||--|| client_settings : has
  clients ||--o{ holdings : owns
  holdings ||--o{ holdings : "underlying of"
  holdings ||--o{ valuations : "dated values"
  holdings ||--o{ transactions : cash-flows
  clients ||--o{ liabilities : owes
  clients ||--o{ cashflow_items : plans
  clients ||--o{ commitments : "contractual"
  clients ||--o{ insurance_policies : insured
  clients ||--o{ goals : targets
  clients ||--o{ snapshots : "net-worth history"
  clients ||--o{ allocation_targets : policy
  clients ||--o{ rules : thresholds
  clients ||--o{ alerts : raised
  alerts ||--o{ alert_events : history
  clients ||--o{ health_assessments : "score history"
  clients ||--o{ scenarios : "saved what-ifs"
  clients ||--o{ audit_events : trail
  clients ||--o{ import_log : "duplicate-import guard"
  users ||--o{ sessions : has
  instruments ||--o{ market_observations : priced
  category_mappings }o--o| clients : "global or per client"
```

## Key design points
* **Money = integer paise.** Exact sums; ratios derived only for display/thresholds.
* **Aggregate vs underlying:** `parent_id` self-reference; the engine replaces an aggregate by its children and keeps an *unallocated remainder*, so nothing is double counted.
* **Unknown ≠ zero:** unresolved classifications produce `[min,max]` bounds; rules return `triggered | possible | not_evaluable | ok | disabled`.
* **Alert history:** unique partial index `(client_id, fingerprint) WHERE status != 'resolved'` makes duplicate live alerts impossible at the database level.
* **Demo isolation:** fixtures flagged `is_demo`; reset only deletes/re-inserts fixture clients (Priya + 3 cases).
* **Transactions:** every multi-row change (`tx()`), import and reset is atomic.
