import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { useApp } from "../store";
import { AddButton } from "./common";
import { Badge, Card, Empty, Field, Icon, ICONS, Kpi, Modal, PageHead, SevBadge, Segmented, fmtDate } from "../ui";

export interface TaskRow {
  id: string; title: string; note: string | null; status: "open" | "in_progress" | "done"; dueDate: string | null; overdue: boolean;
  clientId: string; clientName: string; alertId: string | null; alertRule: string | null; alertSeverity: "critical" | "high" | "warning" | "info" | null; alertStatus: string | null;
  assigneeId: string | null; assigneeName: string | null; createdByName: string | null; completedAt: string | null;
}
interface Assignee { id: string; name: string; role: string }
interface Counts { open: number; mine: number; overdue: number }
const STATUS_LABEL = { open: "Open", in_progress: "In progress", done: "Done" } as const;
type Filter = "active" | "mine" | "unassigned" | "done";

const query = (f: Filter) => (f === "active" ? "status=active" : f === "mine" ? "status=active&assignee=me" : f === "unassigned" ? "status=active&assignee=unassigned" : "status=done");

/** One place to create a task, from the queue or from an alert. */
export function TaskForm({ defaults, onClose, onSaved }: { defaults?: { title?: string; clientId?: string; alertId?: string }; onClose: () => void; onSaved: () => void }) {
  const { clients, clientId, toast } = useApp();
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [f, setF] = useState({ title: defaults?.title ?? "", clientId: defaults?.clientId ?? clientId ?? "", assigneeId: "", dueDate: "", note: "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/api/tasks/assignees").then((r) => setAssignees(r.assignees)).catch(() => {}); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      await api.post("/api/tasks", { title: f.title, clientId: f.clientId, alertId: defaults?.alertId ?? null, assigneeId: f.assigneeId || null, dueDate: f.dueDate || null, note: f.note || null });
      toast("Task created"); onSaved(); onClose();
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : "Could not create the task."); } finally { setBusy(false); }
  }
  return (
    <Modal title={defaults?.alertId ? "New task from this alert" : "New task"} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" form="task-form" className="btn primary" disabled={busy || f.title.trim().length < 2 || !f.clientId}>{busy ? "Saving…" : "Create task"}</button></>}>
      <form id="task-form" className="form-grid" onSubmit={submit}>
        <div className="full"><Field label="What needs doing?"><input type="text" value={f.title} maxLength={140} onChange={(e) => setF({ ...f, title: e.target.value })} required autoFocus /></Field></div>
        <Field label="Client"><select value={f.clientId} disabled={!!defaults?.alertId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Assign to (optional)"><select value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}><option value="">Unassigned</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Due (optional)"><input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <div className="full"><Field label="Note (optional)"><textarea rows={3} value={f.note} maxLength={1000} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
        {err && <div className="full err" role="alert" style={{ color: "var(--crit)", fontWeight: 550 }}>{err}</div>}
      </form>
    </Modal>
  );
}

export function TasksPage() {
  const { canWrite, toast, state } = useApp();
  const [filter, setFilter] = useState<Filter>("active");
  const [data, setData] = useState<{ tasks: TaskRow[]; counts: Counts; assignees: Assignee[] } | null>(null);
  const [adding, setAdding] = useState(false); const [error, setError] = useState("");
  const load = useCallback(() => api.get(`/api/tasks?${query(filter)}`).then((r) => { setData(r); setError(""); }).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load tasks.")), [filter]);
  useEffect(() => { load(); }, [load]);

  const patch = async (id: string, body: Record<string, unknown>, msg?: string) => {
    try { await api.patch(`/api/tasks/${id}`, body); if (msg) toast(msg); await load(); } catch (e) { toast(e instanceof ApiError ? e.message : "Could not update the task.", "err"); }
  };
  const remove = async (t: TaskRow) => { try { await api.del(`/api/tasks/${t.id}`); toast("Task deleted"); await load(); } catch (e) { toast(e instanceof ApiError ? e.message : "Could not delete.", "err"); } };
  void state;
  return (
    <>
      <PageHead title="Tasks" subtitle="Follow-ups for you and your colleagues. Create one from any alert, assign it, and track it to done."
        actions={canWrite ? <AddButton onClick={() => setAdding(true)}>New task</AddButton> : undefined} />
      {error && <div className="err" role="alert" style={{ color: "var(--crit)", marginBottom: 12 }}>{error}</div>}
      <div className="stack">
        <div className="kpi-group">
          <Kpi label="Open tasks" value={data?.counts.open ?? 0} sub="not yet done, across all clients" />
          <Kpi label="Assigned to me" value={data?.counts.mine ?? 0} sub="open or in progress" />
          <Kpi label="Overdue" value={data?.counts.overdue ?? 0} tone={data && data.counts.overdue > 0 ? "crit" : ""} sub={data && data.counts.overdue > 0 ? "past their due date" : "nothing is late"} />
        </div>
        <div className="row between">
          <Segmented label="Show tasks" value={filter} onChange={setFilter} options={[{ id: "active", label: "All open" }, { id: "mine", label: "Mine" }, { id: "unassigned", label: "Unassigned" }, { id: "done", label: "Done" }]} />
        </div>
        <Card pad={false}>
          {!data ? <div className="card-b small muted">Loading…</div> : data.tasks.length === 0
            ? <div className="card-b"><Empty title={filter === "done" ? "Nothing finished yet" : "No tasks here"} action={canWrite && filter !== "done" ? <button type="button" className="btn primary" onClick={() => setAdding(true)}><Icon d={ICONS.plus} />New task</button> : undefined}>{filter === "done" ? "Completed tasks appear here." : "Create a task from an alert, or add one by hand."}</Empty></div>
            : data.tasks.map((t) => (
              <div key={t.id} className="task-row">
                <label className="sr-only" htmlFor={`st-${t.id}`}>Status of {t.title}</label>
                <select id={`st-${t.id}`} className="task-status" value={t.status} disabled={!canWrite} onChange={(e) => patch(t.id, { status: e.target.value }, e.target.value === "done" ? "Marked done" : undefined)}>
                  {(["open", "in_progress", "done"] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
                <div className="task-main">
                  <div className={t.status === "done" ? "task-title done" : "task-title"}>{t.title}</div>
                  <div className="small muted task-meta">
                    <Link to={`/alerts${t.alertId ? `?open=${t.alertId}` : ""}`} onClick={(e) => { if (!t.alertId) e.preventDefault(); }} style={t.alertId ? undefined : { textDecoration: "none", color: "inherit", cursor: "default" }}>{t.clientName}{t.alertRule ? `: ${t.alertRule}` : ""}</Link>
                    {t.alertSeverity && <SevBadge s={t.alertSeverity} />}
                    {t.alertStatus === "resolved" && <Badge tone="good">alert resolved</Badge>}
                    {t.dueDate && <span className={t.overdue ? "overdue" : ""}>Due {fmtDate(t.dueDate)}{t.overdue ? " (overdue)" : ""}</span>}
                  </div>
                  {t.note && <div className="small sec task-note">{t.note}</div>}
                </div>
                <div className="task-who">
                  <label className="sr-only" htmlFor={`as-${t.id}`}>Assignee of {t.title}</label>
                  <select id={`as-${t.id}`} value={t.assigneeId ?? ""} disabled={!canWrite} onChange={(e) => patch(t.id, { assigneeId: e.target.value || null }, "Reassigned")}>
                    <option value="">Unassigned</option>{data.assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  {canWrite && <button type="button" className="btn ghost sm" aria-label={`Delete task ${t.title}`} onClick={() => remove(t)}><Icon d={ICONS.trash} size={14} /></button>}
                </div>
              </div>))}
        </Card>
      </div>
      {adding && <TaskForm onClose={() => setAdding(false)} onSaved={load} />}
    </>
  );
}
