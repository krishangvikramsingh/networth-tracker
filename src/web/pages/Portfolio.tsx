import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../store";
import { Badge, Banner, Card, DataTable, Empty, Kpi, PageHead, Segmented, classColor, classLabel, fmtDate } from "../ui";
import { BarsChart, ChartCard, Donut, SimpleBars, TrendChart } from "../charts";
import { formatCompact, formatPct, pct, sum } from "@shared/money";
import { ASSET_CLASSES, INSTRUMENT_LABEL, LIQUIDITY_LABEL, type AssetClass } from "@shared/taxonomy";
import { monthLabel } from "@shared/dates";
import type { EffectiveLine } from "@shared/portfolio";

export function PortfolioPage() {
  const { state } = useApp();
  const s = state!, ev = s.evaluation, pf = ev.portfolio, d = s.data;
  const [fc, setFc] = useState(""), [fi, setFi] = useState(""), [fa, setFa] = useState(""), [fiss, setFiss] = useState("");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [look, setLook] = useState<"direct" | "lookthrough">("lookthrough");
  const investable = pf.lines.filter((l) => l.assetClass !== "real_estate" && l.instrumentType !== "pension_annuity");
  const lines = investable.filter((l) => (!fc || (fc === "review" ? !l.assetClass : l.assetClass === fc)) && (!fi || l.instrumentType === fi) && (!fa || l.account === fa) && (!fiss || l.issuer === fiss)
    && (!from || (l.valuationDate ?? "") >= from) && (!to || (l.valuationDate ?? "9999") <= to));
  const total = sum(lines.map((l) => l.value));
  const invested = lines.filter((l) => l.invested != null);
  const inv = sum(invested.map((l) => l.invested)), invVal = sum(invested.map((l) => l.value));
  const accounts = [...new Set(investable.map((l) => l.account).filter(Boolean))] as string[];
  const issuers = [...new Set(investable.map((l) => l.issuer).filter(Boolean))] as string[];

  const byClass = ASSET_CLASSES.map((c) => ({ name: classLabel(c), value: sum(lines.filter((l) => l.assetClass === c).map((l) => l.value)), color: classColor(c) })).filter((x) => x.value > 0);
  const un = sum(lines.filter((l) => !l.assetClass).map((l) => l.value));
  if (un > 0) byClass.push({ name: "Unclassified", value: un, color: classColor("unclassified") });

  const indian = sum(lines.filter((l) => l.assetClass === "indian_equity").map((l) => l.value)), global = sum(lines.filter((l) => l.assetClass === "global_equity").map((l) => l.value));
  const equityLines = lines.filter((l) => l.assetClass === "indian_equity" || l.assetClass === "global_equity");
  const directEq = sum(equityLines.filter((l) => l.instrumentType === "direct_stock" && !l.parentId).map((l) => l.value));
  const viaFunds = sum(equityLines.filter((l) => !(l.instrumentType === "direct_stock" && !l.parentId)).map((l) => l.value));

  const top = [...lines].sort((a, b) => b.value - a.value).slice(0, 10);
  const byInstrument = Object.entries(lines.reduce<Record<string, number>>((m, l) => { m[INSTRUMENT_LABEL[l.instrumentType]] = (m[INSTRUMENT_LABEL[l.instrumentType]] ?? 0) + l.value; return m; }, {})).map(([name, value]) => ({ name, value, color: "var(--s1)" })).sort((a, b) => b.value - a.value);
  const byIssuer = Object.entries(lines.reduce<Record<string, number>>((m, l) => { const k = l.issuer ?? "Issuer not recorded"; m[k] = (m[k] ?? 0) + l.value; return m; }, {})).map(([name, value]) => ({ name, value, color: "var(--s3)" })).sort((a, b) => b.value - a.value).slice(0, 8);
  const bySector = Object.entries(lines.filter((l) => l.sector).reduce<Record<string, number>>((m, l) => { m[l.sector!] = (m[l.sector!] ?? 0) + l.value; return m; }, {})).map(([name, value]) => ({ name, value, color: "var(--s4)" })).sort((a, b) => b.value - a.value);
  const liq = ([1, 2, 3, 4] as const).map((t) => ({ name: `Tier ${t}`, value: sum(lines.filter((l) => l.liquidityTier === t).map((l) => l.value)), color: ["var(--s3)", "var(--s1)", "var(--s4)", "var(--s2)"][t - 1] }));

  const stockDen = pf.denominators[d.settings.concentrationDenominator].value;
  const stocks = pf.directStocks.map((x) => ({ ...x, id: x.key, show: look === "direct" ? x.direct : x.value })).filter((x) => x.show > 0).sort((a, b) => b.show - a.show);

  // historical performance only where every included holding has a valuation on/before the date
  const hist = useMemo(() => {
    const leaf = d.holdings.filter((h) => !h.archived && !d.holdings.some((k) => k.parentId === h.id && !k.archived) && !["property_residential", "property_commercial", "cash", "bank_balance", "pension_annuity"].includes(h.instrumentType));
    const dates = [...new Set(d.valuations.filter((v) => leaf.some((h) => h.id === v.holdingId)).map((v) => v.date))].sort();
    const out: Array<{ label: string; value: number }> = [];
    for (const dt of dates) {
      let ok = true, t = 0;
      for (const h of leaf) {
        const vs = d.valuations.filter((v) => v.holdingId === h.id && v.date <= dt).sort((a, b) => b.date.localeCompare(a.date));
        if (!vs.length) { ok = false; break; }
        t += vs[0].value;
      }
      if (ok) out.push({ label: fmtDate(dt), value: t });
    }
    return out;
  }, [d.valuations, d.holdings]);

  const alloc = ev.allocation[ev.activeDenominator].filter((r) => r.inDenominator && (r.targetPct != null || (r.pct ?? 0) > 0));
  return (
    <>
      <PageHead title="Investment portfolio analytics" subtitle="Exposure, concentration, liquidity and performance across all investments. Funds and managed portfolios are looked through where underlying holdings exist — never counted twice." />
      <div className="stack">
        <Card><div className="toolbar" style={{ margin: 0 }}>
          <select aria-label="Asset class" value={fc} onChange={(e) => setFc(e.target.value)} style={{ width: "auto" }}><option value="">All asset classes</option>{ASSET_CLASSES.filter((c) => c !== "real_estate").map((c) => <option key={c} value={c}>{classLabel(c)}</option>)}<option value="review">Unclassified</option></select>
          <select aria-label="Instrument" value={fi} onChange={(e) => setFi(e.target.value)} style={{ width: "auto" }}><option value="">All instruments</option>{[...new Set(investable.map((l) => l.instrumentType))].map((t) => <option key={t} value={t}>{INSTRUMENT_LABEL[t]}</option>)}</select>
          <select aria-label="Account" value={fa} onChange={(e) => setFa(e.target.value)} style={{ width: "auto" }}><option value="">All accounts</option>{accounts.map((a) => <option key={a}>{a}</option>)}</select>
          <select aria-label="Issuer" value={fiss} onChange={(e) => setFiss(e.target.value)} style={{ width: "auto" }}><option value="">All issuers</option>{issuers.map((a) => <option key={a}>{a}</option>)}</select>
          <label className="small muted">Valued from <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "auto" }} /></label>
          <label className="small muted">to <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "auto" }} /></label>
          {(fc || fi || fa || fiss || from || to) && <button className="btn sm" onClick={() => { setFc(""); setFi(""); setFa(""); setFiss(""); setFrom(""); setTo(""); }}>Clear</button>}
        </div></Card>

        <div className="grid g4">
          <Kpi label="Investment market value" value={formatCompact(total)} sub={`${lines.length} positions · excludes property, cash & pension`} />
          <Kpi label="Invested capital" await={invested.length === 0} value={formatCompact(inv)} sub={invested.length < lines.length ? `Recorded for ${invested.length} of ${lines.length} positions` : "All positions"} />
          <Kpi label="Absolute return" await={invested.length === 0} value={`${formatCompact(invVal - inv)} (${formatPct(pct(invVal - inv, inv))})`} tone={invVal >= inv ? "good" : "crit"} sub="Value − cost on positions with cost; not time-weighted" />
          <Kpi label="XIRR" await={!pf.xirr.ok} value={pf.xirr.ok ? formatPct(pf.xirr.rate * 100, 2) : undefined} sub={pf.xirr.ok ? `${pf.xirr.flowCount} dated flows (whole portfolio)` : pf.xirr.reason} />
        </div>
        {pf.unresolved.value > 0 && <Banner tone="warn" title={`${formatCompact(pf.unresolved.value)} is unclassified.`}>Asset-class exposure is shown as a range until the mutual-fund split / underlying holdings are entered. <Link to="/assets">Add underlying positions →</Link></Banner>}

        <div className="grid g2">
          <ChartCard title="Exposure by asset class" subtitle="Filtered investments" height={250} table={{ headers: ["Class", "Value", "Share"], rows: byClass.map((r) => [r.name, formatCompact(r.value), formatPct(pct(r.value, total))]) }} empty={byClass.length === 0 ? <Empty title="No investments match" /> : undefined}>
            <Donut data={byClass} center={<div><div className="small muted">Investments</div><b className="num">{formatCompact(total)}</b></div>} />
          </ChartCard>
          <ChartCard title="Equity: Indian vs global, direct vs indirect" subtitle="Direct = stocks you hold; indirect = via funds, PMS" height={250}
            table={{ headers: ["Slice", "Value"], rows: [["Indian equity", formatCompact(indian)], ["Global equity", formatCompact(global)], ["Direct equity", formatCompact(directEq)], ["Indirect (funds/PMS)", formatCompact(viaFunds)]] }}>
            <SimpleBars layout="horizontal" data={[{ name: "Indian equity", value: indian, color: "var(--c-indian_equity)" }, { name: "Global equity", value: global, color: "var(--c-global_equity)" }, { name: "Direct stocks", value: directEq, color: "var(--s1)" }, { name: "Via funds / PMS", value: viaFunds, color: "var(--s4)" }]} />
          </ChartCard>
        </div>

        <div className="grid g2">
          <Card title="Top holdings" subtitle="By market value">
            <DataTable dense rows={top.map((l) => ({ ...l, id: l.id }))} cols={[{ key: "n", label: "Position", render: (l: EffectiveLine) => <div>{l.name}<div className="small muted">{INSTRUMENT_LABEL[l.instrumentType]}{l.isAggregate ? " · aggregate" : ""}</div></div> }, { key: "c", label: "Class", render: (l: EffectiveLine) => <span className="small">{l.assetClass ? classLabel(l.assetClass) : "Unclassified"}</span> },
              { key: "v", label: "Value", right: true, render: (l: EffectiveLine) => formatCompact(l.value) }, { key: "p", label: "% of filtered", right: true, render: (l: EffectiveLine) => formatPct(pct(l.value, total)) }]} empty={<Empty title="No holdings" />} />
          </Card>
          <Card title="Single-stock concentration" subtitle={`Limit ${d.rules.find((r) => r.key === "single_stock_max")?.value}% of ${pf.denominators[d.settings.concentrationDenominator].label}`}
            actions={<Segmented label="Exposure basis" value={look} onChange={setLook} options={[{ id: "direct", label: "Direct only" }, { id: "lookthrough", label: "With look-through" }]} />}>
            {stocks.length === 0 ? <Empty title="No stock-level positions">{pf.lines.some((l) => l.instrumentType === "direct_stock" && l.isAggregate) ? "Direct equity is held as an aggregate, so single-stock concentration can’t be measured yet. Enter each stock with quantity and value." : "No direct stocks held."}</Empty> :
              <DataTable dense rows={stocks} cols={[{ key: "n", label: "Stock", render: (x) => x.name }, { key: "d", label: "Direct", right: true, render: (x) => formatCompact(x.direct) }, { key: "l", label: "Look-through", right: true, render: (x) => formatCompact(x.lookThrough) },
                { key: "p", label: "% of base", right: true, render: (x) => { const p = pct(x.show, stockDen)!; const lim = d.rules.find((r) => r.key === "single_stock_max")!.value; return <span style={{ color: p > lim ? "var(--crit)" : undefined, fontWeight: p > lim ? 650 : 400 }}>{formatPct(p)}</span>; } }]} />}
          </Card>
        </div>

        <div className="grid g3">
          <ChartCard title="By instrument" height={230} table={{ headers: ["Instrument", "Value"], rows: byInstrument.map((x) => [x.name, formatCompact(x.value)]) }}><SimpleBars layout="horizontal" data={byInstrument} /></ChartCard>
          <ChartCard title="By issuer / institution" height={230} table={{ headers: ["Issuer", "Value"], rows: byIssuer.map((x) => [x.name, formatCompact(x.value)]) }} empty={byIssuer.length === 0 ? <Empty title="No data" /> : undefined}><SimpleBars layout="horizontal" data={byIssuer} /></ChartCard>
          <ChartCard title="Sector concentration" height={230} subtitle="Only where sector data is entered" table={{ headers: ["Sector", "Value"], rows: bySector.map((x) => [x.name, formatCompact(x.value)]) }} empty={bySector.length === 0 ? <Empty title="No sector data">Add a sector to stock holdings (Edit → Sector isn’t required for other metrics).</Empty> : undefined}><SimpleBars layout="horizontal" data={bySector} /></ChartCard>
        </div>

        <div className="grid g2">
          <ChartCard title="Liquidity classification" subtitle="How quickly each tier can be converted to cash" height={230} table={{ headers: ["Tier", "Meaning", "Value"], rows: liq.map((x, i) => [x.name, LIQUIDITY_LABEL[(i + 1) as 1 | 2 | 3 | 4], formatCompact(x.value)]) }}><SimpleBars data={liq} /></ChartCard>
          <ChartCard title="Allocation drift vs target" subtitle={`On ${pf.denominators[ev.activeDenominator].label}`} height={230}
            empty={alloc.length === 0 ? <Empty title="No targets" action={<Link className="btn" to="/rules">Set targets</Link>} /> : undefined} table={{ headers: ["Class", "Actual", "Target", "Drift (pp)", "Status"], rows: alloc.map((r) => [classLabel(r.assetClass), formatPct(r.pct), formatPct(r.targetPct), r.driftPp == null ? "—" : r.driftPp.toFixed(1), r.status]) }}>
            <BarsChart layout="horizontal" data={alloc.map((r) => ({ name: classLabel(r.assetClass), drift: r.driftPp ?? 0 }))} series={[{ key: "drift", label: "Drift (pp)", color: "var(--s2)" }]} fmt={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} pp`} yFmt={(v) => `${v}`} />
          </ChartCard>
        </div>

        <ChartCard title="Historical portfolio value" subtitle="Only dates where every position has a dated valuation (no interpolation)" height={230} table={{ headers: ["Date", "Value"], rows: hist.map((h) => [h.label, formatCompact(h.value)]) }}
          empty={hist.length < 2 ? <Empty title="Not enough dated valuations">History appears once positions have two or more dated valuations. Editing a value or applying market prices records a dated valuation automatically.</Empty> : undefined}>
          <TrendChart area data={hist} series={[{ key: "value", label: "Portfolio value", color: "var(--s1)" }]} />
        </ChartCard>

        <Card title="Valuation freshness" subtitle={`Stale after ${d.settings.stalenessDays} days`}>
          <DataTable dense rows={pf.lines.map((l) => ({ ...l }))} defaultSort={{ key: "d", dir: 1 }} cols={[{ key: "n", label: "Position", render: (l: EffectiveLine) => l.name }, { key: "d", label: "Valuation date", sort: (l: EffectiveLine) => l.valuationDate ?? "0", render: (l: EffectiveLine) => l.valuationDate ? fmtDate(l.valuationDate) : "—" },
            { key: "s", label: "Status", render: (l: EffectiveLine) => !l.valuationDate ? <Badge tone="warn">no date</Badge> : pf.valuation.stale.some((x) => x.id === l.id) ? <Badge tone="serious">stale</Badge> : <Badge tone="good">fresh</Badge> },
            { key: "t", label: "Type", render: (l: EffectiveLine) => (["aif", "pms", "unlisted_equity"].includes(l.instrumentType) ? <span className="small muted">delayed valuation instrument</span> : "") }]} />
        </Card>
      </div>
    </>
  );
}
