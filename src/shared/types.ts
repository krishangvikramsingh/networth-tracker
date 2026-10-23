import type { Paise } from "./money";
import type { ISODate } from "./dates";
import type {
  AssetClass, InstrumentType, LiquidityTier, LiabilityType, CashflowCategory, DataStatus,
} from "./taxonomy";

export type ClassificationStatus = "confirmed" | "provisional" | "needs_review";
export type ClassificationMethod = "user_override" | "exact_name" | "instrument_type" | "keyword" | "look_through" | "unresolved";

export interface Holding {
  id: string;
  clientId: string;
  name: string;
  originalDescription: string;
  instrumentType: InstrumentType;
  assetClass: AssetClass | null; // result of automatic classification (null = unresolved)
  classOverride: AssetClass | null; // explicit user choice; wins over everything
  classificationMethod: ClassificationMethod;
  classificationStatus: ClassificationStatus;
  classificationReason: string;
  geography: "india" | "global" | null;
  issuer: string | null;
  account: string | null;
  symbol: string | null;
  sector: string | null;
  quantity: number | null;
  currentValue: Paise;
  investedValue: Paise | null;
  acquisitionDate: ISODate | null;
  valuationDate: ISODate | null;
  valuationSource: "manual" | "market" | "import" | "demo";
  maturityDate: ISODate | null;
  expectedMaturityValue: Paise | null;
  liquidityTier: LiquidityTier;
  emergencyEligible: boolean;
  parentId: string | null;
  isAggregate: boolean;
  dataStatus: DataStatus;
  notes: string | null;
  archived: boolean;
  isIllustrative: boolean;
}

export interface Liability {
  id: string; clientId: string; name: string; type: LiabilityType; lender: string | null;
  outstanding: Paise; originalPrincipal: Paise | null; emi: Paise | null; rateBps: number | null;
  remainingMonths: number | null; nextDueDate: ISODate | null; minimumDue: Paise | null;
  dataStatus: DataStatus; notes: string | null; archived: boolean; isIllustrative: boolean;
}

export type Frequency = "monthly" | "quarterly" | "half_yearly" | "annual" | "once";
export interface CashflowItem {
  id: string; clientId: string; kind: "income" | "expense"; category: CashflowCategory; name: string;
  amount: Paise; frequency: Frequency; anchorDate: ISODate | null; endDate: ISODate | null;
  verified: boolean; essential: boolean; commitmentId: string | null; liabilityId: string | null;
  dataStatus: DataStatus; notes: string | null; archived: boolean; isIllustrative: boolean;
}

export interface Commitment {
  id: string; clientId: string; name: string; kind: "pension_premium" | "insurance_premium" | "other";
  totalAmount: Paise; paidAmount: Paise; installmentAmount: Paise | null; frequency: Frequency | null;
  nextDueDate: ISODate | null; endDate: ISODate | null; annualReceivable: Paise | null;
  dataStatus: DataStatus; notes: string | null; archived: boolean; isIllustrative: boolean;
}

export interface Transaction {
  id: string; clientId: string; holdingId: string | null; date: ISODate;
  type: "purchase" | "contribution" | "sale" | "withdrawal" | "dividend" | "distribution" | "fee" | "transfer";
  amount: Paise; quantity: number | null; notes: string | null;
}

export interface Snapshot {
  id: string; clientId: string; date: ISODate; grossAssets: Paise; liabilities: Paise | null; netWorth: Paise | null;
  liabilitiesComplete: boolean; source: "manual" | "auto" | "import"; note: string | null;
}

export interface InsurancePolicy {
  id: string; clientId: string; type: "term_life" | "health" | "home" | "vehicle" | "ulip" | "endowment" | "other";
  insurer: string | null; policyNo: string | null; sumAssured: Paise | null; annualPremium: Paise | null;
  premiumFrequency: Frequency | null; nextPremiumDate: ISODate | null; renewalDate: ISODate | null;
  maturityDate: ISODate | null; expectedMaturityValue: Paise | null; dataStatus: DataStatus; archived: boolean; isIllustrative: boolean;
}

export interface Goal {
  id: string; clientId: string; name: string; type: "retirement" | "property" | "education" | "business" | "emergency" | "wealth" | "other";
  targetAmount: Paise; targetDate: ISODate; earmarkedAmount: Paise; monthlyContribution: Paise;
  expectedReturnBps: number | null; notes: string | null; archived: boolean; isIllustrative: boolean;
}

export interface AllocationTarget { assetClass: AssetClass; targetBps: number; bandBps: number | null }

export type Severity = "critical" | "high" | "warning" | "info";
import type { Denominator } from "./taxonomy";
export type { Denominator };

export interface RuleConfig {
  key: RuleKey; enabled: boolean; value: number; unit: string; severity: Severity;
  params: Record<string, unknown>; lastEvaluatedAt: string | null;
}
export type RuleKey =
  | "equity_allocation_max" | "single_stock_max" | "debt_allocation_min" | "net_worth_decline" | "emi_to_income_max"
  | "portfolio_drift_max" | "idle_cash" | "maturity_window"
  | "credit_card_balance" | "debt_to_net_worth" | "negative_cash_flow" | "emergency_fund_min" | "pension_premium_window"
  | "missing_valuation" | "unclassified_holdings" | "stale_data" | "goal_shortfall" | "health_score_drop";

export interface HealthWeights {
  net_worth: number; cash_flow: number; emergency: number; debt: number; diversification: number; insurance: number;
}

export interface ClientSettings {
  denominator: Denominator;
  concentrationDenominator: Denominator;
  liabilitiesStatus: "not_assessed" | "partial" | "complete";
  incomeStatus: "pending" | "partial" | "complete";
  emergencyMonthsTarget: number;
  healthWeights: HealthWeights;
  scoreBands: Array<{ min: number; label: string }>;
  savingsExcludedCategories: CashflowCategory[]; // categories NOT treated as spending when computing the savings rate
  groupGrowth: AssetClass[]; // growth group for the growth:defensive split
  groupDefensive: AssetClass[];
  stalenessDays: number;
  insuranceLifeCoverMultiple: number; // target life cover as a multiple of annual income
  nwStrengthBands: Array<{ multiple: number; score: number }>; // net worth as multiple of annual expenses
  investmentPolicyValidated: boolean;
  profileKind: "live" | "case";
  profileNote: string | null;
}

export interface Valuation { id: string; holdingId: string; date: ISODate; value: Paise; source: string; note: string | null }

export interface Client { id: string; name: string; kind: "live" | "case"; description: string | null; createdAt: string }

export interface CategoryMapping {
  id: string; domain: "asset" | "cashflow"; matchType: "exact" | "instrument" | "keyword"; pattern: string;
  category: string; priority: number; source: string;
}

/** Everything the engine needs about one client. */
export interface ClientData {
  client: Client;
  settings: ClientSettings;
  holdings: Holding[];
  liabilities: Liability[];
  cashflows: CashflowItem[];
  commitments: Commitment[];
  transactions: Transaction[];
  snapshots: Snapshot[];
  policies: InsurancePolicy[];
  goals: Goal[];
  targets: AllocationTarget[];
  rules: RuleConfig[];
  mappings: CategoryMapping[];
  valuations: Valuation[];
  scoreHistory: Array<{ date: ISODate; score: number; coverage: number }>;
}
