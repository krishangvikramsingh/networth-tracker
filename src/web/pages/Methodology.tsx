import { Badge, Card, PageHead } from "../ui";
import { RULE_DEFS } from "@shared/rules";

const INTEG: Array<[string, string, string]> = [
  ["Demo sample data", "Working — deterministic values labelled “sample”", "Demo"],
  ["Manual CSV upload (any symbol)", "Working — validated and timestamped", "Live (user-supplied)"],
  ["AMFI mutual-fund NAVs", "Implemented against the documented public NAVAll file; parser unit-tested; endpoint not reachable from the build sandbox", "Not verified live"],
  ["NSE (NIFTY 500, REITs, InvITs, bonds)", "Adapter slot only — licensed data; set NSE_DATA_API_KEY and implement vendor call", "Needs credentials"],
  ["S&P 500", "Adapter slot only — vendor licence required; set SP500_DATA_API_KEY", "Needs credentials"],
];

export function MethodologyPage() {
  return (
    <>
      <PageHead title="Methodology" subtitle="How every number is calculated, what is assumed, and what this tool deliberately does not claim." />
      <div className="stack" style={{ maxWidth: 980 }}>
        <Card title="Core definitions">
          <dl className="dl">
            <dt>Money</dt><dd>Stored as integer paise (exact arithmetic); shown in Indian grouping with ₹, lakh and crore.</dd>
            <dt>Gross assets</dt><dd>Σ current value of unique positions. An aggregate holding is replaced by its underlying schemes/securities; any unexplained difference stays as one “unallocated remainder”. If underlying positions exceed the aggregate you must confirm the new total.</dd>
            <dt>Net worth</dt><dd>Gross assets − confirmed outstanding liabilities. Withheld while liabilities are “not assessed”; marked provisional while “partial”. Future contractual premiums are <i>commitments</i>, reported separately and in an “adjusted” view — they are not debts.</dd>
            <dt>Absolute return</dt><dd>Current value − invested capital, % of capital, on holdings with cost recorded (coverage disclosed). Not time-weighted; ignores timing of flows, fees and distributions.</dd>
            <dt>XIRR</dt><dd>Solves Σ CFᵢ ÷ (1+r)^((dᵢ−d₀)/365) = 0 over dated purchases/contributions (outflows), withdrawals/distributions (inflows) and today’s valuation. Without dated flows: “Insufficient cash-flow history”.</dd>
            <dt>Allocation %</dt><dd>Class value ÷ chosen denominator (gross · investable excl. direct property · investments excl. property & cash). The denominator is always displayed.</dd>
            <dt>Drift</dt><dd>Actual % − target %, in percentage points. 56% vs 50% = +6 pp. Strict “&gt;” by default.</dd>
            <dt>Unclassified holdings</dt><dd>Results become [min, max] ranges. A rule is “triggered” only if even the best case breaches it; otherwise “possible”.</dd>
            <dt>Savings rate</dt><dd>(Income − spending) ÷ income, where categories you mark as saving (default: investment contributions, pension premiums) are excluded from spending.</dd>
            <dt>EMI-to-income</dt><dd>Σ monthly loan EMIs ÷ verified monthly gross income. Credit-card balances are liabilities, not EMIs.</dd>
            <dt>Emergency fund</dt><dd>Eligible liquid reserves (cash, bank, FDs, liquid/debt funds you flag) ÷ monthly essential expenses. Property, AIF, unlisted equity and sum assured are never eligible.</dd>
            <dt>Cash-flow forecast</dt><dd>Occurrences are generated from actual dates (EMIs, premiums, maturities, receipts). Undated non-monthly items are listed as unscheduled, not spread evenly.</dd>
          </dl>
        </Card>
        <Card title="Classification engine">
          <p>Order: <b>your override → exact name → unambiguous instrument type → keyword → provisional instrument default → review queue.</b> Every record keeps its original description, result, method and status. AIFs and PMS are vehicles, not asset classes: they are held provisionally (Alternatives / Indian equity) until look-through exposures are entered.</p>
        </Card>
        <Card title="Rule catalogue" pad={false}><div className="tbl-wrap card-b"><table className="tbl"><thead><tr><th>Rule</th><th>Default</th><th>Calculation</th><th>Trigger</th></tr></thead><tbody>
          {RULE_DEFS.map((r) => <tr key={r.key}><td><b>{r.name}</b><div className="small muted">{r.group}</div></td><td className="nowrap num">{r.defaults.unit === "₹" ? "₹" + (r.defaults.value / 100).toLocaleString("en-IN") : `${r.defaults.value} ${r.defaults.unit}`}<div className="small muted">{r.defaults.severity}</div></td><td className="small">{r.calc}</td><td className="small">{r.trigger}</td></tr>)}</tbody></table></div></Card>
        <Card title="Financial-health score">
          <p>Six components, each 0–100 by documented piecewise-linear rules, combined with editable weights (default 20/20/20/15/15/10). Components lacking data are <b>unassessed</b>: excluded and the remaining weights re-normalised, never scored as perfect or zero; the result is labelled provisional with the share of weight assessed. Educational only — not a credit-bureau rating.</p>
        </Card>
        <Card title="Market-data integrations — honest status"><table className="tbl"><tbody>{INTEG.map(([a, b, c]) => <tr key={a}><td><b>{a}</b></td><td className="small">{b}</td><td><Badge tone={c === "Demo" ? "warn" : c.startsWith("Live") ? "good" : c === "Not verified live" ? "info" : "serious"}>{c}</Badge></td></tr>)}</tbody></table></Card>
        <Card title="Spreadsheet tracker vs financial-intelligence application">
          <table className="tbl"><thead><tr><th></th><th>Spreadsheet</th><th>This application</th></tr></thead><tbody>
            <tr><td>Data integrity</td><td>Free-form cells; silent errors</td><td>Typed records, validation, audit trail, duplicate-import blocking</td></tr>
            <tr><td>Missing data</td><td>Blank = 0</td><td>“Awaiting data”, ranges, provisional labels</td></tr>
            <tr><td>Rules</td><td>Static formulas, manual checking</td><td>Configurable rules with persisted alert history and explanations</td></tr>
            <tr><td>Classification</td><td>Manual lookup tabs</td><td>Deterministic engine + review queue + logged overrides</td></tr>
            <tr><td>What-if</td><td>Copy the file</td><td>Scenario simulator that recomputes every metric</td></tr>
            <tr><td>Access control</td><td>File sharing</td><td>Authenticated roles, server-side authorisation</td></tr></tbody></table>
        </Card>
        <Card title="Limitations">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>The Excel workbook and the two reference images named in the brief were <b>not available</b> when this was built. Requirements were taken from the written brief; see docs/AUDIT.md for the traceability matrix and what to re-check against the originals.</li>
            <li>Single-tenant demo: every signed-in user can open every client; roles are admin (read/write) and viewer (read-only).</li>
            <li>No document attachments, no bank-feed or broker integration, no tax/exit-load modelling, no multi-currency holdings beyond a USD/INR observation.</li>
            <li>Not investment, tax or legal advice. Synthetic data only.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
