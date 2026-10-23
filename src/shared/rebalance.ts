import { formatCompact, formatPct, sum, type Paise } from "./money";
import { ASSET_CLASS_LABEL, type AssetClass, type Denominator } from "./taxonomy";
import type { AllocationRow, PortfolioResult } from "./portfolio";
import type { ClientData, Holding } from "./types";

export interface PlanItem {
  assetClass: AssetClass; label: string; actualPct: number | null; targetPct: number | null; driftPp: number | null; outsideBand: boolean;
  gapValue: Paise; direction: "add" | "reduce" | "hold"; suggestedAmount: Paise; sellable: Paise; reasons: string[]; mathOnly: boolean;
}
export interface RebalancePlan {
  denominator: Denominator; denominatorValue: Paise; policyValidated: boolean; provisional: boolean;
  reserveRequired: Paise; cashAvailable: Paise; freeCash: Paise; items: PlanItem[]; newMoneyNeeded: Paise; proceedsFromSales: Paise;
  steps: string[]; notes: string[]; disclaimer: string;
}

export const REBALANCE_STEPS = [
  "Verify data completeness (unclassified holdings widen results into ranges).",
  "Select the allocation denominator.",
  "Calculate actual exposure by asset class.",
  "Compare with the target allocation (percentage-point drift).",
  "Apply the drift tolerance to find classes outside their band.",
  "Assess liquidity and known cash obligations (emergency fund, next-90-day outflows, commitments).",
  "Estimate the value needed to reach each target, capped by what can realistically be sold.",
  "Present options for your review — nothing is executed automatically.",
];

export function buildRebalancePlan(rows: AllocationRow[], p: PortfolioResult, data: ClientData, params: {
  denominator: Denominator; reserveRequired: Paise; cashAvailable: Paise; equityCapPct: number | null; bandDefault: number;
}): RebalancePlan {
  const D = p.denominators[params.denominator].value;
  const free = Math.max(0, params.cashAvailable - params.reserveRequired);
  const notes: string[] = [];
  const items: PlanItem[] = rows.filter((r) => r.inDenominator && r.targetPct != null).map((r) => {
    const gap = r.gapValue ?? 0;
    const band = r.bandPp ?? params.bandDefault;
    // only a DEFINITE breach drives an action; a 'possible' one depends on unclassified holdings and is held until resolved
    const outside = r.status === "breach";
    const undetermined = r.status === "possible";
    const sellable = sum(p.lines.filter((l) => l.assetClass === r.assetClass && l.liquidityTier <= 3 && !l.isRemainder).map((l) => l.value));
    const reasons: string[] = [];
    let direction: PlanItem["direction"] = "hold", amount = 0;
    if (undetermined) reasons.push(`Cannot be confirmed: ${r.minPct?.toFixed(1)}–${r.maxPct?.toFixed(1)}% depending on unclassified holdings, so no action is suggested until they are classified.`);
    else if (!outside) reasons.push(`Within the ±${band} pp band — no action required.`);
    else if (gap < 0) {
      direction = "reduce";
      amount = Math.min(-gap, sellable);
      reasons.push(`${ASSET_CLASS_LABEL[r.assetClass]} is ${r.driftPp!.toFixed(1)} pp above target (gap ${formatCompact(-gap)}).`);
      if (sellable < -gap) reasons.push(`Only ${formatCompact(sellable)} is sellable within a month; the rest is illiquid / locked-in (e.g. property, AIF) and is not suggested for sale.`);
      if (amount > 0) reasons.push("Prefer redirecting new contributions before selling; consider tax, exit loads and market timing.");
    } else {
      direction = "add"; amount = gap;
      reasons.push(`${ASSET_CLASS_LABEL[r.assetClass]} is ${Math.abs(r.driftPp!).toFixed(1)} pp below target (gap ${formatCompact(gap)}).`);
    }
    return { assetClass: r.assetClass, label: ASSET_CLASS_LABEL[r.assetClass], actualPct: r.pct, targetPct: r.targetPct, driftPp: r.driftPp, outsideBand: outside,
      gapValue: gap, direction, suggestedAmount: amount, sellable, reasons, mathOnly: sellable === 0 && direction === "reduce" };
  });

  // cap additions into equity so a rebalance never creates an equity-limit breach
  if (params.equityCapPct != null && D > 0) {
    const eq = (items.find((i) => i.assetClass === "indian_equity")?.actualPct ?? 0) + (items.find((i) => i.assetClass === "global_equity")?.actualPct ?? 0);
    const headroom = Math.max(0, Math.round(((params.equityCapPct - eq) / 100) * D));
    const eqAdds = items.filter((i) => i.direction === "add" && (i.assetClass === "indian_equity" || i.assetClass === "global_equity"));
    const total = sum(eqAdds.map((i) => i.suggestedAmount));
    if (total > headroom) {
      for (const i of eqAdds) { i.suggestedAmount = total === 0 ? 0 : Math.round((i.suggestedAmount * headroom) / total); i.reasons.push(`Capped so total equity stays within the ${params.equityCapPct}% equity limit.`); }
    }
  }
  const proceeds = sum(items.filter((i) => i.direction === "reduce").map((i) => i.suggestedAmount));
  const wanted = sum(items.filter((i) => i.direction === "add").map((i) => i.suggestedAmount));
  const funding = proceeds + free;
  const newMoney = Math.max(0, wanted - funding);
  if (newMoney > 0) {
    // only suggest buying what can actually be funded from sale proceeds and free cash; the rest needs fresh money
    const f = wanted > 0 ? funding / wanted : 0;
    for (const i of items.filter((x) => x.direction === "add")) {
      i.suggestedAmount = Math.round(i.suggestedAmount * f);
      i.reasons.push(f === 0 ? "No free cash or sale proceeds are available, so this can only be closed with fresh money." : `Funding available covers ${formatPct(f * 100, 0)} of the total shortfall; the rest needs fresh money.`);
    }
    notes.push(`Reaching every target needs about ${formatCompact(newMoney)} of fresh money beyond sale proceeds and free cash.`);
  }
  if (p.unresolved.value > 0) notes.push(`${formatCompact(p.unresolved.value)} of holdings are unclassified: gaps are computed on the classified portion and may change once they are resolved.`);
  if (params.reserveRequired > 0) notes.push(`Liquidity guard: ${formatCompact(params.reserveRequired)} (emergency fund + next-90-day obligations) is kept aside before any cash is deployed.`);
  if (!data.settings.investmentPolicyValidated) notes.push("The 50/20/10/10/5/5 allocation is the sample from the project brief — it is not a validated investment policy for this client.");
  return {
    denominator: params.denominator, denominatorValue: D, policyValidated: data.settings.investmentPolicyValidated, provisional: p.unresolved.value > 0,
    reserveRequired: params.reserveRequired, cashAvailable: params.cashAvailable, freeCash: free, items, newMoneyNeeded: newMoney, proceedsFromSales: proceeds, steps: REBALANCE_STEPS, notes,
    disclaimer: "A mathematical allocation gap is not an investment recommendation. These options ignore taxes, exit loads, lock-ins and your full circumstances. Review with a qualified adviser. Nothing is executed automatically.",
  };
}

export interface Trade { assetClass: AssetClass; amount: Paise; label?: string } // +buy / −sell

/**
 * Apply proposed trades to a COPY of the data and return it. Sales reduce sellable holdings of that class
 * proportionally; purchases add a simulated holding; net sale proceeds land in simulated cash; net purchases are new money.
 */
export function applyTrades(data: ClientData, trades: Trade[]): { data: ClientData; warnings: string[] } {
  const warnings: string[] = [];
  const holdings: Holding[] = data.holdings.map((h) => ({ ...h }));
  let cashDelta = 0;
  const mk = (n: number, name: string, cls: AssetClass, value: Paise, cash = false): Holding => ({
    id: `sim_${n}`, clientId: data.client.id, name, originalDescription: name, instrumentType: cash ? "bank_balance" : cls === "debt" ? "bond" : "other", assetClass: cls, classOverride: cls,
    classificationMethod: "user_override", classificationStatus: "confirmed", classificationReason: "Simulated", geography: null, issuer: null, account: null, symbol: null, sector: null,
    quantity: null, currentValue: value, investedValue: value, acquisitionDate: null, valuationDate: null, valuationSource: "manual", maturityDate: null, expectedMaturityValue: null,
    liquidityTier: cash ? 1 : 2, emergencyEligible: cash, parentId: null, isAggregate: false, dataStatus: "collected", notes: null, archived: false, isIllustrative: true,
  });
  let n = 0;
  for (const t of trades) {
    if (!t.amount) continue;
    if (t.amount > 0) { holdings.push(mk(++n, t.label ?? `Simulated purchase — ${ASSET_CLASS_LABEL[t.assetClass]}`, t.assetClass, t.amount)); cashDelta -= t.amount; continue; }
    const want = -t.amount;
    const pool = holdings.filter((h) => !h.archived && !h.parentId && (h.classOverride ?? h.assetClass) === t.assetClass && h.liquidityTier <= 3 && !holdings.some((c) => c.parentId === h.id));
    const avail = sum(pool.map((h) => h.currentValue));
    if (avail < want) warnings.push(`Cannot sell ${formatCompact(want)} of ${ASSET_CLASS_LABEL[t.assetClass]}: only ${formatCompact(avail)} is sellable. Selling the available amount only.`);
    const sold = Math.min(want, avail);
    for (const h of pool) {
      const cut = avail === 0 ? 0 : Math.round((sold * h.currentValue) / avail);
      const f = h.currentValue === 0 ? 0 : cut / h.currentValue;
      h.currentValue -= cut;
      if (h.investedValue != null) h.investedValue = Math.round(h.investedValue * (1 - f));
    }
    cashDelta += sold;
  }
  if (cashDelta > 0) holdings.push(mk(++n, "Simulated cash from sales", "debt", cashDelta, true));
  else if (cashDelta < 0) warnings.push(`Purchases exceed sale proceeds by ${formatCompact(-cashDelta)}: this scenario assumes that much fresh money is invested.`);
  return { data: { ...data, holdings }, warnings };
}
