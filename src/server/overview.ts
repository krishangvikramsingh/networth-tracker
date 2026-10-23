import type { DB } from "./db";
import { requireClient, asOfDate } from "./service";
import { evaluateClient } from "../shared/evaluate";
import { nominationCoverage } from "../shared/estate";
import { SEVERITY_ORDER } from "./alerts";
import { RULE_DEF_BY_KEY } from "../shared/rules";
import type { Severity } from "../shared/types";

export interface ClientOverview {
  id: string; name: string; kind: "live" | "case"; grossAssets: number; netWorth: number | null; healthScore: number | null; healthProvisional: boolean;
  openAlerts: Record<Severity, number>; nominationCoveredPct: number | null; riskProfile: string | null;
}
export interface AttentionItem { alertId: string; clientId: string; clientName: string; severity: Severity; ruleName: string; subject: string; firstDetectedAt: string }

/**
 * Portfolio-level view for one tenant. Read-only: figures are evaluated fresh, alert counts come from the stored history.
 * "Not assessed" stays null (never 0): net worth needs liabilities, nomination coverage needs nominee records, a risk profile needs a questionnaire.
 */
export function buildOverview(db: DB, tenantId: string, asOf = asOfDate()) {
  const ids = (db.prepare("SELECT id FROM clients WHERE tenant_id = ? ORDER BY (kind='live') DESC, rowid").all(tenantId) as Array<{ id: string }>).map((r) => r.id);
  const clients: ClientOverview[] = ids.map((id) => {
    const data = requireClient(db, id), ev = evaluateClient(data, asOf);
    const openAlerts: Record<Severity, number> = { critical: 0, high: 0, warning: 0, info: 0 };
    for (const r of db.prepare("SELECT severity, COUNT(*) AS n FROM alerts WHERE client_id = ? AND status = 'open' AND kind != 'data_gap' GROUP BY severity").all(id) as Array<{ severity: Severity; n: number }>) openAlerts[r.severity] = r.n;
    const hasNominees = data.nominees.length > 0 || data.nominations.length > 0;
    const risk = db.prepare("SELECT profile FROM risk_assessments WHERE client_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(id) as { profile: string } | undefined;
    return {
      id, name: data.client.name, kind: data.client.kind, grossAssets: ev.portfolio.grossAssets, netWorth: ev.netWorth.netWorth, healthScore: ev.health.overall, healthProvisional: ev.health.provisional,
      openAlerts, nominationCoveredPct: hasNominees ? nominationCoverage(data.holdings, data.policies, data.nominees, data.nominations).coveredPct : null, riskProfile: risk?.profile ?? null,
    };
  });
  const rows = db.prepare(`SELECT a.id, a.client_id, a.severity, a.rule_key, a.subject, a.first_detected_at, c.name AS client_name FROM alerts a JOIN clients c ON c.id = a.client_id
    WHERE c.tenant_id = ? AND a.status = 'open' AND a.kind != 'data_gap' ORDER BY a.first_detected_at DESC`).all(tenantId) as any[];
  const attention: AttentionItem[] = rows
    .map((r) => ({ alertId: r.id, clientId: r.client_id, clientName: r.client_name, severity: r.severity as Severity, ruleName: RULE_DEF_BY_KEY[r.rule_key as keyof typeof RULE_DEF_BY_KEY]?.name ?? r.rule_key, subject: r.subject, firstDetectedAt: r.first_detected_at }))
    .sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity) || b.firstDetectedAt.localeCompare(a.firstDetectedAt))
    .slice(0, 15);
  const live = clients.filter((c) => c.kind === "live");
  return { asOf, clients, attention, totals: { liveClients: live.length, caseStudies: clients.length - live.length, liveGrossAssets: live.length ? live.reduce((a, c) => a + c.grossAssets, 0) : null } };
}
