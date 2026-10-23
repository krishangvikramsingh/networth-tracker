import { useApp } from "../store";
import { Badge, Banner, Card, Icon, ICONS, PageHead, SevBadge, download, fmtDate } from "../ui";
import { formatCompact, formatINR, formatPct } from "@shared/money";
import { ASSET_CLASS_LABEL } from "@shared/taxonomy";
import { summaryLines } from "@shared/summary";

export function ReportsPage() {
  const { state, clientId } = useApp();
  const s = state!, ev = s.evaluation, d = s.data;
  const alerts = s.alerts.filter((a) => a.status !== "resolved");
  const upcoming = ev.forecast.months.flatMap((m) => m.events).slice(0, 12);
  const tables = ["holdings", "liabilities", "cash-flow", "commitments", "allocation", "alerts", "data-quality"];
  return (
    <>
      <PageHead title="Reports & export" subtitle="Export this client’s data, or print a wealth report to PDF. Reports contain only the selected client." actions={<>
        <button className="btn" onClick={() => download(`/api/clients/${clientId}/export/workbook.xlsx`)}><Icon d={ICONS.download} />Excel workbook</button>
        <button className="btn primary" onClick={() => window.print()}><Icon d={ICONS.file} />Print / save as PDF</button></>} />
      <div className="stack no-print" style={{ marginBottom: 18 }}>
        <Card title="CSV downloads"><div className="row">{tables.map((t) => <button key={t} className="btn sm" onClick={() => download(`/api/clients/${clientId}/export/${t}.csv`)}><Icon d={ICONS.download} size={13} />{t.replace("-", " ")}.csv</button>)}</div>
          <p className="small muted" style={{ marginTop: 8 }}>CSV cells that start with = + - @ are prefixed with an apostrophe so spreadsheets can’t execute them as formulas.</p></Card>
      </div>
      <article className="card" aria-label="Wealth report" style={{ padding: 28 }}>
        <header style={{ borderBottom: "2px solid var(--ink)", paddingBottom: 12, marginBottom: 16 }}>
          <div className="small muted">Wealth report · Net Worth Tracker (educational)</div>
          <h1 style={{ fontSize: 26 }}>{d.client.name}</h1>
          <div className="small sec">Calculation date {fmtDate(ev.asOf)} · generated {new Date(ev.computedAt).toLocaleString("en-IN")} · valuations {ev.portfolio.valuation.oldestDate ? `${fmtDate(ev.portfolio.valuation.oldestDate)} – ${fmtDate(ev.portfolio.valuation.newestDate)}` : "undated"} · all amounts in INR</div>
        </header>
        {d.client.kind === "case" && <Banner>Illustrative case study — not a real client.</Banner>}
        <h2 style={{ margin: "16px 0 8px" }}>1. Summary</h2>
        <dl className="dl">{summaryLines(d, ev).filter((l) => !["Client", "Report generated"].includes(l.label)).map((l) => <><dt key={l.label}>{l.label}</dt><dd>{l.value}</dd></>)}</dl>
        <h2 style={{ margin: "20px 0 8px" }}>2. Asset allocation</h2>
        <p className="small sec">Denominator: {ev.portfolio.denominators[ev.activeDenominator].label} ({formatCompact(ev.portfolio.denominators[ev.activeDenominator].value)}). {d.settings.investmentPolicyValidated ? "" : "Targets shown are a sample policy, not a validated personal policy."}</p>
        <table className="tbl"><thead><tr><th>Class</th><th className="r">Value</th><th className="r">Actual</th><th className="r">Target</th><th className="r">Drift (pp)</th></tr></thead><tbody>{ev.allocation[ev.activeDenominator].filter((r) => r.inDenominator && (r.value || r.targetPct)).map((r) => <tr key={r.assetClass}><td>{ASSET_CLASS_LABEL[r.assetClass]}</td><td className="r num">{formatCompact(r.value)}</td><td className="r num">{r.minPct != null && r.maxPct != null && r.maxPct - r.minPct > 0.05 ? `${r.minPct.toFixed(1)}–${r.maxPct.toFixed(1)}%` : formatPct(r.pct)}</td><td className="r num">{formatPct(r.targetPct)}</td><td className="r num">{r.driftPp == null ? "—" : r.driftPp.toFixed(1)}</td></tr>)}
          {ev.portfolio.unresolved.value > 0 && <tr><td>Unclassified</td><td className="r num">{formatCompact(ev.portfolio.unresolved.value)}</td><td colSpan={3} className="small muted">awaiting underlying scheme / security detail</td></tr>}</tbody></table>
        <h2 style={{ margin: "20px 0 8px" }}>3. Investment performance</h2>
        <dl className="dl"><dt>Investment market value</dt><dd>{formatINR(ev.portfolio.returns.investmentValue)}</dd><dt>Invested capital</dt><dd>{ev.portfolio.returns.investedCapital != null ? formatINR(ev.portfolio.returns.investedCapital) : "Not available"}</dd><dt>Absolute return</dt><dd>{ev.portfolio.returns.absoluteReturn != null ? `${formatINR(ev.portfolio.returns.absoluteReturn)} (${formatPct(ev.portfolio.returns.absoluteReturnPct)})` : "Not available — invested capital not supplied"}</dd><dt>XIRR</dt><dd>{ev.portfolio.xirr.ok ? formatPct(ev.portfolio.xirr.rate * 100, 2) : ev.portfolio.xirr.reason}</dd></dl>
        <h2 style={{ margin: "20px 0 8px" }}>4. Cash flow</h2>
        <dl className="dl"><dt>Monthly inflows (recorded)</dt><dd>{formatINR(ev.cash.monthlyIncome)}</dd><dt>Monthly outflows</dt><dd>{formatINR(ev.cash.monthlyOutflows)} ({formatINR(ev.cash.monthlyOutflows * 12)} / year)</dd><dt>Net monthly</dt><dd>{formatINR(ev.cash.monthlySurplus)}{ev.cash.incomeAssessed ? "" : " (provisional — income incomplete)"}</dd><dt>Savings rate</dt><dd>{ev.cash.savingsRate == null ? "Not available" : formatPct(ev.cash.savingsRate)}</dd></dl>
        <h2 style={{ margin: "20px 0 8px" }}>5. Financial-health score</h2>
        <p>{ev.health.overall == null ? "Not assessable yet." : <><b className="num" style={{ fontSize: 20 }}>{ev.health.overall.toFixed(0)}/100</b> — {ev.health.band}{ev.health.provisional && " (provisional)"}</>}</p><p className="small sec">{ev.health.disclosure}</p>
        <table className="tbl"><tbody>{ev.health.components.map((c) => <tr key={c.key}><td>{c.label}</td><td className="r">{c.weight}%</td><td className="r num">{c.assessed ? c.score!.toFixed(0) : "not assessed"}</td></tr>)}</tbody></table>
        <h2 style={{ margin: "20px 0 8px" }}>6. Alerts ({alerts.length})</h2>
        {alerts.length === 0 ? <p className="muted">None.</p> : <ul style={{ paddingLeft: 18, margin: 0 }}>{alerts.map((a) => <li key={a.id} style={{ marginBottom: 6 }}><SevBadge s={a.severity} /> <b>{a.ruleName}</b> — {a.subject}: {a.currentLabel}{a.kind === "possible" ? " (possible)" : a.kind === "data_gap" ? " (data notice)" : ""}<div className="small sec">{a.why}</div></li>)}</ul>}
        <h2 style={{ margin: "20px 0 8px" }}>7. Upcoming commitments & maturities</h2>
        {ev.netWorth.commitmentsRemaining > 0 && <p className="small">Remaining contractual commitments: <b>{formatINR(ev.netWorth.commitmentsRemaining)}</b> ({formatCompact(ev.forecast.unscheduledCommitments)} without a payment schedule).</p>}
        {upcoming.length === 0 ? <p className="muted small">No dated events in the next 12 months.</p> : <table className="tbl"><tbody>{upcoming.map((e, i) => <tr key={i}><td>{fmtDate(e.date)}</td><td>{e.label}</td><td className="r num">{e.amount == null ? "value unknown" : `${e.kind === "inflow" ? "+" : "−"}${formatCompact(e.amount)}`}</td></tr>)}</tbody></table>}
        <h2 style={{ margin: "20px 0 8px" }}>8. Data quality notices</h2>
        <ul style={{ paddingLeft: 18, margin: 0 }}>{ev.completeness.items.filter((i) => i.status === "pending" || i.status === "needs_review").map((i) => <li key={i.key}>{i.label} — <Badge tone={i.status === "pending" ? "warn" : "serious"}>{i.status.replace("_", " ")}</Badge> {i.detail}</li>)}</ul>
        <h2 style={{ margin: "20px 0 8px" }}>9. Methodology & limitations</h2>
        <p className="small sec">Gross assets = unique positions (aggregates replaced by underlying records, never double counted). Net worth = gross assets − confirmed outstanding liabilities; it is withheld until liabilities are assessed. Future contractual premiums are shown as commitments, not debt. Allocation drift is measured in percentage points on the stated denominator. XIRR uses dated cash flows only. The health score is an educational indicator, not a credit-bureau score. This report is generated from user-supplied data and is not investment, tax or legal advice.</p>
      </article>
    </>
  );
}
