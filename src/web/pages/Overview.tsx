import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { Badge, Banner, Card, DataTable, Empty, Icon, ICONS, Kpi, Modal, PageHead, SevBadge, Segmented, classColor, classLabel, fmtDate } from "../ui";
import { BarsChart, ChartCard, Donut, Meter, SimpleBars, TrendChart } from "../charts";
import { formatCompact, formatINR, formatPct, pct } from "@shared/money";
import { ASSET_CLASSES, type AssetClass, type Denominator } from "@shared/taxonomy";
import { monthLabel } from "@shared/dates";
import { AddButton, ClassBadge, useSnapshot } from "./common";
import { EntityForm } from "../forms";

type KpiKey = "gross" | "liab" | "nw" | "change" | "ret" | "xirr" | "invested" | "inc" | "exp" | "cf" | "liquid" | "emerg" | "health" | null;
const SEV_ORDER = { critical: 0, high: 1, warning: 2, info: 3 } as const;

export function Overview() {
  const { state, clientId } = useApp();
  const nav = useNavigate();
  const snap = useSnapshot();
  const [open, setOpen] = useState<KpiKey>(null);
  const [den, setDen] = useState<Denominator>("gross");
  const [adding, setAdding] = useState<null | "transactions">(null);
  const s = state!, ev = s.evaluation, d = s.data, nw = ev.netWorth, cash = ev.cash, pf = ev.portfolio;

  const alerts = s.alerts.filter((a) => a.status !== "resolved");
  const real = alerts.filter((a) => a.kind !== "data_gap").sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const gaps = alerts.filter((a) => a.kind === "data_gap");

  // allocation donut ---------------------------------------------------------------------------
  const donut = useMemo(() => {
    const rows = ASSET_CLASSES.filter((c) => !(den !== "gross" && c === "real_estate")).map((c) => ({ name: classLabel(c), value: pf.buckets[c].value, color: classColor(c) })).filter((r) => r.value > 0);
    const un = pf.unresolved.value;
    if (un > 0) rows.push({ name: "Unclassified", value: un, color: classColor("unclassified") });
    return rows;
  }, [pf, den]);
  const denVal = pf.denominators[den].value;

  // exposure range chart -------------------------------------------------------------------------
  const exposure = ASSET_CLASSES.map((c) => ({ name: classLabel(c), classified: pf.buckets[c].value, possible: pf.buckets[c].max - pf.buckets[c].min })).filter((r) => r.classified > 0 || r.possible > 0);

  // net worth trend ---------------------------------------------------------------------------
  const trend = d.snapshots.map((x) => ({ label: monthLabel(x.date.slice(0, 7)), assets: x.grossAssets, nw: x.netWorth }));
  const hasTrend = trend.length >= 1;

  const alloc = ev.allocation[ev.activeDenominator].filter((r) => r.inDenominator && (r.targetPct != null || (r.pct ?? 0) > 0));
  const incomeMonthly = [{ name: "Income", value: cash.monthlyIncome, color: "var(--s3)" }, { name: "Outflows", value: cash.monthlyOutflows, color: "var(--s2)" }, { name: "Net", value: cash.monthlySurplus, color: "var(--s1)" }];
  const commitments = d.commitments.filter((c) => !c.archived);
  const recentTx = [...d.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  const awaitingNW = nw.netWorth == null;
  return (
    <>
      <PageHead title={`Wealth overview — ${d.client.name}`} subtitle={d.settings.profileNote ?? "Live view of assets, liabilities, cash flow and rule status. Missing information is shown as “Awaiting data” — never as zero."}
        actions={<><button className="btn" onClick={snap} disabled={!useApp().canWrite}><Icon d={ICONS.cal} />Record snapshot</button></>} />

      {(nw.liabilitiesStatus !== "complete" || ev.completeness.percent < 100) && d.client.kind === "live" && (
        <div style={{ marginBottom: 16 }}><Banner tone="warn" title={`Data completeness ${ev.completeness.percent.toFixed(0)}%.`}>
          {nw.liabilitiesStatus === "not_assessed" ? "Liabilities have not been assessed, so net worth is not calculated — the gross asset total is an upper bound. " : nw.liabilitiesStatus === "partial" ? "Liabilities are only partly recorded, so net worth is provisional. " : ""}
          <Link to="/data">Review what is still needed →</Link></Banner></div>)}

      <div className="stack">
        <div className="section-title">Wealth</div>
        <div className="grid g4">
          <Kpi label="Gross assets" value={formatCompact(nw.grossAssets)} sub={`${pf.lines.length} positions · ${formatINR(nw.grossAssets)}`} onClick={() => setOpen("gross")} />
          <Kpi label="Confirmed liabilities" await={nw.liabilitiesStatus === "not_assessed"} value={formatCompact(nw.liabilities)} sub={nw.liabilitiesStatus === "not_assessed" ? "Not yet assessed — not zero" : nw.liabilitiesStatus === "partial" ? "Partly recorded" : "All recorded"}
            badge={nw.liabilitiesStatus !== "complete" ? <Badge tone="warn">{nw.liabilitiesStatus === "partial" ? "partial" : "pending"}</Badge> : undefined} onClick={() => setOpen("liab")} />
          <Kpi label="Calculated net worth" await={awaitingNW} value={nw.netWorth != null ? formatCompact(nw.netWorth) : undefined}
            sub={awaitingNW ? `Upper bound ${formatCompact(nw.upperBound)} before liabilities` : nw.provisional ? "Provisional — liabilities incomplete" : "Assets − liabilities"} badge={nw.provisional && !awaitingNW ? <Badge tone="warn">provisional</Badge> : undefined} onClick={() => setOpen("nw")} />
          <Kpi label="Change in net worth (1 month)" await={!nw.changeMonth.comparable} value={nw.changeMonth.percent != null ? `${nw.changeMonth.percent >= 0 ? "+" : ""}${nw.changeMonth.percent.toFixed(2)}%` : undefined}
            tone={nw.changeMonth.percent != null ? (nw.changeMonth.percent >= 0 ? "good" : "crit") : ""} sub={nw.changeMonth.comparable ? `${formatCompact(nw.changeMonth.absolute)} since ${fmtDate(nw.changeMonth.previous!.date)}` : nw.changeMonth.reason} onClick={() => setOpen("change")} />
        </div>
        <div className="grid g4">
          <Kpi label="Remaining commitments" value={formatCompact(nw.commitmentsRemaining)} sub={nw.adjustedNetWorth != null ? `Adjusted net worth ${formatCompact(nw.adjustedNetWorth)}` : "Shown separately — not deducted from net worth"} />
          <Kpi label="Liquid assets" value={formatCompact(pf.liquidAssets)} sub={`${formatPct(pct(pf.liquidAssets, nw.grossAssets))} of gross · tiers 1–2`} onClick={() => setOpen("liquid")} />
          <Kpi label="Emergency-fund coverage" await={ev.emergencyCoverageMonths == null} value={ev.emergencyCoverageMonths != null ? `${ev.emergencyCoverageMonths.toFixed(1)} months` : undefined} sub={`Target ${d.settings.emergencyMonthsTarget} months · reserves ${formatCompact(pf.emergencyReserves)}`} onClick={() => setOpen("emerg")} />
          <Kpi label="Financial-health score" await={ev.health.overall == null} value={ev.health.overall != null ? `${ev.health.overall.toFixed(0)} / 100` : undefined} sub={ev.health.overall != null ? `${ev.health.band} · ${ev.health.provisional ? "provisional · " : ""}${(ev.health.coverage * 100).toFixed(0)}% of weight assessed` : "No component can be assessed yet"} badge={ev.health.provisional ? <Badge tone="warn">provisional</Badge> : undefined} onClick={() => nav("/health")} />
        </div>
        <div className="section-title">Investments</div>
        <div className="grid g4">
          <Kpi label="Total invested capital" await={pf.returns.investedCapital == null && pf.returns.coveredInvested == null} value={formatCompact(pf.returns.investedCapital ?? pf.returns.coveredInvested)}
            sub={pf.returns.investedCapital == null && pf.returns.coveredInvested != null ? `Partial (${formatPct(pf.returns.coveragePct, 0)} of value)` : "Invested capital not supplied"} onClick={() => setOpen("invested")} />
          <Kpi label="Investment market value" value={formatCompact(pf.returns.investmentValue)} sub="Excludes property, cash and pension products" />
          <Kpi label="Absolute return" await={pf.returns.absoluteReturn == null} value={pf.returns.absoluteReturn != null ? `${formatCompact(pf.returns.absoluteReturn)} (${formatPct(pf.returns.absoluteReturnPct)})` : undefined} tone={pf.returns.absoluteReturn != null ? (pf.returns.absoluteReturn >= 0 ? "good" : "crit") : ""}
            sub={pf.returns.absoluteReturn == null ? "Needs invested capital per holding" : pf.returns.note.startsWith("Partial") ? pf.returns.note : "Simple value − cost; not time-weighted"} onClick={() => setOpen("ret")} />
          <Kpi label="XIRR" await={!pf.xirr.ok} value={pf.xirr.ok ? formatPct(pf.xirr.rate * 100, 2) : undefined} sub={pf.xirr.ok ? `${pf.xirr.flowCount} dated cash flows` : !pf.xirr.ok ? pf.xirr.reason : ""} onClick={() => setOpen("xirr")} />
        </div>
        <div className="section-title">Cash flow (monthly equivalents)</div>
        <div className="grid g3">
          <Kpi label="Monthly income" await={!cash.hasIncome} value={formatCompact(cash.monthlyIncome)} sub={cash.incomeAssessed ? "All income recorded" : "Partial — only items supplied so far"} badge={cash.hasIncome && !cash.incomeAssessed ? <Badge tone="warn">partial</Badge> : undefined} onClick={() => setOpen("inc")} />
          <Kpi label="Monthly expenses" await={cash.monthlyOutflows === 0} value={formatCompact(cash.monthlyOutflows)} sub={`${formatCompact(cash.monthlyOutflows * 12)} per year`} onClick={() => setOpen("exp")} />
          <Kpi label="Monthly cash-flow surplus / deficit" await={!cash.hasIncome && cash.monthlyOutflows === 0} value={formatCompact(cash.monthlySurplus)} tone={cash.monthlySurplus < 0 ? "crit" : "good"}
            sub={cash.savingsRate != null ? `Savings rate ${formatPct(cash.savingsRate)}${cash.incomeAssessed ? "" : " · provisional"}` : "Savings rate needs complete income"} badge={!cash.incomeAssessed ? <Badge tone="warn">provisional</Badge> : undefined} onClick={() => setOpen("cf")} />
        </div>

        <div className="grid g2">
          <ChartCard title="Net-worth trend" subtitle="From recorded month-end snapshots only — no estimated history." height={250}
            empty={!hasTrend ? <Empty title="No history yet" action={<button className="btn primary" onClick={snap}><Icon d={ICONS.cal} />Record today's snapshot</button>}>Historical net worth is never fabricated. Record a snapshot each month-end (or enter earlier ones from the Data collection page) to build the trend.</Empty> : undefined}
            table={{ headers: ["Month", "Gross assets", "Net worth"], rows: trend.map((t) => [t.label, formatCompact(t.assets), t.nw == null ? "n/a" : formatCompact(t.nw)]) }}>
            <TrendChart data={trend} area series={[{ key: "assets", label: "Gross assets", color: "var(--s1)" }, { key: "nw", label: "Net worth", color: "var(--s3)" }]} />
          </ChartCard>
          <ChartCard title="Asset allocation" subtitle={`Denominator: ${pf.denominators[den].label} (${formatCompact(denVal)})`} height={250}
            actions={<Segmented label="Allocation denominator" value={den} onChange={setDen} options={[{ id: "gross", label: "Gross" }, { id: "investable", label: "Investable" }, { id: "investments_ex_property", label: "Ex-property & cash" }]} />}
            table={{ headers: ["Class", "Value", "Share"], rows: donut.map((r) => [r.name, formatCompact(r.value), formatPct(pct(r.value, donut.reduce((a, b) => a + b.value, 0)))]) }}
            empty={donut.length === 0 ? <Empty title="No assets recorded">Add holdings from Assets & liabilities.</Empty> : undefined}>
            <Donut data={donut} center={<div><div className="small muted">Total</div><b className="num" style={{ fontSize: 17 }}>{formatCompact(donut.reduce((a, b) => a + b.value, 0))}</b></div>} />
          </ChartCard>
        </div>

        <div className="grid g2">
          <ChartCard title="Exposure by asset class" subtitle="Solid = classified. Grey = could land here once unclassified holdings are resolved." height={260}
            table={{ headers: ["Class", "Classified", "Possible extra"], rows: exposure.map((e) => [e.name, formatCompact(e.classified), e.possible ? formatCompact(e.possible) : "—"]) }}>
            <BarsChart data={exposure} layout="horizontal" stack series={[{ key: "classified", label: "Classified", color: "var(--s1)" }, { key: "possible", label: "Possible (unclassified)", color: "var(--c-unclassified)" }]} />
          </ChartCard>
          <ChartCard title="Allocation vs target" subtitle={`${ev.rebalance.denominatorValue ? "Denominator: " + pf.denominators[ev.activeDenominator].label : ""}${d.settings.investmentPolicyValidated ? "" : " · sample policy, not validated"}`} height={260}
            empty={alloc.length === 0 ? <Empty title="No target allocation set" action={<Link className="btn" to="/rules">Set targets</Link>} /> : undefined}
            table={{ headers: ["Class", "Actual %", "Target %", "Drift (pp)"], rows: alloc.map((r) => [classLabel(r.assetClass), formatPct(r.pct), r.targetPct != null ? formatPct(r.targetPct) : "—", r.driftPp != null ? r.driftPp.toFixed(1) : "—"]) }}>
            <BarsChart data={alloc.map((r) => ({ name: classLabel(r.assetClass).replace(" & fixed income", "").replace("Alternative assets", "Alternatives"), actual: r.pct ?? 0, target: r.targetPct ?? 0 }))} series={[{ key: "actual", label: "Actual %", color: "var(--s1)" }, { key: "target", label: "Target %", color: "var(--s4)" }]} fmt={(v) => `${v.toFixed(1)}%`} yFmt={(v) => `${v}%`} />
          </ChartCard>
        </div>

        <div className="grid g3">
          <ChartCard title="Assets vs liabilities" height={220} subtitle={awaitingNW ? "Liabilities not yet assessed" : undefined}
            table={{ headers: ["Item", "Amount"], rows: [["Gross assets", formatCompact(nw.grossAssets)], ["Liabilities", nw.liabilitiesStatus === "not_assessed" ? "not assessed" : formatCompact(nw.liabilities)], ["Remaining commitments", formatCompact(nw.commitmentsRemaining)]] }}>
            <SimpleBars data={[{ name: "Assets", value: nw.grossAssets, color: "var(--s1)" }, ...(nw.liabilitiesStatus !== "not_assessed" ? [{ name: "Liabilities", value: nw.liabilities, color: "var(--s2)" }] : []), { name: "Commitments", value: nw.commitmentsRemaining, color: "var(--s4)" }]} />
          </ChartCard>
          <ChartCard title="Income vs expenses" subtitle="Monthly equivalents of recorded items" height={220} table={{ headers: ["", "Per month"], rows: incomeMonthly.map((r) => [r.name, formatCompact(r.value)]) }}>
            <SimpleBars data={incomeMonthly} />
          </ChartCard>
          <ChartCard title="12-month cash flow (dated)" subtitle={ev.forecast.unscheduled.length ? `${ev.forecast.unscheduled.length} undated item(s) excluded` : "From scheduled dates"} height={220}
            table={{ headers: ["Month", "Inflow", "Outflow", "Net"], rows: ev.forecast.months.map((m) => [m.label, formatCompact(m.inflow), formatCompact(m.outflow), formatCompact(m.net)]) }}>
            <BarsChart data={ev.forecast.months.map((m) => ({ name: m.label.slice(0, 3), inflow: m.inflow, outflow: m.outflow }))} series={[{ key: "inflow", label: "Inflow", color: "var(--s3)" }, { key: "outflow", label: "Outflow", color: "var(--s2)" }]} />
          </ChartCard>
        </div>

        <div className="grid g3">
          <Card title="Pension commitment" subtitle="Contractual premium — not a loan">
            {commitments.length === 0 ? <Empty title="No commitments recorded" /> : commitments.map((c) => (
              <div key={c.id} className="stack" style={{ gap: 8 }}>
                <div className="row between"><b>{c.name}</b><Badge tone={c.nextDueDate ? "good" : "warn"}>{c.nextDueDate ? `next ${fmtDate(c.nextDueDate)}` : "schedule pending"}</Badge></div>
                <Meter label={`Paid ${formatCompact(c.paidAmount)} of ${formatCompact(c.totalAmount)}`} parts={[{ value: c.paidAmount, color: "var(--s3)", label: "Paid" }, { value: c.totalAmount - c.paidAmount, color: "var(--s4)", label: "Remaining" }]} />
                <div className="row between small"><span><b className="num">{formatCompact(c.paidAmount)}</b> paid ({formatPct(pct(c.paidAmount, c.totalAmount), 0)})</span><span><b className="num">{formatCompact(c.totalAmount - c.paidAmount)}</b> remaining</span></div>
                {c.annualReceivable ? <div className="small muted">Annual pension receivable {formatCompact(c.annualReceivable)} (≈ {formatINR(Math.round(c.annualReceivable / 12))}/month for analysis only).</div> : null}
              </div>))}
          </Card>
          <Card title="Goal progress" actions={<Link className="small" to="/goals">Manage</Link>}>
            {ev.goals.length === 0 ? <Empty title="No goals yet" action={<Link className="btn" to="/goals">Create a goal</Link>}>Add retirement, property or education goals to track funding gaps.</Empty>
              : <div className="stack" style={{ gap: 12 }}>{ev.goals.map((g) => (<div key={g.goal.id}><div className="row between small"><b>{g.goal.name}</b><span className="num">{formatPct(g.progressPct, 0)}</span></div>
                <Meter label={`${g.goal.name} ${formatPct(g.progressPct, 0)}`} parts={[{ value: g.goal.earmarkedAmount, color: "var(--s1)", label: "Earmarked" }, { value: g.gap, color: "var(--surface-2)", label: "Gap" }]} /><div className="small muted">{formatCompact(g.goal.earmarkedAmount)} of {formatCompact(g.goal.targetAmount)} · {g.onTrack ? "on track" : `gap ${formatCompact(g.projectedGap)}`}</div></div>))}</div>}
          </Card>
          <Card title="Data completeness" actions={<Link className="small" to="/data">Open</Link>}>
            <div className="row between"><b style={{ fontSize: 24 }} className="num">{ev.completeness.percent.toFixed(0)}%</b><span className="small muted">{ev.completeness.items.filter((i) => i.status === "collected").length} of {ev.completeness.items.filter((i) => i.status !== "not_applicable").length} items collected</span></div>
            <div style={{ margin: "8px 0 12px" }}><Meter label="Completeness" parts={[{ value: ev.completeness.percent, color: "var(--s3)", label: "done" }, { value: 100 - ev.completeness.percent, color: "var(--surface-2)", label: "left" }]} /></div>
            <ul style={{ margin: 0, paddingLeft: 18 }} className="small">{ev.completeness.items.filter((i) => i.status === "pending" || i.status === "needs_review").slice(0, 5).map((i) => <li key={i.key}>{i.label} <Badge tone={i.status === "pending" ? "warn" : "serious"}>{i.status === "pending" ? "pending" : "review"}</Badge></li>)}</ul>
          </Card>
        </div>

        <div className="grid g-main">
          <Card title="Alerts & recommended actions" actions={<Link className="small" to="/alerts">All alerts ({alerts.length})</Link>} pad={false}>
            {real.length === 0 ? <div className="card-b"><Empty title="No rule breaches right now">{gaps.length ? `${gaps.length} data notice(s) need information before some rules can run.` : "All evaluable rules are within limits."}</Empty></div>
              : real.slice(0, 6).map((a) => (
                <button key={a.id} className="alert-row" onClick={() => nav(`/alerts?open=${a.id}`)}>
                  <span className={`sev ${a.severity}`} />
                  <span><b>{a.ruleName}</b> <span className="muted">· {a.subject}</span>{a.kind === "possible" && <> <Badge tone="warn">possible</Badge></>}<div className="small sec">{a.why}</div><div className="small" style={{ marginTop: 3 }}><b>Action:</b> {a.action}</div></span>
                  <span className="right"><SevBadge s={a.severity} /><div className="small muted num" style={{ marginTop: 4 }}>{a.currentLabel}</div></span>
                </button>))}
            {gaps.length > 0 && <div className="card-b small muted">+ {gaps.length} data notice{gaps.length > 1 ? "s" : ""} (rules that cannot run until information is supplied) — <Link to="/alerts?tab=data">view</Link></div>}
          </Card>
          <Card title="Recent transactions" actions={<AddButton onClick={() => setAdding("transactions")}>Record</AddButton>}>
            {recentTx.length === 0 ? <Empty title="No transactions recorded">Dated purchases, contributions, withdrawals and distributions power XIRR and the net-worth change analysis.</Empty> : (
              <table className="tbl"><tbody>{recentTx.map((t) => <tr key={t.id}><td>{fmtDate(t.date)}</td><td>{t.type}</td><td className="r num">{formatCompact(t.amount)}</td></tr>)}</tbody></table>)}
          </Card>
        </div>
      </div>

      {adding && <EntityForm entity="transactions" onClose={() => setAdding(null)} />}
      {open && <KpiDrawer k={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function KpiDrawer({ k, onClose }: { k: Exclude<KpiKey, null>; onClose: () => void }) {
  const { state } = useApp(); const nav = useNavigate();
  const s = state!, ev = s.evaluation, d = s.data, nw = ev.netWorth, pf = ev.portfolio, cash = ev.cash;
  const T: Record<string, string> = { gross: "Gross assets", liab: "Confirmed liabilities", nw: "Net worth", change: "Change in net worth", ret: "Absolute return", xirr: "XIRR", invested: "Invested capital", inc: "Monthly income", exp: "Monthly expenses", cf: "Cash-flow surplus / deficit", liquid: "Liquid assets", emerg: "Emergency-fund coverage", health: "Health score" };
  const holdingsTable = (rows: typeof pf.lines) => (
    <DataTable dense rows={rows.map((l) => ({ ...l, id: l.id }))} defaultSort={{ key: "v", dir: -1 }} cols={[
      { key: "n", label: "Holding", render: (l) => <>{l.name}{l.parentId && <span className="muted small"> (underlying)</span>}</>, sort: (l) => l.name },
      { key: "c", label: "Class", render: (l) => <span className="small">{l.assetClass ? classLabel(l.assetClass) : "Needs review"}</span> },
      { key: "v", label: "Value", right: true, render: (l) => formatCompact(l.value), sort: (l) => l.value }]} />);
  return (
    <Modal drawer title={T[k]} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {k === "gross" && <><p className="sec small" style={{ marginBottom: 10 }}>Unique, in-scope positions. Aggregates are replaced by their underlying records, so nothing is counted twice.</p>{holdingsTable(pf.lines)}
        {pf.reconciliation.length > 0 && <div style={{ marginTop: 12 }}><Banner tone="info" title="Reconciliation.">{pf.reconciliation.map((r) => `${r.parentName}: ${formatCompact(r.childrenValue)} entered of ${formatCompact(r.aggregateValue)} (${r.kind === "unallocated_remainder" ? `${formatCompact(r.difference)} still unallocated` : `underlying exceeds aggregate by ${formatCompact(r.difference)}`})`).join("; ")}</Banner></div>}</>}
      {k === "liab" && (d.liabilities.length === 0 ? <Empty title="No liabilities recorded" action={<button className="btn primary" onClick={() => nav("/assets?tab=liabilities")}>Record liabilities</button>}>This is not the same as “no debt”. Net worth stays uncalculated until you add loans/cards or mark the list complete.</Empty>
        : <table className="tbl"><tbody>{d.liabilities.filter((l) => !l.archived).map((l) => <tr key={l.id}><td>{l.name}</td><td className="r num">{formatCompact(l.outstanding)}</td></tr>)}<tr><td><b>Total</b></td><td className="r num"><b>{formatCompact(nw.liabilities)}</b></td></tr></tbody></table>)}
      {k === "nw" && <dl className="dl"><dt>Gross assets</dt><dd className="num">{formatINR(nw.grossAssets)}</dd><dt>Confirmed liabilities</dt><dd className="num">{nw.liabilitiesStatus === "not_assessed" ? "Not assessed" : formatINR(nw.liabilities)}</dd><dt>Net worth</dt><dd className="num"><b>{nw.netWorth == null ? "Awaiting data" : formatINR(nw.netWorth)}</b></dd>
        <dt>Remaining commitments</dt><dd className="num">{formatINR(nw.commitmentsRemaining)}</dd><dt>Adjusted net worth</dt><dd className="num">{nw.adjustedNetWorth == null ? "Awaiting data" : formatINR(nw.adjustedNetWorth)}</dd></dl>}
      {k === "nw" && <div style={{ marginTop: 12 }} className="stack"><Banner>{nw.note}</Banner><p className="small sec">Convention: formal net worth = assets − <i>outstanding financial liabilities</i>. Future contractual premiums (e.g. the ₹20 L pension balance) are future cash outflows, not debts today, so they are shown separately and in an “adjusted” view only.</p></div>}
      {k === "change" && <div className="stack"><p>{nw.changeMonth.comparable ? `Month: ${formatCompact(nw.changeMonth.absolute)} (${formatPct(nw.changeMonth.percent, 2)}) vs ${fmtDate(nw.changeMonth.previous!.date)}.` : `Month: ${nw.changeMonth.reason}`}</p><p>{nw.changeYear.comparable ? `Year: ${formatCompact(nw.changeYear.absolute)} (${formatPct(nw.changeYear.percent, 2)}) vs ${fmtDate(nw.changeYear.previous!.date)}.` : `Year: ${nw.changeYear.reason}`}</p>
        {nw.changeMonth.attribution && <dl className="dl"><dt>Liability change</dt><dd className="num">{formatCompact(nw.changeMonth.attribution.liabilityChange)}</dd><dt>Net external withdrawals</dt><dd className="num">{formatCompact(nw.changeMonth.attribution.netExternalWithdrawals)}</dd><dt>Valuation & other</dt><dd className="num">{formatCompact(nw.changeMonth.attribution.valuationAndOther)}</dd></dl>}
        <p className="small muted">Only like-for-like snapshots (same liability completeness, within ±20 days of the target) are compared.</p></div>}
      {(k === "ret" || k === "invested") && <div className="stack"><DataTable dense rows={pf.lines.filter((l) => l.assetClass !== "real_estate").map((l) => ({ ...l }))} cols={[{ key: "n", label: "Holding", render: (l) => l.name }, { key: "i", label: "Invested", right: true, render: (l) => l.invested == null ? <span className="muted">—</span> : formatCompact(l.invested) }, { key: "v", label: "Value", right: true, render: (l) => formatCompact(l.value) }]} />
        <p className="small sec">{pf.returns.note}</p></div>}
      {k === "xirr" && <div className="stack">{pf.xirr.ok ? <p>Annualised money-weighted return <b>{formatPct(pf.xirr.rate * 100, 2)}</b> over {pf.xirr.flowCount} dated flows plus today's valuation.</p> : <Banner tone="warn" title="Insufficient cash-flow history.">{pf.xirr.reason} Record dated purchases/contributions (and withdrawals/distributions) for each holding on the Assets page.</Banner>}
        <p className="small sec">XIRR solves Σ CFᵢ ÷ (1+r)^((dᵢ−d₀)/365) = 0 using dated external flows and the current valuation as the terminal inflow. Original capital and current value alone are not enough.</p></div>}
      {k === "inc" && <DataTable dense rows={d.cashflows.filter((c) => c.kind === "income" && !c.archived)} cols={[{ key: "n", label: "Source", render: (c) => c.name }, { key: "f", label: "Frequency", render: (c) => c.frequency }, { key: "a", label: "Amount", right: true, render: (c) => formatCompact(c.amount) }]} empty={<Empty title="No income recorded" />} />}
      {k === "exp" && <DataTable dense rows={cash.byCategory.filter((c) => c.kind === "expense").map((c) => ({ ...c, id: c.category }))} cols={[{ key: "n", label: "Category", render: (c) => c.label }, { key: "m", label: "Monthly", right: true, render: (c) => formatCompact(c.monthly) }, { key: "a", label: "Annual", right: true, render: (c) => formatCompact(c.annual) }]} empty={<Empty title="No expenses recorded" />} />}
      {k === "cf" && <dl className="dl"><dt>Monthly inflows</dt><dd className="num">{formatINR(cash.monthlyIncome)}</dd><dt>Monthly outflows</dt><dd className="num">{formatINR(cash.monthlyOutflows)}</dd><dt>Net</dt><dd className="num"><b>{formatINR(cash.monthlySurplus)}</b></dd><dt>Annualised</dt><dd className="num">{formatINR(cash.monthlySurplus * 12)}</dd><dt>Savings rate</dt><dd>{cash.savingsRate == null ? "n/a" : formatPct(cash.savingsRate)}</dd></dl>}
      {k === "liquid" && <div className="stack">{([1, 2, 3, 4] as const).map((t) => <div key={t} className="row between"><span>Tier {t}</span><b className="num">{formatCompact(pf.liquidity[t])}</b></div>)}<p className="small sec">Liquid assets = tiers 1 (cash/bank) + 2 (listed / open-ended, ≤ 1 week). Property, AIF, unlisted equity, pension products and insurance sum assured are never counted.</p></div>}
      {k === "emerg" && <div className="stack"><dl className="dl"><dt>Eligible reserves</dt><dd className="num">{formatINR(pf.emergencyReserves)}</dd><dt>Essential expenses / month</dt><dd className="num">{formatINR(cash.essentialMonthly)}</dd><dt>Coverage</dt><dd>{ev.emergencyCoverageMonths == null ? "n/a" : `${ev.emergencyCoverageMonths.toFixed(1)} months`}</dd></dl>
        <p className="small sec">Eligible = cash, bank balances, FDs and liquid/debt funds you flagged as emergency-eligible. FDs may carry premature-withdrawal penalties. Bank balances have {d.holdings.some((h) => h.instrumentType === "bank_balance") ? "" : "not "}been entered.</p></div>}
    </Modal>
  );
}
export { ClassBadge };
