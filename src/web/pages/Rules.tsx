import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { useApp } from "../store";
import { Badge, Banner, Card, Empty, Field, Icon, ICONS, MoneyInput, PageHead, SevBadge, Segmented, Tabs, classLabel, fmtDateTime } from "../ui";
import { formatCompact, formatPct } from "@shared/money";
import { ASSET_CLASSES, CASHFLOW_LABEL, EXPENSE_CATEGORIES, INCOME_CATEGORIES, type AssetClass, type Denominator } from "@shared/taxonomy";
import { RULE_DEFS, validateRuleValue, type RuleDef } from "@shared/rules";
import { DENOMINATOR_LABEL } from "@shared/portfolio";
import { HEALTH_LABELS } from "@shared/score";
import type { RuleConfig, HealthWeights } from "@shared/types";
import type { Trade } from "@shared/rebalance";

type Tab = "allocation" | "rules" | "settings";
const STATE_TONE = { ok: "good", triggered: "crit", possible: "warn", not_evaluable: "info", disabled: "" } as const;
const STATE_LABEL = { ok: "OK", triggered: "Triggered", possible: "Possible", not_evaluable: "Awaiting data", disabled: "Disabled" } as const;
const DEN_OPTS = (Object.keys(DENOMINATOR_LABEL) as Denominator[]).map((k) => ({ id: k, label: DENOMINATOR_LABEL[k].label }));

export function RulesPage() {
  const [tab, setTab] = useState<Tab>("allocation");
  return (
    <>
      <PageHead title="Rules & allocation" subtitle="Configure targets, thresholds and scoring. Every change re-evaluates drift, alerts and recommendations immediately. Nothing is ever executed automatically." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "allocation", label: "Target allocation & rebalancing" }, { id: "rules", label: "Alert rules" }, { id: "settings", label: "Scoring & settings" }]} />
      {tab === "allocation" && <AllocationTab />}
      {tab === "rules" && <RulesTab />}
      {tab === "settings" && <SettingsTab />}
    </>
  );
}

function AllocationTab() {
  const { state, clientId, run, canWrite, toast } = useApp();
  const s = state!, ev = s.evaluation, d = s.data;
  const den = d.settings.denominator;
  const [draft, setDraft] = useState<Record<string, { t: string; b: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const m: Record<string, { t: string; b: string }> = {};
    for (const c of ASSET_CLASSES) { const t = d.targets.find((x) => x.assetClass === c); m[c] = { t: t ? String(t.targetBps / 100) : "", b: t?.bandBps != null ? String(t.bandBps / 100) : "" }; }
    setDraft(m);
  }, [d.targets]);
  const total = ASSET_CLASSES.reduce((a, c) => a + (Number(draft[c]?.t) || 0), 0);
  const valid = Math.abs(total - 100) < 0.005 || total === 0;
  const rows = ev.allocation[den];
  const plan = ev.rebalance;

  async function save() {
    setErr(null);
    const targets = ASSET_CLASSES.filter((c) => draft[c]?.t !== "" && Number(draft[c].t) > 0).map((c) => ({ assetClass: c, targetBps: Math.round(Number(draft[c].t) * 100), bandBps: draft[c].b === "" ? null : Math.round(Number(draft[c].b) * 100) }));
    try { await api.put(`/api/clients/${clientId}/targets`, targets); await run(async () => {}, "Targets saved — drift recalculated"); } catch (e) { setErr(e instanceof ApiError ? e.message : "Could not save"); }
  }
  const setSetting = (patch: object, msg: string) => run(() => api.patch(`/api/clients/${clientId}/settings`, patch), msg);

  // scenario simulator ---------------------------------------------------------------------------
  const [trades, setTrades] = useState<Array<{ assetClass: AssetClass; dir: "buy" | "sell"; amount: number | null }>>([]);
  const [sim, setSim] = useState<any>(null);
  const [scName, setScName] = useState("");
  const [saved, setSaved] = useState<Array<{ id: string; name: string; trades: Trade[] }>>([]);
  const loadSaved = () => api.get(`/api/clients/${clientId}/scenarios`).then((r) => setSaved(r.scenarios)).catch(() => {});
  useEffect(() => { loadSaved(); setSim(null); setTrades([]); }, [clientId]);
  const payload = (): Trade[] => trades.filter((t) => t.amount).map((t) => ({ assetClass: t.assetClass, amount: (t.dir === "buy" ? 1 : -1) * t.amount! }));
  async function evaluate(list = payload()) { if (!list.length) { setSim(null); return; } try { setSim(await api.post(`/api/clients/${clientId}/scenario/evaluate`, { trades: list })); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); } }
  useEffect(() => { const t = setTimeout(() => evaluate(), 300); return () => clearTimeout(t); }, [JSON.stringify(trades), s.serverTime]);
  const fromPlan = () => setTrades(plan.items.filter((i) => i.suggestedAmount > 0 && i.direction !== "hold").map((i) => ({ assetClass: i.assetClass, dir: i.direction === "add" ? "buy" : "sell", amount: i.suggestedAmount })));

  return (
    <div className="stack">
      <Card title="Allocation basis" subtitle="Which denominator the percentages are measured against. Don’t compare a gross-asset percentage with an investable-portfolio target.">
        <div className="grid g2">
          <div className="stack" style={{ gap: 8 }}><b className="small">Allocation & drift denominator</b><Segmented<Denominator> label="Allocation denominator" value={den} options={DEN_OPTS} onChange={(v) => canWrite && setSetting({ denominator: v }, "Denominator changed")} />
            <p className="small sec"><b>{DENOMINATOR_LABEL[den].label}</b> = {formatCompact(ev.portfolio.denominators[den].value)}. {DENOMINATOR_LABEL[den].description}</p></div>
          <div className="stack" style={{ gap: 8 }}><b className="small">Single-stock concentration denominator</b><Segmented<Denominator> label="Concentration denominator" value={d.settings.concentrationDenominator} options={DEN_OPTS} onChange={(v) => canWrite && setSetting({ concentrationDenominator: v }, "Concentration basis changed")} />
            <p className="small sec">Used by the single-stock rule. Rule-specific denominators can also be set under Alert rules.</p></div>
        </div>
      </Card>

      {!d.settings.investmentPolicyValidated && <Banner tone="warn" title="Sample policy, not a validated investment policy.">The 50 / 20 / 10 / 10 / 5 / 5 split is the example from the project brief. It has not been confirmed as appropriate for {d.client.name}. {canWrite && <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={false} onChange={() => setSetting({ investmentPolicyValidated: true }, "Policy marked as validated")} /> I have validated these targets for this client</label>}</Banner>}
      {d.settings.investmentPolicyValidated && canWrite && <div><button className="btn sm" onClick={() => setSetting({ investmentPolicyValidated: false }, "Policy marked as not validated")}>Mark policy as not validated</button></div>}

      <div className="grid g-main">
        <Card title="Target vs actual" subtitle={`On ${DENOMINATOR_LABEL[den].label}. Drift = actual % − target % in percentage points.`} pad={false}>
          <div className="tbl-wrap card-b"><table className="tbl"><thead><tr><th>Asset class</th><th className="r">Target %</th><th className="r">Band ± pp</th><th className="r">Actual</th><th className="r">Drift (pp)</th><th>Status</th><th className="r">Target value</th><th className="r">Gap</th></tr></thead>
            <tbody>{rows.filter((r) => r.inDenominator).map((r) => (
              <tr key={r.assetClass}><td><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: `var(--c-${r.assetClass})`, marginRight: 8 }} />{classLabel(r.assetClass)}</td>
                <td className="r"><input aria-label={`${classLabel(r.assetClass)} target percent`} type="number" step="0.5" min="0" max="100" style={{ width: 80, textAlign: "right" }} disabled={!canWrite} value={draft[r.assetClass]?.t ?? ""} onChange={(e) => setDraft({ ...draft, [r.assetClass]: { ...draft[r.assetClass], t: e.target.value } })} /></td>
                <td className="r"><input aria-label={`${classLabel(r.assetClass)} band`} type="number" step="0.5" min="0" max="50" placeholder={String(d.rules.find((x) => x.key === "portfolio_drift_max")?.value)} style={{ width: 70, textAlign: "right" }} disabled={!canWrite} value={draft[r.assetClass]?.b ?? ""} onChange={(e) => setDraft({ ...draft, [r.assetClass]: { ...draft[r.assetClass], b: e.target.value } })} /></td>
                <td className="r num">{r.minPct != null && r.maxPct != null && Math.abs(r.maxPct - r.minPct) > 0.05 ? <span title="Range until unclassified holdings are resolved">{r.minPct.toFixed(1)}–{r.maxPct.toFixed(1)}%</span> : formatPct(r.pct)}</td>
                <td className="r num">{r.driftPp == null ? "—" : `${r.driftPp > 0 ? "+" : ""}${r.driftPp.toFixed(1)}`}</td>
                <td>{r.status === "breach" ? <Badge tone="crit">outside band</Badge> : r.status === "possible" ? <Badge tone="warn">possibly outside</Badge> : r.status === "within" ? <Badge tone="good">within band</Badge> : <Badge>no target</Badge>}</td>
                <td className="r num">{r.targetValue == null ? "—" : formatCompact(r.targetValue)}</td><td className="r num">{r.gapValue == null ? "—" : `${r.gapValue > 0 ? "+" : ""}${formatCompact(r.gapValue)}`}</td></tr>))}
              <tr><td><b>Total</b></td><td className="r num"><b style={{ color: valid ? "var(--good)" : "var(--crit)" }}>{total.toFixed(2)}%</b></td><td colSpan={6}>{!valid && <span className="err" style={{ color: "var(--crit)" }}>Targets must add up to 100%.</span>}</td></tr></tbody></table>
            {err && <div className="err" style={{ color: "var(--crit)", marginTop: 8 }} role="alert">{err}</div>}
            <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={save} disabled={!canWrite || !valid}>Save targets</button><button className="btn" onClick={() => setDraft(Object.fromEntries(ASSET_CLASSES.map((c) => [c, { t: "", b: "" }])))} disabled={!canWrite}>Clear all</button><span className="small muted">Direct real estate has no target in the sample policy (it is outside the investable denominator).</span></div></div>
        </Card>
        <Card title="Drift summary">
          <p className="small sec" style={{ marginBottom: 8 }}>A <b>5 pp</b> tolerance means 50% → 56% is a <b>6 percentage-point</b> drift (not “12%”). Exactly at the tolerance does not trigger unless you choose the inclusive option.</p>
          {rows.filter((r) => r.status === "breach" || r.status === "possible").length === 0 ? <Empty title="All classes within band" /> :
            <ul style={{ margin: 0, paddingLeft: 18 }}>{rows.filter((r) => r.status === "breach" || r.status === "possible").map((r) => <li key={r.assetClass}><b>{classLabel(r.assetClass)}</b>: {r.status === "breach" ? `${r.driftPp! > 0 ? "+" : ""}${r.driftPp!.toFixed(1)} pp` : `${r.driftMinPp!.toFixed(1)} to ${r.driftMaxPp!.toFixed(1)} pp (depends on unclassified)`}</li>)}</ul>}
        </Card>
      </div>

      <Card title="Rebalancing options" subtitle="A mathematical allocation gap is not an investment recommendation.">
        <div className="grid g2" style={{ marginBottom: 12 }}>
          <div><b className="small">Method</b><ol className="small sec" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{plan.steps.map((st, i) => <li key={i}>{st}</li>)}</ol></div>
          <dl className="dl" style={{ alignContent: "start" }}><dt>Denominator</dt><dd className="num">{formatCompact(plan.denominatorValue)}</dd><dt>Cash held</dt><dd className="num">{formatCompact(plan.cashAvailable)}</dd><dt>Reserve to keep</dt><dd className="num">{formatCompact(plan.reserveRequired)}</dd><dt>Free cash to deploy</dt><dd className="num">{formatCompact(plan.freeCash)}</dd><dt>Sale proceeds (suggested)</dt><dd className="num">{formatCompact(plan.proceedsFromSales)}</dd><dt>Fresh money needed</dt><dd className="num">{formatCompact(plan.newMoneyNeeded)}</dd></dl>
        </div>
        {plan.items.length === 0 ? <Empty title="Set a target allocation to see options" /> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Asset class</th><th className="r">Actual</th><th className="r">Target</th><th className="r">Gap to target</th><th>Option</th><th className="r">Suggested amount</th><th>Why / caveats</th></tr></thead>
            <tbody>{plan.items.map((i) => (<tr key={i.assetClass}><td><b>{i.label}</b></td><td className="r num">{formatPct(i.actualPct)}</td><td className="r num">{formatPct(i.targetPct)}</td><td className="r num">{i.gapValue > 0 ? "+" : ""}{formatCompact(i.gapValue)}</td>
              <td>{i.direction === "add" ? <Badge tone="info">add</Badge> : i.direction === "reduce" ? <Badge tone="serious">{i.mathOnly ? "gap only (illiquid)" : "reduce"}</Badge> : <Badge tone="good">hold</Badge>}</td><td className="r num">{i.suggestedAmount ? formatCompact(i.suggestedAmount) : "—"}</td><td className="small">{i.reasons.join(" ")}</td></tr>))}</tbody></table></div>)}
        {plan.notes.map((n, i) => <p key={i} className="small sec" style={{ marginTop: 6 }}>• {n}</p>)}
        <div style={{ marginTop: 10 }}><Banner tone="info">{plan.disclaimer}</Banner></div>
      </Card>

      <Card title="Scenario simulator" subtitle="Try purchases and sales before saving anything. Recalculates allocation, net worth, rules and the health score on a copy of your data.">
        <div className="stack" style={{ gap: 10 }}>
          {trades.map((t, i) => (
            <div key={i} className="row">
              <select aria-label="Direction" value={t.dir} onChange={(e) => setTrades(trades.map((x, j) => (j === i ? { ...x, dir: e.target.value as "buy" | "sell" } : x)))} style={{ width: 90 }}><option value="buy">Buy</option><option value="sell">Sell</option></select>
              <select aria-label="Asset class" value={t.assetClass} onChange={(e) => setTrades(trades.map((x, j) => (j === i ? { ...x, assetClass: e.target.value as AssetClass } : x)))} style={{ width: 200 }}>{ASSET_CLASSES.map((c) => <option key={c} value={c}>{classLabel(c)}</option>)}</select>
              <div style={{ width: 220 }}><MoneyInput value={t.amount} onChange={(v) => setTrades(trades.map((x, j) => (j === i ? { ...x, amount: v } : x)))} placeholder="Amount e.g. 25L" /></div>
              <button className="btn sm" onClick={() => setTrades(trades.filter((_, j) => j !== i))} aria-label="Remove trade"><Icon d={ICONS.x} size={13} /></button>
            </div>))}
          <div className="row"><button className="btn" onClick={() => setTrades([...trades, { assetClass: "debt", dir: "buy", amount: null }])}><Icon d={ICONS.plus} />Add trade</button><button className="btn" onClick={fromPlan} disabled={!plan.items.some((i) => i.suggestedAmount > 0)}>Load suggested options</button>{trades.length > 0 && <button className="btn ghost" onClick={() => setTrades([])}>Reset</button>}
            {saved.length > 0 && <select aria-label="Load saved scenario" value="" onChange={(e) => { const sc = saved.find((x) => x.id === e.target.value); if (sc) setTrades(sc.trades.map((t) => ({ assetClass: t.assetClass, dir: t.amount >= 0 ? "buy" : "sell", amount: Math.abs(t.amount) }))); }} style={{ width: "auto" }}><option value="">Load saved…</option>{saved.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</div>
          {sim && (<div className="stack" style={{ marginTop: 6 }}>
            {sim.warnings.map((w: string, i: number) => <Banner key={i} tone="warn">{w}</Banner>)}
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Asset class</th><th className="r">Before</th><th className="r">After</th><th className="r">Target</th><th className="r">Drift before → after (pp)</th></tr></thead>
              <tbody>{sim.after.allocation.filter((r: any) => r.inDenominator && (r.pct || r.targetPct)).map((r: any) => { const b = sim.before.allocation.find((x: any) => x.assetClass === r.assetClass); return <tr key={r.assetClass}><td>{classLabel(r.assetClass)}</td><td className="r num">{formatPct(b?.pct)}</td><td className="r num"><b>{formatPct(r.pct)}</b></td><td className="r num">{formatPct(r.targetPct)}</td><td className="r num">{b?.driftPp == null ? "—" : b.driftPp.toFixed(1)} → <b>{r.driftPp == null ? "—" : r.driftPp.toFixed(1)}</b></td></tr>; })}</tbody></table></div>
            <div className="grid g3">
              <Card title="Gross assets"><b className="num">{formatCompact(sim.before.grossAssets)} → {formatCompact(sim.after.grossAssets)}</b></Card>
              <Card title="Health score"><b className="num">{sim.before.health?.toFixed(0) ?? "—"} → {sim.after.health?.toFixed(0) ?? "—"}</b></Card>
              <Card title="Emergency coverage"><b className="num">{sim.before.emergencyMonths?.toFixed(1) ?? "—"} → {sim.after.emergencyMonths?.toFixed(1) ?? "—"} mo</b></Card>
            </div>
            <div><b className="small">Rule outcomes that change</b>
              <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{sim.after.rules.filter((r: any, i: number) => r.state !== sim.before.rules[i].state).map((r: any) => <li key={r.key}>{r.name}: {STATE_LABEL[sim.before.rules.find((x: any) => x.key === r.key).state as keyof typeof STATE_LABEL]} → <b>{STATE_LABEL[r.state as keyof typeof STATE_LABEL]}</b></li>)}
                {sim.after.rules.every((r: any, i: number) => r.state === sim.before.rules[i].state) && <li className="muted">No rule changes state.</li>}</ul></div>
            <div className="row"><input aria-label="Scenario name" placeholder="Scenario name" value={scName} onChange={(e) => setScName(e.target.value)} style={{ width: 220 }} /><button className="btn" disabled={!canWrite || !scName.trim()} onClick={async () => { await api.post(`/api/clients/${clientId}/scenarios`, { name: scName, trades: payload() }).then(() => { toast("Scenario saved (not executed)"); setScName(""); loadSaved(); }).catch((e) => toast(e.message, "err")); }}>Save scenario</button><span className="small muted">Saving records the idea only. No trade is placed.</span></div></div>)}
        </div>
      </Card>
    </div>
  );
}

function RuleCard({ def, cfg }: { def: RuleDef; cfg: RuleConfig }) {
  const { state, clientId, run, canWrite } = useApp();
  const res = state!.evaluation.rules.find((r) => r.key === def.key)!;
  const [v, setV] = useState<any>({ enabled: cfg.enabled, value: cfg.unit === "₹" ? Math.round(cfg.value) : cfg.value, severity: cfg.severity, params: cfg.params });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setV({ enabled: cfg.enabled, value: cfg.value, severity: cfg.severity, params: cfg.params }), [cfg]);
  const dirty = JSON.stringify(v) !== JSON.stringify({ enabled: cfg.enabled, value: cfg.value, severity: cfg.severity, params: cfg.params });
  const p = v.params ?? {};
  const setP = (k: string, val: unknown) => setV({ ...v, params: { ...p, [k]: val } });
  async function save() {
    const e = validateRuleValue(def.key, Number(v.value)); setErr(e); if (e) return;
    try { await api.put(`/api/clients/${clientId}/rules/${def.key}`, { enabled: v.enabled, value: Number(v.value), severity: v.severity, params: v.params }); await run(async () => {}, `${def.name} updated — re-evaluated`); } catch (x) { setErr(x instanceof Error ? x.message : "Could not save"); }
  }
  const hasDen = "denominator" in cfg.params, hasInc = "inclusive" in cfg.params;
  return (
    <Card>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: 1 }}><div className="row" style={{ gap: 8 }}><h3>{def.name}</h3><Badge tone={STATE_TONE[res.state]}>{STATE_LABEL[res.state]}</Badge></div><p className="small sec" style={{ marginTop: 3 }}>{def.description}</p></div>
        <label className="check"><input type="checkbox" checked={v.enabled} disabled={!canWrite} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />Enabled</label>
      </div>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <Field label={`Threshold (${cfg.unit})`} error={err ?? undefined}>{cfg.unit === "₹" ? <MoneyInput value={Math.round(Number(v.value))} onChange={(x) => setV({ ...v, value: x ?? 0 })} /> : <input type="number" step="any" value={v.value} disabled={!canWrite} onChange={(e) => setV({ ...v, value: e.target.value === "" ? "" : Number(e.target.value) })} />}</Field>
        <Field label="Severity"><select value={v.severity} disabled={!canWrite} onChange={(e) => setV({ ...v, severity: e.target.value })}><option value="critical">Critical</option><option value="high">High</option><option value="warning">Warning</option><option value="info">Notice</option></select></Field>
        {hasDen && <Field label="Denominator"><select value={String(p.denominator)} disabled={!canWrite} onChange={(e) => setP("denominator", e.target.value)}>{DEN_OPTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>}
        {hasInc && <Field label="Comparison"><select value={p.inclusive ? "incl" : "strict"} disabled={!canWrite} onChange={(e) => setP("inclusive", e.target.value === "incl")}><option value="strict">Strict (exactly at limit is OK)</option><option value="incl">Inclusive (at limit triggers)</option></select></Field>}
        {def.key === "net_worth_decline" && <Field label="Compare against"><select value={String(p.window)} disabled={!canWrite} onChange={(e) => setP("window", e.target.value)}><option value="month">Previous month-end</option><option value="year">Year-ago snapshot</option></select></Field>}
        {def.key === "idle_cash" && <><Field label="Absolute floor"><MoneyInput value={Number(p.absoluteFloor ?? 0)} onChange={(x) => setP("absoluteFloor", x ?? 0)} /></Field><Field label="Must stay idle for (days)"><input type="number" min={0} value={Number(p.minIdleDays ?? 30)} disabled={!canWrite} onChange={(e) => setP("minIdleDays", Number(e.target.value))} /></Field></>}
      </div>
      <dl className="dl small" style={{ marginTop: 10 }}><dt>Calculation</dt><dd>{def.calc}</dd><dt>Trigger</dt><dd>{def.trigger}</dd><dt>Response</dt><dd>{def.response}</dd><dt>Last evaluated</dt><dd>{cfg.lastEvaluatedAt ? fmtDateTime(cfg.lastEvaluatedAt) : "—"}</dd><dt>Now</dt><dd>{res.summary}</dd></dl>
      {dirty && canWrite && <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={save}>Save & re-evaluate</button><button className="btn" onClick={() => { setV({ enabled: cfg.enabled, value: cfg.value, severity: cfg.severity, params: cfg.params }); setErr(null); }}>Discard</button></div>}
    </Card>
  );
}
function RulesTab() {
  const { state } = useApp();
  const rules = state!.data.rules;
  return (
    <div className="stack">
      <Banner>Eight core rules come from the project brief; the rest are additional safeguards. Rules that lack data show <b>Awaiting data</b> instead of a number — never a misleading alert.</Banner>
      <div className="section-title">Core rules (project brief)</div>
      {RULE_DEFS.filter((d) => d.group === "core").map((d) => <RuleCard key={d.key} def={d} cfg={rules.find((r) => r.key === d.key)!} />)}
      <div className="section-title">Additional alerts</div>
      {RULE_DEFS.filter((d) => d.group === "additional").map((d) => <RuleCard key={d.key} def={d} cfg={rules.find((r) => r.key === d.key)!} />)}
    </div>
  );
}

function SettingsTab() {
  const { state, clientId, run, canWrite } = useApp();
  const st = state!.data.settings;
  const [w, setW] = useState<HealthWeights>(st.healthWeights);
  const [months, setMonths] = useState(String(st.emergencyMonthsTarget));
  const [stale, setStale] = useState(String(st.stalenessDays));
  const [mult, setMult] = useState(String(st.insuranceLifeCoverMultiple));
  const [bands, setBands] = useState(st.scoreBands);
  useEffect(() => { setW(st.healthWeights); setMonths(String(st.emergencyMonthsTarget)); setStale(String(st.stalenessDays)); setMult(String(st.insuranceLifeCoverMultiple)); setBands(st.scoreBands); }, [st]);
  const totalW = Object.values(w).reduce((a, b) => a + b, 0);
  const patch = (p: object, m: string) => run(() => api.patch(`/api/clients/${clientId}/settings`, p), m);
  const cats = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];
  const toggle = (arr: AssetClass[], c: AssetClass) => (arr.includes(c) ? arr.filter((x) => x !== c) : [...arr, c]);
  return (
    <div className="stack">
      <Card title="Financial-health score weights" subtitle="Weights are re-normalised across assessed components, so they don’t have to add to 100.">
        <div className="form-grid">{(Object.keys(w) as Array<keyof HealthWeights>).map((k) => <Field key={k} label={HEALTH_LABELS[k]}><input type="number" min={0} max={100} value={w[k]} disabled={!canWrite} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} /></Field>)}</div>
        <div className="row" style={{ marginTop: 10 }}><span className="small muted">Total {totalW} {totalW === 100 ? "" : "(shares are computed as weight ÷ total)"}</span><button className="btn primary" disabled={!canWrite || totalW <= 0} onClick={() => patch({ healthWeights: w }, "Weights saved — score recalculated")}>Save weights</button><button className="btn" onClick={() => setW({ net_worth: 20, cash_flow: 20, emergency: 20, debt: 15, diversification: 15, insurance: 10 })}>Reset to default</button></div>
        <div className="row" style={{ marginTop: 14 }}><b className="small">Score bands (minimum score → label)</b>{bands.map((b, i) => <span key={i} className="row" style={{ gap: 4 }}><input aria-label={`Band ${i + 1} minimum`} type="number" min={0} max={100} value={b.min} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)))} style={{ width: 64 }} disabled={i === 0 || !canWrite} /><input aria-label={`Band ${i + 1} label`} value={b.label} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} style={{ width: 130 }} disabled={!canWrite} /></span>)}<button className="btn sm" disabled={!canWrite} onClick={() => patch({ scoreBands: bands }, "Bands saved")}>Save bands</button></div>
      </Card>
      <Card title="Thresholds & definitions">
        <div className="form-grid">
          <Field label="Emergency-fund target (months of essential expenses)"><input type="number" min={0} value={months} disabled={!canWrite} onChange={(e) => setMonths(e.target.value)} /></Field>
          <Field label="Stale-valuation limit (days)"><input type="number" min={1} value={stale} disabled={!canWrite} onChange={(e) => setStale(e.target.value)} /></Field>
          <Field label="Target life cover (× annual income)"><input type="number" min={0} value={mult} disabled={!canWrite} onChange={(e) => setMult(e.target.value)} /></Field>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="btn primary" disabled={!canWrite} onClick={() => patch({ emergencyMonthsTarget: Number(months), stalenessDays: Number(stale), insuranceLifeCoverMultiple: Number(mult) }, "Settings saved")}>Save</button></div>
      </Card>
      <Card title="Savings-rate definition" subtitle="Savings rate = (income − spending) ÷ income. Tick the categories that count as saving (not spending).">
        <div className="row">{cats.filter((c) => !(INCOME_CATEGORIES as readonly string[]).includes(c)).map((c) => <label key={c} className="check"><input type="checkbox" disabled={!canWrite} checked={st.savingsExcludedCategories.includes(c as never)} onChange={() => patch({ savingsExcludedCategories: st.savingsExcludedCategories.includes(c as never) ? st.savingsExcludedCategories.filter((x) => x !== c) : [...st.savingsExcludedCategories, c] }, "Savings definition updated")} />{CASHFLOW_LABEL[c as keyof typeof CASHFLOW_LABEL]}</label>)}</div>
      </Card>
      <Card title="Growth vs defensive grouping" subtitle="Used for the 50:50 / 70:30 case-study split. Direct real estate is excluded by default.">
        <table className="tbl"><tbody>{ASSET_CLASSES.map((c) => <tr key={c}><td>{classLabel(c)}</td><td><label className="check"><input type="checkbox" disabled={!canWrite} checked={st.groupGrowth.includes(c)} onChange={() => patch({ groupGrowth: toggle(st.groupGrowth, c), groupDefensive: st.groupDefensive.filter((x) => x !== c) }, "Grouping updated")} />Growth</label></td><td><label className="check"><input type="checkbox" disabled={!canWrite} checked={st.groupDefensive.includes(c)} onChange={() => patch({ groupDefensive: toggle(st.groupDefensive, c), groupGrowth: st.groupGrowth.filter((x) => x !== c) }, "Grouping updated")} />Defensive</label></td></tr>)}</tbody></table>
      </Card>
    </div>
  );
}
export { SevBadge };
