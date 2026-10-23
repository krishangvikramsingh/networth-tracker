import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useApp } from "../store";
import { Badge, Banner, Card, DataTable, Empty, Field, Icon, ICONS, Kpi, Modal, PageHead, type Col } from "../ui";
import { formatCompact, formatPct } from "@shared/money";
import type { Coverage, CoverageRow, Nominee, NominationStatus } from "@shared/estate";
import { AddButton } from "./common";

interface Estate { nominees: Nominee[]; coverage: Coverage }
const STATUS: Record<NominationStatus, { label: string; tone: "good" | "warn" | "serious" | "" }> = {
  complete: { label: "Complete (100%)", tone: "good" }, partial: { label: "Partial", tone: "warn" }, invalid: { label: "Over 100%", tone: "serious" }, not_recorded: { label: "Not recorded", tone: "" },
};
const RELATIONS = ["Spouse", "Son", "Daughter", "Parent", "Sibling", "Other relative", "Friend", "Trust"];

export function NomineesPage() {
  const { clientId, canWrite, toast } = useApp();
  const [est, setEst] = useState<Estate | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nomineeForm, setNomineeForm] = useState<null | Nominee | "new">(null);
  const [assign, setAssign] = useState<CoverageRow | null>(null);
  const load = () => api.get<Estate>(`/api/clients/${clientId}/estate`).then(setEst).catch((e) => setErr(e.message));
  useEffect(() => { setEst(null); setErr(null); load(); }, [clientId]);
  if (err) return <Banner tone="crit">{err}</Banner>;
  if (!est) return null;
  const c = est.coverage;

  async function removeNominee(n: Nominee) {
    if (!confirm(`Remove ${n.name}? Their shares on every asset are removed too.`)) return;
    try { await api.del(`/api/clients/${clientId}/nominees/${n.id}`); toast("Nominee removed"); load(); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); }
  }
  const cols: Col<CoverageRow & { id: string }>[] = [
    { key: "name", label: "Asset or policy", render: (r) => <><b>{r.name}</b> {r.entity === "policy" && <Badge tone="outline">insurance</Badge>}</>, sort: (r) => r.name },
    { key: "value", label: "Value / cover", right: true, render: (r) => (r.value == null ? <span className="muted">—</span> : formatCompact(r.value)), sort: (r) => r.value },
    { key: "status", label: "Nomination", render: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>, sort: (r) => r.status },
    { key: "who", label: "Nominees", render: (r) => (r.shares.length ? r.shares.map((s) => `${s.nomineeName} ${formatPct(s.shareBps / 100)}`).join(", ") : <span className="muted">—</span>) },
    { key: "act", label: "", render: (r) => canWrite ? <button className="btn sm" onClick={() => setAssign(r)} disabled={est.nominees.length === 0} title={est.nominees.length === 0 ? "Add a nominee first" : undefined}>{r.shares.length ? "Edit" : "Record"}</button> : null },
  ];
  return (
    <>
      <PageHead title="Nominees & estate readiness" subtitle="Who is recorded as the nominee on each asset and policy. Nothing here moves money or contacts anyone." actions={<AddButton onClick={() => setNomineeForm("new")}>Add nominee</AddButton>} />
      <div className="stack">
        <Banner tone="info" title="Read this first.">“Not recorded” means nothing has been entered here. It does not mean no nominee exists. A nominee is the person the institution pays; legal ownership follows your will or succession law, so check both with a lawyer. Never store passwords or PINs in this tool.</Banner>
        <div className="grid g4">
          <Kpi label="Assets fully nominated" value={c.coveredPct == null ? undefined : formatPct(c.coveredPct, 0)} await={c.coveredPct == null} sub={c.coveredPct == null ? undefined : `${formatCompact(c.completeValue)} of ${formatCompact(c.totalValue)} by value`} tone={c.coveredPct != null && c.coveredPct >= 100 ? "good" : ""} />
          <Kpi label="Complete" value={c.counts.complete} sub="assets and policies at 100%" />
          <Kpi label="Partial or over 100%" value={c.counts.partial + c.counts.invalid} sub="shares need fixing" tone={c.counts.partial + c.counts.invalid ? "crit" : ""} />
          <Kpi label="Not recorded" value={c.counts.not_recorded} sub="nothing entered yet" />
        </div>

        <Card title="Nominees" subtitle="People you can assign to assets below.">
          {est.nominees.length === 0 ? <Empty title="No nominees yet" action={canWrite ? <button className="btn primary" onClick={() => setNomineeForm("new")}>Add the first nominee</button> : undefined}>Add the people who are, or should be, named on your accounts and policies.</Empty> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Relationship</th><th>Contact</th><th>Notes</th><th /></tr></thead>
              <tbody>{est.nominees.map((n) => <tr key={n.id}><td><b>{n.name}</b></td><td>{n.relationship}</td><td>{n.contact ?? "—"}</td><td className="small">{n.notes ?? "—"}</td>
                <td className="r">{canWrite && <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}><button className="btn sm" aria-label={`Edit ${n.name}`} onClick={() => setNomineeForm(n)}><Icon d={ICONS.edit} size={13} /></button><button className="btn sm" aria-label={`Remove ${n.name}`} onClick={() => removeNominee(n)}><Icon d={ICONS.trash} size={13} /></button></div>}</td></tr>)}</tbody></table></div>)}
        </Card>

        <Card title="Nomination by asset" subtitle="Underlying positions inside a fund or PMS share the account's nomination, so only top-level holdings are listed." pad={false}>
          <div className="card-b"><DataTable cols={cols} rows={c.rows.map((r) => ({ ...r, id: `${r.entity}:${r.entityId}` }))} search={(r) => r.name} defaultSort={{ key: "status", dir: -1 }} empty={<Empty title="No assets to show" />} /></div>
        </Card>
      </div>
      {nomineeForm && <NomineeForm initial={nomineeForm === "new" ? undefined : nomineeForm} onClose={() => setNomineeForm(null)} onSaved={() => { setNomineeForm(null); load(); }} />}
      {assign && <AssignForm row={assign} nominees={est.nominees} onClose={() => setAssign(null)} onSaved={(e) => { setAssign(null); setEst(e); toast("Nomination saved"); }} />}
    </>
  );
}

function NomineeForm({ initial, onClose, onSaved }: { initial?: Nominee; onClose: () => void; onSaved: () => void }) {
  const { clientId, toast } = useApp();
  const [v, setV] = useState({ name: initial?.name ?? "", relationship: initial?.relationship ?? "Spouse", contact: initial?.contact ?? "", notes: initial?.notes ?? "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErrs({});
    const body = { name: v.name, relationship: v.relationship, contact: v.contact || null, notes: v.notes || null };
    try {
      if (initial) await api.patch(`/api/clients/${clientId}/nominees/${initial.id}`, body); else await api.post(`/api/clients/${clientId}/nominees`, body);
      toast(initial ? "Nominee updated" : "Nominee added"); onSaved();
    } catch (x) { if (x instanceof ApiError && x.details) setErrs(Object.fromEntries(x.details.map((d) => [d.field, d.message]))); else toast(x instanceof Error ? x.message : "Failed", "err"); } finally { setBusy(false); }
  }
  return (
    <Modal title={initial ? "Edit nominee" : "Add nominee"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="nominee-form" disabled={busy}>{initial ? "Save" : "Add"}</button></>}>
      <form id="nominee-form" onSubmit={submit} className="form-grid">
        <Field label="Full name" error={errs.name} full><input type="text" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Relationship" error={errs.relationship}><select value={RELATIONS.includes(v.relationship) ? v.relationship : "Other relative"} onChange={(e) => setV({ ...v, relationship: e.target.value })}>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Contact (optional)" hint="Phone or email. Do not enter passwords."><input type="text" value={v.contact} onChange={(e) => setV({ ...v, contact: e.target.value })} /></Field>
        <Field label="Notes (optional)" full><textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

function AssignForm({ row, nominees, onClose, onSaved }: { row: CoverageRow; nominees: Nominee[]; onClose: () => void; onSaved: (e: Estate) => void }) {
  const { clientId, toast } = useApp();
  const [lines, setLines] = useState<Array<{ nomineeId: string; pct: string }>>(row.shares.length ? row.shares.map((s) => ({ nomineeId: s.nomineeId, pct: String(s.shareBps / 100) })) : [{ nomineeId: nominees[0].id, pct: "100" }]);
  const [err, setErr] = useState<string | null>(null);
  const total = lines.reduce((a, l) => a + (Number(l.pct) || 0), 0);
  const status = Math.abs(total - 100) < 0.005 ? "complete" : total > 100 ? "over" : "partial";
  const free = (i: number) => nominees.filter((n) => n.id === lines[i].nomineeId || !lines.some((l) => l.nomineeId === n.id));
  async function save(shares: Array<{ nomineeId: string; shareBps: number }>) {
    setErr(null);
    try { onSaved(await api.put<Estate>(`/api/clients/${clientId}/nominations`, { entity: row.entity, entityId: row.entityId, shares })); } catch (e) { setErr(e instanceof Error ? e.message : "Could not save"); toast("Not saved", "err"); }
  }
  return (
    <Modal title={`Nomination: ${row.name}`} onClose={onClose} footer={<>
      {row.shares.length > 0 && <button className="btn" style={{ marginRight: "auto" }} onClick={() => save([])}>Clear record</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={status === "over" || lines.some((l) => !(Number(l.pct) > 0))} onClick={() => save(lines.map((l) => ({ nomineeId: l.nomineeId, shareBps: Math.round(Number(l.pct) * 100) })))}>Save</button></>}>
      <div className="stack" style={{ gap: 10 }}>
        {lines.map((l, i) => (
          <div key={i} className="row">
            <select aria-label="Nominee" value={l.nomineeId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, nomineeId: e.target.value } : x)))} style={{ flex: 1 }}>{free(i).map((n) => <option key={n.id} value={n.id}>{n.name} ({n.relationship})</option>)}</select>
            <input aria-label="Share percent" type="number" min="0.01" max="100" step="0.01" value={l.pct} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} style={{ width: 90, textAlign: "right" }} /><span>%</span>
            <button className="btn sm" aria-label="Remove nominee from this asset" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}><Icon d={ICONS.x} size={13} /></button>
          </div>))}
        <div className="row"><button className="btn" onClick={() => setLines([...lines, { nomineeId: nominees.find((n) => !lines.some((l) => l.nomineeId === n.id))?.id ?? "", pct: String(Math.max(0, 100 - total)) }])} disabled={lines.length >= nominees.length}><Icon d={ICONS.plus} />Add another nominee</button>
          <b className="num" style={{ marginLeft: "auto", color: status === "complete" ? "var(--good)" : status === "over" ? "var(--crit)" : "var(--ink)" }}>Total {total.toFixed(2)}%</b></div>
        {status === "partial" && <p className="small muted">Under 100% is saved as a partial nomination so the gap stays visible.</p>}
        {status === "over" && <p className="small" style={{ color: "var(--crit)" }}>Shares cannot add up to more than 100%.</p>}
        {err && <div className="err" role="alert" style={{ color: "var(--crit)" }}>{err}</div>}
      </div>
    </Modal>
  );
}
