import { formatCompact, formatPct, lakh, pct, sum } from "./money";
import type { ClientData, HealthWeights } from "./types";
import type { PortfolioResult } from "./portfolio";
import type { NetWorthResult } from "./networth";
import type { CashflowSummary } from "./cashflow";

export const HEALTH_COVER_TARGET = lakh(10); // illustrative minimum family health cover used by the insurance component
export const HEALTH_LABELS: Record<keyof HealthWeights, string> = {
  net_worth: "Net-worth strength", cash_flow: "Savings & cash flow", emergency: "Emergency fund & liquidity",
  debt: "Debt burden", diversification: "Diversification & concentration", insurance: "Insurance coverage",
};

export interface ScoreComponent {
  key: keyof HealthWeights; label: string; weight: number; assessed: boolean; provisional: boolean; score: number | null;
  metrics: Array<{ label: string; value: string }>; formula: string; reason: string; improvement: string;
}
export interface HealthScore {
  overall: number | null; band: string | null; coverage: number; provisional: boolean; lowCoverage: boolean;
  components: ScoreComponent[]; disclosure: string; methodology: string;
}

/** Piecewise-linear interpolation through (x, score) anchor points, clamped at both ends. */
export function interpolate(points: Array<{ x: number; y: number }>, x: number): number {
  const p = [...points].sort((a, b) => a.x - b.x);
  if (x <= p[0].x) return p[0].y;
  if (x >= p[p.length - 1].x) return p[p.length - 1].y;
  for (let i = 1; i < p.length; i++) if (x <= p[i].x) { const t = (x - p[i - 1].x) / (p[i].x - p[i - 1].x); return p[i - 1].y + t * (p[i].y - p[i - 1].y); }
  return p[p.length - 1].y;
}
const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function computeHealthScore(data: ClientData, p: PortfolioResult, nw: NetWorthResult, cash: CashflowSummary, emergencyMonths: number | null): HealthScore {
  const s = data.settings, w = s.healthWeights;
  const comps: ScoreComponent[] = [];
  const base = (key: keyof HealthWeights) => ({ key, label: HEALTH_LABELS[key], weight: w[key] });

  // 1. net worth strength -----------------------------------------------------
  {
    const annualSpend = cash.monthlyOutflows * 12;
    const c = base("net_worth");
    const formula = "multiple = net worth ÷ annual outflows; score interpolated across configured bands.";
    if (nw.netWorth == null) comps.push({ ...c, assessed: false, provisional: false, score: null, metrics: [{ label: "Net worth", value: "Awaiting liabilities" }], formula, reason: "Liabilities have not been assessed, so net worth is unknown.", improvement: "Enter all loans and card balances, then mark the liability list complete." });
    else if (annualSpend <= 0) comps.push({ ...c, assessed: false, provisional: false, score: null, metrics: [{ label: "Net worth", value: formatCompact(nw.netWorth) }], formula, reason: "Annual outflows are unknown, so net worth cannot be expressed as years of spending.", improvement: "Record household and other expenses." });
    else {
      const mult = nw.netWorth / annualSpend;
      const sc = nw.netWorth <= 0 ? 0 : interpolate(s.nwStrengthBands.map((b) => ({ x: b.multiple, y: b.score })), mult);
      comps.push({ ...c, assessed: true, provisional: nw.provisional, score: sc, formula,
        metrics: [{ label: "Net worth", value: formatCompact(nw.netWorth) }, { label: "Annual outflows", value: formatCompact(annualSpend) }, { label: "Net worth ÷ annual outflows", value: `${mult.toFixed(1)}×` }],
        reason: `Net worth covers ${mult.toFixed(1)} years of recorded outflows.${nw.provisional ? " Liabilities are not fully recorded, so this is provisional." : ""}`,
        improvement: sc >= 100 ? "Maintain; keep liabilities current." : "Grow net worth relative to spending (savings, appreciation) or reduce liabilities." });
    }
  }
  // 2. cash flow ----------------------------------------------------------------
  {
    const c = base("cash_flow");
    const formula = "savings rate = (income − spending) ÷ income; anchors 0%→0, 10%→50, 20%→75, 30%+→100.";
    if (!cash.hasIncome || data.settings.incomeStatus === "pending" || cash.savingsRate == null) {
      comps.push({ ...c, assessed: false, provisional: false, score: null, metrics: [{ label: "Savings rate", value: "Awaiting income" }], formula, reason: "Income has not been fully collected; a savings rate from partial income would mislead.", improvement: "Record salary / business / rental / interest income and mark income complete." });
    } else {
      const sr = cash.savingsRate;
      const sc = sr <= 0 ? 0 : interpolate([{ x: 0, y: 0 }, { x: 10, y: 50 }, { x: 20, y: 75 }, { x: 30, y: 100 }], sr);
      comps.push({ ...c, assessed: true, provisional: !cash.incomeAssessed, score: sc, formula,
        metrics: [{ label: "Monthly income", value: formatCompact(cash.monthlyIncome) }, { label: "Monthly outflows", value: formatCompact(cash.monthlyOutflows) }, { label: "Savings rate", value: formatPct(sr) }],
        reason: sr <= 0 ? "Spending is at or above income." : `Saving ${formatPct(sr)} of income.`, improvement: sr >= 30 ? "Excellent; consider directing surplus per allocation." : "Raise income or reduce discretionary spending to lift the savings rate toward 30%." });
    }
  }
  // 3. emergency ------------------------------------------------------------------
  {
    const c = base("emergency");
    const formula = "months = eligible liquid reserves ÷ monthly essential expenses; score = months ÷ target × 100 (capped).";
    if (emergencyMonths == null) comps.push({ ...c, assessed: false, provisional: false, score: null, metrics: [{ label: "Coverage", value: "Awaiting expenses" }], formula, reason: "Essential monthly expenses are not recorded.", improvement: "Record household and medical expenses." });
    else {
      const sc = clamp((emergencyMonths / s.emergencyMonthsTarget) * 100);
      const hasBank = data.holdings.some((h) => !h.archived && (h.instrumentType === "bank_balance" || h.instrumentType === "cash"));
      comps.push({ ...c, assessed: true, provisional: !hasBank, score: sc, formula,
        metrics: [{ label: "Eligible reserves", value: formatCompact(p.emergencyReserves) }, { label: "Essential expenses / month", value: formatCompact(cash.essentialMonthly) }, { label: "Coverage", value: `${emergencyMonths.toFixed(1)} months (target ${s.emergencyMonthsTarget})` }],
        reason: `Reserves cover ${emergencyMonths.toFixed(1)} months of essential expenses.${hasBank ? "" : " Bank balances have not been entered, so this may understate liquidity."}`,
        improvement: sc >= 100 ? "Target met." : "Build liquid reserves (bank, liquid funds, short FDs) toward the target." });
    }
  }
  // 4. debt ------------------------------------------------------------------------
  {
    const c = base("debt");
    const formula = "average of EMI-ratio score (≤10%→100, 40%→50, ≥60%→0) and debt-to-net-worth score (≤10%→100, 50%→50, ≥100%→0).";
    if (nw.liabilitiesStatus === "not_assessed") comps.push({ ...c, assessed: false, provisional: false, score: null, metrics: [{ label: "Liabilities", value: "Not assessed" }], formula, reason: "Liabilities have not been recorded. Absence of data is not treated as zero debt.", improvement: "Enter loans, EMIs and card balances (or confirm there are none)." });
    else {
      const parts: number[] = [];
      const metrics: ScoreComponent["metrics"] = [{ label: "Confirmed liabilities", value: formatCompact(nw.liabilities) }];
      const emiRatio = cash.monthlyIncomeVerified > 0 ? pct(cash.emiMonthly, cash.monthlyIncomeVerified) : null;
      if (emiRatio != null) { parts.push(interpolate([{ x: 10, y: 100 }, { x: 40, y: 50 }, { x: 60, y: 0 }], emiRatio)); metrics.push({ label: "EMI-to-income", value: formatPct(emiRatio) }); }
      else metrics.push({ label: "EMI-to-income", value: "Awaiting verified income" });
      if (nw.liabilities === 0) { parts.push(100); metrics.push({ label: "Debt-to-net-worth", value: "0%" }); }
      else if (nw.debtToNetWorthPct != null) { parts.push(interpolate([{ x: 10, y: 100 }, { x: 50, y: 50 }, { x: 100, y: 0 }], nw.debtToNetWorthPct)); metrics.push({ label: "Debt-to-net-worth", value: formatPct(nw.debtToNetWorthPct) }); }
      else if (nw.netWorth != null && nw.netWorth <= 0) { parts.push(0); metrics.push({ label: "Debt-to-net-worth", value: "net worth ≤ 0" }); }
      const sc = parts.length ? sum(parts) / parts.length : null;
      comps.push({ ...c, assessed: sc != null, provisional: nw.liabilitiesStatus !== "complete" || emiRatio == null, score: sc, metrics, formula,
        reason: sc == null ? "Insufficient ratios available." : `Debt metrics average ${sc.toFixed(0)}/100.${nw.liabilitiesStatus !== "complete" ? " The liability list is not marked complete." : ""}`,
        improvement: "Prepay high-rate debt; keep EMIs under ~40% of income and debt under ~50% of net worth." });
    }
  }
  // 5. diversification ---------------------------------------------------------------
  {
    const c = base("diversification");
    const formula = "effective number of buckets ENB = 1 ÷ Σ share²  (classes + one 'unclassified' bucket); ENB 1→0, 5+→100. Blended 70/30 with single-stock score when stock-level data exists.";
    const gross = p.grossAssets;
    const classifiedShare = gross > 0 ? 1 - p.unresolved.value / gross : 0;
    if (gross <= 0 || classifiedShare < 0.7) comps.push({ ...c, assessed: false, provisional: false, score: null, metrics: [{ label: "Classified", value: formatPct(classifiedShare * 100) }], formula, reason: "Too little of the portfolio is classified to judge diversification (needs ≥ 70%).", improvement: "Classify unresolved holdings (look-through)." });
    else {
      const shares = Object.values(p.buckets).map((b) => b.value / gross).filter((x) => x > 0);
      if (p.unresolved.value > 0) shares.push(p.unresolved.value / gross);
      const enb = 1 / sum(shares.map((x) => x * x));
      let sc = clamp(((enb - 1) / 4) * 100);
      const metrics: ScoreComponent["metrics"] = [{ label: "Effective buckets", value: enb.toFixed(2) }, { label: "Classified share", value: formatPct(classifiedShare * 100) }];
      const stockD = p.denominators.investable.value;
      if (p.directStocks.length && stockD > 0) {
        const top = p.directStocks[0].value / stockD * 100;
        const stockScore = interpolate([{ x: 5, y: 100 }, { x: 25, y: 0 }], top);
        sc = 0.7 * sc + 0.3 * stockScore; metrics.push({ label: "Largest stock", value: `${p.directStocks[0].name} ${formatPct(top)}` });
      } else metrics.push({ label: "Single-stock data", value: "Not entered (excluded)" });
      comps.push({ ...c, assessed: true, provisional: p.unresolved.value > 0 || Object.values(p.buckets).some((b) => b.provisionalValue > 0), score: sc, metrics, formula,
        reason: `Portfolio behaves like ${enb.toFixed(1)} equal-sized buckets.${p.unresolved.value > 0 ? " Some holdings are unclassified or provisional." : ""}`,
        improvement: "Spread exposure across more asset classes and keep any single stock small." });
    }
  }
  // 6. insurance -------------------------------------------------------------------------
  {
    const c = base("insurance");
    const formula = "50% life cover ÷ target (multiple × annual income, else annual outflows) + 50% health cover ÷ ₹10 L reference.";
    const pol = data.policies.filter((x) => !x.archived);
    if (!pol.length) comps.push({ ...c, assessed: false, provisional: false, score: null, metrics: [{ label: "Policies", value: "None recorded" }], formula, reason: "No insurance policies recorded. Missing data is not scored as adequate cover.", improvement: "Record life and health policies (sum assured, premium, renewal)." });
    else {
      const life = sum(pol.filter((x) => x.type === "term_life" || x.type === "ulip" || x.type === "endowment").map((x) => x.sumAssured));
      const health = sum(pol.filter((x) => x.type === "health").map((x) => x.sumAssured));
      const base_ = cash.monthlyIncomeVerified > 0 ? cash.monthlyIncomeVerified * 12 : cash.monthlyOutflows * 12;
      const target = base_ * s.insuranceLifeCoverMultiple;
      const lifeScore = target > 0 ? Math.min(1, life / target) : 0;
      const healthScore = Math.min(1, health / HEALTH_COVER_TARGET);
      comps.push({ ...c, assessed: true, provisional: !cash.incomeAssessed, score: 100 * (0.5 * lifeScore + 0.5 * healthScore), formula,
        metrics: [{ label: "Life cover", value: formatCompact(life) }, { label: "Life target", value: formatCompact(target) }, { label: "Health cover", value: `${formatCompact(health)} (ref ${formatCompact(HEALTH_COVER_TARGET)})` }],
        reason: `Life cover is ${(lifeScore * 100).toFixed(0)}% of target, health cover ${(healthScore * 100).toFixed(0)}% of reference.`, improvement: "Close the cover gap with term life / health top-up as appropriate." });
    }
  }

  const totalW = sum(comps.map((x) => x.weight));
  const assessed = comps.filter((x) => x.assessed && x.score != null);
  const aw = sum(assessed.map((x) => x.weight));
  const overall = aw > 0 ? sum(assessed.map((x) => x.score! * x.weight)) / aw : null;
  const coverage = totalW > 0 ? aw / totalW : 0;
  const bands = [...s.scoreBands].sort((a, b) => a.min - b.min);
  const band = overall == null ? null : coverage < 0.5 ? "Provisional — low coverage" : [...bands].reverse().find((b) => overall >= b.min)?.label ?? bands[0]?.label ?? null;
  const unassessed = comps.filter((x) => !x.assessed).map((x) => x.label);
  return {
    overall, band, coverage, provisional: coverage < 1 || assessed.some((x) => x.provisional), lowCoverage: coverage < 0.5, components: comps,
    disclosure: unassessed.length ? `Provisional: based on ${assessed.length} of 6 components (${(coverage * 100).toFixed(0)}% of total weight). Unassessed components are excluded and the remaining weights re-normalised — they are not given full or zero marks: ${unassessed.join(", ")}.` : assessed.some((x) => x.provisional) ? "All components assessed, but some inputs are provisional." : "All components assessed.",
    methodology: "Educational financial-health indicator on a 0–100 scale. Not a CIBIL/credit-bureau score and not financial advice. Each component is scored by documented piecewise-linear rules; the overall score is the weighted average of assessed components with weights re-normalised.",
  };
}
