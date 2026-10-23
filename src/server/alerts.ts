import type { DB } from "./db";
import { nowISO, tx, uid } from "./db";
import type { Evaluation } from "../shared/evaluate";
import type { Finding } from "../shared/rules";
import { RULE_DEF_BY_KEY } from "../shared/rules";
import type { Severity } from "../shared/types";

export interface AlertRow {
  id: string; clientId: string; ruleKey: string; ruleName: string; fingerprint: string; kind: string; status: "open" | "acknowledged" | "resolved"; severity: Severity;
  subject: string; currentLabel: string; thresholdLabel: string; why: string; action: string; effect: string | null; records: Finding["records"]; provisional: boolean;
  firstDetectedAt: string; lastSeenAt: string; resolvedAt: string | null; acknowledgedAt: string | null; acknowledgedBy: string | null; changeCount: number;
  events?: Array<{ at: string; event: string; detail: string | null }>;
}
const ORDER: Severity[] = ["info", "warning", "high", "critical"];
function effectiveSeverity(f: Finding, rule: Severity): Severity {
  if (f.kind === "data_gap") return "info";
  if (f.kind === "possible") return ORDER.indexOf(rule) > ORDER.indexOf("warning") ? "warning" : rule;
  return rule;
}

/**
 * Reconcile the persisted alert history with the current evaluation:
 *  - new condition      -> insert alert + 'detected' event
 *  - condition persists -> touch last_seen; if its content changed, log 'changed' (never a duplicate row)
 *  - condition cleared  -> mark resolved + 'resolved' event
 */
export function syncAlerts(db: DB, clientId: string, ev: Evaluation, now = nowISO()): { created: number; changed: number; resolved: number } {
  const counts = { created: 0, changed: 0, resolved: 0 };
  tx(db, () => {
    const current = new Map<string, { f: Finding; rule: string; sev: Severity }>();
    for (const r of ev.rules) {
      if (r.state === "disabled") continue;
      for (const f of r.findings) current.set(f.fingerprint, { f, rule: r.key, sev: effectiveSeverity(f, r.severity) });
    }
    const live = db.prepare("SELECT * FROM alerts WHERE client_id = ? AND status != 'resolved'").all(clientId) as Array<Record<string, any>>;
    const liveByFp = new Map(live.map((a) => [a.fingerprint, a]));
    for (const [fp, { f, rule, sev }] of current) {
      const ex = liveByFp.get(fp);
      if (!ex) {
        const id = uid("alt");
        db.prepare(`INSERT INTO alerts (id, client_id, rule_key, fingerprint, kind, status, severity, subject, current_label, threshold_label, why, action, effect, records, provisional, first_detected_at, last_seen_at)
          VALUES (?,?,?,?,?,'open',?,?,?,?,?,?,?,?,?,?,?)`).run(id, clientId, rule, fp, f.kind, sev, f.subject, f.currentLabel, f.thresholdLabel, f.why, f.action, f.effect ?? null, JSON.stringify(f.records), f.provisional ? 1 : 0, now, now);
        db.prepare("INSERT INTO alert_events (id, alert_id, at, event, detail) VALUES (?,?,?,?,?)").run(uid("ae"), id, now, "detected", `${f.kind}: ${f.currentLabel}`);
        counts.created++;
      } else {
        const changed = ex.current_label !== f.currentLabel || ex.kind !== f.kind || ex.severity !== sev || ex.why !== f.why || ex.threshold_label !== f.thresholdLabel;
        if (changed) {
          db.prepare(`UPDATE alerts SET kind=?, severity=?, current_label=?, threshold_label=?, why=?, action=?, effect=?, records=?, provisional=?, last_seen_at=?, change_count=change_count+1 WHERE id=?`)
            .run(f.kind, sev, f.currentLabel, f.thresholdLabel, f.why, f.action, f.effect ?? null, JSON.stringify(f.records), f.provisional ? 1 : 0, now, ex.id);
          db.prepare("INSERT INTO alert_events (id, alert_id, at, event, detail) VALUES (?,?,?,?,?)").run(uid("ae"), ex.id, now, "changed", `${ex.current_label} → ${f.currentLabel}`);
          counts.changed++;
        } else db.prepare("UPDATE alerts SET last_seen_at = ? WHERE id = ?").run(now, ex.id);
      }
    }
    for (const a of live) {
      if (current.has(a.fingerprint)) continue;
      db.prepare("UPDATE alerts SET status='resolved', resolved_at=?, last_seen_at=? WHERE id=?").run(now, now, a.id);
      db.prepare("INSERT INTO alert_events (id, alert_id, at, event, detail) VALUES (?,?,?,?,?)").run(uid("ae"), a.id, now, "resolved", "Condition no longer holds (or rule disabled / data corrected).");
      counts.resolved++;
    }
    for (const r of ev.rules) db.prepare("UPDATE rules SET last_evaluated_at = ? WHERE client_id = ? AND key = ?").run(now, clientId, r.key);
    if (ev.health.overall != null) {
      db.prepare(`INSERT INTO health_assessments (id, client_id, date, score, coverage, provisional, detail) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(client_id, date) DO UPDATE SET score=excluded.score, coverage=excluded.coverage, provisional=excluded.provisional, detail=excluded.detail`)
        .run(uid("hs"), clientId, ev.asOf, ev.health.overall, ev.health.coverage, ev.health.provisional ? 1 : 0, JSON.stringify(ev.health.components.map((c) => ({ key: c.key, score: c.score, assessed: c.assessed }))));
    }
  });
  return counts;
}

export function listAlerts(db: DB, clientId: string, opts: { limit?: number } = {}): AlertRow[] {
  const rows = db.prepare("SELECT * FROM alerts WHERE client_id = ? ORDER BY (status='resolved'), first_detected_at DESC, rowid DESC LIMIT ?").all(clientId, opts.limit ?? 300) as any[];
  const evs = db.prepare("SELECT alert_id, at, event, detail FROM alert_events WHERE alert_id IN (SELECT id FROM alerts WHERE client_id = ?) ORDER BY at, rowid").all(clientId) as any[];
  const byAlert = new Map<string, any[]>();
  for (const e of evs) { const a = byAlert.get(e.alert_id) ?? []; a.push({ at: e.at, event: e.event, detail: e.detail }); byAlert.set(e.alert_id, a); }
  return rows.map((r) => ({
    id: r.id, clientId: r.client_id, ruleKey: r.rule_key, ruleName: RULE_DEF_BY_KEY[r.rule_key as keyof typeof RULE_DEF_BY_KEY]?.name ?? r.rule_key, fingerprint: r.fingerprint, kind: r.kind, status: r.status, severity: r.severity,
    subject: r.subject, currentLabel: r.current_label, thresholdLabel: r.threshold_label, why: r.why, action: r.action, effect: r.effect, records: JSON.parse(r.records), provisional: r.provisional === 1,
    firstDetectedAt: r.first_detected_at, lastSeenAt: r.last_seen_at, resolvedAt: r.resolved_at, acknowledgedAt: r.acknowledged_at, acknowledgedBy: r.acknowledged_by, changeCount: r.change_count, events: byAlert.get(r.id) ?? [],
  }));
}
