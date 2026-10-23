import { crore, lakh, rupees, type Paise } from "./money";
import { INSTRUMENT_DEFAULTS, DEFAULT_GROUPING, ASSET_CLASSES, type AssetClass, type InstrumentType } from "./taxonomy";
import { applyClassification, defaultMappings } from "./classify";
import { defaultRules } from "./rules";
import type { AllocationTarget, CashflowItem, ClientData, ClientSettings, Commitment, Holding, Liability } from "./types";

export const PRIYA_ID = "client_priya";
export const CASE_IDS = { A: "case_a_aggressive", B: "case_b_conservative", C: "case_c_moderate" } as const;

/** The 50/20/10/10/5/5 sample from the professor's brief. Not a validated personal policy. */
export const SAMPLE_TARGETS: AllocationTarget[] = [
  { assetClass: "indian_equity", targetBps: 5000, bandBps: null },
  { assetClass: "global_equity", targetBps: 2000, bandBps: null },
  { assetClass: "debt", targetBps: 1000, bandBps: null },
  { assetClass: "commodities", targetBps: 1000, bandBps: null },
  { assetClass: "reits_invits", targetBps: 500, bandBps: null },
  { assetClass: "alternatives", targetBps: 500, bandBps: null },
];

export function defaultSettings(kind: "live" | "case" = "live"): ClientSettings {
  return {
    denominator: "investable", concentrationDenominator: "investable", liabilitiesStatus: "not_assessed", incomeStatus: "pending",
    emergencyMonthsTarget: 6,
    healthWeights: { net_worth: 20, cash_flow: 20, emergency: 20, debt: 15, diversification: 15, insurance: 10 },
    scoreBands: [{ min: 0, label: "Needs attention" }, { min: 40, label: "Fair" }, { min: 60, label: "Good" }, { min: 80, label: "Strong" }],
    savingsExcludedCategories: ["investment_contribution", "pension_premium"],
    groupGrowth: ASSET_CLASSES.filter((c) => DEFAULT_GROUPING[c] === "growth"), groupDefensive: ASSET_CLASSES.filter((c) => DEFAULT_GROUPING[c] === "defensive"),
    stalenessDays: 45, insuranceLifeCoverMultiple: 10,
    nwStrengthBands: [{ multiple: 0, score: 0 }, { multiple: 5, score: 40 }, { multiple: 15, score: 70 }, { multiple: 25, score: 100 }],
    investmentPolicyValidated: false, profileKind: kind, profileNote: null,
  };
}

/** EMI = P·r·(1+r)^n / ((1+r)^n − 1) with monthly rate r. */
export function emiOf(principal: Paise, annualRatePct: number, months: number): Paise {
  const r = annualRatePct / 1200;
  if (r === 0) return Math.round(principal / months);
  const g = Math.pow(1 + r, months);
  return Math.round((principal * r * g) / (g - 1));
}

let hn = 0;
export function mkHolding(clientId: string, p: Partial<Holding> & { name: string; instrumentType: InstrumentType; currentValue: Paise }, mappings = defaultMappings()): Holding {
  const def = INSTRUMENT_DEFAULTS[p.instrumentType];
  const h: Holding = {
    id: p.id ?? `h_${clientId}_${++hn}`, clientId, originalDescription: p.name, assetClass: null, classOverride: null, classificationMethod: "unresolved", classificationStatus: "needs_review",
    classificationReason: "", geography: null, issuer: null, account: null, symbol: null, sector: null, quantity: null, investedValue: null, acquisitionDate: null, valuationDate: null,
    valuationSource: "manual", maturityDate: null, expectedMaturityValue: null, liquidityTier: def.liquidity, emergencyEligible: def.emergencyEligible, parentId: null, isAggregate: false,
    dataStatus: "collected", notes: null, archived: false, isIllustrative: false, ...p,
  };
  return applyClassification(h, mappings);
}

export function mkLiability(clientId: string, p: Partial<Liability> & { name: string; type: Liability["type"]; outstanding: Paise }): Liability {
  return { id: p.id ?? `l_${clientId}_${++hn}`, clientId, lender: null, originalPrincipal: null, emi: null, rateBps: null, remainingMonths: null, nextDueDate: null, minimumDue: null, dataStatus: "collected", notes: null, archived: false, isIllustrative: false, ...p };
}
export function mkCashflow(clientId: string, p: Partial<CashflowItem> & { name: string; kind: CashflowItem["kind"]; category: CashflowItem["category"]; amount: Paise }): CashflowItem {
  return { id: p.id ?? `c_${clientId}_${++hn}`, clientId, frequency: "monthly", anchorDate: null, endDate: null, verified: true, essential: false, commitmentId: null, liabilityId: null, dataStatus: "collected", notes: null, archived: false, isIllustrative: false, ...p };
}

export function buildPriya(): ClientData {
  const id = PRIYA_ID;
  const hs: Holding[] = [
    mkHolding(id, { id: "h_priya_property", name: "Residential property", instrumentType: "property_residential", currentValue: crore(2.5), notes: "Valuation date and basis not supplied." }),
    mkHolding(id, { id: "h_priya_gold", name: "Gold", instrumentType: "gold_physical", currentValue: lakh(20), notes: "Form of gold (physical / ETF / SGB) not specified; treated as physical." }),
    mkHolding(id, { id: "h_priya_fd", name: "Fixed deposits", instrumentType: "fixed_deposit", currentValue: lakh(60), isAggregate: true, dataStatus: "pending", notes: "Individual FDs, banks and maturity dates not yet supplied." }),
    mkHolding(id, { id: "h_priya_mf", name: "Mutual-fund holdings", instrumentType: "mutual_fund_aggregate", currentValue: crore(1.83), isAggregate: true, dataStatus: "needs_review", notes: "Equity / debt scheme split not yet supplied." }),
    mkHolding(id, { id: "h_priya_equity", name: "Direct equity holdings", instrumentType: "direct_stock", currentValue: crore(1.5), isAggregate: true, dataStatus: "pending", notes: "Stock-level positions and quantities not yet supplied." }),
    mkHolding(id, { id: "h_priya_pms", name: "PMS portfolio", instrumentType: "pms", currentValue: lakh(70), isAggregate: true, dataStatus: "pending", notes: "Underlying PMS exposures not yet supplied." }),
    mkHolding(id, { id: "h_priya_aif", name: "AIF holdings", instrumentType: "aif", currentValue: crore(1.3), isAggregate: true, dataStatus: "pending", notes: "AIF strategy and underlying exposures not yet supplied." }),
  ];
  const commitment: Commitment = {
    id: "cm_priya_pension", clientId: id, name: "Pension plan premiums", kind: "pension_premium", totalAmount: crore(1), paidAmount: lakh(80),
    installmentAmount: null, frequency: null, nextDueDate: null, endDate: null, annualReceivable: lakh(5), dataStatus: "pending",
    notes: "₹20 lakh remains payable. Payment schedule not yet supplied — shown as an unscheduled commitment, not as a loan.", archived: false, isIllustrative: false,
  };
  const cf: CashflowItem[] = [
    mkCashflow(id, { id: "c_priya_household", name: "Household expenses", kind: "expense", category: "household", amount: lakh(1), essential: true }),
    mkCashflow(id, { id: "c_priya_medical", name: "Medical expenses", kind: "expense", category: "medical", amount: lakh(1), essential: true }),
    mkCashflow(id, { id: "c_priya_pension", name: "Annual pension receivable", kind: "income", category: "pension", amount: lakh(5), frequency: "annual", commitmentId: commitment.id, dataStatus: "collected", notes: "Receipt date not supplied; shown as unscheduled in the dated forecast." }),
  ];
  return {
    client: { id, name: "Priya Ramanathan", kind: "live", description: "Initial live demonstration client (figures from the project brief).", createdAt: "2026-10-01T00:00:00.000Z" },
    settings: { ...defaultSettings("live"), profileNote: "Only information from the brief is loaded. Nothing else is assumed." },
    holdings: hs, liabilities: [], cashflows: cf, commitments: [commitment], transactions: [], snapshots: [], policies: [], goals: [],
    targets: SAMPLE_TARGETS.map((t) => ({ ...t })), rules: defaultRules(), mappings: defaultMappings(), valuations: [], scoreHistory: [],
  };
}

interface CaseSpec { id: string; name: string; description: string; note: string; holdings: Array<[string, InstrumentType, Paise, AssetClass?]>; liabilities: Array<[string, Liability["type"], Paise, number, number]>; income: Paise; expenses: Paise; ratio?: string }

function buildCase(spec: CaseSpec): ClientData {
  const id = spec.id;
  const hs = spec.holdings.map(([name, t, v, cls], i) => mkHolding(id, { id: `h_${id}_${i}`, name, instrumentType: t, currentValue: v, isIllustrative: true, isAggregate: true, classOverride: cls ?? null, valuationDate: "2026-10-01", dataStatus: "collected" }));
  const ls = spec.liabilities.map(([name, type, out, rate, months], i) =>
    mkLiability(id, { id: `l_${id}_${i}`, name, type, outstanding: out, originalPrincipal: out, rateBps: rate * 100, remainingMonths: months, emi: emiOf(out, rate, months), isIllustrative: true }));
  const cf = [
    mkCashflow(id, { id: `c_${id}_inc`, name: "Illustrative monthly income", kind: "income", category: "salary", amount: spec.income, isIllustrative: true }),
    mkCashflow(id, { id: `c_${id}_exp`, name: "Illustrative household & personal expenses", kind: "expense", category: "household", amount: spec.expenses, essential: true, isIllustrative: true }),
  ];
  return {
    client: { id, name: spec.name, kind: "case", description: spec.description, createdAt: "2026-10-01T00:00:00.000Z" },
    settings: { ...defaultSettings("case"), liabilitiesStatus: "complete", incomeStatus: "complete", profileNote: spec.note },
    holdings: hs, liabilities: ls, cashflows: cf, commitments: [], transactions: [], snapshots: [], policies: [], goals: [], targets: [], rules: defaultRules(), mappings: defaultMappings(), valuations: [], scoreHistory: [],
  };
}

export function buildCases(): ClientData[] {
  const a = buildCase({
    id: CASE_IDS.A, name: "Case A — Aggressive investor", description: "₹10 Cr assets, ₹5 Cr liabilities (professor's brief).",
    note: "Assets and liabilities are from the brief. Loan rates/tenures, income and expenses are ILLUSTRATIVE assumptions you can edit.",
    holdings: [["Equity portfolio", "equity_mf", crore(5), "indian_equity"], ["Debt portfolio", "fixed_deposit", crore(2)], ["Real estate", "property_residential", crore(2)], ["Commodities", "gold_financial", crore(1)]],
    liabilities: [["Business loan", "business_loan", crore(2), 10.5, 120], ["Home loan", "home_loan", crore(2), 8.5, 240], ["Vehicle / personal loan", "personal_loan", crore(1), 12, 96]],
    income: lakh(15), expenses: lakh(4),
  });
  // growth:defensive cases operate on the financial portfolio (direct property excluded); total ₹10 Cr is an illustrative base
  const growthCase = (key: "B" | "C", name: string, ratio: string, parts: Array<[string, InstrumentType, number, AssetClass?]>, liab: Paise, income: Paise, expenses: Paise) => buildCase({
    id: CASE_IDS[key], name, description: `${ratio} growth : defensive split of the financial portfolio.`,
    note: `Only the ${ratio} growth:defensive split is from the brief. The ₹10 Cr base, the sub-allocations, liabilities, income and expenses are ILLUSTRATIVE and editable. Growth = Indian & global equity, REITs/InvITs, alternatives; Defensive = debt and commodities; direct real estate is excluded from the split.`,
    holdings: parts.map(([n, t, pct, cls]) => [n, t, crore(10) * pct / 100, cls] as [string, InstrumentType, Paise, AssetClass?]),
    liabilities: liab > 0 ? [["Home loan", "home_loan", liab, 8.5, 180]] : [], income, expenses,
  });
  const b = growthCase("B", "Case B — Conservative investor", "50:50", [
    ["Indian equity", "equity_mf", 30, "indian_equity"], ["Global equity", "equity_mf", 10, "global_equity"], ["REITs / InvITs", "reit", 5], ["Alternative assets", "aif", 5],
    ["Fixed income", "fixed_deposit", 40], ["Gold / commodities", "gold_financial", 10]], lakh(50), lakh(10), lakh(3));
  const c = growthCase("C", "Case C — Moderate investor", "70:30", [
    ["Indian equity", "equity_mf", 45, "indian_equity"], ["Global equity", "equity_mf", 15, "global_equity"], ["REITs / InvITs", "reit", 5], ["Alternative assets", "aif", 5],
    ["Fixed income", "fixed_deposit", 22], ["Gold / commodities", "gold_financial", 8]], lakh(80), lakh(12), lakh(3.5));
  // give B/C the sample policy shape of their own mix so drift is measurable
  for (const d of [b, c]) {
    d.targets = ASSET_CLASSES.filter((k) => k !== "real_estate").map((k) => ({ assetClass: k, targetBps: Math.round((d.holdings.filter((h) => (h.classOverride ?? h.assetClass) === k).reduce((s, h) => s + h.currentValue, 0) / crore(10)) * 10000), bandBps: null })).filter((t) => t.targetBps > 0);
  }
  return [a, b, c];
}
export { rupees };
