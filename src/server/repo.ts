import type { DB } from "./db";
import { nowISO, tx, uid } from "./db";
import { defaultSettings } from "../shared/fixtures";
import { defaultRules, RULE_DEFS } from "../shared/rules";
import { defaultMappings } from "../shared/classify";
import type { ClientData, ClientSettings, RuleConfig, CategoryMapping } from "../shared/types";

type Kind = "s" | "n" | "b" | "j";
export interface Spec { table: string; fields: Array<[string, Kind]>; timestamps: boolean; archivable: boolean }

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const f = (names: string, kind: Kind): Array<[string, Kind]> => names.split(/\s+/).filter(Boolean).map((n) => [n, kind]);

export const SPECS = {
  holdings: { table: "holdings", timestamps: true, archivable: true, fields: [
    ...f("id clientId name originalDescription instrumentType assetClass classOverride classificationMethod classificationStatus classificationReason geography issuer account symbol sector acquisitionDate valuationDate valuationSource maturityDate parentId dataStatus notes", "s"),
    ...f("quantity currentValue investedValue expectedMaturityValue liquidityTier", "n"), ...f("emergencyEligible isAggregate archived isIllustrative", "b")] },
  liabilities: { table: "liabilities", timestamps: true, archivable: true, fields: [
    ...f("id clientId name type lender nextDueDate dataStatus notes", "s"), ...f("outstanding originalPrincipal emi rateBps remainingMonths minimumDue", "n"), ...f("archived isIllustrative", "b")] },
  cashflows: { table: "cashflow_items", timestamps: true, archivable: true, fields: [
    ...f("id clientId kind category name frequency anchorDate endDate commitmentId liabilityId dataStatus notes", "s"), ...f("amount", "n"), ...f("verified essential archived isIllustrative", "b")] },
  commitments: { table: "commitments", timestamps: true, archivable: true, fields: [
    ...f("id clientId name kind frequency nextDueDate endDate dataStatus notes", "s"), ...f("totalAmount paidAmount installmentAmount annualReceivable", "n"), ...f("archived isIllustrative", "b")] },
  transactions: { table: "transactions", timestamps: false, archivable: false, fields: [...f("id clientId holdingId date type notes", "s"), ...f("amount quantity", "n")] },
  snapshots: { table: "snapshots", timestamps: false, archivable: false, fields: [...f("id clientId date source note", "s"), ...f("grossAssets liabilities netWorth", "n"), ...f("liabilitiesComplete", "b")] },
  policies: { table: "insurance_policies", timestamps: true, archivable: true, fields: [
    ...f("id clientId type insurer policyNo premiumFrequency nextPremiumDate renewalDate maturityDate dataStatus", "s"), ...f("sumAssured annualPremium expectedMaturityValue", "n"), ...f("archived isIllustrative", "b")] },
  goals: { table: "goals", timestamps: true, archivable: true, fields: [
    ...f("id clientId name type targetDate notes", "s"), ...f("targetAmount earmarkedAmount monthlyContribution expectedReturnBps", "n"), ...f("archived isIllustrative", "b")] },
  valuations: { table: "valuations", timestamps: false, archivable: false, fields: [...f("id holdingId clientId date source note", "s"), ...f("value", "n")] },
} satisfies Record<string, Spec>;
export type SpecName = keyof typeof SPECS;

export function fromRow<T = any>(spec: Spec, row: Record<string, unknown>): T {
  const o: Record<string, unknown> = {};
  for (const [p, k] of spec.fields) {
    const v = row[snake(p)];
    o[p] = v === null || v === undefined ? null : k === "b" ? v === 1 : k === "j" ? JSON.parse(String(v)) : v;
  }
  return o as T;
}
const toDb = (k: Kind, v: unknown) => (v === undefined || v === null ? null : k === "b" ? (v ? 1 : 0) : k === "j" ? JSON.stringify(v) : (v as string | number));

export function listAll<T = any>(db: DB, name: SpecName, clientId: string, opts: { includeArchived?: boolean } = {}): T[] {
  const spec: Spec = SPECS[name];
  const where = spec.archivable && !opts.includeArchived ? " AND archived = 0" : "";
  const order = name === "transactions" || name === "snapshots" ? " ORDER BY date" : " ORDER BY rowid";
  return (db.prepare(`SELECT * FROM ${spec.table} WHERE client_id = ?${where}${order}`).all(clientId) as Record<string, unknown>[]).map((r) => fromRow<T>(spec, r));
}
export function getOne<T = any>(db: DB, name: SpecName, clientId: string, id: string): T | null {
  const spec: Spec = SPECS[name];
  const row = db.prepare(`SELECT * FROM ${spec.table} WHERE client_id = ? AND id = ?`).get(clientId, id) as Record<string, unknown> | undefined;
  return row ? fromRow<T>(spec, row) : null;
}
export function insertRow(db: DB, name: SpecName, obj: Record<string, any>): void {
  const spec: Spec = SPECS[name];
  const cols = spec.fields.map(([p]) => snake(p));
  const vals = spec.fields.map(([p, k]) => toDb(k, obj[p]));
  if (spec.timestamps) { cols.push("created_at", "updated_at"); const t = nowISO(); vals.push(t, t); }
  else if (spec.table !== "valuations" || true) { if (["transactions", "snapshots", "valuations"].includes(spec.table)) { cols.push("created_at"); vals.push(nowISO()); } }
  db.prepare(`INSERT INTO ${spec.table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...(vals as any[]));
}
export function updateRow(db: DB, name: SpecName, id: string, obj: Record<string, any>): void {
  const spec: Spec = SPECS[name];
  const fields = spec.fields.filter(([p]) => p !== "id" && p !== "clientId");
  const sets = fields.map(([p]) => `${snake(p)} = ?`);
  const vals = fields.map(([p, k]) => toDb(k, obj[p]));
  if (spec.timestamps) { sets.push("updated_at = ?"); vals.push(nowISO()); }
  db.prepare(`UPDATE ${spec.table} SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as any[]), id);
}
export function deleteRow(db: DB, name: SpecName, clientId: string, id: string): void {
  db.prepare(`DELETE FROM ${SPECS[name].table} WHERE client_id = ? AND id = ?`).run(clientId, id);
}

// ---- settings / rules / targets / mappings ---------------------------------------------------
export function loadSettings(db: DB, clientId: string): ClientSettings {
  const r = db.prepare("SELECT json FROM client_settings WHERE client_id = ?").get(clientId) as { json: string } | undefined;
  const kind = (db.prepare("SELECT kind FROM clients WHERE id = ?").get(clientId) as { kind: "live" | "case" } | undefined)?.kind ?? "live";
  return { ...defaultSettings(kind), ...(r ? JSON.parse(r.json) : {}) };
}
export function saveSettings(db: DB, clientId: string, s: ClientSettings): void {
  db.prepare("INSERT INTO client_settings (client_id, json, updated_at) VALUES (?,?,?) ON CONFLICT(client_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at").run(clientId, JSON.stringify(s), nowISO());
}
export function loadRules(db: DB, clientId: string): RuleConfig[] {
  const rows = db.prepare("SELECT * FROM rules WHERE client_id = ?").all(clientId) as Array<Record<string, any>>;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return defaultRules().map((d) => {
    const r = byKey.get(d.key);
    return r ? { key: d.key, enabled: r.enabled === 1, value: r.value, unit: r.unit, severity: r.severity, params: JSON.parse(r.params), lastEvaluatedAt: r.last_evaluated_at } : d;
  });
}
export function saveRule(db: DB, clientId: string, r: RuleConfig): void {
  db.prepare(`INSERT INTO rules (client_id, key, enabled, value, unit, severity, params, last_evaluated_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(client_id, key) DO UPDATE SET enabled=excluded.enabled, value=excluded.value, unit=excluded.unit, severity=excluded.severity, params=excluded.params, last_evaluated_at=excluded.last_evaluated_at`)
    .run(clientId, r.key, r.enabled ? 1 : 0, r.value, r.unit, r.severity, JSON.stringify(r.params), r.lastEvaluatedAt);
}
export function loadTargets(db: DB, clientId: string) {
  return (db.prepare("SELECT asset_class, target_bps, band_bps FROM allocation_targets WHERE client_id = ? ORDER BY rowid").all(clientId) as Array<Record<string, any>>)
    .map((r) => ({ assetClass: r.asset_class, targetBps: r.target_bps, bandBps: r.band_bps }));
}
export function saveTargets(db: DB, clientId: string, targets: ClientData["targets"]): void {
  tx(db, () => {
    db.prepare("DELETE FROM allocation_targets WHERE client_id = ?").run(clientId);
    for (const t of targets) db.prepare("INSERT INTO allocation_targets (client_id, asset_class, target_bps, band_bps) VALUES (?,?,?,?)").run(clientId, t.assetClass, t.targetBps, t.bandBps);
  });
}
export function loadMappings(db: DB, clientId: string): CategoryMapping[] {
  return (db.prepare("SELECT * FROM category_mappings WHERE client_id IS NULL OR client_id = ? ORDER BY priority DESC").all(clientId) as Array<Record<string, any>>)
    .map((r) => ({ id: r.id, domain: r.domain, matchType: r.match_type, pattern: r.pattern, category: r.category, priority: r.priority, source: r.source }));
}
export function ensureGlobalMappings(db: DB): void {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM category_mappings WHERE client_id IS NULL").get() as { n: number }).n;
  if (n > 0) return;
  for (const m of defaultMappings()) db.prepare("INSERT INTO category_mappings (id, client_id, domain, match_type, pattern, category, priority, source) VALUES (?,NULL,?,?,?,?,?,?)").run(uid("map"), m.domain, m.matchType, m.pattern, m.category, m.priority, m.source);
}

export function loadClientData(db: DB, clientId: string): ClientData | null {
  const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(clientId) as Record<string, any> | undefined;
  if (!c) return null;
  const scoreHistory = (db.prepare("SELECT date, score, coverage FROM health_assessments WHERE client_id = ? ORDER BY date").all(clientId) as any[]).map((r) => ({ date: r.date, score: r.score, coverage: r.coverage }));
  return {
    client: { id: c.id, name: c.name, kind: c.kind, description: c.description, createdAt: c.created_at },
    settings: loadSettings(db, clientId),
    holdings: listAll(db, "holdings", clientId), liabilities: listAll(db, "liabilities", clientId), cashflows: listAll(db, "cashflows", clientId),
    commitments: listAll(db, "commitments", clientId), transactions: listAll(db, "transactions", clientId), snapshots: listAll(db, "snapshots", clientId),
    policies: listAll(db, "policies", clientId), goals: listAll(db, "goals", clientId), targets: loadTargets(db, clientId), rules: loadRules(db, clientId),
    mappings: loadMappings(db, clientId), valuations: listAll(db, "valuations", clientId), scoreHistory,
  };
}

/** Persist a complete in-memory fixture (used by seed + demo reset). */
export function saveFixture(db: DB, data: ClientData, isDemo: boolean): void {
  tx(db, () => {
    const id = data.client.id;
    db.prepare("INSERT INTO clients (id, name, kind, description, is_demo, created_at) VALUES (?,?,?,?,?,?)").run(id, data.client.name, data.client.kind, data.client.description, isDemo ? 1 : 0, data.client.createdAt);
    saveSettings(db, id, data.settings);
    for (const h of data.holdings.filter((x) => !x.parentId)) insertRow(db, "holdings", h);
    for (const h of data.holdings.filter((x) => x.parentId)) insertRow(db, "holdings", h);
    for (const h of data.holdings) insertRow(db, "valuations", { id: uid("val"), holdingId: h.id, clientId: id, date: h.valuationDate ?? "1970-01-01", value: h.currentValue, source: "seed", note: "Initial value" });
    // seed valuations are only meaningful with a real date
    db.prepare("DELETE FROM valuations WHERE client_id = ? AND date = '1970-01-01'").run(id);
    for (const x of data.liabilities) insertRow(db, "liabilities", x);
    for (const x of data.commitments) insertRow(db, "commitments", x);
    for (const x of data.cashflows) insertRow(db, "cashflows", x);
    for (const x of data.transactions) insertRow(db, "transactions", x);
    for (const x of data.snapshots) insertRow(db, "snapshots", x);
    for (const x of data.policies) insertRow(db, "policies", x);
    for (const x of data.goals) insertRow(db, "goals", x);
    saveTargets(db, id, data.targets);
    for (const r of data.rules) saveRule(db, id, r);
  });
}

export function deleteClient(db: DB, id: string) { db.prepare("DELETE FROM clients WHERE id = ?").run(id); }
export { RULE_DEFS };
