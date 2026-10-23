import { useMemo, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { Badge, Banner, Card, DataTable, Empty, Icon, ICONS, Kpi, PageHead, Segmented, Tabs, fmtDate } from "../ui";
import { BarsChart, ChartCard, SimpleBars, TrendChart } from "../charts";
import { formatCompact, formatINR, formatPct, sum } from "@shared/money";
import { CASHFLOW_LABEL } from "@shared/taxonomy";
import { periodTotals, monthlyEquivalent } from "@shared/cashflow";
import { addMonths, endOfMonth, startOfMonth } from "@shared/dates";
import type { CashflowItem } from "@shared/types";
import { EntityForm } from "../forms";
import { AddButton } from "./common";

type Tab = "plan" | "forecast" | "items";
type Period = "month" | "quarter" | "year" | "custom";

export function CashflowPage() {
  const { state, canWrite, clientId, run } = useApp();
  const s = state!, ev = s.evaluation, cash = ev.cash, fc = ev.forecast, d = s.data;
  const [tab, setTab] = useState<Tab>("plan");
  const [form, setForm] = useState<null | { initial?: any; defaults?: any }>(null);
  const [period, setPeriod] = useState<Period>("year");
  const today = s.asOf;
  const [cFrom, setCFrom] = useState(today), [cTo, setCTo] = useState(addMonths(today, 6));
  const range = period === "month" ? [startOfMonth(today), endOfMonth(today)] : period === "quarter" ? [today, endOfMonth(addMonths(today, 2))] : period === "year" ? [today, endOfMonth(addMonths(today, 11))] : [cFrom, cTo];
  const pt = useMemo(() => periodTotals(d, range[0], range[1]), [d, range[0], range[1]]);
  const items = d.cashflows.filter((c) => !c.archived);
  const inc = items.filter((c) => c.kind === "income"), exp = items.filter((c) => c.kind === "expense");
  const derivedEmi = d.liabilities.filter((l) => !l.archived && l.type !== "credit_card" && l.emi);

  const cols = [
    { key: "n", label: "Item", sort: (c: CashflowItem) => c.name, render: (c: CashflowItem) => <div><b>{c.name}</b><div className="small muted">{CASHFLOW_LABEL[c.category]}{c.essential ? " · essential" : ""}{c.kind === "income" && !c.verified ? " · unverified" : ""}{c.isIllustrative && <> · <Badge tone="outline">illustrative</Badge></>}</div></div> },
    { key: "a", label: "Amount", right: true, sort: (c: CashflowItem) => c.amount, render: (c: CashflowItem) => formatINR(c.amount) },
    { key: "f", label: "Frequency", render: (c: CashflowItem) => <span>{c.frequency.replace("_", "-")}{c.frequency === "once" ? "" : <span className="muted small"> · {c.anchorDate ? `from ${fmtDate(c.anchorDate)}` : c.frequency === "monthly" ? "every month" : "date not set"}</span>}</span> },
    { key: "m", label: "Monthly equiv.", right: true, sort: (c: CashflowItem) => monthlyEquivalent(c.amount, c.frequency), render: (c: CashflowItem) => c.frequency === "once" ? <span className="muted small">one-off</span> : formatCompact(Math.round(monthlyEquivalent(c.amount, c.frequency))) },
    { key: "x", label: "", render: (c: CashflowItem) => canWrite ? <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}><button className="btn sm" aria-label={`Edit ${c.name}`} onClick={() => setForm({ initial: c })}><Icon d={ICONS.edit} size={13} /></button><button className="btn sm" aria-label={`Archive ${c.name}`} onClick={() => confirm(`Archive "${c.name}"?`) && run(() => api.del(`/api/clients/${clientId}/cashflows/${c.id}`), "Archived")}><Icon d={ICONS.trash} size={13} /></button></div> : null },
  ];

  const incomeStatus = d.settings.incomeStatus;
  return (
    <>
      <PageHead title="Cash-flow planner" subtitle="Monthly and annual planning with a dated 12-month forecast. Only income and expenses you have actually supplied are used — nothing is inferred."
        actions={<><AddButton onClick={() => setForm({ defaults: { kind: "income", category: "salary" } })}>Add income</AddButton><button className="btn" disabled={!canWrite} onClick={() => setForm({ defaults: { kind: "expense", category: "household" } })}><Icon d={ICONS.plus} />Add expense</button></>} />
      {incomeStatus !== "complete" && (
        <div style={{ marginBottom: 16 }}><Banner tone="warn" title="Income is not marked complete.">Only the items below have been supplied, so surplus and savings rate are provisional. {canWrite && <>When every income source is entered: <button className="btn sm" onClick={() => run(() => api.patch(`/api/clients/${clientId}/settings`, { incomeStatus: "complete" }), "Income marked complete")}>mark income complete</button></>}</Banner></div>)}
      {incomeStatus === "complete" && canWrite && <div style={{ marginBottom: 12 }}><button className="btn sm" onClick={() => run(() => api.patch(`/api/clients/${clientId}/settings`, { incomeStatus: "partial" }), "Income re-opened")}>Re-open income as incomplete</button></div>}
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "plan", label: "Plan" }, { id: "forecast", label: "12-month forecast" }, { id: "items", label: "All items", count: items.length }]} />

      {tab === "plan" && (
        <div className="stack">
          <div className="grid g4">
            <Kpi label="Monthly gross inflows" await={!cash.hasIncome} value={formatCompact(cash.monthlyIncome)} sub={cash.hasUnscheduledReceipts ? "Includes annual receipts at monthly equivalent (analysis only)" : "Monthly equivalents"} />
            <Kpi label="Monthly outflows" await={cash.monthlyOutflows === 0} value={formatCompact(cash.monthlyOutflows)} sub={`${formatCompact(cash.annualOutflows)} per year (+ one-offs)`} />
            <Kpi label="Net monthly surplus / deficit" await={!cash.hasIncome && cash.monthlyOutflows === 0} value={formatCompact(cash.monthlySurplus)} tone={cash.monthlySurplus < 0 ? "crit" : "good"} sub={`Annualised ${formatCompact(cash.annualSurplus)}${cash.incomeAssessed ? "" : " · provisional"}`} badge={!cash.incomeAssessed ? <Badge tone="warn">provisional</Badge> : undefined} />
            <Kpi label="Savings rate" await={cash.savingsRate == null || !cash.incomeAssessed} value={cash.savingsRate != null ? formatPct(cash.savingsRate) : undefined} sub={cash.savingsRate == null ? "Needs income" : !cash.incomeAssessed ? `Not shown until income is complete (partial income gives ${formatPct(cash.savingsRate)})` : cash.savingsNote} />
          </div>
          <div className="grid g2">
            <Card title="Period view" actions={<Segmented<Period> label="Period" value={period} onChange={setPeriod} options={[{ id: "month", label: "This month" }, { id: "quarter", label: "Quarter" }, { id: "year", label: "12 months" }, { id: "custom", label: "Custom" }]} />}>
              {period === "custom" && <div className="row" style={{ marginBottom: 10 }}><input type="date" aria-label="From" value={cFrom} onChange={(e) => setCFrom(e.target.value)} style={{ width: "auto" }} /><span>to</span><input type="date" aria-label="To" value={cTo} min={cFrom} onChange={(e) => setCTo(e.target.value)} style={{ width: "auto" }} /></div>}
              <dl className="dl"><dt>Window</dt><dd>{fmtDate(range[0])} → {fmtDate(range[1])}</dd><dt>Dated inflows</dt><dd className="num">{formatINR(pt.inflow)}</dd><dt>Dated outflows</dt><dd className="num">{formatINR(pt.outflow)}</dd><dt>Net</dt><dd className="num"><b>{formatINR(pt.net)}</b></dd></dl>
              {pt.unscheduled > 0 && <p className="small muted" style={{ marginTop: 8 }}>{pt.unscheduled} item(s) have no payment date and are not included (see Forecast).</p>}
            </Card>
            <Card title="By category (per month)">
              <DataTable dense rows={cash.byCategory.map((r) => ({ ...r, id: r.kind + r.category }))} empty={<Empty title="Nothing recorded" />} cols={[{ key: "l", label: "Category", render: (r) => <>{r.label} {r.kind === "income" ? <Badge tone="good">in</Badge> : <Badge tone="outline">out</Badge>}</> }, { key: "m", label: "Monthly", right: true, render: (r) => formatCompact(r.monthly) }, { key: "a", label: "Annual", right: true, render: (r) => formatCompact(r.annual) }]} />
            </Card>
          </div>
          <div className="grid g2">
            <Card title="Recurring vs one-off"><dl className="dl"><dt>Recurring outflows / month</dt><dd className="num">{formatINR(cash.recurringMonthlyOutflow)}</dd><dt>One-off outflows</dt><dd className="num">{formatINR(cash.oneOffOutflows)}</dd><dt>Essential / month</dt><dd className="num">{formatINR(cash.essentialMonthly)}</dd><dt>EMIs / month</dt><dd className="num">{formatINR(cash.emiMonthly)}</dd></dl></Card>
            <Card title="Commitments vs reserves">
              {fc.commitmentCoverage == null ? <p className="small muted">No outstanding commitments.</p> : <><p><b className="num">{fc.commitmentCoverage.toFixed(1)}×</b> — emergency-eligible reserves ({formatCompact(ev.portfolio.emergencyReserves)}) over remaining commitments ({formatCompact(ev.netWorth.commitmentsRemaining)}).</p>
                <p className="small muted">{formatCompact(fc.scheduledCommitments)} of the commitments is scheduled in the next 12 months; {formatCompact(fc.unscheduledCommitments)} has no payment schedule yet. Coverage is not a recommendation to use emergency funds for premiums.</p></>}
            </Card>
          </div>
        </div>)}

      {tab === "forecast" && (
        <div className="stack">
          <div className="grid g3">
            <Kpi label="Scheduled inflows (12 mo)" value={formatCompact(fc.totalInflow)} />
            <Kpi label="Scheduled outflows (12 mo)" value={formatCompact(fc.totalOutflow)} />
            <Kpi label="Opening bank balance" await={fc.openingBalance == null} value={formatCompact(fc.openingBalance)} sub={fc.openingBalance == null ? "Add bank/cash balances to forecast a running balance" : "From bank & cash holdings"} />
          </div>
          {fc.unscheduled.length > 0 && <Banner tone="warn" title={`${fc.unscheduled.length} item(s) can’t be placed on the calendar.`}>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{fc.unscheduled.map((u, i) => <li key={i}>{u.label}: <b>{formatCompact(u.amount)}</b> ({u.kind}) — {u.reason}</li>)}</ul>Give them a date and they will appear in the right month rather than being spread evenly.</Banner>}
          <ChartCard title="Monthly dated cash flow" subtitle="Premiums, maturities, EMIs and receipts in the months they actually fall due" height={280}
            table={{ headers: ["Month", "Inflow", "Outflow", "Net", "Balance"], rows: fc.months.map((m) => [m.label, formatCompact(m.inflow), formatCompact(m.outflow), formatCompact(m.net), m.balance == null ? "—" : formatCompact(m.balance)]) }}>
            <BarsChart data={fc.months.map((m) => ({ name: m.label.slice(0, 3), inflow: m.inflow, outflow: m.outflow }))} series={[{ key: "inflow", label: "Inflow", color: "var(--s3)" }, { key: "outflow", label: "Outflow", color: "var(--s2)" }]} />
          </ChartCard>
          {fc.openingBalance != null && <ChartCard title="Forecast bank balance" height={230}><TrendChart data={fc.months.map((m) => ({ label: m.label, balance: m.balance }))} series={[{ key: "balance", label: "Balance", color: "var(--s1)" }]} area /></ChartCard>}
          <Card title="Scheduled events">
            <DataTable dense pageSize={25} rows={fc.months.flatMap((m) => m.events.map((e, i) => ({ ...e, id: `${m.month}-${i}` })))} empty={<Empty title="No dated events in the next 12 months" />}
              cols={[{ key: "d", label: "Date", sort: (e) => e.date, render: (e) => fmtDate(e.date) }, { key: "l", label: "Event", render: (e) => e.label }, { key: "k", label: "Source", render: (e) => <Badge tone="outline">{e.source}</Badge> },
                { key: "a", label: "Amount", right: true, render: (e) => e.amount == null ? <span className="muted">value unknown</span> : <span style={{ color: e.kind === "inflow" ? "var(--good)" : undefined }}>{e.kind === "inflow" ? "+" : "−"}{formatCompact(e.amount)}</span> }]} />
            {fc.maturityEventsWithoutValue > 0 && <p className="small muted" style={{ marginTop: 8 }}>{fc.maturityEventsWithoutValue} maturity event(s) have no expected proceeds recorded, so no amount is assumed.</p>}
          </Card>
        </div>)}

      {tab === "items" && (
        <div className="stack">
          <Card title="Income" pad={false}><div className="card-b"><DataTable rows={inc} cols={cols} empty={<Empty title="No income recorded">Add salary, business, rental, interest, dividend or pension income. Nothing is assumed.</Empty>} /></div></Card>
          <Card title="Expenses & scheduled payments"><DataTable rows={exp} cols={cols} empty={<Empty title="No expenses recorded" />} />
            {derivedEmi.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>Also included automatically from liabilities: {derivedEmi.map((l) => `${l.name} EMI ${formatCompact(l.emi!)}`).join(", ")}.</p>}</Card>
        </div>)}
      {form && <EntityForm entity="cashflows" initial={form.initial} defaults={form.defaults} onClose={() => setForm(null)} />}
    </>
  );
}
export { SimpleBars, sum };
