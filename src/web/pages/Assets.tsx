import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../store";
import { Badge, Banner, Card, DataTable, Empty, Field, Icon, ICONS, Modal, PageHead, Segmented, Tabs, classColor, fmtDate, type Col } from "../ui";
import { formatCompact, formatINR, formatPct, pct, sum } from "@shared/money";
import { ASSET_CLASSES, ASSET_CLASS_LABEL, CASHFLOW_LABEL, INSTRUMENT_LABEL, INSTRUMENT_TYPES, LIABILITY_LABEL, LIQUIDITY_LABEL, DATA_STATUS_LABEL } from "@shared/taxonomy";
import type { Holding, Liability, Commitment, InsurancePolicy, Transaction } from "@shared/types";
import { EntityForm, type EntityName } from "../forms";
import { AddButton, ClassBadge } from "./common";

type Tab = "assets" | "liabilities" | "commitments" | "insurance" | "transactions" | "archived";
type GroupBy = "none" | "class" | "instrument" | "account" | "institution";
const eff = (h: Holding) => h.classOverride ?? h.assetClass;

export function AssetsPage() {
  const { state, canWrite } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "assets";
  const setTab = (t: Tab) => setSp((p) => { p.set("tab", t); return p; });
  const s = state!, d = s.data;
  const [form, setForm] = useState<null | { entity: EntityName; initial?: any; defaults?: any; title?: string }>(null);
  const [detail, setDetail] = useState<Holding | null>(null);
  const live = (x: { archived: boolean }) => !x.archived;

  return (
    <>
      <PageHead title="Assets & liabilities" subtitle="Separate views for what you own, what you owe and what you are contractually committed to pay. Each amount type has its own label so they are never mixed."
        actions={tab === "assets" ? <AddButton onClick={() => setForm({ entity: "holdings" })}>Add holding</AddButton> : tab === "liabilities" ? <AddButton onClick={() => setForm({ entity: "liabilities" })}>Add liability</AddButton> : tab === "commitments" ? <AddButton onClick={() => setForm({ entity: "commitments" })}>Add commitment</AddButton> : tab === "insurance" ? <AddButton onClick={() => setForm({ entity: "policies" })}>Add policy</AddButton> : tab === "transactions" ? <AddButton onClick={() => setForm({ entity: "transactions" })}>Record transaction</AddButton> : null} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: "assets", label: "Assets & accounts", count: d.holdings.filter(live).length }, { id: "liabilities", label: "Liabilities", count: d.liabilities.filter(live).length },
        { id: "commitments", label: "Commitments & pension", count: d.commitments.filter(live).length }, { id: "insurance", label: "Insurance", count: d.policies.filter(live).length },
        { id: "transactions", label: "Transactions", count: d.transactions.length }, { id: "archived", label: "Archived" }]} />

      {tab === "assets" && <AssetsTab onEdit={(h) => setForm({ entity: "holdings", initial: h })} onAdd={(defaults, title) => setForm({ entity: "holdings", defaults, title })} onDetail={setDetail} />}
      {tab === "liabilities" && <LiabilitiesTab onEdit={(l) => setForm({ entity: "liabilities", initial: l })} />}
      {tab === "commitments" && <CommitmentsTab onEdit={(c) => setForm({ entity: "commitments", initial: c })} />}
      {tab === "insurance" && <InsuranceTab onEdit={(p) => setForm({ entity: "policies", initial: p })} />}
      {tab === "transactions" && <TransactionsTab />}
      {tab === "archived" && <ArchivedTab />}
      {form && <EntityForm {...form} onClose={() => setForm(null)} />}
      {detail && <HoldingDetail id={detail.id} onClose={() => setDetail(null)} onEdit={(h) => { setDetail(null); setForm({ entity: "holdings", initial: h }); }} onAddUnder={(h) => { setDetail(null); setForm({ entity: "holdings", defaults: { parentId: h.id }, title: `Add underlying position of ${h.name}` }); }} />}
      {!canWrite && null}
    </>
  );
}

function AssetsTab({ onEdit, onAdd, onDetail }: { onEdit: (h: Holding) => void; onAdd: (d: any, title?: string) => void; onDetail: (h: Holding) => void }) {
  const { state, clientId, run, canWrite } = useApp();
  const [sp] = useSearchParams();
  const s = state!, d = s.data, ev = s.evaluation;
  const [group, setGroup] = useState<GroupBy>("none");
  const [fc, setFc] = useState(""), [fi, setFi] = useState(""), [fs, setFs] = useState("");
  const q = sp.get("q") ?? "";
  const all = d.holdings.filter((h) => !h.archived);
  const byParent = useMemo(() => { const m = new Map<string, Holding[]>(); for (const h of all) if (h.parentId) m.set(h.parentId, [...(m.get(h.parentId) ?? []), h]); return m; }, [all]);
  const recon = new Map(ev.portfolio.reconciliation.map((r) => [r.parentId, r]));
  const matches = (h: Holding) => (!fc || (fc === "review" ? eff(h) == null : eff(h) === fc)) && (!fi || h.instrumentType === fi) && (!fs || h.dataStatus === fs) && (!q || `${h.name} ${h.account ?? ""} ${h.issuer ?? ""} ${h.symbol ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  const rows = useMemo(() => {
    // parent first, children after; a child that matches pulls in its parent
    const ids = new Set<string>();
    for (const h of all) if (matches(h)) { ids.add(h.id); if (h.parentId) ids.add(h.parentId); }
    const out: Array<Holding & { depth: number }> = [];
    for (const h of all.filter((x) => !x.parentId || !all.some((p) => p.id === x.parentId))) {
      if (!ids.has(h.id)) continue;
      out.push({ ...h, depth: 0 });
      for (const k of byParent.get(h.id) ?? []) if (ids.has(k.id) || !(fc || fi || fs || q)) out.push({ ...k, depth: 1 });
    }
    return out;
  }, [all, fc, fi, fs, q]);

  const keyOf = (h: Holding): string => group === "class" ? (eff(h) ? ASSET_CLASS_LABEL[eff(h)!] : "Needs review") : group === "instrument" ? INSTRUMENT_LABEL[h.instrumentType] : group === "account" ? h.account ?? "No account recorded" : group === "institution" ? h.issuer ?? "No institution recorded" : "";
  const groups = useMemo(() => {
    if (group === "none") return [{ key: "", rows }];
    const m = new Map<string, typeof rows>();
    for (const r of rows) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]);
    return [...m.entries()].map(([key, rs]) => ({ key, rows: rs }));
  }, [rows, group]);

  const effValue = (h: Holding) => (byParent.has(h.id) ? undefined : h.currentValue);
  const total = sum(ev.portfolio.lines.map((l) => l.value));

  const cols: Col<Holding & { depth: number }>[] = [
    { key: "n", label: "Holding", sort: (h) => h.name, render: (h) => (
      <div style={{ paddingLeft: h.depth * 18 }}><a href="#" onClick={(e) => { e.preventDefault(); onDetail(h); }}><b>{h.depth ? "↳ " : ""}{h.name}</b></a>
        <div className="small muted">{INSTRUMENT_LABEL[h.instrumentType]}{h.account ? ` · ${h.account}` : ""}{h.isAggregate && <> · <Badge tone="info">aggregate</Badge></>}{h.parentId && <> · <Badge tone="outline">underlying</Badge></>}</div></div>) },
    { key: "c", label: "Category", render: (h) => <ClassBadge h={h} />, sort: (h) => eff(h) ?? "~" },
    { key: "v", label: "Market value", right: true, sort: (h) => h.currentValue, render: (h) => <div>{formatCompact(h.currentValue)}{byParent.has(h.id) && recon.get(h.id) && <div className="small muted">{recon.get(h.id)!.kind === "unallocated_remainder" ? `${formatCompact(recon.get(h.id)!.childrenValue)} split · ${formatCompact(recon.get(h.id)!.difference)} unallocated` : `underlying exceeds by ${formatCompact(recon.get(h.id)!.difference)}`}</div>}{byParent.has(h.id) && !recon.get(h.id) && <div className="small muted">fully split</div>}</div> },
    { key: "i", label: "Invested capital", right: true, sort: (h) => h.investedValue, render: (h) => h.investedValue == null ? <span className="muted">—</span> : formatCompact(h.investedValue) },
    { key: "g", label: "Unrealised gain", right: true, sort: (h) => (h.investedValue == null ? null : h.currentValue - h.investedValue), render: (h) => h.investedValue == null ? <span className="muted">—</span> : <span style={{ color: h.currentValue >= h.investedValue ? "var(--good)" : "var(--crit)" }}>{formatCompact(h.currentValue - h.investedValue)} <span className="small">({formatPct(pct(h.currentValue - h.investedValue, h.investedValue))})</span></span> },
    { key: "a", label: "Acquired", sort: (h) => h.acquisitionDate, render: (h) => fmtDate(h.acquisitionDate) },
    { key: "vd", label: "Valued on", sort: (h) => h.valuationDate, render: (h) => h.valuationDate ? fmtDate(h.valuationDate) : <Badge tone="warn">not recorded</Badge> },
    { key: "l", label: "Liquidity", render: (h) => <span className="small" title={LIQUIDITY_LABEL[h.liquidityTier]}>Tier {h.liquidityTier}</span> },
    { key: "s", label: "Status", render: (h) => <Badge tone={h.dataStatus === "collected" ? "good" : h.dataStatus === "needs_review" ? "serious" : h.dataStatus === "pending" ? "warn" : ""}>{DATA_STATUS_LABEL[h.dataStatus]}</Badge> },
    { key: "x", label: "", render: (h) => canWrite ? (
      <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
        <button className="btn sm" onClick={() => onEdit(h)} aria-label={`Edit ${h.name}`}><Icon d={ICONS.edit} size={13} /></button>
        {!h.parentId && (h.isAggregate || h.instrumentType === "mutual_fund_aggregate" || h.instrumentType === "pms" || h.instrumentType === "aif") && <button className="btn sm" onClick={() => onAdd({ parentId: h.id }, `Add underlying position of ${h.name}`)} title="Split this aggregate into underlying schemes / securities"><Icon d={ICONS.plus} size={13} />Underlying</button>}
        <button className="btn sm" onClick={() => { if (confirm(`Archive "${h.name}"? It can be restored from the Archived tab.`)) run(() => api.del(`/api/clients/${clientId}/holdings/${h.id}`), "Archived"); }} aria-label={`Archive ${h.name}`}><Icon d={ICONS.trash} size={13} /></button>
      </div>) : null },
  ];
  return (
    <div className="stack">
      <div className="grid g3">
        <Card title="Gross assets" ><b className="num" style={{ fontSize: 22 }}>{formatCompact(total)}</b><div className="small muted">{ev.portfolio.lines.length} unique positions · {formatINR(total)}</div></Card>
        <Card title="Needs attention"><b className="num" style={{ fontSize: 22 }}>{ev.portfolio.needsReview.length}</b><div className="small muted">positions are provisional or unclassified ({formatCompact(sum(ev.portfolio.needsReview.map((l) => l.value)))})</div></Card>
        <Card title="Amount types"><div className="small sec"><b>Market value</b> = what it is worth now · <b>Invested capital</b> = cost paid · <b>Account balance</b> = bank money · <b>Outstanding principal</b> = what you owe · <b>Contractual commitment</b> = future premiums owed. Sum assured and pension receipts are never counted as assets.</div></Card>
      </div>
      <Card pad>
        <div className="toolbar">
          <select aria-label="Filter by class" value={fc} onChange={(e) => setFc(e.target.value)} style={{ width: "auto" }}><option value="">All categories</option>{ASSET_CLASSES.map((c) => <option key={c} value={c}>{ASSET_CLASS_LABEL[c]}</option>)}<option value="review">Needs review</option></select>
          <select aria-label="Filter by instrument" value={fi} onChange={(e) => setFi(e.target.value)} style={{ width: "auto" }}><option value="">All instruments</option>{INSTRUMENT_TYPES.map((t) => <option key={t} value={t}>{INSTRUMENT_LABEL[t]}</option>)}</select>
          <select aria-label="Filter by status" value={fs} onChange={(e) => setFs(e.target.value)} style={{ width: "auto" }}><option value="">Any status</option>{Object.entries(DATA_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <span className="small muted">Group by</span>
          <Segmented<GroupBy> label="Group by" value={group} onChange={setGroup} options={[{ id: "none", label: "None" }, { id: "class", label: "Category" }, { id: "instrument", label: "Instrument" }, { id: "account", label: "Account" }, { id: "institution", label: "Institution" }]} />
          {q && <Badge tone="info">search: {q}</Badge>}
        </div>
        {all.length === 0 ? <Empty title="No holdings yet" action={canWrite ? <button className="btn primary" onClick={() => onAdd({})}>Add your first holding</button> : undefined}>Add holdings one by one or import a CSV/Excel file from Data collection.</Empty> :
          groups.map((g) => (
            <div key={g.key || "all"} style={{ marginBottom: 14 }}>
              {group !== "none" && <div className="row between" style={{ margin: "6px 0" }}><b>{g.key}</b><span className="small muted num">{formatCompact(sum(g.rows.filter((r) => effValue(r) !== undefined).map((r) => r.currentValue)))}</span></div>}
              <DataTable cols={cols} rows={g.rows} search={group === "none" ? undefined : undefined} pageSize={200} empty={<Empty title="No matching holdings" />} rowClass={(h) => (h.depth ? "child" : "")} />
            </div>))}
      </Card>
    </div>
  );
}

function HoldingDetail({ id, onClose, onEdit, onAddUnder }: { id: string; onClose: () => void; onEdit: (h: Holding) => void; onAddUnder: (h: Holding) => void }) {
  const { state, clientId, run, canWrite } = useApp();
  const s = state!, d = s.data;
  const h = d.holdings.find((x) => x.id === id);
  const [cls, setCls] = useState("");
  useEffect(() => setCls(h?.classOverride ?? ""), [h?.classOverride]);
  if (!h) return null;
  const kids = d.holdings.filter((k) => k.parentId === id && !k.archived);
  const vals = d.valuations.filter((v) => v.holdingId === id).sort((a, b) => b.date.localeCompare(a.date));
  const tx = d.transactions.filter((t) => t.holdingId === id);
  const recon = s.evaluation.portfolio.reconciliation.find((r) => r.parentId === id);
  const flow = (types: string[]) => sum(tx.filter((t) => types.includes(t.type)).map((t) => t.amount));
  return (
    <Modal drawer title={h.name} onClose={onClose} footer={<>{canWrite && <button className="btn" onClick={() => onEdit(h)}>Edit</button>}<button className="btn" onClick={onClose}>Close</button></>}>
      <div className="stack">
        <dl className="dl">
          <dt>Instrument</dt><dd>{INSTRUMENT_LABEL[h.instrumentType]} {h.isAggregate && <Badge tone="info">aggregate</Badge>} {h.parentId && <Badge tone="outline">underlying</Badge>}</dd>
          <dt>Market value</dt><dd className="num"><b>{formatINR(h.currentValue)}</b></dd><dt>Invested capital</dt><dd className="num">{h.investedValue == null ? "Not recorded" : formatINR(h.investedValue)}</dd>
          <dt>Valuation</dt><dd>{h.valuationDate ? fmtDate(h.valuationDate) : "Date not recorded"} · source {h.valuationSource}</dd><dt>Liquidity</dt><dd>{LIQUIDITY_LABEL[h.liquidityTier]}</dd>
          {h.maturityDate && <><dt>Matures</dt><dd>{fmtDate(h.maturityDate)}{h.expectedMaturityValue ? ` · expected ${formatCompact(h.expectedMaturityValue)}` : ""}</dd></>}
          {h.notes && <><dt>Notes</dt><dd>{h.notes}</dd></>}
        </dl>
        <Card title="Classification" subtitle="Every record keeps its original description, result, method and status">
          <dl className="dl"><dt>Original description</dt><dd>{h.originalDescription}</dd><dt>Result</dt><dd><ClassBadge h={h} /></dd><dt>Method</dt><dd>{h.classificationMethod.replace("_", " ")} · {h.classificationStatus.replace("_", " ")}</dd><dt>Why</dt><dd>{h.classificationReason}</dd></dl>
          {canWrite && <div className="row" style={{ marginTop: 10 }}><select aria-label="Override category" value={cls} onChange={(e) => setCls(e.target.value)} style={{ width: "auto" }}><option value="">Automatic (no override)</option>{ASSET_CLASSES.map((c) => <option key={c} value={c}>{ASSET_CLASS_LABEL[c]}</option>)}</select>
            <button className="btn" disabled={(cls || null) === h.classOverride} onClick={() => run(() => api.post(`/api/clients/${clientId}/holdings/${id}/override`, { assetClass: cls || null }), "Category override saved")}>Apply override</button></div>}
        </Card>
        {(kids.length > 0 || h.isAggregate || ["pms", "aif", "mutual_fund_aggregate"].includes(h.instrumentType)) && !h.parentId && (
          <Card title="Underlying positions" actions={canWrite ? <button className="btn sm" onClick={() => onAddUnder(h)}><Icon d={ICONS.plus} size={13} />Add</button> : undefined}>
            {kids.length === 0 ? <p className="small sec">None entered. The aggregate stays at {formatCompact(h.currentValue)} and is counted once. As you add schemes/securities, they replace that amount; any difference stays as an “unallocated remainder”.</p> :
              <><table className="tbl"><tbody>{kids.map((k) => <tr key={k.id}><td>{k.name}</td><td><ClassBadge h={k} /></td><td className="r num">{formatCompact(k.currentValue)}</td></tr>)}</tbody></table>
                <div className="small" style={{ marginTop: 8 }}>Underlying total <b className="num">{formatCompact(sum(kids.map((k) => k.currentValue)))}</b> of aggregate <b className="num">{formatCompact(h.currentValue)}</b>.</div></>}
            {recon && <div style={{ marginTop: 8 }}><Banner tone="warn" title="Needs reconciliation.">{recon.kind === "unallocated_remainder" ? `${formatCompact(recon.difference)} of the aggregate has no underlying position yet and is kept as “unallocated remainder” (still counted once).` : `Underlying positions exceed the aggregate by ${formatCompact(recon.difference)}. Confirm to set the aggregate to the underlying total.`}
              {canWrite && recon.kind === "children_exceed_aggregate" && <> <button className="btn sm" onClick={() => run(() => api.post(`/api/clients/${clientId}/holdings/${id}/reconcile`), "Aggregate updated to underlying total")}>Confirm new total</button></>}
              {canWrite && recon.kind === "unallocated_remainder" && kids.length > 0 && <> <button className="btn sm" onClick={() => { if (confirm("Set the aggregate value to the sum of the underlying positions? This lowers the aggregate by the unallocated amount.")) run(() => api.post(`/api/clients/${clientId}/holdings/${id}/reconcile`), "Aggregate updated to underlying total"); }}>Accept underlying total</button></>}</Banner></div>}
          </Card>)}
        <Card title="Valuation history">{vals.length === 0 ? <p className="small muted">No dated valuations recorded.</p> : <table className="tbl"><tbody>{vals.slice(0, 12).map((v) => <tr key={v.id}><td>{fmtDate(v.date)}</td><td className="small muted">{v.source}{v.note ? ` · ${v.note}` : ""}</td><td className="r num">{formatCompact(v.value)}</td></tr>)}</tbody></table>}</Card>
        <Card title="Cash flows & gains" subtitle="Realised gains need a cost basis per sale; totals shown instead">
          {tx.length === 0 ? <p className="small muted">No transactions. Record purchases / contributions / distributions to enable XIRR.</p> : <dl className="dl"><dt>Purchases & contributions</dt><dd className="num">{formatCompact(flow(["purchase", "contribution"]))}</dd><dt>Sales & withdrawals</dt><dd className="num">{formatCompact(flow(["sale", "withdrawal"]))}</dd><dt>Dividends & distributions</dt><dd className="num">{formatCompact(flow(["dividend", "distribution"]))}</dd></dl>}
          <div className="small" style={{ marginTop: 6 }}>Unrealised gain: {h.investedValue == null ? "n/a (invested capital missing)" : `${formatCompact(h.currentValue - h.investedValue)} (${formatPct(pct(h.currentValue - h.investedValue, h.investedValue))})`}</div>
        </Card>
        <p className="small muted">Supporting documents are not stored in this build (see Limitations in the documentation); use the Notes field to reference where originals are kept.</p>
      </div>
    </Modal>
  );
}

function LiabilitiesTab({ onEdit }: { onEdit: (l: Liability) => void }) {
  const { state, clientId, run, canWrite } = useApp();
  const d = state!.data, nw = state!.evaluation.netWorth;
  const rows = d.liabilities.filter((l) => !l.archived);
  return (
    <div className="stack">
      {nw.liabilitiesStatus !== "complete" && <Banner tone="warn" title={nw.liabilitiesStatus === "not_assessed" ? "Liabilities not yet assessed." : "Liabilities partly recorded."}>
        Net worth {nw.liabilitiesStatus === "not_assessed" ? "is not calculated" : "is provisional"} until every loan and card balance is entered. {canWrite && <>Once complete (or if there are none), <button className="btn sm" onClick={() => run(() => api.patch(`/api/clients/${clientId}/settings`, { liabilitiesStatus: "complete" }), "Marked liabilities as complete")}>mark the liability list complete</button></>}</Banner>}
      {nw.liabilitiesStatus === "complete" && canWrite && <div><button className="btn sm" onClick={() => run(() => api.patch(`/api/clients/${clientId}/settings`, { liabilitiesStatus: rows.length ? "partial" : "not_assessed" }), "Re-opened liabilities")}>Re-open liabilities as incomplete</button></div>}
      <Card>
        <DataTable rows={rows} search={(l) => `${l.name} ${l.lender ?? ""} ${LIABILITY_LABEL[l.type]}`} defaultSort={{ key: "o", dir: -1 }} empty={<Empty title="No liabilities recorded">This does not mean you have no debt — add loans, EMIs and credit-card balances.</Empty>}
          cols={[{ key: "n", label: "Liability", sort: (l) => l.name, render: (l) => <div><b>{l.name}</b><div className="small muted">{LIABILITY_LABEL[l.type]}{l.lender ? ` · ${l.lender}` : ""}{l.isIllustrative && <> · <Badge tone="outline">illustrative</Badge></>}</div></div> },
            { key: "o", label: "Outstanding principal", right: true, sort: (l) => l.outstanding, render: (l) => formatCompact(l.outstanding) }, { key: "e", label: "EMI", right: true, sort: (l) => l.emi, render: (l) => l.type === "credit_card" ? <span className="muted small">n/a (card)</span> : l.emi ? formatCompact(l.emi) : "—" },
            { key: "r", label: "Rate", right: true, render: (l) => (l.rateBps == null ? "—" : `${(l.rateBps / 100).toFixed(2)}%`) }, { key: "m", label: "Months left", right: true, render: (l) => l.remainingMonths ?? "—" },
            { key: "x", label: "", render: (l) => canWrite ? <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}><button className="btn sm" onClick={() => onEdit(l)} aria-label={`Edit ${l.name}`}><Icon d={ICONS.edit} size={13} /></button><button className="btn sm" aria-label={`Archive ${l.name}`} onClick={() => confirm(`Archive "${l.name}"?`) && run(() => api.del(`/api/clients/${clientId}/liabilities/${l.id}`), "Archived")}><Icon d={ICONS.trash} size={13} /></button></div> : null }]} />
        {rows.length > 0 && <div className="row between" style={{ marginTop: 10 }}><b>Total confirmed outstanding</b><b className="num">{formatINR(nw.liabilities)}</b></div>}
      </Card>
      <p className="small muted">Credit-card outstanding balances are liabilities; they are not treated as EMIs, so a card balance and its repayment are never counted twice.</p>
    </div>
  );
}

function CommitmentsTab({ onEdit }: { onEdit: (c: Commitment) => void }) {
  const { state, clientId, run, canWrite } = useApp();
  const rows = state!.data.commitments.filter((c) => !c.archived);
  return (
    <div className="stack">
      <Banner>Contractual commitments (e.g. remaining pension premiums) are <b>future cash outflows</b>, not loans. They are reported separately from liabilities and only enter the “adjusted net worth” view.</Banner>
      <Card><DataTable rows={rows} empty={<Empty title="No commitments recorded" />} cols={[
        { key: "n", label: "Commitment", render: (c) => <div><b>{c.name}</b><div className="small muted">{c.kind.replace("_", " ")}{c.annualReceivable ? ` · annual pension receivable ${formatCompact(c.annualReceivable)}` : ""}</div></div> },
        { key: "t", label: "Total", right: true, render: (c) => formatCompact(c.totalAmount) }, { key: "p", label: "Paid", right: true, render: (c) => formatCompact(c.paidAmount) },
        { key: "r", label: "Contractual commitment remaining", right: true, render: (c) => <b>{formatCompact(c.totalAmount - c.paidAmount)}</b> },
        { key: "s", label: "Schedule", render: (c) => c.nextDueDate && c.installmentAmount ? <span className="small">{formatCompact(c.installmentAmount)} {c.frequency?.replace("_", "-")} from {fmtDate(c.nextDueDate)}</span> : <Badge tone="warn">schedule pending</Badge> },
        { key: "x", label: "", render: (c) => canWrite ? <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}><button className="btn sm" onClick={() => onEdit(c)}><Icon d={ICONS.edit} size={13} /></button><button className="btn sm" onClick={() => confirm("Archive this commitment?") && run(() => api.del(`/api/clients/${clientId}/commitments/${c.id}`), "Archived")}><Icon d={ICONS.trash} size={13} /></button></div> : null }]} /></Card>
    </div>
  );
}

function InsuranceTab({ onEdit }: { onEdit: (p: InsurancePolicy) => void }) {
  const { state, clientId, run, canWrite } = useApp();
  const rows = state!.data.policies.filter((p) => !p.archived);
  return (
    <div className="stack">
      <Banner>Sum assured is <b>cover</b>, not an asset. It is used only in the insurance-adequacy score and renewal reminders; it never adds to net worth or emergency funds.</Banner>
      <Card><DataTable rows={rows} empty={<Empty title="No policies recorded">Add life, health and other cover to enable the insurance score and renewal alerts.</Empty>} cols={[
        { key: "t", label: "Policy", render: (p) => <div><b>{p.insurer ?? "Policy"} — {p.type.replace("_", " ")}</b><div className="small muted">{p.policyNo ?? ""}</div></div> }, { key: "s", label: "Sum assured (cover)", right: true, render: (p) => (p.sumAssured ? formatCompact(p.sumAssured) : "—") },
        { key: "a", label: "Annual premium", right: true, render: (p) => (p.annualPremium ? formatCompact(p.annualPremium) : "—") }, { key: "n", label: "Next premium", render: (p) => fmtDate(p.nextPremiumDate) }, { key: "r", label: "Renewal", render: (p) => fmtDate(p.renewalDate) },
        { key: "x", label: "", render: (p) => canWrite ? <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}><button className="btn sm" onClick={() => onEdit(p)}><Icon d={ICONS.edit} size={13} /></button><button className="btn sm" onClick={() => confirm("Archive this policy?") && run(() => api.del(`/api/clients/${clientId}/policies/${p.id}`), "Archived")}><Icon d={ICONS.trash} size={13} /></button></div> : null }]} /></Card>
    </div>
  );
}

function TransactionsTab() {
  const { state, clientId, run, canWrite } = useApp();
  const d = state!.data;
  const name = new Map(d.holdings.map((h) => [h.id, h.name]));
  return (
    <Card><DataTable rows={[...d.transactions].sort((a, b) => b.date.localeCompare(a.date))} search={(t) => `${t.type} ${name.get(t.holdingId ?? "") ?? ""} ${t.notes ?? ""}`} defaultSort={{ key: "d", dir: -1 }}
      empty={<Empty title="No transactions recorded">Dated cash flows (purchases, contributions, withdrawals, dividends, fees) feed XIRR and the net-worth change analysis.</Empty>}
      cols={[{ key: "d", label: "Date", sort: (t) => t.date, render: (t) => fmtDate(t.date) }, { key: "t", label: "Type", render: (t) => t.type }, { key: "h", label: "Holding", render: (t) => name.get(t.holdingId ?? "") ?? "Whole portfolio" },
        { key: "a", label: "Amount", right: true, sort: (t) => t.amount, render: (t) => formatINR(t.amount) }, { key: "x", label: "", render: (t: Transaction) => canWrite ? <button className="btn sm" aria-label="Delete transaction" onClick={() => confirm("Delete this transaction?") && run(() => api.del(`/api/clients/${clientId}/transactions/${t.id}`), "Deleted")}><Icon d={ICONS.trash} size={13} /></button> : null }]} /></Card>
  );
}

function ArchivedTab() {
  const { clientId, run, canWrite, state } = useApp();
  const [items, setItems] = useState<Array<{ entity: EntityName; id: string; name: string }>>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    (async () => {
      const out: typeof items = [];
      for (const e of ["holdings", "liabilities", "cashflows", "commitments", "policies", "goals"] as EntityName[]) {
        const r = await api.get(`/api/clients/${clientId}/archived/${e}`).catch(() => ({ items: [] }));
        for (const it of r.items) out.push({ entity: e, id: it.id, name: it.name ?? `${it.insurer ?? ""} ${it.type ?? ""}` });
      }
      setItems(out);
    })();
  }, [clientId, tick, state?.serverTime]);
  return (
    <Card>{items.length === 0 ? <Empty title="Nothing archived" /> : <table className="tbl"><tbody>{items.map((i) => (
      <tr key={i.id}><td>{i.name}</td><td className="muted">{i.entity}</td><td className="r">{canWrite && <button className="btn sm" onClick={async () => { await run(() => api.post(`/api/clients/${clientId}/${i.entity}/${i.id}/restore`), "Restored"); setTick(tick + 1); }}>Restore</button>}</td></tr>))}</tbody></table>}</Card>
  );
}
