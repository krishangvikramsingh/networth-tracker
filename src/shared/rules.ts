import { addMonths, daysBetween, type ISODate } from "./dates";
import { formatCompact, formatPct, pct, sum, type Paise, crore, lakh } from "./money";
import { ASSET_CLASS_LABEL, type AssetClass, type Denominator } from "./taxonomy";
import type { ClientData, RuleConfig, RuleKey, Severity } from "./types";
import type { PortfolioResult, AllocationRow } from "./portfolio";
import type { NetWorthResult } from "./networth";
import type { CashflowSummary } from "./cashflow";
import { projectGoal } from "./goals";

export type RuleState = "ok" | "triggered" | "possible" | "not_evaluable" | "disabled";
export type FindingKind = "breach" | "possible" | "data_gap";

export interface Finding {
  fingerprint: string; kind: FindingKind; subject: string;
  currentLabel: string; thresholdLabel: string; why: string; action: string; effect?: string;
  records: Array<{ type: "holding" | "liability" | "commitment" | "policy" | "goal" | "cashflow" | "metric"; id: string; name: string }>;
  provisional: boolean;
}
export interface RuleResult {
  key: RuleKey; name: string; state: RuleState; severity: Severity; findings: Finding[]; summary: string;
  currentLabel: string | null; thresholdLabel: string;
}

export interface RuleDef {
  key: RuleKey; name: string; group: "core" | "additional"; description: string; calc: string; trigger: string; response: string;
  defaults: { enabled: boolean; value: number; unit: string; severity: Severity; params: Record<string, unknown> };
  valueMin?: number; valueMax?: number;
}

export const RULE_DEFS: RuleDef[] = [
  { key: "equity_allocation_max", name: "Equity allocation exceeds limit", group: "core",
    description: "Total equity exposure (Indian + global) as a share of the selected portfolio denominator is above the maximum.",
    calc: "equity value ÷ selected denominator × 100. Unclassified holdings widen the result into a [min, max] range.",
    trigger: "Equity % > threshold (strict by default). 'Possible' if only the upper bound exceeds it.", response: "Review equity weight against risk profile; consider directing new money to debt/other classes rather than selling.",
    defaults: { enabled: true, value: 60, unit: "%", severity: "high", params: { denominator: "investable", inclusive: false } }, valueMin: 0, valueMax: 100 },
  { key: "single_stock_max", name: "Single-stock concentration", group: "core",
    description: "Any directly held stock larger than the limit as a share of the concentration denominator.",
    calc: "stock market value ÷ concentration denominator × 100. Aggregate rows are never treated as one stock.",
    trigger: "Any single stock % > threshold. Look-through exposure via funds/PMS is reported separately.", response: "Review position size; consider trimming staggered over time, mindful of tax and liquidity.",
    defaults: { enabled: true, value: 10, unit: "%", severity: "high", params: { denominator: "investable", inclusive: false } }, valueMin: 0, valueMax: 100 },
  { key: "debt_allocation_min", name: "Debt allocation below minimum", group: "core",
    description: "Debt & fixed-income allocation is below the required floor.",
    calc: "debt value ÷ selected denominator × 100 (cash and bank balances count as debt / cash equivalents).",
    trigger: "Debt % < threshold (strict by default; inclusive option available).", response: "Direct fresh investment to debt/fixed income until the floor is restored.",
    defaults: { enabled: true, value: 20, unit: "%", severity: "warning", params: { denominator: "investable", inclusive: false } }, valueMin: 0, valueMax: 100 },
  { key: "net_worth_decline", name: "Net worth fell sharply", group: "core",
    description: "Net worth declined by more than the threshold versus the comparable previous snapshot.",
    calc: "(current NW − previous NW) ÷ |previous NW| × 100, only between comparable snapshots (same liability basis).",
    trigger: "Change % < −threshold. Not evaluated without a comparable snapshot.", response: "Check whether the fall is market-driven, due to withdrawals, or new debt, before acting.",
    defaults: { enabled: true, value: 5, unit: "%", severity: "critical", params: { window: "month" } }, valueMin: 0, valueMax: 100 },
  { key: "emi_to_income_max", name: "EMI-to-income ratio too high", group: "core",
    description: "Total monthly loan EMIs relative to verified monthly gross income.",
    calc: "Σ monthly EMIs ÷ verified monthly gross income × 100. Credit-card balances are excluded from EMIs.",
    trigger: "EMI ratio > threshold. Missing income/EMI data produces a data warning, never a number.", response: "Consider prepayment, refinancing or tenure review; avoid new credit.",
    defaults: { enabled: true, value: 40, unit: "%", severity: "high", params: {} }, valueMin: 0, valueMax: 100 },
  { key: "portfolio_drift_max", name: "Allocation drift beyond tolerance", group: "core",
    description: "An asset class has drifted from its target by more than the tolerance (percentage points).",
    calc: "drift (pp) = actual % − target %. Compared on the selected denominator.",
    trigger: "|drift| > tolerance (strict). 5 vs 50 = 5pp-off, not 10% relative.", response: "Review the rebalancing scenario; prefer routing new contributions before selling.",
    defaults: { enabled: true, value: 5, unit: "pp", severity: "warning", params: { denominator: "investable", inclusive: false } }, valueMin: 0, valueMax: 100 },
  { key: "idle_cash", name: "Large cash balance sitting idle", group: "core",
    description: "Cash and bank balances above a threshold after setting aside the emergency fund and near-term obligations, for longer than the idle period.",
    calc: "idle = cash − (emergency target months × essential expenses) − scheduled outflows in next 90 days. Compared with max(threshold % of investable assets, absolute floor).",
    trigger: "idle > threshold for at least N days (balance history from dated valuations).", response: "Consider deploying surplus per allocation policy (sweep to liquid/short-term debt, FD, or planned goals).",
    defaults: { enabled: true, value: 10, unit: "%", severity: "warning", params: { absoluteFloor: lakh(5), minIdleDays: 30 } }, valueMin: 0, valueMax: 100 },
  { key: "maturity_window", name: "Maturity or renewal approaching", group: "core",
    description: "FDs, bonds and insurance policies maturing or renewing inside the alert window.",
    calc: "days until maturity / renewal / premium due date ≤ window.", trigger: "0 ≤ days ≤ window (and overdue items).", response: "Plan reinvestment or renewal; confirm expected proceeds and bank mandate.",
    defaults: { enabled: true, value: 60, unit: "days", severity: "warning", params: {} }, valueMin: 1, valueMax: 365 },
  { key: "credit_card_balance", name: "Credit-card balance high", group: "additional", description: "Outstanding credit-card balance above the limit.",
    calc: "card outstanding (₹).", trigger: "outstanding > threshold.", response: "Clear in full before the due date to avoid revolving interest.",
    defaults: { enabled: true, value: lakh(1), unit: "₹", severity: "warning", params: {} } },
  { key: "debt_to_net_worth", name: "Debt-to-net-worth too high", group: "additional", description: "Total confirmed debt as a share of net worth.",
    calc: "liabilities ÷ net worth × 100 (net worth must be positive).", trigger: "ratio > threshold, or net worth ≤ 0 with debt.", response: "Reduce leverage or build net worth before adding debt.",
    defaults: { enabled: true, value: 50, unit: "%", severity: "high", params: {} }, valueMin: 0, valueMax: 1000 },
  { key: "negative_cash_flow", name: "Negative monthly cash flow", group: "additional", description: "Monthly outflows exceed monthly inflows.",
    calc: "Σ monthly-equivalent income − Σ monthly-equivalent outflows.", trigger: "surplus < 0. Provisional until income is marked complete.", response: "Review discretionary spending or income sources; ensure reserves cover the gap.",
    defaults: { enabled: true, value: 0, unit: "₹", severity: "high", params: {} } },
  { key: "emergency_fund_min", name: "Emergency fund below target", group: "additional", description: "Liquid emergency reserves cover fewer months of essential expenses than required.",
    calc: "eligible emergency reserves ÷ monthly essential expenses.", trigger: "coverage < target months.", response: "Top up liquid reserves (bank, liquid funds, short FDs).",
    defaults: { enabled: true, value: 6, unit: "months", severity: "high", params: {} }, valueMin: 0, valueMax: 120 },
  { key: "pension_premium_window", name: "Pension / premium commitment due", group: "additional", description: "A contractual premium is due within the window, or has no payment schedule recorded.",
    calc: "days to next due date; remaining = total − paid.", trigger: "due within window; missing schedule raises a data notice.", response: "Ensure liquid funds are available on the due date.",
    defaults: { enabled: true, value: 30, unit: "days", severity: "warning", params: {} }, valueMin: 1, valueMax: 365 },
  { key: "missing_valuation", name: "Missing valuation dates", group: "additional", description: "Holdings without a recorded valuation date.",
    calc: "count of holdings with no valuation date.", trigger: "≥ 1 holding.", response: "Enter the valuation date for each holding.",
    defaults: { enabled: true, value: 0, unit: "count", severity: "info", params: {} } },
  { key: "unclassified_holdings", name: "Unclassified or provisional holdings", group: "additional", description: "Holdings still in the review queue.",
    calc: "value of holdings with status Needs Review or Provisional.", trigger: "any Needs-Review holding (provisional shown as info).", response: "Supply scheme/security detail so look-through classification can resolve them.",
    defaults: { enabled: true, value: 0, unit: "count", severity: "warning", params: {} } },
  { key: "stale_data", name: "Stale portfolio data", group: "additional", description: "Valuations older than the staleness limit.",
    calc: "days since valuation date.", trigger: "age > limit days.", response: "Refresh valuations.",
    defaults: { enabled: true, value: 45, unit: "days", severity: "info", params: {} }, valueMin: 1, valueMax: 730 },
  { key: "goal_shortfall", name: "Goal funding shortfall", group: "additional", description: "Planned contributions are projected to fall short of a goal.",
    calc: "projected value (earmark + contributions at user-assumed return) vs target.", trigger: "projected < target at target date.", response: "Increase contributions, extend the date or revise the target.",
    defaults: { enabled: true, value: 0, unit: "₹", severity: "warning", params: {} } },
  { key: "health_score_drop", name: "Financial-health score deterioration", group: "additional", description: "Provisional health score fell versus the previous assessment.",
    calc: "previous score − current score.", trigger: "drop > threshold points.", response: "Open the score breakdown to see which component declined.",
    defaults: { enabled: true, value: 10, unit: "points", severity: "warning", params: {} }, valueMin: 1, valueMax: 100 },
];

export const RULE_DEF_BY_KEY = Object.fromEntries(RULE_DEFS.map((r) => [r.key, r])) as Record<RuleKey, RuleDef>;

export function defaultRules(): RuleConfig[] {
  return RULE_DEFS.map((d) => ({ key: d.key, enabled: d.defaults.enabled, value: d.defaults.value, unit: d.defaults.unit, severity: d.defaults.severity, params: { ...d.defaults.params }, lastEvaluatedAt: null }));
}

export interface RuleContext {
  data: ClientData; asOf: ISODate; portfolio: PortfolioResult; netWorth: NetWorthResult; cash: CashflowSummary;
  allocationByDenominator: (d: Denominator, band: number, inclusive: boolean) => AllocationRow[];
  healthScore: number | null; emergencyCoverageMonths: number | null; upcomingOutflow90d: Paise;
}

const cmp = (v: number, thr: number, inclusive: boolean, dir: "gt" | "lt") =>
  dir === "gt" ? (inclusive ? v >= thr : v > thr) : inclusive ? v <= thr : v < thr;

function groupBounds(p: PortfolioResult, classes: AssetClass[]) {
  let value = 0, min = 0;
  for (const c of classes) { value += p.buckets[c].value; min += p.buckets[c].min; }
  let max = min;
  for (const l of p.unresolved.lines) if (l.candidates.some((c) => classes.includes(c))) max += l.value;
  return { value, min, max };
}
const denomOf = (cfg: RuleConfig, key = "denominator"): Denominator => (cfg.params[key] as Denominator) ?? "investable";
const DEN_SHORT: Record<Denominator, string> = { gross: "gross assets", investable: "investable assets", investments_ex_property: "investments excl. property & cash" };

type Evaluator = (cfg: RuleConfig, c: RuleContext, def: RuleDef) => Omit<RuleResult, "key" | "name" | "severity" | "thresholdLabel">;

const finish = (state: RuleState, summary: string, currentLabel: string | null, findings: Finding[] = []) => ({ state, summary, currentLabel, findings });
const gap = (def: RuleDef, subject: string, why: string, action: string, records: Finding["records"] = []): Finding =>
  ({ fingerprint: `${def.key}:gap:${subject}`, kind: "data_gap", subject, currentLabel: "Awaiting data", thresholdLabel: "—", why, action, records, provisional: true });

const EVAL: Record<RuleKey, Evaluator> = {
  equity_allocation_max(cfg, c, def) {
    const den = denomOf(cfg), D = c.portfolio.denominators[den].value;
    if (D <= 0) return finish("not_evaluable", "No assets recorded.", null);
    const b = groupBounds(c.portfolio, ["indian_equity", "global_equity"]);
    const [v, mn, mx] = [pct(b.value, D)!, pct(b.min, D)!, pct(b.max, D)!];
    const inc = !!cfg.params.inclusive, thr = cfg.value;
    const unresolved = c.portfolio.unresolved.value;
    const rec = c.portfolio.lines.filter((l) => l.assetClass === "indian_equity" || l.assetClass === "global_equity").map((l) => ({ type: "holding" as const, id: l.sourceId, name: l.name }));
    const base = { subject: "Equity", thresholdLabel: `> ${thr}% of ${DEN_SHORT[den]}`, records: rec };
    if (cmp(mn, thr, inc, "gt")) {
      return finish("triggered", `Equity is ${formatPct(mn)} of ${DEN_SHORT[den]} (limit ${thr}%).`, formatPct(mn), [{
        fingerprint: `${def.key}:equity`, kind: "breach", ...base, currentLabel: formatPct(mn) + (mx > mn ? ` – ${formatPct(mx)}` : ""), provisional: c.portfolio.buckets.indian_equity.provisionalValue > 0 || unresolved > 0,
        why: `Equity holdings of ${formatCompact(b.min)} are ${formatPct(mn)} of ${DEN_SHORT[den]} (${formatCompact(D)}), above the ${thr}% limit${unresolved > 0 ? ` even before ${formatCompact(unresolved)} of unclassified holdings are resolved` : ""}.`,
        action: `Review the equity weight. Bringing it to ${thr}% would need about ${formatCompact(Math.max(0, b.min - Math.round((thr / 100) * D)))} less equity (or more debt/other assets), subject to liquidity, tax and exit costs.`,
        effect: "Lower equity concentration and drawdown risk." }]);
    }
    if (cmp(mx, thr, inc, "gt")) {
      return finish("possible", `Equity is between ${formatPct(mn)} and ${formatPct(mx)} depending on ${formatCompact(unresolved)} of unclassified holdings.`, `${formatPct(mn)} – ${formatPct(mx)}`, [{
        fingerprint: `${def.key}:equity`, kind: "possible", ...base, currentLabel: `${formatPct(mn)} – ${formatPct(mx)}`, provisional: true,
        why: `Classified equity is ${formatPct(mn)}, but ${formatCompact(unresolved)} of holdings (e.g. the mutual-fund split) are unclassified. If they are all equity the total would be ${formatPct(mx)}, above the ${thr}% limit.`,
        action: "Enter the mutual-fund scheme split so equity exposure can be confirmed." }]);
    }
    return finish("ok", `Equity ${formatPct(mn)}${mx > mn ? ` – ${formatPct(mx)}` : ""} is within the ${thr}% limit.`, formatPct(v));
  },

  single_stock_max(cfg, c, def) {
    const den = denomOf(cfg), D = c.portfolio.denominators[den].value;
    const aggregates = c.portfolio.lines.filter((l) => l.instrumentType === "direct_stock" && l.isAggregate);
    const stocks = c.portfolio.directStocks;
    if (D <= 0) return finish("not_evaluable", "No assets recorded.", null);
    const inc = !!cfg.params.inclusive, thr = cfg.value;
    const findings: Finding[] = [];
    for (const s of stocks) {
      const p = pct(s.value, D)!;
      if (cmp(p, thr, inc, "gt")) findings.push({
        fingerprint: `${def.key}:${s.key}`, kind: "breach", subject: s.name, currentLabel: formatPct(p), thresholdLabel: `> ${thr}% of ${DEN_SHORT[den]}`, provisional: false,
        why: `${s.name} is worth ${formatCompact(s.value)} (${formatPct(p)} of ${DEN_SHORT[den]})${s.lookThrough > 0 ? `, of which ${formatCompact(s.lookThrough)} is indirect look-through exposure` : ""}.`,
        action: `Consider reducing ${s.name} below ${thr}% (about ${formatCompact(Math.max(0, s.value - Math.round((thr / 100) * D)))} to trim), staging sales for tax efficiency.`,
        records: [{ type: "holding", id: s.key, name: s.name }],
      });
    }
    if (findings.length) return finish("triggered", `${findings.length} stock(s) above ${thr}%.`, formatPct(pct(stocks[0].value, D)), findings);
    if (aggregates.length) {
      const v = sum(aggregates.map((a) => a.value));
      return finish("not_evaluable", `Stock-level positions not entered for ${formatCompact(v)} of direct equity.`, null, [gap(def, "direct-equity",
        `Direct equity is held only as an aggregate of ${formatCompact(v)} (${formatPct(pct(v, D))} of ${DEN_SHORT[den]}). Single-stock concentration cannot be measured until individual holdings and quantities are entered.`,
        "Enter each stock with quantity and current value.", aggregates.map((a) => ({ type: "holding" as const, id: a.sourceId, name: a.name })))]);
    }
    if (stocks.length === 0) return finish("ok", "No direct stock positions held.", null);
    return finish("ok", `Largest stock ${stocks[0].name} is ${formatPct(pct(stocks[0].value, D))}.`, formatPct(pct(stocks[0].value, D)));
  },

  debt_allocation_min(cfg, c, def) {
    const den = denomOf(cfg), D = c.portfolio.denominators[den].value;
    if (D <= 0) return finish("not_evaluable", "No assets recorded.", null);
    const b = groupBounds(c.portfolio, ["debt"]);
    const [mn, mx] = [pct(b.min, D)!, pct(b.max, D)!];
    const inc = !!cfg.params.inclusive, thr = cfg.value;
    const base = { subject: "Debt", thresholdLabel: `< ${thr}% of ${DEN_SHORT[den]}`, records: c.portfolio.lines.filter((l) => l.assetClass === "debt").map((l) => ({ type: "holding" as const, id: l.sourceId, name: l.name })) };
    const need = Math.max(0, Math.round((thr / 100) * D) - b.min);
    if (cmp(mx, thr, inc, "lt")) {
      return finish("triggered", `Debt is ${formatPct(mn)} of ${DEN_SHORT[den]} (minimum ${thr}%).`, formatPct(mn), [{ fingerprint: `${def.key}:debt`, kind: "breach", ...base, currentLabel: formatPct(mn), provisional: c.portfolio.unresolved.value > 0,
        why: `Debt & fixed income of ${formatCompact(b.min)} is ${formatPct(mn)} of ${formatCompact(D)}, below the ${thr}% floor.`,
        action: `Direct about ${formatCompact(need)} to debt/fixed income (new money first) to restore the floor.`, effect: `Debt would reach ≈${thr}%.` }]);
    }
    if (cmp(mn, thr, inc, "lt")) {
      return finish("possible", `Debt is between ${formatPct(mn)} and ${formatPct(mx)} depending on unclassified holdings.`, `${formatPct(mn)} – ${formatPct(mx)}`, [{ fingerprint: `${def.key}:debt`, kind: "possible", ...base, currentLabel: `${formatPct(mn)} – ${formatPct(mx)}`, provisional: true,
        why: `Classified debt is only ${formatPct(mn)}. The ${formatCompact(c.portfolio.unresolved.value)} of unclassified holdings might lift it above ${thr}%, but this cannot be confirmed yet.`,
        action: "Enter the debt-fund portion of the mutual-fund holdings to confirm." }]);
    }
    return finish("ok", `Debt ${formatPct(mn)} meets the ${thr}% minimum.`, formatPct(mn));
  },

  net_worth_decline(cfg, c, def) {
    const win = (cfg.params.window as string) === "year" ? "year" : "month";
    const ch = win === "year" ? c.netWorth.changeYear : c.netWorth.changeMonth;
    if (!ch.comparable || ch.percent == null) return finish("not_evaluable", ch.reason, null, [gap(def, `window-${win}`, ch.reason, "Record a month-end net-worth snapshot (Dashboard → Record snapshot).")]);
    const decl = -ch.percent;
    if (decl > cfg.value) {
      const a = ch.attribution!;
      return finish("triggered", `Net worth fell ${formatPct(decl)} vs ${ch.previous!.date}.`, `−${formatPct(decl)}`, [{ fingerprint: `${def.key}:${win}`, kind: "breach", subject: "Net worth", currentLabel: `−${formatPct(decl)}`, thresholdLabel: `fall > ${cfg.value}% (${win})`, provisional: c.netWorth.provisional,
        why: `Net worth moved ${formatCompact(ch.absolute)} (${formatPct(ch.percent)}) since ${ch.previous!.date}. Of this: new/(repaid) liabilities ${formatCompact(a.liabilityChange)}, net external withdrawals ${formatCompact(a.netExternalWithdrawals)}, valuation & other ${formatCompact(a.valuationAndOther)}.`,
        action: "Identify whether the fall is a market move (no action), spending/withdrawals, or new borrowing.", records: [] }]);
    }
    return finish("ok", `Net worth change ${formatPct(ch.percent)} over the ${win}.`, formatPct(ch.percent));
  },

  emi_to_income_max(cfg, c, def) {
    const income = c.cash.monthlyIncomeVerified, emi = c.cash.emiMonthly;
    if (income <= 0) return finish("not_evaluable", "Verified monthly income not available.", null, [gap(def, "income", "Verified monthly gross income has not been entered, so the EMI ratio would be meaningless.", "Record verified income in the Cash-flow planner.")]);
    if (emi === 0 && c.netWorth.liabilitiesStatus !== "complete") return finish("not_evaluable", "Loan EMIs not yet captured.", null, [gap(def, "emi", "No loan EMIs are recorded and the liability list is not marked complete.", "Enter loans (with EMIs) or confirm there are none.")]);
    const r = pct(emi, income)!;
    if (r > cfg.value) return finish("triggered", `EMIs consume ${formatPct(r)} of income.`, formatPct(r), [{ fingerprint: `${def.key}:emi`, kind: "breach", subject: "EMI-to-income", currentLabel: formatPct(r), thresholdLabel: `> ${cfg.value}%`, provisional: !c.cash.incomeAssessed,
      why: `Monthly EMIs ${formatCompact(emi)} ÷ verified monthly income ${formatCompact(income)} = ${formatPct(r)}.`, action: "Consider prepaying the highest-rate loan or extending tenure; avoid new credit.", records: c.data.liabilities.filter((l) => !l.archived && l.emi).map((l) => ({ type: "liability" as const, id: l.id, name: l.name })) }]);
    return finish("ok", `EMI-to-income ${formatPct(r)}.`, formatPct(r));
  },

  portfolio_drift_max(cfg, c, def) {
    const den = denomOf(cfg);
    if (c.data.targets.length === 0) return finish("not_evaluable", "No target allocation set.", null);
    const rows = c.allocationByDenominator(den, cfg.value, !!cfg.params.inclusive).filter((r) => r.inDenominator && r.targetPct != null);
    const findings: Finding[] = [];
    for (const r of rows) {
      if (r.status !== "breach" && r.status !== "possible") continue;
      const definite = r.status === "breach";
      const label = ASSET_CLASS_LABEL[r.assetClass];
      findings.push({ fingerprint: `${def.key}:${r.assetClass}`, kind: definite ? "breach" : "possible", subject: label,
        currentLabel: definite ? `${r.pct?.toFixed(1)}% (${r.driftPp! > 0 ? "+" : ""}${r.driftPp?.toFixed(1)} pp)` : `${r.minPct?.toFixed(1)}–${r.maxPct?.toFixed(1)}%`,
        thresholdLabel: `target ${r.targetPct}% ± ${cfg.value} pp`, provisional: r.provisional,
        why: definite ? `${label} is ${r.pct?.toFixed(1)}% vs target ${r.targetPct}% — a drift of ${r.driftPp! > 0 ? "+" : ""}${r.driftPp?.toFixed(1)} percentage points (tolerance ±${cfg.value} pp) on ${DEN_SHORT[den]}.`
          : `${label} could be ${r.minPct?.toFixed(1)}%–${r.maxPct?.toFixed(1)}% against a target of ${r.targetPct}% once unclassified holdings are resolved.`,
        action: definite ? `Gap to target ≈ ${formatCompact(Math.abs(r.gapValue ?? 0))} ${((r.gapValue ?? 0) > 0) ? "to add" : "to reduce"}. See the rebalancing scenario for options.` : "Resolve unclassified holdings to confirm the drift.",
        records: c.portfolio.lines.filter((l) => l.assetClass === r.assetClass).map((l) => ({ type: "holding" as const, id: l.sourceId, name: l.name })) });
    }
    if (findings.length) return finish(findings.some((f) => f.kind === "breach") ? "triggered" : "possible", `${findings.length} asset class(es) outside the ±${cfg.value} pp band.`, `${findings.length} outside band`, findings);
    return finish("ok", "All asset classes are within their drift band.", "within band");
  },

  idle_cash(cfg, c, def) {
    const cashHoldings = c.data.holdings.filter((h) => !h.archived && (h.instrumentType === "cash" || h.instrumentType === "bank_balance"));
    if (cashHoldings.length === 0) return finish("not_evaluable", "No cash or bank balances recorded.", null, [gap(def, "cash", "Bank and cash balances have not been entered, so idle cash cannot be assessed.", "Add bank balances and cash in hand.")]);
    const cashNow = sum(cashHoldings.map((h) => h.currentValue));
    const essential = c.cash.essentialMonthly;
    const emergencyNeed = Math.round(essential * c.data.settings.emergencyMonthsTarget);
    const idle = cashNow - emergencyNeed - c.upcomingOutflow90d;
    const D = c.portfolio.denominators.investable.value;
    const floor = Number(cfg.params.absoluteFloor ?? 0);
    const threshold = Math.max(Math.round((cfg.value / 100) * D), floor);
    const minDays = Number(cfg.params.minIdleDays ?? 30);
    if (idle <= threshold) return finish("ok", `Idle cash ${formatCompact(Math.max(0, idle))} is below the ${formatCompact(threshold)} threshold.`, formatCompact(Math.max(0, idle)));
    // duration: walk back through dated valuations to find how long total cash has been at least the idle level
    const dates = new Set<string>();
    for (const v of c.data.valuations) if (cashHoldings.some((h) => h.id === v.holdingId)) dates.add(v.date);
    for (const h of cashHoldings) if (h.valuationDate) dates.add(h.valuationDate);
    const sorted = [...dates].sort();
    const balanceAt = (d: string) => sum(cashHoldings.map((h) => {
      const vs = c.data.valuations.filter((v) => v.holdingId === h.id && v.date <= d).sort((a, b) => b.date.localeCompare(a.date));
      return vs[0]?.value ?? (h.valuationDate && h.valuationDate <= d ? h.currentValue : 0);
    }));
    let since: string | null = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (balanceAt(sorted[i]) - emergencyNeed - c.upcomingOutflow90d > threshold) since = sorted[i]; else break;
    }
    const days = since ? daysBetween(since, c.asOf) : null;
    const base = { subject: "Idle cash", thresholdLabel: `idle > ${formatCompact(threshold)} for ≥ ${minDays} days`, records: cashHoldings.map((h) => ({ type: "holding" as const, id: h.id, name: h.name })) };
    const why = `Cash ${formatCompact(cashNow)} less emergency fund ${formatCompact(emergencyNeed)} and next-90-day outflows ${formatCompact(c.upcomingOutflow90d)} leaves ${formatCompact(idle)} uninvested${days != null ? ` (above threshold since ${since})` : ""}.`;
    if (days != null && days >= minDays) return finish("triggered", `${formatCompact(idle)} of cash idle for ${days} days.`, formatCompact(idle), [{ fingerprint: `${def.key}:cash`, kind: "breach", ...base, currentLabel: formatCompact(idle), why, provisional: false, action: "Consider deploying part of the surplus to liquid debt funds, FDs or planned goals per your allocation policy.", effect: `Could earn a return instead of sitting idle.` }]);
    return finish("possible", `${formatCompact(idle)} of cash looks idle; duration ${days != null ? `only ${days} days known` : "cannot be verified"}.`, formatCompact(idle), [{ fingerprint: `${def.key}:cash`, kind: "possible", ...base, currentLabel: formatCompact(idle), why: why + " Balance history is too short to confirm it has been idle long enough.", provisional: true, action: "Keep valuation dates up to date; the alert confirms once the idle period is met." }]);
  },

  maturity_window(cfg, c, def) {
    const findings: Finding[] = [];
    const win = cfg.value;
    const check = (date: ISODate | null, type: "holding" | "policy", id: string, name: string, what: string, value: Paise | null) => {
      if (!date) return;
      const d = daysBetween(c.asOf, date);
      if (d > win) return;
      findings.push({ fingerprint: `${def.key}:${type}:${id}:${what}`, kind: "breach", subject: name, currentLabel: d < 0 ? `${-d} days overdue` : `in ${d} days (${date})`, thresholdLabel: `within ${win} days`, provisional: false,
        why: `${name} ${what} on ${date}${value != null ? ` (${formatCompact(value)})` : ""}.`,
        action: what === "matures" ? "Decide on reinvestment or withdrawal and confirm the bank mandate." : "Renew / pay on time to keep cover or avoid lapse.", records: [{ type, id, name }] });
    };
    const gaps: Finding[] = [];
    for (const h of c.data.holdings.filter((h) => !h.archived)) {
      if (h.instrumentType === "fixed_deposit" || h.instrumentType === "bond") {
        if (!h.maturityDate) { gaps.push(gap(def, `maturity-${h.id}`, `${h.name} has no maturity date recorded.`, "Enter the maturity date and expected proceeds.", [{ type: "holding", id: h.id, name: h.name }])); continue; }
        check(h.maturityDate, "holding", h.id, h.name, "matures", h.expectedMaturityValue ?? h.currentValue);
      }
    }
    for (const p of c.data.policies.filter((p) => !p.archived)) {
      const nm = `${p.insurer ?? "Policy"} ${p.type.replace("_", " ")}`;
      check(p.renewalDate, "policy", p.id, nm, "renews", p.annualPremium);
      check(p.nextPremiumDate, "policy", p.id, nm, "premium due", p.annualPremium);
      check(p.maturityDate, "policy", p.id, nm, "matures", p.expectedMaturityValue);
    }
    if (findings.length) return finish("triggered", `${findings.length} maturity/renewal item(s) within ${win} days.`, `${findings.length} due`, findings);
    if (gaps.length) {
      const merged: Finding = { ...gaps[0], fingerprint: `${def.key}:gap:maturity-dates`, subject: "Maturity dates", why: `${gaps.length} FD/bond holding(s) have no maturity date: ${gaps.map((g) => g.records[0].name).join(", ")}. Maturity alerts cannot run until dates are entered.`, records: gaps.flatMap((g) => g.records) };
      return finish("not_evaluable", "Maturity dates missing for FDs/bonds.", null, [merged]);
    }
    return finish("ok", "No maturities or renewals in the window.", null);
  },

  credit_card_balance(cfg, c, def) {
    const cards = c.data.liabilities.filter((l) => !l.archived && l.type === "credit_card" && l.outstanding > cfg.value);
    if (!cards.length) return finish("ok", "No credit-card balance above the limit.", null);
    return finish("triggered", `${cards.length} card(s) above ${formatCompact(cfg.value)}.`, formatCompact(cards[0].outstanding), cards.map((l) => ({ fingerprint: `${def.key}:${l.id}`, kind: "breach" as const, subject: l.name, currentLabel: formatCompact(l.outstanding), thresholdLabel: `> ${formatCompact(cfg.value)}`, provisional: false,
      why: `${l.name} outstanding ${formatCompact(l.outstanding)} exceeds the limit.`, action: "Pay the statement balance in full to avoid revolving interest.", records: [{ type: "liability" as const, id: l.id, name: l.name }] })));
  },

  debt_to_net_worth(cfg, c, def) {
    const nw = c.netWorth;
    if (nw.netWorth == null) return finish("not_evaluable", "Net worth not yet calculable.", null);
    if (nw.liabilities === 0) return finish("ok", "No confirmed debt.", "0%");
    if (nw.netWorth <= 0) return finish("triggered", "Net worth is zero or negative while debt is outstanding.", "n/m", [{ fingerprint: `${def.key}:neg`, kind: "breach", subject: "Debt-to-net-worth", currentLabel: "net worth ≤ 0", thresholdLabel: `> ${cfg.value}%`, provisional: nw.provisional, why: `Liabilities ${formatCompact(nw.liabilities)} are at least as large as assets.`, action: "Prioritise debt reduction.", records: [] }]);
    const r = nw.debtToNetWorthPct!;
    if (r > cfg.value) return finish("triggered", `Debt is ${formatPct(r)} of net worth.`, formatPct(r), [{ fingerprint: `${def.key}:ratio`, kind: "breach", subject: "Debt-to-net-worth", currentLabel: formatPct(r), thresholdLabel: `> ${cfg.value}%`, provisional: nw.provisional,
      why: `Confirmed debt ${formatCompact(nw.liabilities)} ÷ net worth ${formatCompact(nw.netWorth)} = ${formatPct(r)}.`, action: "Reduce debt or grow net worth before taking new borrowing.", records: c.data.liabilities.filter((l) => !l.archived).map((l) => ({ type: "liability" as const, id: l.id, name: l.name })) }]);
    return finish("ok", `Debt-to-net-worth ${formatPct(r)}.`, formatPct(r));
  },

  negative_cash_flow(cfg, c, def) {
    if (!c.cash.hasIncome && c.cash.monthlyOutflows === 0) return finish("not_evaluable", "No cash-flow records.", null);
    const s = c.cash.monthlySurplus;
    if (s >= cfg.value) return finish("ok", `Monthly surplus ${formatCompact(s)}.`, formatCompact(s));
    const assessed = c.cash.incomeAssessed;
    return finish(assessed ? "triggered" : "possible", `Monthly deficit of ${formatCompact(-s)} on recorded items${assessed ? "" : " (income incomplete)"}.`, formatCompact(s), [{ fingerprint: `${def.key}:monthly`, kind: assessed ? "breach" : "possible", subject: "Monthly cash flow", currentLabel: formatCompact(s), thresholdLabel: "surplus < 0", provisional: !assessed,
      why: `Recorded inflows ${formatCompact(c.cash.monthlyIncome)} (monthly equivalent) vs outflows ${formatCompact(c.cash.monthlyOutflows)}.${assessed ? "" : " Other income sources (salary, business, rent…) have not been supplied, so this deficit is provisional."}`,
      action: assessed ? "Review expenses/income; confirm reserves can fund the gap." : "Complete income collection to confirm.", records: [] }]);
  },

  emergency_fund_min(cfg, c, def) {
    const m = c.emergencyCoverageMonths;
    if (m == null) return finish("not_evaluable", "Essential monthly expenses not recorded.", null, [gap(def, "expenses", "Essential monthly expenses are missing, so emergency-fund coverage cannot be computed.", "Record household and medical expenses.")]);
    if (m < cfg.value) return finish("triggered", `Emergency coverage ${m.toFixed(1)} months (target ${cfg.value}).`, `${m.toFixed(1)} mo`, [{ fingerprint: `${def.key}:coverage`, kind: "breach", subject: "Emergency fund", currentLabel: `${m.toFixed(1)} months`, thresholdLabel: `< ${cfg.value} months`, provisional: false,
      why: `Eligible reserves ${formatCompact(c.portfolio.emergencyReserves)} ÷ essential expenses ${formatCompact(c.cash.essentialMonthly)} per month = ${m.toFixed(1)} months.`, action: `Add about ${formatCompact(Math.max(0, cfg.value * c.cash.essentialMonthly - c.portfolio.emergencyReserves))} to liquid reserves.`, records: [] }]);
    return finish("ok", `Emergency coverage ${m.toFixed(1)} months.`, `${m.toFixed(1)} mo`);
  },

  pension_premium_window(cfg, c, def) {
    const findings: Finding[] = [];
    const gaps: Finding[] = [];
    for (const cm of c.data.commitments.filter((x) => !x.archived)) {
      const remaining = cm.totalAmount - cm.paidAmount;
      if (remaining <= 0) continue;
      if (!cm.nextDueDate) { gaps.push(gap(def, `schedule-${cm.id}`, `${cm.name}: ${formatCompact(remaining)} remains payable but no payment schedule is recorded, so it is excluded from dated forecasts.`, "Enter the next due date, instalment and frequency.", [{ type: "commitment", id: cm.id, name: cm.name }])); continue; }
      const d = daysBetween(c.asOf, cm.nextDueDate);
      if (d <= cfg.value) findings.push({ fingerprint: `${def.key}:${cm.id}`, kind: "breach", subject: cm.name, currentLabel: d < 0 ? `${-d} days overdue` : `in ${d} days`, thresholdLabel: `within ${cfg.value} days`, provisional: false,
        why: `${cm.name} instalment ${cm.installmentAmount ? formatCompact(cm.installmentAmount) : ""} is due ${cm.nextDueDate}. Remaining commitment ${formatCompact(remaining)}.`, action: "Ensure funds are available in the paying account before the due date.", records: [{ type: "commitment", id: cm.id, name: cm.name }] });
    }
    if (findings.length) return finish("triggered", `${findings.length} premium(s) due soon.`, `${findings.length} due`, findings);
    if (gaps.length) return finish("not_evaluable", "Premium payment schedule missing.", null, gaps);
    return finish("ok", "No premiums due in the window.", null);
  },

  missing_valuation(cfg, c, def) {
    const m = c.portfolio.valuation.missingDate;
    if (!m.length) return finish("ok", "All holdings have valuation dates.", null);
    return finish("triggered", `${m.length} holding(s) without a valuation date.`, `${m.length}`, [{ fingerprint: `${def.key}:all`, kind: "breach", subject: "Valuation dates", currentLabel: `${m.length} holdings`, thresholdLabel: "any missing", provisional: false,
      why: `Values for ${m.map((x) => x.name).join(", ")} have no 'as-of' date, so freshness cannot be judged.`, action: "Enter the valuation date for each holding.", records: m.map((x) => ({ type: "holding" as const, id: x.sourceId, name: x.name })) }]);
  },

  unclassified_holdings(cfg, c, def) {
    const unresolved = c.portfolio.unresolved.lines;
    if (!unresolved.length) return finish("ok", "All holdings are classified.", null);
    return finish("triggered", `${formatCompact(c.portfolio.unresolved.value)} unclassified.`, formatCompact(c.portfolio.unresolved.value), [{ fingerprint: `${def.key}:unresolved`, kind: "breach", subject: "Unclassified holdings", currentLabel: `${formatCompact(c.portfolio.unresolved.value)} (${formatPct(c.portfolio.unresolved.pctOfGross)} of gross)`, thresholdLabel: "any unresolved", provisional: false,
      why: `${unresolved.map((u) => u.name).join(", ")} cannot be assigned to an asset class yet. Allocation, equity and debt metrics are shown as ranges until resolved.`, action: "Add the underlying schemes/securities (look-through) or choose a category manually.", records: unresolved.map((u) => ({ type: "holding" as const, id: u.sourceId, name: u.name })) }]);
  },

  stale_data(cfg, c, def) {
    const s = c.portfolio.valuation.stale;
    if (!s.length) return finish("ok", "No stale valuations.", null);
    return finish("triggered", `${s.length} stale valuation(s).`, `${s.length}`, [{ fingerprint: `${def.key}:all`, kind: "breach", subject: "Stale valuations", currentLabel: `${s.length} holdings`, thresholdLabel: `older than ${cfg.value} days`, provisional: false,
      why: `Valuations older than ${cfg.value} days: ${s.map((x) => `${x.name} (${x.valuationDate})`).join(", ")}.`, action: "Refresh market values or enter updated statements.", records: s.map((x) => ({ type: "holding" as const, id: x.sourceId, name: x.name })) }]);
  },

  goal_shortfall(cfg, c, def) {
    const goals = c.data.goals.filter((g) => !g.archived).map((g) => projectGoal(g, c.asOf)).filter((g) => !g.onTrack && !g.overdue);
    if (!goals.length) return finish("ok", c.data.goals.length ? "Goals are on track." : "No goals set.", null);
    return finish("triggered", `${goals.length} goal(s) projected to fall short.`, `${goals.length}`, goals.map((g) => ({ fingerprint: `${def.key}:${g.goal.id}`, kind: "breach" as const, subject: g.goal.name, currentLabel: `short by ${formatCompact(g.projectedGap)}`, thresholdLabel: "projection < target", provisional: false,
      why: `${g.goal.name}: projected ${formatCompact(g.projectedValue)} vs target ${formatCompact(g.goal.targetAmount)} by ${g.goal.targetDate}. ${g.assumption}`,
      action: g.requiredMonthly != null ? `About ${formatCompact(g.requiredMonthly)}/month would be needed (vs ${formatCompact(g.goal.monthlyContribution)} planned).` : "Revise the target date or amount.", records: [{ type: "goal" as const, id: g.goal.id, name: g.goal.name }] })));
  },

  health_score_drop(cfg, c, def) {
    const hist = c.data.scoreHistory.filter((h) => h.date < c.asOf).sort((a, b) => a.date.localeCompare(b.date));
    const prev = hist.length ? hist[hist.length - 1] : null;
    if (prev == null || c.healthScore == null) return finish("not_evaluable", "No earlier health assessment to compare.", null);
    const drop = prev.score - c.healthScore;
    if (drop > cfg.value) return finish("triggered", `Health score fell ${drop.toFixed(0)} points.`, `−${drop.toFixed(0)}`, [{ fingerprint: `${def.key}:drop`, kind: "breach", subject: "Financial-health score", currentLabel: `${c.healthScore.toFixed(0)} (was ${prev.score.toFixed(0)})`, thresholdLabel: `drop > ${cfg.value} points`, provisional: true,
      why: `Score moved from ${prev.score.toFixed(0)} (${prev.date}) to ${c.healthScore.toFixed(0)}.`, action: "Open the Financial Health page to see which component changed.", records: [] }]);
    return finish("ok", `Score change ${(-drop).toFixed(0)} points.`, `${c.healthScore.toFixed(0)}`);
  },
};

const thresholdText = (cfg: RuleConfig) => cfg.unit === "₹" ? formatCompact(cfg.value) : `${cfg.value}${cfg.unit === "%" ? "%" : " " + cfg.unit}`;

export function evaluateRule(cfg: RuleConfig, ctx: RuleContext): RuleResult {
  const def = RULE_DEF_BY_KEY[cfg.key];
  const thresholdLabel = thresholdText(cfg);
  if (!cfg.enabled) return { key: cfg.key, name: def.name, severity: cfg.severity, state: "disabled", findings: [], summary: "Rule disabled.", currentLabel: null, thresholdLabel };
  const r = EVAL[cfg.key](cfg, ctx, def);
  return { key: cfg.key, name: def.name, severity: cfg.severity, thresholdLabel, ...r };
}

export function evaluateRules(ctx: RuleContext): RuleResult[] {
  const byKey = new Map(ctx.data.rules.map((r) => [r.key, r]));
  return RULE_DEFS.map((d) => {
    const cfg = byKey.get(d.key) ?? { key: d.key, ...d.defaults, lastEvaluatedAt: null };
    return evaluateRule(cfg as RuleConfig, ctx);
  });
}

/** Validation of rule edits (server and form share this). Returns an error message or null. */
export function validateRuleValue(key: RuleKey, value: number): string | null {
  const d = RULE_DEF_BY_KEY[key];
  if (!Number.isFinite(value)) return "Enter a number.";
  if (d.valueMin != null && value < d.valueMin) return `Must be at least ${d.valueMin}.`;
  if (d.valueMax != null && value > d.valueMax) return `Must be at most ${d.valueMax}.`;
  if (d.defaults.unit === "₹" && value < 0) return "Must not be negative.";
  return null;
}
export { addMonths, crore };
