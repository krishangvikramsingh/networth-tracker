import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp, type AppState } from "../store";
import { Badge, Banner, Card, Empty, PageHead, SevBadge, Skeleton, Tabs, classColor, classLabel } from "../ui";
import { BarsChart, ChartCard, Donut } from "../charts";
import { formatCompact, formatPct, pct } from "@shared/money";
import { ASSET_CLASSES, ASSET_CLASS_LABEL } from "@shared/taxonomy";
import { CASE_IDS } from "@shared/fixtures";

const IDS = [CASE_IDS.A, CASE_IDS.B, CASE_IDS.C] as const;
const SHORT: Record<string, string> = { [CASE_IDS.A]: "A · Aggressive", [CASE_IDS.B]: "B · Conservative", [CASE_IDS.C]: "C · Moderate" };

export function CasesPage() {
  const { state, setClientId, clientId } = useApp();
  const [cases, setCases] = useState<Record<string, AppState>>({});
  const [sel, setSel] = useState<string>(IDS[0]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    Promise.all(IDS.map((id) => api.get<AppState>(`/api/clients/${id}/state`).then((s) => [id, s] as const))).then((e) => setCases(Object.fromEntries(e))).catch((e) => setErr(e.message));
  }, [state?.serverTime, clientId]);
  if (err) return <Banner tone="crit">{err}</Banner>;
  if (Object.keys(cases).length < 3) return <div className="stack"><Skeleton h={34} w={300} /><Skeleton h={300} /></div>;
  const list = IDS.map((id) => cases[id]);
  const cur = cases[sel];
  const e = cur.evaluation, d = cur.data, nw = e.netWorth, pf = e.portfolio;
  const gd = e.growthDefensive;
  const stackData = list.map((c) => ({ name: SHORT[c.data.client.id], ...Object.fromEntries(ASSET_CLASSES.map((k) => [k, c.evaluation.portfolio.grossAssets ? (c.evaluation.portfolio.buckets[k].value / c.evaluation.portfolio.grossAssets) * 100 : 0])) }));
  const openAlerts = (c: AppState) => c.alerts.filter((a) => a.status !== "resolved" && a.kind !== "data_gap");
  const row = (label: string, f: (c: AppState) => string) => <tr><td className="muted">{label}</td>{list.map((c) => <td key={c.data.client.id} className="r num">{f(c)}</td>)}</tr>;
  return (
    <>
      <PageHead title="Investor case studies" subtitle="Three separate illustrative investors from the project brief. They live in their own records — nothing here touches Priya’s portfolio, history or alerts." />
      <Banner tone="info" title="What is given vs assumed.">Case A’s assets (₹10 Cr) and liabilities (₹5 Cr) are from the brief. For B (50:50) and C (70:30) only the growth:defensive ratio is given; the ₹10 Cr base, sub-allocations, loans, income and expenses are <b>illustrative assumptions</b> you can edit by opening the case as a client.</Banner>
      <div className="stack" style={{ marginTop: 16 }}>
        <Card title="Side-by-side comparison" pad={false}>
          <div className="tbl-wrap card-b"><table className="tbl"><thead><tr><th></th>{list.map((c) => <th key={c.data.client.id} className="r">{SHORT[c.data.client.id]}</th>)}</tr></thead><tbody>
            {row("Total assets", (c) => formatCompact(c.evaluation.netWorth.grossAssets))}
            {row("Liabilities", (c) => formatCompact(c.evaluation.netWorth.liabilities))}
            {row("Net worth", (c) => (c.evaluation.netWorth.netWorth == null ? "—" : formatCompact(c.evaluation.netWorth.netWorth)))}
            {row("Debt-to-net-worth", (c) => (c.evaluation.netWorth.debtToNetWorthPct == null ? "n/m" : formatPct(c.evaluation.netWorth.debtToNetWorthPct)))}
            {row("Growth : defensive", (c) => `${c.evaluation.growthDefensive.growthPct?.toFixed(1)} : ${c.evaluation.growthDefensive.defensivePct?.toFixed(1)}`)}
            {row("Equity % of investable", (c) => formatPct(c.evaluation.equityBounds.min))}
            {row("Liquid assets (tiers 1–2)", (c) => formatCompact(c.evaluation.portfolio.liquidAssets))}
            {row("Monthly surplus (illustrative)", (c) => formatCompact(c.evaluation.cash.monthlySurplus))}
            {row("EMI-to-income", (c) => (c.evaluation.cash.monthlyIncomeVerified ? formatPct(pct(c.evaluation.cash.emiMonthly, c.evaluation.cash.monthlyIncomeVerified)) : "—"))}
            {row("Health score", (c) => (c.evaluation.health.overall == null ? "—" : `${c.evaluation.health.overall.toFixed(0)}${c.evaluation.health.provisional ? " (prov.)" : ""}`))}
            {row("Open rule alerts", (c) => String(openAlerts(c).length))}
          </tbody></table></div>
        </Card>
        <div className="grid g2">
          <ChartCard title="Allocation comparison" subtitle="% of each case’s total assets" height={270} table={{ headers: ["Case", ...ASSET_CLASSES.map((k) => ASSET_CLASS_LABEL[k])], rows: stackData.map((r: any) => [r.name, ...ASSET_CLASSES.map((k) => formatPct(r[k]))]) }}>
            <BarsChart stack data={stackData} series={ASSET_CLASSES.map((k) => ({ key: k, label: classLabel(k), color: classColor(k) }))} fmt={(v) => `${v.toFixed(1)}%`} yFmt={(v) => `${v}%`} />
          </ChartCard>
          <ChartCard title="Assets, liabilities and net worth" height={270} table={{ headers: ["Case", "Assets", "Liabilities", "Net worth"], rows: list.map((c) => [SHORT[c.data.client.id], formatCompact(c.evaluation.netWorth.grossAssets), formatCompact(c.evaluation.netWorth.liabilities), formatCompact(c.evaluation.netWorth.netWorth)]) }}>
            <BarsChart data={list.map((c) => ({ name: SHORT[c.data.client.id], assets: c.evaluation.netWorth.grossAssets, liabilities: c.evaluation.netWorth.liabilities, nw: c.evaluation.netWorth.netWorth ?? 0 }))} series={[{ key: "assets", label: "Assets", color: "var(--s1)" }, { key: "liabilities", label: "Liabilities", color: "var(--s2)" }, { key: "nw", label: "Net worth", color: "var(--s3)" }]} />
          </ChartCard>
        </div>
        <ChartCard title="Financial-health components" subtitle="Unassessed components are left blank, not scored" height={260} table={{ headers: ["Component", ...list.map((c) => SHORT[c.data.client.id])], rows: list[0].evaluation.health.components.map((k, i) => [k.label, ...list.map((c) => c.evaluation.health.components[i].score?.toFixed(0) ?? "—")]) }}>
          <BarsChart data={list[0].evaluation.health.components.map((k, i) => ({ name: k.label.split(" ")[0], A: list[0].evaluation.health.components[i].score, B: list[1].evaluation.health.components[i].score, C: list[2].evaluation.health.components[i].score }))} series={[{ key: "A", label: "A", color: "var(--s1)" }, { key: "B", label: "B", color: "var(--s2)" }, { key: "C", label: "C", color: "var(--s3)" }]} fmt={(v) => v.toFixed(0)} yFmt={(v) => String(v)} />
        </ChartCard>

        <Tabs value={sel} onChange={setSel} tabs={IDS.map((id) => ({ id, label: SHORT[id] }))} />
        <div className="row between"><div><h2>{d.client.name}</h2><p className="small sec">{d.client.description}</p></div><button className="btn" onClick={() => setClientId(d.client.id)}>Open as client to edit assumptions →</button></div>
        <Banner>{d.settings.profileNote}</Banner>
        <div className="grid g3">
          <Card title="Assets"><table className="tbl"><tbody>{d.holdings.filter((h) => !h.archived).map((h) => <tr key={h.id}><td>{h.name}</td><td className="r num">{formatCompact(h.currentValue)}</td></tr>)}<tr><td><b>Total</b></td><td className="r num"><b>{formatCompact(nw.grossAssets)}</b></td></tr></tbody></table></Card>
          <Card title="Liabilities"><table className="tbl"><tbody>{d.liabilities.filter((l) => !l.archived).map((l) => <tr key={l.id}><td>{l.name}{l.isIllustrative && <div className="small muted">EMI {formatCompact(l.emi)} @ {(l.rateBps! / 100).toFixed(1)}% · {l.remainingMonths}m (illustrative)</div>}</td><td className="r num">{formatCompact(l.outstanding)}</td></tr>)}<tr><td><b>Total</b></td><td className="r num"><b>{formatCompact(nw.liabilities)}</b></td></tr></tbody></table>
            <p className="small" style={{ marginTop: 8 }}>Net worth = {formatCompact(nw.grossAssets)} − {formatCompact(nw.liabilities)} = <b>{formatCompact(nw.netWorth)}</b></p></Card>
          <Card title="Growth vs defensive" subtitle="Direct property excluded from the split">
            <div style={{ height: 150 }}><Donut data={[{ name: "Growth", value: gd.growth, color: "var(--s1)" }, { name: "Defensive", value: gd.defensive, color: "var(--s3)" }].filter((x) => x.value > 0)} /></div>
            <p className="small sec">Growth = {d.settings.groupGrowth.map((c) => ASSET_CLASS_LABEL[c]).join(", ")}. Defensive = {d.settings.groupDefensive.map((c) => ASSET_CLASS_LABEL[c]).join(", ")}. Denominator {formatCompact(gd.denominator)}{gd.excluded ? `; ${formatCompact(gd.excluded)} (property) excluded` : ""}.</p>
          </Card>
        </div>
        <div className="grid g3">
          <Card title="Cash-flow assumptions (illustrative)"><dl className="dl"><dt>Monthly income</dt><dd className="num">{formatCompact(e.cash.monthlyIncome)}</dd><dt>Outflows incl. EMIs</dt><dd className="num">{formatCompact(e.cash.monthlyOutflows)}</dd><dt>Surplus</dt><dd className="num">{formatCompact(e.cash.monthlySurplus)}</dd><dt>EMI-to-income</dt><dd>{formatPct(pct(e.cash.emiMonthly, e.cash.monthlyIncomeVerified))}</dd></dl></Card>
          <Card title="Concentration & liquidity"><dl className="dl"><dt>Largest class</dt><dd>{(() => { const b = ASSET_CLASSES.map((k) => [k, pf.buckets[k].value] as const).sort((a, b) => b[1] - a[1])[0]; return `${classLabel(b[0])} ${formatPct(pct(b[1], pf.grossAssets))}`; })()}</dd><dt>Liquid (tiers 1–2)</dt><dd className="num">{formatCompact(pf.liquidAssets)} ({formatPct(pct(pf.liquidAssets, pf.grossAssets))})</dd><dt>Illiquid (tier 4)</dt><dd className="num">{formatCompact(pf.liquidity[4])}</dd><dt>Emergency cover</dt><dd>{e.emergencyCoverageMonths == null ? "—" : `${e.emergencyCoverageMonths.toFixed(1)} months`}</dd></dl></Card>
          <Card title="Health score"><b className="num" style={{ fontSize: 30 }}>{e.health.overall?.toFixed(0) ?? "—"}</b> <span className="muted">/100 · {e.health.band}</span><p className="small sec">{e.health.disclosure}</p></Card>
        </div>
        <Card title="Rule-based alerts" pad={false}>{openAlerts(cur).length === 0 ? <div className="card-b"><Empty title="No rule breaches" /></div> : openAlerts(cur).map((a) => (
          <div key={a.id} className="alert-row" style={{ cursor: "default" }}><span className={`sev ${a.severity}`} /><span><b>{a.ruleName}</b> <span className="muted">· {a.subject}</span>{a.kind === "possible" && <> <Badge tone="warn">possible</Badge></>}<div className="small sec">{a.why}</div></span><span className="right"><SevBadge s={a.severity} /><div className="small num">{a.currentLabel}</div></span></div>))}</Card>
      </div>
    </>
  );
}
