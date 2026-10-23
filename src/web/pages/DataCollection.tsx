import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { useApp } from "../store";
import { Badge, Banner, Card, DataTable, Empty, Field, Icon, ICONS, MoneyInput, PageHead, Tabs, download, fmtDate, SevBadge } from "../ui";
import { formatCompact } from "@shared/money";
import { ASSET_CLASSES, ASSET_CLASS_LABEL, DATA_STATUS_LABEL, type DataStatus } from "@shared/taxonomy";
import type { Holding } from "@shared/types";
import { ClassBadge } from "./common";

const TONE: Record<DataStatus, "good" | "warn" | "serious" | ""> = { collected: "good", pending: "warn", needs_review: "serious", not_applicable: "" };
type Tab = "checklist" | "import" | "history" | "review" | "mappings";

export function DataCollectionPage() {
  const [tab, setTab] = useState<Tab>("checklist");
  const { state } = useApp();
  const ev = state!.evaluation;
  return (
    <>
      <PageHead title="Data collection" subtitle="What has been supplied, what is still pending, and tools to bring it in. The app works with partial data and never fills gaps with invented numbers." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "checklist", label: "Onboarding checklist" }, { id: "import", label: "Import CSV / Excel" }, { id: "history", label: "Net-worth history", count: state!.data.snapshots.length }, { id: "review", label: "Classification review", count: ev.portfolio.needsReview.length }, { id: "mappings", label: "Category mappings" }]} />
      {tab === "checklist" && <Checklist />}{tab === "import" && <ImportPanel />}{tab === "history" && <History />}{tab === "review" && <Review />}{tab === "mappings" && <Mappings />}
    </>
  );
}

function Checklist() {
  const { state, clientId, run, canWrite } = useApp();
  const ev = state!.evaluation, st = state!.data.settings;
  return (
    <div className="stack">
      <Card><div className="row between"><div><b style={{ fontSize: 26 }} className="num">{ev.completeness.percent.toFixed(0)}%</b> <span className="muted">complete (collected = 1, needs review = ½, pending = 0)</span></div>
        <div className="row small muted">{(["collected", "pending", "needs_review", "not_applicable"] as DataStatus[]).map((s) => <Badge key={s} tone={TONE[s]}>{DATA_STATUS_LABEL[s]}: {ev.completeness.items.filter((i) => i.status === s).length}</Badge>)}</div></div></Card>
      <Card pad={false}><div className="card-b">{ev.completeness.items.map((i, n) => (
        <div key={i.key} className={`step ${i.status === "collected" ? "done" : ""}`}><div className="n">{i.status === "collected" ? <Icon d={ICONS.check} size={14} /> : n + 1}</div><div><b>{i.label}</b><div className="small muted">{i.detail}</div></div>
          <div className="row"><Badge tone={TONE[i.status]}>{DATA_STATUS_LABEL[i.status]}</Badge>{i.status !== "collected" && i.status !== "not_applicable" && <Link className="btn sm" to={i.page}>Provide</Link>}</div></div>))}</div></Card>
      <Card title="Declarations" subtitle="Tell the app when a list is complete, so ‘nothing recorded’ is not confused with ‘nothing exists’.">
        <div className="grid g2">
          <div className="row between"><span>Liabilities: <b>{st.liabilitiesStatus.replace("_", " ")}</b></span>{canWrite && <div className="row"><button className="btn sm" onClick={() => run(() => api.patch(`/api/clients/${clientId}/settings`, { liabilitiesStatus: "complete" }), "Liabilities marked complete")}>Mark complete</button></div>}</div>
          <div className="row between"><span>Income: <b>{st.incomeStatus}</b></span>{canWrite && <div className="row"><button className="btn sm" onClick={() => run(() => api.patch(`/api/clients/${clientId}/settings`, { incomeStatus: "complete" }), "Income marked complete")}>Mark complete</button></div>}</div>
        </div>
      </Card>
    </div>
  );
}

function ImportPanel() {
  const { clientId, run, canWrite, toast } = useApp();
  const [kind, setKind] = useState<"holdings" | "liabilities" | "cashflows">("holdings");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    try {
      const isX = /\.xlsx$/i.test(file.name);
      const url = `/api/clients/${clientId}/import/${kind}?${dryRun ? "dryRun=1&" : ""}filename=${encodeURIComponent(file.name)}`;
      const headers: Record<string, string> = { "X-Requested-With": "networth", "Content-Type": isX ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv" };
      const res = await fetch(url, { method: "POST", headers, body: isX ? await file.arrayBuffer() : await file.text() });
      const data = await res.json();
      if (!res.ok) throw new ApiError(res.status, data.error);
      setReport(data);
      if (!dryRun) { toast(`Imported ${data.accepted} record(s)`); setFile(null); if (ref.current) ref.current.value = ""; await run(async () => {}); }
    } catch (e) { toast(e instanceof Error ? e.message : "Import failed", "err"); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <Card title="Import" subtitle="Validate first: you’ll see accepted, rejected, duplicate and unresolved rows before anything is saved. Re-importing the same file is blocked.">
        <div className="form-grid">
          <Field label="What are you importing?"><select value={kind} onChange={(e) => { setKind(e.target.value as any); setReport(null); }}><option value="holdings">Holdings / investments</option><option value="liabilities">Liabilities</option><option value="cashflows">Income & expenses</option></select></Field>
          <Field label="File (.csv or .xlsx)"><input ref={ref} type="file" accept=".csv,.xlsx,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} /></Field>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button className="btn" disabled={!file || busy} onClick={() => send(true)}>Validate (dry run)</button><button className="btn primary" disabled={!file || busy || !canWrite || !report || report.accepted === 0 || !report.dryRun} onClick={() => send(false)}>Import {report?.accepted ?? 0} valid row(s)</button>
          <button className="btn ghost" onClick={() => download(`/api/import/template/${kind}`)}><Icon d={ICONS.download} size={14} />Download template</button></div>
        <p className="small muted" style={{ marginTop: 8 }}>Amounts accept “1,50,000”, “25L”, “1.5cr”. Dates: yyyy-mm-dd or dd/mm/yyyy. The original workbook layout isn’t assumed — use the template headers (aliases like “Scheme”, “Units”, “NAV date” are recognised).</p>
      </Card>
      {report && <Card title={report.dryRun ? "Validation result" : "Import result"} subtitle={report.filename ?? undefined}>
        {report.alreadyImported && <Banner tone="warn">This exact file was already imported for this client; committing it again will be blocked.</Banner>}
        <div className="row" style={{ margin: "8px 0" }}><Badge tone="good">{report.accepted} accepted</Badge><Badge tone="crit">{report.rejected} rejected</Badge><Badge tone="warn">{report.duplicates} duplicates</Badge><Badge tone="serious">{report.unresolved} unresolved classification</Badge><span className="small muted">of {report.total} rows</span></div>
        <DataTable dense rows={report.rows.map((r: any, i: number) => ({ ...r, id: String(i) }))} cols={[{ key: "r", label: "Row", render: (r: any) => r.row }, { key: "n", label: "Name", render: (r: any) => r.name }, { key: "s", label: "Result", render: (r: any) => <Badge tone={r.status === "accepted" ? "good" : r.status === "rejected" ? "crit" : r.status === "duplicate" ? "warn" : "serious"}>{r.status}</Badge> }, { key: "c", label: "Category", render: (r: any) => (r.category ? ASSET_CLASS_LABEL[r.category as keyof typeof ASSET_CLASS_LABEL] : "") }, { key: "w", label: "Notes", render: (r: any) => r.reason ?? "" }]} />
      </Card>}
    </div>
  );
}

function History() {
  const { state, clientId, run, canWrite, toast } = useApp();
  const snaps = state!.data.snapshots;
  const [date, setDate] = useState(""); const [gross, setGross] = useState<number | null>(null); const [liab, setLiab] = useState<number | null>(null); const [complete, setComplete] = useState(false);
  async function add() {
    try { await api.post(`/api/clients/${clientId}/snapshots`, { date, grossAssets: gross, liabilities: liab, liabilitiesComplete: complete, note: "Entered manually" }); await run(async () => {}, "Snapshot saved"); setDate(""); setGross(null); setLiab(null); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); }
  }
  return (
    <div className="stack">
      <Banner>Previous month / year wealth is never estimated. Enter the values from statements for a past date, or record today’s snapshot from the Overview each month-end. Comparisons use only like-for-like snapshots.</Banner>
      <Card title="Add a past snapshot"><div className="form-grid"><Field label="As-of date"><input type="date" value={date} max={state!.asOf} onChange={(e) => setDate(e.target.value)} /></Field><Field label="Gross assets"><MoneyInput value={gross} onChange={setGross} /></Field>
        <Field label="Liabilities (leave blank if unknown)"><MoneyInput value={liab} onChange={setLiab} /></Field><Field label="Liabilities complete then?"><label className="check"><input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} />Yes — all liabilities were included</label></Field></div>
        <div style={{ marginTop: 12 }}><button className="btn primary" disabled={!canWrite || !date || gross == null} onClick={add}>Save snapshot</button></div></Card>
      <Card title="Recorded snapshots"><DataTable rows={[...snaps].reverse()} empty={<Empty title="No snapshots yet" />} cols={[{ key: "d", label: "Date", render: (s) => fmtDate(s.date) }, { key: "g", label: "Gross assets", right: true, render: (s) => formatCompact(s.grossAssets) }, { key: "l", label: "Liabilities", right: true, render: (s) => (s.liabilities == null ? "n/a" : formatCompact(s.liabilities)) }, { key: "n", label: "Net worth", right: true, render: (s) => (s.netWorth == null ? "n/a" : formatCompact(s.netWorth)) }, { key: "c", label: "Basis", render: (s) => <Badge tone={s.liabilitiesComplete ? "good" : "warn"}>{s.liabilitiesComplete ? "complete" : "provisional"}</Badge> },
          { key: "x", label: "", render: (s) => canWrite ? <button className="btn sm" aria-label="Delete snapshot" onClick={() => confirm("Delete this snapshot?") && run(() => api.del(`/api/clients/${clientId}/snapshots/${s.id}`), "Deleted")}><Icon d={ICONS.trash} size={13} /></button> : null }]} /></Card>
    </div>
  );
}

function Review() {
  const { state, clientId, run, canWrite } = useApp();
  const d = state!.data;
  const queue = d.holdings.filter((h) => !h.archived && (h.classificationStatus !== "confirmed") && !h.classOverride);
  return (
    <div className="stack">
      <Banner>Items here were classified by a default or keyword, or couldn’t be classified. Confirm or override each one — overrides always win and are logged. {canWrite && <button className="btn sm" onClick={() => run(() => api.post(`/api/clients/${clientId}/reclassify`), "Re-ran classification")}>Re-run automatic classification</button>}</Banner>
      <Card><DataTable rows={queue} empty={<Empty title="Review queue is empty">Every holding is confirmed or overridden.</Empty>} cols={[
        { key: "n", label: "Holding", render: (h: Holding) => <div><b>{h.name}</b><div className="small muted">“{h.originalDescription}” · {h.classificationReason}</div></div> }, { key: "c", label: "Current result", render: (h: Holding) => <ClassBadge h={h} /> }, { key: "v", label: "Value", right: true, render: (h: Holding) => formatCompact(h.currentValue) },
        { key: "o", label: "Set category", render: (h: Holding) => canWrite ? <select aria-label={`Category for ${h.name}`} defaultValue="" onChange={(e) => e.target.value && run(() => api.post(`/api/clients/${clientId}/holdings/${h.id}/override`, { assetClass: e.target.value }), "Category saved")} style={{ width: 190 }}><option value="">Choose…</option>{ASSET_CLASSES.map((c) => <option key={c} value={c}>{ASSET_CLASS_LABEL[c]}</option>)}</select> : null }]} /></Card>
    </div>
  );
}

function Mappings() {
  const { state, clientId, run, canWrite } = useApp();
  const maps = state!.data.mappings;
  const [f, setF] = useState({ domain: "asset", matchType: "keyword", pattern: "", category: "indian_equity" });
  const cats = f.domain === "asset" ? ASSET_CLASSES.map((c) => [c, ASSET_CLASS_LABEL[c]]) : [["salary", "Salary"], ["business", "Business"], ["rental", "Rental"], ["interest", "Interest"], ["dividend", "Dividend"], ["pension", "Pension"], ["household", "Household"], ["medical", "Medical"], ["personal", "Personal"], ["business_expense", "Business expense"], ["loan_emi", "Loan EMI"], ["insurance_premium", "Insurance premium"], ["pension_premium", "Pension premium"], ["investment_contribution", "Investment contribution"]];
  return (
    <div className="stack">
      <Banner>Classification order: <b>your override → exact name → instrument type → keyword → review queue</b>. Seed mappings come from the brief; add your own below (they take priority).</Banner>
      <Card title="Add a mapping"><div className="form-grid">
        <Field label="Applies to"><select value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value, category: e.target.value === "asset" ? "indian_equity" : "salary" })}><option value="asset">Assets</option><option value="cashflow">Income / expenses</option></select></Field>
        <Field label="Match"><select value={f.matchType} onChange={(e) => setF({ ...f, matchType: e.target.value })}><option value="keyword">Keyword (contains)</option><option value="exact">Exact name</option></select></Field>
        <Field label="Text"><input value={f.pattern} onChange={(e) => setF({ ...f, pattern: e.target.value })} placeholder="e.g. liquid bees" /></Field>
        <Field label="Category"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field></div>
        <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={!canWrite || !f.pattern.trim()} onClick={() => run(async () => { await api.post(`/api/clients/${clientId}/mappings`, f); await api.post(`/api/clients/${clientId}/reclassify`); setF({ ...f, pattern: "" }); }, "Mapping added and holdings re-classified")}>Add & re-classify</button></div></Card>
      <Card><DataTable dense search={(m) => `${m.pattern} ${m.category}`} rows={maps} defaultSort={{ key: "p", dir: -1 }} cols={[{ key: "d", label: "Domain", render: (m) => m.domain }, { key: "t", label: "Match", render: (m) => m.matchType }, { key: "x", label: "Text", sort: (m) => m.pattern, render: (m) => m.pattern }, { key: "c", label: "Category", render: (m) => m.category }, { key: "p", label: "Priority", sort: (m) => m.priority, right: true, render: (m) => m.priority }, { key: "s", label: "Source", render: (m) => m.source },
        { key: "r", label: "", render: (m) => m.source === "user" && canWrite ? <button className="btn sm" aria-label="Delete mapping" onClick={() => run(() => api.del(`/api/clients/${clientId}/mappings/${m.id}`), "Mapping removed")}><Icon d={ICONS.trash} size={13} /></button> : null }]} /></Card>
    </div>
  );
}
export { SevBadge };
