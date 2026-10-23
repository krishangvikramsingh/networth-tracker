import { z } from "zod";
import type { DB } from "./db";
import { nowISO, tx, uid } from "./db";
import { audit } from "./audit";
import { HttpError, asOfDate } from "./service";
import { iso } from "./schemas";
import type { AuthUser } from "./auth";

export const TASK_STATUSES = ["open", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const text = (max: number) => z.string().trim().max(max);
const taskIn = z.object({
  title: text(140).min(2, "Give the task a short title."), note: text(1000).nullable().optional(),
  clientId: z.string().min(1, "Choose a client."), alertId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(), dueDate: iso.nullable().optional(),
});
const taskPatch = taskIn.pick({ title: true, note: true, assigneeId: true, dueDate: true }).partial().extend({ status: z.enum(TASK_STATUSES).optional() });

export interface TaskRow {
  id: string; title: string; note: string | null; status: TaskStatus; dueDate: string | null; overdue: boolean;
  clientId: string; clientName: string; alertId: string | null; alertRule: string | null; alertSeverity: string | null; alertStatus: string | null;
  assigneeId: string | null; assigneeName: string | null; createdByName: string | null; createdAt: string; updatedAt: string; completedAt: string | null;
}
const SELECT = `SELECT t.*, c.name AS client_name, a.rule_key AS alert_rule, a.subject AS alert_subject, a.severity AS alert_severity, a.status AS alert_status,
  u.name AS assignee_name, cb.name AS created_by_name
  FROM tasks t JOIN clients c ON c.id = t.client_id LEFT JOIN alerts a ON a.id = t.alert_id LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users cb ON cb.id = t.created_by`;
const fromRow = (r: any, today: string): TaskRow => ({
  id: r.id, title: r.title, note: r.note, status: r.status, dueDate: r.due_date, overdue: !!r.due_date && r.status !== "done" && r.due_date < today,
  clientId: r.client_id, clientName: r.client_name, alertId: r.alert_id, alertRule: r.alert_rule ? `${r.alert_rule}${r.alert_subject ? `: ${r.alert_subject}` : ""}` : null, alertSeverity: r.alert_severity, alertStatus: r.alert_status,
  assigneeId: r.assignee_id, assigneeName: r.assignee_name, createdByName: r.created_by_name, createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at,
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const p = schema.safeParse(body ?? {});
  if (!p.success) throw new HttpError(422, p.error.issues[0]?.message ?? "Check the task details.", p.error.issues.map((i) => ({ field: String(i.path[0] ?? ""), message: i.message })));
  return p.data;
}
const ownTask = (db: DB, user: AuthUser, id: string) => {
  const t = db.prepare("SELECT * FROM tasks WHERE id = ? AND tenant_id = ?").get(id, user.tenantId) as any;
  if (!t) throw new HttpError(404, "Task not found."); // another organisation's task answers exactly like a missing one
  return t;
};
const checkAssignee = (db: DB, user: AuthUser, assigneeId: string | null | undefined) => {
  if (!assigneeId) return;
  const a = db.prepare("SELECT 1 AS ok FROM users WHERE id = ? AND tenant_id = ?").get(assigneeId, user.tenantId);
  if (!a) throw new HttpError(422, "Choose someone from your own organisation.", [{ field: "assigneeId", message: "Not a member of your organisation." }]);
};

export function listAssignees(db: DB, user: AuthUser) {
  return (db.prepare("SELECT id, name, role FROM users WHERE tenant_id = ? ORDER BY name").all(user.tenantId) as any[]).map((r) => ({ id: r.id, name: r.name, role: r.role as string }));
}
export function listTasks(db: DB, user: AuthUser, f: { status?: string; assignee?: string; clientId?: string; alertId?: string } = {}): TaskRow[] {
  const where = ["t.tenant_id = ?"], args: Array<string> = [user.tenantId];
  if (f.status === "active") where.push("t.status != 'done'");
  else if (f.status && (TASK_STATUSES as readonly string[]).includes(f.status)) { where.push("t.status = ?"); args.push(f.status); }
  if (f.assignee === "me") { where.push("t.assignee_id = ?"); args.push(user.id); }
  else if (f.assignee === "unassigned") where.push("t.assignee_id IS NULL");
  else if (f.assignee) { where.push("t.assignee_id = ?"); args.push(f.assignee); }
  if (f.clientId) { where.push("t.client_id = ?"); args.push(f.clientId); }
  if (f.alertId) { where.push("t.alert_id = ?"); args.push(f.alertId); }
  const today = asOfDate();
  const rows = db.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY (t.status = 'done'), (t.due_date IS NULL), t.due_date, t.created_at DESC LIMIT 500`).all(...args) as any[];
  return rows.map((r) => fromRow(r, today));
}
const one = (db: DB, id: string) => fromRow(db.prepare(`${SELECT} WHERE t.id = ?`).get(id), asOfDate());

export function createTask(db: DB, user: AuthUser, body: unknown): TaskRow {
  const v = parse(taskIn, body);
  const client = db.prepare("SELECT tenant_id FROM clients WHERE id = ?").get(v.clientId) as { tenant_id: string } | undefined;
  if (!client || client.tenant_id !== user.tenantId) throw new HttpError(404, "Client not found.");
  if (v.alertId) {
    const a = db.prepare("SELECT client_id FROM alerts WHERE id = ?").get(v.alertId) as { client_id: string } | undefined;
    if (!a || a.client_id !== v.clientId) throw new HttpError(422, "That alert does not belong to this client.", [{ field: "alertId", message: "Alert not found for this client." }]);
  }
  checkAssignee(db, user, v.assigneeId);
  const id = uid("task"), now = nowISO();
  tx(db, () => {
    db.prepare("INSERT INTO tasks (id, tenant_id, client_id, alert_id, title, note, assignee_id, status, due_date, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, user.tenantId, v.clientId, v.alertId ?? null, v.title, v.note || null, v.assigneeId ?? null, "open", v.dueDate ?? null, user.id, now, now);
    audit(db, { clientId: v.clientId, userId: user.id, entity: "task", entityId: id, action: "create", summary: `Task created: ${v.title}` });
  });
  return one(db, id);
}
export function updateTask(db: DB, user: AuthUser, id: string, body: unknown): TaskRow {
  const cur = ownTask(db, user, id), v = parse(taskPatch, body);
  checkAssignee(db, user, v.assigneeId);
  const next = {
    title: v.title ?? cur.title, note: v.note === undefined ? cur.note : v.note || null, assignee_id: v.assigneeId === undefined ? cur.assignee_id : v.assigneeId,
    due_date: v.dueDate === undefined ? cur.due_date : v.dueDate, status: v.status ?? cur.status,
  };
  const now = nowISO(), completed = next.status === "done" ? (cur.status === "done" ? cur.completed_at : now) : null;
  tx(db, () => {
    db.prepare("UPDATE tasks SET title = ?, note = ?, assignee_id = ?, due_date = ?, status = ?, completed_at = ?, updated_at = ? WHERE id = ?")
      .run(next.title, next.note, next.assignee_id, next.due_date, next.status, completed, now, id);
    const what = next.status !== cur.status ? `status ${cur.status} to ${next.status}` : next.assignee_id !== cur.assignee_id ? "reassigned" : "edited";
    audit(db, { clientId: cur.client_id, userId: user.id, entity: "task", entityId: id, action: "update", summary: `Task ${what}: ${next.title}`, before: { status: cur.status, assigneeId: cur.assignee_id }, after: { status: next.status, assigneeId: next.assignee_id } });
  });
  return one(db, id);
}
export function deleteTask(db: DB, user: AuthUser, id: string) {
  const cur = ownTask(db, user, id);
  tx(db, () => { db.prepare("DELETE FROM tasks WHERE id = ?").run(id); audit(db, { clientId: cur.client_id, userId: user.id, entity: "task", entityId: id, action: "delete", summary: `Task deleted: ${cur.title}` }); });
}
/** Open-task counts for the attention queue: how many tasks are open, mine, and overdue in this organisation. */
export function taskCounts(db: DB, user: AuthUser) {
  const t = asOfDate();
  const r = db.prepare("SELECT COUNT(*) AS open, SUM(assignee_id = ?) AS mine, SUM(due_date IS NOT NULL AND due_date < ?) AS overdue FROM tasks WHERE tenant_id = ? AND status != 'done'").get(user.id, t, user.tenantId) as any;
  return { open: Number(r.open ?? 0), mine: Number(r.mine ?? 0), overdue: Number(r.overdue ?? 0) };
}
