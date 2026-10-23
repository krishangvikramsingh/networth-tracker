import type { AssetClass, CashflowCategory, InstrumentType } from "./taxonomy";
import { INSTRUMENT_DEFAULTS } from "./taxonomy";
import type { CategoryMapping, ClassificationMethod, ClassificationStatus, Holding } from "./types";

export interface ClassificationResult {
  assetClass: AssetClass | null;
  method: ClassificationMethod;
  status: ClassificationStatus;
  reason: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Deterministic asset classification.
 * Order: 1) explicit user override 2) exact item-name mapping 3) instrument-type mapping (when the type
 * itself is unambiguous) 4) keyword fallback 5) provisional instrument-type default 6) review queue.
 */
export function classifyHolding(
  h: Pick<Holding, "name" | "originalDescription" | "instrumentType" | "classOverride">,
  mappings: CategoryMapping[],
): ClassificationResult {
  if (h.classOverride) {
    return { assetClass: h.classOverride, method: "user_override", status: "confirmed", reason: "Category set explicitly by the user." };
  }
  const assetMaps = mappings.filter((m) => m.domain === "asset").sort((a, b) => b.priority - a.priority);
  const name = norm(h.name);
  const text = norm(`${h.name} ${h.originalDescription ?? ""}`);

  for (const m of assetMaps) {
    if (m.matchType === "exact" && norm(m.pattern) === name) {
      return { assetClass: m.category as AssetClass, method: "exact_name", status: "confirmed", reason: `Exact name mapping "${m.pattern}" → ${m.category}.` };
    }
  }
  const def = INSTRUMENT_DEFAULTS[h.instrumentType as InstrumentType] ?? INSTRUMENT_DEFAULTS.other;
  if (def.assetClass && def.status === "confirmed") {
    return { assetClass: def.assetClass, method: "instrument_type", status: "confirmed", reason: `Instrument type "${h.instrumentType}" maps to ${def.assetClass}.` };
  }
  for (const m of assetMaps) {
    if (m.matchType === "keyword" && text.includes(norm(m.pattern))) {
      return { assetClass: m.category as AssetClass, method: "keyword", status: "provisional", reason: `Keyword "${m.pattern}" suggests ${m.category}; please confirm.` };
    }
  }
  if (def.assetClass) {
    return { assetClass: def.assetClass, method: "instrument_type", status: def.status, reason: def.note ?? `Default for instrument type "${h.instrumentType}".` };
  }
  return { assetClass: null, method: "unresolved", status: "needs_review", reason: def.note ?? "No rule could classify this holding confidently." };
}

/** Apply (re)classification result onto a holding-shaped object. */
export function applyClassification<T extends Holding>(h: T, mappings: CategoryMapping[]): T {
  const r = classifyHolding(h, mappings);
  const geography = r.assetClass === "global_equity" ? "global" : r.assetClass === "indian_equity" ? (h.geography ?? "india") : h.geography;
  return { ...h, assetClass: r.assetClass, classificationMethod: r.method, classificationStatus: r.status, classificationReason: r.reason, geography };
}

export interface CashflowClassification { category: CashflowCategory | null; method: "keyword" | "exact_name" | "unresolved"; reason: string }

export function classifyCashflow(name: string, kind: "income" | "expense", mappings: CategoryMapping[]): CashflowClassification {
  const text = norm(name);
  const maps = mappings.filter((m) => m.domain === "cashflow").sort((a, b) => b.priority - a.priority);
  for (const m of maps) {
    if (m.matchType === "exact" && norm(m.pattern) === text) return { category: m.category as CashflowCategory, method: "exact_name", reason: `Exact mapping "${m.pattern}".` };
  }
  const incomeOnly = (c: string) => ["salary", "business", "rental", "interest", "dividend", "pension", "other_income"].includes(c);
  for (const m of maps) {
    if (m.matchType !== "keyword" || !text.includes(norm(m.pattern))) continue;
    const isIncomeCat = incomeOnly(m.category);
    if (kind === "income" && !isIncomeCat) continue;
    if (kind === "expense" && isIncomeCat) continue;
    return { category: m.category as CashflowCategory, method: "keyword", reason: `Keyword "${m.pattern}" → ${m.category}.` };
  }
  return { category: null, method: "unresolved", reason: "No mapping matched; choose a category." };
}

/** Seed mappings derived from the project brief (workbook 'Category Mappings' sheet could not be inspected - see docs). */
export function defaultMappings(): CategoryMapping[] {
  let n = 0;
  const m = (domain: "asset" | "cashflow", matchType: "exact" | "keyword", pattern: string, category: string, priority = 10): CategoryMapping =>
    ({ id: `map_${++n}`, domain, matchType, pattern, category, priority, source: "brief" });
  return [
    // exact names (brief's asset list)
    m("asset", "exact", "Residential property", "real_estate", 100),
    m("asset", "exact", "Gold", "commodities", 100),
    m("asset", "exact", "Fixed deposits", "debt", 100),
    m("asset", "exact", "Fixed deposit", "debt", 100),
    // keyword fallbacks
    m("asset", "keyword", "gold", "commodities", 50),
    m("asset", "keyword", "silver", "commodities", 50),
    m("asset", "keyword", "reit", "reits_invits", 50),
    m("asset", "keyword", "invit", "reits_invits", 50),
    m("asset", "keyword", "s&p 500", "global_equity", 60),
    m("asset", "keyword", "nasdaq", "global_equity", 60),
    m("asset", "keyword", "global", "global_equity", 40),
    m("asset", "keyword", "international", "global_equity", 40),
    m("asset", "keyword", "us equity", "global_equity", 40),
    m("asset", "keyword", "nifty", "indian_equity", 40),
    m("asset", "keyword", "sensex", "indian_equity", 40),
    m("asset", "keyword", "flexi cap", "indian_equity", 30),
    m("asset", "keyword", "large cap", "indian_equity", 30),
    m("asset", "keyword", "mid cap", "indian_equity", 30),
    m("asset", "keyword", "small cap", "indian_equity", 30),
    m("asset", "keyword", "liquid", "debt", 40),
    m("asset", "keyword", "overnight", "debt", 40),
    m("asset", "keyword", "gilt", "debt", 40),
    m("asset", "keyword", "debt", "debt", 30),
    m("asset", "keyword", "bond", "debt", 30),
    m("asset", "keyword", "short duration", "debt", 30),
    m("asset", "keyword", "corporate bond", "debt", 35),
    m("asset", "keyword", "property", "real_estate", 30),
    m("asset", "keyword", "apartment", "real_estate", 30),
    m("asset", "keyword", "private equity", "alternatives", 30),
    m("asset", "keyword", "venture", "alternatives", 30),
    m("asset", "keyword", "aif", "alternatives", 20),
    // cashflow
    m("cashflow", "keyword", "salary", "salary"), m("cashflow", "keyword", "payroll", "salary"),
    m("cashflow", "keyword", "consult", "business"), m("cashflow", "keyword", "professional", "business"), m("cashflow", "keyword", "business income", "business"),
    m("cashflow", "keyword", "rent received", "rental", 20), m("cashflow", "keyword", "rental", "rental"),
    m("cashflow", "keyword", "interest", "interest"), m("cashflow", "keyword", "dividend", "dividend"), m("cashflow", "keyword", "distribution", "dividend"),
    m("cashflow", "keyword", "pension premium", "pension_premium", 30), m("cashflow", "keyword", "pension", "pension"), m("cashflow", "keyword", "annuity", "pension"),
    m("cashflow", "keyword", "household", "household"), m("cashflow", "keyword", "grocer", "household"), m("cashflow", "keyword", "utility", "household"), m("cashflow", "keyword", "rent", "household", 5),
    m("cashflow", "keyword", "medical", "medical"), m("cashflow", "keyword", "hospital", "medical"), m("cashflow", "keyword", "pharmacy", "medical"), m("cashflow", "keyword", "doctor", "medical"),
    m("cashflow", "keyword", "emi", "loan_emi"), m("cashflow", "keyword", "loan", "loan_emi"),
    m("cashflow", "keyword", "premium", "insurance_premium", 10), m("cashflow", "keyword", "insurance", "insurance_premium"),
    m("cashflow", "keyword", "sip", "investment_contribution"), m("cashflow", "keyword", "mutual fund", "investment_contribution"),
    m("cashflow", "keyword", "office", "business_expense"), m("cashflow", "keyword", "operating", "business_expense"),
  ];
}
