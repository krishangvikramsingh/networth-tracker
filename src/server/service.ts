import type { DB } from "./db";
import { nowISO, tx, uid } from "./db";
import { audit } from "./audit";
import { syncAlerts, listAlerts } from "./alerts";
import {
  SPECS, deleteRow, getOne, insertRow, listAll, loadClientData, loadSettings, saveRule, saveSettings, saveTargets, updateRow, loadMappings,
  type SpecName,
} from "./repo";
import { ENTITY_SCHEMAS, settingsPatch, ruleIn, targetsIn } from "./schemas";
import { applyClassification, classifyCashflow, classifyHolding } from "../shared/classify";
import { evaluateClient, type Evaluation } from "../shared/evaluate";
import { todayISO } from "../shared/dates";
import { INSTRUMENT_DEFAULTS } from "../shared/taxonomy";
import { RULE_DEF_BY_KEY, validateRuleValue } from "../shared/rules";
import { applyTrades, type Trade } from "../shared/rebalance";
import { sum } from "../shared/money";
import type { ClientData, Holding, RuleKey } from "../shared/types";

export class HttpError extends Error { constructor(public status: number, message: string, public details?: unknown) { super(message); } }
export const asOfDate = () => process.env.APP_AS_OF || todayISO();

export function requireClient(db: DB, cid: string): ClientData {
  const d = loadClientData(db, cid);
  if (!d) throw new HttpError(404, "Client not found.");
  return d;
}

export function refresh(db: DB, cid: string, asOf = asOfDate()): { data: ClientData; ev: Evaluation } {
  const data = requireClient(db, cid);
  const ev = evaluateClient(data, asOf);
  syncAlerts(db, cid, ev);
  return { data: requireClient(db, cid), ev };
}

export function buildState(db: DB, cid: string) {
  const { data, ev } = refresh(db, cid);
  return { data, evaluation: ev, alerts: listAlerts(db, cid), serverTime: nowISO(), asOf: ev.asOf };
}

type Actor = { id: string } | undefined;
const pick = (o: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

function zodFail(e: any): never {
  const issues = (e.issues ?? []) as Array<{ path: Array<string | number>; message: string }>;
  throw new HttpError(422, issues[0]?.message ?? "Invalid input.", issues.map((i) => ({ field: i.path.join("."), message: i.message })));
}
function parse<T>(schema: { safeParse: (x: unknown) => any }, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) zodFail(r.error);
  return r.data as T;
}

function buildHolding(db: DB, cid: string, input: any, existing: Holding | null): Holding {
  const def = INSTRUMENT_DEFAULTS[input.instrumentType as keyof typeof INSTRUMENT_DEFAULTS];
  if (input.parentId) {
    if (existing && input.parentId === existing.id) throw new HttpError(422, "A holding cannot be its own parent.");
    const parent = getOne<Holding>(db, "holdings", cid, input.parentId);
    if (!parent || parent.archived) throw new HttpError(422, "Parent holding not found.");
    if (parent.parentId) throw new HttpError(422, "Underlying positions can only be nested one level deep.");
  }
  const kids = existing ? listAll<Holding>(db, "holdings", cid).filter((h) => h.parentId === existing.id) : [];
  if (existing && input.parentId && kids.length) throw new HttpError(422, "This holding has underlying positions, so it cannot itself become an underlying position.");
  const base: Holding = {
    id: existing?.id ?? uid("h"), clientId: cid, name: input.name, originalDescription: existing?.originalDescription ?? input.originalDescription ?? input.name,
    instrumentType: input.instrumentType, assetClass: existing?.assetClass ?? null, classOverride: input.classOverride ?? null,
    classificationMethod: "unresolved", classificationStatus: "needs_review", classificationReason: "",
    geography: input.geography ?? null, issuer: input.issuer ?? null, account: input.account ?? null, symbol: input.symbol ?? null, sector: input.sector ?? null, quantity: input.quantity ?? null,
    currentValue: input.currentValue, investedValue: input.investedValue ?? null, acquisitionDate: input.acquisitionDate ?? null, valuationDate: input.valuationDate ?? null,
    valuationSource: existing?.valuationSource ?? "manual", maturityDate: input.maturityDate ?? null, expectedMaturityValue: input.expectedMaturityValue ?? null,
    liquidityTier: input.liquidityTier ?? existing?.liquidityTier ?? def.liquidity, emergencyEligible: input.emergencyEligible ?? existing?.emergencyEligible ?? def.emergencyEligible,
    parentId: input.parentId ?? null, isAggregate: input.isAggregate ?? existing?.isAggregate ?? false, dataStatus: input.dataStatus ?? existing?.dataStatus ?? "collected",
    notes: input.notes ?? null, archived: existing?.archived ?? false, isIllustrative: existing?.isIllustrative ?? false,
  };
  // liquidity default follows instrument type if the type changed and the caller did not override
  if (existing && existing.instrumentType !== input.instrumentType && input.liquidityTier == null) base.liquidityTier = def.liquidity;
  if (existing && existing.instrumentType !== input.instrumentType && input.emergencyEligible == null) base.emergencyEligible = def.emergencyEligible;
  return applyClassification(base, loadMappings(db, cid));
}

export function createEntity(db: DB, cid: string, entity: keyof typeof ENTITY_SCHEMAS, body: unknown, actor: Actor): any {
  requireClient(db, cid);
  const input = parse<any>(ENTITY_SCHEMAS[entity], body);
  return tx(db, () => {
    let item: any;
    if (entity === "holdings") {
      item = buildHolding(db, cid, input, null);
      insertRow(db, "holdings", item);
      if (item.valuationDate) insertRow(db, "valuations", { id: uid("val"), holdingId: item.id, clientId: cid, date: item.valuationDate, value: item.currentValue, source: "manual", note: "Initial value" });
    } else if (entity === "cashflows") {
      item = { id: uid("c"), clientId: cid, verified: false, essential: false, commitmentId: null, liabilityId: null, dataStatus: "collected", notes: null, anchorDate: null, endDate: null, archived: false, isIllustrative: false, ...input };
      insertRow(db, "cashflows", item);
    } else {
      const prefix = { liabilities: "l", commitments: "cm", transactions: "t", policies: "p", goals: "g" }[entity as string] ?? "x";
      const defaults: any = { archived: false, isIllustrative: false, dataStatus: entity === "commitments" ? "pending" : "collected" };
      item = { id: uid(prefix), clientId: cid, ...defaults, ...input };
      if (entity === "transactions" && item.holdingId && !getOne(db, "holdings", cid, item.holdingId)) throw new HttpError(422, "Holding not found for this client.");
      insertRow(db, SPECS_NAME[entity], item);
    }
    audit(db, { clientId: cid, userId: actor?.id, entity, entityId: item.id, action: "create", summary: `Added ${entity.replace(/s$/, "")} "${item.name ?? item.type ?? item.id}"`, after: item });
    return item;
  });
}
const SPECS_NAME: Record<string, SpecName> = { holdings: "holdings", liabilities: "liabilities", cashflows: "cashflows", commitments: "commitments", transactions: "transactions", policies: "policies", goals: "goals" };

export function updateEntity(db: DB, cid: string, entity: keyof typeof ENTITY_SCHEMAS, id: string, body: any, actor: Actor): any {
  requireClient(db, cid);
  const name = SPECS_NAME[entity];
  const existing = getOne<any>(db, name, cid, id);
  if (!existing) throw new HttpError(404, "Record not found.");
  // PATCH semantics: merge onto the stored record then validate the full object
  const merged = { ...stripMeta(existing), ...body };
  const input = parse<any>(ENTITY_SCHEMAS[entity], merged);
  return tx(db, () => {
    let item: any;
    if (entity === "holdings") {
      item = buildHolding(db, cid, input, existing);
      const valueChanged = item.currentValue !== existing.currentValue;
      if (valueChanged && !("valuationDate" in body)) item.valuationDate = todayISO();
      updateRow(db, "holdings", id, item);
      if (valueChanged) insertRow(db, "valuations", { id: uid("val"), holdingId: id, clientId: cid, date: item.valuationDate ?? todayISO(), value: item.currentValue, source: "manual", note: "Edited" });
    } else {
      item = { ...existing, ...input };
      updateRow(db, name, id, item);
    }
    audit(db, { clientId: cid, userId: actor?.id, entity, entityId: id, action: "update", summary: `Updated ${entity.replace(/s$/, "")} "${item.name ?? item.type ?? id}"`, before: existing, after: item });
    return item;
  });
}
function stripMeta(o: Record<string, any>) {
  const { id, clientId, assetClass, classificationMethod, classificationStatus, classificationReason, valuationSource, archived, isIllustrative, originalDescription, ...rest } = o;
  return rest;
}

export function removeEntity(db: DB, cid: string, entity: keyof typeof ENTITY_SCHEMAS | "snapshots", id: string, actor: Actor) {
  requireClient(db, cid);
  const name = (entity === "snapshots" ? "snapshots" : SPECS_NAME[entity]) as SpecName;
  const existing = getOne<any>(db, name, cid, id);
  if (!existing) throw new HttpError(404, "Record not found.");
  tx(db, () => {
    if (SPECS[name].archivable) {
      updateRow(db, name, id, { ...existing, archived: true });
      if (name === "holdings") for (const k of listAll<Holding>(db, "holdings", cid).filter((h) => h.parentId === id)) updateRow(db, "holdings", k.id, { ...k, parentId: null, archived: true });
    } else deleteRow(db, name, cid, id);
    audit(db, { clientId: cid, userId: actor?.id, entity, entityId: id, action: SPECS[name].archivable ? "archive" : "delete", summary: `${SPECS[name].archivable ? "Archived" : "Deleted"} ${entity.replace(/s$/, "")} "${existing.name ?? existing.type ?? id}"`, before: existing });
  });
}

export function restoreEntity(db: DB, cid: string, entity: keyof typeof ENTITY_SCHEMAS, id: string, actor: Actor) {
  const name = SPECS_NAME[entity];
  const existing = getOne<any>(db, name, cid, id);
  if (!existing || !SPECS[name].archivable) throw new HttpError(404, "Record not found.");
  updateRow(db, name, id, { ...existing, archived: false });
  audit(db, { clientId: cid, userId: actor?.id, entity, entityId: id, action: "restore", summary: `Restored ${entity.replace(/s$/, "")} "${existing.name ?? id}"` });
}

export function overrideClassification(db: DB, cid: string, id: string, assetClass: string | null, actor: Actor) {
  const h = getOne<Holding>(db, "holdings", cid, id);
  if (!h) throw new HttpError(404, "Holding not found.");
  const valid = ["indian_equity", "global_equity", "debt", "commodities", "real_estate", "reits_invits", "alternatives"];
  if (assetClass !== null && !valid.includes(assetClass)) throw new HttpError(422, "Unknown asset class.");
  const next = applyClassification({ ...h, classOverride: assetClass as any }, loadMappings(db, cid));
  updateRow(db, "holdings", id, next);
  audit(db, { clientId: cid, userId: actor?.id, entity: "holdings", entityId: id, action: "override", summary: assetClass ? `Category of "${h.name}" overridden to ${assetClass}` : `Category override removed on "${h.name}"`, before: { class: h.classOverride ?? h.assetClass }, after: { class: next.classOverride ?? next.assetClass } });
  return next;
}

export function reclassifyAll(db: DB, cid: string, actor: Actor) {
  const maps = loadMappings(db, cid);
  let changed = 0;
  tx(db, () => {
    for (const h of listAll<Holding>(db, "holdings", cid)) {
      const n = applyClassification(h, maps);
      if (n.assetClass !== h.assetClass || n.classificationMethod !== h.classificationMethod || n.classificationStatus !== h.classificationStatus) { updateRow(db, "holdings", h.id, n); changed++; }
    }
    audit(db, { clientId: cid, userId: actor?.id, entity: "holdings", action: "reclassify", summary: `Re-ran automatic classification (${changed} changed; user overrides untouched)` });
  });
  return changed;
}

/** Confirm that the underlying positions are the new truth for an aggregate: aggregate value := Σ children. */
export function reconcileAggregate(db: DB, cid: string, id: string, actor: Actor) {
  const parent = getOne<Holding>(db, "holdings", cid, id);
  if (!parent) throw new HttpError(404, "Holding not found.");
  const kids = listAll<Holding>(db, "holdings", cid).filter((h) => h.parentId === id);
  if (!kids.length) throw new HttpError(422, "No underlying positions to reconcile with.");
  const total = sum(kids.map((k) => k.currentValue));
  tx(db, () => {
    updateRow(db, "holdings", id, { ...parent, currentValue: total, valuationDate: todayISO() });
    insertRow(db, "valuations", { id: uid("val"), holdingId: id, clientId: cid, date: todayISO(), value: total, source: "reconcile", note: "Aggregate set to sum of underlying positions" });
    audit(db, { clientId: cid, userId: actor?.id, entity: "holdings", entityId: id, action: "reconcile", summary: `Reconciled "${parent.name}" to underlying total`, before: { value: parent.currentValue }, after: { value: total } });
  });
  return total;
}

export function recordSnapshot(db: DB, cid: string, opts: { date?: string; note?: string | null; grossAssets?: number; liabilities?: number | null; liabilitiesComplete?: boolean }, actor: Actor) {
  const date = opts.date ?? asOfDate();
  if (date > asOfDate()) throw new HttpError(422, "A snapshot cannot be dated in the future.");
  const d = requireClient(db, cid);
  let snap: any;
  if (opts.grossAssets != null) {
    // historical entry typed in by the user (e.g. last month's statement values) - never estimated
    if (!Number.isInteger(opts.grossAssets) || opts.grossAssets < 0) throw new HttpError(422, "Gross assets must be a non-negative amount.");
    if (opts.liabilities != null && (!Number.isInteger(opts.liabilities) || opts.liabilities < 0)) throw new HttpError(422, "Liabilities must be a non-negative amount.");
    snap = { id: uid("snap"), clientId: cid, date, grossAssets: opts.grossAssets, liabilities: opts.liabilities ?? null, netWorth: opts.liabilities == null ? null : opts.grossAssets - opts.liabilities,
      liabilitiesComplete: !!opts.liabilitiesComplete && opts.liabilities != null, source: "import", note: opts.note ?? "Entered manually" };
  } else {
    const nw = evaluateClient(d, date).netWorth;
    snap = { id: uid("snap"), clientId: cid, date, grossAssets: nw.grossAssets, liabilities: nw.liabilitiesStatus === "not_assessed" ? null : nw.liabilities, netWorth: nw.netWorth,
      liabilitiesComplete: nw.liabilitiesStatus === "complete", source: "manual", note: opts.note ?? null };
  }
  tx(db, () => {
    db.prepare("DELETE FROM snapshots WHERE client_id = ? AND date = ?").run(cid, date);
    insertRow(db, "snapshots", snap);
    audit(db, { clientId: cid, userId: actor?.id, entity: "snapshots", entityId: snap.id, action: "create", summary: `Recorded net-worth snapshot for ${date}`, after: snap });
  });
  return snap;
}

export function patchSettings(db: DB, cid: string, body: unknown, actor: Actor) {
  const patch = parse<any>(settingsPatch, body);
  const cur = loadSettings(db, cid);
  const next = { ...cur, ...patch };
  const dup = (a: string[], b: string[]) => a.some((x) => b.includes(x));
  if (dup(next.groupGrowth, next.groupDefensive)) throw new HttpError(422, "An asset class cannot be both growth and defensive.");
  tx(db, () => { saveSettings(db, cid, next); audit(db, { clientId: cid, userId: actor?.id, entity: "settings", action: "update", summary: `Updated settings (${Object.keys(patch).join(", ")})`, before: pick(cur, Object.keys(patch)), after: patch }); });
  return next;
}

export function updateRule(db: DB, cid: string, key: string, body: unknown, actor: Actor) {
  const def = RULE_DEF_BY_KEY[key as RuleKey];
  if (!def) throw new HttpError(404, "Unknown rule.");
  const patch = parse<any>(ruleIn, body);
  const cur = requireClient(db, cid).rules.find((r) => r.key === key)!;
  const next = { ...cur, ...patch, params: { ...cur.params, ...(patch.params ?? {}) } };
  if (patch.value !== undefined) { const err = validateRuleValue(key as RuleKey, patch.value); if (err) throw new HttpError(422, err, [{ field: "value", message: err }]); }
  tx(db, () => { saveRule(db, cid, next); audit(db, { clientId: cid, userId: actor?.id, entity: "rules", entityId: key, action: "update", summary: `Rule "${def.name}" changed`, before: cur, after: next }); });
  return next;
}

export function setTargets(db: DB, cid: string, body: unknown, actor: Actor) {
  const t = parse<any[]>(targetsIn, body);
  tx(db, () => { saveTargets(db, cid, t); audit(db, { clientId: cid, userId: actor?.id, entity: "targets", action: "update", summary: `Target allocation updated (${t.map((x) => `${x.assetClass} ${x.targetBps / 100}%`).join(", ") || "cleared"})`, after: t }); });
  return t;
}

export function classifyPreview(db: DB, cid: string, body: any) {
  const maps = loadMappings(db, cid);
  const out: any = {};
  if (body?.name && body?.instrumentType) out.asset = classifyHolding({ name: String(body.name), originalDescription: String(body.name), instrumentType: body.instrumentType, classOverride: body.classOverride ?? null }, maps);
  if (body?.name && body?.kind) out.cashflow = classifyCashflow(String(body.name), body.kind, maps);
  return out;
}

export function runScenario(db: DB, cid: string, trades: Trade[]) {
  const data = requireClient(db, cid);
  const asOf = asOfDate();
  const before = evaluateClient(data, asOf);
  const { data: d2, warnings } = applyTrades(data, trades);
  const after = evaluateClient(d2, asOf);
  const brief = (e: Evaluation) => ({
    grossAssets: e.portfolio.grossAssets, netWorth: e.netWorth.netWorth, allocation: e.allocation[e.activeDenominator], equity: e.equityBounds, health: e.health.overall,
    liquidAssets: e.portfolio.liquidAssets, emergencyMonths: e.emergencyCoverageMonths, rules: e.rules.map((r) => ({ key: r.key, name: r.name, state: r.state, summary: r.summary })),
    growthDefensive: e.growthDefensive,
  });
  return { warnings, before: brief(before), after: brief(after), rebalanceAfter: after.rebalance };
}
export { listAlerts };
