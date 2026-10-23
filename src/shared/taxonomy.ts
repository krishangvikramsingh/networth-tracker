import type { Paise } from "./money";

export const ASSET_CLASSES = [
  "indian_equity", "global_equity", "debt", "commodities", "real_estate", "reits_invits", "alternatives",
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  indian_equity: "Indian equity",
  global_equity: "Global equity",
  debt: "Debt & fixed income",
  commodities: "Commodities",
  real_estate: "Direct real estate",
  reits_invits: "REITs & InvITs",
  alternatives: "Alternative assets",
};

export type ClassGroup = "growth" | "defensive" | "excluded";
/** Default growth/defensive grouping used by the investor case studies (editable per client in settings). */
export const DEFAULT_GROUPING: Record<AssetClass, ClassGroup> = {
  indian_equity: "growth", global_equity: "growth", reits_invits: "growth", alternatives: "growth",
  debt: "defensive", commodities: "defensive", real_estate: "excluded",
};

export const INSTRUMENT_TYPES = [
  "direct_stock", "equity_mf", "debt_mf", "hybrid_mf", "sif", "etf", "pms", "aif", "unlisted_equity",
  "fixed_deposit", "bond", "gold_physical", "gold_financial", "commodity_fund",
  "property_residential", "property_commercial", "reit", "invit",
  "pension_annuity", "cash", "bank_balance", "mutual_fund_aggregate", "other",
] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const INSTRUMENT_LABEL: Record<InstrumentType, string> = {
  direct_stock: "Direct stock", equity_mf: "Equity mutual fund", debt_mf: "Debt mutual fund", hybrid_mf: "Hybrid mutual fund",
  sif: "Specialised investment fund (SIF)", etf: "ETF", pms: "PMS portfolio", aif: "AIF", unlisted_equity: "Unlisted equity",
  fixed_deposit: "Fixed deposit", bond: "Bond", gold_physical: "Gold (physical)", gold_financial: "Gold (financial)",
  commodity_fund: "Commodity fund", property_residential: "Residential property", property_commercial: "Commercial property",
  reit: "REIT", invit: "InvIT", pension_annuity: "Pension / annuity product", cash: "Cash in hand", bank_balance: "Bank balance",
  mutual_fund_aggregate: "Mutual funds (aggregate)", other: "Other",
};

/** Liquidity tiers: 1 = immediate, 2 = within a week, 3 = within a month / with penalty, 4 = illiquid. */
export type LiquidityTier = 1 | 2 | 3 | 4;
export const LIQUIDITY_LABEL: Record<LiquidityTier, string> = {
  1: "Immediate (cash / bank / liquid)", 2: "Within a week (listed / open-ended)", 3: "Within a month or with penalty", 4: "Illiquid / locked in",
};

export interface InstrumentDefault {
  assetClass: AssetClass | null; // null = cannot be resolved from type alone (needs review / look-through)
  status: "confirmed" | "provisional" | "needs_review";
  liquidity: LiquidityTier;
  emergencyEligible: boolean;
  /** Classes an unresolved holding could still fall into (used for min/max bounds). */
  candidates?: AssetClass[];
  note?: string;
}

export const INSTRUMENT_DEFAULTS: Record<InstrumentType, InstrumentDefault> = {
  direct_stock: { assetClass: "indian_equity", status: "provisional", liquidity: 2, emergencyEligible: false, note: "Geography assumed Indian until security-level detail is entered." },
  equity_mf: { assetClass: "indian_equity", status: "provisional", liquidity: 2, emergencyEligible: false, note: "Indian vs global equity depends on the scheme mandate." },
  debt_mf: { assetClass: "debt", status: "confirmed", liquidity: 2, emergencyEligible: true },
  hybrid_mf: { assetClass: null, status: "needs_review", liquidity: 2, emergencyEligible: false, candidates: ["indian_equity", "debt"], note: "Hybrid funds mix equity and debt; enter the split." },
  sif: { assetClass: "indian_equity", status: "provisional", liquidity: 3, emergencyEligible: false },
  etf: { assetClass: null, status: "needs_review", liquidity: 2, emergencyEligible: false, candidates: ["indian_equity", "global_equity", "debt", "commodities"] },
  pms: { assetClass: "indian_equity", status: "provisional", liquidity: 3, emergencyEligible: false, note: "Equity-oriented PMS treated as equity; look-through holdings not yet supplied." },
  aif: { assetClass: "alternatives", status: "provisional", liquidity: 4, emergencyEligible: false, note: "AIF is a vehicle, not an asset class. Held as Alternatives until underlying exposure is entered." },
  unlisted_equity: { assetClass: "alternatives", status: "provisional", liquidity: 4, emergencyEligible: false },
  fixed_deposit: { assetClass: "debt", status: "confirmed", liquidity: 3, emergencyEligible: true },
  bond: { assetClass: "debt", status: "confirmed", liquidity: 3, emergencyEligible: false },
  gold_physical: { assetClass: "commodities", status: "confirmed", liquidity: 3, emergencyEligible: false },
  gold_financial: { assetClass: "commodities", status: "confirmed", liquidity: 2, emergencyEligible: false },
  commodity_fund: { assetClass: "commodities", status: "confirmed", liquidity: 2, emergencyEligible: false },
  property_residential: { assetClass: "real_estate", status: "confirmed", liquidity: 4, emergencyEligible: false },
  property_commercial: { assetClass: "real_estate", status: "confirmed", liquidity: 4, emergencyEligible: false },
  reit: { assetClass: "reits_invits", status: "confirmed", liquidity: 2, emergencyEligible: false },
  invit: { assetClass: "reits_invits", status: "confirmed", liquidity: 2, emergencyEligible: false },
  pension_annuity: { assetClass: "debt", status: "provisional", liquidity: 4, emergencyEligible: false },
  cash: { assetClass: "debt", status: "confirmed", liquidity: 1, emergencyEligible: true },
  bank_balance: { assetClass: "debt", status: "confirmed", liquidity: 1, emergencyEligible: true },
  mutual_fund_aggregate: { assetClass: null, status: "needs_review", liquidity: 2, emergencyEligible: false, candidates: ["indian_equity", "global_equity", "debt"], note: "Equity/debt split of the mutual-fund holdings has not been supplied." },
  other: { assetClass: null, status: "needs_review", liquidity: 3, emergencyEligible: false, candidates: [] },
};

export const LIABILITY_TYPES = ["home_loan", "business_loan", "vehicle_loan", "personal_loan", "education_loan", "credit_card", "other"] as const;
export type LiabilityType = (typeof LIABILITY_TYPES)[number];
export const LIABILITY_LABEL: Record<LiabilityType, string> = {
  home_loan: "Home loan", business_loan: "Business loan", vehicle_loan: "Vehicle loan", personal_loan: "Personal loan",
  education_loan: "Education loan", credit_card: "Credit card", other: "Other liability",
};

export const INCOME_CATEGORIES = ["salary", "business", "rental", "interest", "dividend", "pension", "other_income"] as const;
export const EXPENSE_CATEGORIES = [
  "household", "medical", "personal", "business_expense", "loan_emi", "insurance_premium", "pension_premium", "investment_contribution", "other_scheduled",
] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type CashflowCategory = IncomeCategory | ExpenseCategory;

export const CASHFLOW_LABEL: Record<CashflowCategory, string> = {
  salary: "Salary", business: "Business / professional", rental: "Rental income", interest: "Interest income", dividend: "Dividends & distributions",
  pension: "Pension & annuity", other_income: "Other income",
  household: "Household expenses", medical: "Medical expenses", personal: "Other personal", business_expense: "Business expenses",
  loan_emi: "Loan EMIs", insurance_premium: "Insurance premiums", pension_premium: "Pension-plan premiums",
  investment_contribution: "Investment contributions", other_scheduled: "Other scheduled payments",
};
/** Workbook mapping groups: Salary Income / Business Income / Variable Income; Fixed / Variable / Business expenses. */
export const CASHFLOW_GROUP: Record<CashflowCategory, string> = {
  salary: "Salary Income", business: "Business Income", rental: "Variable Income", interest: "Variable Income", dividend: "Variable Income",
  pension: "Variable Income", other_income: "Variable Income",
  household: "Fixed Expenses", medical: "Variable Expenses", personal: "Variable Expenses", business_expense: "Business Expenses",
  loan_emi: "Debt Service", insurance_premium: "Fixed Expenses", pension_premium: "Commitments", investment_contribution: "Investing", other_scheduled: "Variable Expenses",
};
export const isIncomeCategory = (c: string): c is IncomeCategory => (INCOME_CATEGORIES as readonly string[]).includes(c);

export type DataStatus = "collected" | "pending" | "needs_review" | "not_applicable";
export const DATA_STATUS_LABEL: Record<DataStatus, string> = {
  collected: "Collected", pending: "Pending", needs_review: "Needs Review", not_applicable: "Not Applicable",
};

export type Denominator = "gross" | "investable" | "investments_ex_property";
export type Money = Paise;
