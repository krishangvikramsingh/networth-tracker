import type { DB } from "./db";
import { nowISO, uid } from "./db";

export function audit(db: DB, e: { clientId: string | null; userId?: string | null; entity: string; entityId?: string | null; action: string; summary: string; before?: unknown; after?: unknown }) {
  db.prepare("INSERT INTO audit_events (id, client_id, user_id, at, entity, entity_id, action, summary, before_json, after_json) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(uid("aud"), e.clientId, e.userId ?? null, nowISO(), e.entity, e.entityId ?? null, e.action, e.summary,
      e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after));
}
export function recentAudit(db: DB, clientId: string, limit = 60) {
  return (db.prepare("SELECT a.id, a.at, a.entity, a.entity_id, a.action, a.summary, u.name AS user_name FROM audit_events a LEFT JOIN users u ON u.id = a.user_id WHERE a.client_id = ? ORDER BY a.at DESC, a.rowid DESC LIMIT ?").all(clientId, limit) as any[])
    .map((r) => ({ id: r.id, at: r.at, entity: r.entity, entityId: r.entity_id, action: r.action, summary: r.summary, user: r.user_name }));
}
