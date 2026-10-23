import { addMonths, type ISODate } from "./dates";
import { pct, sum, type Paise } from "./money";
import type { DataStatus } from "./taxonomy";
import { buildForecast, summariseCashflow, type CashflowSummary, type Forecast } from "./cashflow";
import { computeAllocation, computePortfolio, type AllocationRow, type PortfolioResult } from "./portfolio";
import { computeNetWorth, type NetWorthResult } from "./networth";
import { computeHealthScore, type HealthScore } from "./score";
import { evaluateRules, type RuleResult } from "./rules";
import { buildRebalancePlan, type RebalancePlan } from "./rebalance";
import { projectGoal, type GoalProgress } from "./goals";
import type { ClientData } from "./types";
import type { Denominator } from "./taxonomy";

export interface CompletenessItem { key: string; label: string; status: DataStatus; detail: string; page: string }
export interface Evaluation {
  asOf: ISODate; computedAt: string;
  portfolio: PortfolioResult; netWorth: NetWorthResult; cash: CashflowSummary; forecast: Forecast;
  allocation: Record<Denominator, AllocationRow[]>; activeDenominator: Denominator;
  rules: RuleResult[]; health: HealthScore; rebalance: RebalancePlan; goals: GoalProgress[];
  emergencyCoverageMonths: number | null; upcomingOutflow90d: Paise;
  completeness: { items: CompletenessItem[]; percent: number };
  equityBounds: { min: number | null; max: number | null; denominator: Denominator };
  growthDefensive: { growth: Paise; defensive: Paise; excluded: Paise; growthPct: number | null; defensivePct: number | null; denominator: Paise };
}

export function buildCompleteness(data: ClientData, p: PortfolioResult, cash: CashflowSummary): CompletenessItem[] {
  const active = data.holdings.filter((h) => !h.archived);
  const inv = active.filter((h) => !["property_residential", "property_commercial", "cash", "bank_balance", "pension_annuity"].includes(h.instrumentType) && !h.parentId);
  const withInvested = inv.filter((h) => h.investedValue != null).length;
  const withAcq = inv.filter((h) => h.acquisitionDate).length;
  const kids = new Set(active.filter((h) => h.parentId).map((h) => h.parentId));
  const st = (ok: boolean, partial = false): DataStatus => (ok ? "collected" : partial ? "needs_review" : "pending");
  const aggs = (t: string) => active.filter((h) => h.instrumentType === t && !h.parentId);
  const mfAgg = active.filter((h) => (h.instrumentType === "mutual_fund_aggregate" || h.instrumentType === "equity_mf" || h.instrumentType === "debt_mf") && !h.parentId);
  const stockAgg = active.filter((h) => h.instrumentType === "direct_stock" && h.isAggregate && !kids.has(h.id));
  const fdbond = active.filter((h) => h.instrumentType === "fixed_deposit" || h.instrumentType === "bond");
  const pensionC = data.commitments.filter((c) => !c.archived);
  const items: CompletenessItem[] = [
    { key: "assets_aggregate", label: "Aggregate asset values", status: active.length ? "collected" : "pending", detail: `${active.length} holdings recorded`, page: "/assets" },
    { key: "mf_split", label: "Mutual-fund equity / debt split", status: mfAgg.length === 0 ? "not_applicable" : st(mfAgg.every((h) => kids.has(h.id) || (h.assetClass != null)), false), detail: p.unresolved.value > 0 ? `${p.unresolved.lines.map((l) => l.name).join(", ")} unclassified` : "Classified", page: "/assets" },
    { key: "stocks", label: "Stock-level positions & quantities", status: stockAgg.length === 0 ? "collected" : "pending", detail: stockAgg.length ? `${stockAgg.length} aggregate(s) without stock detail` : "Entered", page: "/assets" },
    { key: "pms", label: "PMS underlying exposures", status: aggs("pms").length === 0 ? "not_applicable" : st(aggs("pms").every((h) => kids.has(h.id))), detail: "Look-through holdings", page: "/assets" },
    { key: "aif", label: "AIF strategy & underlying exposures", status: aggs("aif").length === 0 ? "not_applicable" : st(aggs("aif").every((h) => kids.has(h.id))), detail: "Look-through exposure", page: "/assets" },
    { key: "invested", label: "Invested capital per holding", status: inv.length === 0 ? "not_applicable" : withInvested === inv.length ? "collected" : withInvested > 0 ? "needs_review" : "pending", detail: `${withInvested}/${inv.length} recorded`, page: "/assets" },
    { key: "acq", label: "Acquisition dates", status: inv.length === 0 ? "not_applicable" : withAcq === inv.length ? "collected" : withAcq > 0 ? "needs_review" : "pending", detail: `${withAcq}/${inv.length} recorded`, page: "/assets" },
    { key: "txns", label: "Contributions, withdrawals & distributions (for XIRR)", status: data.transactions.length ? "collected" : "pending", detail: `${data.transactions.length} transactions`, page: "/assets" },
    { key: "bank", label: "Bank balances & cash in hand", status: st(active.some((h) => h.instrumentType === "bank_balance" || h.instrumentType === "cash")), detail: "Needed for idle-cash and forecast", page: "/assets" },
    { key: "income", label: "Income (salary, business, rental, interest…)", status: data.settings.incomeStatus === "complete" ? "collected" : data.settings.incomeStatus === "partial" ? "needs_review" : "pending", detail: cash.hasIncome ? "Partial income recorded" : "None recorded", page: "/cashflow" },
    { key: "expenses", label: "Monthly expenses", status: cash.monthlyOutflows > 0 ? "collected" : "pending", detail: cash.monthlyOutflows > 0 ? "Recorded" : "None", page: "/cashflow" },
    { key: "loans", label: "Loans, EMIs & credit cards", status: data.settings.liabilitiesStatus === "complete" ? "collected" : data.settings.liabilitiesStatus === "partial" ? "needs_review" : "pending", detail: data.settings.liabilitiesStatus === "not_assessed" ? "Not yet assessed" : data.settings.liabilitiesStatus, page: "/assets" },
    { key: "insurance", label: "Insurance policies", status: data.policies.filter((x) => !x.archived).length ? "collected" : "pending", detail: "Sum assured, premium, renewal", page: "/assets" },
    { key: "maturity", label: "FD & bond maturity dates", status: fdbond.length === 0 ? "not_applicable" : fdbond.every((h) => h.maturityDate) ? "collected" : "pending", detail: `${fdbond.filter((h) => h.maturityDate).length}/${fdbond.length} dated`, page: "/assets" },
    { key: "pension", label: "Pension premium payment schedule", status: pensionC.length === 0 ? "not_applicable" : pensionC.every((c) => c.nextDueDate && c.installmentAmount) ? "collected" : "pending", detail: "Due dates & instalments", page: "/assets" },
    { key: "valuation_dates", label: "Valuation dates", status: p.valuation.missingDate.length === 0 ? "collected" : p.valuation.missingDate.length === p.lines.length ? "pending" : "needs_review", detail: `${p.lines.length - p.valuation.missingDate.length}/${p.lines.length} dated`, page: "/assets" },
    { key: "history", label: "Previous month / year net-worth snapshots", status: data.snapshots.length ? "collected" : "pending", detail: `${data.snapshots.length} snapshots`, page: "/" },
  ];
  return items;
}

export function evaluateClient(data: ClientData, asOf: ISODate, opts: { now?: string } = {}): Evaluation {
  const portfolio = computePortfolio(data, asOf);
  const netWorth = computeNetWorth(data, portfolio, asOf);
  const cash = summariseCashflow(data);
  const forecast = buildForecast(data, asOf, 12);
  const upcoming90 = sum(forecast.months.slice(0, 3).map((m) => m.outflow));
  const emergency = cash.essentialMonthly > 0 ? portfolio.emergencyReserves / cash.essentialMonthly : null;
  const health = computeHealthScore(data, portfolio, netWorth, cash, emergency);

  const driftRule = data.rules.find((r) => r.key === "portfolio_drift_max");
  const band = driftRule?.value ?? 5, inclusive = !!driftRule?.params.inclusive;
  const allocFor = (d: Denominator, b: number, inc: boolean) => computeAllocation(portfolio, data, d, b, inc);
  const allocation = { gross: allocFor("gross", band, inclusive), investable: allocFor("investable", band, inclusive), investments_ex_property: allocFor("investments_ex_property", band, inclusive) };
  const activeDen = data.settings.denominator;

  const rules = evaluateRules({ data, asOf, portfolio, netWorth, cash, allocationByDenominator: allocFor, healthScore: health.overall, emergencyCoverageMonths: emergency, upcomingOutflow90d: upcoming90 });

  const cashHoldings = data.holdings.filter((h) => !h.archived && (h.instrumentType === "cash" || h.instrumentType === "bank_balance"));
  const cashAvailable = sum(cashHoldings.map((h) => h.currentValue));
  const reserve = Math.round(cash.essentialMonthly * data.settings.emergencyMonthsTarget) + upcoming90;
  const eqRule = data.rules.find((r) => r.key === "equity_allocation_max");
  const rebalance = buildRebalancePlan(allocation[activeDen], portfolio, data, { denominator: activeDen, reserveRequired: reserve, cashAvailable, equityCapPct: eqRule?.enabled ? eqRule.value : null, bandDefault: band });

  const D = portfolio.denominators[activeDen].value;
  const eqMin = portfolio.buckets.indian_equity.min + portfolio.buckets.global_equity.min;
  let eqMax = eqMin;
  for (const l of portfolio.unresolved.lines) if (l.candidates.some((c) => c === "indian_equity" || c === "global_equity")) eqMax += l.value;

  const grp = (g: "growth" | "defensive") => sum((g === "growth" ? data.settings.groupGrowth : data.settings.groupDefensive).map((c) => portfolio.buckets[c].value));
  const growth = grp("growth"), defensive = grp("defensive");
  const gdDen = growth + defensive;

  const completeItems = buildCompleteness(data, portfolio, cash);
  const scored = completeItems.filter((i) => i.status !== "not_applicable");
  const percent = scored.length ? (sum(scored.map((i) => (i.status === "collected" ? 1 : i.status === "needs_review" ? 0.5 : 0))) / scored.length) * 100 : 100;

  return {
    asOf, computedAt: opts.now ?? new Date().toISOString(), portfolio, netWorth, cash, forecast, allocation, activeDenominator: activeDen, rules, health, rebalance,
    goals: data.goals.filter((g) => !g.archived).map((g) => projectGoal(g, asOf)), emergencyCoverageMonths: emergency, upcomingOutflow90d: upcoming90,
    completeness: { items: completeItems, percent }, equityBounds: { min: pct(eqMin, D), max: pct(eqMax, D), denominator: activeDen },
    growthDefensive: { growth, defensive, excluded: portfolio.grossAssets - gdDen, growthPct: pct(growth, gdDen), defensivePct: pct(defensive, gdDen), denominator: gdDen },
  };
}
export { addMonths };
