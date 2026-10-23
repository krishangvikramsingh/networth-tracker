import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { useApp } from "./store";
import { Badge, Banner, Field, Modal, MoneyInput } from "./ui";
import {
  ASSET_CLASSES, ASSET_CLASS_LABEL, CASHFLOW_LABEL, EXPENSE_CATEGORIES, INCOME_CATEGORIES, INSTRUMENT_DEFAULTS, INSTRUMENT_LABEL, INSTRUMENT_TYPES, LIABILITY_LABEL, LIABILITY_TYPES, LIQUIDITY_LABEL, DATA_STATUS_LABEL,
} from "@shared/taxonomy";

type FieldType = "text" | "money" | "date" | "select" | "number" | "bool" | "textarea";
interface FDef { key: string; label: string; type: FieldType; options?: Array<[string, string]>; hint?: string; full?: boolean; show?: (v: Rec) => boolean; placeholder?: string }
type Rec = Record<string, any>;

const FREQ: Array<[string, string]> = [["monthly", "Monthly"], ["quarterly", "Quarterly"], ["half_yearly", "Half-yearly"], ["annual", "Annual"], ["once", "One-off"]];
const STATUS: Array<[string, string]> = Object.entries(DATA_STATUS_LABEL) as Array<[string, string]>;

export type EntityName = "holdings" | "liabilities" | "cashflows" | "commitments" | "transactions" | "policies" | "goals";

const TITLES: Record<EntityName, string> = { holdings: "holding", liabilities: "liability", cashflows: "cash-flow item", commitments: "commitment", transactions: "transaction", policies: "insurance policy", goals: "goal" };

function fieldsFor(entity: EntityName, v: Rec, ctx: { holdings: Array<{ id: string; name: string; parentId: string | null }>; editingId?: string }): FDef[] {
  switch (entity) {
    case "holdings": {
      const type = v.instrumentType as keyof typeof INSTRUMENT_DEFAULTS;
      return [
        { key: "name", label: "Name", type: "text", full: true, placeholder: "e.g. Parag Parikh Flexi Cap Fund" },
        { key: "instrumentType", label: "Instrument type", type: "select", options: INSTRUMENT_TYPES.map((t) => [t, INSTRUMENT_LABEL[t]]) },
        { key: "parentId", label: "Underlying position of (optional)", type: "select", options: [["", "— none (top-level) —"], ...ctx.holdings.filter((h) => !h.parentId && h.id !== ctx.editingId).map((h) => [h.id, h.name] as [string, string])], hint: "Choose an aggregate (e.g. Mutual-fund holdings) to split it into schemes. The total reconciles; it is never double counted." },
        { key: "currentValue", label: "Current market value", type: "money" },
        { key: "investedValue", label: "Invested capital (cost)", type: "money", hint: "Needed for absolute return & XIRR." },
        { key: "acquisitionDate", label: "Acquisition date", type: "date" },
        { key: "valuationDate", label: "Valuation as-of date", type: "date" },
        { key: "classOverride", label: "Asset-class override", type: "select", options: [["", "Automatic"], ...ASSET_CLASSES.map((c) => [c, ASSET_CLASS_LABEL[c]] as [string, string])], hint: "Leave on Automatic to use the classification engine." },
        { key: "isAggregate", label: "This is an aggregate (summary) holding", type: "bool" },
        { key: "quantity", label: "Quantity / units", type: "number" },
        { key: "symbol", label: "Symbol / scheme code / ISIN", type: "text" },
        { key: "issuer", label: "Issuer / AMC / institution", type: "text" },
        { key: "account", label: "Account / folio", type: "text" },
        { key: "maturityDate", label: "Maturity date", type: "date", show: () => ["fixed_deposit", "bond", "aif", "pension_annuity"].includes(type) },
        { key: "expectedMaturityValue", label: "Expected maturity proceeds", type: "money", show: () => ["fixed_deposit", "bond", "pension_annuity"].includes(type) },
        { key: "liquidityTier", label: "Liquidity", type: "select", options: ([1, 2, 3, 4] as const).map((t) => [String(t), LIQUIDITY_LABEL[t]] as [string, string]) },
        { key: "emergencyEligible", label: "Counts toward emergency reserves", type: "bool" },
        { key: "dataStatus", label: "Data status", type: "select", options: STATUS },
        { key: "notes", label: "Notes", type: "textarea", full: true },
      ];
    }
    case "liabilities":
      return [
        { key: "name", label: "Name", type: "text", full: true }, { key: "type", label: "Type", type: "select", options: LIABILITY_TYPES.map((t) => [t, LIABILITY_LABEL[t]]) }, { key: "lender", label: "Lender", type: "text" },
        { key: "outstanding", label: "Outstanding principal / balance", type: "money" }, { key: "originalPrincipal", label: "Original principal", type: "money", show: (x) => x.type !== "credit_card" },
        { key: "emi", label: "Monthly EMI", type: "money", show: (x) => x.type !== "credit_card", hint: "Credit-card balances are liabilities, not EMIs." },
        { key: "ratePct", label: "Interest rate (% p.a.)", type: "number", show: (x) => x.type !== "credit_card" }, { key: "remainingMonths", label: "Remaining tenure (months)", type: "number", show: (x) => x.type !== "credit_card" },
        { key: "nextDueDate", label: "Next due date", type: "date" }, { key: "dataStatus", label: "Data status", type: "select", options: STATUS }, { key: "notes", label: "Notes", type: "textarea", full: true },
      ];
    case "cashflows": {
      const cats = v.kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      return [
        { key: "kind", label: "Type", type: "select", options: [["income", "Income / inflow"], ["expense", "Expense / outflow"]] },
        { key: "category", label: "Category", type: "select", options: cats.map((c) => [c, CASHFLOW_LABEL[c]] as [string, string]) },
        { key: "name", label: "Description", type: "text", full: true, placeholder: "e.g. Monthly salary" },
        { key: "amount", label: "Amount per occurrence", type: "money" }, { key: "frequency", label: "Frequency", type: "select", options: FREQ },
        { key: "anchorDate", label: v.frequency === "monthly" ? "First / next date (optional)" : "Date of (next) occurrence", type: "date", hint: v.frequency !== "monthly" ? "Without a date, non-monthly items appear as 'unscheduled' in the forecast." : undefined },
        { key: "endDate", label: "End date (optional)", type: "date", show: (x) => x.frequency !== "once" },
        { key: "verified", label: "Income is verified (counts toward EMI ratio)", type: "bool", show: (x) => x.kind === "income" },
        { key: "essential", label: "Essential expense (emergency-fund base)", type: "bool", show: (x) => x.kind === "expense" },
        { key: "notes", label: "Notes", type: "textarea", full: true },
      ];
    }
    case "commitments":
      return [
        { key: "name", label: "Name", type: "text", full: true }, { key: "kind", label: "Kind", type: "select", options: [["pension_premium", "Pension-plan premium"], ["insurance_premium", "Insurance premium"], ["other", "Other commitment"]] },
        { key: "totalAmount", label: "Total commitment", type: "money" }, { key: "paidAmount", label: "Already paid", type: "money" },
        { key: "installmentAmount", label: "Instalment amount", type: "money", hint: "Leave blank if the schedule is not known yet." }, { key: "frequency", label: "Instalment frequency", type: "select", options: [["", "— not scheduled —"], ...FREQ] },
        { key: "nextDueDate", label: "Next due date", type: "date" }, { key: "endDate", label: "Final due date", type: "date" },
        { key: "annualReceivable", label: "Annual pension receivable", type: "money", show: (x) => x.kind === "pension_premium" }, { key: "notes", label: "Notes", type: "textarea", full: true },
      ];
    case "transactions":
      return [
        { key: "holdingId", label: "Holding", type: "select", options: [["", "— whole portfolio —"], ...ctx.holdings.map((h) => [h.id, h.name] as [string, string])] },
        { key: "type", label: "Type", type: "select", options: [["purchase", "Purchase"], ["contribution", "Contribution / top-up"], ["sale", "Sale"], ["withdrawal", "Withdrawal"], ["dividend", "Dividend"], ["distribution", "Distribution"], ["fee", "Fee paid"], ["transfer", "Transfer (internal)"]] },
        { key: "date", label: "Date", type: "date" }, { key: "amount", label: "Amount", type: "money" }, { key: "quantity", label: "Units", type: "number" }, { key: "notes", label: "Notes", type: "textarea", full: true },
      ];
    case "policies":
      return [
        { key: "type", label: "Policy type", type: "select", options: [["term_life", "Term life"], ["health", "Health"], ["home", "Home"], ["vehicle", "Vehicle"], ["ulip", "ULIP"], ["endowment", "Endowment"], ["other", "Other"]] }, { key: "insurer", label: "Insurer", type: "text" },
        { key: "policyNo", label: "Policy number", type: "text" }, { key: "sumAssured", label: "Sum assured", type: "money" }, { key: "annualPremium", label: "Annual premium", type: "money" },
        { key: "premiumFrequency", label: "Premium frequency", type: "select", options: [["", "—"], ...FREQ] }, { key: "nextPremiumDate", label: "Next premium due", type: "date" }, { key: "renewalDate", label: "Renewal date", type: "date" },
        { key: "maturityDate", label: "Maturity date", type: "date" }, { key: "expectedMaturityValue", label: "Expected maturity value", type: "money" },
      ];
    case "goals":
      return [
        { key: "name", label: "Goal name", type: "text", full: true }, { key: "type", label: "Type", type: "select", options: [["retirement", "Retirement"], ["property", "Property purchase"], ["education", "Education"], ["business", "Business capital"], ["emergency", "Emergency reserve"], ["wealth", "Long-term wealth"], ["other", "Other"]] },
        { key: "targetDate", label: "Target date", type: "date" }, { key: "targetAmount", label: "Target amount", type: "money" }, { key: "earmarkedAmount", label: "Currently earmarked", type: "money" },
        { key: "monthlyContribution", label: "Planned monthly contribution", type: "money" }, { key: "returnPct", label: "Expected return % p.a. (your assumption, optional)", type: "number", hint: "Leave blank for a 0% projection. Not a forecast." }, { key: "notes", label: "Notes", type: "textarea", full: true },
      ];
  }
}

const BLANK: Record<EntityName, Rec> = {
  holdings: { name: "", instrumentType: "equity_mf", currentValue: null, investedValue: null, acquisitionDate: "", valuationDate: new Date().toISOString().slice(0, 10), classOverride: "", parentId: "", isAggregate: false, quantity: "", symbol: "", issuer: "", account: "", maturityDate: "", expectedMaturityValue: null, liquidityTier: "2", emergencyEligible: false, dataStatus: "collected", notes: "" },
  liabilities: { name: "", type: "home_loan", lender: "", outstanding: null, originalPrincipal: null, emi: null, ratePct: "", remainingMonths: "", nextDueDate: "", dataStatus: "collected", notes: "" },
  cashflows: { kind: "income", category: "salary", name: "", amount: null, frequency: "monthly", anchorDate: "", endDate: "", verified: false, essential: false, notes: "" },
  commitments: { name: "", kind: "pension_premium", totalAmount: null, paidAmount: 0, installmentAmount: null, frequency: "", nextDueDate: "", endDate: "", annualReceivable: null, notes: "" },
  transactions: { holdingId: "", type: "purchase", date: new Date().toISOString().slice(0, 10), amount: null, quantity: "", notes: "" },
  policies: { type: "term_life", insurer: "", policyNo: "", sumAssured: null, annualPremium: null, premiumFrequency: "annual", nextPremiumDate: "", renewalDate: "", maturityDate: "", expectedMaturityValue: null },
  goals: { name: "", type: "wealth", targetDate: "", targetAmount: null, earmarkedAmount: 0, monthlyContribution: 0, returnPct: "", notes: "" },
};

/** server record -> form state */
function toForm(entity: EntityName, r: Rec): Rec {
  const f: Rec = { ...BLANK[entity] };
  for (const k of Object.keys(f)) {
    const v = r[k];
    if (v === undefined) continue;
    f[k] = v === null ? (typeof BLANK[entity][k] === "boolean" ? false : BLANK[entity][k] === null || k.toLowerCase().includes("amount") ? null : "") : typeof v === "number" && ["liquidityTier"].includes(k) ? String(v) : v;
    if (v === null && typeof BLANK[entity][k] === "number") f[k] = 0;
  }
  if (entity === "liabilities") f.ratePct = r.rateBps == null ? "" : String(r.rateBps / 100);
  if (entity === "goals") f.returnPct = r.expectedReturnBps == null ? "" : String(r.expectedReturnBps / 100);
  return f;
}
const blankToNull = (x: any) => (x === "" || x === undefined ? null : x);
function toPayload(entity: EntityName, f: Rec): Rec {
  const p: Rec = {};
  for (const [k, v] of Object.entries(f)) p[k] = blankToNull(v);
  for (const k of ["quantity", "remainingMonths"]) if (k in p && p[k] != null) p[k] = Number(p[k]);
  if (entity === "holdings") { p.liquidityTier = Number(p.liquidityTier); p.parentId = p.parentId || null; p.classOverride = p.classOverride || null; if (p.currentValue == null) p.currentValue = NaN; }
  if (entity === "liabilities") { p.rateBps = p.ratePct == null ? null : Math.round(Number(p.ratePct) * 100); delete p.ratePct; }
  if (entity === "goals") { p.expectedReturnBps = p.returnPct == null ? null : Math.round(Number(p.returnPct) * 100); delete p.returnPct; }
  if (entity === "commitments") { p.frequency = p.frequency || null; }
  if (entity === "policies") { p.premiumFrequency = p.premiumFrequency || null; }
  if (entity === "transactions") { p.holdingId = p.holdingId || null; }
  return p;
}

export function EntityForm({ entity, initial, defaults, onClose, onSaved, title }: { entity: EntityName; initial?: Rec; defaults?: Rec; onClose: () => void; onSaved?: (item: any) => void; title?: string }) {
  const { state, clientId, run, toast } = useApp();
  const editing = !!initial?.id;
  const [v, setV] = useState<Rec>(() => (initial ? toForm(entity, initial) : { ...BLANK[entity], ...defaults }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idem = useRef(api.newKey());
  const [suggest, setSuggest] = useState<any>(null);
  const holdings = (state?.data.holdings ?? []).map((h) => ({ id: h.id, name: h.name, parentId: h.parentId }));
  const fields = useMemo(() => fieldsFor(entity, v, { holdings, editingId: initial?.id }), [entity, v, holdings.length]);

  const set = (k: string, val: any) => setV((p) => {
    const n = { ...p, [k]: val };
    if (entity === "holdings" && k === "instrumentType" && !editing) {
      const d = INSTRUMENT_DEFAULTS[val as keyof typeof INSTRUMENT_DEFAULTS];
      n.liquidityTier = String(d.liquidity); n.emergencyEligible = d.emergencyEligible;
    }
    if (entity === "cashflows" && k === "kind") n.category = val === "income" ? "salary" : "household";
    if (entity === "liabilities" && k === "type" && val === "credit_card") { n.emi = null; }
    return n;
  });

  // live classification preview (automatic categorisation) ------------------------------------
  const nameForPreview = v.name as string;
  useEffect(() => {
    if (!clientId || !nameForPreview || nameForPreview.length < 2) { setSuggest(null); return; }
    if (entity !== "holdings" && entity !== "cashflows") return;
    const t = setTimeout(() => {
      api.post(`/api/clients/${clientId}/classify/preview`, entity === "holdings" ? { name: nameForPreview, instrumentType: v.instrumentType, classOverride: v.classOverride || null } : { name: nameForPreview, kind: v.kind })
        .then(setSuggest).catch(() => setSuggest(null));
    }, 250);
    return () => clearTimeout(t);
  }, [entity, clientId, nameForPreview, v.instrumentType, v.kind, v.classOverride]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErrors({}); setFormErr(null);
    try {
      const payload = toPayload(entity, v);
      if (entity === "holdings" && Number.isNaN(payload.currentValue)) { setErrors({ currentValue: "Enter the current value." }); setBusy(false); return; }
      for (const k of ["amount", "outstanding", "totalAmount", "targetAmount"]) if (k in payload && payload[k] == null) { setErrors({ [k]: "Enter an amount." }); setBusy(false); return; }
      const url = `/api/clients/${clientId}/${entity}`;
      const res = editing ? await api.patch(`${url}/${initial!.id}`, payload) : await api.post(url, payload, idem.current);
      await run(async () => {}, `${editing ? "Updated" : "Added"} ${TITLES[entity]}`);
      onSaved?.(res.item); onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        const m: Record<string, string> = {};
        for (const d of err.details) if (d.field) m[d.field === "ratePct" ? "ratePct" : d.field] = d.message;
        setErrors(m);
        if (!Object.keys(m).length) setFormErr(err.message);
      } else setFormErr(err instanceof Error ? err.message : "Could not save.");
      toast("Please fix the highlighted fields.", "err");
    } finally { setBusy(false); }
  }

  return (
    <Modal title={title ?? `${editing ? "Edit" : "Add"} ${TITLES[entity]}`} onClose={onClose} wide
      footer={<><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" form="entity-form" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add"}</button></>}>
      <form id="entity-form" onSubmit={submit} noValidate>
        {formErr && <Banner tone="crit">{formErr}</Banner>}
        <div className="form-grid" style={formErr ? { marginTop: 12 } : undefined}>
          {fields.filter((f) => !f.show || f.show(v)).map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint} error={errors[f.key]} full={f.full || f.type === "textarea"}>
              {f.type === "money" ? <MoneyInput value={v[f.key]} onChange={(x) => set(f.key, x)} />
                : f.type === "select" ? <select value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}>{f.options!.map(([val, label]) => <option key={val} value={val}>{label}</option>)}</select>
                : f.type === "bool" ? <label className="check"><input type="checkbox" checked={!!v[f.key]} onChange={(e) => set(f.key, e.target.checked)} /> Yes</label>
                : f.type === "textarea" ? <textarea rows={2} value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                : f.type === "date" ? <input type="date" value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                : f.type === "number" ? <input type="number" step="any" value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                : <input type="text" value={v[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />}
            </Field>))}
        </div>
        {entity === "holdings" && suggest?.asset && !editing && (
          <div className="banner info" style={{ marginTop: 12 }}><div><b>Automatic classification:</b> {suggest.asset.assetClass ? ASSET_CLASS_LABEL[suggest.asset.assetClass as keyof typeof ASSET_CLASS_LABEL] : "Needs review"}{" "}
            <Badge tone={suggest.asset.status === "confirmed" ? "good" : suggest.asset.status === "provisional" ? "warn" : "serious"}>{suggest.asset.status.replace("_", " ")}</Badge> <span className="muted">via {String(suggest.asset.method).replace("_", " ")}</span><div className="small">{suggest.asset.reason}</div></div></div>)}
        {entity === "cashflows" && suggest?.cashflow?.category && v.category !== suggest.cashflow.category && (
          <div className="banner info" style={{ marginTop: 12 }}><div>Suggested category: <b>{CASHFLOW_LABEL[suggest.cashflow.category as keyof typeof CASHFLOW_LABEL]}</b> <button type="button" className="btn sm" onClick={() => set("category", suggest.cashflow.category)}>Use it</button> <span className="muted small">{suggest.cashflow.reason}</span></div></div>)}
        {entity === "cashflows" && v.frequency === "once" && <p className="small muted" style={{ marginTop: 8 }}>One-off items require a date.</p>}
      </form>
    </Modal>
  );
}
